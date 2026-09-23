// Turns raw test results into plain-English findings, a freshness score and per-component summaries.
import { effectiveGpuScore } from './gpuTiers.js';
import { evaluatePurpose } from './profiles.js';
import { DONENESS } from './copy.js';
import { fmt } from './ui.js';

// Our WebGL egg scene: roughly this many FPS at 1080p per GPU-tier point.
// Calibrated on a laptop GTX 1650 (tier ~8).
const GPU_FPS_PER_POINT = 2.6;

export function buildMetrics(s) {
  const sys = s.sys;
  const gpu = sys.gpus[0] || null;
  const isLaptop = sys.system.isLaptop;
  const internal = sys.disks.filter((d) => !d.usb);
  const boot = internal.find((d) => d.isBoot) || internal[0];
  const bootKind = !boot ? null : /nvme/i.test(boot.kind) ? 'nvme' : /ssd/i.test(boot.kind) ? 'ssd' : /hdd|hard/i.test(boot.kind) ? 'hdd' : null;
  const displays = sys.displays;
  const bestDisplay = displays.length ? displays.reduce((a, d) => (d.nativeWidth * d.nativeHeight > a.nativeWidth * a.nativeHeight ? d : a)) : null;
  const gpuName = gpu?.name || 'None';
  const hasIgpuIntel = /intel/i.test(sys.cpu.vendor || sys.cpu.name) && !/\d{4,5}K?F\b/i.test(sys.cpu.name);
  const hwEncoder = sys.gpus.some((g) => /gtx|rtx|quadro/i.test(g.name)) ? 'nvenc'
    : sys.gpus.some((g) => /radeon/i.test(g.name)) ? 'amf'
    : hasIgpuIntel || sys.gpus.some((g) => /intel/i.test(g.name)) ? 'qsv' : null;
  return {
    cpuSingle: s.cpu?.single ?? null,
    cpuMulti: s.cpu?.multi ?? null,
    threads: sys.cpu.threads,
    ramGB: Math.round(sys.ram.installedGB || sys.ram.totalGB),
    gpu,
    gpuName,
    gpuScore: effectiveGpuScore(gpu, isLaptop),
    gpuVendor: /nvidia|geforce|rtx|gtx/i.test(gpuName) ? 'nvidia' : /radeon|amd/i.test(gpuName) && gpu?.discrete ? 'amd' : gpu?.discrete ? 'other' : 'integrated',
    vramGB: gpu?.discrete ? gpu.vramGB : 0,
    bootKind,
    boot,
    storageGB: internal.reduce((a, d) => a + d.sizeGB, 0),
    maxHz: displays.length ? Math.max(...displays.map((d) => d.maxHz || d.hz || 60)) : null,
    bestDisplay: bestDisplay ? { w: bestDisplay.nativeWidth, h: bestDisplay.nativeHeight } : null,
    isLaptop,
    batteryHealth: sys.battery.has ? sys.battery.healthPct : null,
    wifi: sys.network.wifi,
    online: sys.network.online,
    hwEncoder,
  };
}

// ---------- listing ("what the seller claimed") ----------
function parseGB(str) {
  const m = String(str || '').toLowerCase().replace(',', '.').match(/([\d.]+)\s*(tb|t|gb|g)?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!n) return null;
  return m[2] && m[2].startsWith('t') ? n * 1000 : n;
}
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function listingFindings(claims, s, m) {
  const out = [];
  if (!claims) return out;
  const bad = (area, what, claimed, actual) =>
    out.push({
      sev: 'critical', area, penalty: 20,
      title: `The listing said ${what} “${claimed}”, but this PC has ${actual}`,
      detail: 'Either the ad was wrong, or something got swapped. Ask the seller to explain before you pay the listed price.',
      ask: `The ad says ${what} ${claimed}, but I see ${actual}. Why the difference?`,
      cost: 'none',
    });
  const good = (area, what) => out.push({ sev: 'good', area, penalty: 0, title: `${what} matches the listing` });

  if (claims.cpu?.trim()) {
    const tokens = claims.cpu.toLowerCase().match(/\d{3,5}[a-z]{0,3}/g) || [];
    const have = squash(s.sys.cpu.name);
    if (tokens.length && !tokens.every((t) => have.includes(t))) bad('cpu', 'CPU', claims.cpu.trim(), s.sys.cpu.name);
    else if (tokens.length) good('cpu', 'CPU');
  }
  if (claims.gpu?.trim()) {
    const c = claims.gpu.toLowerCase();
    const num = c.match(/\d{3,4}/)?.[0];
    const names = s.sys.gpus.map((g) => g.name.toLowerCase());
    const match = names.some((n) => (!num || n.includes(num)) && (!/\bti\b/.test(c) || /\bti\b/.test(n)) && (!/super/.test(c) || /super/.test(n)) && (!/\bxtx\b/.test(c) || /xtx/.test(n)) && (!/\bxt\b/.test(c) || /\bxtx?\b/.test(n)));
    if (num && !match) bad('gpu', 'graphics card', claims.gpu.trim(), (s.sys.gpus.some((g) => g.discrete) ? s.sys.gpus.filter((g) => g.discrete) : s.sys.gpus).map((g) => g.name).join(' + ') || 'no graphics card');
    else if (num) good('gpu', 'Graphics card');
  }
  if (claims.ram?.trim()) {
    const c = parseGB(claims.ram);
    if (c && m.ramGB < c - 1) bad('ram', 'RAM', `${c} GB`, `${m.ramGB} GB`);
    else if (c) good('ram', 'RAM');
  }
  if (claims.storage?.trim()) {
    const c = parseGB(claims.storage);
    if (c && m.storageGB < c * 0.88) bad('storage', 'storage', fmt.gb(c), fmt.gb(m.storageGB));
    else if (c) good('storage', 'Storage size');
  }
  return out;
}

// ---------- findings ----------
export function analyze(s) {
  const m = buildMetrics(s);
  const sys = s.sys;
  const F = [];
  const add = (f) => F.push({ penalty: 0, ...f });

  if (sys.system.virtual) add({ sev: 'info', area: 'system', title: 'This is running inside a virtual machine', detail: 'Results describe the virtual machine, not real hardware. Run it directly on the PC you’re buying.' });
  if (!sys.isAdmin) add({ sev: 'info', area: 'app', title: 'Some deep checks were skipped (not run as admin)', detail: 'Drive age, drive wear, real read speed and some temperatures need admin rights. Use “Restart as admin” on the start screen for the full picture.' });

  // ---- CPU stability
  const mathErrors = (s.cpu?.errors || 0) + (s.stress?.errors || 0);
  if (mathErrors > 0) {
    add({ sev: 'critical', area: 'cpu', penalty: 40, cap: 35,
      title: 'The CPU got math wrong under load',
      detail: `It gave ${mathErrors} wrong answer${mathErrors > 1 ? 's' : ''}. A healthy CPU makes zero mistakes, ever. Usually this means an unstable overclock or undervolt, overheating, or a dying CPU or motherboard. Expect random crashes and blue screens.`,
      fix: 'Ask the seller to reset the BIOS to default settings, then run the test again.', cost: 'mid',
      ask: 'Has this PC been overclocked or undervolted? Does it ever crash or blue-screen?' });
  } else if (s.stress) {
    add({ sev: 'good', area: 'cpu', title: 'CPU is stable under full load', detail: `Zero calculation errors during ${s.stress.seconds}s at 100% on all ${s.stress.threads} threads.` });
  }

  // ---- Cooling
  const st = s.stress;
  if (st) {
    if (st.perfLateAvg != null) {
      if (st.perfLateAvg < 80) {
        add({ sev: 'critical', area: 'cooling', penalty: 25,
          title: 'It overheats and slows itself down',
          detail: `Under load the CPU dropped to ${st.perfLateAvg}% of its normal base speed. That means it’s cooking itself. Usually dried-out thermal paste, dust-clogged fans, or a dead fan.`,
          fix: 'A clean-out and fresh thermal paste usually fixes it.', cost: 'cheap',
          ask: 'When was it last cleaned inside? Have the fans ever been replaced?' });
      } else if (st.perfLateAvg < 97) {
        add({ sev: 'warn', area: 'cooling', penalty: sys.system.isLaptop ? 4 : 8,
          title: 'Runs warm under heavy load',
          detail: `Under long full load it settled at ${st.perfLateAvg}% of base speed (no turbo boost left). ${sys.system.isLaptop ? 'Fairly common for laptops, but a clean-out would help.' : 'For a desktop, the cooler should do better than this.'}`,
          fix: 'Cleaning the fans and replacing thermal paste can win back speed.', cost: 'cheap' });
      } else {
        add({ sev: 'good', area: 'cooling', title: 'Cooling keeps up', detail: `Still boosting at ${st.perfLateAvg}% of base speed after ${st.seconds}s of full load.` });
      }
    } else if (st.dropPct > 35) {
      add({ sev: 'warn', area: 'cooling', penalty: 10, title: 'Performance sagged during the oven test', detail: `Speed dropped ${st.dropPct}% as it heated up. Could be heat or power limits.`, cost: 'cheap' });
    }
    if (st.maxTempC != null) {
      if (st.maxTempC >= 95) add({ sev: 'critical', area: 'cooling', penalty: 15, title: `CPU hit ${Math.round(st.maxTempC)}°C`, detail: 'That’s at the limit. It’s running way too hot.', fix: 'Clean the fans, replace thermal paste.', cost: 'cheap' });
      else if (st.maxTempC >= 88) add({ sev: 'warn', area: 'cooling', penalty: 5, title: `CPU got hot (${Math.round(st.maxTempC)}°C)`, detail: 'Hot but within limits. Worth a clean.', cost: 'cheap' });
    }
  }

  // ---- GPU
  const g = s.gpu;
  if (!sys.gpus.length) {
    add({ sev: 'critical', area: 'gpu', penalty: 10, title: 'No graphics driver installed', detail: 'Windows is using a basic fallback driver. Games and video will be slow or won’t work until a driver is installed.', fix: 'Install the driver from NVIDIA, AMD or Intel’s site.', cost: 'free' });
  }
  if (g?.driverCrash) {
    add({ sev: 'critical', area: 'gpu', penalty: 30, title: 'The graphics driver crashed during the test', detail: 'The GPU gave up during the 3D test. Could be a failing card, overheating, a bad overclock or a broken driver.', ask: 'Do games ever crash or show weird colored artifacts?', cost: 'pricey' });
  } else if (g?.error) {
    add({ sev: 'warn', area: 'gpu', penalty: 5, title: 'The 3D test couldn’t run', detail: g.error });
  } else if (g) {
    const dgpu = sys.gpus.find((x) => x.discrete);
    const ranOnIgpu = dgpu && g.renderer && !squash(g.renderer).includes(squash(dgpu.name).replace(/nvidia|geforce|amd|radeon/g, '').slice(0, 6));
    if (ranOnIgpu) {
      add({ sev: 'info', area: 'gpu', title: 'The 3D test ran on the built-in graphics, not the graphics card', detail: `Windows handed the test to “${g.renderer}”. On laptops this is a power setting, not a fault. The graphics card’s own score wasn’t measured.` });
    } else if (dgpu && m.gpuScore >= 12) {
      const expected = m.gpuScore * GPU_FPS_PER_POINT;
      if (g.avgFps < expected * 0.3) {
        add({ sev: 'critical', area: 'gpu', penalty: 30,
          title: 'The graphics card is WAY slower than it should be',
          detail: `A real ${dgpu.name} should do roughly ${Math.round(expected)} FPS here, this one did ${Math.round(g.avgFps)}. Possible fake or relabeled card (common with cheap listings), a failing card, or a laptop stuck in power-saving mode.`,
          fix: 'Plug in the charger, update the graphics driver, and run again. If it’s still slow, walk away.', cost: 'pricey',
          ask: 'Do you have the original box or receipt for the graphics card?' });
      }
    }
    if (g.dropPct > 25) add({ sev: 'warn', area: 'gpu', penalty: 8, title: 'Graphics slow down as they heat up', detail: `Frame rate dropped ${g.dropPct}% during the test. Probably heat.`, fix: 'Clean the graphics card fans.', cost: 'cheap' });
  }
  const gt = s.gpuTemp;
  if (gt != null) {
    if (gt >= 93) add({ sev: 'critical', area: 'gpu', penalty: 15, title: `Graphics card hit ${gt}°C`, detail: 'Way too hot. Fans or thermal paste/pads need attention.', cost: 'cheap' });
    else if (gt >= 86) add({ sev: 'warn', area: 'gpu', penalty: 6, title: `Graphics card ran hot (${gt}°C)`, detail: 'Within limits, but warmer than ideal.', cost: 'cheap' });
  }

  // ---- RAM
  const r = s.ram;
  if (r && !r.skipped) {
    if (r.errors > 0) add({ sev: 'critical', area: 'ram', penalty: 45, cap: 30, title: 'Memory errors found', detail: `${r.errors.toLocaleString('en-US')} values came back wrong. Faulty RAM causes crashes, corrupted files and blue screens.`, fix: 'Reseat or replace the faulty RAM stick.', cost: 'mid', ask: 'Has it had crashes or blue screens?' });
    else add({ sev: 'good', area: 'ram', title: 'Memory test passed', detail: `Wrote and verified ${fmt.gb(r.mb / 1024)} of patterns with zero errors.` });
  }
  const sticks = sys.ram.sticks;
  const slowSticks = sticks.filter((x) => x.ratedMHz && x.runningMHz && x.ratedMHz > x.runningMHz * 1.1);
  if (slowSticks.length) {
    const mixed = new Set(sticks.map((x) => x.ratedMHz)).size > 1;
    add({ sev: 'warn', area: 'ram', penalty: 3,
      title: 'RAM is running slower than it’s rated for',
      detail: mixed
        ? `The sticks don’t match (${sticks.map((x) => `${x.sizeGB} GB @ ${x.ratedMHz} MHz`).join(' + ')}), so they all run at the slowest one’s speed: ${sticks[0].runningMHz} MHz.`
        : `Rated for ${slowSticks[0].ratedMHz} MHz, running at ${slowSticks[0].runningMHz} MHz.${sys.system.isLaptop ? ' Some laptop CPUs cap the speed, so this may be normal.' : ' On desktops, XMP/EXPO is probably switched off in the BIOS.'}`,
      fix: mixed ? 'Matching sticks would fix it.' : sys.system.isLaptop ? null : 'Turn on XMP / EXPO in the BIOS: a free speed boost.', cost: mixed ? 'cheap' : 'free' });
  }
  if (sys.ram.singleStick && sys.ram.totalGB >= 4) {
    add({ sev: 'warn', area: 'ram', penalty: 4, title: 'Only one RAM stick (single-channel)',
      detail: 'Memory is running on one lane instead of two. Games and built-in graphics can be 10–30% slower because of it.',
      fix: 'If there’s a free slot, a matching second stick is a cheap upgrade.', cost: 'cheap' });
  }

  // ---- Storage
  for (const d of sys.disks.filter((x) => !x.usb)) {
    const nm = `${d.name} (${fmt.gb(d.sizeGB)})`;
    if (/unhealthy/i.test(d.health || '') || (d.smart && !/ok|unknown|predicted/i.test(d.smart) && d.smart !== '')) {
      add({ sev: 'critical', area: 'storage', penalty: 40, cap: 35, title: `A drive is failing: ${nm}`, detail: 'Windows says this drive is unhealthy. It can die any day and take everything on it.', fix: 'The drive needs replacing.', cost: 'mid', ask: 'Has the PC been freezing or losing files?' });
    } else if (/warning/i.test(d.health || '')) {
      add({ sev: 'warn', area: 'storage', penalty: 20, title: `A drive is showing warning signs: ${nm}`, detail: 'Windows flagged this drive as “warning”. It’s wearing out.', fix: 'Plan to replace it soon.', cost: 'mid' });
    }
    if (d.wearPct != null) {
      if (d.wearPct >= 80) add({ sev: 'critical', area: 'storage', penalty: 25, title: `SSD is ${d.wearPct}% worn out: ${nm}`, detail: 'SSDs have a limited amount of writing in them. This one has used almost all of it.', fix: 'Replace the SSD.', cost: 'mid' });
      else if (d.wearPct >= 50) add({ sev: 'warn', area: 'storage', penalty: 10, title: `SSD is ${d.wearPct}% worn: ${nm}`, detail: 'Past the halfway point of its life. It’s been worked hard.', cost: 'mid' });
    }
    if ((d.readErrors || 0) > 0 || (d.writeErrors || 0) > 0) add({ sev: 'warn', area: 'storage', penalty: 15, title: `Drive has had read/write errors: ${nm}`, detail: 'The drive has failed to read or write data before. Early sign of trouble.', cost: 'mid' });
    if (d.powerOnHours != null) {
      const hdd = /hdd|hard/i.test(d.kind);
      if (hdd && d.powerOnHours > 25000) add({ sev: 'warn', area: 'storage', penalty: 10, title: `Old hard drive: ${fmt.hours(d.powerOnHours)}`, detail: 'Hard drives have moving parts that wear out. This one has done its time.', fix: 'Swap it for an SSD.', cost: 'cheap' });
      else if (!hdd && d.powerOnHours > 30000) add({ sev: 'warn', area: 'storage', penalty: 5, title: `Drive has been running for years: ${fmt.hours(d.powerOnHours)}`, detail: 'Tells you the PC is older than it may look.', cost: 'none' });
      else if (d.powerOnHours < 300) add({ sev: 'good', area: 'storage', title: `Drive is nearly new (${d.powerOnHours} hours of use)`, detail: 'Either the PC is barely used, or the drive was recently replaced.' });
    }
    if (d.tempC && d.tempC >= 70) add({ sev: 'warn', area: 'storage', penalty: 4, title: `Drive running hot (${d.tempC}°C)`, detail: 'Hot drives wear faster and slow down.', cost: 'cheap' });
  }
  if (m.bootKind === 'hdd') add({ sev: 'warn', area: 'storage', penalty: 8, title: 'Windows is on a slow hard drive', detail: 'Boot-up, apps and games will all feel sluggish.', fix: 'An SSD is the best cheap upgrade ever. Night and day difference.', cost: 'cheap' });
  const dk = s.disk;
  if (dk && !dk.error) {
    if (m.bootKind === 'nvme' && dk.writeMBs < 250) add({ sev: 'warn', area: 'storage', penalty: 6, title: 'The SSD is slower than it should be', detail: `Wrote at ${dk.writeMBs} MB/s. A healthy NVMe drive usually does 1000+ MB/s. Could be nearly full, overheating or a budget drive.`, cost: 'cheap' });
    if (dk.syncIops < 60) add({ sev: 'warn', area: 'storage', penalty: 5, title: 'Drive responds slowly to small tasks', detail: `Only ${dk.syncIops} small saves per second. Windows will feel laggy.`, cost: 'cheap' });
  }
  const cVol = sys.volumes.find((v) => /^c:/i.test(v.mount));
  if (cVol && cVol.usedPct >= 90) add({ sev: 'info', area: 'storage', penalty: 1, title: `C: drive is ${cVol.usedPct}% full`, detail: `Only ${fmt.gb(cVol.freeGB)} free. A full drive slows everything down.`, fix: 'Clear out junk or ask the seller to wipe it.', cost: 'free' });

  // ---- Displays
  for (const d of sys.displays) {
    if (d.maxHz && d.hz && d.maxHz > d.hz + 5) {
      add({ sev: 'info', area: 'display', title: `${d.name} is set to ${d.hz} Hz, but can do ${d.maxHz} Hz`,
        detail: 'You’re not getting the smooth screen you paid for. It’s just a setting.',
        fix: 'Settings → Display → Advanced display → Refresh rate.', action: { label: 'Open display settings', uri: 'ms-settings:display-advanced' }, cost: 'free' });
    }
    if (d.nativeWidth && d.width && d.nativeWidth > d.width) {
      add({ sev: 'info', area: 'display', title: `${d.name} isn’t at its full resolution`,
        detail: `Running ${d.width}×${d.height}, but it supports ${d.nativeWidth}×${d.nativeHeight}. Things look blurry at the wrong resolution.`,
        action: { label: 'Open display settings', uri: 'ms-settings:display' }, cost: 'free' });
    }
  }

  // ---- Battery
  const b = sys.battery;
  if (b.has && b.healthPct != null) {
    const wear = `Holds ${b.healthPct}% of its original charge (${b.maxWh} of ${b.designedWh} Wh).`;
    if (b.healthPct < 50) add({ sev: 'warn', area: 'battery', penalty: 15, title: 'Battery is cooked', detail: `${wear} Expect very short unplugged time.`, fix: 'New batteries for most laptops aren’t too expensive. Use it to haggle.', cost: 'mid', ask: 'How long does the battery actually last unplugged?' });
    else if (b.healthPct < 70) add({ sev: 'warn', area: 'battery', penalty: 8, title: 'Battery is fairly worn', detail: `${wear} You’ll get noticeably less time unplugged than when it was new.`, cost: 'mid', ask: 'How long does the battery last unplugged?' });
    else if (b.healthPct < 80) add({ sev: 'info', area: 'battery', penalty: 3, title: 'Battery has some wear', detail: wear, cost: 'mid' });
    else add({ sev: 'good', area: 'battery', title: `Battery health ${b.healthPct}%`, detail: wear });
    if (b.cycles && b.cycles > 800) add({ sev: 'warn', area: 'battery', penalty: 5, title: `Battery has ${b.cycles} charge cycles`, detail: 'That’s a lot. Most laptop batteries are rated for 300–1000.', cost: 'mid' });
  } else if (m.isLaptop && !b.has) {
    add({ sev: 'warn', area: 'battery', penalty: 10, title: 'No battery detected', detail: 'This laptop didn’t report a battery. It may be dead, disconnected or missing.', cost: 'mid', ask: 'Does the battery hold a charge at all?' });
  }

  // ---- Windows
  const w = sys.windows;
  if (w.activated === false) add({ sev: 'warn', area: 'windows', penalty: 5, title: 'Windows isn’t activated', detail: 'You’d need to buy a license. Factor that into the price.', cost: 'mid', ask: 'Does it come with a genuine Windows license?' });
  if (w.sketchyActivation) add({ sev: 'warn', area: 'windows', penalty: 6, title: 'Windows looks like it was activated with a crack', detail: 'The license comes from a pirate activation tool, not a real key. These can stop working and sometimes carry malware.', cost: 'mid', ask: 'Is the Windows license genuine? Do you have the key?' });
  if (w.installedDaysAgo != null && w.installedDaysAgo <= 3) add({ sev: 'info', area: 'windows', title: `Windows was installed ${w.installedDaysAgo === 0 ? 'today' : `${w.installedDaysAgo} day${w.installedDaysAgo > 1 ? 's' : ''} ago`}`, detail: 'Normal for a PC being sold (fresh start), but it also wipes any history of crashes. Not a problem on its own.' });

  // ---- Network
  if (m.isLaptop && !sys.network.wifi) add({ sev: 'warn', area: 'network', penalty: 10, title: 'No Wi-Fi found', detail: 'This laptop doesn’t show a Wi-Fi adapter. Could be a missing driver, or broken/missing hardware.', cost: 'cheap', ask: 'Does Wi-Fi work?' });
  if (!sys.network.online) add({ sev: 'info', area: 'network', title: 'Wasn’t connected to the internet', detail: 'Connect to Wi-Fi and open a website to make sure it actually works.' });

  // ---- Hands-on & sniff test
  const HO = {
    pixels: { area: 'display', pen: 10, t: 'Screen has dead or stuck pixels', d: 'Tiny dots that don’t change color. Mostly cosmetic, but annoying forever.', cost: 'pricey' },
    keyboard: { area: 'ports', pen: 10, t: 'Some keys don’t work', d: 'Broken keys are a daily annoyance.', cost: 'mid', ask: 'Has anything been spilled on the keyboard?' },
    speakers: { area: 'ports', pen: 8, t: 'Speaker problem', d: 'One or both speakers didn’t sound right.', cost: 'mid' },
    mic: { area: 'ports', pen: 5, t: 'Microphone didn’t work', d: 'Calls and voice chat will need a headset.', cost: 'cheap' },
    webcam: { area: 'ports', pen: 5, t: 'Webcam didn’t work', d: 'No picture from the camera.', cost: 'cheap' },
    usb: { area: 'ports', pen: 6, t: 'A USB port is dead', d: 'At least one port didn’t detect anything.', cost: 'mid' },
    touchpad: { area: 'ports', pen: 8, t: 'Touchpad / mouse buttons misbehave', d: 'Clicks or scrolling didn’t register properly.', cost: 'mid' },
  };
  for (const [k, v] of Object.entries(s.handsOn || {})) {
    const h = HO[k];
    if (!h) continue;
    if (v?.result === 'fail') add({ sev: 'warn', area: h.area, penalty: h.pen, title: h.t, detail: v.note ? `${h.d} ${v.note}` : h.d, cost: h.cost, ask: h.ask });
  }
  for (const item of s.sniff || []) {
    if (item.answer === 'bad') add({ sev: item.critical ? 'critical' : 'warn', area: 'physical', penalty: item.penalty, title: item.badTitle, detail: item.badDetail, cost: item.cost, ask: item.ask });
  }

  // ---- Background apps
  if ((s.miners || []).length) add({ sev: 'critical', area: 'system', penalty: 15, title: 'A crypto miner was running on this PC', detail: `Found: ${s.miners.join(', ')}. Mining runs the hardware flat-out 24/7, which wears it out much faster. It could also be malware.`, ask: 'Was this PC used for crypto mining?', cost: 'none' });
  if ((s.bgAtStart || []).length) add({ sev: 'info', area: 'app', title: 'Some apps were running during the test', detail: `${s.bgAtStart.join(', ')} ${s.bgAtStart.length > 1 ? 'were' : 'was'} open, so scores may be a little lower than this PC can really do.` });

  // ---- Listing
  F.push(...listingFindings(s.claims, s, m).map((f) => ({ penalty: 0, ...f })));

  // ---- Score
  const penalty = F.reduce((a, f) => a + (f.penalty || 0), 0);
  let score = Math.max(0, 100 - penalty);
  const caps = F.filter((f) => f.cap != null).map((f) => f.cap);
  if (caps.length) score = Math.min(score, ...caps);
  score = Math.round(score);
  const doneness = DONENESS.find((d) => score >= d.min);

  const order = { critical: 0, warn: 1, info: 2, good: 3 };
  F.sort((a, b) => order[a.sev] - order[b.sev] || (b.penalty || 0) - (a.penalty || 0));

  const purposes = (s.purposes || []).map((id) => evaluatePurpose(id, m));

  return { m, findings: F, score, doneness, purposes, components: components(s, m, F), questions: sellerQuestions(F, s) };
}

function sellerQuestions(F, s) {
  const qs = F.map((f) => f.ask).filter(Boolean);
  qs.push('Why are you selling it?');
  qs.push('Has it ever been repaired or opened up? Anything replaced?');
  qs.push('Is there a receipt or any warranty left?');
  if ((s.purposes || []).some((p) => ['esports', 'aaa', 'ai'].includes(p)) && s.sys.gpus.some((g) => g.discrete))
    qs.push('Was the graphics card ever used for crypto mining?');
  return [...new Set(qs)];
}

// ---------- per-component cards ----------
function statusFor(area, F) {
  const fs = F.filter((f) => f.area === area);
  if (fs.some((f) => f.sev === 'critical')) return 'bad';
  if (fs.some((f) => f.sev === 'warn')) return 'warn';
  return 'good';
}

function components(s, m, F) {
  const sys = s.sys;
  const cards = [];
  const cpuSpeed = m.cpuMulti == null ? '' : m.cpuMulti >= 15000 ? 'Beast-mode fast.' : m.cpuMulti >= 8000 ? 'Fast.' : m.cpuMulti >= 4500 ? 'Solid, mid-range speed.' : m.cpuMulti >= 2500 ? 'Entry-level speed.' : 'Slow by today’s standards.';
  cards.push({
    area: 'cpu', emoji: '🧠', name: 'Processor (CPU)', status: statusFor('cpu', F),
    main: sys.cpu.name,
    plain: `${sys.cpu.cores} cores / ${sys.cpu.threads} threads. ${cpuSpeed}`,
    details: [
      ['Single-core score', fmt.num(s.cpu?.single)],
      ['Multi-core score', fmt.num(s.cpu?.multi)],
      ['Base clock', `${sys.cpu.baseGHz?.toFixed(2)} GHz`],
      ['Overclockable model', sys.cpu.unlocked ? 'Yes (check it wasn’t pushed too hard)' : 'No'],
      ['Virtualization', sys.cpu.virtualization == null ? '—' : sys.cpu.virtualization ? 'Enabled' : 'Disabled in BIOS'],
      ['Scores are on a scale similar to', 'Cinebench R23'],
    ],
  });
  const st = s.stress;
  cards.push({
    area: 'cooling', emoji: '🌡️', name: 'Cooling & fans', status: st ? statusFor('cooling', F) : 'unknown',
    main: !st ? 'Not tested' : st.perfLateAvg == null ? `${st.dropPct}% slowdown under load` : st.perfLateAvg >= 97 ? 'Keeps its cool' : st.perfLateAvg >= 80 ? 'Gets warm' : 'Overheats',
    plain: st ? `We ran every core at 100% for ${st.seconds}s and watched if it slowed down from heat.` : '',
    details: st ? [
      ['Speed at the end (vs base clock)', st.perfLateAvg != null ? `${st.perfLateAvg}%` : '—'],
      ['Peak speed seen', st.peakPerf != null ? `${st.peakPerf}%` : '—'],
      ['Throughput drop start → end', `${st.dropPct}%`],
      ['Max CPU temperature', st.maxTempC != null ? `${Math.round(st.maxTempC)}°C` : 'Not readable (run as admin)'],
      ['Calculation errors', String(st.errors)],
    ] : [],
  });
  const g = s.gpu;
  cards.push({
    area: 'gpu', emoji: '🎨', name: 'Graphics (GPU)', status: statusFor('gpu', F),
    main: sys.gpus.map((x) => x.name).join(' + ') || 'No driver',
    plain: m.gpu?.discrete ? `Dedicated graphics card with ${m.vramGB} GB of video memory.` : 'Built-in graphics only, no separate graphics card.',
    details: [
      ['Egg-frying 3D test (1080p, deliberately heavy)', g?.avgFps ? `${g.avgFps} FPS avg · ${g.lowFps} FPS 1% low` : g?.error ? 'Failed' : '—'],
      ['Tier score (RTX 4090 = 100)', m.gpuScore ? String(m.gpuScore) : '—'],
      ['Test ran on', g?.renderer || '—'],
      ['Temperature after test', s.gpuTemp != null ? `${s.gpuTemp}°C` : 'Not readable'],
      ['Driver version', m.gpu?.driver || '—'],
    ],
  });
  cards.push({
    area: 'ram', emoji: '🧮', name: 'Memory (RAM)', status: statusFor('ram', F),
    main: `${m.ramGB} GB ${sys.ram.type}`,
    plain: `${sys.ram.sticks.length} stick${sys.ram.sticks.length === 1 ? '' : 's'}${sys.ram.sticks[0]?.runningMHz ? ` running at ${sys.ram.sticks[0].runningMHz} MHz` : ''}.`,
    details: [
      ...sys.ram.sticks.map((x, i) => [`Stick ${i + 1}${x.slot ? ` (${x.slot})` : ''}`, `${x.sizeGB} GB · ${x.maker || '?'} · rated ${x.ratedMHz || '?'} / running ${x.runningMHz || '?'} MHz`]),
      ['Memory test', s.ram ? (s.ram.skipped ? 'Skipped (not enough free RAM)' : `${fmt.gb(s.ram.mb / 1024)} checked, ${s.ram.errors} errors`) : '—'],
    ],
  });
  const internal = sys.disks.filter((d) => !d.usb);
  cards.push({
    area: 'storage', emoji: '💾', name: 'Storage', status: statusFor('storage', F),
    main: internal.map((d) => `${fmt.gb(d.sizeGB)} ${d.kind}`).join(' + ') || 'None found',
    plain: s.disk?.writeMBs ? `Writes at ${fmt.num(s.disk.writeMBs)} MB/s${s.disk.readMBs ? `, reads at ${fmt.num(s.disk.readMBs)} MB/s` : ''}. ${s.disk.writeMBs > 1000 ? 'Very fast.' : s.disk.writeMBs > 300 ? 'Fast.' : s.disk.writeMBs > 100 ? 'OK.' : 'Slow.'}` : '',
    details: [
      ...internal.flatMap((d) => [
        [d.name, `${fmt.gb(d.sizeGB)} ${d.kind}${d.isBoot ? ' · Windows drive' : ''}`],
        ['  Health', d.health || d.smart || '—'],
        ['  Used for', d.powerOnHours != null ? fmt.hours(d.powerOnHours) : sys.isAdmin ? 'Not reported' : 'Run as admin to see'],
        ['  Wear', d.wearPct != null ? `${d.wearPct}%` : sys.isAdmin ? 'Not reported' : 'Run as admin to see'],
      ]),
      ['Small-file speed', s.disk?.syncIops ? `${fmt.num(s.disk.syncIops)} saves/s` : '—'],
      ...sys.volumes.map((v) => [`Drive ${v.mount}`, `${fmt.gb(v.freeGB)} free of ${fmt.gb(v.sizeGB)}`]),
    ],
  });
  cards.push({
    area: 'display', emoji: '🖥️', name: 'Screen', status: statusFor('display', F) === 'good' && F.some((f) => f.area === 'display' && f.sev === 'info') ? 'warn' : statusFor('display', F),
    main: sys.displays.map((d) => `${d.nativeWidth}×${d.nativeHeight} @ ${d.maxHz} Hz`).join(' + ') || 'None',
    plain: sys.displays.length ? sys.displays.map((d) => `${d.name}${d.sizeInch ? ` (${d.sizeInch}")` : ''}`).join(', ') : '',
    details: [
      ...sys.displays.flatMap((d) => [
        [d.name, `${d.builtin ? 'Built-in' : d.connection || 'External'}${d.year ? ` · made ${d.year}` : ''}`],
        ['  Current', `${d.width}×${d.height} @ ${d.hz} Hz`],
        ['  Best possible', `${d.nativeWidth}×${d.nativeHeight} @ ${d.maxHz} Hz`],
      ]),
      ['Measured refresh (this window)', s.measuredHz ? `${s.measuredHz} Hz` : '—'],
      ['Dead pixel check', s.handsOn?.pixels?.result ? (s.handsOn.pixels.result === 'pass' ? 'Passed' : s.handsOn.pixels.result === 'fail' ? 'Failed' : 'Skipped') : 'Not done'],
    ],
  });
  if (sys.battery.has || m.isLaptop) {
    cards.push({
      area: 'battery', emoji: '🔋', name: 'Battery', status: statusFor('battery', F),
      main: sys.battery.healthPct != null ? `${sys.battery.healthPct}% health` : sys.battery.has ? 'Health unknown' : 'Not detected',
      plain: sys.battery.healthPct != null ? `Holds ${sys.battery.maxWh} Wh out of the original ${sys.battery.designedWh} Wh.` : '',
      details: [
        ['Charge cycles', sys.battery.cycles ? String(sys.battery.cycles) : 'Not reported'],
        ['Currently', sys.battery.has ? `${sys.battery.percent}%${sys.battery.plugged ? ', plugged in' : ', on battery'}` : '—'],
        ['Model', sys.battery.model || '—'],
      ],
    });
  }
  const w = sys.windows;
  cards.push({
    area: 'windows', emoji: '🪟', name: 'Windows', status: statusFor('windows', F),
    main: w.name || 'Windows',
    plain: w.activated == null ? 'Couldn’t check activation.' : w.activated ? (w.sketchyActivation ? 'Activated… suspiciously.' : 'Activated and genuine-looking.') : 'Not activated.',
    details: [
      ['Build', w.build || '—'],
      ['License type', w.channel || '—'],
      ['Installed', w.installDate ? `${new Date(w.installDate).toLocaleDateString()} (${w.installedDaysAgo} days ago)` : '—'],
      ['PC model', `${sys.system.maker || ''} ${sys.system.model || ''}`.trim() || '—'],
      ['Motherboard', sys.system.board ? `${sys.system.board.mfr} ${sys.system.board.product}` : '—'],
      ['BIOS', sys.system.bios ? `${sys.system.bios.version} (${sys.system.bios.date ? new Date(sys.system.bios.date).getFullYear() : '?'})` : '—'],
    ],
  });
  const n = sys.network;
  cards.push({
    area: 'network', emoji: '📶', name: 'Network', status: statusFor('network', F),
    main: [n.wifi && 'Wi-Fi', n.ethernet && 'Ethernet'].filter(Boolean).join(' + ') || 'No adapters found',
    plain: n.online ? 'Connected to the internet.' : 'Offline during the test.',
    details: n.adapters.map((a) => [a.name, `${a.up ? 'Connected' : 'Not connected'}${a.speedMbps ? ` · ${a.speedMbps} Mbps link` : ''}`]),
  });
  const ho = s.handsOn || {};
  const hoKeys = Object.keys(ho);
  if (hoKeys.length || (s.sniff || []).length) {
    const label = { pass: 'Works', fail: 'Problem', skip: 'Skipped' };
    cards.push({
      area: 'ports', emoji: '🔌', name: 'Hands-on checks', status: statusFor('ports', F) === 'good' && statusFor('physical', F) === 'good' ? 'good' : statusFor('physical', F) === 'bad' ? 'bad' : 'warn',
      main: hoKeys.some((k) => ho[k].result !== 'skip') ? `${hoKeys.filter((k) => ho[k].result === 'pass').length} of ${hoKeys.filter((k) => ho[k].result !== 'skip').length} tests passed` : 'Eyeball inspection only',
      plain: 'Keyboard, speakers, camera, ports and your own eyeball inspection.',
      details: [
        ...hoKeys.map((k) => [k[0].toUpperCase() + k.slice(1), label[ho[k].result] || '—']),
        ...(s.sniff || []).filter((i) => i.answer).map((i) => [i.short, i.answer === 'good' ? 'Looks fine' : i.answer === 'bad' ? 'Problem' : 'Skipped']),
      ],
    });
  }
  return cards;
}


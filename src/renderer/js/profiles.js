// "What do you need it for?" Each purpose lists what matters and the bars to clear.
// CPU scores are on a Cinebench-R23-like scale; GPU scores are RTX 4090 = 100.

export const PURPOSES = [
  { id: 'office', emoji: '📚', name: 'School, office & browsing', desc: 'Docs, Zoom, 30 Chrome tabs, Netflix in the background.' },
  { id: 'media', emoji: '🍿', name: 'Movies, YouTube & music', desc: 'The couch-potato special. Just stream stuff.' },
  { id: 'esports', emoji: '🎮', name: 'Esports & light gaming', desc: 'Valorant, CS2, League, Fortnite, Minecraft, Roblox.' },
  { id: 'aaa', emoji: '🐉', name: 'Big modern games', desc: 'Cyberpunk, Elden Ring, Call of Duty, the heavy stuff.' },
  { id: 'streaming', emoji: '📡', name: 'Streaming & recording', desc: 'Twitch, YouTube, OBS, gaming while live.' },
  { id: 'creator', emoji: '🎬', name: 'Video editing, 3D & design', desc: 'Premiere, DaVinci, Blender, Photoshop.' },
  { id: 'coding', emoji: '💻', name: 'Programming', desc: 'IDEs, compiling, Docker, a million node_modules.' },
  { id: 'ai', emoji: '🤖', name: 'Local AI', desc: 'Running LLMs, Stable Diffusion, machine learning.' },
  { id: 'portable', emoji: '🎒', name: 'Taking it everywhere', desc: 'Battery life, Wi-Fi, a laptop that survives a day out.' },
];

const rank = { fail: 0, weak: 1, ok: 2, great: 3 };

// value >= great → great, >= ok → ok, >= weak → weak, else fail
function tier(value, [weak, ok, great]) {
  if (value == null || Number.isNaN(value)) return null;
  if (value >= great) return 'great';
  if (value >= ok) return 'ok';
  if (value >= weak) return 'weak';
  return 'fail';
}

const NOTE = {
  cpu: { great: 'Fast processor for this.', ok: 'Quick enough.', weak: 'A bit slow, you’ll notice waiting.', fail: 'Too slow for this.' },
  ram: { great: 'Plenty of memory.', ok: 'Enough memory.', weak: 'Tight: things may slow down with lots open.', fail: 'Not enough memory.' },
  gpu: { great: 'Strong graphics.', ok: 'Decent graphics.', weak: 'Weak graphics, low settings only.', fail: 'Graphics too weak.' },
  vram: { great: 'Loads of video memory.', ok: 'Enough video memory.', weak: 'Low video memory, will limit you.', fail: 'Far too little video memory.' },
  storage: { great: 'Fast storage.', ok: 'Fine storage.', weak: 'Slow storage, expect loading screens.', fail: 'Very slow storage.' },
  space: { great: 'Lots of space.', ok: 'Enough space.', weak: 'Space will fill up fast.', fail: 'Way too little space.' },
};

function check(label, kind, status, value, custom) {
  if (!status) return null;
  return { label, status, value, note: custom || NOTE[kind]?.[status] || '' };
}

function storageTier(m) {
  if (m.bootKind === 'nvme') return 'great';
  if (m.bootKind === 'ssd') return 'ok';
  if (m.bootKind === 'hdd') return 'weak';
  return null;
}
const storageLabel = (m) => ({ nvme: 'NVMe SSD', ssd: 'SATA SSD', hdd: 'Hard drive' })[m.bootKind] || 'Unknown';

export function evaluatePurpose(id, m) {
  const c = [];
  const cpuS = (bars) => c.push(check('CPU (1 core)', 'cpu', tier(m.cpuSingle, bars), m.cpuSingle));
  const cpuM = (bars) => c.push(check('CPU (all cores)', 'cpu', tier(m.cpuMulti, bars), m.cpuMulti));
  const ram = (bars) => c.push(check('RAM', 'ram', tier(m.ramGB, bars), `${m.ramGB} GB`));
  const gpu = (bars) => c.push(check('Graphics', 'gpu', tier(m.gpuScore, bars), m.gpuName));
  const vram = (bars) => c.push(check('Video memory', 'vram', m.vramGB == null ? null : tier(m.vramGB, bars), `${m.vramGB} GB`));
  const storage = (hddStatus = 'weak') => {
    let s = storageTier(m);
    if (s === 'weak') s = hddStatus;
    c.push(check('Storage', 'storage', s, storageLabel(m)));
  };
  const space = (bars) => c.push(check('Space', 'space', tier(m.storageGB, bars), `${m.storageGB} GB`));

  switch (id) {
    case 'office':
      cpuS([450, 650, 950]);
      ram([4, 8, 16]);
      storage('weak');
      break;
    case 'media':
      cpuS([300, 450, 700]);
      ram([4, 6, 8]);
      if (m.bestDisplay) c.push(check('Screen', null, m.bestDisplay.w >= 1920 ? 'great' : m.bestDisplay.w >= 1366 ? 'ok' : 'weak', `${m.bestDisplay.w}×${m.bestDisplay.h}`, m.bestDisplay.w >= 1920 ? 'Full HD or better. Crisp.' : 'Lower resolution screen.'));
      break;
    case 'esports':
      cpuS([750, 1050, 1450]);
      cpuM([2500, 4500, 8000]);
      gpu([3.5, 8, 18]);
      ram([8, 12, 16]);
      if (m.maxHz) c.push(check('Screen speed', null, m.maxHz >= 144 ? 'great' : m.maxHz >= 90 ? 'ok' : 'weak', `${m.maxHz} Hz`, m.maxHz >= 144 ? 'High refresh rate. Buttery smooth.' : m.maxHz >= 90 ? 'Decent refresh rate.' : 'Standard 60 Hz. Fine, but not “competitive”.'));
      break;
    case 'aaa':
      cpuS([950, 1250, 1650]);
      cpuM([4000, 7000, 12000]);
      gpu([8, 18, 35]);
      vram([4, 6, 10]);
      ram([8, 16, 32]);
      storage('fail');
      break;
    case 'streaming':
      cpuM([4000, 7500, 13000]);
      gpu([6, 14, 28]);
      ram([8, 16, 32]);
      c.push(check('Video encoder', null, m.hwEncoder === 'nvenc' ? 'great' : m.hwEncoder ? 'ok' : 'weak', m.hwEncoder === 'nvenc' ? 'NVIDIA NVENC' : m.hwEncoder === 'amf' ? 'AMD AMF' : m.hwEncoder === 'qsv' ? 'Intel Quick Sync' : 'None found',
        m.hwEncoder === 'nvenc' ? 'Best-in-class streaming encoder. Stream without lag.' : m.hwEncoder ? 'Has a hardware encoder, works well.' : 'No hardware encoder, the CPU has to do it all.'));
      c.push(check('Internet', null, m.online ? 'ok' : 'weak', m.online ? 'Connected' : 'Offline', m.online ? 'Online right now (check upload speed at speedtest.net).' : 'Wasn’t online during the test.'));
      break;
    case 'creator':
      cpuM([4000, 8000, 15000]);
      ram([8, 16, 32]);
      gpu([4, 12, 28]);
      vram([2, 4, 8]);
      storage('weak');
      space([250, 500, 1000]);
      break;
    case 'coding':
      cpuS([700, 1000, 1400]);
      cpuM([3000, 6000, 12000]);
      ram([8, 16, 32]);
      storage('weak');
      break;
    case 'ai': {
      vram([4, 8, 16]);
      ram([8, 16, 32]);
      gpu([8, 20, 40]);
      const vendorStatus = m.gpuVendor === 'nvidia' ? 'great' : m.gpuVendor === 'amd' ? 'ok' : 'weak';
      c.push(check('GPU brand', null, vendorStatus, m.gpuVendor === 'nvidia' ? 'NVIDIA (CUDA)' : m.gpuVendor === 'amd' ? 'AMD' : 'Integrated',
        vendorStatus === 'great' ? 'NVIDIA = almost every AI tool just works.' : vendorStatus === 'ok' ? 'AMD works but setup is fiddlier.' : 'No real GPU. AI will be painfully slow.'));
      space([250, 500, 1000]);
      break;
    }
    case 'portable':
      if (!m.isLaptop) {
        c.push({ label: 'Portability', status: 'fail', value: 'Desktop', note: 'It’s a desktop. You’ll need a very long extension cord.' });
      } else {
        c.push(check('Battery health', null, tier(m.batteryHealth, [50, 70, 85]), m.batteryHealth != null ? `${m.batteryHealth}%` : '?',
          m.batteryHealth >= 85 ? 'Battery is in great shape.' : m.batteryHealth >= 70 ? 'Some wear, still OK.' : m.batteryHealth >= 50 ? 'Worn battery, shorter days.' : 'Battery is toast. Budget for a new one.'));
        c.push(check('Wi-Fi', null, m.wifi ? 'great' : 'fail', m.wifi ? 'Yes' : 'Not found', m.wifi ? 'Wi-Fi card detected.' : 'No Wi-Fi card detected!'));
        cpuS([450, 650, 950]);
        ram([4, 8, 16]);
      }
      break;
  }

  const checks = c.filter(Boolean);
  const worst = Math.min(...checks.map((x) => rank[x.status]));
  const greatCount = checks.filter((x) => x.status === 'great').length;
  let verdict;
  if (worst === 0) verdict = 'no';
  else if (worst === 1) verdict = 'meh';
  else if (greatCount >= Math.ceil(checks.length * 0.6)) verdict = 'great';
  else verdict = 'good';
  return { id, checks, verdict };
}

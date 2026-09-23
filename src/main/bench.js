const { Worker } = require('node:worker_threads');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const si = require('systeminformation');
const { streamPS, runPS } = require('./ps');

const CPU_WORKER = path.join(__dirname, 'workers', 'cpu-worker.js');
const RAM_WORKER = path.join(__dirname, 'workers', 'ram-worker.js');

// Scale factors so scores land roughly on the Cinebench R23 scale people know
// (calibrated on an i5-10300H: ~1150 single / ~5500 multi).
const SINGLE_SCALE = 0.078;
const MULTI_SCALE = 0.096;

let cancelled = false;
const liveWorkers = new Set();
const liveStops = new Set();

function cancelAll() {
  cancelled = true;
  for (const w of liveWorkers) w.terminate();
  for (const stop of liveStops) stop();
  liveWorkers.clear();
  liveStops.clear();
}
function resetCancel() {
  cancelled = false;
}

// Runs `count` CPU workers for `ms`. onTick receives units finished since the last tick.
function runCpuWorkers(count, ms, onTick) {
  return Promise.all(
    Array.from({ length: count }, () =>
      new Promise((resolve) => {
        const w = new Worker(CPU_WORKER);
        liveWorkers.add(w);
        const finish = (res) => {
          liveWorkers.delete(w);
          w.terminate();
          resolve(res);
        };
        w.on('message', (m) => {
          if (m.type === 'tick') onTick?.(m.units, m.errors);
          if (m.type === 'done') finish(m);
        });
        w.on('error', () => finish({ units: 0, errors: 0, crashed: true }));
        w.on('exit', () => finish({ units: 0, errors: 0 }));
        w.postMessage({ cmd: 'run', ms });
      })
    )
  );
}

async function cpuBench(onProgress) {
  const threads = os.availableParallelism?.() || os.cpus().length;
  onProgress?.({ phase: 'single', pct: 0 });
  await runCpuWorkers(1, 1200); // warm up turbo + JIT
  if (cancelled) return null;
  const singleMs = 4000;
  const single = await runCpuWorkers(1, singleMs, () => {});
  if (cancelled) return null;
  onProgress?.({ phase: 'multi', pct: 0.45 });
  const multiMs = 5000;
  const multi = await runCpuWorkers(threads, multiMs);
  if (cancelled) return null;
  const singleUps = single[0].units / (singleMs / 1000);
  const multiUps = multi.reduce((a, r) => a + r.units, 0) / (multiMs / 1000);
  const errors = single[0].errors + multi.reduce((a, r) => a + r.errors, 0);
  return {
    single: Math.round(singleUps * SINGLE_SCALE),
    multi: Math.round(multiUps * MULTI_SCALE),
    threads,
    errors,
  };
}

// The "Oven test": every thread flat out for a while. We watch whether throughput
// sags (heat-soak / thermal throttling) and whether any calculation comes back wrong.
async function stressTest(seconds, isAdmin, onSample) {
  const threads = os.availableParallelism?.() || os.cpus().length;
  const buckets = [];
  let bucketUnits = 0;
  let errors = 0;
  const perf = [];
  const temps = [];
  const start = Date.now();

  const psScript = `
while ($true) {
  $p = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'"
  $t = $null
  ${isAdmin ? "$z = @(Get-CimInstance -Namespace root/wmi MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | ForEach-Object { ($_.CurrentTemperature/10)-273.15 }); if ($z.Count) { $t = [math]::Round(($z | Measure-Object -Maximum).Maximum,1) }" : ''}
  @{ perf=[int]$p.PercentProcessorPerformance; mhz=[int]$p.ProcessorFrequency; load=[int]$p.PercentProcessorTime; temp=$t } | ConvertTo-Json -Compress
  Start-Sleep -Milliseconds 1500
}`;
  let loadStart = 0;
  let firstSample;
  const gotSample = new Promise((r) => (firstSample = r));
  const stopPS = streamPS(psScript, (s) => {
    firstSample();
    if (s.temp != null && s.temp > 0 && s.temp < 125) temps.push(s.temp);
    // Ignore the first 2.5s of load: boost clocks are still settling.
    if (loadStart && Date.now() - loadStart > 2500) perf.push({ t: (Date.now() - loadStart) / 1000, perf: s.perf, mhz: s.mhz, load: s.load });
  });
  liveStops.add(stopPS);
  // Start the sampler before the load, otherwise it can't even launch on a pegged CPU.
  await Promise.race([gotSample, new Promise((r) => setTimeout(r, 6000))]);
  if (cancelled) return null;
  loadStart = Date.now();

  // Temperature from systeminformation (works on some machines without admin).
  let siTempBusy = false;

  const timer = setInterval(() => {
    buckets.push(bucketUnits);
    bucketUnits = 0;
    const last = perf[perf.length - 1];
    onSample?.({
      elapsed: buckets.length,
      total: seconds,
      throughput: buckets[buckets.length - 1],
      perfPct: last?.perf ?? null,
      mhz: last?.mhz ?? null,
      tempC: temps.length ? temps[temps.length - 1] : null,
      errors,
    });
    if (!isAdmin && !siTempBusy && buckets.length % 3 === 1) {
      siTempBusy = true;
      si.cpuTemperature()
        .then((t) => t.main && temps.push(t.main))
        .catch(() => {})
        .finally(() => (siTempBusy = false));
    }
  }, 1000);

  await runCpuWorkers(threads, seconds * 1000, (u, e) => {
    bucketUnits += u;
    if (e > errors) errors = e;
  });
  clearInterval(timer);
  stopPS();
  liveStops.delete(stopPS);
  if (cancelled) return null;

  // Throughput: compare the start (after warm-up) with the end of the run.
  const usable = buckets.slice(1).filter((b) => b > 0);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const early = avg(usable.slice(0, Math.max(3, Math.floor(usable.length * 0.2))));
  const late = avg(usable.slice(-Math.max(3, Math.floor(usable.length * 0.25))));
  const dropPct = early > 0 ? Math.max(0, Math.round((1 - late / early) * 100)) : 0;

  const latePerf = perf.filter((p) => p.t > seconds * 0.5).map((p) => p.perf).filter((p) => p > 0);
  const perfLateAvg = latePerf.length ? Math.round(avg(latePerf)) : null;
  const perfMin = latePerf.length ? Math.min(...latePerf) : null;
  const peakPerf = perf.length ? Math.max(...perf.map((p) => p.perf)) : null;

  return {
    seconds,
    threads,
    errors,
    dropPct,
    series: usable,
    perfSeries: perf.map((p) => p.perf),
    perfLateAvg, // % of base clock the CPU held near the end (100 = base clock, >100 = boosting)
    perfMin,
    peakPerf,
    maxTempC: temps.length ? Math.max(...temps) : null,
  };
}

function freeMemMB() {
  return Math.floor(os.freemem() / 1048576);
}

function ramTest(quick, onProgress) {
  const mb = Math.max(256, Math.min(quick ? 1024 : 2048, Math.floor(freeMemMB() * 0.35)));
  return new Promise((resolve) => {
    const w = new Worker(RAM_WORKER, { workerData: { mb, passes: quick ? 1 : 2 }, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    liveWorkers.add(w);
    let done = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      liveWorkers.delete(w);
      w.terminate();
      resolve(res);
    };
    w.on('message', (m) => {
      if (m.type === 'progress') onProgress?.(m.pct);
      if (m.type === 'done') finish(m.error ? { mb, skipped: true } : m);
    });
    w.on('error', () => finish({ mb, skipped: true }));
    w.on('exit', () => finish(cancelled ? null : { mb, skipped: true }));
  });
}

async function diskTest(quick, isAdmin, onProgress) {
  const dir = os.tmpdir();
  const file = path.join(dir, `iic-disktest-${process.pid}.bin`);
  const totalMB = quick ? 512 : 1024;
  const blockMB = 8;
  const block = crypto.randomBytes(blockMB * 1048576);
  const result = { drive: path.parse(dir).root.replace(/\\$/, ''), sizeMB: totalMB };
  let fh;
  try {
    fh = await fs.promises.open(file, 'w');
    const t0 = performance.now();
    for (let written = 0; written < totalMB; written += blockMB) {
      if (cancelled) throw new Error('cancelled');
      await fh.write(block, 0, block.length, written * 1048576);
      onProgress?.((written / totalMB) * 0.6);
    }
    await fh.sync();
    result.writeMBs = Math.round(totalMB / ((performance.now() - t0) / 1000));

    // Small random writes, each forced to disk. This is what makes a PC feel snappy or sluggish.
    const small = crypto.randomBytes(4096);
    const blocks = (totalMB * 1048576) / 4096;
    let ops = 0;
    const t1 = performance.now();
    while (performance.now() - t1 < 2500) {
      if (cancelled) throw new Error('cancelled');
      await fh.write(small, 0, 4096, Math.floor(Math.random() * blocks) * 4096);
      await fh.datasync();
      ops++;
    }
    result.syncIops = Math.round(ops / ((performance.now() - t1) / 1000));
    onProgress?.(0.75);
  } catch (e) {
    result.error = e.message;
  } finally {
    await fh?.close().catch(() => {});
    await fs.promises.rm(file, { force: true }).catch(() => {});
  }
  if (cancelled) return null;

  // Windows' own disk assessment gives a real (uncached) read speed, but needs admin.
  if (isAdmin && !result.error) {
    const out = await runPS(`winsat disk -seq -read -drive ${result.drive.replace(':', '')}`, { timeoutMs: 60000 });
    const m = out.match(/Sequential\s+64\.0\s+Read\s+([\d.,]+)\s*MB\/s/i);
    if (m) result.readMBs = Math.round(parseFloat(m[1].replace(',', '.')));
  }
  onProgress?.(1);
  return result;
}

module.exports = { cpuBench, stressTest, ramTest, diskTest, cancelAll, resetCancel };

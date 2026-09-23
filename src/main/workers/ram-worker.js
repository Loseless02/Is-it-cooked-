// Fills a big block of RAM with known patterns and reads it back.
// Any value that comes back different means the memory is corrupting data.
const { parentPort, workerData } = require('node:worker_threads');

const mb = workerData.mb;
const passes = workerData.passes ?? 2;
let arr;
try {
  arr = new Uint32Array(mb * 262144);
} catch {
  parentPort.postMessage({ type: 'done', error: 'alloc', mb });
  process.exit(0);
}

const n = arr.length;
let errors = 0;
let writeMs = 0;
let readMs = 0;
const patterns = [
  (i) => (Math.imul(i, 2654435761) ^ 0xa5a5a5a5) >>> 0,
  (i) => ~(Math.imul(i, 2654435761) ^ 0xa5a5a5a5) >>> 0,
  (i) => (i & 1 ? 0x55555555 : 0xaaaaaaaa) >>> 0,
  (i) => (i ^ 0xffffffff) >>> 0,
];

for (let p = 0; p < passes * 2 && p < patterns.length; p++) {
  const pat = patterns[p];
  let t = performance.now();
  for (let i = 0; i < n; i++) arr[i] = pat(i);
  writeMs += performance.now() - t;
  t = performance.now();
  for (let i = 0; i < n; i++) if (arr[i] !== pat(i)) errors++;
  readMs += performance.now() - t;
  parentPort.postMessage({ type: 'progress', pct: (p + 1) / Math.min(passes * 2, patterns.length) });
}

const bytes = n * 4 * Math.min(passes * 2, patterns.length);
parentPort.postMessage({
  type: 'done',
  mb,
  errors,
  writeGBs: bytes / (writeMs / 1000) / 1e9,
  readGBs: bytes / (readMs / 1000) / 1e9,
});

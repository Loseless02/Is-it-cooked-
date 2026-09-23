// Runs a fixed, deterministic math workload in a loop.
// Every result is checked against a table computed at startup: a mismatch means
// the CPU produced a wrong answer, which is the classic sign of an unstable
// overclock, bad undervolt or a CPU that is dying.
const { parentPort } = require('node:worker_threads');

// Integer hashing + dependent float multiply-add chains + L1 memory traffic.
// Pure IEEE arithmetic (no library calls), so results are bit-exact on any healthy CPU.
const buf = new Float64Array(256);
function unit(seed) {
  let x = (seed * 2654435761) >>> 0 || 1;
  let f = 1 + seed * 1e-3;
  let g = 0.5;
  for (let i = 0; i < 12000; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    f = f * 1.0000001 + (x & 1023) * 1e-6;
    g = g * 0.9999999 + f * 1e-9;
    buf[i & 255] = f;
    f += buf[(i * 13) & 255] * 1e-12;
  }
  return (x ^ Math.floor(f * 1e6) ^ Math.floor(g * 1e6)) >>> 0;
}

const SEEDS = 64;
const expected = new Uint32Array(SEEDS);
for (let s = 0; s < SEEDS; s++) expected[s] = unit(s + 1);

let stop = false;
let units = 0;
let errors = 0;

parentPort.on('message', (msg) => {
  if (msg.cmd === 'stop') stop = true;
  if (msg.cmd === 'run') run(msg.ms ?? Infinity);
});

function run(ms) {
  const end = Date.now() + ms;
  stop = false;
  const tick = () => {
    const sliceEnd = Math.min(Date.now() + 100, end);
    let n = 0;
    while (Date.now() < sliceEnd) {
      for (let k = 0; k < 8; k++) {
        const s = (units + n) % SEEDS;
        if (unit(s + 1) !== expected[s]) errors++;
        n++;
      }
    }
    units += n;
    parentPort.postMessage({ type: 'tick', units: n, errors });
    if (stop || Date.now() >= end) parentPort.postMessage({ type: 'done', units, errors });
    else setImmediate(tick);
  };
  tick();
}

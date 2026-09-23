import { html, raw, $, $$, mount, toast, sleep, fmt, modal } from './ui.js';
import { QUIPS, LOGO_SVG, HERO_SVG, pick } from './copy.js';
import { PURPOSES } from './profiles.js';
import { runGpuBench, measureRefreshRate } from './gpuBench.js';
import { HANDS_ON, sniffItems } from './handsOn.js';
import { analyze } from './analyze.js';
import { renderResults, animateResults, buildReport } from './results.js';

const api = window.iic;
const app = $('#app');

const state = {
  purposes: new Set(),
  claims: { cpu: '', gpu: '', ram: '', storage: '' },
  mode: 'quick',
  sys: null,
  results: {},
  handsOn: {},
  sniff: null,
  running: false,
  cancelled: false,
  busyApps: null, // background apps from the last scan
  bgAtStart: [], // apps still open when cooking started
  minersSeen: new Set(),
};

let sysPromise = null; // hardware scan, started at launch (see below)

$('#brand-logo').innerHTML = LOGO_SVG;
$('#brand').onclick = () => {
  if (state.running) return toast('Still cooking! Press “Stop” first if you want to leave.');
  showWelcome();
};

function setStep(step) {
  const order = ['pick', 'cook', 'taste', 'verdict'];
  const idx = order.indexOf(step);
  $$('#steps li').forEach((li, i) => {
    li.classList.toggle('active', i === idx);
    li.classList.toggle('done', idx > i);
  });
}

function show(content, step) {
  setStep(step);
  mount(app, content);
  app.scrollTop = 0;
  app.focus();
}

// ---------------------------------------------------------------- Welcome
function showWelcome() {
  show(html`
    <section class="screen">
      <div class="hero">
        <div>
          <div class="eyebrow">Used PC checker</div>
          <h1>Is it<br/>cooked<span class="q">?</span></h1>
          <p class="lead">Buying a second-hand PC? Tell us what you need it for, let us put it in the oven for a few minutes, and we’ll tell you in plain words if it’s a bargain or a burnt mess.</p>
          <div class="cta">
            <button class="btn primary big" id="go">🍳 Let’s cook</button>
          </div>
          <div class="feature-list">
            ${['🧠 CPU speed & stability', '🎨 Graphics & FPS', '🧮 RAM errors', '💾 Drive health', '🌡️ Overheating', '🔋 Battery wear', '🖥️ Screen Hz & dead pixels', '⌨️ Keyboard, ports, camera', '🪟 Windows license', '🕵️ Fake-listing check'].map((c) => html`<span class="chip">${c}</span>`)}
          </div>
        </div>
        <div class="hero-art">${raw(HERO_SVG)}</div>
      </div>
    </section>`, 'pick');
  $('#go').onclick = showPick;
}

// ---------------------------------------------------------------- Pick purposes
function showPick() {
  show(html`
    <section class="screen">
      <div class="eyebrow">Step 1 · Your order</div>
      <h1 class="title">What do you need this PC for?</h1>
      <p class="subtitle">Pick everything that applies. We’ll tell you if it can handle each one.</p>
      <div class="grid cols-3 section" id="purposes">
        ${PURPOSES.map((p) => html`
          <button class="card-pick ${state.purposes.has(p.id) ? 'selected' : ''}" data-id="${p.id}" aria-pressed="${state.purposes.has(p.id)}">
            <span class="check">✓</span>
            <span class="emoji">${p.emoji}</span>
            <span class="name">${p.name}</span>
            <span class="desc">${p.desc}</span>
          </button>`)}
      </div>

      <details class="listing card" ${Object.values(state.claims).some(Boolean) ? 'open' : ''}>
        <summary><span class="arrow">▶</span> 🕵️ Got the listing? Tell us what the seller claimed <span class="muted small">(optional, catches lies)</span></summary>
        <p class="muted small" style="margin-top:10px">Copy it from the ad. We’ll check if what’s inside matches what they said.</p>
        <div class="form-grid">
          <div class="field"><label for="c-cpu">Processor (CPU)</label><input id="c-cpu" data-claim="cpu" placeholder="e.g. i7-12700K or Ryzen 5 5600X" value="${state.claims.cpu}"/></div>
          <div class="field"><label for="c-gpu">Graphics card</label><input id="c-gpu" data-claim="gpu" placeholder="e.g. RTX 3070" value="${state.claims.gpu}"/></div>
          <div class="field"><label for="c-ram">RAM</label><input id="c-ram" data-claim="ram" placeholder="e.g. 16 GB" value="${state.claims.ram}"/></div>
          <div class="field"><label for="c-sto">Storage</label><input id="c-sto" data-claim="storage" placeholder="e.g. 1 TB SSD" value="${state.claims.storage}"/></div>
        </div>
      </details>

      <div class="footer-bar">
        <button class="btn ghost" id="back">← Back</button>
        <span class="spacer"></span>
        <span class="muted small" id="pick-count"></span>
        <button class="btn primary big" id="next"></button>
      </div>
    </section>`, 'pick');

  const update = () => {
    const n = state.purposes.size;
    $('#next').textContent = n ? 'Next →' : 'Skip: just check its health →';
    $('#pick-count').textContent = n ? `${n} selected` : '';
  };
  $$('#purposes .card-pick').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.id;
      state.purposes.has(id) ? state.purposes.delete(id) : state.purposes.add(id);
      b.classList.toggle('selected', state.purposes.has(id));
      b.setAttribute('aria-pressed', state.purposes.has(id));
      update();
    };
  });
  $$('[data-claim]').forEach((i) => (i.oninput = () => (state.claims[i.dataset.claim] = i.value)));
  $('#back').onclick = showWelcome;
  $('#next').onclick = showMode;
  update();
}

// ---------------------------------------------------------------- Mode
async function showMode() {
  const adminBanner = (isAdmin) =>
    isAdmin === false
      ? html`<div class="banner warn"><span class="icon">🔑</span><p style="flex:1"><b>Want the full picture?</b> Drive age, drive wear and temperatures need admin rights. Without them we’ll still test everything else.</p><button class="btn sm" id="admin">Restart as admin</button></div>`
      : isAdmin
        ? html`<div class="banner info"><span class="icon">🔑</span><p>Running as admin: all checks unlocked.</p></div>`
        : '';

  show(html`
    <section class="screen">
      <div class="eyebrow">Step 1 · Your order</div>
      <h1 class="title">How long should we cook it?</h1>
      <p class="subtitle">Both run the same automatic tests. The full one cooks longer (catches overheating better) and walks you through hands-on checks.</p>
      <div class="grid cols-2 section">
        <button class="card-pick mode-card ${state.mode === 'quick' ? 'selected' : ''}" data-mode="quick">
          <span class="check">✓</span><span class="emoji">⏱️</span><span class="name">Quick taste</span><span class="time">About 2 minutes</span>
          <ul><li>All hardware checks & speed tests</li><li>45-second oven (stress) test</li><li>Hands-on checks optional at the end</li></ul>
        </button>
        <button class="card-pick mode-card ${state.mode === 'full' ? 'selected' : ''}" data-mode="full">
          <span class="check">✓</span><span class="emoji">🍗</span><span class="name">Full inspection</span><span class="time">About 5 minutes + hands-on</span>
          <ul><li>Longer, deeper RAM, drive & graphics tests</li><li>2-minute oven test: catches hidden overheating</li><li>Guided keyboard, screen, speaker, camera & port checks</li><li>Recommended if you’re about to pay</li></ul>
        </button>
      </div>
      <div class="section" id="admin-slot">${adminBanner(state.sys?.isAdmin)}</div>
      <div class="banner" style="margin-top:12px">
        <span class="icon">👨‍🍳</span>
        <p><b>Before you start:</b> plug in the charger (laptops slow down on battery) and don’t panic when the fans get loud. That’s the point. Don’t use the PC while it cooks.</p>
      </div>
      <div class="card section kitchen">
        <div class="row">
          <div style="flex:1;min-width:260px">
            <h2 class="section-title" style="margin:0">🧹 Clear the kitchen first</h2>
            <p class="muted small" style="margin-top:4px">Make sure nothing is running in the background: browsers, games, launchers or big programs. They steal power from the tests and make the PC look slower than it really is.</p>
          </div>
          <button class="btn sm ghost" id="apps-refresh">↻ Check again</button>
          <button class="btn sm" id="apps-all" hidden>Close all</button>
        </div>
        <div class="app-list" id="apps"></div>
        <p class="faint small" id="apps-note" hidden>Closing works like clicking the app’s ✕. Save anything important first. If an app refuses, you’ll get a “Force close” button.</p>
      </div>
      <div class="footer-bar">
        <button class="btn ghost" id="back">← Back</button>
        <span class="spacer"></span>
        <button class="btn primary big" id="start">🔥 Start cooking</button>
      </div>
    </section>`, 'pick');

  $$('[data-mode]').forEach((b) => {
    b.onclick = () => {
      state.mode = b.dataset.mode;
      $$('[data-mode]').forEach((x) => x.classList.toggle('selected', x === b));
    };
  });
  $('#back').onclick = showPick;
  $('#start').onclick = startWithCleanKitchen;
  $('#apps-refresh').onclick = refreshApps;
  $('#apps-all').onclick = closeAllApps;
  renderApps();
  const wireAdmin = () => {
    const btn = $('#admin');
    if (btn)
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'Waiting for Windows…';
        const ok = await api.restartAsAdmin();
        if (!ok) {
          btn.disabled = false;
          btn.textContent = 'Restart as admin';
          toast('No worries. We’ll run without admin.');
        }
      };
  };
  wireAdmin();
  if (!state.sys) {
    await sysPromise;
    const slot = $('#admin-slot');
    if (slot && state.sys) {
      mount(slot, adminBanner(state.sys.isAdmin));
      wireAdmin();
    }
  }
}

// ---------------------------------------------------------------- Background apps ("clear the kitchen")
const memLabel = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

function renderApps() {
  const list = $('#apps');
  if (!list) return;
  const apps = state.busyApps;
  $('#apps-all').hidden = !apps?.length;
  $('#apps-note').hidden = !apps?.length;
  if (apps == null) return mount(list, html`<p class="muted small">👀 Checking what’s running…</p>`);
  if (!apps.length) return mount(list, html`<p class="app-clean">✅ Kitchen’s clean. Nothing heavy running in the background.</p>`);
  mount(list, html`${apps.map((a) => html`
    <div class="app-row ${a.kind === 'miner' ? 'miner' : ''}">
      <span class="emoji">${a.emoji}</span>
      <div style="flex:1;min-width:0">
        <div class="nm">${a.name}</div>
        <div class="faint small">${a.kind === 'miner' ? 'Mining crypto on this PC. Big red flag. ' : ''}Using ${a.cpuPct}% CPU · ${memLabel(a.memMB)} RAM${a.count > 1 ? ` · ${a.count} processes` : ''}</div>
      </div>
      <button class="btn sm ${a.force ? 'bad' : ''}" data-close="${a.id}">${a.force ? 'Force close' : 'Close'}</button>
    </div>`)}`);
  $$('[data-close]', list).forEach((b) => (b.onclick = () => closeOne(b.dataset.close)));
}

let appsScan = null;
function refreshApps() {
  state.busyApps = null;
  renderApps();
  appsScan = api
    .busyApps()
    .catch(() => [])
    .then((apps) => {
      apps.filter((a) => a.kind === 'miner').forEach((a) => state.minersSeen.add(a.name));
      state.busyApps = apps;
      renderApps();
    });
  return appsScan;
}
// Scan at launch so everything is ready by the time the user reaches the start screen.
// Background apps first (quick), then the full hardware scan.
refreshApps();
sysPromise = api.systemInfo().then((s) => (state.sys = s)).catch(() => null);

async function closeOne(id) {
  const a = state.busyApps?.find((x) => x.id === id);
  if (!a) return false;
  const btn = $(`[data-close="${id}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Closing…';
  }
  const res = await api.closeApp(id, !!a.force);
  if (res.ok) {
    state.busyApps = state.busyApps.filter((x) => x.id !== id);
    toast(`Closed ${a.name} 🧹`);
  } else {
    a.force = true;
    toast(`${a.name} didn’t want to close. Use “Force close” (unsaved work in it will be lost).`, 4500);
  }
  renderApps();
  return res.ok;
}

async function closeAllApps() {
  for (const a of [...(state.busyApps || [])]) if (!a.force) await closeOne(a.id);
}

// If apps are still open, offer to close them before cooking.
async function startWithCleanKitchen() {
  if (state.busyApps == null) {
    const btn = $('#start');
    btn.disabled = true;
    btn.textContent = '👀 Checking background apps…';
    await appsScan;
    if (!btn.isConnected) return;
    btn.disabled = false;
    btn.textContent = '🔥 Start cooking';
  }
  const open = state.busyApps || [];
  if (open.length) {
    const choice = await modal('Still stuff running in the background', (body, actions, close) => {
      body.innerHTML = String(html`<p>These are still open and will make the results less accurate:</p><p><b>${open.map((a) => a.name).join(', ')}</b></p>`);
      actions.innerHTML = '<button class="btn ghost">Start anyway</button><button class="btn primary">🧹 Close them &amp; start</button>';
      actions.children[0].onclick = () => close('anyway');
      actions.children[1].onclick = () => close('close');
    });
    if (!choice) return;
    if (choice === 'close') {
      await closeAllApps();
      if (state.busyApps?.length) return toast('Some apps didn’t close. Force-close them, or press Start again to go anyway.', 5000);
    }
  }
  state.bgAtStart = (state.busyApps || []).map((a) => a.name);
  runAll();
}

// ---------------------------------------------------------------- Running
const STEPS = [
  { id: 'scan', ico: '📋', label: 'Reading the menu', sub: 'Hardware scan', quips: QUIPS.scan, w: 8 },
  { id: 'cpu', ico: '🧂', label: 'Seasoning the CPU', sub: 'Processor speed', quips: QUIPS.cpu, w: 11 },
  { id: 'gpu', ico: '🍳', label: 'Grilling the graphics', sub: '3D test & FPS', quips: QUIPS.gpu, w: 14, wFull: 32 },
  { id: 'hz', ico: '🖥️', label: 'Timing the screen', sub: 'Refresh rate', quips: ['Counting how often the screen blinks…'], w: 2 },
  { id: 'ram', ico: '🍴', label: 'Poking the RAM', sub: 'Memory errors', quips: QUIPS.ram, w: 8, wFull: 16 },
  { id: 'disk', ico: '🥫', label: 'Raiding the pantry', sub: 'Storage speed', quips: QUIPS.disk, w: 7, wFull: 14 },
  { id: 'stress', ico: '🔥', label: 'The Oven Test', sub: 'Heat & stability', quips: QUIPS.stress, w: 47, wFull: 122 },
];

async function runAll() {
  const full = state.mode === 'full';
  state.results = {};
  state.cancelled = false;
  state.running = true;
  const weights = STEPS.map((s) => (full && s.wFull) || s.w);
  const totalW = weights.reduce((a, b) => a + b, 0);

  show(html`
    <section class="screen">
      <div class="row">
        <div>
          <div class="eyebrow">Step 2 · Cooking</div>
          <h1 class="title">In the oven…</h1>
        </div>
        <span class="spacer"></span>
        <button class="btn" id="stop">✋ Stop</button>
      </div>
      <div class="progress" style="margin-top:16px"><div id="overall"></div></div>
      <p class="muted small" style="margin-top:8px" id="overall-lbl">Starting…</p>
      <div class="run-layout">
        <ol class="run-list">
          ${STEPS.map((s) => html`<li class="run-item" data-step="${s.id}"><span class="ico">${s.ico}</span><span><div class="lbl">${s.label}</div><div class="sub">${s.sub}</div></span><span class="state"></span></li>`)}
        </ol>
        <div class="card stage">
          <div class="stage-head"><h2 id="stage-title"></h2><span class="muted small" id="stage-meta"></span></div>
          <p class="quip" id="quip"></p>
          <div class="progress"><div id="stage-bar"></div></div>
          <div class="stage-visual" id="visual"></div>
        </div>
      </div>
    </section>`, 'cook');

  $('#stop').onclick = async () => {
    state.cancelled = true;
    await api.cancel();
  };

  await api.startRun();
  let doneW = 0;
  let quipTimer;
  const setOverall = (stepFrac, i) => {
    const pct = ((doneW + weights[i] * Math.min(1, stepFrac)) / totalW) * 100;
    $('#overall').style.width = `${pct}%`;
    const secsLeft = Math.max(0, Math.round((totalW - doneW - weights[i] * stepFrac) * 1.05));
    $('#overall-lbl').textContent = `${Math.round(pct)}% cooked · about ${secsLeft > 90 ? `${Math.round(secsLeft / 60)} minutes` : `${secsLeft} seconds`} left`;
  };

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    if (state.cancelled) break;
    const li = $(`[data-step="${step.id}"]`);
    li.classList.add('active');
    $('#stage-title').textContent = `${step.ico} ${step.label}`;
    $('#stage-meta').textContent = step.sub;
    $('#stage-bar').style.width = '0%';
    const quip = $('#quip');
    quip.textContent = step.quips[0];
    clearInterval(quipTimer);
    quipTimer = setInterval(() => {
      quip.style.opacity = '0';
      setTimeout(() => {
        quip.textContent = pick(step.quips);
        quip.style.opacity = '1';
      }, 300);
    }, 4000);
    const progress = (f) => {
      $('#stage-bar').style.width = `${Math.min(100, f * 100)}%`;
      setOverall(f, i);
    };
    progress(0);
    try {
      await STEP_RUNNERS[step.id]({ full, progress, visual: $('#visual') });
    } catch (e) {
      console.error(e);
      toast(`${step.label} hit a snag. Skipping it.`);
    }
    li.classList.remove('active');
    li.classList.add('done');
    $('.state', li).textContent = state.cancelled ? '' : '✓ Done';
    doneW += weights[i];
  }
  clearInterval(quipTimer);
  state.running = false;
  await api.endRun();

  if (state.cancelled) {
    toast('Cooking stopped. Nothing was harmed.');
    return showMode();
  }
  showTaste();
}

const bigStat = (num, lbl) => html`<div class="big-stat"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`;

const STEP_RUNNERS = {
  async scan({ progress, visual }) {
    mount(visual, bigStat('🔎', 'Looking under the hood…'));
    let p = 0;
    const t = setInterval(() => progress((p = Math.min(0.95, p + 0.04))), 400);
    const [sys] = await Promise.all([sysPromise, sleep(1500)]);
    clearInterval(t);
    if (!sys) {
      sysPromise = api.systemInfo().then((s) => (state.sys = s));
      await sysPromise;
    }
    const s = state.sys;
    progress(1);
    mount(visual, html`
      <div style="padding:24px;width:100%">
        <table class="kv" style="font-size:15px">
          <tr><td>PC</td><td>${s.system.maker} ${s.system.model}</td></tr>
          <tr><td>Processor</td><td>${s.cpu.name}</td></tr>
          <tr><td>Graphics</td><td>${s.gpus.map((g) => g.name).join(' + ') || 'None'}</td></tr>
          <tr><td>RAM</td><td>${Math.round(s.ram.installedGB)} GB ${s.ram.type}</td></tr>
          <tr><td>Storage</td><td>${s.disks.filter((d) => !d.usb).map((d) => `${fmt.gb(d.sizeGB)} ${d.kind}`).join(' + ')}</td></tr>
          <tr><td>Windows</td><td>${s.windows.name}</td></tr>
        </table>
      </div>`);
    await sleep(1200);
  },

  async cpu({ progress, visual }) {
    mount(visual, bigStat('…', 'Single-core test'));
    const off = api.onProgress((p) => {
      if (p.test !== 'cpu') return;
      if (p.phase === 'multi') mount(visual, bigStat('…', 'All cores at once'));
    });
    const start = performance.now();
    const t = setInterval(() => progress((performance.now() - start) / 10800), 200);
    const r = await api.cpuBench();
    clearInterval(t);
    off();
    if (!r) return;
    state.results.cpu = r;
    progress(1);
    mount(visual, html`<div class="row" style="gap:60px">${bigStat(fmt.num(r.single), 'Single-core score')}${bigStat(fmt.num(r.multi), `All ${r.threads} threads`)}</div>`);
    await sleep(900);
  },

  async gpu({ full, progress, visual }) {
    mount(visual, html`<canvas class="gpu"></canvas><div class="hud"><span class="pill" id="fps">Warming up the pan…</span><span class="pill">1920×1080 · egg-frying benchmark</span></div>`);
    const seconds = full ? 30 : 12;
    const r = await runGpuBench($('canvas', visual), {
      seconds,
      isCancelled: () => state.cancelled,
      onUpdate: (u) => {
        $('#fps').textContent = `${Math.round(u.fps)} FPS`;
        progress(u.elapsed / u.total);
      },
    });
    if (!r) return;
    state.results.gpu = r;
    const temps = await api.gpuTemps();
    if (temps.length) state.results.gpuTemp = Math.max(...temps.map((t) => t.tempC));
    progress(1);
    if (r.error) mount(visual, bigStat('😬', r.error));
    else mount(visual, html`<div class="row" style="gap:60px">${bigStat(r.avgFps, 'Average FPS')}${bigStat(r.lowFps, '1% low FPS')}${state.results.gpuTemp != null ? bigStat(`${state.results.gpuTemp}°`, 'GPU temperature') : ''}</div>`);
    await sleep(900);
  },

  async hz({ progress, visual }) {
    mount(visual, bigStat('…', 'Hz'));
    progress(0.3);
    const hz = await measureRefreshRate(2000);
    state.results.measuredHz = hz;
    progress(1);
    mount(visual, bigStat(`${hz} Hz`, 'Measured on the screen this window is on'));
    await sleep(700);
  },

  async ram({ full, progress, visual }) {
    mount(visual, bigStat('0%', 'Writing patterns and checking them'));
    const off = api.onProgress((p) => {
      if (p.test !== 'ram') return;
      progress(p.pct);
      const n = $('.num', visual);
      if (n) n.textContent = `${Math.round(p.pct * 100)}%`;
    });
    const r = await api.ramTest(!full);
    off();
    if (!r) return;
    state.results.ram = r;
    progress(1);
    mount(visual, r.skipped ? bigStat('🤷', 'Not enough free memory to test safely') : bigStat(r.errors ? `${r.errors} ❌` : '0 errors ✅', `${fmt.gb(r.mb / 1024)} of RAM checked`));
    await sleep(900);
  },

  async disk({ full, progress, visual }) {
    mount(visual, bigStat('…', 'Writing a test file'));
    const off = api.onProgress((p) => p.test === 'disk' && progress(p.pct));
    const r = await api.diskTest(!full, !!state.sys?.isAdmin);
    off();
    if (!r) return;
    state.results.disk = r;
    progress(1);
    mount(visual, r.error ? bigStat('😬', `Couldn’t test the drive (${r.error})`) : html`<div class="row" style="gap:60px">${bigStat(`${fmt.num(r.writeMBs)}`, 'MB/s write')}${r.readMBs ? bigStat(fmt.num(r.readMBs), 'MB/s read') : ''}${bigStat(fmt.num(r.syncIops), 'small saves / sec')}</div>`);
    await sleep(900);
  },

  async stress({ full, progress, visual }) {
    const seconds = full ? 120 : 45;
    mount(visual, html`
      <div class="stress-grid">
        <div class="stat-row">
          <div class="stat"><div class="k">Time left</div><div class="v" id="s-left">${seconds}s</div></div>
          <div class="stat"><div class="k">CPU speed vs base</div><div class="v" id="s-perf">—</div></div>
          <div class="stat"><div class="k">CPU temperature</div><div class="v" id="s-temp">—</div></div>
          <div class="stat"><div class="k">Math errors</div><div class="v" id="s-err">0</div></div>
        </div>
        <svg class="chart" viewBox="0 0 600 200" preserveAspectRatio="none">
          <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a1a" stop-opacity=".45"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></linearGradient></defs>
          <path id="area" fill="url(#fill)" d=""/><polyline id="line" fill="none" stroke="#ff9a3c" stroke-width="3" points="" vector-effect="non-scaling-stroke"/>
        </svg>
      </div>`);
    const series = [];
    const off = api.onStressSample((s) => {
      series.push(s.throughput);
      progress(s.elapsed / s.total);
      $('#s-left').textContent = `${Math.max(0, s.total - s.elapsed)}s`;
      if (s.perfPct != null) {
        const el = $('#s-perf');
        el.textContent = `${s.perfPct}%`;
        el.style.color = s.perfPct < 80 ? 'var(--bad)' : s.perfPct < 97 ? 'var(--warn)' : 'var(--fresh)';
      }
      if (s.tempC != null) $('#s-temp').textContent = `${Math.round(s.tempC)}°C`;
      $('#s-err').textContent = String(s.errors);
      if (s.errors) $('#s-err').style.color = 'var(--bad)';
      const max = Math.max(...series) * 1.15 || 1;
      const pts = series.map((v, i) => `${(i / Math.max(1, s.total - 1)) * 600},${200 - (v / max) * 190}`);
      $('#line').setAttribute('points', pts.join(' '));
      $('#area').setAttribute('d', pts.length ? `M0,200 L${pts.join(' L')} L${((series.length - 1) / Math.max(1, s.total - 1)) * 600},200 Z` : '');
    });
    const r = await api.stressTest(seconds, !!state.sys?.isAdmin);
    off();
    if (!r) return;
    state.results.stress = r;
    progress(1);
  },
};

// ---------------------------------------------------------------- Taste test (hands-on)
function showTaste() {
  const full = state.mode === 'full';
  if (!state.sniff) state.sniff = sniffItems(state.sys.system.isLaptop);
  const resultLabel = { pass: '✓ Works', fail: '✗ Problem', skip: 'Skipped' };

  show(html`
    <section class="screen">
      <div class="eyebrow">Step 3 · Taste test</div>
      <h1 class="title">${full ? 'Now the hands-on part' : 'Want to taste-test it yourself?'}</h1>
      <p class="subtitle">${full
        ? 'Software can’t feel a sticky key or see a dead pixel. These take about 30 seconds each. Skip anything that doesn’t apply.'
        : 'The automatic tests are done. These quick hands-on checks catch the stuff software can’t see. Totally optional.'}</p>

      <div class="grid cols-3 section">
        ${HANDS_ON.map((t) => html`
          <div class="card test-card">
            <div class="top"><span class="emoji">${t.emoji}</span><span class="name">${t.name}</span>
              <span class="result ${state.handsOn[t.id]?.result || ''}">${resultLabel[state.handsOn[t.id]?.result] || 'Not done'}</span></div>
            <p>${t.desc}</p>
            <button class="btn sm" data-test="${t.id}">${state.handsOn[t.id] ? 'Redo' : 'Start'}</button>
          </div>`)}
      </div>

      <div class="section">
        <h2 class="section-title">👃 The sniff test <span class="muted small" style="font-weight:500">Use your eyes, ears and nose</span></h2>
        <div class="check-list">
          ${state.sniff.map((it) => html`
            <div class="check-row" data-sniff="${it.id}">
              <div><div class="q">${it.q}</div><div class="h">${it.h}</div></div>
              <div class="seg">
                <button data-a="good" class="${it.answer === 'good' ? 'sel-good' : ''}">Yes 👍</button>
                <button data-a="bad" class="${it.answer === 'bad' ? 'sel-bad' : ''}">No 👎</button>
                <button data-a="skip" class="${it.answer === 'skip' ? 'sel-skip' : ''}">Not sure</button>
              </div>
            </div>`)}
        </div>
      </div>

      <div class="footer-bar">
        <span class="spacer"></span>
        <button class="btn primary big" id="verdict">🍽️ ${full ? 'Serve the verdict' : Object.keys(state.handsOn).length || state.sniff.some((i) => i.answer) ? 'Serve the verdict' : 'Skip to the verdict'}</button>
      </div>
    </section>`, 'taste');

  $$('[data-test]').forEach((b) => {
    b.onclick = async () => {
      const test = HANDS_ON.find((t) => t.id === b.dataset.test);
      const res = await test.run();
      if (res) state.handsOn[test.id] = res;
      const y = app.scrollTop;
      showTaste();
      app.scrollTop = y;
    };
  });
  $$('[data-sniff]').forEach((row) => {
    const item = state.sniff.find((i) => i.id === row.dataset.sniff);
    $$('button', row).forEach((b) => {
      b.onclick = () => {
        item.answer = b.dataset.a;
        $$('button', row).forEach((x) => (x.className = x === b ? `sel-${b.dataset.a}` : ''));
      };
    });
  });
  $('#verdict').onclick = showVerdict;
}

// ---------------------------------------------------------------- Verdict
function showVerdict() {
  const input = {
    sys: state.sys,
    ...state.results,
    handsOn: state.handsOn,
    sniff: state.sniff,
    claims: state.claims,
    purposes: [...state.purposes],
    mode: state.mode,
    bgAtStart: state.bgAtStart,
    miners: [...state.minersSeen],
  };
  const a = analyze(input);
  show(renderResults(a, input), 'verdict');
  animateResults(app, a.score);

  $('#save-report').onclick = async () => {
    const name = `is-it-cooked-${(state.sys.system.model || 'pc').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.html`;
    const path = await api.saveReport(buildReport(a, input), name);
    if (path) toast('Report saved and opened. Show it to the seller 😏');
  };
  $('#again').onclick = () => {
    state.handsOn = {};
    state.sniff = null;
    refreshApps();
    sysPromise = api.systemInfo().then((s) => (state.sys = s)).catch(() => null);
    showPick();
  };
  $$('[data-settings]').forEach((b) => (b.onclick = () => api.openSettings(b.dataset.settings)));
}

showWelcome();

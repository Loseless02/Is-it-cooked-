import { html, raw, esc } from './ui.js';
import { FIT, SEVERITY_ICON, COST, DONENESS } from './copy.js';
import { PURPOSES } from './profiles.js';
import { fpsEstimates } from './gpuTiers.js';

const STATUS_BADGE = {
  good: '<span class="badge great">Fresh</span>',
  warn: '<span class="badge meh">Toasty</span>',
  bad: '<span class="badge no">Cooked</span>',
  unknown: '<span class="badge">Not tested</span>',
};

export function renderResults(a, s) {
  const d = a.doneness;
  const circ = 2 * Math.PI * 88;
  const problems = a.findings.filter((f) => f.sev === 'critical' || f.sev === 'warn');
  const tips = a.findings.filter((f) => f.sev === 'info');
  const goods = a.findings.filter((f) => f.sev === 'good');
  const gaming = (s.purposes || []).some((p) => ['esports', 'aaa', 'streaming'].includes(p));
  const haggle = problems.filter((f) => f.cost && f.cost !== 'none');

  return html`
  <section class="screen">
    <div class="verdict" style="--verdict-glow:${d.color}33">
      <div class="score-ring">
        <svg viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="88" fill="none" stroke="var(--surface-3)" stroke-width="16"/>
          <circle id="ring" cx="100" cy="100" r="88" fill="none" stroke="${d.color}" stroke-width="16" stroke-linecap="round"
            stroke-dasharray="${circ}" stroke-dashoffset="${circ}" data-target="${circ * (1 - a.score / 100)}" style="transition: stroke-dashoffset 1.4s cubic-bezier(.2,.8,.2,1)"/>
        </svg>
        <div class="inner"><div><div class="n" id="score-n">0</div><div class="l">Freshness</div></div></div>
      </div>
      <div>
        <div class="eyebrow">Is it cooked?</div>
        <h1 class="headline">${d.headline}</h1>
        <p class="sub">${d.sub}</p>
        <div class="doneness">
          <div class="bar"><div class="marker" id="marker" style="left:0%" data-target="${100 - a.score}"></div></div>
          <div class="labels">${raw(DONENESS.map((x) => `<span class="${x === d ? 'cur' : ''}">${esc(x.label)}</span>`).join(''))}</div>
        </div>
        <div class="row" style="margin-top:22px">
          <button class="btn primary" id="save-report">📄 Save report</button>
          <button class="btn" id="again">🔁 Test again</button>
          <span class="muted small">${problems.length ? `${problems.length} thing${problems.length > 1 ? 's' : ''} to look at` : 'No problems found'} · ${s.mode === 'full' ? 'Full inspection' : 'Quick taste'}</span>
        </div>
      </div>
    </div>

    ${a.purposes.length ? html`
    <div class="section">
      <h2 class="section-title">🍽️ Is it good for what you need?</h2>
      <div class="grid cols-2">
        ${a.purposes.map((p) => {
          const meta = PURPOSES.find((x) => x.id === p.id);
          const fit = FIT[p.verdict];
          return html`
          <div class="card purpose-card">
            <div class="head"><span class="emoji">${meta.emoji}</span><span class="name">${meta.name}</span><span class="badge ${fit.cls}">${fit.emoji} ${fit.label}</span></div>
            <p class="muted small">${fit.line}</p>
            <ul class="reqs">
              ${p.checks.map((c) => html`<li><span class="dot ${c.status}"></span><span class="k">${c.label}</span><span>${c.note} <span class="faint">(${c.value ?? '—'})</span></span></li>`)}
            </ul>
          </div>`;
        })}
      </div>
    </div>` : ''}

    ${gaming && a.m.gpuScore ? html`
    <div class="section">
      <h2 class="section-title">🎮 How games should run</h2>
      <div class="card">
        <table class="fps-table">
          <thead><tr><th>Type of game</th><th>Resolution</th><th>Expect about</th></tr></thead>
          <tbody>
            ${fpsEstimates(a.m.gpuScore, a.m.cpuSingle).map((r) => html`<tr><td><b>${r.game}</b><div class="faint small">${r.examples}</div></td><td>${r.res}</td><td class="v"><span class="dot ${r.level}" style="display:inline-block;margin-right:8px"></span>${r.text}${r.note ? html`<div class="faint small" style="font-weight:400">${r.note}</div>` : ''}</td></tr>`)}
          </tbody>
        </table>
        <p class="faint small" style="margin-top:10px">Ballpark estimates based on the ${a.m.gpuName}${a.m.isLaptop && a.m.gpu?.discrete ? ' (laptop version)' : ''}. Real numbers depend on the game, settings and drivers.</p>
      </div>
    </div>` : ''}

    <div class="section">
      <h2 class="section-title">${problems.length ? '🚩 Red flags & problems' : '✅ No red flags'}</h2>
      ${problems.length ? html`<div class="grid" style="gap:10px">${problems.map(findingCard)}</div>` : html`<p class="muted">Nothing worrying came up. Nice.</p>`}
    </div>

    ${tips.length ? html`
    <div class="section">
      <h2 class="section-title">💡 Good to know</h2>
      <div class="grid" style="gap:10px">${tips.map(findingCard)}</div>
    </div>` : ''}

    <div class="section">
      <h2 class="section-title">🔍 Part by part</h2>
      <div class="grid cols-3">
        ${a.components.map((c) => html`
          <div class="card comp">
            <div class="head"><span class="emoji">${c.emoji}</span><span class="name">${c.name}</span><span class="status">${raw(STATUS_BADGE[c.status])}</span></div>
            <div class="main">${c.main}</div>
            <div class="plain">${c.plain}</div>
            ${c.details.length ? html`<details><summary>Nerd details</summary><table class="kv">${c.details.map(([k, v]) => html`<tr><td>${k}</td><td>${v}</td></tr>`)}</table></details>` : ''}
          </div>`)}
      </div>
    </div>

    ${haggle.length ? html`
    <div class="section">
      <h2 class="section-title">💸 Haggle ammo</h2>
      <div class="card">
        <p class="muted" style="margin-bottom:12px">Every problem is a reason to ask for a lower price. Here’s what you can bring up:</p>
        <ul class="ask-list">${haggle.map((f) => html`<li>${f.title} <span class="faint small">· ${COST[f.cost]}</span></li>`)}</ul>
      </div>
    </div>` : ''}

    <div class="section">
      <h2 class="section-title">🗣️ Questions to ask the seller</h2>
      <div class="card"><ol class="ask-list">${a.questions.map((q) => html`<li>${q}</li>`)}</ol></div>
    </div>

    ${goods.length ? html`
    <div class="section">
      <h2 class="section-title">👌 What’s good</h2>
      <div class="grid" style="gap:10px">${goods.map(findingCard)}</div>
    </div>` : ''}

    <p class="faint small" style="margin-top:36px">Is It Cooked? is a quick health check, not a lab. It can’t see everything (like a fan that’s about to die or a crack under a sticker), so use your eyes too. Tested ${new Date().toLocaleString()}.</p>
  </section>`;
}

function findingCard(f) {
  return html`
    <div class="finding ${f.sev}">
      <div class="sev">${SEVERITY_ICON[f.sev]}</div>
      <div>
        <div class="t">${f.title}</div>
        ${f.detail ? html`<div class="d">${f.detail}</div>` : ''}
        ${f.fix || f.action ? html`<div class="fix">🔧 ${f.fix || ''}${f.action ? html`<button class="btn sm" data-settings="${f.action.uri}">${f.action.label}</button>` : ''}</div>` : ''}
        ${f.cost && f.sev !== 'good' ? html`<div class="cost">${COST[f.cost]}</div>` : ''}
      </div>
    </div>`;
}

export function animateResults(root, score) {
  requestAnimationFrame(() => {
    const ring = root.querySelector('#ring');
    const marker = root.querySelector('#marker');
    if (ring) ring.style.strokeDashoffset = ring.dataset.target;
    if (marker) marker.style.left = `${marker.dataset.target}%`;
    const n = root.querySelector('#score-n');
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - start) / 1300);
      n.textContent = Math.round(score * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ---------- Standalone report file ----------
export function buildReport(a, s) {
  const sys = s.sys;
  const d = a.doneness;
  const e = esc;
  const sevColor = { critical: '#d9412f', warn: '#c98a00', info: '#8a6d52', good: '#2f9e5f' };
  const findings = a.findings
    .map((f) => `<div class="f" style="border-left:4px solid ${sevColor[f.sev]}"><b>${SEVERITY_ICON[f.sev]} ${e(f.title)}</b>${f.detail ? `<div>${e(f.detail)}</div>` : ''}${f.fix ? `<div class="fx">Fix: ${e(f.fix)}</div>` : ''}</div>`)
    .join('');
  const purposes = a.purposes
    .map((p) => {
      const meta = PURPOSES.find((x) => x.id === p.id);
      const fit = FIT[p.verdict];
      return `<tr><td>${meta.emoji} ${e(meta.name)}</td><td><b>${fit.emoji} ${e(fit.label)}</b></td><td>${p.checks.map((c) => `${e(c.label)}: ${e(c.value ?? '—')}`).join(' · ')}</td></tr>`;
    })
    .join('');
  const comps = a.components
    .map((c) => `<h3>${c.emoji} ${e(c.name)}: ${e(c.main)}</h3><p>${e(c.plain)}</p><table>${c.details.map(([k, v]) => `<tr><td>${e(k)}</td><td>${e(v)}</td></tr>`).join('')}</table>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Is It Cooked? report: ${e(sys.system.maker)} ${e(sys.system.model)}</title>
<style>
body{font-family:'Segoe UI',system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#2a1d14;background:#fffaf5;line-height:1.5}
h1{font-size:40px;margin:0}h2{margin-top:36px;border-bottom:2px solid #f0dfcf;padding-bottom:6px}h3{margin:22px 0 4px}
.hero{display:flex;gap:28px;align-items:center;padding:24px;border-radius:18px;background:#fff;border:1px solid #f0dfcf}
.score{font-size:64px;font-weight:900;color:${d.color};min-width:120px;text-align:center}.score small{display:block;font-size:12px;color:#8a6d52;font-weight:700;letter-spacing:.08em}
.f{background:#fff;padding:12px 14px;margin:8px 0;border-radius:8px}.f div{color:#6b5444;font-size:14px}.fx{color:#b85c00!important}
table{border-collapse:collapse;width:100%;font-size:14px}td{padding:6px 8px;border-bottom:1px solid #f0dfcf;vertical-align:top}
.muted{color:#8a6d52}
</style></head><body>
<div class="hero"><div class="score">${a.score}<small>FRESHNESS</small></div><div><div class="muted">Is it cooked?</div><h1>${e(d.headline)}</h1><div>${e(d.sub)}</div>
<div class="muted" style="margin-top:8px">${e(sys.system.maker)} ${e(sys.system.model)} · ${e(sys.cpu.name)} · ${e(sys.gpus.map((g) => g.name).join(' + '))} · ${e(Math.round(sys.ram.installedGB))} GB RAM</div></div></div>
${purposes ? `<h2>Good for what you need?</h2><table>${purposes}</table>` : ''}
<h2>Findings</h2>${findings || '<p>No findings.</p>'}
<h2>Questions to ask the seller</h2><ol>${a.questions.map((q) => `<li>${e(q)}</li>`).join('')}</ol>
<h2>Part by part</h2>${comps}
<p class="muted" style="margin-top:40px">Generated by Is It Cooked? on ${e(new Date().toLocaleString())} · ${s.mode === 'full' ? 'Full inspection' : 'Quick taste'}.</p>
</body></html>`;
}

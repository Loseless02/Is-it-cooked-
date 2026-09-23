// Hands-on "taste tests": things only a human can confirm (screen, keys, sound, camera, ports).
import { html, raw, modal, $, $$, esc, sleep } from './ui.js';

export const HANDS_ON = [
  { id: 'pixels', emoji: '🟥', name: 'Dead pixels', desc: 'Fills the screen with solid colors so broken pixels stand out.', run: pixelTest },
  { id: 'keyboard', emoji: '⌨️', name: 'Keyboard', desc: 'Press every key. They light up when they work.', run: keyboardTest },
  { id: 'touchpad', emoji: '🖱️', name: 'Touchpad / mouse', desc: 'Left click, right click and scroll.', run: touchpadTest },
  { id: 'speakers', emoji: '🔊', name: 'Speakers', desc: 'Left, right, and a bass sweep to catch rattles.', run: speakerTest },
  { id: 'mic', emoji: '🎙️', name: 'Microphone', desc: 'Say something and watch the meter jump.', run: micTest },
  { id: 'webcam', emoji: '📷', name: 'Webcam', desc: 'Say cheese. Checks the camera works.', run: webcamTest },
  { id: 'usb', emoji: '🔌', name: 'USB ports', desc: 'Plug a USB stick or mouse into each port. We’ll call roll.', run: usbTest },
];

// Things software can't see. You check them with your eyes, ears and nose.
export function sniffItems(isLaptop) {
  const all = [
    { id: 'smell', short: 'Smell', q: 'No burnt smell (especially near the vents or power supply)?', h: 'Sniff near the vents while it’s running.', critical: true, penalty: 20, badTitle: 'It smells burnt', badDetail: 'Something inside has literally been cooked. A burnt smell means a component overheated or fried. Walk away.', cost: 'pricey', ask: 'Has anything ever overheated or shut off by itself?' },
    { id: 'battery', laptop: true, short: 'Battery swelling', q: 'Laptop sits flat, lid closes evenly, touchpad isn’t pushed up?', h: 'A raised touchpad or bent case means a swollen battery.', critical: true, penalty: 25, badTitle: 'Possibly swollen battery', badDetail: 'A swollen battery is a fire risk. Don’t buy unless the battery gets replaced first.', cost: 'mid' },
    { id: 'lock', short: 'No locks', q: 'No unknown BIOS password and not “managed by an organization”?', h: 'Check Settings → Accounts, and try entering the BIOS at boot.', critical: true, penalty: 20, badTitle: 'Locked to someone else', badDetail: 'A BIOS password or a company/school management lock can make the PC impossible to fully reset. Could also mean it isn’t the seller’s to sell.', cost: 'none', ask: 'Can you remove the BIOS password / company account in front of me?' },
    { id: 'fans', short: 'Fan noise', q: 'During the Oven test, fans spun up smoothly: no grinding, clicking or rattling?', h: 'Listen closely while the stress test runs.', penalty: 8, badTitle: 'Fans make bad noises', badDetail: 'Grinding or rattling means a fan bearing is wearing out.', cost: 'cheap' },
    { id: 'case', short: 'Case condition', q: 'No cracks, big dents, or missing / chewed-up screws?', h: 'Stripped screws = someone’s been inside. Ask why.', penalty: 4, badTitle: 'Case is damaged or has been opened roughly', badDetail: 'Physical damage or mangled screws suggest drops or amateur repairs.', cost: 'none', ask: 'Has it been dropped or repaired?' },
    { id: 'hinges', laptop: true, short: 'Hinges', q: 'Hinges feel firm and the screen doesn’t wobble or creak?', h: 'Open and close the lid a few times.', penalty: 6, badTitle: 'Loose or cracked hinges', badDetail: 'Hinges usually get worse over time and can crack the case.', cost: 'mid' },
    { id: 'screen', short: 'Screen surface', q: 'Screen free of scratches, pressure marks, or yellow/bright patches?', h: 'Look at it from an angle on a white and a black background.', penalty: 5, badTitle: 'Screen has marks or blotches', badDetail: 'Cosmetic or backlight damage. Won’t go away.', cost: 'pricey' },
    { id: 'ports', short: 'Ports', q: 'Ports aren’t loose, bent, or burnt-looking?', h: 'Wiggle the charger and a USB cable gently.', penalty: 5, badTitle: 'Damaged or loose ports', badDetail: 'Loose charging ports especially can cut power randomly.', cost: 'mid' },
    { id: 'dust', short: 'Dust', q: 'Vents and fans reasonably clean?', h: 'Shine a phone flashlight into the vents.', penalty: 3, badTitle: 'Dusty inside', badDetail: 'Dust makes it run hot. Easy to clean, but it tells you how it was treated.', cost: 'free' },
    { id: 'charger', short: 'Charger/cables', q: 'Comes with its original charger / power cable?', h: 'Cheap no-name chargers can be dangerous.', penalty: 3, badTitle: 'No original charger', badDetail: 'You’ll need to buy a proper one.', cost: 'cheap' },
    { id: 'serial', short: 'Serial sticker', q: 'Serial number sticker is there and matches the model?', h: 'Usually underneath or inside the battery bay / side panel.', penalty: 5, badTitle: 'Serial sticker missing or doesn’t match', badDetail: 'Could mean a replaced case or parts, or a PC with a shady history.', cost: 'none', ask: 'Can you show proof of purchase?' },
  ];
  return all.filter((i) => isLaptop || !i.laptop).map((i) => ({ ...i, answer: null }));
}

const resultButtons = (actions, close, { pass = 'It works', fail = 'Something’s wrong', onFail } = {}) => {
  actions.innerHTML = '';
  const mk = (label, cls, value) => {
    const b = document.createElement('button');
    b.className = `btn ${cls}`;
    b.textContent = label;
    b.onclick = () => close(value());
    actions.appendChild(b);
    return b;
  };
  mk('Skip', 'ghost', () => ({ result: 'skip' }));
  mk(fail, 'bad', () => ({ result: 'fail', note: onFail?.() }));
  mk(pass, 'good', () => ({ result: 'pass' }));
};

// ---------- Dead pixels ----------
async function pixelTest() {
  const go = await modal('Dead pixel check', (body, actions, close) => {
    body.innerHTML = String(html`
      <p>The screen will fill with one solid color at a time. Look closely for tiny dots that don’t match: a <b>black dot</b> on a bright color, or a <b>colored dot</b> on black.</p>
      <p class="muted">Click, press <b>Space</b> or <b>→</b> for the next color. <b>Esc</b> to stop. On the black screen, also check the edges for glowing patches (backlight bleed).</p>`);
    actions.innerHTML = '<button class="btn ghost">Skip</button><button class="btn primary">Start</button>';
    actions.children[0].onclick = () => close(false);
    actions.children[1].onclick = () => close(true);
  });
  if (!go) return { result: 'skip' };

  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#808080'];
  await window.iic.setFullscreen(true);
  await sleep(250);
  await new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'pixel-screen';
    const hint = document.createElement('div');
    hint.className = 'pixel-hint';
    let i = 0;
    const paint = () => {
      el.style.background = colors[i];
      hint.textContent = `Color ${i + 1} of ${colors.length} · click / Space for next · Esc to stop`;
      hint.style.opacity = '1';
      setTimeout(() => (hint.style.opacity = '0'), 1500);
    };
    const finish = () => {
      document.removeEventListener('keydown', onKey, true);
      el.remove();
      hint.remove();
      resolve();
    };
    const next = () => (++i >= colors.length ? finish() : paint());
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') finish();
      else if ([' ', 'ArrowRight', 'Enter'].includes(e.key)) next();
      else if (e.key === 'ArrowLeft' && i > 0) { i--; paint(); }
    };
    el.addEventListener('click', next);
    document.addEventListener('keydown', onKey, true);
    document.body.append(el, hint);
    paint();
  });
  await window.iic.setFullscreen(false);

  return modal('So… any dead pixels?', (body, actions, close) => {
    body.innerHTML = '<p>Did you spot any dots that stayed the wrong color, or glowing patches on the black screen?</p>';
    resultButtons(actions, close, { pass: 'Screen looks perfect', fail: 'I saw some' });
  });
}

// ---------- Keyboard ----------
const KB = [
  [['Escape', 'Esc'], ['F1'], ['F2'], ['F3'], ['F4'], ['F5'], ['F6'], ['F7'], ['F8'], ['F9'], ['F10'], ['F11'], ['F12'], ['Delete', 'Del']],
  [['Backquote', '`'], ['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'], ['Digit4', '4'], ['Digit5', '5'], ['Digit6', '6'], ['Digit7', '7'], ['Digit8', '8'], ['Digit9', '9'], ['Digit0', '0'], ['Minus', '-'], ['Equal', '='], ['Backspace', '⌫ Back', 2]],
  [['Tab', 'Tab', 1.5], ['KeyQ', 'Q'], ['KeyW', 'W'], ['KeyE', 'E'], ['KeyR', 'R'], ['KeyT', 'T'], ['KeyY', 'Y'], ['KeyU', 'U'], ['KeyI', 'I'], ['KeyO', 'O'], ['KeyP', 'P'], ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\', 1.5]],
  [['CapsLock', 'Caps', 1.8], ['KeyA', 'A'], ['KeyS', 'S'], ['KeyD', 'D'], ['KeyF', 'F'], ['KeyG', 'G'], ['KeyH', 'H'], ['KeyJ', 'J'], ['KeyK', 'K'], ['KeyL', 'L'], ['Semicolon', ';'], ['Quote', "'"], ['Enter', 'Enter', 2.2]],
  [['ShiftLeft', 'Shift', 2.3], ['IntlBackslash', '<'], ['KeyZ', 'Z'], ['KeyX', 'X'], ['KeyC', 'C'], ['KeyV', 'V'], ['KeyB', 'B'], ['KeyN', 'N'], ['KeyM', 'M'], ['Comma', ','], ['Period', '.'], ['Slash', '/'], ['ShiftRight', 'Shift', 2.5]],
  [['ControlLeft', 'Ctrl', 1.4], ['AltLeft', 'Alt', 1.2], ['Space', 'Space', 6], ['AltRight', 'Alt Gr', 1.2], ['ControlRight', 'Ctrl', 1.4], ['ArrowLeft', '←'], ['ArrowUp', '↑'], ['ArrowDown', '↓'], ['ArrowRight', '→']],
];
// Keys that not every keyboard has; they don't count against the total.
const OPTIONAL_KEYS = new Set(['IntlBackslash', 'ControlRight', 'Delete', 'F11', 'F12']);

function keyboardTest() {
  return modal('Keyboard check', (body, actions, close, back) => {
    back.dataset.trapEscape = '1';
    const all = KB.flat().map((k) => k[0]);
    const required = all.filter((c) => !OPTIONAL_KEYS.has(c));
    const hit = new Set();
    body.innerHTML = String(html`
      <p>Press every key once. Each one turns green when it works. <span class="muted">Laptop F-keys may need the <b>Fn</b> key held down. The Windows key can’t be tested here (Windows grabs it).</span></p>
      <div class="kb">${raw(KB.map((row) => `<div class="kb-row">${row.map(([code, label, w]) => `<div class="kb-key" data-code="${code}" style="flex-grow:${w || 1}">${esc(label || code)}</div>`).join('')}</div>`).join(''))}</div>
      <p class="muted small" id="kb-count"></p>`);
    const count = $('#kb-count', body);
    const update = () => {
      const n = required.filter((c) => hit.has(c)).length;
      count.textContent = `${n} of ${required.length} keys tested${n === required.length ? ' 🎉 Every key works!' : ''}`;
    };
    update();
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = $(`[data-code="${e.code}"]`, body);
      if (!el) return;
      hit.add(e.code);
      el.classList.add('hit', 'now');
      setTimeout(() => el.classList.remove('now'), 150);
      update();
    };
    const onUp = (e) => {
      // PrintScreen and some others only fire keyup.
      if (!hit.has(e.code) && $(`[data-code="${e.code}"]`, body)) onKey(e);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onUp, true);
    resultButtons(actions, close, {
      pass: 'All keys work',
      fail: 'Some keys are dead',
      onFail: () => {
        const missing = required.filter((c) => !hit.has(c)).map((c) => $(`[data-code="${c}"]`, body).textContent);
        return missing.length ? `Didn’t respond: ${missing.slice(0, 20).join(', ')}.` : '';
      },
    });
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onUp, true);
    };
  });
}

// ---------- Touchpad ----------
function touchpadTest() {
  return modal('Touchpad / mouse check', (body, actions, close) => {
    body.innerHTML = String(html`
      <p>Inside the box: <b>left click</b>, <b>right click</b>, and <b>scroll</b> (two-finger swipe on a touchpad).</p>
      <div class="click-pad" id="pad">Click, right-click and scroll here</div>
      <div class="flags"><span class="flag" data-f="left">Left click</span><span class="flag" data-f="right">Right click</span><span class="flag" data-f="scroll">Scroll</span><span class="flag" data-f="double">Double click</span></div>`);
    const pad = $('#pad', body);
    const on = (f) => $(`[data-f="${f}"]`, body).classList.add('on');
    pad.addEventListener('mousedown', (e) => on(e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'left'));
    pad.addEventListener('contextmenu', (e) => { e.preventDefault(); on('right'); });
    pad.addEventListener('wheel', (e) => { e.preventDefault(); on('scroll'); }, { passive: false });
    pad.addEventListener('dblclick', () => on('double'));
    resultButtons(actions, close, { pass: 'All good', fail: 'Something didn’t work' });
  });
}

// ---------- Speakers ----------
function speakerTest() {
  return modal('Speaker check', (body, actions, close) => {
    const ctx = new AudioContext();
    body.innerHTML = String(html`
      <p>Turn the volume up to about half. Play each sound and listen for crackling, buzzing, or one side missing.</p>
      <div class="row">
        <button class="btn" data-p="left">◀ Left speaker</button>
        <button class="btn" data-p="right">Right speaker ▶</button>
        <button class="btn" data-p="sweep">🎵 Bass → treble sweep</button>
      </div>
      <p class="muted small">The sweep goes from deep bass to high pitch. A rattle or buzz in the low part means a blown or loose speaker.</p>`);
    const play = (kind) => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      osc.connect(gain).connect(pan).connect(ctx.destination);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.35, now + 0.05);
      if (kind === 'sweep') {
        osc.frequency.setValueAtTime(50, now);
        osc.frequency.exponentialRampToValueAtTime(9000, now + 4);
        gain.gain.setValueAtTime(0.35, now + 3.9);
        gain.gain.linearRampToValueAtTime(0, now + 4);
        osc.start(now);
        osc.stop(now + 4.05);
      } else {
        pan.pan.value = kind === 'left' ? -1 : 1;
        osc.frequency.value = kind === 'left' ? 440 : 660;
        gain.gain.setValueAtTime(0.35, now + 1.1);
        gain.gain.linearRampToValueAtTime(0, now + 1.2);
        osc.start(now);
        osc.stop(now + 1.25);
      }
    };
    $$('[data-p]', body).forEach((b) => (b.onclick = () => play(b.dataset.p)));
    resultButtons(actions, close, { pass: 'Sounds good', fail: 'Something sounds off' });
    return () => ctx.close();
  });
}

// ---------- Microphone ----------
function micTest() {
  return modal('Microphone check', (body, actions, close) => {
    body.innerHTML = String(html`
      <p>Say something like “is it cooked?” out loud. The bar should jump.</p>
      <div class="meter"><div id="lvl"></div></div>
      <p class="muted" id="mic-msg">Asking for microphone access…</p>`);
    let stream, ctx, raf;
    const lvl = $('#lvl', body);
    const msg = $('#mic-msg', body);
    let peak = 0;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((s) => {
        stream = s;
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        ctx.createMediaStreamSource(s).connect(an);
        const data = new Float32Array(an.fftSize);
        msg.textContent = `Listening on: ${s.getAudioTracks()[0]?.label || 'default microphone'}`;
        const loop = () => {
          an.getFloatTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += v * v;
          const rms = Math.sqrt(sum / data.length);
          const pct = Math.min(100, rms * 400);
          lvl.style.width = `${pct}%`;
          if (pct > 25 && peak <= 25) msg.textContent = '🎉 Heard you loud and clear!';
          peak = Math.max(peak, pct);
          raf = requestAnimationFrame(loop);
        };
        loop();
      })
      .catch(() => (msg.textContent = '❌ No microphone found, or access was blocked.'));
    resultButtons(actions, close, { pass: 'Mic works', fail: 'Mic doesn’t work' });
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
    };
  });
}

// ---------- Webcam ----------
function webcamTest() {
  return modal('Webcam check', (body, actions, close) => {
    body.innerHTML = '<video class="cam" autoplay playsinline muted></video><p class="muted" id="cam-msg">Turning on the camera… (nothing is recorded or saved)</p>';
    let stream;
    const v = $('video', body);
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((s) => {
        stream = s;
        v.srcObject = s;
        $('#cam-msg', body).textContent = `Camera: ${s.getVideoTracks()[0]?.label || 'default'}. Can you see yourself clearly?`;
      })
      .catch(() => ($('#cam-msg', body).textContent = '❌ No camera found, or it’s blocked (check for a privacy shutter or an F-key camera toggle).'));
    resultButtons(actions, close, { pass: 'I can see myself', fail: 'No picture' });
    return () => stream?.getTracks().forEach((t) => t.stop());
  });
}

// ---------- USB ----------
function usbTest() {
  return modal('USB port roll call', (body, actions, close) => {
    body.innerHTML = String(html`
      <p>Grab a USB stick or mouse. Plug it into <b>each port, one at a time</b>. Every time a port works, it shows up here.</p>
      <div class="usb-log" id="log"><p class="muted" id="wait">Waiting for you to plug something in…</p></div>
      <p class="muted small" id="usb-count"></p>`);
    let known = null;
    let hits = 0;
    let stopped = false;
    const log = $('#log', body);
    const poll = async () => {
      while (!stopped) {
        const list = await window.iic.usbDevices();
        const ids = new Set(list.map((d) => d.id));
        if (known) {
          for (const d of list) {
            if (!known.has(d.id)) {
              hits++;
              $('#wait', body)?.remove();
              const ev = document.createElement('div');
              ev.className = 'ev';
              ev.textContent = `✅ Port #${hits} works: detected “${d.name}”`;
              log.prepend(ev);
              $('#usb-count', body).textContent = `${hits} port${hits > 1 ? 's' : ''} confirmed. Unplug and move to the next one.`;
            }
          }
        }
        known = ids;
        await sleep(1200);
      }
    };
    poll();
    resultButtons(actions, close, { pass: 'Every port worked', fail: 'A port didn’t work' });
    return () => (stopped = true);
  });
}

// GPU test: renders a ray-marched frying pan with three eggs at 1920x1080 as fast as the GPU
// can go (no vsync cap: every frame is forced to finish with a 1-pixel readback).

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
out vec4 outColor;

float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float sdCyl(vec3 p, float h, float r) { vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float sdEll(vec3 p, vec3 r) { float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }

vec2 egg(vec3 p, float seed) {
  float w = sdEll(p, vec3(0.62, 0.06, 0.55));
  for (int i = 0; i < 4; i++) {
    float a = float(i) * 1.57 + seed;
    vec3 c = vec3(cos(a) * 0.4, 0.0, sin(a) * 0.36);
    w = smin(w, sdEll(p - c, vec3(0.34, 0.05 + 0.012 * sin(uTime * 4.0 + a * 3.0), 0.3)), 0.2);
  }
  float y = sdEll(p - vec3(0.06, 0.09, 0.02), vec3(0.24, 0.16 + 0.01 * sin(uTime * 2.0 + seed), 0.24));
  return y < w ? vec2(y, 3.0) : vec2(w, 2.0);
}

vec2 map(vec3 p) {
  vec2 res = vec2(p.y + 0.36, 4.0);
  float outer = sdCyl(p - vec3(0.0, -0.16, 0.0), 0.17, 2.1);
  float inner = sdCyl(p - vec3(0.0, 0.03, 0.0), 0.17, 1.95);
  float pan = max(outer, -inner) - 0.01;
  pan = min(pan, sdBox(p - vec3(2.95, -0.06, 0.0), vec3(0.9, 0.045, 0.13)) - 0.03);
  if (pan < res.x) res = vec2(pan, 1.0);
  vec2 e = egg(p - vec3(-0.75, -0.11, -0.35), 0.0); if (e.x < res.x) res = e;
  e = egg(p - vec3(0.72, -0.11, 0.45), 2.1); if (e.x < res.x) res = e;
  e = egg(p - vec3(0.3, -0.11, -1.0), 4.2); if (e.x < res.x) res = e;
  return res;
}

vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0015;
  return normalize(k.xyy * map(p + k.xyy * h).x + k.yyx * map(p + k.yyx * h).x + k.yxy * map(p + k.yxy * h).x + k.xxx * map(p + k.xxx * h).x);
}

float shadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.02;
  for (int i = 0; i < 24; i++) {
    float h = map(ro + rd * t).x;
    res = min(res, 8.0 * h / t);
    t += clamp(h, 0.03, 0.35);
    if (res < 0.002 || t > 8.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ao(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0;
  for (int i = 0; i < 4; i++) {
    float h = 0.01 + 0.1 * float(i);
    occ += (h - map(p + h * n).x) * sca;
    sca *= 0.85;
  }
  return clamp(1.0 - 2.0 * occ, 0.0, 1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  uv.x += sin(uv.y * 38.0 + uTime * 7.0) * 0.0018; // heat shimmer
  float t = uTime * 0.28;
  vec3 ro = vec3(4.4 * cos(t), 2.7 + 0.35 * sin(uTime * 0.31), 4.4 * sin(t));
  vec3 ta = vec3(0.25, -0.15, 0.0);
  vec3 ww = normalize(ta - ro), uu = normalize(cross(ww, vec3(0, 1, 0))), vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.7 * ww);

  vec3 col = mix(vec3(0.05, 0.035, 0.03), vec3(0.16, 0.08, 0.04), clamp(uv.y * 0.6 + 0.5, 0.0, 1.0));
  float d = 0.0; vec2 hit = vec2(-1.0);
  for (int i = 0; i < 96; i++) {
    vec2 h = map(ro + rd * d);
    if (h.x < 0.0008 * d) { hit = vec2(d, h.y); break; }
    d += h.x;
    if (d > 20.0) break;
  }
  if (hit.x > 0.0) {
    vec3 p = ro + rd * hit.x;
    vec3 n = normalAt(p);
    vec3 alb; float spec = 0.2; float shin = 16.0; vec3 emi = vec3(0.0);
    if (hit.y < 1.5) { alb = vec3(0.07, 0.07, 0.08); spec = 1.2; shin = 60.0; }
    else if (hit.y < 2.5) { alb = vec3(0.96, 0.93, 0.87); float edge = smoothstep(0.02, 0.0, p.y + 0.11); alb = mix(alb, vec3(0.78, 0.5, 0.22), edge * 0.7); }
    else if (hit.y < 3.5) { alb = vec3(1.0, 0.52, 0.06); spec = 0.9; shin = 40.0; }
    else {
      alb = vec3(0.045, 0.04, 0.038);
      float r = length(p.xz);
      float flick = 0.65 + 0.35 * sin(atan(p.z, p.x) * 26.0 + uTime * 9.0) * sin(uTime * 5.0 + r * 10.0);
      emi = vec3(1.0, 0.35, 0.05) * exp(-abs(r - 2.25) * 7.0) * flick * 1.6;
    }
    vec3 L = normalize(vec3(0.6, 0.95, 0.35));
    float dif = clamp(dot(n, L), 0.0, 1.0) * shadow(p + n * 0.01, L);
    float occ = ao(p, n);
    vec3 hv = normalize(L - rd);
    float sp = pow(clamp(dot(n, hv), 0.0, 1.0), shin) * spec * dif;
    col = alb * (vec3(1.3, 1.1, 0.9) * dif + vec3(0.18, 0.2, 0.28) * occ * (0.5 + 0.5 * n.y)) + sp * vec3(1.0, 0.9, 0.8) + emi;
    col += alb * vec3(1.0, 0.4, 0.1) * 0.25 * clamp(-n.y, 0.0, 1.0) * occ;
    col = mix(col, vec3(0.08, 0.05, 0.04), 1.0 - exp(-0.004 * hit.x * hit.x));
  }
  col = pow(col, vec3(0.4545));
  col *= 1.0 - 0.25 * dot(uv * 0.5, uv * 0.5);
  outColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
  return s;
}

export function gpuRendererName() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch {
    return null;
  }
}

// Yields to the event loop without setTimeout's 4ms clamp.
const channel = new MessageChannel();
const queue = [];
channel.port1.onmessage = () => queue.shift()?.();
const yieldNow = () => new Promise((r) => { queue.push(r); channel.port2.postMessage(0); });

export async function runGpuBench(canvas, { seconds = 12, onUpdate, isCancelled } = {}) {
  canvas.width = 1920;
  canvas.height = 1080;
  const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) return { error: 'WebGL 2 is not available (graphics driver missing or broken?)' };

  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) {
    return { error: `Shader failed: ${e.message}` };
  }
  gl.useProgram(prog);
  gl.viewport(0, 0, canvas.width, canvas.height);
  const uRes = gl.getUniformLocation(prog, 'uRes');
  const uTime = gl.getUniformLocation(prog, 'uTime');
  gl.uniform2f(uRes, canvas.width, canvas.height);
  const px = new Uint8Array(4);

  let lost = false;
  canvas.addEventListener('webglcontextlost', () => (lost = true), { once: true });

  const frame = (time) => {
    gl.uniform1f(uTime, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  };

  // Warm-up: shader compile and clocks ramping up.
  const warmEnd = performance.now() + 1200;
  while (performance.now() < warmEnd) {
    frame(performance.now() / 1000);
    await yieldNow();
    if (isCancelled?.()) return null;
  }

  const frameTimes = [];
  const windows = [];
  let winFrames = 0;
  let winStart = performance.now();
  const start = performance.now();
  let lastUpdate = 0;
  while (performance.now() - start < seconds * 1000) {
    const t0 = performance.now();
    frame(t0 / 1000);
    const dt = performance.now() - t0;
    frameTimes.push(dt);
    winFrames++;
    const now = performance.now();
    if (now - winStart >= 1000) {
      windows.push((winFrames * 1000) / (now - winStart));
      winFrames = 0;
      winStart = now;
    }
    if (now - lastUpdate > 250) {
      lastUpdate = now;
      const recent = frameTimes.slice(-20);
      onUpdate?.({ fps: 1000 / (recent.reduce((a, b) => a + b, 0) / recent.length), elapsed: (now - start) / 1000, total: seconds });
    }
    if (lost) return { error: 'The graphics driver crashed during the test (WebGL context lost). That’s a red flag.', driverCrash: true };
    if (isCancelled?.()) return null;
    await yieldNow();
  }

  const total = (performance.now() - start) / 1000;
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || sorted[sorted.length - 1];
  const avgFps = frameTimes.length / total;
  const third = Math.max(1, Math.floor(windows.length / 3));
  const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const early = avg(windows.slice(0, third));
  const late = avg(windows.slice(-third));
  return {
    avgFps: Math.round(avgFps * 10) / 10,
    lowFps: Math.round((1000 / p99) * 10) / 10,
    frames: frameTimes.length,
    dropPct: windows.length >= 6 && early > 0 ? Math.max(0, Math.round((1 - late / early) * 100)) : 0,
    series: windows.map((w) => Math.round(w)),
    renderer: gpuRendererName(),
  };
}

// Measures the real refresh rate of the screen the app window is on.
export function measureRefreshRate(ms = 2000) {
  return new Promise((resolve) => {
    const deltas = [];
    let last = null;
    const end = performance.now() + ms;
    const step = (t) => {
      if (last != null) deltas.push(t - last);
      last = t;
      if (t < end) requestAnimationFrame(step);
      else {
        deltas.sort((a, b) => a - b);
        const med = deltas[Math.floor(deltas.length / 2)] || 16.7;
        const hz = 1000 / med;
        const common = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 160, 165, 170, 175, 180, 200, 240, 280, 300, 360, 390, 480, 500, 540];
        const snap = common.find((c) => Math.abs(c - hz) / c < 0.035);
        resolve(snap || Math.round(hz));
      }
    };
    requestAnimationFrame(step);
  });
}

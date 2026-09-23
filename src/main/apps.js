// Finds apps running in the background that would skew the test results, and closes them on request.
const { execFile } = require('node:child_process');
const { runPSJson } = require('./ps');

// Process name (lowercase, no .exe) → how we show it.
const KNOWN = {
  chrome: ['Google Chrome', '🌐', 'browser'], msedge: ['Microsoft Edge', '🌐', 'browser'], firefox: ['Firefox', '🦊', 'browser'],
  opera: ['Opera', '🌐', 'browser'], opera_gx: ['Opera GX', '🌐', 'browser'], brave: ['Brave', '🦁', 'browser'], vivaldi: ['Vivaldi', '🌐', 'browser'],
  arc: ['Arc', '🌐', 'browser'], yandex: ['Yandex Browser', '🌐', 'browser'],
  steam: ['Steam', '🎮', 'game'], epicgameslauncher: ['Epic Games', '🎮', 'game'], 'battle.net': ['Battle.net', '🎮', 'game'],
  eadesktop: ['EA App', '🎮', 'game'], origin: ['Origin', '🎮', 'game'], upc: ['Ubisoft Connect', '🎮', 'game'], ubisoftconnect: ['Ubisoft Connect', '🎮', 'game'],
  galaxyclient: ['GOG Galaxy', '🎮', 'game'], riotclientservices: ['Riot Client', '🎮', 'game'], leagueclient: ['League of Legends', '🎮', 'game'],
  'league of legends': ['League of Legends', '🎮', 'game'], valorant: ['Valorant', '🎮', 'game'], 'valorant-win64-shipping': ['Valorant', '🎮', 'game'],
  cs2: ['Counter-Strike 2', '🎮', 'game'], fortniteclient: ['Fortnite', '🎮', 'game'], 'fortniteclient-win64-shipping': ['Fortnite', '🎮', 'game'],
  robloxplayerbeta: ['Roblox', '🎮', 'game'], minecraft: ['Minecraft', '🎮', 'game'], gta5: ['GTA V', '🎮', 'game'], xboxpcapp: ['Xbox app', '🎮', 'game'],
  discord: ['Discord', '💬', 'chat'], spotify: ['Spotify', '🎵', 'media'], teams: ['Microsoft Teams', '💬', 'chat'], 'ms-teams': ['Microsoft Teams', '💬', 'chat'],
  slack: ['Slack', '💬', 'chat'], zoom: ['Zoom', '💬', 'chat'], skype: ['Skype', '💬', 'chat'], whatsapp: ['WhatsApp', '💬', 'chat'], telegram: ['Telegram', '💬', 'chat'],
  vlc: ['VLC', '🎬', 'media'], obs64: ['OBS Studio', '📡', 'creator'], 'adobe premiere pro': ['Premiere Pro', '🎬', 'creator'], afterfx: ['After Effects', '🎬', 'creator'],
  photoshop: ['Photoshop', '🎨', 'creator'], illustrator: ['Illustrator', '🎨', 'creator'], blender: ['Blender', '🧊', 'creator'], resolve: ['DaVinci Resolve', '🎬', 'creator'],
  'creative cloud': ['Adobe Creative Cloud', '🎨', 'creator'],
  code: ['VS Code', '💻', 'dev'], devenv: ['Visual Studio', '💻', 'dev'], idea64: ['IntelliJ IDEA', '💻', 'dev'], pycharm64: ['PyCharm', '💻', 'dev'],
  'docker desktop': ['Docker Desktop', '🐳', 'dev'], vmware: ['VMware', '🖥️', 'dev'], virtualboxvm: ['VirtualBox', '🖥️', 'dev'],
  utorrent: ['uTorrent', '🧲', 'download'], qbittorrent: ['qBittorrent', '🧲', 'download'], bittorrent: ['BitTorrent', '🧲', 'download'],
  onedrive: ['OneDrive (syncing)', '☁️', 'sync'], dropbox: ['Dropbox', '☁️', 'sync'], googledrivefs: ['Google Drive', '☁️', 'sync'],
  // Crypto miners: on a PC you're buying, that's a red flag on its own.
  xmrig: ['XMRig (crypto miner!)', '⛏️', 'miner'], nicehashminer: ['NiceHash (crypto miner!)', '⛏️', 'miner'], 'nicehash miner': ['NiceHash (crypto miner!)', '⛏️', 'miner'],
  't-rex': ['T-Rex (crypto miner!)', '⛏️', 'miner'], phoenixminer: ['PhoenixMiner (crypto miner!)', '⛏️', 'miner'], nbminer: ['NBMiner (crypto miner!)', '⛏️', 'miner'],
  lolminer: ['lolMiner (crypto miner!)', '⛏️', 'miner'], miner: ['GMiner (crypto miner!)', '⛏️', 'miner'], teamredminer: ['TeamRedMiner (crypto miner!)', '⛏️', 'miner'],
};

// Never offered, whatever they're doing.
const PROTECTED = new Set([
  'system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'svchost', 'dwm', 'explorer', 'fontdrvhost',
  'sihost', 'taskhostw', 'ctfmon', 'runtimebroker', 'searchhost', 'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost',
  'msmpeng', 'nissrv', 'securityhealthservice', 'audiodg', 'conhost', 'dllhost', 'wmiprvse', 'spoolsv', 'memory compression',
  'powershell', 'pwsh', 'cmd', 'windowsterminal', 'openconsole', 'taskmgr', 'applicationframehost', 'systemsettings', 'lockapp',
  'electron', 'is it cooked', 'isitcooked', 'elevate', 'winsat', 'nvcontainer', 'nvdisplay.container', 'amdrsserv', 'igfxem',
]);

const SCAN = String.raw`
$ErrorActionPreference='SilentlyContinue'
$a = Get-Process | Select-Object Id, Name, CPU, WorkingSet64, MainWindowHandle, Description
Start-Sleep -Milliseconds 1500
$b = @{}; Get-Process | ForEach-Object { $b[$_.Id] = $_.CPU }
@($a | ForEach-Object { @{ id=$_.Id; name=$_.Name; mem=[double]$_.WorkingSet64; win=($_.MainWindowHandle -ne 0); desc=[string]$_.Description; cpu=[double]($b[$_.Id] - $_.CPU) } }) | ConvertTo-Json -Compress
`;

// Only apps from the latest scan can be closed (the UI can't ask us to kill arbitrary processes).
let lastScan = new Map();

async function listBusyApps(ownPids = []) {
  const procs = (await runPSJson(SCAN, { timeoutMs: 40000 })) || [];
  const own = new Set(ownPids);
  const cores = require('node:os').cpus().length;
  const groups = new Map();
  for (const p of Array.isArray(procs) ? procs : [procs]) {
    const key = String(p.name || '').toLowerCase();
    if (!key || PROTECTED.has(key) || own.has(p.id)) continue;
    const g = groups.get(key) || { key, pids: [], mem: 0, cpuSec: 0, win: false, desc: '' };
    g.pids.push(p.id);
    g.mem += p.mem || 0;
    g.cpuSec += p.cpu > 0 ? p.cpu : 0;
    g.win ||= !!p.win;
    g.desc ||= p.desc;
    groups.set(key, g);
  }
  const out = [];
  for (const g of groups.values()) {
    const known = KNOWN[g.key];
    const cpuPct = Math.round(((g.cpuSec / 1.5) * 100) / cores);
    const memMB = Math.round(g.mem / 1048576);
    // Unknown apps only count if they have a window and are actually heavy.
    if (!known && !(g.win && (cpuPct >= 5 || memMB >= 800))) continue;
    out.push({
      id: g.key,
      name: known?.[0] || g.desc || g.key,
      emoji: known?.[1] || '📦',
      kind: known?.[2] || 'other',
      cpuPct,
      memMB,
      count: g.pids.length,
    });
  }
  out.sort((a, b) => (b.kind === 'miner') - (a.kind === 'miner') || b.cpuPct - a.cpuPct || b.memMB - a.memMB);
  lastScan = new Map(out.map((a) => [a.id, groups.get(a.id).pids]));
  return out;
}

function taskkill(pids, force) {
  return new Promise((resolve) => {
    const args = [...(force ? ['/F'] : []), '/T', ...pids.flatMap((p) => ['/PID', String(p)])];
    execFile('taskkill.exe', args, { windowsHide: true }, () => resolve());
  });
}

function stillRunning(pids) {
  return pids.filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return e.code === 'EPERM';
    }
  });
}

// Gentle close first (like clicking X). `force` ends it immediately (unsaved work is lost).
async function closeApp(id, force) {
  const pids = lastScan.get(id);
  if (!pids) return { ok: false, reason: 'unknown' };
  await taskkill(pids, force);
  const deadline = Date.now() + (force ? 1500 : 3500);
  let left = stillRunning(pids);
  while (left.length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    left = stillRunning(pids);
  }
  if (!left.length) lastScan.delete(id);
  return { ok: left.length === 0 };
}

module.exports = { listBusyApps, closeApp };

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PREFIX = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'\n";
let counter = 0;

// PowerShell's stdin mode chokes on multi-line blocks, so scripts go through a temp .ps1 file.
function spawnScript(script) {
  const file = path.join(os.tmpdir(), `iic-${process.pid}-${Date.now()}-${counter++}.ps1`);
  fs.writeFileSync(file, '﻿' + PREFIX + script, 'utf8');
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
    windowsHide: true,
  });
  const cleanup = () => fs.rm(file, { force: true }, () => {});
  ps.on('close', cleanup);
  ps.on('error', cleanup);
  return ps;
}

// Runs a PowerShell script and returns stdout. Never throws: failures resolve to ''.
function runPS(script, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let ps;
    try {
      ps = spawnScript(script);
    } catch {
      return resolve('');
    }
    let out = '';
    const timer = setTimeout(() => ps.kill(), timeoutMs);
    ps.stdout.on('data', (d) => (out += d.toString('utf8')));
    ps.stderr.on('data', () => {});
    ps.on('error', () => resolve(''));
    ps.on('close', () => {
      clearTimeout(timer);
      resolve(out.trim());
    });
  });
}

async function runPSJson(script, opts) {
  const out = await runPS(script, opts);
  const start = out.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(out.slice(start));
  } catch {
    return null;
  }
}

// Starts a long-running PowerShell loop that prints one JSON object per line.
// Returns a stop function.
function streamPS(script, onLine) {
  let ps;
  try {
    ps = spawnScript(script);
  } catch {
    return () => {};
  }
  let buf = '';
  ps.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        onLine(JSON.parse(line));
      } catch {}
    }
  });
  ps.stderr.on('data', () => {});
  ps.on('error', () => {});
  // Sampling must keep working while every core is pegged, so bump its priority.
  try {
    os.setPriority(ps.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
  } catch {}
  return () => {
    try {
      ps.kill();
    } catch {}
  };
}

module.exports = { runPS, runPSJson, streamPS };

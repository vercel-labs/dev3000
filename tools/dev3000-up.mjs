// @ts-check
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function findChrome() {
  if (isMac) {
    const p = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(p)) return p;
  } else if (isWin) {
    const cands = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
    for (const p of cands) if (fs.existsSync(p)) return p;
  } else {
    // Linux/WSL: Try common Chrome paths
    // Prefer Windows Chrome on WSL as it avoids Snap/Flatpak CDP issues
    const cands = [
      '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',  // WSL path to Windows Chrome
      '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser'
    ];
    for (const p of cands) {
      if (fs.existsSync(p)) return p;
    }
    // Fallback to PATH search
    return 'google-chrome';
  }
  return null;
}

async function isCdpAvailable() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const res = await fetch('http://localhost:9222/json/version', { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch (_e) {
    clearTimeout(timeout);
    return false;
  }
}

async function launchChrome() {
  // If CDP is already available on 9222, skip launching a new Chrome
  // Note: Ensure the existing Chrome was started with --remote-debugging-address=0.0.0.0
  // so the Docker container can reach it via host.docker.internal.
  // This check runs best-effort and won't verify binding address.
  if (await isCdpAvailable()) {
    console.log('[dev3000-up] Detected existing Chrome CDP at http://localhost:9222 — skipping Chrome launch.');
    console.log('[dev3000-up] If the container cannot connect, re-launch Chrome with --remote-debugging-address=0.0.0.0');
    return null;
  }

  const exe = findChrome();
  if (!exe) {
    console.error('[dev3000-up] Chrome が見つかりません。手動で --remote-debugging-port=9222 で起動してください。');
    return null;
  }
  // WARNING: CDP (Chrome DevTools Protocol) is unauthenticated and exposes debugging capabilities.
  // Only use this in trusted development environments. Do NOT expose port 9222 to untrusted networks.
  const args = [
    '--remote-debugging-port=9222',
    '--remote-debugging-address=0.0.0.0',  // Binds to all interfaces for Docker host.docker.internal access
    `--user-data-dir=${path.join(os.tmpdir(), 'dev3000-chrome')}`
  ];
  const opt = { stdio: 'ignore', detached: true };
  try {
    const proc = spawn(exe, args, opt);
    proc.unref();
    console.log('[dev3000-up] Chrome を起動しました (CDP: 9222)');
    return proc;
  } catch (e) {
    console.error('[dev3000-up] Chrome 起動に失敗:', e.message);
    return null;
  }
}

function runCompose() {
  const args = ['compose', '-f', 'docker/docker-compose.yml', 'up', '--build'];
  const proc = spawn('docker', args, { stdio: 'inherit' });
  proc.on('exit', (code) => process.exit(code ?? 0));
}

await launchChrome();
runCompose();

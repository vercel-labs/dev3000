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

function launchChrome() {
  const exe = findChrome();
  if (!exe) {
    console.error('[dev3000-up] Chrome が見つかりません。手動で --remote-debugging-port=9222 で起動してください。');
    return null;
  }
  const args = [
    '--remote-debugging-port=9222',
    '--remote-debugging-address=0.0.0.0',
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

const chrome = launchChrome();
runCompose();

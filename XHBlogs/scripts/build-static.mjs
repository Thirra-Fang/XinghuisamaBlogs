#!/usr/bin/env node
/**
 * Build pure static site into out/ for nginx (reality-fallback; deploy via ../scripts/deploy-fallback-site-remote.sh).
 * Temporarily parks app/api, app/music, app/tree so next export succeeds.
 * (说说 /moments 已从源码移除，无需再 park。)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parkRoot = path.join(root, '.static-park');

const parks = [
  { src: path.join(root, 'app', 'api'), dest: path.join(parkRoot, 'api') },
  { src: path.join(root, 'app', 'music'), dest: path.join(parkRoot, 'music') },
  { src: path.join(root, 'app', 'tree'), dest: path.join(parkRoot, 'tree') },
];

function park(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(src, dest);
  return true;
}

function restore(src, dest) {
  if (!fs.existsSync(src)) return;
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(src, dest);
}

function recoverInterruptedState() {
  for (const p of parks) {
    if (fs.existsSync(p.dest)) {
      if (!fs.existsSync(p.src)) {
        fs.mkdirSync(path.dirname(p.src), { recursive: true });
        fs.renameSync(p.dest, p.src);
        console.log(`[build-static] recovered parked ${path.relative(root, p.src)}`);
      } else {
        fs.rmSync(p.dest, { recursive: true, force: true });
      }
    }
  }
  const lockFile = path.join(root, '.next', 'lock');
  if (fs.existsSync(lockFile)) {
    fs.rmSync(lockFile, { force: true });
    console.log('[build-static] removed stale .next/lock');
  }
}

const parked = parks.map(() => false);

process.on('exit', () => {
  try {
    parks.forEach((p, i) => {
      if (parked[i]) restore(p.dest, p.src);
    });
  } catch (e) {
    console.error('[build-static] restore on exit failed:', e);
  }
});

try {
  recoverInterruptedState();
  parks.forEach((p, i) => {
    parked[i] = park(p.src, p.dest);
  });
  console.log(
    `[build-static] parked api=${parked[0]} music=${parked[1]} tree=${parked[2]}`
  );

  const env = {
    ...process.env,
    STATIC_EXPORT: '1',
    NEXT_PUBLIC_STATIC_EXPORT: '1',
  };

  const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
  const r = spawnSync(process.execPath, [nextBin, 'build'], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: false,
  });

  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }

  const outDir = path.join(root, 'out');
  if (!fs.existsSync(path.join(outDir, 'index.html'))) {
    console.error('[build-static] missing out/index.html');
    process.exit(1);
  }
  console.log('[build-static] OK →', outDir);
} finally {
  parks.forEach((p, i) => {
    if (parked[i]) {
      restore(p.dest, p.src);
      parked[i] = false;
    }
  });
}

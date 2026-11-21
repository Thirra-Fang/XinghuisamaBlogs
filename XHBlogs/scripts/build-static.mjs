#!/usr/bin/env node
/**
 * Build pure static site into out/ for nginx (AboutVPS reality-fallback).
 * Temporarily parks app/api and app/music so next export succeeds.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'app', 'api');
const apiPark = path.join(root, '.static-park', 'api');
const musicDir = path.join(root, 'app', 'music');
const musicPark = path.join(root, '.static-park', 'music');

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

let parkedApi = false;
let parkedMusic = false;

process.on('exit', () => {
  try {
    if (parkedApi) restore(apiPark, apiDir);
    if (parkedMusic) restore(musicPark, musicDir);
  } catch (e) {
    console.error('[build-static] restore on exit failed:', e);
  }
});

try {
  parkedApi = park(apiDir, apiPark);
  parkedMusic = park(musicDir, musicPark);
  console.log(`[build-static] parked api=${parkedApi} music=${parkedMusic}`);

  const env = {
    ...process.env,
    STATIC_EXPORT: '1',
    NEXT_PUBLIC_STATIC_EXPORT: '1',
  };

  const r = spawnSync('npx', ['next', 'build'], {
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
  if (parkedApi) {
    restore(apiPark, apiDir);
    parkedApi = false;
  }
  if (parkedMusic) {
    restore(musicPark, musicDir);
    parkedMusic = false;
  }
}

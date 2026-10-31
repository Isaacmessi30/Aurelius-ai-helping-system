import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const run = (command, args, timeout = 120000) => new Promise((resolve, reject) => {
  execFile(command, args, { cwd: process.cwd(), timeout, maxBuffer: 1024 * 1024, env: process.env },
    (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).slice(0, 1200))) : resolve(stdout.trim()));
});

export async function updateFromGitHub() {
  const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aurelius-update-'));
  const preserved = ['.env', 'data/config.json'];
  const backups = new Map();
  let updated = false;
  try {
    const branch = await run('git', ['branch', '--show-current']);
    if (branch !== 'main') throw new Error('Updates require the main branch.');
    const modified = await run('git', ['status', '--porcelain', '--untracked-files=no']);
    const changed = modified.split('\n').filter(Boolean).map(line => line.slice(3));
    const unexpected = changed.filter(file => !preserved.includes(file));
    if (unexpected.length) {
      throw new Error('Other tracked files have local changes: ' + unexpected.slice(0, 8).join(', ') +
        '. Preserve or commit them manually before updating.');
    }
    for (const file of preserved) {
      try {
        const destination = path.join(backupDir, file.replaceAll('/', '_'));
        await fs.copyFile(file, destination);
        backups.set(file, destination);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    // Restore only tracked runtime configuration files, after safe backups.
    for (const file of changed) {
      if (backups.has(file)) await run('git', ['restore', '--', file]);
    }
    const before = await run('git', ['rev-parse', 'HEAD']);
    await run('git', ['fetch', '--quiet', 'origin', 'main']);
    if (Number(await run('git', ['rev-list', '--count', 'HEAD..origin/main'])) > 0) {
      await run('git', ['merge', '--ff-only', 'origin/main']);
      updated = true;
    }
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], 180000);
    await run(process.execPath, ['--check', 'src/index.js']);
    return { updated, before, after: await run('git', ['rev-parse', 'HEAD']) };
  } finally {
    for (const [file, backup] of backups) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.copyFile(backup, file);
    }
    await fs.rm(backupDir, { recursive: true, force: true });
  }
}

export async function restartOwnServer() {
  const url = process.env.PTERODACTYL_URL;
  const key = process.env.PTERODACTYL_CLIENT_API_KEY;
  const server = process.env.AI_BOT_SERVER_ID;
  if (!url?.startsWith('https://') || !key || !/^[a-zA-Z0-9_-]{8,64}$/.test(server || '')) {
    throw new Error('PTERODACTYL_URL, PTERODACTYL_CLIENT_API_KEY and AI_BOT_SERVER_ID must be configured for automatic restart.');
  }
  const endpoint = new URL('/api/client/servers/' + encodeURIComponent(server) + '/power', url);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ signal: 'restart' }),
    redirect: 'error',
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error('Pterodactyl restart request returned HTTP ' + response.status);
}

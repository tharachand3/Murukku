import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const BACKEND_DIR = fileURLToPath(new URL('..', import.meta.url));
const ADMIN_EMAIL = 'admin@demo.com';
const DEMO_PASSWORD = 'Demo@123';

async function getJson(path, token) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function getAdminToken() {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: DEMO_PASSWORD })
  });
  const body = await response.json();
  if (!response.ok || typeof body.token !== 'string') {
    throw new Error(`Admin login failed (HTTP ${response.status})`);
  }
  return body.token;
}

function runNodeScript(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env: process.env
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return {
    status: result.status ?? 1,
    error: result.error,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

async function databaseIsFresh() {
  const token = await getAdminToken();
  const [stock, runs] = await Promise.all([
    getJson('/api/stock/summary', token),
    getJson('/api/production/runs?page=1&limit=1', token)
  ]);
  const flour = stock.find(({ code }) => code === 'FLOUR');
  return flour?.balanceBase === 100000 && runs.total === 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== '--reset') ||
      args.filter((argument) => argument === '--reset').length > 1) {
    console.error('Usage: npm run bench:full [-- --reset]');
    console.error('BENCHMARK FAILED: invalid arguments');
    process.exitCode = 1;
    return;
  }
  const reset = args.includes('--reset');
  if (reset && process.env.NODE_ENV?.toLowerCase() === 'production') {
    console.error('Refusing to reset a production database.');
    console.error('BENCHMARK FAILED: production reset refused');
    process.exitCode = 1;
    return;
  }

  try {
    await getJson('/api/health');
  } catch (error) {
    console.error(`Backend health check failed: ${error.message}`);
    console.error('BENCHMARK FAILED: API health');
    process.exitCode = 1;
    return;
  }

  if (reset) {
    const resetResult = runNodeScript('scripts/reset-db.js');
    if (resetResult.status !== 0) {
      console.error('BENCHMARK FAILED: seed:reset');
      process.exitCode = 1;
      return;
    }
  }

  let fresh;
  try {
    fresh = await databaseIsFresh();
  } catch (error) {
    console.error(`Fresh-database check failed: ${error.message}`);
    console.error('BENCHMARK FAILED: fresh-database check');
    process.exitCode = 1;
    return;
  }
  if (!fresh) {
    console.error('Database is not fresh. Run: npm run seed:reset');
    process.exitCode = 1;
    return;
  }

  const playback = runNodeScript('scripts/benchmark-play.js', ['--upto=9']);
  if (playback.status !== 0) {
    console.error('BENCHMARK FAILED: benchmark-play');
    process.exitCode = 1;
    return;
  }

  const checker = runNodeScript('scripts/benchmark-check.js', ['--stage=final']);
  const checkerOutput = `${checker.stdout}${checker.stderr}`;
  const counts = checkerOutput.match(/PASS: (\d+) \| FAIL: (\d+) \| INFO: (\d+) \| SKIPPED: (\d+)/);
  if (checker.status === 0 && counts && Number(counts[2]) === 0) {
    const passed = Number(counts[1]);
    console.log(`BENCHMARK PASSED: ${passed}/${passed} checks`);
    return;
  }

  const namedFailures = checkerOutput.match(/BENCHMARK_CHECK_FAILURES: (.+)/)?.[1];
  const detail = namedFailures || (counts
    ? `${counts[2]} checker failures`
    : 'final checker did not report a complete result');
  console.error(`BENCHMARK FAILED: ${detail}`);
  process.exitCode = 1;
}

await main();

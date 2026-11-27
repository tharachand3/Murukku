const baseUrl = (process.env.SMOKE_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
const demoPassword = 'Demo@123';
let failures = 0;
let adminToken;

async function check(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error('Expected a JSON response');
  }
}

async function login(email) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: demoPassword })
  });
  const body = await readJson(response);
  if (!response.ok || typeof body.token !== 'string') {
    throw new Error(`Login failed with HTTP ${response.status}`);
  }
  return body.token;
}

async function getWithToken(path, token) {
  return fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

await check('health through nginx (ok and database connected)', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await readJson(response);
  if (!response.ok || body.ok !== true || body.db !== true) {
    throw new Error(`Unexpected health response (HTTP ${response.status})`);
  }
});

await check('admin demo login', async () => {
  adminToken = await login('admin@demo.com');
});

await check('authenticated admin session', async () => {
  if (!adminToken) throw new Error('Admin login did not return a token');
  const response = await getWithToken('/api/auth/me', adminToken);
  const body = await readJson(response);
  if (!response.ok || body.user?.role !== 'ADMIN') {
    throw new Error(`Expected ADMIN session (HTTP ${response.status})`);
  }
});

await check('stock summary contains six items', async () => {
  if (!adminToken) throw new Error('Admin login did not return a token');
  const response = await getWithToken('/api/stock/summary', adminToken);
  const body = await readJson(response);
  if (!response.ok || !Array.isArray(body) || body.length !== 6) {
    throw new Error(`Expected six stock items (HTTP ${response.status})`);
  }
});

await check('SPA fallback serves /my-orders as HTML', async () => {
  const response = await fetch(`${baseUrl}/my-orders`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !contentType.includes('text/html')) {
    throw new Error(`Expected HTML (HTTP ${response.status})`);
  }
});

await check('unknown API route returns JSON 404', async () => {
  const response = await fetch(`${baseUrl}/api/nothing`);
  const body = await readJson(response);
  if (
    response.status !== 404
    || typeof body.error?.code !== 'string'
    || typeof body.error?.message !== 'string'
  ) {
    throw new Error(`Expected JSON error response (HTTP ${response.status})`);
  }
});

await check('salesman is forbidden from stock summary', async () => {
  const token = await login('salesman.a@demo.com');
  const response = await getWithToken('/api/stock/summary', token);
  if (response.status !== 403) {
    throw new Error(`Expected HTTP 403, received ${response.status}`);
  }
});

if (failures > 0) {
  process.exitCode = 1;
}

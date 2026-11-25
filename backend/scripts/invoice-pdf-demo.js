import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const EMAIL = 'admin@demo.com';
const PASSWORD = 'Demo@123';
const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../exports/benchmark');

async function requestApi(route, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API_URL}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) {
    throw new Error(`${method} ${route} failed with HTTP ${response.status}: ${await response.text()}`);
  }
  return response;
}

const loginResponse = await requestApi('/api/auth/login', {
  method: 'POST',
  body: { email: EMAIL, password: PASSWORD }
});
const { token } = await loginResponse.json();
if (typeof token !== 'string') {
  throw new Error('Admin login did not return a token');
}

const listResponse = await requestApi('/api/invoices?limit=1&page=1', { token });
const invoice = (await listResponse.json()).items?.[0];
if (!invoice) {
  console.error('No posted invoice exists. Create benchmark data with: npm run bench:play');
  process.exitCode = 1;
} else {
  const fileName = `${invoice.invoiceNo.replaceAll('/', '-')}.pdf`;
  const pdfResponse = await requestApi(`/api/invoices/${invoice.id}/pdf`, { token });
  const buffer = Buffer.from(await pdfResponse.arrayBuffer());
  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await writeFile(outputPath, buffer);

  const shareResponse = await requestApi(`/api/invoices/${invoice.id}/share`, { token });
  const share = await shareResponse.json();
  console.log(`WhatsApp: ${share.whatsappUrl}`);
  console.log(`Email: ${share.mailtoUrl}`);
  console.log(`PDF: ${outputPath}`);
}

import 'dotenv/config';

function databaseName(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL_TEST must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL_TEST must use PostgreSQL.');
  }
  return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
}

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl || databaseName(testUrl) !== 'oda_test') {
  throw new Error('Vitest requires DATABASE_URL_TEST to target the oda_test database.');
}

process.env.DATABASE_URL = testUrl;

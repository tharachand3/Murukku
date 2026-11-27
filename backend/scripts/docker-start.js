import { execFileSync } from 'node:child_process';

execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });

if (process.env.SEED_ON_START === 'true') {
  execFileSync(process.execPath, ['prisma/seed.js'], { stdio: 'inherit' });
}

if (process.env.JWT_SECRET?.startsWith('demo-only')) {
  console.warn('WARNING: JWT_SECRET is using the demo-only default; set a private secret before deployment.');
}

await import('../src/server.js');

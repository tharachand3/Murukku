import { app } from './app.js';
import { config } from './config/env.js';
import { prisma } from './lib/prisma.js';

const server = app.listen(config.PORT, () => {
  console.log(`Backend listening on port ${config.PORT}`);
});

let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  server.close(async (error) => {
    if (error) {
      console.error('Error closing HTTP server:', error);
      process.exitCode = 1;
    }

    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error('Error disconnecting Prisma:', disconnectError);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

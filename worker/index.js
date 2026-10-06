require('dotenv').config();
const workerService = require('./workerService');

async function main() {
  console.log('====================================================');
  console.log('  Starting Scalable Video Transcoding Worker Node');
  console.log('====================================================');

  process.on('SIGINT', () => {
    console.log('[Worker] Received SIGINT signal. Shutting down gracefully...');
    workerService.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('[Worker] Received SIGTERM signal. Shutting down gracefully...');
    workerService.stop();
    process.exit(0);
  });

  await workerService.start();
}

main().catch(err => {
  console.error('[Worker Fatal Error]:', err);
  process.exit(1);
});

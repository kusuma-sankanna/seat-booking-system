const { Worker } = require('bullmq');
const IORedis = require('ioredis');
require('dotenv').config();

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null
});

const emailWorker = new Worker('booking-confirmation', async (job) => {
  const { bookingId, userId, showId, seats } = job.data;

  console.log(`[EMAIL WORKER] Processing job ${job.id} for booking ${bookingId}...`);

  // Simulate slow I/O, like a real email API call
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log(`[EMAIL WORKER] Confirmation sent: Booking #${bookingId} confirmed for user ${userId}, show ${showId}, seats: ${seats.join(', ')}`);

  return { sent: true };
}, { connection });

emailWorker.on('completed', (job) => {
  console.log(`[EMAIL WORKER] Job ${job.id} completed successfully`);
});

emailWorker.on('failed', (job, err) => {
  console.error(`[EMAIL WORKER] Job ${job.id} failed:`, err.message);
});

console.log('Email worker started, listening for jobs...');
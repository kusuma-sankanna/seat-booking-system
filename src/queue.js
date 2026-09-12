const { Queue } = require('bullmq');
const IORedis = require('ioredis');
require('dotenv').config();

const connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null
});

const emailQueue = new Queue('booking-confirmation', {connection});

module.exports = emailQueue;
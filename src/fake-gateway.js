const http = require('http');
const crypto = require('crypto');
require('dotenv').config();

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

function sendWebhook(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);

    const signature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/webhooks/payment',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-webhook-signature': signature
      }
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(responseBody) }));
    });

    req.write(body);
    req.end();
  });
}

async function run() {
  const bookingId = process.argv[2];
  const eventId = process.argv[3] || `evt_${crypto.randomBytes(6).toString('hex')}`;

  if (!bookingId) {
    console.log('Usage: node src/fake-gateway.js <bookingId> [eventId]');
    return;
  }

  const payload = {
    eventId,
    bookingId: parseInt(bookingId),
    status: 'success'
  };

  console.log('Sending webhook with eventId:', eventId);
  const result = await sendWebhook(payload);
  console.log('Response:', result.status, result.body);
}

run();
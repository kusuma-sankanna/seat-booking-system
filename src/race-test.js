const http = require('http');

function bookSeat(userId) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ seatLabels: ['A3'], userId });

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/shows/1/book-optimistic',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });

    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('Firing two simultaneous booking requests for seat A3...');

  const [result1, result2] = await Promise.all([
    bookSeat(1),
    bookSeat(1)
  ]);

  console.log('Request 1:', result1.status, result1.body);
  console.log('Request 2:', result2.status, result2.body);
}

run();
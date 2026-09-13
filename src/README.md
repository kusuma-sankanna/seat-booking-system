# Movie Ticket Booking System
 
A movie seat booking backend built to explore concurrency control, database transactions, idempotency, and background job queues — Node.js, Express, PostgreSQL, and Redis (BullMQ).
 
**Live demo:** https://seat-booking-system-0tx3.onrender.com
*(Free-tier hosting — the first request after a period of inactivity may take up to 50 seconds while the instance spins back up.)*
 
## What it does
 
- Lists movie shows and per-show seat availability
- Books one or more seats for a show, with two interchangeable concurrency-safe implementations (pessimistic and optimistic locking)
- Automatically releases seats held by a booking if payment isn't completed within a time window (Redis TTL + a scheduled database sweep as a fallback)
- Processes booking confirmations asynchronously via a background job queue, instead of blocking the request
- Simulates a payment gateway webhook, with HMAC signature verification and idempotent event processing
## Why this project
 
The URL shortener (a separate project) covered CRUD, caching, rate limiting, and JWT auth, but never touched concurrency. This project was built specifically to gain hands-on experience with problems that only appear under real concurrent load: two users booking the same seat at once, multi-step operations that must succeed or fail as a unit, and payment webhooks that may be delivered more than once.
 
## The core problem: preventing double-booking
 
Two implementations exist side by side, deliberately, so both approaches can be compared directly.
 
**`POST /shows/:showId/book`** — pessimistic locking. Wraps the seat check and update in a database transaction using `SELECT ... FOR UPDATE`, which locks the seat's row for the duration of the transaction. A competing request attempting to lock the same row must wait until the first transaction commits or rolls back, so it always sees the correct, up-to-date status.
 
**`POST /shows/:showId/book-optimistic`** — optimistic locking. Adds a `version` column to the seat inventory table. The update includes `WHERE version = <version just read>`, and increments the version on success. If another request already updated the row, the version no longer matches, the update silently affects zero rows, and the losing request detects this via `rowCount === 0` — no waiting, but a definitive answer either way.
 
Both were proven under real concurrent load using a script that fires two simultaneous booking requests for the same seat via `Promise.all`. The naive, unprotected version (built first, before either fix) reliably double-booked the seat; both fixed versions reliably produce exactly one success and one correctly rejected request.
 
**Which one would I actually use for a specific, highly contended seat (e.g. the last few seats of a blockbuster's opening night)?** Pessimistic locking, or a higher-level queueing mechanism — optimistic locking's retry-on-failure pattern can produce wasted round trips under heavy contention on a single row, exactly when it matters most. Optimistic locking is a better fit where conflicts are expected to be rare.
 
## Booking expiry
 
A booking starts as `pending`. Two signals combine to expire it if payment never completes:
- A Redis key (`booking:hold:<bookingId>`) with a TTL, set when the booking is created.
- A scheduled job (`node-cron`, running every minute) that checks the database's own `created_at` timestamp as the authoritative fallback, and only expires a booking if its Redis hold has also disappeared.
Relying on the database timestamp as the fallback — rather than only reacting to Redis key expiration — means a booking is never permanently stuck in `pending` even if Redis loses the key early for any reason (a restart, for example).
 
## Background jobs
 
Booking confirmations are processed via a BullMQ job queue backed by Redis, rather than being sent synchronously inside the request. The producer (`emailQueue.add(...)`) just records a job's data in Redis and returns immediately; a worker independently picks up and processes each job — including a simulated 2-second delay standing in for a real email API call.
 
**Free-tier note:** Render's free tier only offers a free instance type for Web Services, not Background Workers (which start at $7/month). To keep this project fully free to run, the BullMQ worker runs inside the same process as the main API server, using a separately configured Redis connection (`maxRetriesPerRequest: null`, as BullMQ requires). In a production system with real traffic, this would be split into its own independently scalable service — this is a deliberate, documented trade-off for a zero-cost deployment, not an oversight.
 
## Payment webhook simulation
 
`POST /webhooks/payment` simulates a payment gateway's asynchronous callback:
 
- **Signature verification**: the raw request body is signed with HMAC-SHA256 using a shared secret, and verified using `crypto.timingSafeEqual` (rather than `===`) to avoid timing-attack side channels. Verification requires capturing the exact raw bytes of the request body before JSON parsing, via Express's `express.json({ verify })` option.
- **Idempotent processing**: every webhook event carries a unique `eventId`, inserted into a `processed_webhook_events` table with a `UNIQUE` constraint before any processing happens. A duplicate delivery of the same event hits that constraint, is recognized as already-processed, and is skipped — returning `200` either way, since payment gateways interpret anything other than `2xx` as "retry this delivery."
A `fake-gateway.js` script simulates the gateway itself: correctly signing and sending webhook requests, and supporting deliberate duplicate delivery (same `eventId` sent twice) to prove idempotency.
 
## Database schema
 
```sql
-- Physical seat layout (never changes per show)
CREATE TABLE seats (
 id SERIAL PRIMARY KEY,
 screen_id INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
 seat_label VARCHAR(10) NOT NULL,
 UNIQUE (screen_id, seat_label)
);
 
-- Bookable inventory: one row per seat, per show
CREATE TABLE show_seats (
 id SERIAL PRIMARY KEY,
 show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
 seat_id INTEGER NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
 status VARCHAR(20) NOT NULL DEFAULT 'available',
 booking_id INTEGER,
 version INTEGER NOT NULL DEFAULT 0,
 UNIQUE (show_id, seat_id)
);
 
CREATE TABLE bookings (
 id SERIAL PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
 status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | confirmed | expired | payment_failed
 created_at TIMESTAMPTZ DEFAULT NOW()
);
 
CREATE TABLE processed_webhook_events (
 id SERIAL PRIMARY KEY,
 event_id VARCHAR(255) UNIQUE NOT NULL,
 processed_at TIMESTAMPTZ DEFAULT NOW()
);
```
 
A seat's availability is modeled per-show (`show_seats`), not on the seat itself, because the same physical seat is booked for one showing and free for another — a status column directly on `seats` would incorrectly make availability global across every show a screen ever hosts.
 
## API endpoints
 
| Method | Endpoint | Description |
|---|---|---|
| GET | `/shows` | List all shows with movie and screen details |
| GET | `/shows/:showId/seats` | Seat availability for a specific show |
| POST | `/shows/:showId/book` | Book seats — pessimistic locking (transaction + `FOR UPDATE`) |
| POST | `/shows/:showId/book-optimistic` | Book seats — optimistic locking (version column) |
| POST | `/bookings/:bookingId/pay` | Simulate initiating payment for a pending booking |
| POST | `/webhooks/payment` | Simulated payment gateway webhook (signed, idempotent) |
 
## Running locally
 
```bash
git clone https://github.com/kusuma-sankanna/seat-booking-system.git
cd seat-booking-system
npm install
```
 
`.env`:
```
DATABASE_URL=your_postgres_connection_string
REDIS_URL=your_redis_connection_string
WEBHOOK_SECRET=your_random_secret
PORT=3000
```
 
Run the schema against your Postgres database, then:
```bash
npm start
```
 
To test the concurrency fix under real load:
```bash
node src/race-test.js
```
 
To test the webhook (signature + idempotency):
```bash
node src/fake-gateway.js <bookingId>
node src/fake-gateway.js <bookingId> <same_eventId> # duplicate delivery, should be skipped
```
 
## Known limitations
 
- The background worker runs in-process with the API server (see "Background jobs" above) as a free-tier trade-off.
- The cron-based expiry sweep runs once a minute; a booking could theoretically hold a seat for slightly longer than its nominal TTL between sweeps.
- No real payment gateway or email provider is integrated — both are simulated, with clearly marked points where a real integration would slot in.
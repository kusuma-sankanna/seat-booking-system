const express = require('express');
const pool = require('./db');
require('dotenv').config();

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// List all shows
app.get('/shows', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT shows.id, movies.title, screens.name AS screen_name, shows.start_time, shows.price
      FROM shows
      JOIN movies ON shows.movie_id = movies.id
      JOIN screens ON shows.screen_id = screens.id
      ORDER BY shows.start_time ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// View seat availability for a specific show
app.get('/shows/:showId/seats', async (req, res) => {
  const { showId } = req.params;
  try {
    const result = await pool.query(`
      SELECT seats.seat_label, show_seats.status
      FROM show_seats
      JOIN seats ON show_seats.seat_id = seats.id
      WHERE show_seats.show_id = $1
      ORDER BY seats.seat_label ASC
    `, [showId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.post('/shows/:showId/book', async (req, res) => {
  const { showId } = req.params;
  const { seatLabels, userId } = req.body;

  if (!seatLabels || !Array.isArray(seatLabels) || seatLabels.length === 0 || !userId) {
    return res.status(400).json({ error: 'seatLabels (array) and userId are required' });
  }

  const client = await pool.connect(); // grab a single dedicated connection
  
  try {
    await client.query('BEGIN'); // start the transaction

    const bookingResult = await client.query(
      'INSERT INTO bookings (user_id, show_id, status) VALUES ($1, $2, $3) RETURNING id',
      [userId, showId, 'pending']
    );
    const bookingId = bookingResult.rows[0].id;

    for (const label of seatLabels) {
      const seatCheck = await client.query(
        `SELECT show_seats.id, show_seats.status
         FROM show_seats
         JOIN seats ON show_seats.seat_id = seats.id
         WHERE show_seats.show_id = $1 AND seats.seat_label = $2
         FOR UPDATE`,
        [showId, label]
      );

      if (seatCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Seat ${label} not found for this show` });
      }

      if (seatCheck.rows[0].status !== 'available') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Seat ${label} is already booked` });
      }

      await client.query(
        `UPDATE show_seats SET status = 'booked', booking_id = $1 WHERE id = $2`,
        [bookingId, seatCheck.rows[0].id]
      );
    }

    await client.query('COMMIT'); // everything succeeded — make it permanent

    res.status(201).json({ bookingId, showId, seats: seatLabels, status: 'pending' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  } finally {
    client.release(); // always return the connection to the pool
  }
});

//Optimistic locking
app.post('/shows/:showId/book-optimistic', async (req, res) => {
  const { showId } = req.params;
  const { seatLabels, userId } = req.body;

  if (!seatLabels || !Array.isArray(seatLabels) || seatLabels.length === 0 || !userId) {
    return res.status(400).json({ error: 'seatLabels (array) and userId are required' });
  }

  try {
    const bookingResult = await pool.query(
      'INSERT INTO bookings (user_id, show_id, status) VALUES ($1, $2, $3) RETURNING id',
      [userId, showId, 'pending']
    );
    const bookingId = bookingResult.rows[0].id;

    for (const label of seatLabels) {
      const seatCheck = await pool.query(
        `SELECT show_seats.id, show_seats.status, show_seats.version
         FROM show_seats
         JOIN seats ON show_seats.seat_id = seats.id
         WHERE show_seats.show_id = $1 AND seats.seat_label = $2`,
        [showId, label]
      );

      if (seatCheck.rows.length === 0) {
        return res.status(404).json({ error: `Seat ${label} not found for this show` });
      }

      const seat = seatCheck.rows[0];

      if (seat.status !== 'available') {
        return res.status(409).json({ error: `Seat ${label} is already booked` });
      }

      const updateResult = await pool.query(
        `UPDATE show_seats
         SET status = 'booked', booking_id = $1, version = version + 1
         WHERE id = $2 AND version = $3`,
        [bookingId, seat.id, seat.version]
      );

      if (updateResult.rowCount === 0) {
        return res.status(409).json({
          error: `Seat ${label} was booked by someone else a moment ago — please try a different seat.`
        });
      }
    }

    res.status(201).json({ bookingId, showId, seats: seatLabels, status: 'pending' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

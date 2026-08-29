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
  const { seatLabels, userId } = req.body; // e.g. { seatLabels: ["A1", "A2"], userId: 1 }

  if (!seatLabels || !Array.isArray(seatLabels) || seatLabels.length === 0 || !userId) {
    return res.status(400).json({ error: 'seatLabels (array) and userId are required' });
  }

  try {
    // 1. Create the booking record first, status 'pending'
    const bookingResult = await pool.query(
      'INSERT INTO bookings (user_id, show_id, status) VALUES ($1, $2, $3) RETURNING id',
      [userId, showId, 'pending']
    );
    const bookingId = bookingResult.rows[0].id;

    // 2. For each requested seat, check it's available, then mark it booked
    for (const label of seatLabels) {
      const seatCheck = await pool.query(
        `SELECT show_seats.id, show_seats.status
         FROM show_seats
         JOIN seats ON show_seats.seat_id = seats.id
         WHERE show_seats.show_id = $1 AND seats.seat_label = $2`,
        [showId, label]
      );

      if (seatCheck.rows.length === 0) {
        return res.status(404).json({ error: `Seat ${label} not found for this show` });
      }

      if (seatCheck.rows[0].status !== 'available') {
        return res.status(409).json({ error: `Seat ${label} is already booked` });
      }

      await pool.query(
        `UPDATE show_seats SET status = 'booked', booking_id = $1 WHERE id = $2`,
        [bookingId, seatCheck.rows[0].id]
      );
    }

    res.status(201).json({ bookingId, showId, seats: seatLabels, status: 'pending' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

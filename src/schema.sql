CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE movies (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    duration_minutes INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE screens (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,  --e.g. "screen 1"
    total_rows INTEGER NOT NULL,
    seats_per_row INTEGER NOT NULL
);

CREATE TABLE seats (
    id SERIAL PRIMARY KEY,
    screen_id INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    seat_label VARCHAR(50) NOT NULL,  --e.g. "A5"
    UNIQUE (screen_id, seat_label)
);

CREATE TABLE shows (
    id SERIAL PRIMARY KEY,
    movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    screen_id INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    price NUMERIC(10, 2) NOT NULL
);

CREATE TABLE show_seats (
    id SERIAL PRIMARY KEY,
    show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    seat_id INTEGER NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'available',  -- 'available' | 'booked'
    booking_id INTEGER,  -- nullable, filled once booked
    UNIQUE (show_id, seat_id)
);

CREATE INDEX idx_show_seats_show_id ON show_seats(show_id);

CREATE TABLE bookings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending' | 'confirmed' | 'cancelled'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookings_user_id ON bookings(user_id);
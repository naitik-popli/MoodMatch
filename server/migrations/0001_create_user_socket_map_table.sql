-- Migration script to create user_socket_map table

CREATE TABLE IF NOT EXISTS user_socket_map (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  partner_id INTEGER NOT NULL,
  socket_id VARCHAR(255) NOT NULL,
  UNIQUE (user_id)
);

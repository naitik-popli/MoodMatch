-- Migration to add partnerId column to chat_sessions table
ALTER TABLE chat_sessions
ADD COLUMN partnerId INTEGER;

-- Optionally, add foreign key constraint if users table exists
ALTER TABLE chat_sessions
ADD CONSTRAINT fk_partnerId FOREIGN KEY (partnerId) REFERENCES users(id);

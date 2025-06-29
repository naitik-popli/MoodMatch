import { sql } from "drizzle-orm";

export const up = sql`
  CREATE TABLE connected_users (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    mood VARCHAR(50) NOT NULL,
    connected_at TIMESTAMP NOT NULL DEFAULT NOW(),
    disconnected_at TIMESTAMP NULL
  );
`;

export const down = sql`
  DROP TABLE connected_users;
`;

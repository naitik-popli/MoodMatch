import request from 'supertest';
import express from 'express';
import { registerRoutes } from '../routes';

let app: express.Express;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  const server = await registerRoutes(app);
});

describe('API Endpoints', () => {
  it('GET /api/moods/stats should return mood statistics', async () => {
    const res = await request(app).get('/api/moods/stats');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('POST /api/session/create should create a session', async () => {
    const res = await request(app)
      .post('/api/session/create')
      .send({ mood: 'happy' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('sessionId');
    expect(res.body).toHaveProperty('userId');
    expect(res.body).toHaveProperty('mood', 'happy');
  });

  it('POST /api/session/:sessionId/end should end a session', async () => {
    // First create a session
    const createRes = await request(app)
      .post('/api/session/create')
      .send({ mood: 'happy' });
    const sessionId = createRes.body.sessionId;

    const res = await request(app)
      .post(`/api/session/${sessionId}/end`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  it('GET /api/db/tables should return database tables', async () => {
    const res = await request(app).get('/api/db/tables');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('tables');
    expect(res.body).toHaveProperty('hasTables');
  });
});

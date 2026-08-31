import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';

const apps: FastifyInstance[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe('GET /health', () => {
  it('reports API health without external services', async () => {
    const { app } = await buildApp();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ service: 'api', status: 'ok' });
  });
});


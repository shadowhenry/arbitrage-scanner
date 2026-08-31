import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { healthy } from '@arbitrage-scanner/core';
import { DashboardState } from './dashboard-state.js';
import { registerDashboardWebSocket } from './websocket-plugin.js';
import type {
  DashboardMetrics,
  FundingRow,
  MarketRow,
  OpportunityRow,
  SimulationRow,
  StrategyPerformanceRow,
} from './dashboard-types.js';

/** Absolute path to the dashboard static build (apps/api/public). */
const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV === 'production', trustProxy: true });
  const dashboardState = new DashboardState();

  // Register WebSocket support
  app.register(websocketPlugin);

  // Serve the dashboard SPA from the same process when a build is present
  // (in Docker the dist is copied to apps/api/public).
  if (existsSync(PUBLIC_DIR)) {
    await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/' });
  }

  // Health check
  app.get('/health', async () => healthy('api'));

  // Dashboard snapshot (REST fallback)
  app.get('/api/dashboard', async () => dashboardState.getSnapshot());

  // REST endpoints for scanners to push data.
  // Accepts either a single OpportunityRow or an array (batch upsert).
  app.post('/api/opportunities', async (request, reply) => {
    const body = request.body as unknown;
    const rows: OpportunityRow[] = Array.isArray(body) ? body as OpportunityRow[] : [body as OpportunityRow];
    for (const opportunity of rows) {
      dashboardState.upsertOpportunity(opportunity);
    }
    return reply.code(202).send({ accepted: true, count: rows.length });
  });

  app.delete('/api/opportunities/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    dashboardState.removeOpportunity(id);
    return reply.code(202).send({ accepted: true });
  });

  app.post('/api/metrics', async (request, reply) => {
    const metrics = request.body as DashboardMetrics;
    dashboardState.updateMetrics(metrics);
    return reply.code(202).send({ accepted: true });
  });

  app.post('/api/funding', async (request, reply) => {
    const funding = request.body as FundingRow[];
    dashboardState.updateFunding(funding);
    return reply.code(202).send({ accepted: true });
  });

  app.post('/api/markets', async (request, reply) => {
    const markets = request.body as MarketRow[];
    dashboardState.updateMarkets(markets);
    return reply.code(202).send({ accepted: true });
  });

  app.post('/api/simulations', async (request, reply) => {
    const simulations = request.body as SimulationRow[];
    dashboardState.updateSimulations(simulations);
    return reply.code(202).send({ accepted: true });
  });

  app.post('/api/strategies', async (request, reply) => {
    const strategies = request.body as StrategyPerformanceRow[];
    dashboardState.updateStrategies(strategies);
    return reply.code(202).send({ accepted: true });
  });

  // WebSocket endpoint for dashboard real-time data
  app.after(() => {
    registerDashboardWebSocket(app, dashboardState);
  });

  // SPA fallback: serve index.html for non-API client routes (Vue Router paths).
  // API routes keep their own 404 behaviour.
  if (existsSync(PUBLIC_DIR)) {
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return { app, dashboardState };
}

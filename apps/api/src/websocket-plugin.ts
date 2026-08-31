import type { FastifyInstance } from 'fastify';
import type { DashboardState } from './dashboard-state.js';

interface SubscribeMessage {
  readonly type: 'subscribe';
  readonly channels?: readonly string[];
}

/**
 * Registers the WebSocket endpoint for dashboard real-time data.
 *
 * Clients connect to /ws and send { type: 'subscribe', channels: ['dashboard'] }
 * to receive real-time dashboard updates.
 */
export function registerDashboardWebSocket(
  fastify: FastifyInstance,
  state: DashboardState,
): void {
  fastify.get('/ws', { websocket: true }, (socket) => {
    let subscribed = false;
    let unsubscribe: (() => void) | undefined;

    socket.on('message', (raw: Buffer | string) => {
      try {
        const message = JSON.parse(raw.toString()) as SubscribeMessage;
        if (message.type === 'subscribe' && message.channels?.includes('dashboard')) {
          if (!subscribed) {
            subscribed = true;
            unsubscribe = state.subscribe((data) => {
              if (socket.readyState === socket.OPEN) {
                socket.send(JSON.stringify(data));
              }
            });
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    socket.on('close', () => {
      unsubscribe?.();
      subscribed = false;
    });

    socket.on('error', () => {
      unsubscribe?.();
      subscribed = false;
    });
  });
}

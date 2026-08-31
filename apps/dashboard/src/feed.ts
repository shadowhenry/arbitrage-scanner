import { computed, onBeforeUnmount, readonly, ref } from 'vue';
import { demoSnapshot } from './mock-data.js';
import type { ConnectionStatus, DashboardMessage, DashboardSnapshot, OpportunityRow } from './types.js';

export function applyDashboardMessage(snapshot: DashboardSnapshot, message: DashboardMessage): DashboardSnapshot {
  if (message.type === 'snapshot') return message.data;
  if (message.type === 'opportunity.upsert') {
    const remaining = snapshot.opportunities.filter((item) => item.id !== message.data.id);
    return { ...snapshot, opportunities: [message.data, ...remaining] };
  }
  if (message.type === 'opportunity.remove') {
    return { ...snapshot, opportunities: snapshot.opportunities.filter((item) => item.id !== message.id) };
  }
  if (message.type === 'metrics') return { ...snapshot, metrics: message.data };
  if (message.type === 'funding') return { ...snapshot, funding: message.data };
  if (message.type === 'markets') return { ...snapshot, markets: message.data };
  if (message.type === 'simulations') return { ...snapshot, simulations: message.data };
  return { ...snapshot, strategies: message.data };
}

export function useDashboardFeed() {
  const snapshot = ref<DashboardSnapshot>(demoSnapshot);
  const status = ref<ConnectionStatus>('connecting');
  const lastUpdate = ref<Date>(new Date());
  let socket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let reconnectAttempt = 0;
  let stopped = false;

  const configuredUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const socketUrl = configuredUrl ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

  function scheduleReconnect(): void {
    if (stopped) return;
    status.value = reconnectAttempt === 0 ? 'demo' : 'reconnecting';
    const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(connect, delay);
  }

  function connect(): void {
    if (stopped) return;
    status.value = reconnectAttempt === 0 ? 'connecting' : 'reconnecting';
    try {
      socket = new WebSocket(socketUrl);
      socket.addEventListener('open', () => {
        reconnectAttempt = 0;
        status.value = 'live';
        socket?.send(JSON.stringify({ type: 'subscribe', channels: ['dashboard'] }));
      });
      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data)) as DashboardMessage;
          snapshot.value = applyDashboardMessage(snapshot.value, message);
          lastUpdate.value = new Date();
        } catch { /* Ignore malformed external messages and retain the last valid snapshot. */ }
      });
      socket.addEventListener('close', scheduleReconnect);
      socket.addEventListener('error', () => socket?.close());
    } catch { scheduleReconnect(); }
  }

  connect();
  onBeforeUnmount(() => {
    stopped = true;
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    socket?.close();
  });

  const opportunities = computed<readonly OpportunityRow[]>(() =>
    [...snapshot.value.opportunities].sort((a, b) =>
      b.expectedProfitUsd - a.expectedProfitUsd || b.returnOnCapital - a.returnOnCapital));

  return { snapshot: readonly(snapshot), opportunities, status: readonly(status), lastUpdate: readonly(lastUpdate), socketUrl };
}

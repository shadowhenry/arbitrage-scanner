import WebSocket from 'ws';

export interface ReconnectingWebSocketOptions {
  readonly staleAfterMs?: number;
  readonly maxLifetimeMs?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly random?: () => number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatPayload?: string;
  readonly onOpen?: (send: (data: string) => void) => void;
  readonly onMessage: (data: string) => void;
  readonly onStale?: () => void;
  readonly onError?: (error: Error) => void;
}

export function calculateReconnectDelay(
  attempt: number,
  initialBackoffMs: number,
  maxBackoffMs: number,
  random: () => number,
): number {
  const base = Math.min(maxBackoffMs, initialBackoffMs * (2 ** attempt));
  return Math.floor(base * (0.5 + random() * 0.5));
}

export class ReconnectingWebSocket {
  readonly #url: string;
  readonly #options: Required<Pick<ReconnectingWebSocketOptions,
    'staleAfterMs' | 'maxLifetimeMs' | 'initialBackoffMs' | 'maxBackoffMs' | 'random'>>
    & ReconnectingWebSocketOptions;
  #socket: WebSocket | null = null;
  #stopped = true;
  #attempt = 0;
  #lastMessageAt = 0;
  #watchdog: ReturnType<typeof setInterval> | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #lifetimeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string, options: ReconnectingWebSocketOptions) {
    this.#url = url;
    this.#options = {
      staleAfterMs: 10_000,
      maxLifetimeMs: 23 * 60 * 60 * 1_000,
      initialBackoffMs: 500,
      maxBackoffMs: 30_000,
      random: Math.random,
      ...options,
    };
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    this.#clearTimers();
    this.#socket?.close();
    this.#socket = null;
  }

  #connect(): void {
    if (this.#stopped) return;
    const socket = new WebSocket(this.#url);
    this.#socket = socket;

    socket.on('open', () => {
      this.#attempt = 0;
      this.#lastMessageAt = Date.now();
      this.#options.onOpen?.((data) => socket.send(data));
      if (this.#options.heartbeatIntervalMs !== undefined && this.#options.heartbeatPayload !== undefined) {
        const heartbeatPayload = this.#options.heartbeatPayload;
        this.#heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(heartbeatPayload);
        }, this.#options.heartbeatIntervalMs);
      }
      this.#watchdog = setInterval(() => {
        if (Date.now() - this.#lastMessageAt > this.#options.staleAfterMs) {
          this.#options.onStale?.();
          socket.terminate();
        }
      }, Math.max(250, Math.floor(this.#options.staleAfterMs / 2)));
      this.#lifetimeTimer = setTimeout(() => socket.close(), this.#options.maxLifetimeMs);
    });

    socket.on('ping', (data) => {
      this.#lastMessageAt = Date.now();
      socket.pong(data);
    });
    socket.on('pong', () => { this.#lastMessageAt = Date.now(); });
    socket.on('message', (data) => {
      this.#lastMessageAt = Date.now();
      this.#options.onMessage(data.toString());
    });
    socket.on('error', (error) => this.#options.onError?.(error));
    socket.on('close', () => this.#scheduleReconnect());
  }

  #scheduleReconnect(): void {
    this.#clearConnectionTimers();
    this.#socket = null;
    if (this.#stopped || this.#reconnectTimer !== null) return;
    const delay = calculateReconnectDelay(
      this.#attempt,
      this.#options.initialBackoffMs,
      this.#options.maxBackoffMs,
      this.#options.random,
    );
    this.#attempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delay);
  }

  #clearConnectionTimers(): void {
    if (this.#watchdog !== null) clearInterval(this.#watchdog);
    if (this.#heartbeat !== null) clearInterval(this.#heartbeat);
    if (this.#lifetimeTimer !== null) clearTimeout(this.#lifetimeTimer);
    this.#watchdog = null;
    this.#heartbeat = null;
    this.#lifetimeTimer = null;
  }

  #clearTimers(): void {
    this.#clearConnectionTimers();
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
  }
}

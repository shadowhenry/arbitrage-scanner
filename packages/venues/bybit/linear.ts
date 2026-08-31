import { BybitPublicAdapter } from './client.js';
import type { BybitAdapterOptions, BybitLinearState, BybitSymbol } from './types.js';

export interface BybitLinearOptions extends BybitAdapterOptions {
  readonly onState: (symbol: BybitSymbol, state: BybitLinearState) => void;
}

export class BybitLinearAdapter {
  readonly #adapter: BybitPublicAdapter;

  constructor(options: BybitLinearOptions) {
    this.#adapter = new BybitPublicAdapter({
      ...options,
      category: 'linear',
      onState: (symbol, state) => {
        if ('market' in state) options.onState(symbol, state);
      },
    });
  }

  start(): void { this.#adapter.start(); }
  stop(): void { this.#adapter.stop(); }
  handleMessage(message: string): void { this.#adapter.handleMessage(message); }
  getState(symbol: BybitSymbol, now = Date.now()): BybitLinearState | undefined {
    const state = this.#adapter.getState(symbol, now);
    return state !== undefined && 'market' in state ? state : undefined;
  }
}


import { BybitPublicAdapter } from './client.js';
import type { BybitAdapterOptions, BybitSpotState, BybitSymbol } from './types.js';

export interface BybitSpotOptions extends BybitAdapterOptions {
  readonly onState: (symbol: BybitSymbol, state: BybitSpotState) => void;
}

export class BybitSpotAdapter {
  readonly #adapter: BybitPublicAdapter;

  constructor(options: BybitSpotOptions) {
    this.#adapter = new BybitPublicAdapter({
      ...options,
      category: 'spot',
      onState: (symbol, state) => {
        if ('quote' in state) options.onState(symbol, state);
      },
    });
  }

  start(): void { this.#adapter.start(); }
  stop(): void { this.#adapter.stop(); }
  handleMessage(message: string): void { this.#adapter.handleMessage(message); }
  getState(symbol: BybitSymbol, now = Date.now()): BybitSpotState | undefined {
    const state = this.#adapter.getState(symbol, now);
    return state !== undefined && 'quote' in state ? state : undefined;
  }
}


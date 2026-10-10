import { Awareness } from '@y/protocols/awareness';
import * as Y from '@y/y';
import { encodeAny } from 'lib0/buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProviderStore } from '../useProviderStore';

const { WebsocketProvider } = vi.hoisted(() => ({
  WebsocketProvider: vi.fn(),
}));

vi.mock('@y/websocket', () => ({ WebsocketProvider }));

class FakeProvider {
  shouldConnect = true;
  synced = false;
  awareness!: Awareness;
  doc = { destroy: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
  destroy = vi.fn();

  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  on(event: string, listener: (...args: unknown[]) => void) {
    this.listeners[event] = [...(this.listeners[event] ?? []), listener];
    return this;
  }

  off(event: string, listener: (...args: unknown[]) => void) {
    this.listeners[event] = (this.listeners[event] ?? []).filter(
      (l) => l !== listener,
    );
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    (this.listeners[event] ?? []).forEach((listener) => listener(...args));
  }

  close(code: number | null) {
    this.emit(
      'connection-close',
      code === null ? null : { code, reason: 'close' },
    );
  }
}

let provider: FakeProvider;

beforeEach(() => {
  vi.useFakeTimers();
  provider = new FakeProvider();
  WebsocketProvider.mockImplementation(function (
    _url: string,
    _room: string,
    _doc: Y.Doc,
    options: { awareness: Awareness },
  ) {
    provider.awareness = options.awareness;
    vi.spyOn(provider.awareness, 'destroy');
    return provider;
  });
  useProviderStore.getState().destroyProvider();
  useProviderStore
    .getState()
    .createProvider('ws://localhost/collaboration/ws/v1/docs', 'doc-id');
});

afterEach(() => {
  useProviderStore.getState().destroyProvider();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useProviderStore', () => {
  it('creates a websocket provider for the document', () => {
    expect(WebsocketProvider).toHaveBeenCalledWith(
      'ws://localhost/collaboration/ws/v1/docs',
      'doc-id',
      expect.any(Y.Doc),
      expect.anything(),
    );
    expect(useProviderStore.getState().provider).toBe(provider);
  });

  it('does not publish reader presence', () => {
    useProviderStore.getState().destroyProvider();
    useProviderStore
      .getState()
      .createProvider(
        'ws://localhost/collaboration/ws/v1/docs',
        'doc-id',
        undefined,
        {
          readOnly: true,
        },
      );
    const options = WebsocketProvider.mock.lastCall?.[3];
    expect(options.awareness).toBeInstanceOf(Awareness);
    expect(options.awareness.getLocalState()).toBeNull();
  });

  it('marks the connection as established and ready when the websocket connects', () => {
    provider.emit('status', { status: 'connected' });
    expect(useProviderStore.getState().isConnected).toBe(true);
    expect(useProviderStore.getState().isReady).toBe(true);
  });

  it('reports a lost connection when a previously connected socket closes', () => {
    provider.emit('status', { status: 'connected' });
    provider.close(1006);
    vi.advanceTimersByTime(3000);
    expect(useProviderStore.getState().isConnected).toBe(false);
    expect(useProviderStore.getState().hasLostConnection).toBe(true);
    expect(useProviderStore.getState().isPermanentlyClosed).toBe(false);
  });

  it('does not report a lost connection while a socket that never opened retries', () => {
    provider.close(1006);
    provider.close(1006);
    vi.advanceTimersByTime(3000);
    expect(useProviderStore.getState().hasLostConnection).toBe(false);
    expect(useProviderStore.getState().isPermanentlyClosed).toBe(false);
  });

  it('does not re-render subscribers on repeated retries', () => {
    provider.close(1006);
    const listener = vi.fn();
    useProviderStore.subscribe(listener);
    provider.close(1006);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops retrying after the server refuses the connection until rechecked', () => {
    provider.emit('status', { status: 'connected' });
    provider.close(4404);
    vi.advanceTimersByTime(3000);
    expect(useProviderStore.getState().isPermanentlyClosed).toBe(true);
    expect(useProviderStore.getState().hasLostConnection).toBe(false);
    expect(provider.shouldConnect).toBe(false);
    useProviderStore.getState().pauseForInactivity();
    useProviderStore.getState().resumeFromInactivity();
    expect(provider.connect).not.toHaveBeenCalled();
    useProviderStore.getState().reconnect();
    expect(useProviderStore.getState().isPermanentlyClosed).toBe(false);
    expect(provider.connect).toHaveBeenCalled();
  });

  it('does not treat a client-initiated close as a lost connection', () => {
    provider.close(null);
    vi.advanceTimersByTime(3000);
    expect(useProviderStore.getState().hasLostConnection).toBe(false);
    expect(useProviderStore.getState().isPermanentlyClosed).toBe(false);
  });

  it('reopens the connection through reconnect', () => {
    provider.emit('status', { status: 'connected' });
    provider.close(1006);
    vi.advanceTimersByTime(3000);
    useProviderStore.getState().reconnect();
    expect(provider.connect).toHaveBeenCalled();
  });

  it('pauses and resumes the connection with the tab', () => {
    provider.emit('status', { status: 'connected' });
    provider.close(1006);
    vi.advanceTimersByTime(3000);
    useProviderStore.getState().pauseForInactivity();
    expect(useProviderStore.getState().isPausedForInactivity).toBe(true);
    expect(provider.disconnect).toHaveBeenCalled();
    useProviderStore.getState().resumeFromInactivity();
    expect(useProviderStore.getState().isPausedForInactivity).toBe(false);
    expect(provider.connect).toHaveBeenCalled();
  });

  it('reports the document as synced when the provider syncs', () => {
    provider.synced = true;
    provider.emit('sync', true);
    expect(useProviderStore.getState().isSynced).toBe(true);
    expect(useProviderStore.getState().isReady).toBe(true);
  });

  it('reports the websocket provider as synced once the http fallback syncs', async () => {
    // The socket never connects; the editor binds only to a synced provider.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new Uint8Array(
              encodeAny({ doc: Y.encodeStateAsUpdate(new Y.Doc()) }),
            ),
          ),
      ),
    );
    // The fallback starts 5s after the socket fails, then polls once.
    await vi.advanceTimersByTimeAsync(6000);
    expect(provider.synced).toBe(true);
    expect(useProviderStore.getState().isSynced).toBe(true);
  });

  it('tears everything down with the document', () => {
    useProviderStore.getState().destroyProvider();
    expect(provider.destroy).toHaveBeenCalled();
    // eslint-disable-next-line jest/unbound-method
    expect(provider.awareness.destroy).toHaveBeenCalled();
    expect(provider.doc.destroy).toHaveBeenCalled();
    expect(useProviderStore.getState().provider).toBeUndefined();
    expect(useProviderStore.getState().isConnected).toBe(false);
    expect(useProviderStore.getState().isReady).toBe(false);
    expect(useProviderStore.getState().isSynced).toBe(false);
  });
});

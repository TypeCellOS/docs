import * as Y from '@y/y';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDocsVersionStorage } from '../createDocsVersionStorage';

const { storage, collectFragmentIds } = vi.hoisted(() => ({
  storage: {
    showCurrentVersion: true,
    historyIncludesBeginning: false,
    list: vi.fn(),
    getContent: vi.fn(),
    getAttributions: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  },
  collectFragmentIds: vi.fn(),
}));

vi.mock('@blocknote/core/y', () => ({
  createYHubVersionStorage: () => storage,
  collectFragmentIds,
}));

const makeStorage = () =>
  createDocsVersionStorage({
    baseUrl: 'https://example.test/collaboration',
    org: 'docs',
    docId: 'document',
    fragment: { doc: new Y.Doc() } as Y.Node,
    beforeRestoreName: 'Before restore',
  });

describe('Docs version storage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('exposes history and restore without enabling named-version actions', () => {
    const result = makeStorage();

    expect(result.list).toBe(storage.list);
    expect(result.getContent).toBe(storage.getContent);
    expect(result.getAttributions).toBe(storage.getAttributions);
    expect(result.restore).toBeTypeOf('function');
    expect(result).not.toHaveProperty('create');
    expect(result).not.toHaveProperty('rename');
    expect(result).not.toHaveProperty('remove');
  });

  it('checkpoints the current head, not the selected preview, before restore', async () => {
    const signal = expect.any(AbortSignal);
    const head = new Uint8Array([1, 2, 3]);
    storage.list.mockResolvedValue({
      ok: true,
      value: {
        snapshots: [
          { id: '10', createdAt: 10 },
          { id: '20', createdAt: 20 },
        ],
      },
    });
    storage.getContent.mockResolvedValue({ ok: true, value: head });
    storage.create.mockResolvedValue({
      ok: false,
      error: { type: 'conflict' },
    });

    await expect(makeStorage().restore('10')).resolves.toEqual({
      ok: false,
      error: { type: 'conflict' },
    });
    expect(storage.getContent).toHaveBeenCalledWith('20', signal);
    expect(storage.create).toHaveBeenCalledWith(head, 'Before restore');
    expect(collectFragmentIds).not.toHaveBeenCalled();
  });

  it.each(['-1', 'invalid', String(Number.MAX_SAFE_INTEGER)])(
    'rejects invalid restore timestamp %s before requesting history',
    async (id) => {
      await expect(makeStorage().restore(id)).rejects.toThrow(
        'Invalid version timestamp',
      );
      expect(storage.list).not.toHaveBeenCalled();
    },
  );

  it('does not restore when history access is forbidden', async () => {
    storage.list.mockResolvedValue({
      ok: false,
      error: { type: 'forbidden' },
    });

    await expect(makeStorage().restore('10')).resolves.toEqual({
      ok: false,
      error: { type: 'forbidden' },
    });
    expect(storage.create).not.toHaveBeenCalled();
    expect(collectFragmentIds).not.toHaveBeenCalled();
  });
});

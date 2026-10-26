import {
  type VersionResult,
  type VersionSnapshot,
} from '@blocknote/core/extensions';
import {
  type YHubVersionStorageOptions,
  collectFragmentIds,
  type createYHubVersionStorage,
} from '@blocknote/core/y';
import * as Y from '@y/y';
import { decodeAny, encodeAny } from 'lib0/buffer';

/** Restore the editor using only history inside Docs' access-date boundary. */
export const createDocsVersionStorage = (
  options: YHubVersionStorageOptions & {
    fragment: Y.Node;
    beforeRestoreName: string;
  },
): Omit<
  ReturnType<typeof createYHubVersionStorage>,
  'create' | 'rename' | 'remove'
> => {
  const liveDoc: unknown = options.fragment.doc;
  if (!(liveDoc instanceof Y.Doc)) {
    throw new Error(
      'Version history requires an attached collaboration document',
    );
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('YHub timeout must be a positive finite number');
  }
  const documentPath = `${encodeURIComponent(options.org)}/${encodeURIComponent(options.docId)}`;

  async function request<T>(
    endpoint: string,
    decode: (data: ArrayBuffer) => T,
    init?: RequestInit,
    params?: Record<string, string | number | boolean>,
  ): Promise<VersionResult<T>> {
    const query = new URLSearchParams(
      Object.entries({ ...params, ...options.queryParams })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
    const url = new URL(
      `${options.baseUrl}/${endpoint}/v1/${documentPath}${query.size ? `?${query}` : ''}`,
    );
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('YHub requires an HTTP or HTTPS URL');
    }
    const headers = new Headers(options.headers);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const timeout = AbortSignal.timeout(timeoutMs);
    let data: ArrayBuffer;
    try {
      const response = await fetch(url, {
        ...init,
        credentials: 'include',
        signal: init?.signal
          ? AbortSignal.any([init.signal, timeout])
          : timeout,
        headers,
      });
      if (!response.ok) {
        return {
          ok: false,
          error:
            response.status === 401 || response.status === 403
              ? { type: 'forbidden' }
              : response.status === 409 || response.status === 412
                ? { type: 'conflict' }
                : response.status === 404
                  ? { type: 'not-found' }
                  : { type: 'server', status: response.status },
        };
      }
      data = await response.arrayBuffer();
    } catch (error) {
      if (init?.signal?.aborted) {
        throw error;
      }
      if (timeout.aborted) {
        return {
          ok: false,
          error: {
            type: 'timeout',
            outcome: init?.method ? 'unknown' : 'unchanged',
          },
        };
      }
      if (error instanceof TypeError) {
        return { ok: false, error: { type: 'network' } };
      }
      throw error;
    }
    return { ok: true, value: decode(data) };
  }

  // The retained preview's client has no credential/fetch option. Keep its
  // storage contract, but use Docs' authenticated transport for every operation.
  interface Activity {
    from: number;
    to: number;
    by?: string | Array<string | null> | null;
    customAttributions?: Array<{ k: string; v: string }>;
    version?: { name: string; custom?: unknown };
  }
  const activityParams = () => ({
    limit: 50,
    groupMaxGap: 3_600_000,
    groupMaxDuration: 43_200_000,
    groupByUser: false,
    customAttributions: true,
    ...options.activityParams,
    order: 'desc',
    versions: true,
  });
  const getActivity = (
    params: Record<string, string | number | boolean>,
    signal: AbortSignal,
  ) =>
    request(
      'activity',
      (data) =>
        (decodeAny(new Uint8Array(data)) as { activity: Activity[] }).activity,
      { signal },
      params,
    );
  const timestamp = (id: string) => {
    const value = Number(id);
    if (
      !id ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value === Number.MAX_SAFE_INTEGER
    ) {
      throw new Error('Invalid version timestamp');
    }
    return value;
  };
  const storage: Omit<
    ReturnType<typeof createYHubVersionStorage>,
    'create' | 'rename' | 'remove' | 'restore'
  > = {
    // Keep checkpoint creation internal; named-version actions are unavailable.
    showCurrentVersion: false,
    historyIncludesBeginning: true,
    async list(signal, cursor) {
      const params: Record<string, string | number | boolean> =
        cursor === undefined
          ? activityParams()
          : Object.fromEntries(new URLSearchParams(cursor));
      const limit = Number(params.limit);
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        throw new Error('Invalid history page size');
      }
      const [result, first] = await Promise.all([
        getActivity({ ...params, limit: limit + 1 }, signal),
        cursor === undefined
          ? getActivity(
              {
                from: 0,
                order: 'asc',
                limit: 1,
                group: false,
                versions: true,
                customAttributions: true,
              },
              signal,
            )
          : undefined,
      ]);
      if (!result.ok) {
        return result;
      }
      if (first && !first.ok) {
        return first;
      }
      const entries = result.value.slice(0, limit);
      const oldest = entries.at(-1);
      let nextCursor: string | undefined;
      if (result.value.length > limit && oldest && oldest.from > 0) {
        nextCursor = new URLSearchParams(
          Object.entries({ ...params, to: oldest.from - 1 })
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, String(value)]),
        ).toString();
      }
      if (first?.value[0]) {
        const start = Math.max(0, first.value[0].from - 1);
        entries.push({
          ...first.value[0],
          from: start,
          to: start,
          version: undefined,
        });
      }
      return {
        ok: true,
        value: {
          nextCursor,
          snapshots: entries.map((entry): VersionSnapshot => {
            const custom = entry.version?.custom;
            const restoredFrom =
              custom !== null &&
              typeof custom === 'object' &&
              'restoredFrom' in custom
                ? custom.restoredFrom
                : undefined;
            return {
              id: String(entry.to),
              createdAt: entry.to,
              by: (Array.isArray(entry.by)
                ? entry.by
                : (entry.by?.split(',') ?? [])
              )
                .filter((id): id is string => !!id?.trim())
                .map((id) => id.trim()),
              name: entry.version?.name || undefined,
              metadata: custom,
              restoredFrom:
                typeof restoredFrom === 'number' &&
                Number.isFinite(restoredFrom)
                  ? { id: String(restoredFrom), createdAt: restoredFrom }
                  : undefined,
              customAttributions: Object.fromEntries(
                entry.customAttributions?.map(({ k, v }) => [k, v]) ?? [],
              ),
            };
          }),
        },
      };
    },
    getContent(id, signal) {
      return request(
        'changeset',
        (data) => {
          const { ydoc } = decodeAny(new Uint8Array(data)) as {
            ydoc?: Uint8Array;
          };
          if (!ydoc) {
            throw new Error('YHub returned no changeset document');
          }
          return Y.convertUpdateFormatV1ToV2(ydoc);
        },
        { signal },
        { ydoc: true, to: timestamp(id) },
      );
    },
    getAttributions(target, baselineId, _capturedAt, signal) {
      return request(
        'changeset',
        (data) => {
          const { attributions } = decodeAny(new Uint8Array(data)) as {
            attributions?: Uint8Array;
          };
          if (!attributions) {
            throw new Error('YHub returned no attributions');
          }
          return Y.decodeContentMap(attributions);
        },
        { signal },
        {
          from: timestamp(baselineId) + 1,
          ...(target.type === 'current' ? {} : { to: timestamp(target.id) }),
          attributions: true,
        },
      );
    },
  };
  return {
    ...storage,
    async restore(id) {
      const to = timestamp(id);
      const signal = new AbortController().signal;
      const versions = await storage.list(signal);
      if (!versions.ok) {
        return versions;
      }
      const current = versions.value.snapshots.reduce<
        (typeof versions.value.snapshots)[number] | undefined
      >(
        (latest, version) =>
          !latest || version.createdAt > latest.createdAt ? version : latest,
        undefined,
      );
      if (current) {
        // Pin the known server head, never the selected historical preview.
        // Later edits remain in additive history even if they race this label.
        const existing = await request(
          'version',
          (data) =>
            (decodeAny(new Uint8Array(data)) as { versions: unknown[] })
              .versions[0],
          undefined,
          { from: current.createdAt, to: current.createdAt },
        );
        if (!existing.ok) {
          return existing;
        }
        if (!existing.value) {
          const saved = await request('version', () => undefined, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-lib0any' },
            body: encodeAny({
              type: 'version:v1',
              t: current.createdAt,
              name: options.beforeRestoreName,
            }) as BodyInit,
          });
          if (!saved.ok) {
            return saved;
          }
        }
      }
      // changeset retains deleted descendants inside this window, but collects
      // older deleted content. Unlike gc=false, it respects the access-date ray.
      // No finite `to`: the IDs must cover the latest available editor state.
      const from = to + 1;
      const retained = await request(
        'changeset',
        (data) => {
          const { ydoc } = decodeAny(new Uint8Array(data)) as {
            ydoc?: Uint8Array;
          };
          if (!ydoc) {
            throw new Error('YHub returned no changeset document');
          }
          return ydoc;
        },
        undefined,
        { from, ydoc: true },
      );
      if (!retained.ok) {
        return retained;
      }
      const ids = collectFragmentIds(options.fragment, retained.value);
      // Native rollback is additive, not a lock: new IDs written after this
      // snapshot may survive. Other roots are excluded from both ID sets.
      const restored = await request('rollback', () => undefined, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-lib0any' },
        body: encodeAny({
          from,
          contentIds: Y.encodeContentIds({ inserts: ids, deletes: ids }),
        }) as BodyInit,
      });
      if (!restored.ok) {
        return restored;
      }
      // Success means the live doc received the restore, even if the websocket
      // is delayed. Fetch only current GC content, not restricted full history.
      const document = await request('ydoc', (data) => {
        const { doc } = decodeAny(new Uint8Array(data)) as { doc?: Uint8Array };
        if (!doc) {
          throw new Error('YHub returned no document state');
        }
        return doc;
      });
      if (!document.ok) {
        return document.error.type === 'timeout'
          ? { ok: false, error: { type: 'timeout', outcome: 'unknown' } }
          : document;
      }
      Y.applyUpdate(liveDoc, document.value);
      return { ok: true, value: undefined };
    },
  };
};

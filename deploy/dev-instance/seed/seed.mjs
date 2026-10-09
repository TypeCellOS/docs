// Prepares the sample document of the dev instance: step 1 of scripts/seed.sh.
//
// It signs in as the demo users (which creates them in Docs), lets the first
// one create the document and give the others access, and builds the recorded
// history offline: every edit attributed to its author at a past timestamp,
// the way yhub records live edits (`insert`/`insertAt` in the contentmap). The
// result is written to OUT for import.mjs, which stores it in yhub.
//
// Nothing waits in real time: the timestamps are in the data, not the clock.
//
// Environment:
//   DOCS_URL    https://<docs host>
//   SEED_USERS  demo users, user:password pairs, comma separated. The first one
//               owns the document; the authors of the versions take turns.
//   SEED_DATA   recorded versions (JSON: [{name, steps}])
//   SEED_DATE   day of the recorded meeting, YYYY-MM-DD (default 2026-10-07)
//   OUT         where to write the history to import
import fs from 'node:fs';

import * as Y from '@y/y';
import { decodeAny, encodeAny } from 'lib0/buffer';

import { FRAGMENT, createReplay } from './replay.mjs';

const ORG = 'docs';
const DOCS_URL = required('DOCS_URL').replace(/\/$/, '');
const TITLE = process.env.SEED_TITLE || '07/10 meeting agenda (sample)';
const DATE = process.env.SEED_DATE || '2026-10-07';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function log(message) {
  console.log(`seed: ${message}`);
}

/** A cookie jar per host, enough for the sign-in redirects. */
function createSession() {
  const jars = new Map();

  function jarFor(url) {
    const { host } = new URL(url);
    if (!jars.has(host)) {
      jars.set(host, new Map());
    }
    return jars.get(host);
  }

  async function request(url, init = {}) {
    const jar = jarFor(url);
    const headers = new Headers(init.headers);
    if (jar.size) {
      headers.set(
        'cookie',
        [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }
    const response = await fetch(url, { ...init, headers, redirect: 'manual' });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '' || /max-age=0/i.test(line)) {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
    }
    return response;
  }

  async function follow(url, init = {}) {
    let response = await request(url, init);
    let current = url;
    for (
      let i = 0;
      i < 20 && [301, 302, 303, 307, 308].includes(response.status);
      i++
    ) {
      current = new URL(response.headers.get('location'), current).toString();
      await response.arrayBuffer();
      response = await request(current);
    }
    return { response, url: current };
  }

  return {
    request,
    follow,
    cookie: (url, name) => jarFor(url).get(name),
  };
}

/** Signs in through the OIDC flow of the backend and the Keycloak login form. */
async function signIn(username, password) {
  const session = createSession();
  const { response, url } = await session.follow(
    `${DOCS_URL}/api/v1.0/authenticate/`,
  );
  const html = await response.text();
  const action = html.match(
    /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/,
  )?.[1];
  if (!action) {
    throw new Error(`No login form for ${username} at ${url} (${response.status})`);
  }
  const done = await session.follow(action.replaceAll('&amp;', '&'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, credentialId: '' }),
  });
  await done.response.arrayBuffer();

  async function api(path, init = {}) {
    const headers = new Headers(init.headers);
    const csrf = session.cookie(DOCS_URL, 'csrftoken');
    if (csrf) {
      headers.set('x-csrftoken', csrf);
    }
    headers.set('referer', `${DOCS_URL}/`);
    return session.request(`${DOCS_URL}${path}`, { ...init, headers });
  }

  const me = await api('/api/v1.0/users/me/');
  if (!me.ok) {
    throw new Error(`Sign-in failed for ${username}: ${me.status}`);
  }
  return { username, user: await me.json(), api };
}

async function json(response, what) {
  if (!response.ok) {
    throw new Error(`${what} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function hasContent(user, docId) {
  const response = await user.api(`/collaboration/ydoc/v1/${ORG}/${docId}?gc=true`);
  if (!response.ok) {
    throw new Error(`Reading the document failed: ${response.status}`);
  }
  const { doc } = decodeAny(new Uint8Array(await response.arrayBuffer()));
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, doc);
  return ydoc.get(FRAGMENT).length > 0;
}

async function ensureAccesses(owner, users, docId) {
  const listed = await json(
    await owner.api(`/api/v1.0/documents/${docId}/accesses/`),
    'Listing accesses',
  );
  const existing = new Set(listed.map((access) => access.user?.id));
  for (const user of users) {
    if (!existing.has(user.user.id)) {
      await json(
        await owner.api(`/api/v1.0/documents/${docId}/accesses/`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user_id: user.user.id, role: 'editor' }),
        }),
        `Giving access to ${user.username}`,
      );
    }
  }
}

/** "08:35:02–08:38:51 UTC" in a version name: when it was edited. */
function timeRange(name) {
  const [start, end] = name.match(/\d\d:\d\d:\d\d/g);
  return [Date.parse(`${DATE}T${start}Z`), Date.parse(`${DATE}T${end}Z`)];
}

/**
 * Replays the versions into one gc:false document and attributes what each
 * edit added to its author at its time, like Docs' fullMigrate does.
 */
function buildHistory(versions, authors) {
  const replay = createReplay();
  let seen = Y.createContentIds();
  const contentmaps = [];

  function attribute(by, at) {
    const all = Y.createContentIdsFromDoc(replay.ydoc, true);
    const fresh = Y.excludeContentIds(all, seen);
    seen = all;
    const attrs = (verb) => [
      Y.createContentAttribute(verb, by),
      Y.createContentAttribute(`${verb}At`, at),
    ];
    contentmaps.push(
      Y.createContentMapFromContentIds(fresh, attrs('insert'), attrs('delete')),
    );
  }

  const named = [];
  versions.forEach((version, i) => {
    const by = authors[i % authors.length];
    const [start, end] = timeRange(version.name);
    if (i === 0) {
      replay.base();
      attribute(by, start - 1000);
    }
    const count = version.steps.length;
    let at = start;
    version.steps.forEach((blocks, j) => {
      replay.next(blocks);
      at = count > 1 ? Math.round(start + ((end - start) * j) / (count - 1)) : start;
      attribute(by, at);
    });
    named.push({ t: at, name: version.name, by });
  });

  const nongcDoc = Y.encodeStateAsUpdate(replay.ydoc);
  const gc = new Y.Doc({ gc: true });
  Y.applyUpdate(gc, nongcDoc);
  return {
    nongcDoc,
    gcDoc: Y.encodeStateAsUpdate(gc),
    contentmap: Y.encodeContentMap(Y.mergeContentMaps(contentmaps)),
    contentids: Y.encodeContentIds(seen),
    versions: named,
    first: timeRange(versions[0].name)[0],
  };
}

const started = Date.now();
const users = [];
for (const pair of required('SEED_USERS').split(',')) {
  const index = pair.indexOf(':');
  users.push(await signIn(pair.slice(0, index), pair.slice(index + 1)));
}
const [owner, ...others] = users;

const found = await json(
  await owner.api(
    `/api/v1.0/documents/?is_creator_me=true&title=${encodeURIComponent(TITLE)}`,
  ),
  'Listing documents',
);
let doc = found.results.find((d) => d.title === TITLE);
if (doc && (await hasContent(owner, doc.id))) {
  await ensureAccesses(owner, others, doc.id);
  log(`already there: ${DOCS_URL}/docs/${doc.id}/`);
  process.exit(0);
}
if (!doc) {
  doc = await json(
    await owner.api('/api/v1.0/documents/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: TITLE }),
    }),
    'Creating the document',
  );
}
await ensureAccesses(owner, others, doc.id);

const versions = JSON.parse(fs.readFileSync(required('SEED_DATA'), 'utf8'));
const history = buildHistory(
  versions,
  users.map((u) => u.user.id),
);
fs.writeFileSync(
  required('OUT'),
  encodeAny({ org: ORG, docid: doc.id, ...history }),
);
fs.writeFileSync(
  `${required('OUT')}.json`,
  JSON.stringify({ docid: doc.id, url: `${DOCS_URL}/docs/${doc.id}/`, accessesFrom: history.first - 24 * 3600 * 1000 }),
);
log(`built ${versions.length} versions for ${DOCS_URL}/docs/${doc.id}/ in ${Date.now() - started} ms`);

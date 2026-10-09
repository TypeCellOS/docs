// Seeds the dev instance with a document whose history has several versions by
// several authors.
//
// Every write goes through the routes a browser uses, as a real user: each user
// signs in through the identity provider, the first user creates the document
// and gives the others access, then the recorded history is written with
// `PATCH /collaboration/ydoc` by the author of each version. yhub attributes and
// timestamps the edits itself, so the script waits between versions for the
// history panel to show them apart, and names each version with
// `POST /collaboration/version`.
//
// It is idempotent: when the document already exists with content, it only
// makes sure the accesses are there and prints the document url. Set
// SEED_FORCE=1 to write a new copy.
//
// Environment:
//   DOCS_URL            https://<docs host>
//   SEED_USERS          user:password pairs, comma separated. The first one owns
//                       the document. Authors take turns in this order.
//   SEED_DATA           path to the recorded versions (JSON: [{name, steps}])
//   SEED_TITLE          document title
//   SEED_VERSION_GAP_S  pause between two versions, in seconds (default 330)
//   SEED_STEP_GAP_MS    pause between two edits of a version (default 1500)
//   SEED_FORCE          1 to write a new copy even if the document exists
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import * as Y from '@y/y';
import { decodeAny, encodeAny } from 'lib0/buffer';

import { FRAGMENT, createReplay } from './replay.mjs';

const ORG = 'docs';
const DOCS_URL = required('DOCS_URL').replace(/\/$/, '');
const TITLE = process.env.SEED_TITLE || '07/10 meeting agenda (replay)';
const VERSION_GAP_MS = Number(process.env.SEED_VERSION_GAP_S || 330) * 1000;
const STEP_GAP_MS = Number(process.env.SEED_STEP_GAP_MS || 1500);
const FORCE = process.env.SEED_FORCE === '1';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
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
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: 'manual',
    });
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

  /** Follows redirects, carrying the cookies of each host. */
  async function follow(url, init = {}) {
    let response = await request(url, init);
    let current = url;
    for (let i = 0; i < 20 && [301, 302, 303, 307, 308].includes(response.status); i++) {
      current = new URL(response.headers.get('location'), current).toString();
      response = await request(current);
    }
    return { response, url: current };
  }

  return {
    request,
    follow,
    cookie(url, name) {
      return jarFor(url).get(name);
    },
  };
}

/** Signs in through the OIDC flow of the backend and the Keycloak login form. */
async function signIn(username, password) {
  const session = createSession();
  const { response, url } = await session.follow(
    `${DOCS_URL}/api/v1.0/authenticate/`,
  );
  const html = await response.text();
  const action = html.match(/<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/)?.[1];
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
  const user = await me.json();
  log(`signed in as ${username} (${user.id})`);
  return { username, user, api };
}

async function json(response, what) {
  if (!response.ok) {
    throw new Error(`${what} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function findDocument(owner) {
  const response = await owner.api(
    `/api/v1.0/documents/?is_creator_me=true&title=${encodeURIComponent(TITLE)}`,
  );
  const { results } = await json(response, 'Listing documents');
  return results.find((doc) => doc.title === TITLE);
}

async function readFragmentLength(user, docId) {
  const response = await user.api(
    `/collaboration/ydoc/v1/${ORG}/${docId}?gc=true`,
  );
  if (!response.ok) {
    throw new Error(`Reading the document failed: ${response.status}`);
  }
  const { doc } = decodeAny(new Uint8Array(await response.arrayBuffer()));
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, doc);
  return ydoc.get(FRAGMENT).length;
}

async function ensureAccesses(owner, users, docId) {
  const response = await owner.api(`/api/v1.0/documents/${docId}/accesses/`);
  const existing = new Set(
    (await json(response, 'Listing accesses')).map((access) => access.user?.id),
  );
  for (const user of users) {
    if (existing.has(user.user.id)) {
      continue;
    }
    await json(
      await owner.api(`/api/v1.0/documents/${docId}/accesses/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: user.user.id, role: 'editor' }),
      }),
      `Giving access to ${user.username}`,
    );
    log(`gave ${user.username} editor access`);
  }
}

async function patch(user, docId, update) {
  const response = await user.api(`/collaboration/ydoc/v1/${ORG}/${docId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/octet-stream' },
    body: encodeAny({ update }),
  });
  if (!response.ok) {
    throw new Error(`PATCH as ${user.username} failed: ${response.status} ${await response.text()}`);
  }
}

async function nameVersion(user, docId, name) {
  const response = await user.api(`/collaboration/version/v1/${ORG}/${docId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: encodeAny({ type: 'version:v1', name }),
  });
  if (!response.ok) {
    throw new Error(`Naming "${name}" failed: ${response.status} ${await response.text()}`);
  }
}

async function main() {
  const versions = JSON.parse(fs.readFileSync(required('SEED_DATA'), 'utf8'));
  const users = [];
  for (const pair of required('SEED_USERS').split(',')) {
    const index = pair.indexOf(':');
    users.push(await signIn(pair.slice(0, index), pair.slice(index + 1)));
  }
  const [owner, ...others] = users;

  let doc = FORCE ? undefined : await findDocument(owner);
  if (doc && (await readFragmentLength(owner, doc.id)) > 0) {
    await ensureAccesses(owner, others, doc.id);
    log(`already seeded: ${DOCS_URL}/docs/${doc.id}/`);
    return;
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
    log(`created ${DOCS_URL}/docs/${doc.id}/`);
  }
  await ensureAccesses(owner, others, doc.id);
  // History is only shown from the date of each access on: start after them.
  await sleep(2000);

  const replay = createReplay();
  await patch(owner, doc.id, replay.base());
  for (const [i, version] of versions.entries()) {
    const author = users[i % users.length];
    if (i > 0) {
      log(`waiting ${VERSION_GAP_MS / 1000}s before the next version`);
      await sleep(VERSION_GAP_MS);
    }
    for (const [j, blocks] of version.steps.entries()) {
      if (j > 0) {
        await sleep(STEP_GAP_MS);
      }
      await patch(author, doc.id, replay.next(blocks));
    }
    await sleep(STEP_GAP_MS);
    await nameVersion(author, doc.id, version.name);
    log(`version ${i + 1}/${versions.length} "${version.name}" by ${author.username}: ${version.steps.length} edits`);
  }
  log(`done: ${DOCS_URL}/docs/${doc.id}/`);
}

await main();

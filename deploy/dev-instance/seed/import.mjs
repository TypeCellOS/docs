// Stores the history built by seed.mjs in yhub: step 3 of scripts/seed.sh.
//
// It runs in the yhub image, with the @y/hub of the deployed server, and writes
// the document the way Docs' fullMigrate does: one persisted row at clock 0,
// and the named versions. It only adds what yhub does not hold yet.
//
// Usage: node import.mjs <history file>
import fs from 'node:fs';

import { decodeAny, encodeAny } from '/app/node_modules/lib0/src/buffer.js';
import { createPersistence } from '/app/node_modules/@y/hub/src/persistence.js';

const history = decodeAny(new Uint8Array(fs.readFileSync(process.argv[2])));
const docRef = { org: history.org, docid: history.docid, branch: 'main' };
const persistence = await createPersistence(process.env.POSTGRES, []);

// Only an empty document gets the content: a second row would attribute the
// same content twice. `lastClock` cannot tell, it stays '0' after the clock-0
// row this import writes, so look for stored updates instead.
const current = await persistence.retrieveDoc(docRef, { gc: true });
if (current.gcDoc.length === 0 && current.lastClock === '0') {
  await persistence.store(docRef, {
    lastClock: '0',
    gcDoc: history.gcDoc,
    nongcDoc: history.nongcDoc,
    contentmap: history.contentmap,
    contentids: history.contentids,
  });
  console.log(`import: stored the history of ${docRef.docid}`);
} else {
  console.log(`import: yhub already holds the content of ${docRef.docid}`);
}
// The names are keyed on their time, and an existing one is kept.
let named = 0;
for (const version of history.versions) {
  const stored = await persistence.storeVersion(docRef, {
    t: version.t,
    name: version.name,
    // what the version API stores for a version with no custom data
    custom: encodeAny(null),
    published: false,
    at: version.t,
    by: version.by,
  });
  if (stored != null) {
    named++;
  }
}
console.log(`import: named ${named} new versions of ${history.versions.length}`);
process.exit(0);

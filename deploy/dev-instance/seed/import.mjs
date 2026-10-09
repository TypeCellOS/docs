// Stores the history built by seed.mjs in yhub: step 3 of scripts/seed.sh.
//
// It runs in the yhub image, with the @y/hub of the deployed server, and writes
// the document the way Docs' fullMigrate does: one persisted row at clock 0,
// and the named versions. It refuses a document that yhub already holds.
//
// Usage: node import.mjs <history file>
import fs from 'node:fs';

import { decodeAny, encodeAny } from '/app/node_modules/lib0/src/buffer.js';
import { createPersistence } from '/app/node_modules/@y/hub/src/persistence.js';

const history = decodeAny(new Uint8Array(fs.readFileSync(process.argv[2])));
const docRef = { org: history.org, docid: history.docid, branch: 'main' };
const persistence = await createPersistence(process.env.POSTGRES, []);

const current = await persistence.retrieveDoc(docRef, {});
if (current.lastClock !== '0') {
  console.log(`import: yhub already holds ${docRef.docid}, nothing to do`);
} else {
  await persistence.store(docRef, {
    lastClock: '0',
    gcDoc: history.gcDoc,
    nongcDoc: history.nongcDoc,
    contentmap: history.contentmap,
    contentids: history.contentids,
  });
  for (const version of history.versions) {
    await persistence.storeVersion(docRef, {
      t: version.t,
      name: version.name,
      // what the version API stores for a version with no custom data
      custom: encodeAny(null),
      published: false,
      at: version.t,
      by: version.by,
    });
  }
  console.log(`import: stored ${history.versions.length} versions of ${docRef.docid}`);
}
process.exit(0);

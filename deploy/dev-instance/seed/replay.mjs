// Turns a recorded document history into Yjs updates for the Docs editor.
//
// The input is a list of versions. Each version is a list of steps, and each
// step is the full BlockNote document after a burst of editing. Each step is
// applied to a headless editor and written to Y the way the collaboration
// binding writes an edit (`docDiffToDelta`), so the history reflects the
// BlockNote build Docs runs.
import { BlockNoteEditor } from '@blocknote/core';
import { docDiffToDelta } from '@blocknote/core/y';
import { docToDelta } from '@y/prosemirror';
import * as Y from '@y/y';

/** The shared type the Docs editor reads (`provider.doc.get('document-store')`). */
export const FRAGMENT = 'document-store';

/**
 * Prepares the replay. `next()` applies one step and returns the Yjs update
 * (V1, the format yhub speaks) that the step adds to the document.
 */
export function createReplay() {
  const editor = BlockNoteEditor.create();
  const ydoc = new Y.Doc({ gc: false });
  const yType = ydoc.get(FRAGMENT);

  function capture(write) {
    const vector = Y.encodeStateVector(ydoc);
    ydoc.transact(write);
    return Y.encodeStateAsUpdate(ydoc, vector);
  }

  return {
    /** The update that writes the empty editor document. */
    base() {
      return capture(() => {
        yType.applyDelta(docToDelta(editor.prosemirrorState.doc));
      });
    },
    /** The update that turns the previous step into `blocks`. */
    next(blocks) {
      const before = editor.prosemirrorState.doc;
      editor.replaceBlocks(editor.document, blocks);
      const delta = docDiffToDelta(before, editor.prosemirrorState.doc);
      return capture(() => {
        yType.applyDelta(delta);
      });
    },
    ydoc,
  };
}

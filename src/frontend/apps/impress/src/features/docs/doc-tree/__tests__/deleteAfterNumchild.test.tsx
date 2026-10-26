import {
  CunninghamProvider,
  TreeContextType,
  TreeProvider,
  useTreeContext,
} from '@gouvfr-lasuite/ui-components';
import { act, renderHook } from '@testing-library/react';
import { PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';

import { Doc } from '../../doc-management';
import { addToNumchildInTree } from '../utils';

const buildDoc = (id: string, numchild: number, children: Doc[] = []) =>
  ({ id, numchild, childrenCount: numchild, children }) as unknown as Doc;

const wrapper = ({ children }: PropsWithChildren) => (
  <CunninghamProvider theme="default">
    <TreeProvider initialTreeData={[]}>{children}</TreeProvider>
  </CunninghamProvider>
);

const collectIds = (
  nodes: { key: unknown; children?: unknown[] }[],
): string[] =>
  nodes.flatMap((node) => [
    String(node.key),
    ...collectIds((node.children ?? []) as typeof nodes),
  ]);

describe('removing a doc from the tree after decrementing its parent', () => {
  it.each([
    ['the root', true],
    ['a node of the tree', false],
  ])('really removes the doc when the parent is %s', (_label, isRoot) => {
    const { result } = renderHook(
      () => useTreeContext<Doc>() as TreeContextType<Doc>,
      { wrapper },
    );

    const child = buildDoc('child', 0);
    const sibling = buildDoc('sibling', 0);
    const parent = buildDoc('parent', 2, [child, sibling]);
    const root = buildDoc('root', 1, isRoot ? [] : [parent]);

    act(() => {
      result.current.setRoot(root);
      result.current.treeData.resetTree(isRoot ? [child, sibling] : [parent]);
    });

    // What DocToolBox does when a sub-doc is deleted
    const treeContext = result.current;
    act(() => {
      addToNumchildInTree(treeContext, isRoot ? 'root' : 'parent', -1, {
        keepFocus: true,
      });
      treeContext.treeData.deleteNode('child');
    });

    const ids = collectIds(result.current.treeData.nodes as never);
    expect(ids).not.toContain('child');
    expect(ids).toContain('sibling');
  });
});

import { TreeContext, TreeContextType } from '@gouvfr-lasuite/ui-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import fetchMock from 'fetch-mock';
import { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Doc } from '../../types';
import { useCreateChildDoc } from '../useCreateChildDoc';
import { KEY_DOC } from '../useDoc';

describe('useCreateChildDoc', () => {
  beforeEach(() => {
    fetchMock.hardReset();
    fetchMock.mockGlobal();
  });

  it('invalidates the cached parent doc so its numchild is refreshed', async () => {
    fetchMock.post('http://test.jest/api/v1.0/documents/parent-id/children/', {
      status: 201,
      body: { id: 'child-id', title: 'Child' },
    });

    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useCreateChildDoc({ onSuccess }), {
      wrapper,
    });
    result.current.mutate({ parentId: 'parent-id' });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: [KEY_DOC, { id: 'parent-id' }],
    });
  });

  it.each([
    ['the root', true],
    ['a node of the tree', false],
  ])('increments numchild of %s in the tree', async (_label, isRoot) => {
    fetchMock.post('http://test.jest/api/v1.0/documents/parent-id/children/', {
      status: 201,
      body: { id: 'child-id', title: 'Child' },
    });

    const parent = { id: 'parent-id', numchild: 0 } as Doc;
    const setRoot = vi.fn();
    const updateNode = vi.fn();
    const treeContext = {
      root: isRoot ? parent : { id: 'root-id', numchild: 1 },
      setRoot,
      treeData: {
        getNode: (id: string) => (id === parent.id ? parent : undefined),
        updateNode,
      },
      treeApiRef: { current: { focus: vi.fn() } },
    } as unknown as TreeContextType<Doc>;

    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={new QueryClient()}>
        <TreeContext.Provider value={treeContext}>
          {children}
        </TreeContext.Provider>
      </QueryClientProvider>
    );
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useCreateChildDoc({ onSuccess }), {
      wrapper,
    });
    result.current.mutate({ parentId: 'parent-id' });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
    if (isRoot) {
      expect(setRoot).toHaveBeenCalledWith({ ...parent, numchild: 1 });
    } else {
      expect(updateNode).toHaveBeenCalledWith('parent-id', { numchild: 1 });
    }
  });
});

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { APIError, errorCauses, fetchAPI } from '@/api';
import { KEY_LIST_SEARCH_DOC } from '@/docs/doc-search/api/useSearchDocs';
import {
  addToNumchildInTree,
  useTreeContextOrNull,
} from '@/docs/doc-tree/utils';

import { Doc } from '../types';

import { KEY_DOC } from './useDoc';
import { KEY_LIST_DOC } from './useDocs';

export type CreateChildDocParam = Pick<Doc, 'title'> & {
  parentId: string;
};

export const createChildDoc = async ({
  title,
  parentId,
}: CreateChildDocParam): Promise<Doc> => {
  const response = await fetchAPI(`documents/${parentId}/children/`, {
    method: 'POST',
    body: JSON.stringify({
      title,
    }),
  });

  if (!response.ok) {
    throw new APIError('Failed to create the doc', await errorCauses(response));
  }

  return response.json() as Promise<Doc>;
};

interface UseCreateChildDocProps {
  onSuccess: (doc: Doc) => void;
}

export function useCreateChildDoc({ onSuccess }: UseCreateChildDocProps) {
  const queryClient = useQueryClient();
  const treeContext = useTreeContextOrNull();
  return useMutation<Doc, APIError, CreateChildDocParam>({
    mutationFn: createChildDoc,
    onSuccess: (doc, { parentId }) => {
      // The cached parent doc holds a stale `numchild`
      void queryClient.invalidateQueries({
        queryKey: [KEY_DOC, { id: parentId }],
      });
      // So does the copy of the parent kept by the tree, which the
      // actions of its item (e.g. duplicate) read.
      addToNumchildInTree(treeContext, parentId, 1);
      void queryClient.resetQueries({
        queryKey: [KEY_LIST_DOC],
      });
      void queryClient.resetQueries({
        queryKey: [KEY_LIST_SEARCH_DOC],
      });
      onSuccess(doc);
    },
  });
}

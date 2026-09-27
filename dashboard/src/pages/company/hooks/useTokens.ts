import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCompanyTokens, createCompanyToken, type TokenCreate } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useTokensList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['tokens', page, search, statusFilter],
    queryFn: () =>
      getCompanyTokens(apiClient, {
        page,
        page_size: 10,
        ...(statusFilter ? { status: statusFilter } : {}),
      }),
  });

  const tokens = data?.data?.results || [];
  const totalCount = data?.data?.count || 0;
  const totalPages = Math.ceil(totalCount / 10);

  const createMutation = useMutation({
    mutationFn: (tokenData: TokenCreate) => createCompanyToken(apiClient, tokenData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
      setIsCreateModalOpen(false);
    },
  });

  return {
    tokens,
    totalCount,
    page,
    totalPages,
    search,
    statusFilter,
    isLoading,
    error,
    isCreateModalOpen,
    setPage,
    setSearch,
    setStatusFilter,
    setIsCreateModalOpen,
    createToken: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    createError: createMutation.error,
    resetCreateError: createMutation.reset,
  };
}

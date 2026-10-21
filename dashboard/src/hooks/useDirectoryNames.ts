import { useQuery } from '@tanstack/react-query';
import { CACHE_TIMING, DIRECTORY_QUERY_KEY, getDirectoryTokens, isUuid, readEveryPage } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useDirectoryNames(enabled = true) {
  const tokens = useQuery({
    queryKey: [...DIRECTORY_QUERY_KEY, 'tokens', 'complete'],
    queryFn: () => readEveryPage((page) => getDirectoryTokens(apiClient, page)),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    retry: false,
    enabled,
  });
  const rows = tokens.isSuccess ? tokens.data : [];
  const companies = new Map(rows.map((row) => [row.companyUuid, row.companyName]));
  const offerings = new Map(
    rows.flatMap((row) => (row.openOffering ? [[row.openOffering.uuid, `${row.name} · ${row.companyName}`]] : [])),
  );
  const lookup = (names: Map<string, string>, uuid: string, unlisted: string) =>
    isUuid(uuid) ? (names.get(uuid.toLowerCase()) ?? (tokens.isSuccess ? unlisted : undefined)) : undefined;
  return {
    companies,
    company: (uuid: string) =>
      lookup(
        companies,
        uuid,
        'Not in your directory: a company appears there once it accepts you. The server checks the identifier.',
      ),
    offering: (uuid: string) =>
      lookup(offerings, uuid, 'Not an open offering in your directory. The server checks the identifier.'),
  };
}

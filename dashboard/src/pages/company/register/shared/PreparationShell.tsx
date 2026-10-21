import type { ReactNode } from 'react';
import type { useUserPreferences } from '@ledova/shared';
import { Page } from '@components/Page';
import { LoadError, Loading } from '@components/Ledger';

export function PreparationPreferences({ preferences }: { preferences: ReturnType<typeof useUserPreferences> }) {
  return preferences.isLoading ? (
    <Loading>Loading your account…</Loading>
  ) : (
    <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
      Your account could not be loaded.
    </LoadError>
  );
}

export function PreparationShell({
  lede,
  preferences,
}: {
  lede: string;
  preferences: ReturnType<typeof useUserPreferences>;
}) {
  return (
    <Page narrow lede={lede}>
      <PreparationPreferences preferences={preferences} />
    </Page>
  );
}

export function PreparationNotice({
  children = 'This share class is not in a register you can read.',
  className = 'text-sm text-text-muted',
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <p className={className}>{children}</p>;
}

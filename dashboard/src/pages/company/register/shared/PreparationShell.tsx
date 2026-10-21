import type { ReactNode } from 'react';
import type { To } from 'react-router-dom';
import { DESTINATIONS, type useUserPreferences } from '@ledova/shared';
import { Page, PageLink } from '@components/Page';
import { Loading } from '@pages/company/shared/RegisterStatus';
import { LoadError } from '@components/Ledger';

export function PreparationBack({
  to = DESTINATIONS.companyRegister.path,
  label = 'Back to Register',
}: {
  to?: To;
  label?: string;
}) {
  return <PageLink to={to} label={label} />;
}

export function PreparationPreferences({ preferences }: { preferences: ReturnType<typeof useUserPreferences> }) {
  return preferences.isLoading ? (
    <Loading />
  ) : (
    <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
      Your account could not be loaded.
    </LoadError>
  );
}

export function PreparationShell({
  lede,
  actions,
  preferences,
}: {
  lede: string;
  actions: ReactNode;
  preferences: ReturnType<typeof useUserPreferences>;
}) {
  return (
    <Page narrow lede={lede} actions={actions}>
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

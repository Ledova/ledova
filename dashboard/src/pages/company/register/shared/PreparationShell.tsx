import type { ReactNode } from 'react';
import type { useUserPreferences } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Loading, Unavailable } from '@pages/company/shared/RegisterStatus';

export function PreparationBack({
  onClick,
  label = 'Back to Register',
  disabled,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return <PageAction label={label} disabled={disabled} onClick={onClick} />;
}

export function PreparationPreferences({ preferences }: { preferences: ReturnType<typeof useUserPreferences> }) {
  return preferences.isLoading ? (
    <Loading />
  ) : (
    <Unavailable retry={() => void preferences.refetch()} busy={preferences.isFetching} />
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

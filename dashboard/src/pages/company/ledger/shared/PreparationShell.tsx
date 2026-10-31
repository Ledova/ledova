import type { ReactNode } from 'react';
import { Page } from '@components/Page';
import { AccountCheck } from '@components/AccountCheck';

export function PreparationShell({ lede }: { lede: string }) {
  return (
    <Page narrow lede={lede}>
      <AccountCheck />
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

import { useMemo } from 'react';
import { generatePath } from 'react-router-dom';
import {
  DESTINATIONS,
  formatShareCount,
  type Company,
  type OrderSubmissionOwner,
  type useCompanySelection,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { LinkRow, Section, Status } from '@components/Ledger';
import { useRegisterClasses } from './shared/useCompanyRegister';
import { ownerGuard } from './shared/ownerGuard';
import { SHARE_CLASS_STATUS_TONES } from './shared/statusTones';

export function CompanyClasses({
  owner,
  currentOwner,
  company,
  read,
  onCreate,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: Company;
  read: ReturnType<typeof useCompanySelection>;
  onCreate: () => void;
}) {
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner, guard);
  const listed = (classes.data ?? []).filter((token) => token.companyUuid === company.uuid);
  return (
    <Section title={classes.isSuccess ? `Share classes (${listed.length})` : 'Share classes'}>
      {classes.isPending ? (
        <p role="status" className="text-sm text-text-muted">
          Loading share classes…
        </p>
      ) : classes.isError ? (
        <div role="alert" className="space-y-2 text-sm text-text-muted">
          <p>Share classes could not be loaded.</p>
          <PageAction
            label="Retry share classes"
            onClick={() => void classes.refetch()}
            disabled={classes.isFetching}
          />
        </div>
      ) : listed.length === 0 ? (
        <p className="text-sm text-text-muted">No share classes yet.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {listed.map((token) => (
            <li key={token.uuid}>
              <LinkRow
                to={generatePath(DESTINATIONS.companyClass.path, { uuid: token.uuid })}
                label={token.name}
                aside={
                  <Status tone={SHARE_CLASS_STATUS_TONES.get(token.status) ?? 'waiting'}>
                    {token.statusDisplay}
                  </Status>
                }
              >
                <p className="text-text-muted">
                  {token.symbol} · {token.tokenTypeDisplay}
                </p>
                <p className="break-all text-text-muted">
                  {token.totalSupply !== (2n ** 256n - 1n).toString()
                    ? `Technical share limit · ${formatShareCount(token.totalSupply)}`
                    : 'Technical share limit · Internal quantity guard'}
                </p>
              </LinkRow>
            </li>
          ))}
          <li>
            <LinkRow to={DESTINATIONS.companyRegister.path} label={DESTINATIONS.companyRegister.title} />
          </li>
        </ul>
      )}
      {read.canPersonalAdmin && (
        <PageAction label="Create share class" primary onClick={onCreate} disabled={read.isRefreshing} />
      )}
    </Section>
  );
}

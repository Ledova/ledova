import type { ReactNode } from 'react';
import {
  REGISTER_CORRECTION_COPY,
  formatDate,
  formatDateTime,
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  type RegisterEntry,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Disclosure, LoadError, Loading, Row, Rows, Status } from '@components/Ledger';
import { LoadMore } from '@components/List';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { RegisterChanges } from '@pages/company/ledger/shared/RegisterChanges';
import { useRegisterEntries } from '@pages/company/ledger/shared/useRegisterEntries';

const COPY = REGISTER_CORRECTION_COPY;

export function ClassEntries({
  owner,
  guard,
  company,
  register,
  sourceReady = true,
  visible = true,
  renderAction,
  entryFilter,
  emptyText = 'No changes recorded yet.',
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  register: TokenHoldersResponse;
  sourceReady?: boolean;
  visible?: boolean;
  renderAction?: (entry: RegisterEntry, ready: boolean) => ReactNode;
  entryFilter?: (entry: RegisterEntry) => boolean;
  emptyText?: string;
}) {
  const history = useRegisterEntries(owner, register.token.uuid, guard);
  const appointments = useOwnAppointments(owner, guard);
  const privateReady =
    visible &&
    sourceReady &&
    !history.isPending &&
    !history.hasError &&
    !history.isFetching &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const actionReady = privateReady && !history.moreFailed;
  const listed = entryFilter ? history.entries.filter(entryFilter) : history.entries;
  const sequences = new Map(history.entries.map((entry) => [entry.uuid, entry.sequence]));
  return (
    <div hidden={!visible} className="flex flex-col gap-3">
      {appointments.isError && (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {history.isPending ? (
        <Loading>Loading register entries…</Loading>
      ) : history.hasError ? (
        <LoadError retry={history.retry} busy={history.isFetching}>
          Register entries could not be loaded.
        </LoadError>
      ) : privateReady && listed.length === 0 ? (
        <p className="text-sm text-text-muted">{emptyText}</p>
      ) : null}
      {privateReady && listed.length > 0 && (
        <div
          aria-hidden="true"
          className="hidden grid-cols-[12rem_10rem_minmax(0,1fr)] gap-6 pl-7 text-xs font-medium text-text-muted md:grid"
        >
          <span>Change</span>
          <span>Date</span>
          <span>Share movements</span>
        </div>
      )}
      <ul aria-label="Ledger changes" className="divide-y divide-border-subtle">
        {listed.map((entry) => {
          const corrected = entry.corrects ? sequences.get(entry.corrects) : undefined;
          const reversal = entry.correctedBy ? sequences.get(entry.correctedBy) : undefined;
          const companyDated = ['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase());
          return (
            <li key={entry.uuid} hidden={!privateReady}>
              <Disclosure
                summary={
                  privateReady ? (
                    <span className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm md:grid-cols-[12rem_10rem_minmax(0,1fr)] md:gap-6">
                      <span className="sr-only">Details for entry {entry.sequence}: </span>
                      <span className="min-w-0 space-y-1 break-words font-medium text-text-primary">
                        <span className="block">{COPY.ENTRY_KINDS[entry.kind]}</span>
                        {entry.correctedBy && <Status tone="closed">Reversed</Status>}
                      </span>
                      <span className="tabular-nums text-text-muted">
                        <span className="sr-only">Date: </span>
                        {formatDate(companyDated ? entry.companyEventOn : entry.effectiveOn, 'Date not recorded')}
                      </span>
                      <span className="col-span-2 min-w-0 tabular-nums text-text-primary md:col-span-1">
                        <span className="sr-only">Share movements: </span>
                        <RegisterChanges changes={entry.changes.slice(0, 2)} />
                        {entry.changes.length > 2 && (
                          <span className="block text-text-muted">{entry.changes.length - 2} more share changes</span>
                        )}
                      </span>
                    </span>
                  ) : (
                    ''
                  )
                }
              >
                {privateReady && (
                  <>
                    <Rows>
                      <Row label="Entry">{entry.sequence}</Row>
                      {companyDated && (
                        <Row label="Company date">{formatDate(entry.companyEventOn, 'Not recorded')}</Row>
                      )}
                      <Row label="Ledger date">{formatDate(entry.effectiveOn)}</Row>
                      <Row label="Recorded on">{formatDateTime(entry.recordedAt)}</Row>
                      {entry.changes.length > 2 && (
                        <Row label="Share changes">
                          <RegisterChanges changes={entry.changes} />
                        </Row>
                      )}
                    </Rows>
                    {entry.corrects && (
                      <p className="text-sm text-text-muted">
                        {corrected === undefined ? 'Corrects an earlier entry.' : `Corrects entry ${corrected}.`}
                      </p>
                    )}
                    {entry.correctedBy && (
                      <p className="text-sm text-text-muted">
                        {reversal === undefined ? COPY.CORRECTED_NOTE : `Reversed by entry ${reversal}.`}
                      </p>
                    )}
                  </>
                )}
                {renderAction && (
                  <div className="flex flex-wrap justify-end gap-2">{renderAction(entry, actionReady)}</div>
                )}
              </Disclosure>
            </li>
          );
        })}
      </ul>
      <LoadMore
        noun={['register entry', 'register entries']}
        hasMore={history.hasMore}
        failed={history.moreFailed}
        loading={history.isLoadingMore}
        disabled={!privateReady || history.isFetching}
        onLoad={history.loadMore}
      />
    </div>
  );
}

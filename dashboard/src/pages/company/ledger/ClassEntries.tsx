import { useId, useState, type ReactNode } from 'react';
import {
  REGISTER_CORRECTION_COPY,
  entryDate,
  entryLabel,
  entryName,
  formatDate,
  formatShortDate,
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  type RegisterEntry,
  type TokenHoldersResponse,
  useOwnAppointments,
  useRegisterEntries,
} from '@ledova/shared';
import { LoadError, Loading, MoreToggle, Status } from '@components/Ledger';
import { LoadMore } from '@components/List';
import { RegisterChanges } from '@pages/company/ledger/shared/RegisterChanges';

const COPY = REGISTER_CORRECTION_COPY;

export function ClassEntries({
  owner,
  guard,
  company,
  register,
  sourceReady = true,
  visible = true,
  renderAction,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  register: TokenHoldersResponse;
  sourceReady?: boolean;
  visible?: boolean;
  renderAction?: (entry: RegisterEntry, ready: boolean) => ReactNode;
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
  const entries = new Map(history.entries.map((entry) => [entry.uuid, entry]));
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
      ) : privateReady && history.entries.length === 0 ? (
        <p className="text-sm text-text-muted">No changes recorded yet.</p>
      ) : null}
      {privateReady && history.entries.length > 0 && (
        <div
          aria-hidden="true"
          className="hidden grid-cols-[12rem_10rem_minmax(0,1fr)_6rem] gap-6 text-xs font-medium text-text-muted md:grid"
        >
          <span>Change</span>
          <span>Date</span>
          <span>Share movements</span>
          <span className="sr-only">Action</span>
        </div>
      )}
      <ul aria-label="Ledger changes" className="divide-y divide-border-subtle">
        {history.entries.map((entry) => {
          const corrected = entry.corrects ? entries.get(entry.corrects) : undefined;
          const reversal = entry.correctedBy ? entries.get(entry.correctedBy) : undefined;
          const companyDated = ['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase());
          const action = renderAction?.(entry, actionReady);
          return (
            <li
              key={entry.uuid}
              hidden={!privateReady}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-4 text-sm md:grid-cols-[12rem_10rem_minmax(0,1fr)_6rem] md:grid-rows-[auto_1fr] md:gap-x-6 md:gap-y-0"
            >
              {privateReady && (
                <>
                  <p className="min-w-0 break-words md:contents">
                    <span className="font-medium text-text-primary md:col-start-1 md:row-start-1">
                      {COPY.ENTRY_KINDS[entry.kind]}
                    </span>{' '}
                    <span className="tabular-nums text-text-muted md:col-start-2 md:row-start-1">
                      <span aria-hidden="true" className="md:hidden">
                        ·{' '}
                      </span>
                      <span className="sr-only">Date: </span>
                      <span className="whitespace-nowrap">
                        {formatShortDate(companyDated ? entry.companyEventOn : entry.effectiveOn, 'Date not recorded')}
                      </span>
                    </span>
                  </p>
                  {companyDated && entry.effectiveOn !== entry.companyEventOn && (
                    <p className="col-span-2 tabular-nums text-text-muted md:col-span-1 md:col-start-2 md:row-start-2">
                      Ledger date <span className="whitespace-nowrap">{formatShortDate(entry.effectiveOn)}</span>
                    </p>
                  )}
                  {(entry.correctedBy || entry.corrects) && (
                    <div className="col-span-2 min-w-0 space-y-1 break-words text-text-muted md:col-span-1 md:col-start-1 md:row-start-2 md:mt-1">
                      {entry.correctedBy && (
                        <p>
                          <Status tone="closed">
                            {reversal ? `Reversed on ${formatDate(entryDate(reversal))}` : 'Reversed'}
                          </Status>
                        </p>
                      )}
                      {entry.corrects && (
                        <p>{corrected ? `Corrects the ${entryName(corrected)}` : 'Corrects an earlier entry'}</p>
                      )}
                    </div>
                  )}
                  <div className="col-span-2 min-w-0 tabular-nums text-text-primary md:col-span-1 md:col-start-3 md:row-span-2 md:row-start-1">
                    <span className="sr-only">Share movements: </span>
                    <Movements entry={entry} />
                  </div>
                  {action && <div className="col-start-2 row-start-1 flex justify-end md:col-start-4">{action}</div>}
                </>
              )}
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

function Movements({ entry }: { entry: RegisterEntry }) {
  const id = useId();
  const [all, setAll] = useState(false);
  const { changes } = entry;
  return (
    <>
      <span id={id} className="block">
        <RegisterChanges changes={all ? changes : changes.slice(0, 2)} />
      </span>
      {changes.length > 2 && (
        <MoreToggle open={all} controls={id} onToggle={() => setAll((value) => !value)}>
          {all ? 'Show fewer share changes' : `Show all ${changes.length} share changes`}
          <span className="sr-only"> ({entryLabel(entry)})</span>
        </MoreToggle>
      )}
    </>
  );
}

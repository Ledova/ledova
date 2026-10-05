import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_CORRECTION_COPY,
  formatDateTime,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { LinkRow } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { ownAppointmentsKey } from '../team/appointments';
import { CorrectionRecord } from './CorrectionRecord';
import { RegisterChanges } from './RegisterChanges';
import { registerSteps } from './proposals';
import { registerKey } from './useCompanyRegister';
import {
  correctionsKey,
  entriesKey,
  useClassCorrections,
  useRegisterEntries,
  type ClassCorrection,
} from './useRegisterCorrections';
import { useOwnAppointments } from './useRegisterImports';

const COPY = REGISTER_CORRECTION_COPY;

function EntryHistory({
  owner,
  guard,
  token,
  prepare,
  corrections,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  token: string;
  prepare: OwnCompanyAppointment | undefined;
  corrections: ClassCorrection[];
}) {
  const history = useRegisterEntries(owner, token, guard);
  const sequences = new Map(
    [...corrections.map(({ entry }) => entry), ...history.entries].map((entry) => [entry.uuid, entry.sequence]),
  );
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">{COPY.ENTRIES_TITLE}</h3>
      {history.isPending ? (
        <p role="status" className="text-sm text-text-muted">
          Loading register entries…
        </p>
      ) : history.hasError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
          <p>We couldn&apos;t load the register entries for this share class.</p>
          <PageAction label="Retry register entries" onClick={history.retry} disabled={history.isFetching} />
        </div>
      ) : history.entries.length === 0 ? (
        <p className="text-sm text-text-muted">{COPY.ENTRIES_EMPTY}</p>
      ) : (
        <>
          <ul className="divide-y divide-border-subtle">
            {history.entries.map((entry) => {
              const corrected = entry.corrects ? sequences.get(entry.corrects) : undefined;
              const reversal = entry.correctedBy ? sequences.get(entry.correctedBy) : undefined;
              return (
                <li key={entry.uuid} className="flex flex-col gap-2 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words text-base text-text-primary">
                      {COPY.ENTRY_KINDS[entry.kind] ?? entry.kind}
                    </span>
                    <span className="ml-auto text-sm tabular-nums text-text-muted">Entry {entry.sequence}</span>
                  </div>
                  <p className="text-xs text-text-muted">
                    Effective {entry.effectiveOn} · Recorded {formatDateTime(entry.recordedAt)}
                  </p>
                  <div className="text-sm text-text-primary">
                    <RegisterChanges changes={entry.changes} />
                  </div>
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
                  {prepare && entry.correctable && (
                    <LinkRow
                      to={DESTINATIONS.companyRegisterCorrection.path
                        .replace(':uuid', token)
                        .replace(':entry', entry.uuid)}
                      label={COPY.PREPARE}
                      context={`entry ${entry.sequence}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {history.moreFailed ? (
            <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
              <p>More register entries could not be loaded. The list is incomplete.</p>
              <PageAction
                label="Try more register entries again"
                onClick={history.loadMore}
                disabled={history.isFetching}
              />
            </div>
          ) : (
            history.hasMore && (
              <PageAction
                label={history.isLoadingMore ? 'Loading register entries…' : 'Load more register entries'}
                onClick={history.loadMore}
                disabled={history.isFetching}
              />
            )
          )}
        </>
      )}
    </div>
  );
}

export function ClassCorrections({
  owner,
  guard,
  token,
  company,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  token: string;
  company: string;
}) {
  const client = useQueryClient();
  const appointments = useOwnAppointments(owner, guard);
  const corrections = useClassCorrections(owner, token, guard);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const refresh = async () => {
    try {
      guard();
    } catch {
      return;
    }
    await Promise.all(
      [
        correctionsKey(owner, token),
        entriesKey(owner, token),
        [...registerKey(owner), 'holders'],
        ownAppointmentsKey(owner),
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
  };
  return (
    <>
      <EntryHistory
        owner={owner}
        guard={guard}
        token={token}
        prepare={steps?.prepare}
        corrections={corrections.data ?? []}
      />
      <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
        <h3 className="text-sm font-medium text-text-primary">{COPY.TITLE}</h3>
        {appointments.isError ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
            <p>Your appointments could not be loaded. Retry before preparing or deciding a correction.</p>
            <PageAction
              label="Retry appointments"
              onClick={() => void appointments.refetch()}
              disabled={appointments.isFetching}
            />
          </div>
        ) : (
          steps &&
          !Object.values(steps).some(Boolean) && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
        )}
        {corrections.isPending ? (
          <p role="status" className="text-sm text-text-muted">
            Loading corrections…
          </p>
        ) : corrections.isError ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
            <p>We couldn&apos;t load the corrections for this share class.</p>
            <PageAction
              label="Retry corrections"
              onClick={() => void corrections.refetch()}
              disabled={corrections.isFetching}
            />
          </div>
        ) : corrections.data.length === 0 ? (
          <p className="text-sm text-text-muted">{COPY.EMPTY}</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {corrections.data.map((correction) => (
              <CorrectionRecord
                key={correction.proposal.uuid}
                correction={correction}
                steps={steps ?? {}}
                guard={guard}
                onDecided={refresh}
                onRefused={refresh}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

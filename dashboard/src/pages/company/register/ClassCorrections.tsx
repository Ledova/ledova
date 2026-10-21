import { registerHoldersKey } from '@pages/company/shared/useCompanyRegister';
import { allPeopleKey } from '@pages/company/register/shared/usePeople';
import { useCallback } from 'react';
import { generatePath } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_CORRECTION_COPY,
  formatDate,
  formatDateTime,
  hasCurrentRegisterReadAuthority,
  USER_PREFERENCES_QUERY_KEY,
  type TokenHoldersResponse,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { LinkRow, LoadError, Loading, Disclosure } from '@components/Ledger';
import { LoadMore } from '@components/List';

import { CorrectionRecord } from './CorrectionRecord';
import { ClassCertificate } from './ClassCertificate';
import { RegisterChanges } from '@pages/company/register/shared/RegisterChanges';
import { registerSteps } from '@pages/company/shared/proposals';
import {
  correctionsKey,
  useClassCorrections,
  type ClassCorrection,
} from '@pages/company/register/shared/useClassCorrections';
import { entriesKey, useRegisterEntries } from '@pages/company/register/shared/useRegisterEntries';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import type { Landed } from '@pages/company/register/shared/registerPlace';

const COPY = REGISTER_CORRECTION_COPY;

function EntryHistory({
  owner,
  guard,
  token,
  prepare,
  corrections,
  register,
  certificateGuard,
  sourceReady,
  visible,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  token: string;
  prepare: OwnCompanyAppointment | undefined;
  corrections: ClassCorrection[];
  register: TokenHoldersResponse;
  certificateGuard: () => void;
  sourceReady: boolean;
  visible: boolean;
}) {
  const history = useRegisterEntries(owner, token, guard);
  const privateReady = visible && sourceReady && !history.isPending && !history.hasError && !history.isFetching;
  const sequences = new Map(
    [...corrections.map(({ entry }) => entry), ...history.entries].map((entry) => [entry.uuid, entry.sequence]),
  );
  return (
    <div
      hidden={!visible || (!history.isPending && !history.hasError && history.entries.length === 0)}
      className="flex flex-col gap-3"
    >
      <h3 className="text-sm font-medium text-text-primary">{COPY.ENTRIES_TITLE}</h3>
      {history.isPending ? (
        <Loading>Loading register entries…</Loading>
      ) : history.hasError ? (
        <LoadError retry={history.retry} busy={history.isFetching}>
          Register entries could not be loaded.
        </LoadError>
      ) : null}
      <ul className="divide-y divide-border-subtle">
        {history.entries.map((entry) => {
          const corrected = entry.corrects ? sequences.get(entry.corrects) : undefined;
          const reversal = entry.correctedBy ? sequences.get(entry.correctedBy) : undefined;
          return (
            <li key={entry.uuid} hidden={!privateReady} className="flex flex-col gap-2 py-4">
              <Disclosure
                summary={`${COPY.ENTRY_KINDS[entry.kind] ?? entry.kind} · Entry ${entry.sequence} · ${formatDate(entry.effectiveOn)}`}
              >
                {privateReady && (
                  <>
                    <p className="text-xs text-text-muted">
                      Ledger date {formatDate(entry.effectiveOn)} · Recorded {formatDateTime(entry.recordedAt)}
                    </p>
                    {['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase()) && (
                      <p className="text-xs text-text-muted">
                        Company date {entry.companyEventOn ? formatDate(entry.companyEventOn) : 'Not recorded'}
                      </p>
                    )}
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
                        to={generatePath(DESTINATIONS.companyRegisterCorrection.path, {
                          uuid: token,
                          entry: entry.uuid,
                        })}
                        label={COPY.PREPARE}
                        context={`entry ${entry.sequence}`}
                      />
                    )}
                  </>
                )}
                <ClassCertificate
                  sourceKey={`${owner.userUuid}/${owner.ownerAccountUuid}`}
                  register={register}
                  entry={entry}
                  guard={certificateGuard}
                  sourceReady={visible && sourceReady && !history.isFetching && !history.moreFailed}
                />
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
        disabled={history.isFetching}
        onLoad={history.loadMore}
      />
    </div>
  );
}

export function ClassCorrections({
  landed,
  owner,
  guard,
  token,
  company,
  register,
  sourceReady = true,
  visible = true,
  onHeldChange,
}: {
  landed?: Landed;
  owner: OrderSubmissionOwner;
  guard: () => void;
  token: string;
  company: string;
  register: TokenHoldersResponse;
  sourceReady?: boolean;
  visible?: boolean;
  onHeldChange?: (token: string, uuid: string, held: boolean) => void;
}) {
  const client = useQueryClient();
  const appointments = useOwnAppointments(owner, guard);
  const corrections = useClassCorrections(owner, token, guard);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const privateReady =
    visible &&
    sourceReady &&
    corrections.isSuccess &&
    corrections.fetchStatus === 'idle' &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const recordHeld = useCallback(
    (uuid: string, held: boolean) => onHeldChange?.(token, uuid, held),
    [onHeldChange, token],
  );
  const certificateGuard = () => {
    guard();
    const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    const state = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
    if (
      preferences?.status !== 'success' ||
      preferences.fetchStatus !== 'idle' ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      !hasCurrentRegisterReadAuthority(state.data ?? [], company)
    )
      throw new Error('Refresh current company register authority before preparing a certificate.');
  };
  const refresh = async () => {
    try {
      guard();
    } catch {
      return;
    }
    await Promise.all(
      [
        correctionsKey(owner, token),
        allPeopleKey(owner),
        entriesKey(owner, token),
        registerHoldersKey(owner),
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
        register={register}
        certificateGuard={certificateGuard}
        sourceReady={
          sourceReady &&
          appointments.isSuccess &&
          appointments.fetchStatus === 'idle' &&
          hasCurrentRegisterReadAuthority(appointments.data, company)
        }
        visible={visible}
      />
      <div
        hidden={!visible || (corrections.isSuccess && corrections.data.length === 0)}
        className="flex flex-col gap-3 border-t border-border-subtle pt-4"
      >
        <h3 className="text-sm font-medium text-text-primary">{COPY.TITLE}</h3>
        {appointments.isError ? (
          <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
            Your appointments could not be loaded.
          </LoadError>
        ) : (
          steps &&
          !Object.values(steps).some(Boolean) && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
        )}
        {corrections.isPending ? (
          <Loading>Loading corrections…</Loading>
        ) : corrections.isError ? (
          <LoadError retry={() => corrections.refetch()} busy={corrections.isFetching}>
            Corrections could not be loaded.
          </LoadError>
        ) : null}
        <ul className="divide-y divide-border-subtle">
          {(corrections.data ?? []).map((correction) => (
            <CorrectionRecord
              key={correction.proposal.uuid}
              landed={landed?.record === correction.proposal.uuid ? landed : undefined}
              correction={correction}
              visible={privateReady}
              onHeldChange={recordHeld}
              steps={steps ?? {}}
              guard={guard}
              onDecided={refresh}
              onRefused={refresh}
            />
          ))}
        </ul>
      </div>
    </>
  );
}

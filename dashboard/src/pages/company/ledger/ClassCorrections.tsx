import { registerHoldersKey } from '@pages/company/shared/useCompanyRegister';
import { allPeopleKey } from '@pages/company/ledger/shared/usePeople';
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
import { LoadError, Loading, Disclosure, Row, Rows, Status } from '@components/Ledger';
import { LoadMore } from '@components/List';
import { PageLink } from '@components/Page';

import { CorrectionRecord } from './CorrectionRecord';
import { ClassCertificate } from './ClassCertificate';
import { RegisterChanges } from '@pages/company/ledger/shared/RegisterChanges';
import { registerSteps } from '@pages/company/shared/proposals';
import {
  correctionsKey,
  useClassCorrections,
  type ClassCorrection,
} from '@pages/company/ledger/shared/useClassCorrections';
import { entriesKey, useRegisterEntries } from '@pages/company/ledger/shared/useRegisterEntries';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';

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
    <div hidden={!visible} className="flex flex-col gap-3">
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
          className="hidden grid-cols-[12rem_10rem_minmax(0,1fr)] gap-6 pl-7 text-xs font-medium text-text-muted md:grid"
        >
          <span>Change</span>
          <span>Date</span>
          <span>Share movements</span>
        </div>
      )}
      <ul aria-label="Ledger changes" className="divide-y divide-border-subtle">
        {history.entries.map((entry) => {
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
                <div className="flex flex-wrap justify-end gap-2">
                  <ClassCertificate
                    sourceKey={`${owner.userUuid}/${owner.ownerAccountUuid}`}
                    register={register}
                    entry={entry}
                    guard={certificateGuard}
                    sourceReady={visible && sourceReady && !history.isFetching && !history.moreFailed}
                    secondaryAction={
                      privateReady && prepare && entry.correctable ? (
                        <PageLink
                          to={generatePath(DESTINATIONS.companyRegisterCorrection.path, {
                            uuid: token,
                            entry: entry.uuid,
                          })}
                          label={COPY.PREPARE}
                          context={`entry ${entry.sequence}`}
                        />
                      ) : undefined
                    }
                  />
                </div>
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

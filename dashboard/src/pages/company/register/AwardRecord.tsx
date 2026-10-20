import { RecordShell, RecordDownloadFailure } from './RecordShell';
import { useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_AWARD_COPY as COPY,
  REGISTER_GRANT_COPY as GRANT_COPY,
  formatDateTime,
  remainingRegisterAwardVesting,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterAward,
  type RegisterGrant,
} from '@ledova/shared';
import { LinkRow, Row, Rows, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { AwardStatus } from '@components/AwardStatus';
import { STAGE_TONES, shareCount } from '@pages/company/shared/proposals';
import {
  awardVestingsKey,
  awardEndsKey,
  awardVestingReversalsKey,
  useRegisterAwardVestings,
  useRegisterAwardEnds,
  useRegisterAwardVestingReversals,
} from '@pages/company/register/shared/useRegisterAwards';
import { AwardVestingForm } from './AwardVestingForm';
import { AwardAdjustmentForm } from './AwardAdjustmentForm';
import { useAwardRecordDownload } from './useRegisterRecordDownload';

const SUMMARY = 'cursor-pointer py-2 text-sm font-medium text-text-primary';

export function AwardRecord({
  owner,
  award,
  grants,
  appointment,
  guard,
  blocked,
  onSettled,
  visible = true,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  award: RegisterAward;
  grants: RegisterGrant[];
  appointment?: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onSettled: () => Promise<unknown>;
  visible?: boolean;
  onHeldChange?: (held: boolean) => void;
}) {
  const client = useQueryClient();
  const available = useRef(visible && !blocked);
  useLayoutEffect(() => {
    available.current = visible && !blocked;
  }, [visible, blocked]);
  const [adjusting, setAdjusting] = useState<{
    appointment: OwnCompanyAppointment;
    vesting?: string;
    vestingLabel?: string;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [formAppointment, setFormAppointment] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);

  const events = useRegisterAwardVestings(owner, award.company, award.uuid, guard);

  const ends = useRegisterAwardEnds(owner, award.company, award.uuid, guard);
  const reversals = useRegisterAwardVestingReversals(owner, award.company, award.uuid, guard);
  const recordGuard = () => {
    guard();
    if (
      !available.current ||
      [
        awardVestingsKey(owner, award.uuid),
        awardEndsKey(owner, award.uuid),
        awardVestingReversalsKey(owner, award.uuid),
      ].some((key) => {
        const state = client.getQueryState(key);
        return state?.status !== 'success' || state.fetchStatus !== 'idle';
      })
    )
      throw new Error('Refresh this award and its current records before continuing.');
  };
  const download = useAwardRecordDownload(owner, award, guard, blocked, visible, events, ends, reversals);
  const settle = async () => {
    guard();
    await Promise.all([
      events.refetch({ throwOnError: true }),
      ends.refetch({ throwOnError: true }),
      reversals.refetch({ throwOnError: true }),
      onSettled(),
    ]);
    guard();
    setFormHeld(false);
    onHeldChange?.(false);
    setEditing(false);
    setFormAppointment(null);
    setAdjusting(null);
  };
  const eventReady = [events, ends, reversals].every((query) => query.isSuccess && !query.isFetching);
  const correcting = events.data?.find((event) => event.uuid === adjusting?.vesting);
  const reversibleShares = correcting
    ? (remainingRegisterAwardVesting(correcting, reversals.data ?? []) ?? undefined)
    : undefined;
  return (
    <RecordShell
      className={`flex flex-col gap-4 ${visible ? 'rounded-xl border border-border-subtle bg-surface-raised p-4 sm:p-5' : ''}`}
    >
      {visible && (
        <>
          <h4 className="text-base font-medium text-text-primary">{award.name}</h4>
          <AwardStatus {...award} />
          <div className="flex flex-wrap gap-2">
            {((appointment && BigInt(award.unvestedRemainingShares) > 0n) || (editing && formAppointment)) && (
              <PageAction
                label={editing ? 'Close vesting form' : 'Record vesting'}
                disabled={blocked || !eventReady || formHeld || !!adjusting}
                onClick={() => {
                  if (editing) {
                    setEditing(false);
                    setFormAppointment(null);
                  } else if (appointment) {
                    setFormAppointment(appointment);
                    setEditing(true);
                  }
                }}
              />
            )}
            {(adjusting || (appointment && BigInt(award.remainingUnissuedShares) > 0n)) && (
              <PageAction
                label={adjusting ? 'Close change form' : COPY.END}
                disabled={blocked || !eventReady || formHeld || editing}
                onClick={() => {
                  if (adjusting) setAdjusting(null);
                  else if (appointment) {
                    recordGuard();
                    setAdjusting({ appointment });
                  }
                }}
              />
            )}
            {appointment &&
              !blocked &&
              eventReady &&
              !formHeld &&
              !adjusting &&
              !editing &&
              BigInt(award.availableShares) > 0n && (
                <LinkRow
                  label="Issue vested shares"
                  to={DESTINATIONS.companyRegister.path}
                  state={{ registerCompany: award.company, registerToken: award.token, issueAward: award.uuid }}
                />
              )}
          </div>
          <details>
            <summary className={SUMMARY}>Agreement and vesting schedule</summary>
            <Rows>
              <Row label={COPY.TERMS_ON}>{award.termsOn}</Row>
              <Row label={COPY.TERMS}>{award.terms}</Row>
              <Row label={COPY.SCHEDULE}>{award.schedule}</Row>
              <Row label="Residential address">{award.residentialAddress}</Row>
            </Rows>
            <p className="py-2 text-sm text-text-muted">{COPY.NOTE}</p>
            <PageAction
              label="Download agreement"
              busy={download.isPending && !download.variables}
              busyLabel="Downloading…"
              context={`award for ${award.name}`}
              disabled={blocked || download.isPending}
              onClick={() => download.mutate(undefined)}
            />
          </details>
          {download.isError && (
            <RecordDownloadFailure>
              The retained document could not be downloaded. Refresh and try again.
            </RecordDownloadFailure>
          )}
          {events.isPending ? (
            <p role="status" className="text-sm text-text-muted">
              Loading vesting events…
            </p>
          ) : events.isError ? (
            <>
              <p role="alert" className="text-sm text-error-light">
                The vesting events could not be loaded.
              </p>
              <PageAction
                label="Retry vesting events"
                disabled={events.isFetching}
                onClick={() => void events.refetch()}
              />
            </>
          ) : (
            <details>
              <summary className={SUMMARY}>
                Recorded vesting history{events.data.length > 0 ? ` · ${events.data.length}` : ''}
              </summary>
              {events.data.length === 0 && (
                <p className="text-sm text-text-muted">No company-recorded vesting event.</p>
              )}
              {!events.isFetching &&
                events.data.map((event) => (
                  <div key={event.uuid} className="space-y-2 border-t border-border-subtle pt-3">
                    <Rows>
                      <Row label={COPY.VESTING_SHARES}>{shareCount(event.shares)}</Row>
                      <Row label={COPY.VESTED_ON}>{event.vestedOn}</Row>
                      <Row label="Recorded on">{formatDateTime(event.createdAt)}</Row>
                      <Row label="Recorded by">{event.preparedByName || 'Name not recorded'}</Row>
                    </Rows>
                    <PageAction
                      label="Download vesting evidence"
                      busy={download.isPending && download.variables?.uuid === event.uuid}
                      busyLabel="Downloading…"
                      context={`${event.shares} shares dated ${event.vestedOn}`}
                      disabled={blocked || download.isPending || !eventReady}
                      onClick={() => download.mutate({ kind: 'vesting', uuid: event.uuid })}
                    />
                    {appointment && (
                      <PageAction
                        label={COPY.REVERSE}
                        context={`${event.shares} shares dated ${event.vestedOn}`}
                        disabled={
                          blocked ||
                          !eventReady ||
                          formHeld ||
                          editing ||
                          !!adjusting ||
                          BigInt(award.availableShares) === 0n ||
                          remainingRegisterAwardVesting(event, reversals.data ?? []) === null ||
                          BigInt(remainingRegisterAwardVesting(event, reversals.data ?? []) ?? '0') === 0n
                        }
                        onClick={() => {
                          recordGuard();
                          const remaining = remainingRegisterAwardVesting(event, reversals.data ?? []);
                          if (remaining !== null)
                            setAdjusting({
                              appointment,
                              vesting: event.uuid,
                              vestingLabel: `${event.shares} shares · ${event.vestedOn}`,
                            });
                        }}
                      />
                    )}
                  </div>
                ))}
            </details>
          )}
          {ends.isPending || reversals.isPending || ends.isFetching || reversals.isFetching ? (
            <p role="status" className="text-sm text-text-muted">
              Loading entitlement changes…
            </p>
          ) : ends.isError || reversals.isError ? (
            <>
              <p role="alert" className="text-sm text-error-light">
                Entitlement changes could not be loaded.
              </p>
              <PageAction
                label="Retry entitlement changes"
                onClick={() => void Promise.all([ends.refetch(), reversals.refetch()])}
              />
            </>
          ) : (
            <details>
              <summary className={SUMMARY}>Entitlement changes</summary>
              {ends.data.length === 0 && reversals.data.length === 0 && (
                <p className="text-sm text-text-muted">No entitlement changes recorded.</p>
              )}
              {ends.data.map((event) => (
                <div key={event.uuid} className="space-y-2 border-t border-border-subtle pt-3">
                  <Rows>
                    <Row label={COPY.ENDED_UNVESTED}>{shareCount(event.unvestedShares)}</Row>
                    <Row label={COPY.ENDED_VESTED}>{shareCount(event.vestedShares)}</Row>
                    <Row label={COPY.COMPANY_EVENT_ON}>{event.companyEventOn}</Row>
                    <Row label={COPY.REASON}>{event.reason}</Row>
                    <Row label="Recorded on">{formatDateTime(event.createdAt)}</Row>
                    <Row label="Recorded by">{event.preparedByName || 'Name not recorded'}</Row>
                  </Rows>
                  <PageAction
                    label="Download entitlement evidence"
                    busy={download.isPending && download.variables?.uuid === event.uuid}
                    busyLabel="Downloading…"
                    context={event.companyEventOn}
                    disabled={blocked || download.isPending || !eventReady}
                    onClick={() => download.mutate({ kind: 'end', uuid: event.uuid })}
                  />
                </div>
              ))}
              {reversals.data.map((event) => (
                <div key={event.uuid} className="space-y-2 border-t border-border-subtle pt-3">
                  <Rows>
                    <Row label={COPY.REVERSED_SHARES}>{shareCount(event.reversedShares)}</Row>
                    <Row label="Original vesting">{event.vesting}</Row>
                    <Row label={COPY.COMPANY_EVENT_ON}>{event.companyEventOn}</Row>
                    <Row label={COPY.REASON}>{event.reason}</Row>
                    <Row label="Recorded on">{formatDateTime(event.createdAt)}</Row>
                    <Row label="Recorded by">{event.preparedByName || 'Name not recorded'}</Row>
                  </Rows>
                  <PageAction
                    label="Download correction evidence"
                    busy={download.isPending && download.variables?.uuid === event.uuid}
                    busyLabel="Downloading…"
                    context={event.companyEventOn}
                    disabled={blocked || download.isPending || !eventReady}
                    onClick={() => download.mutate({ kind: 'reversal', uuid: event.uuid })}
                  />
                </div>
              ))}
            </details>
          )}
          {grants.length > 0 && (
            <details>
              <summary className={SUMMARY}>Non-paid issues from this award · {grants.length}</summary>
              {grants.map((grant) => (
                <LinkRow
                  key={grant.uuid}
                  label={`${shareCount(grant.shares)}, prepared ${formatDateTime(grant.createdAt)}`}
                  context={`issue from the award for ${award.name}`}
                  to={DESTINATIONS.companyRegister.path}
                  state={{ registerCompany: award.company, registerToken: award.token, registerRecord: grant.uuid }}
                  aside={
                    <Status tone={STAGE_TONES[grant.stage] ?? 'waiting'}>
                      {grant.stage === 'applied' ? 'Shares issued' : (GRANT_COPY.STAGES[grant.stage] ?? grant.stage)}
                    </Status>
                  }
                />
              ))}
            </details>
          )}
          <details>
            <summary className={SUMMARY}>Record details</summary>
            <Rows>
              <Row label="Member ID">{award.member}</Row>
              <Row label="Award ID">{award.uuid}</Row>
              <Row label="Recorded on">{formatDateTime(award.createdAt)}</Row>
              <Row label="Recorded by">{award.preparedByName || 'Name not recorded'}</Row>
            </Rows>
          </details>
        </>
      )}
      {adjusting && (
        <AwardAdjustmentForm
          key={`${award.uuid}/${adjusting.appointment.uuid}/${adjusting.vesting ?? 'end'}`}
          award={award}
          appointment={adjusting.appointment}
          vesting={adjusting.vesting}
          reversibleShares={reversibleShares}
          vestingLabel={adjusting.vestingLabel}
          guard={recordGuard}
          blocked={blocked || !eventReady}
          visible={visible && eventReady}
          canPrepare={appointment?.uuid === adjusting.appointment.uuid}
          onHeldChange={(held) => {
            setFormHeld(held);
            onHeldChange?.(held);
          }}
          onRecorded={settle}
        />
      )}
      {editing && formAppointment && (
        <AwardVestingForm
          key={`${award.uuid}/${formAppointment.uuid}`}
          award={award}
          appointment={formAppointment}
          guard={recordGuard}
          blocked={blocked || !eventReady}
          visible={visible && eventReady}
          canPrepare={appointment?.uuid === formAppointment.uuid}
          onHeldChange={(held) => {
            setFormHeld(held);
            onHeldChange?.(held);
          }}
          onRecorded={settle}
        />
      )}
    </RecordShell>
  );
}

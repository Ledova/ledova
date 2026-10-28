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
  shareCount,
  formatShareCount,
  formatDate,
} from '@ledova/shared';
import { LinkRow, Row, Rows, Status, LoadError, Loading, Disclosure } from '@components/Ledger';
import { FormActions, PageAction, PageLink } from '@components/Page';
import { AwardStatus } from '@components/AwardStatus';
import { STAGE_TONES } from '@pages/company/shared/proposals';
import { shareholderPath } from '@pages/company/ledger/shared/shareholders';
import {
  awardVestingsKey,
  awardEndsKey,
  awardVestingReversalsKey,
  useRegisterAwardVestings,
  useRegisterAwardEnds,
  useRegisterAwardVestingReversals,
} from '@pages/company/ledger/shared/useRegisterAwards';
import { AwardVestingForm } from './AwardVestingForm';
import { AwardAdjustmentForm } from './AwardAdjustmentForm';
import { useAwardRecordDownload } from './useRegisterRecordDownload';

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
  onEditingChange,
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
  onEditingChange?: (editing: boolean) => void;
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
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [formAppointment, setFormAppointment] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);
  const editingCallback = useRef(onEditingChange);
  useLayoutEffect(() => {
    editingCallback.current = onEditingChange;
    onEditingChange?.(editing || !!adjusting);
  }, [onEditingChange, editing, adjusting]);
  useLayoutEffect(() => () => editingCallback.current?.(false), []);

  const events = useRegisterAwardVestings(owner, award.company, award.uuid, guard);
  const vestingName = (vesting: { shares: string; vestedOn: string }) =>
    `${shareCount(vesting.shares)} dated ${formatDate(vesting.vestedOn)}`;
  const originalVesting = (uuid: string) => {
    const vesting = events.data?.find((event) => event.uuid === uuid);
    return vesting ? vestingName(vesting) : 'An earlier vesting';
  };

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
    <RecordShell className={visible ? 'border-t border-border-subtle' : ''}>
      {visible && (
        <Disclosure
          open={expanded || editing || !!adjusting || formHeld}
          onToggle={() => {
            if (!editing && !adjusting && !formHeld) setExpanded((value) => !value);
          }}
          keepMounted
          summary={
            <span className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm md:grid-cols-[minmax(0,1fr)_repeat(3,7rem)] md:gap-6">
              <span className="col-span-3 min-w-0 break-words md:col-span-1">
                <span className="sr-only">Award for </span>
                <span className="block font-medium text-text-primary">{award.recipientName}</span>
                <span className="block text-xs text-text-muted">Agreement {formatDate(award.termsOn)}</span>
              </span>
              <span className="min-w-0 break-words tabular-nums text-text-primary md:text-right">
                <span className="block text-xs text-text-muted md:sr-only">Promised </span>
                {formatShareCount(award.shares)}
              </span>
              <span className="min-w-0 break-words tabular-nums text-text-primary md:text-right">
                <span className="block text-xs text-text-muted md:sr-only">Vested </span>
                {formatShareCount(award.vestedShares)}
              </span>
              <span className="min-w-0 break-words tabular-nums text-text-primary md:text-right">
                <span className="block text-xs text-text-muted md:sr-only">Issued </span>
                {formatShareCount(award.issuedShares)}
              </span>
            </span>
          }
        >
          <div className="space-y-3">
            <h4 className="sr-only">{award.recipientName}</h4>
            <div hidden={editing || !!adjusting}>
              <AwardStatus {...award} compact />
            </div>
            <Disclosure summary="Agreement and vesting schedule">
              <Rows>
                <Row label={COPY.TERMS_ON}>{formatDate(award.termsOn)}</Row>
                <Row label={COPY.TERMS}>{award.terms}</Row>
                <Row label={COPY.SCHEDULE}>{award.schedule}</Row>
                <Row label="Residential address">{award.recipientResidentialAddress}</Row>
              </Rows>
              <p className="py-2 text-sm text-text-muted">{COPY.NOTE}</p>
              <PageAction
                label="Download agreement"
                busy={download.isPending && !download.variables}
                busyLabel="Downloading…"
                context={`award for ${award.recipientName}`}
                disabled={blocked || download.isPending}
                onClick={() => download.mutate(undefined)}
              />
            </Disclosure>
            {download.isError && (
              <RecordDownloadFailure>
                The retained document could not be downloaded. Refresh and try again.
              </RecordDownloadFailure>
            )}
            {events.isPending ? (
              <Loading>Loading vesting events…</Loading>
            ) : events.isError ? (
              <LoadError retry={() => events.refetch()} busy={events.isFetching}>
                Vesting events could not be loaded.
              </LoadError>
            ) : (
              <div hidden={editing || !!adjusting}>
                <Disclosure
                  summary={`Recorded vesting history${events.data.length > 0 ? ` · ${events.data.length}` : ''}`}
                >
                  {events.data.length === 0 && (
                    <p className="text-sm text-text-muted">No company-recorded vesting event.</p>
                  )}
                  {!events.isFetching &&
                    events.data.map((event) => (
                      <div key={event.uuid} className="space-y-2 border-t border-border-subtle pt-3">
                        <Rows>
                          <Row label={COPY.VESTING_SHARES}>{shareCount(event.shares)}</Row>
                          <Row label={COPY.VESTED_ON}>{formatDate(event.vestedOn)}</Row>
                          <Row label="Recorded on">{formatDateTime(event.createdAt)}</Row>
                          <Row label="Recorded by">{event.preparedByName || 'Name not recorded'}</Row>
                        </Rows>
                        <PageAction
                          label="Download vesting evidence"
                          busy={
                            download.isPending &&
                            download.variables?.kind === 'vesting' &&
                            download.variables.uuid === event.uuid
                          }
                          busyLabel="Downloading…"
                          context={vestingName(event)}
                          disabled={blocked || download.isPending || !eventReady}
                          onClick={() => download.mutate({ kind: 'vesting', uuid: event.uuid })}
                        />
                        {appointment && (
                          <PageAction
                            label={COPY.REVERSE}
                            context={vestingName(event)}
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
                                  vestingLabel: vestingName(event),
                                });
                            }}
                          />
                        )}
                      </div>
                    ))}
                </Disclosure>
              </div>
            )}
            {ends.isPending || reversals.isPending || ends.isFetching || reversals.isFetching ? (
              <Loading>Loading entitlement changes…</Loading>
            ) : ends.isError || reversals.isError ? (
              <LoadError
                retry={() => Promise.all([ends.refetch(), reversals.refetch()])}
                busy={ends.isFetching || reversals.isFetching}
              >
                Entitlement changes could not be loaded.
              </LoadError>
            ) : (
              <div hidden={editing || !!adjusting}>
                <Disclosure summary="Entitlement changes">
                  {ends.data.length === 0 && reversals.data.length === 0 && (
                    <p className="text-sm text-text-muted">No entitlement changes recorded.</p>
                  )}
                  {ends.data.map((event) => (
                    <div key={event.uuid} className="space-y-2 border-t border-border-subtle pt-3">
                      <Rows>
                        <Row label={COPY.ENDED_UNVESTED}>{shareCount(event.unvestedShares)}</Row>
                        <Row label={COPY.ENDED_VESTED}>{shareCount(event.vestedShares)}</Row>
                        <Row label={COPY.COMPANY_EVENT_ON}>{formatDate(event.companyEventOn)}</Row>
                        <Row label={COPY.REASON}>{event.reason}</Row>
                        <Row label="Recorded on">{formatDateTime(event.createdAt)}</Row>
                        <Row label="Recorded by">{event.preparedByName || 'Name not recorded'}</Row>
                      </Rows>
                      <PageAction
                        label="Download entitlement evidence"
                        busy={
                          download.isPending &&
                          download.variables?.kind === 'end' &&
                          download.variables.uuid === event.uuid
                        }
                        busyLabel="Downloading…"
                        context={formatDate(event.companyEventOn)}
                        disabled={blocked || download.isPending || !eventReady}
                        onClick={() => download.mutate({ kind: 'end', uuid: event.uuid })}
                      />
                    </div>
                  ))}
                  {reversals.data.map((event) => (
                    <div key={event.uuid} className="space-y-2 border-t border-border-subtle pt-3">
                      <Rows>
                        <Row label={COPY.REVERSED_SHARES}>{shareCount(event.reversedShares)}</Row>
                        <Row label="Original vesting">{originalVesting(event.vesting)}</Row>
                        <Row label={COPY.COMPANY_EVENT_ON}>{formatDate(event.companyEventOn)}</Row>
                        <Row label={COPY.REASON}>{event.reason}</Row>
                        <Row label="Recorded on">{formatDateTime(event.createdAt)}</Row>
                        <Row label="Recorded by">{event.preparedByName || 'Name not recorded'}</Row>
                      </Rows>
                      <PageAction
                        label="Download correction evidence"
                        busy={
                          download.isPending &&
                          download.variables?.kind === 'reversal' &&
                          download.variables.uuid === event.uuid
                        }
                        busyLabel="Downloading…"
                        context={formatDate(event.companyEventOn)}
                        disabled={blocked || download.isPending || !eventReady}
                        onClick={() => download.mutate({ kind: 'reversal', uuid: event.uuid })}
                      />
                    </div>
                  ))}
                </Disclosure>
              </div>
            )}
            {grants.length > 0 && (
              <div hidden={editing || !!adjusting}>
                <Disclosure summary={`Non-paid issues from this award · ${grants.length}`}>
                  {grants.map((grant) => (
                    <LinkRow
                      key={grant.uuid}
                      label={`${shareCount(grant.shares)}, prepared ${formatDateTime(grant.createdAt)}`}
                      context={`issue from the award for ${award.recipientName}`}
                      to={`${DESTINATIONS.companyRegister.path}?company=${award.company}#issue`}
                      state={{ registerCompany: award.company, registerToken: award.token, registerRecord: grant.uuid }}
                      aside={
                        <Status tone={STAGE_TONES[grant.stage] ?? 'waiting'}>
                          {grant.stage === 'applied'
                            ? 'Shares issued'
                            : (GRANT_COPY.STAGES[grant.stage] ?? grant.stage)}
                        </Status>
                      }
                    />
                  ))}
                </Disclosure>
              </div>
            )}
            <p hidden={editing || !!adjusting} className="text-xs text-text-muted">
              Recorded {formatDateTime(award.createdAt)}
              {award.preparedByName && ` by ${award.preparedByName}`}
            </p>
            {!editing && !adjusting && (
              <FormActions>
                {!formHeld && (
                  <PageLink
                    to={shareholderPath(award.member, award.company)}
                    label="Recipient details"
                    context={award.recipientName}
                  />
                )}
                {appointment && BigInt(award.unvestedRemainingShares) > 0n && (
                  <PageAction
                    label="Record vesting"
                    disabled={blocked || !eventReady || formHeld}
                    onClick={() => {
                      setFormAppointment(appointment);
                      setEditing(true);
                    }}
                  />
                )}
                {appointment && BigInt(award.remainingUnissuedShares) > 0n && (
                  <PageAction
                    label={COPY.END}
                    disabled={blocked || !eventReady || formHeld}
                    onClick={() => {
                      recordGuard();
                      setAdjusting({ appointment });
                    }}
                  />
                )}
                {appointment && !blocked && eventReady && !formHeld && BigInt(award.availableShares) > 0n && (
                  <PageLink
                    label="Issue vested shares"
                    to={`${DESTINATIONS.companyRegister.path}?company=${award.company}#issue`}
                    state={{ registerCompany: award.company, registerToken: award.token, issueAward: award.uuid }}
                  />
                )}
              </FormActions>
            )}
          </div>
        </Disclosure>
      )}
      <div hidden={!editing && !adjusting} className="space-y-3 pb-4 pl-7">
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
            onCancel={() => setAdjusting(null)}
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
            onCancel={() => {
              setEditing(false);
              setFormAppointment(null);
            }}
          />
        )}
      </div>
    </RecordShell>
  );
}

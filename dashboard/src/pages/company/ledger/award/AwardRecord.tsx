import { RecordDownloadFailure } from '@pages/company/ledger/shared/RecordShell';
import { useId, useLayoutEffect, useRef, useState } from 'react';
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
  formatDate,
} from '@ledova/shared';
import { LinkRow, MoreToggle, Row, Rows, Section, Status, LoadError, Loading } from '@components/Ledger';
import { FormActions, PageAction, PageLink } from '@components/Page';
import { AwardStatus } from '@components/AwardStatus';
import { STAGE_TONES } from '@pages/company/shared/proposals';
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
import { useAwardRecordDownload } from './useAwardRecordDownload';

const LATEST_VESTINGS = 3;

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
  const vestingsId = useId();
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
  const [allVestings, setAllVestings] = useState(false);
  const [formAppointment, setFormAppointment] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);

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
  const formOpen = editing || !!adjusting;
  const vestings = events.data ?? [];
  const changes = (ends.data?.length ?? 0) + (reversals.data?.length ?? 0);
  return (
    <>
      {(visible || formOpen) && (
        <Section title="Entitlement">
          {visible && <AwardStatus {...award} />}
          {visible && !formOpen && (
            <FormActions>
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
          <div hidden={!formOpen} className="space-y-3">
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
        </Section>
      )}
      {visible && events.isError && (
        <LoadError retry={() => events.refetch()} busy={events.isFetching}>
          Vesting events could not be loaded.
        </LoadError>
      )}
      {visible && (ends.isError || reversals.isError) && (
        <LoadError
          retry={() => Promise.all([ends.refetch(), reversals.refetch()])}
          busy={ends.isFetching || reversals.isFetching}
        >
          Entitlement changes could not be loaded.
        </LoadError>
      )}
      {visible && (
        <Section title="Agreement and vesting schedule">
          <Rows>
            <Row label={COPY.TERMS_ON}>{formatDate(award.termsOn)}</Row>
            <Row label={COPY.TERMS}>{award.terms}</Row>
            <Row label={COPY.SCHEDULE}>{award.schedule}</Row>
            <Row label="Residential address">{award.recipientResidentialAddress}</Row>
          </Rows>
          <p className="text-sm text-text-muted">{COPY.NOTE}</p>
          <FormActions>
            <PageAction
              label="Download agreement"
              busy={download.isPending && !download.variables}
              busyLabel="Downloading…"
              context={`award for ${award.recipientName}`}
              disabled={blocked || download.isPending}
              onClick={() => download.mutate(undefined)}
            />
          </FormActions>
          {download.isError && (
            <RecordDownloadFailure>
              The retained document could not be downloaded. Refresh and try again.
            </RecordDownloadFailure>
          )}
        </Section>
      )}
      {visible && !formOpen && (
        <>
          {events.isPending ? (
            <Loading>Loading vesting events…</Loading>
          ) : (
            events.isSuccess &&
            vestings.length > 0 && (
              <Section title="Vesting history">
                <div id={vestingsId} className="divide-y divide-border-subtle">
                  {!events.isFetching &&
                    (allVestings ? vestings : vestings.slice(0, LATEST_VESTINGS)).map((event) => (
                      <div key={event.uuid} className="space-y-2 py-3 first:pt-0">
                        <Rows>
                          <Row label={COPY.VESTING_SHARES}>{shareCount(event.shares)}</Row>
                          <Row label={COPY.VESTED_ON}>{formatDate(event.vestedOn)}</Row>
                        </Rows>
                        <p className="text-xs text-text-muted">
                          Recorded {formatDateTime(event.createdAt)}
                          {event.preparedByName && ` by ${event.preparedByName}`}
                        </p>
                        <FormActions>
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
                        </FormActions>
                      </div>
                    ))}
                </div>
                {vestings.length > LATEST_VESTINGS && (
                  <MoreToggle
                    open={allVestings}
                    controls={vestingsId}
                    onToggle={() => setAllVestings((value) => !value)}
                  >
                    {allVestings ? 'Show the latest vesting events' : `Show all ${vestings.length} vesting events`}
                  </MoreToggle>
                )}
              </Section>
            )
          )}
          {ends.isPending || reversals.isPending || ends.isFetching || reversals.isFetching ? (
            <Loading>Loading entitlement changes…</Loading>
          ) : (
            ends.isSuccess &&
            reversals.isSuccess &&
            changes > 0 && (
              <Section title="Entitlement changes">
                <div className="divide-y divide-border-subtle">
                  {ends.data.map((event) => (
                    <div key={event.uuid} className="space-y-2 py-3 first:pt-0">
                      <Rows>
                        <Row label={COPY.ENDED_UNVESTED}>{shareCount(event.unvestedShares)}</Row>
                        <Row label={COPY.ENDED_VESTED}>{shareCount(event.vestedShares)}</Row>
                        <Row label={COPY.COMPANY_EVENT_ON}>{formatDate(event.companyEventOn)}</Row>
                        <Row label={COPY.REASON}>{event.reason}</Row>
                      </Rows>
                      <p className="text-xs text-text-muted">
                        Recorded {formatDateTime(event.createdAt)}
                        {event.preparedByName && ` by ${event.preparedByName}`}
                      </p>
                      <FormActions>
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
                      </FormActions>
                    </div>
                  ))}
                  {reversals.data.map((event) => (
                    <div key={event.uuid} className="space-y-2 py-3 first:pt-0">
                      <Rows>
                        <Row label={COPY.REVERSED_SHARES}>{shareCount(event.reversedShares)}</Row>
                        <Row label="Original vesting">{originalVesting(event.vesting)}</Row>
                        <Row label={COPY.COMPANY_EVENT_ON}>{formatDate(event.companyEventOn)}</Row>
                        <Row label={COPY.REASON}>{event.reason}</Row>
                      </Rows>
                      <p className="text-xs text-text-muted">
                        Recorded {formatDateTime(event.createdAt)}
                        {event.preparedByName && ` by ${event.preparedByName}`}
                      </p>
                      <FormActions>
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
                      </FormActions>
                    </div>
                  ))}
                </div>
              </Section>
            )
          )}
          {grants.length > 0 && (
            <Section title="Non-paid issues from this award">
              <div className="divide-y divide-border-subtle">
                {grants.map((grant) => (
                  <LinkRow
                    key={grant.uuid}
                    label={`${shareCount(grant.shares)}, prepared ${formatDateTime(grant.createdAt)}`}
                    context={`issue from the award for ${award.recipientName}`}
                    to={`${DESTINATIONS.companyRegister.path}?company=${award.company}#issue`}
                    state={{ registerCompany: award.company, registerToken: award.token, registerRecord: grant.uuid }}
                    aside={
                      <Status tone={STAGE_TONES[grant.stage] ?? 'waiting'}>
                        {grant.stage === 'applied' ? 'Shares issued' : (GRANT_COPY.STAGES[grant.stage] ?? grant.stage)}
                      </Status>
                    }
                  />
                ))}
              </div>
            </Section>
          )}
          <p className="text-xs text-text-muted">
            Recorded {formatDateTime(award.createdAt)}
            {award.preparedByName && ` by ${award.preparedByName}`}
          </p>
        </>
      )}
    </>
  );
}

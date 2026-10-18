import { RecordShell, RecordDownloadFailure } from './RecordShell';
import { useState } from 'react';
import { generatePath } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_AWARD_COPY as COPY,
  formatDateTime,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterAward,
} from '@ledova/shared';
import { LinkRow, Row, Rows } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { AwardStatus } from '@components/AwardStatus';
import { shareCount } from '@pages/company/shared/proposals';
import { useRegisterAwardVestings } from '@pages/company/register/shared/useRegisterAwards';
import { AwardVestingForm } from './AwardVestingForm';
import { useAwardRecordDownload } from './useRegisterRecordDownload';

const SUMMARY = 'cursor-pointer py-2 text-sm font-medium text-text-primary';

export function AwardRecord({
  owner,
  award,
  appointment,
  guard,
  blocked,
  onSettled,
  visible = true,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  award: RegisterAward;
  appointment?: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onSettled: () => Promise<unknown>;
  visible?: boolean;
  onHeldChange?: (held: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [formAppointment, setFormAppointment] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);

  const events = useRegisterAwardVestings(owner, award.company, award.uuid, guard);

  const download = useAwardRecordDownload(owner, award, guard, blocked, visible, events);
  const settle = async () => {
    guard();
    await Promise.all([events.refetch({ throwOnError: true }), onSettled()]);
    guard();
    setFormHeld(false);
    onHeldChange?.(false);
    setEditing(false);
    setFormAppointment(null);
  };
  const eventReady = !events.isPending && !events.isFetching && !events.isError;
  return (
    <RecordShell
      className={`flex flex-col gap-4 ${visible ? 'rounded-xl border border-border-subtle bg-surface-raised p-4 sm:p-5' : ''}`}
    >
      {visible && (
        <>
          <h4 className="text-base font-medium text-text-primary">{award.name}</h4>
          <AwardStatus {...award} />
          <div className="flex flex-wrap gap-2">
            {((appointment && BigInt(award.vestedShares) < BigInt(award.shares)) || (editing && formAppointment)) && (
              <PageAction
                label={editing ? 'Close vesting form' : 'Record vesting'}
                disabled={blocked || !eventReady || formHeld}
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
            {appointment && !blocked && eventReady && !formHeld && BigInt(award.availableShares) > 0n && (
              <LinkRow
                label="Issue vested shares"
                to={`${generatePath(DESTINATIONS.companyRegisterGrant.path, { uuid: award.token })}?award=${encodeURIComponent(award.uuid)}`}
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
                      context={`${event.shares} shares dated ${event.vestedOn}`}
                      disabled={blocked || download.isPending || !eventReady}
                      onClick={() => download.mutate(event.uuid)}
                    />
                  </div>
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
      {editing && formAppointment && (
        <AwardVestingForm
          key={`${award.uuid}/${formAppointment.uuid}`}
          award={award}
          appointment={formAppointment}
          guard={guard}
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

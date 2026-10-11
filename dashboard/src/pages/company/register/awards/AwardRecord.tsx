import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_AWARD_COPY as COPY,
  downloadRegisterAwardFile,
  downloadRegisterAwardVestingFile,
  formatDateTime,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterAward,
} from '@ledova/shared';
import { LinkRow, Row, Rows } from '@components/Ledger';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { retainedName, shareCount } from '../proposals';
import { saveFile } from '../useCompanyRegister';
import { useRegisterAwardVestings } from '../useRegisterAwards';
import { AwardVestingForm } from './AwardVestingForm';

export function AwardRecord({
  owner,
  award,
  appointment,
  guard,
  blocked,
  onSettled,
}: {
  owner: OrderSubmissionOwner;
  award: RegisterAward;
  appointment?: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onSettled: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [formHeld, setFormHeld] = useState(false);
  const events = useRegisterAwardVestings(owner, award.company, award.uuid, guard);
  const download = useMutation({
    mutationFn: async (eventId?: string) => {
      guard();
      const { data } = eventId
        ? await downloadRegisterAwardVestingFile(apiClient, eventId, { ledovaSubmissionGuard: guard })
        : await downloadRegisterAwardFile(apiClient, award.uuid, { ledovaSubmissionGuard: guard });
      guard();
      const snapshot = eventId
        ? events.data?.find((row) => row.uuid === eventId)?.evidenceSnapshot
        : award.agreementSnapshot;
      saveFile(data, retainedName(snapshot, `award-${eventId || award.uuid}`));
    },
  });
  const settle = async () => {
    guard();
    await Promise.all([events.refetch({ throwOnError: true }), onSettled()]);
    guard();
    setEditing(false);
  };
  return (
    <li className="flex flex-col gap-3 py-4">
      <h4 className="text-sm font-medium text-text-primary">
        {award.name} · {award.member}
      </h4>
      <Rows>
        <Row label={COPY.PROMISED}>{shareCount(award.shares)}</Row>
        <Row label={COPY.VESTED}>{shareCount(award.vestedShares)}</Row>
        <Row label={COPY.ISSUED}>{shareCount(award.issuedShares)}</Row>
        <Row label={COPY.AVAILABLE}>{shareCount(award.availableShares)}</Row>
        <Row label="Residential address">{award.residentialAddress}</Row>
        <Row label={COPY.TERMS_ON}>{award.termsOn}</Row>
        <Row label={COPY.TERMS}>{award.terms}</Row>
        <Row label={COPY.SCHEDULE}>{award.schedule}</Row>
        <Row label="Recorded on">{formatDateTime(award.createdAt)}</Row>
        <Row label="Recorded by">{award.preparedByName || 'Name not recorded'}</Row>
      </Rows>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      <PageAction
        label="Download agreement"
        context={`award for ${award.name}`}
        disabled={download.isPending}
        onClick={() => download.mutate(undefined)}
      />
      {download.isError && (
        <p role="alert" className="text-sm text-error-light">
          The retained document could not be downloaded. Try again.
        </p>
      )}
      {appointment && !blocked && !events.isFetching && !events.isError && BigInt(award.availableShares) > 0n && (
        <LinkRow
          label={COPY.PREPARE_GRANT}
          to={`${DESTINATIONS.companyRegisterGrant.path.replace(':uuid', award.token)}?award=${encodeURIComponent(award.uuid)}`}
        />
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
          <PageAction label="Retry vesting events" disabled={events.isFetching} onClick={() => void events.refetch()} />
        </>
      ) : (
        <>
          {events.data.length === 0 && <p className="text-sm text-text-muted">No company-recorded vesting event.</p>}
          {events.data.map((event) => (
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
                disabled={download.isPending}
                onClick={() => download.mutate(event.uuid)}
              />
            </div>
          ))}
        </>
      )}
      {appointment && (editing || BigInt(award.vestedShares) < BigInt(award.shares)) && (
        <>
          <PageAction
            label={editing ? 'Close vesting form' : COPY.VEST}
            disabled={blocked || events.isFetching || events.isError || formHeld}
            onClick={() => setEditing((value) => !value)}
          />
          {editing && (
            <AwardVestingForm
              key={`${award.uuid}/${appointment.uuid}`}
              award={award}
              appointment={appointment}
              guard={guard}
              blocked={blocked || events.isFetching || events.isError}
              onHeldChange={setFormHeld}
              onRecorded={settle}
            />
          )}
        </>
      )}
    </li>
  );
}

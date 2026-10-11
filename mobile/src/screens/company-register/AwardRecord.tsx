import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  REGISTER_AWARD_COPY as COPY,
  formatDateTime,
  type OwnCompanyAppointment,
  type RegisterAward,
} from '@ledova/shared';
import { Action, Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { AwardVestingForm } from './AwardVestingForm';
import { RegisterCopy } from './RegisterCopy';
import { useCompanyStyles } from './styles';
import { useRegisterAwardVestings } from './useRegisterAwards';

export function AwardRecord({
  award,
  epoch,
  appointment,
  guard,
  blocked,
  onSettled,
  onPrepareGrant,
}: {
  award: RegisterAward;
  epoch: number;
  appointment?: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onSettled: () => Promise<unknown>;
  onPrepareGrant: (award: string) => void;
}) {
  const styles = useCompanyStyles();
  const [editing, setEditing] = useState(false);
  const [formHeld, setFormHeld] = useState(false);
  const events = useRegisterAwardVestings(epoch, award.company, award.uuid, guard);
  const settle = async () => {
    guard();
    await Promise.all([events.refetch({ throwOnError: true }), onSettled()]);
    guard();
    setEditing(false);
  };
  return (
    <View style={styles.entry}>
      <Text style={styles.heading}>
        {award.name} · {award.member}
      </Text>
      <Rows>
        <Row label={COPY.PROMISED}>{award.shares}</Row>
        <Row label={COPY.VESTED}>{award.vestedShares}</Row>
        <Row label={COPY.ISSUED}>{award.issuedShares}</Row>
        <Row label={COPY.AVAILABLE}>{award.availableShares}</Row>
        <Row label="Residential address">{award.residentialAddress}</Row>
        <Row label={COPY.TERMS_ON}>{award.termsOn}</Row>
        <Row label={COPY.TERMS}>{award.terms}</Row>
        <Row label={COPY.SCHEDULE}>{award.schedule}</Row>
        <Row label="Recorded on">{formatDateTime(award.createdAt)}</Row>
        <Row label="Recorded by">{award.preparedByName || 'Name not recorded'}</Row>
      </Rows>
      <Text style={styles.muted}>{COPY.NOTE}</Text>
      <RegisterCopy
        label="Download agreement"
        accessibilityLabel={`Download agreement for ${award.name} ${award.uuid}`}
        filename={`award-${award.uuid}`}
        epoch={epoch}
        guard={guard}
        read={() =>
          apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_FILE(award.uuid), {
            responseType: 'arraybuffer',
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: guard,
          })
        }
      />
      {appointment && !blocked && !events.isFetching && !events.isError && BigInt(award.availableShares) > 0n && (
        <Action
          label={COPY.PREPARE_GRANT}
          accessibilityLabel={`${COPY.PREPARE_GRANT} for ${award.name} ${award.uuid}`}
          onPress={() => {
            guard();
            onPrepareGrant(award.uuid);
          }}
        />
      )}
      {events.isPending ? (
        <Text style={styles.muted}>Loading vesting events…</Text>
      ) : events.isError ? (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            The vesting events could not be loaded.
          </Text>
          <Action label="Retry vesting events" disabled={events.isFetching} onPress={() => void events.refetch()} />
        </>
      ) : (
        <>
          {events.data.length === 0 && <Text style={styles.muted}>No company-recorded vesting event.</Text>}
          {events.data.map((event) => (
            <View key={event.uuid} style={styles.group}>
              <Rows>
                <Row label={COPY.VESTING_SHARES}>{event.shares}</Row>
                <Row label={COPY.VESTED_ON}>{event.vestedOn}</Row>
                <Row label="Recorded on">{formatDateTime(event.createdAt)}</Row>
                <Row label="Recorded by">{event.preparedByName || 'Name not recorded'}</Row>
              </Rows>
              <RegisterCopy
                label="Download vesting evidence"
                accessibilityLabel={`Download vesting evidence for ${event.shares} shares dated ${event.vestedOn} ${event.uuid}`}
                filename={`vesting-${event.uuid}`}
                epoch={epoch}
                guard={guard}
                read={() =>
                  apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_VESTING_FILE(event.uuid), {
                    responseType: 'arraybuffer',
                    ledovaSessionEpoch: epoch,
                    ledovaSubmissionGuard: guard,
                  })
                }
              />
            </View>
          ))}
        </>
      )}
      {appointment && (editing || BigInt(award.vestedShares) < BigInt(award.shares)) && (
        <>
          <Action
            label={editing ? 'Close vesting form' : COPY.VEST}
            disabled={blocked || events.isFetching || events.isError || formHeld}
            onPress={() => setEditing((value) => !value)}
          />
          {editing && (
            <AwardVestingForm
              key={`${award.uuid}/${appointment.uuid}`}
              award={award}
              epoch={epoch}
              appointment={appointment}
              guard={guard}
              blocked={blocked || events.isFetching || events.isError}
              onHeldChange={setFormHeld}
              onRecorded={settle}
            />
          )}
        </>
      )}
    </View>
  );
}

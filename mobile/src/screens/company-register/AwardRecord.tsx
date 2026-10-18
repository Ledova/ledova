import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  REGISTER_AWARD_COPY as COPY,
  formatDateTime,
  formatShareCount,
  type OwnCompanyAppointment,
  type RegisterAward,
} from '@ledova/shared';
import { Action, Disclosure, Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { AwardVestingForm } from './AwardVestingForm';
import { RegisterCopy } from '../../components/register/RegisterCopy';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { awardVestingsKey, useRegisterAwardVestings } from './useRegisterAwards';

export function AwardRecord({
  award,
  epoch,
  appointment,
  guard,
  blocked,
  onSettled,
  onPrepareGrant,
  visible = true,
  onHeldChange,
}: {
  award: RegisterAward;
  epoch: number;
  appointment?: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  onSettled: () => Promise<unknown>;
  onPrepareGrant: (award: string) => void;
  visible?: boolean;
  onHeldChange?: (key: string, held: boolean) => void;
}) {
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const privateAvailable = useRef(visible);
  useLayoutEffect(() => {
    privateAvailable.current = visible;
  }, [visible]);
  const [editing, setEditing] = useState<OwnCompanyAppointment | null>(null);
  const [details, setDetails] = useState(false);
  const [formHeld, setFormHeld] = useState(false);
  useEffect(() => {
    onHeldChange?.(award.uuid, formHeld);
  }, [onHeldChange, award.uuid, formHeld]);
  useEffect(() => () => onHeldChange?.(award.uuid, false), [onHeldChange, award.uuid]);
  const events = useRegisterAwardVestings(epoch, award.company, award.uuid, guard);
  const recordGuard = () => {
    guard();
    const state = client.getQueryState(awardVestingsKey(epoch, award.uuid));
    if (!privateAvailable.current || state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error('Refresh this award and its vesting records before continuing.');
  };
  const settle = async () => {
    guard();
    await onSettled();
    await events.refetch({ throwOnError: true });
    guard();
    setEditing(null);
  };
  return (
    <View style={visible ? styles.entry : undefined}>
      {visible && (
        <>
          <Text style={styles.heading}>{award.name}</Text>
          <Text style={styles.text}>
            {formatShareCount(award.shares)} awarded · {formatShareCount(award.vestedShares)} vested ·{' '}
            {formatShareCount(award.issuedShares)} issued
          </Text>
          <Text style={styles.muted}>
            {BigInt(award.availableShares) > 0n
              ? `${formatShareCount(award.availableShares)} vested shares are available for a separate company-approved issue.`
              : BigInt(award.vestedShares) < BigInt(award.shares)
                ? 'Record vesting when the company confirms its conditions.'
                : 'No vested shares remain available to issue.'}
          </Text>
          <Disclosure
            open={details}
            onToggle={() => setDetails((value) => !value)}
            accessibilityLabel={`Award records for ${award.name}`}
            summary={<Text style={styles.muted}>Agreement and vesting records</Text>}
          >
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
              guard={recordGuard}
              read={() =>
                apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_FILE(award.uuid), {
                  responseType: 'arraybuffer',
                  ledovaSessionEpoch: epoch,
                  ledovaSubmissionGuard: recordGuard,
                })
              }
            />
          </Disclosure>
          {appointment && !blocked && !events.isFetching && !events.isError && BigInt(award.availableShares) > 0n && (
            <Action
              label="Issue vested shares"
              accessibilityLabel={`Issue vested shares for ${award.name}`}
              onPress={() => {
                guard();
                onPrepareGrant(award.uuid);
              }}
            />
          )}
          <View style={details || events.isError ? undefined : { display: 'none' }}>
            {events.isPending || events.isFetching ? (
              <Text style={styles.muted}>Loading vesting events…</Text>
            ) : events.isError ? (
              <>
                <Text accessibilityRole="alert" style={styles.error}>
                  The vesting events could not be loaded.
                </Text>
                <Action
                  label="Retry vesting events"
                  disabled={events.isFetching}
                  onPress={() => void events.refetch()}
                />
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
                      guard={recordGuard}
                      read={() =>
                        apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_VESTING_FILE(event.uuid), {
                          responseType: 'arraybuffer',
                          ledovaSessionEpoch: epoch,
                          ledovaSubmissionGuard: recordGuard,
                        })
                      }
                    />
                  </View>
                ))}
              </>
            )}
          </View>
          {(editing || (appointment && BigInt(award.vestedShares) < BigInt(award.shares))) && (
            <>
              <Action
                label={editing ? 'Close vesting form' : 'Record vesting'}
                disabled={blocked || events.isFetching || events.isError || formHeld}
                onPress={() => setEditing((value) => (value ? null : (appointment ?? null)))}
              />
            </>
          )}
        </>
      )}
      {editing && (
        <AwardVestingForm
          key={`${award.uuid}/${editing.uuid}`}
          award={award}
          epoch={epoch}
          appointment={editing}
          guard={recordGuard}
          blocked={blocked || events.isFetching || events.isError}
          visible={visible && events.isSuccess && !events.isFetching}
          onHeldChange={setFormHeld}
          onRecorded={settle}
        />
      )}
    </View>
  );
}

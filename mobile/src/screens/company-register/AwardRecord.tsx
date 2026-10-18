import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  REGISTER_AWARD_COPY as COPY,
  formatDateTime,
  formatShareCount,
  remainingRegisterAwardVesting,
  type OwnCompanyAppointment,
  type RegisterAward,
} from '@ledova/shared';
import { Action, Disclosure, Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { AwardVestingForm } from './AwardVestingForm';
import { AwardAdjustmentForm } from './AwardAdjustmentForm';
import { RegisterCopy } from '../../components/register/RegisterCopy';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import {
  awardVestingsKey,
  awardEndsKey,
  awardVestingReversalsKey,
  useRegisterAwardVestings,
  useRegisterAwardEnds,
  useRegisterAwardVestingReversals,
} from './useRegisterAwards';

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
  const privateAvailable = useRef(visible && !blocked);
  useLayoutEffect(() => {
    privateAvailable.current = visible && !blocked;
  }, [visible, blocked]);
  const [adjusting, setAdjusting] = useState<{
    appointment: OwnCompanyAppointment;
    vesting?: string;
    vestingLabel?: string;
  } | null>(null);
  const [editing, setEditing] = useState<OwnCompanyAppointment | null>(null);
  const [details, setDetails] = useState(false);
  const [formHeld, setFormHeld] = useState(false);
  useEffect(() => {
    onHeldChange?.(award.uuid, formHeld);
  }, [onHeldChange, award.uuid, formHeld]);
  useEffect(() => () => onHeldChange?.(award.uuid, false), [onHeldChange, award.uuid]);
  const events = useRegisterAwardVestings(epoch, award.company, award.uuid, guard);
  const ends = useRegisterAwardEnds(epoch, award.company, award.uuid, guard);
  const reversals = useRegisterAwardVestingReversals(epoch, award.company, award.uuid, guard);
  const eventReady = [events, ends, reversals].every((query) => query.isSuccess && !query.isFetching);
  const recordGuard = () => {
    guard();
    if (
      !privateAvailable.current ||
      [
        awardVestingsKey(epoch, award.uuid),
        awardEndsKey(epoch, award.uuid),
        awardVestingReversalsKey(epoch, award.uuid),
      ].some((key) => {
        const state = client.getQueryState(key);
        return state?.status !== 'success' || state.fetchStatus !== 'idle';
      })
    )
      throw new Error('Refresh this award and its vesting records before continuing.');
  };
  const settle = async () => {
    guard();
    await onSettled();
    await Promise.all([
      events.refetch({ throwOnError: true }),
      ends.refetch({ throwOnError: true }),
      reversals.refetch({ throwOnError: true }),
    ]);
    guard();
    setEditing(null);
    setAdjusting(null);
  };
  const correcting = events.data?.find((event) => event.uuid === adjusting?.vesting);
  const reversibleShares = correcting
    ? (remainingRegisterAwardVesting(correcting, reversals.data ?? []) ?? undefined)
    : undefined;
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
              : BigInt(award.unvestedRemainingShares) > 0n
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
              <Row label={COPY.ENDED_UNVESTED}>{award.endedUnvestedShares}</Row>
              <Row label={COPY.ENDED_VESTED}>{award.endedVestedShares}</Row>
              <Row label={COPY.UNVESTED_REMAINING}>{award.unvestedRemainingShares}</Row>
              <Row label={COPY.REMAINING_UNISSUED}>{award.remainingUnissuedShares}</Row>
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
          {appointment &&
            !blocked &&
            !formHeld &&
            !editing &&
            !adjusting &&
            eventReady &&
            BigInt(award.availableShares) > 0n && (
              <Action
                label="Issue vested shares"
                accessibilityLabel={`Issue vested shares for ${award.name}`}
                onPress={() => {
                  recordGuard();
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
                    {appointment && (
                      <Action
                        label={COPY.REVERSE}
                        accessibilityLabel={`Correct vesting ${event.shares} shares dated ${event.vestedOn}`}
                        disabled={
                          blocked ||
                          !eventReady ||
                          formHeld ||
                          !!editing ||
                          !!adjusting ||
                          BigInt(award.availableShares) === 0n ||
                          remainingRegisterAwardVesting(event, reversals.data ?? []) === null ||
                          BigInt(remainingRegisterAwardVesting(event, reversals.data ?? []) ?? '0') === 0n
                        }
                        onPress={() => {
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
                  </View>
                ))}
              </>
            )}
          </View>
          {ends.isPending || reversals.isPending || ends.isFetching || reversals.isFetching ? (
            <Text style={styles.muted}>Loading entitlement changes…</Text>
          ) : ends.isError || reversals.isError ? (
            <>
              <Text accessibilityRole="alert" style={styles.error}>
                Entitlement changes could not be loaded.
              </Text>
              <Action
                label="Retry entitlement changes"
                onPress={() => void Promise.all([ends.refetch(), reversals.refetch()])}
              />
            </>
          ) : (
            details && (
              <>
                {ends.data.map((event) => (
                  <View key={event.uuid} style={styles.group}>
                    <Rows>
                      <Row label={COPY.ENDED_UNVESTED}>{event.unvestedShares}</Row>
                      <Row label={COPY.ENDED_VESTED}>{event.vestedShares}</Row>
                      <Row label={COPY.COMPANY_EVENT_ON}>{event.companyEventOn}</Row>
                      <Row label={COPY.REASON}>{event.reason}</Row>
                      <Row label="Recorded on">{formatDateTime(event.createdAt)}</Row>
                      <Row label="Recorded by">{event.preparedByName || 'Name not recorded'}</Row>
                    </Rows>
                    <RegisterCopy
                      label="Download entitlement evidence"
                      accessibilityLabel={`Download entitlement evidence ${event.uuid}`}
                      filename={`entitlement-${event.uuid}`}
                      epoch={epoch}
                      guard={recordGuard}
                      read={() =>
                        apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_END_FILE(event.uuid), {
                          responseType: 'arraybuffer',
                          ledovaSessionEpoch: epoch,
                          ledovaSubmissionGuard: recordGuard,
                        })
                      }
                    />
                  </View>
                ))}
                {reversals.data.map((event) => (
                  <View key={event.uuid} style={styles.group}>
                    <Rows>
                      <Row label={COPY.REVERSED_SHARES}>{event.reversedShares}</Row>
                      <Row label="Original vesting">{event.vesting}</Row>
                      <Row label={COPY.COMPANY_EVENT_ON}>{event.companyEventOn}</Row>
                      <Row label={COPY.REASON}>{event.reason}</Row>
                      <Row label="Recorded on">{formatDateTime(event.createdAt)}</Row>
                      <Row label="Recorded by">{event.preparedByName || 'Name not recorded'}</Row>
                    </Rows>
                    <RegisterCopy
                      label="Download correction evidence"
                      accessibilityLabel={`Download correction evidence ${event.uuid}`}
                      filename={`vesting-correction-${event.uuid}`}
                      epoch={epoch}
                      guard={recordGuard}
                      read={() =>
                        apiClient.get<ArrayBuffer>(
                          COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_VESTING_REVERSAL_FILE(event.uuid),
                          {
                            responseType: 'arraybuffer',
                            ledovaSessionEpoch: epoch,
                            ledovaSubmissionGuard: recordGuard,
                          },
                        )
                      }
                    />
                  </View>
                ))}
              </>
            )
          )}
          {(adjusting || (appointment && BigInt(award.remainingUnissuedShares) > 0n)) && (
            <Action
              label={adjusting ? 'Close change form' : COPY.END}
              disabled={blocked || !eventReady || formHeld || !!editing}
              onPress={() => {
                recordGuard();
                setAdjusting((value) => (value ? null : appointment ? { appointment } : null));
              }}
            />
          )}
          {(editing || (appointment && BigInt(award.unvestedRemainingShares) > 0n)) && (
            <>
              <Action
                label={editing ? 'Close vesting form' : 'Record vesting'}
                disabled={blocked || !eventReady || formHeld || !!adjusting}
                onPress={() => setEditing((value) => (value ? null : (appointment ?? null)))}
              />
            </>
          )}
        </>
      )}
      {adjusting && (
        <AwardAdjustmentForm
          key={`${award.uuid}/${adjusting.appointment.uuid}/${adjusting.vesting ?? 'end'}`}
          award={award}
          epoch={epoch}
          appointment={adjusting.appointment}
          vesting={adjusting.vesting}
          reversibleShares={reversibleShares}
          vestingLabel={adjusting.vestingLabel}
          guard={recordGuard}
          blocked={blocked || !eventReady}
          visible={visible && eventReady}
          canPrepare={appointment?.uuid === adjusting.appointment.uuid}
          onHeldChange={setFormHeld}
          onRecorded={settle}
        />
      )}
      {editing && (
        <AwardVestingForm
          key={`${award.uuid}/${editing.uuid}`}
          award={award}
          epoch={epoch}
          appointment={editing}
          guard={recordGuard}
          blocked={blocked || !eventReady}
          visible={visible && eventReady}
          onHeldChange={setFormHeld}
          onRecorded={settle}
        />
      )}
    </View>
  );
}

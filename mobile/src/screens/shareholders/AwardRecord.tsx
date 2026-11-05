import { useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_AWARD_COPY as COPY,
  REGISTER_GRANT_COPY as GRANT_COPY,
  STAGE_TONES,
  awardEndsKey,
  awardVestingReversalsKey,
  awardVestingsKey,
  formatDate,
  formatDateTime,
  formatShortDate,
  remainingRegisterAwardVesting,
  shareCount,
  useAwardRecordDownload,
  useRegisterAwardEnds,
  useRegisterAwardVestingReversals,
  useRegisterAwardVestings,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterAward,
  type RegisterGrant,
} from '@ledova/shared';
import { AwardStatus } from '../../components/AwardStatus';
import {
  Action,
  Actions,
  Fact,
  FormActions,
  LinkRow,
  LoadError,
  Loading,
  MoreToggle,
  Rows,
  Section,
  ShowMore,
  Status,
} from '../../components/Ledger';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { AwardAdjustmentForm, AwardVestingForm } from './AwardForms';
import { useShareholderStyles } from './useShareholderStyles';

const LATEST_VESTINGS = 3;

export function AwardRecord({
  owner,
  award,
  grants,
  appointment,
  guard,
  blocked,
  onSettled,
  visible,
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
  visible: boolean;
  onHeldChange: (held: boolean) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const client = useQueryClient();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const styles = useCompanyStyles();
  const look = useShareholderStyles();
  const own = useThemedStyles((theme) => ({ facts: { gap: theme.spacing.xs }, first: { paddingTop: 0 } }));
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
  const events = useRegisterAwardVestings(owner, award.company, award.uuid, guard, orderSubmissionSession);
  const vestingName = (vesting: { shares: string; vestedOn: string }) =>
    `${shareCount(vesting.shares)} dated ${formatDate(vesting.vestedOn)}`;
  const originalVesting = (uuid: string) => {
    const vesting = events.data?.find((event) => event.uuid === uuid);
    return vesting ? vestingName(vesting) : 'an earlier vesting';
  };
  const ends = useRegisterAwardEnds(owner, award.company, award.uuid, guard, orderSubmissionSession);
  const reversals = useRegisterAwardVestingReversals(owner, award.company, award.uuid, guard, orderSubmissionSession);
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
  const download = useAwardRecordDownload(
    owner,
    award,
    guard,
    blocked,
    visible,
    events,
    ends,
    reversals,
    SHARE_SHEET_FILES,
    orderSubmissionSession,
  );
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
    onHeldChange(false);
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
  useLayoutEffect(() => {
    onEditingChange(formOpen);
  }, [onEditingChange, formOpen]);
  const downloadFailure = (
    <Text accessibilityRole="alert" style={styles.error}>
      The retained document could not be downloaded. Refresh and try again.
    </Text>
  );
  const busy = (kind?: 'vesting' | 'end' | 'reversal', uuid?: string) =>
    download.isPending && download.variables?.kind === kind && download.variables?.uuid === uuid;
  const vestings = events.data ?? [];
  const changes = (ends.data?.length ?? 0) + (reversals.data?.length ?? 0);
  const issuing = grants.filter((grant) => grant.stage !== 'applied' && grant.stage !== 'rejected');
  const recordVesting = BigInt(award.unvestedRemainingShares) > 0n;
  const endRights = BigInt(award.remainingUnissuedShares) > 0n;
  const issueVested = !blocked && eventReady && !formHeld && BigInt(award.availableShares) > 0n;
  const formHeldChange = (held: boolean) => {
    setFormHeld(held);
    onHeldChange(held);
  };
  return (
    <>
      {(visible || formOpen) && (
        <Section title="Entitlement">
          {visible && <AwardStatus award={award} />}
          {visible && !formOpen && appointment && (recordVesting || endRights || issueVested) && (
            <FormActions>
              {recordVesting && (
                <Action
                  label="Record vesting"
                  disabled={blocked || !eventReady || formHeld}
                  onPress={() => {
                    setFormAppointment(appointment);
                    setEditing(true);
                  }}
                />
              )}
              {endRights && (
                <Action
                  label={COPY.END}
                  disabled={blocked || !eventReady || formHeld}
                  onPress={() => {
                    try {
                      recordGuard();
                    } catch {
                      return;
                    }
                    setAdjusting({ appointment });
                  }}
                />
              )}
              {issueVested && (
                <Action
                  label="Issue vested shares"
                  onPress={() =>
                    navigation.navigate('IssueShares', {
                      company: award.company,
                      token: award.token,
                      award: award.uuid,
                    })
                  }
                />
              )}
            </FormActions>
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
              onHeldChange={formHeldChange}
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
              onHeldChange={formHeldChange}
              onRecorded={settle}
              onCancel={() => {
                setEditing(false);
                setFormAppointment(null);
              }}
            />
          )}
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
        <Section title="Agreement">
          <View style={look.line}>
            <Text style={[look.muted, look.fill]}>Dated {formatShortDate(award.termsOn)}</Text>
            <Action
              compact
              label={busy() ? 'Downloading…' : 'Download agreement'}
              accessibilityLabel={`${busy() ? 'Downloading…' : 'Download agreement'} (award for ${award.recipientName})`}
              disabled={blocked || download.isPending}
              onPress={() => download.mutate(undefined)}
            />
          </View>
          {download.isError && !download.variables && downloadFailure}
          <ShowMore show="Show terms and vesting schedule" hide="Hide terms and vesting schedule">
            <Rows>
              <Fact label={COPY.TERMS}>{award.terms}</Fact>
              <Fact label={COPY.SCHEDULE}>{award.schedule}</Fact>
            </Rows>
            <Text style={look.small}>
              Recorded {formatDateTime(award.createdAt)}
              {award.preparedByName ? ` by ${award.preparedByName}` : ''}
            </Text>
          </ShowMore>
        </Section>
      )}
      {visible && !formOpen && (
        <>
          {events.isPending || events.isFetching ? (
            <Loading>Loading vesting events…</Loading>
          ) : (
            events.isSuccess &&
            vestings.length > 0 && (
              <Section title="Vesting history">
                <Rows>
                  {(allVestings ? vestings : vestings.slice(0, LATEST_VESTINGS)).map((event, index) => {
                    const remaining = remainingRegisterAwardVesting(event, reversals.data ?? []);
                    const correctable =
                      appointment && BigInt(award.availableShares) > 0n && remaining !== null && BigInt(remaining) > 0n;
                    const name = vestingName(event);
                    return (
                      <View key={event.uuid} style={[look.row, index === 0 && own.first]}>
                        <View style={look.line}>
                          <Text style={[look.title, look.fill]}>{shareCount(event.shares)} vested</Text>
                          <Text style={[look.figure, look.title]}>{formatShortDate(event.vestedOn)}</Text>
                        </View>
                        <Actions compact>
                          <Action
                            compact
                            label={busy('vesting', event.uuid) ? 'Downloading…' : 'Download evidence'}
                            accessibilityLabel={`${busy('vesting', event.uuid) ? 'Downloading…' : 'Download evidence'} (${name})`}
                            disabled={blocked || download.isPending || !eventReady}
                            onPress={() => download.mutate({ kind: 'vesting', uuid: event.uuid })}
                          />
                          {correctable && (
                            <Action
                              compact
                              label="Correct"
                              accessibilityLabel={`Correct (${name})`}
                              disabled={blocked || !eventReady || formHeld}
                              onPress={() => {
                                try {
                                  recordGuard();
                                } catch {
                                  return;
                                }
                                setAdjusting({ appointment, vesting: event.uuid, vestingLabel: name });
                              }}
                            />
                          )}
                        </Actions>
                      </View>
                    );
                  })}
                </Rows>
                {vestings.length > LATEST_VESTINGS && (
                  <MoreToggle open={allVestings} onToggle={() => setAllVestings((value) => !value)}>
                    {allVestings ? 'Show the latest vesting events' : `Show all ${vestings.length} vesting events`}
                  </MoreToggle>
                )}
                {download.isError && download.variables?.kind === 'vesting' && downloadFailure}
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
                <Rows>
                  {ends.data.map((event, index) => (
                    <View key={event.uuid} style={[look.row, index === 0 && own.first]}>
                      <View style={own.facts}>
                        <View style={look.line}>
                          <Text style={[look.title, look.fill]}>
                            {shareCount(String(BigInt(event.unvestedShares) + BigInt(event.vestedShares)))} ended
                          </Text>
                          <Text style={[look.figure, look.title]}>{formatShortDate(event.companyEventOn)}</Text>
                        </View>
                        <Text style={look.small}>{event.reason}</Text>
                      </View>
                      <Actions>
                        <Action
                          compact
                          label={busy('end', event.uuid) ? 'Downloading…' : 'Download evidence'}
                          accessibilityLabel={`${busy('end', event.uuid) ? 'Downloading…' : 'Download evidence'} (rights ended ${formatDate(event.companyEventOn)})`}
                          disabled={blocked || download.isPending || !eventReady}
                          onPress={() => download.mutate({ kind: 'end', uuid: event.uuid })}
                        />
                      </Actions>
                    </View>
                  ))}
                  {reversals.data.map((event, index) => (
                    <View key={event.uuid} style={[look.row, ends.data.length + index === 0 && own.first]}>
                      <View style={own.facts}>
                        <View style={look.line}>
                          <Text style={[look.title, look.fill]}>{shareCount(event.reversedShares)} reversed</Text>
                          <Text style={[look.figure, look.title]}>{formatShortDate(event.companyEventOn)}</Text>
                        </View>
                        <Text style={look.small}>
                          From {originalVesting(event.vesting)} · {event.reason}
                        </Text>
                      </View>
                      <Actions>
                        <Action
                          compact
                          label={busy('reversal', event.uuid) ? 'Downloading…' : 'Download evidence'}
                          accessibilityLabel={`${busy('reversal', event.uuid) ? 'Downloading…' : 'Download evidence'} (correction ${formatDate(event.companyEventOn)})`}
                          disabled={blocked || download.isPending || !eventReady}
                          onPress={() => download.mutate({ kind: 'reversal', uuid: event.uuid })}
                        />
                      </Actions>
                    </View>
                  ))}
                </Rows>
                {download.isError &&
                  (download.variables?.kind === 'end' || download.variables?.kind === 'reversal') &&
                  downloadFailure}
              </Section>
            )
          )}
          {issuing.length > 0 && (
            <Section title="Non-paid issues from this award">
              <Rows>
                {issuing.map((grant) => {
                  const prepared = formatShortDate(grant.createdAt);
                  const stage = GRANT_COPY.STAGES[grant.stage] ?? grant.stage;
                  return (
                    <LinkRow
                      key={grant.uuid}
                      label={shareCount(grant.shares)}
                      accessibilityLabel={`${shareCount(grant.shares)}, prepared ${prepared} (issue from the award for ${award.recipientName}), ${stage}`}
                      figure={<Status tone={STAGE_TONES[grant.stage] ?? 'waiting'}>{stage}</Status>}
                      onPress={() =>
                        navigation.navigate('IssueShares', {
                          company: award.company,
                          token: award.token,
                          record: grant.uuid,
                        })
                      }
                    >
                      <Text style={look.small}>Prepared {prepared}</Text>
                    </LinkRow>
                  );
                })}
              </Rows>
            </Section>
          )}
        </>
      )}
    </>
  );
}

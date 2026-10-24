import { useSyncExternalStore, type ReactNode } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { StackActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  DESTINATIONS,
  HOLDER_TYPE_LABELS,
  REGISTER_COPY,
  REGISTER_CORRECTION_COPY,
  REGISTER_PARTICULARS_COPY,
  USER_PREFERENCES_QUERY_KEY,
  formatDate,
  formatDateTime,
  formatShareCount,
  hasCurrentRegisterReadAuthority,
  shareCount,
  sharePercentage,
  useCompanyMemberAccess,
  useUserPreferences,
} from '@ledova/shared';
import { Action, Row, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import {
  useCompanyRegisters,
  useMemberEntries,
  useRegisterAppointments,
  useTransferMembers,
} from '../../hooks/useCompanyRegister';
import type { CompanyRegisterSection } from './CompanyRegisterScreen';
import { MemberDocuments } from './MemberDocuments';
import { useMemberAwards } from './useRegisterAwards';

const PRIVATE_NOTE =
  'Holdings, particulars, history and awards show only to someone with a current company register appointment.';

function signed(shares: bigint) {
  const size = formatShareCount((shares < 0n ? -shares : shares).toString());
  return shares < 0n ? `−${size}` : `+${size}`;
}

function Problem({
  message,
  label,
  busy,
  retry,
}: {
  message: string;
  label: string;
  busy: boolean;
  retry: () => void;
}) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      <Text accessibilityRole="alert" style={styles.error}>
        {message}
      </Text>
      <Action label={label} disabled={busy} onPress={retry} />
    </View>
  );
}

export function CompanyShareholderScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  return <CompanyShareholder key={epoch} epoch={epoch} />;
}

function CompanyShareholder({ epoch }: { epoch: number }) {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NativeStackNavigationProp<CompanyStackParamList>>();
  const { companyUuid: company, memberUuid: member } =
    useRoute<RouteProp<CompanyStackParamList, 'CompanyShareholder'>>().params;
  const client = useQueryClient();
  const preferenceRead = useUserPreferences();
  const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const data = useCompanyRegisters(epoch, company);
  const { appointments, steps } = useRegisterAppointments(epoch, company);
  const particulars = useTransferMembers(epoch, data.tokens[0] ?? '', data.tokens.length > 0);
  const entries = useMemberEntries(epoch, data.tokens, member);
  const sourceReady =
    preferences?.status === 'success' &&
    preferences.fetchStatus === 'idle' &&
    data.classes.isSuccess &&
    data.classes.fetchStatus === 'idle' &&
    data.registers.isSuccess &&
    data.registers.fetchStatus === 'idle' &&
    !!data.company;
  const authorised =
    sourceReady && appointments.isSuccess && hasCurrentRegisterReadAuthority(appointments.data, company);
  const awards = useMemberAwards(epoch, company, member, authorised);
  const access = useCompanyMemberAccess(company, Crypto.randomUUID, orderSubmissionSession, sourceReady);
  const open = (section: CompanyRegisterSection) => navigation.dispatch(StackActions.popTo('CompanyMain', { section }));
  const refresh = () =>
    Promise.all([
      preferenceRead.refetch(),
      data.classes.refetch(),
      ...(data.tokens.length ? [data.registers.refetch(), particulars.refetch(), entries.refetch()] : []),
      appointments.refetch(),
      ...(authorised ? [awards.refetch()] : []),
    ]);
  const retryRegister = () => {
    void data.classes.refetch();
    void data.registers.refetch();
  };
  let title: string = DESTINATIONS.companyShareholder.title;
  let content: ReactNode;
  if (preferences?.status === 'error')
    content = (
      <Problem
        message="Your account could not be loaded."
        label="Retry account"
        busy={preferences.fetchStatus !== 'idle'}
        retry={() => void preferenceRead.refetch()}
      />
    );
  else if (data.classes.isPending) content = <Text style={styles.muted}>Loading the register…</Text>;
  else if (data.classes.isError || data.registers.isError)
    content = (
      <Problem
        message="The register could not be loaded."
        label="Retry register"
        busy={data.classes.isFetching || data.registers.isFetching}
        retry={retryRegister}
      />
    );
  else if (!data.company)
    content = <Text style={styles.muted}>This shareholder is not on a register you can read.</Text>;
  else if (!sourceReady) content = <Text style={styles.muted}>Loading the register…</Text>;
  else if (appointments.isError)
    content = (
      <Problem
        message="Your appointments could not be loaded."
        label="Retry appointments"
        busy={appointments.isFetching}
        retry={() => void appointments.refetch()}
      />
    );
  else if (!appointments.isSuccess) content = <Text style={styles.muted}>Loading your appointments…</Text>;
  else if (!authorised) content = <Text style={styles.muted}>{PRIVATE_NOTE}</Text>;
  else {
    const registers = data.registers.data ?? [];
    const holdings = registers.flatMap((register) =>
      register.holders.filter((holder) => holder.member === member).map((holder) => ({ register, holder })),
    );
    const former = registers.flatMap((register) =>
      (register.formerMembers ?? []).filter((row) => row.member === member).map((row) => ({ register, row })),
    );
    const recorded = particulars.isSuccess ? particulars.data.members.find((row) => row.member === member) : undefined;
    title = holdings.length
      ? holdings[0].holder.name || HOLDER_TYPE_LABELS[holdings[0].holder.holderType]
      : recorded?.name || former[0]?.row.name || REGISTER_PARTICULARS_COPY.UNNAMED_MEMBER;
    const className = (token: string) => {
      const register = registers.find((item) => item.token.uuid === token);
      return register ? `${register.token.name} · ${register.token.symbol}` : 'Share class';
    };
    const peopleState = (render: () => ReactNode) =>
      particulars.isError ? (
        <Problem
          message="Their particulars could not be loaded."
          label="Retry particulars"
          busy={particulars.isFetching}
          retry={() => void particulars.refetch()}
        />
      ) : !particulars.isSuccess ? (
        <Text style={styles.muted}>Loading their particulars…</Text>
      ) : (
        render()
      );
    const current = access.access?.associations.find((row) => row.member === member && row.current);
    const invited = access.access?.invitations.find((row) => row.member === member && row.status === 'pending');
    const waiting = [
      ...(access.requests?.particulars ?? [])
        .filter((row) => row.member === member && row.status === 'submitted')
        .map((row) => ({ uuid: row.uuid, text: 'They asked the company to update their particulars.' })),
      ...(access.requests?.certificates ?? [])
        .filter((row) => row.member === member && row.status === 'requested')
        .map((row) => ({ uuid: row.uuid, text: 'They asked the company for a certificate.' })),
    ];
    const absent = <Text style={styles.muted}>This shareholder is not on the register of {data.company.name}.</Text>;
    content =
      !holdings.length && !former.length && !recorded ? (
        peopleState(() => absent)
      ) : (
        <>
          <Section title="Particulars">
            {peopleState(() => (
              <Rows>
                <Row label="Name">{recorded?.name || title}</Row>
                <Row label="Residential address">{recorded?.residentialAddress || 'Not recorded'}</Row>
              </Rows>
            ))}
            {!!steps?.prepare &&
              !appointments.isFetching &&
              (holdings.length > 0 || recorded?.onRegister === false) && (
                <Action
                  label={REGISTER_PARTICULARS_COPY.PREPARE}
                  onPress={() =>
                    navigation.navigate('PrepareRegisterParticulars', {
                      tokenUuid: holdings[0]?.register.token.uuid ?? data.tokens[0]!,
                      companyUuid: company,
                      memberUuid: member,
                    })
                  }
                />
              )}
          </Section>
          <Section title="Holdings">
            {!holdings.length && <Text style={styles.muted}>No current holding.</Text>}
            {holdings.map(({ register, holder }, index) => (
              <View
                key={register.token.uuid}
                style={[styles.entry, index === holdings.length - 1 && !former.length && styles.lastEntry]}
              >
                <Text accessibilityRole="header" style={styles.heading}>
                  {register.token.name} · {register.token.symbol}
                </Text>
                <Rows>
                  <Row label="Shares held">{formatShareCount(holder.balance)}</Row>
                  <Row label="% of class">{sharePercentage(holder.balance, register.issuedSupply)}</Row>
                  <Row label="Date added">{formatDate(holder.enteredOn, 'Not recorded')}</Row>
                  <Row label="Holder type">{HOLDER_TYPE_LABELS[holder.holderType]}</Row>
                  {!!holder.name && holder.name !== title && <Row label="Name for this class">{holder.name}</Row>}
                </Rows>
                {holder.holderType === 'ambiguous' && <Text style={styles.muted}>{REGISTER_COPY.AMBIGUOUS_NOTE}</Text>}
                {holder.holderType === 'unidentified' && (
                  <Text style={styles.muted}>{REGISTER_COPY.UNIDENTIFIED_NOTE}</Text>
                )}
                <Text style={styles.text}>Optional wallet links</Text>
                {holder.wallets.length ? (
                  holder.wallets.map((wallet) => (
                    <Text key={wallet.address} style={styles.muted}>
                      {wallet.address} · {wallet.whitelistStatus}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.muted}>{REGISTER_COPY.NO_WALLET}</Text>
                )}
              </View>
            ))}
            {former.map(({ register, row }) => (
              <Text key={`${register.token.uuid}/${row.uuid}`} style={styles.muted}>
                {register.token.name} · {shareCount(row.sharesAtCessation)}, ceased{' '}
                {formatDate(row.ceasedOn, 'Not recorded')}
                {row.returnedOn ? ` · returned ${formatDate(row.returnedOn)}` : ''}
                {row.correctedBy ? ' · cessation corrected' : ''}
              </Text>
            ))}
            {former.some(({ register }) => register.formerMembersStale) && (
              <Text style={styles.muted}>The former-member history needs a refresh before relying on it.</Text>
            )}
          </Section>
          <Section title="History">
            {entries.isError ? (
              <Problem
                message="Their history could not be loaded."
                label="Retry history"
                busy={entries.isFetching}
                retry={() => void entries.refetch()}
              />
            ) : !entries.isSuccess ? (
              <Text style={styles.muted}>Loading their history…</Text>
            ) : entries.data.length ? (
              <Rows>
                {entries.data.map(({ token, entry }) => (
                  <Row
                    key={entry.uuid}
                    label={`${formatDate(entry.effectiveOn)} · ${className(token)} · ${REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind]}`}
                  >
                    {signed(
                      entry.changes
                        .filter((change) => change.member === member)
                        .reduce((sum, change) => sum + BigInt(change.shares), 0n),
                    )}{' '}
                    shares
                  </Row>
                ))}
              </Rows>
            ) : (
              <Text style={styles.muted}>No changes yet.</Text>
            )}
          </Section>
          {awards.isError && (
            <Section title="Employee awards">
              <Problem
                message="Employee awards could not be loaded."
                label="Retry employee awards"
                busy={awards.isFetching}
                retry={() => void awards.refetch()}
              />
            </Section>
          )}
          {awards.isSuccess && awards.data.length > 0 && (
            <Section title="Employee awards">
              <Rows>
                {awards.data.map((award) => (
                  <Row key={award.uuid} label={className(award.token)}>
                    {formatShareCount(award.shares)} promised · {formatShareCount(award.vestedShares)} vested ·{' '}
                    {formatShareCount(award.issuedShares)} issued
                  </Row>
                ))}
              </Rows>
              <Action label="Open Employee share scheme" onPress={() => open('awards')} />
            </Section>
          )}
          {waiting.length > 0 && (
            <Section title="Requests from them">
              {waiting.map((row) => (
                <Text key={row.uuid} style={styles.text}>
                  {row.text}
                </Text>
              ))}
              <Action label="Open member requests" onPress={() => open('company')} />
            </Section>
          )}
          {access.access && (
            <Section title="Access to their own records">
              <Text style={styles.text}>
                {current
                  ? 'They can see their own holdings, history and certificates.'
                  : invited
                    ? `Invited, waiting for them to accept until ${formatDateTime(invited.acceptanceDeadline)}.`
                    : 'No access yet. An invitation lets them see their own holdings, history and certificates.'}
              </Text>
              {!current && !invited && <Action label="Invite to their records" onPress={() => open('company')} />}
            </Section>
          )}
          <MemberDocuments
            epoch={epoch}
            company={company}
            member={member}
            sourceReady={sourceReady}
            holdings={holdings.map(({ register }) => ({
              member,
              token: register.token.uuid,
              label: `${register.token.name} · ${register.token.symbol}`,
            }))}
          />
        </>
      );
  }
  return (
    <Page
      testID="shareholder-screen"
      title={title}
      lede={data.company?.name}
      refreshControl={
        <RefreshControl
          refreshing={data.classes.isFetching || data.registers.isFetching}
          onRefresh={() => void refresh()}
        />
      }
    >
      {content}
    </Page>
  );
}

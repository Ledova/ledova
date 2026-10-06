import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  apiErrorSentence,
  createUserFriendlyError,
  DESTINATIONS,
  failureStatus,
  getErrorMessage,
  isPreparedRegisterLink,
  openingMemberLabels,
  prepareRegisterLink,
  REGISTER_LINK_COPY as COPY,
  type RegisterCorrectionAuthority,
  type RegisterLinkPreparation,
} from '@ledova/shared';
import { Action, Choice, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { WalletStatus } from './LinkRecord';
import { EvidencePicker, Field } from './RegisterFields';
import { useCompanyStyles } from './styles';
import { linksKey, useCompanyMembers, useRegisterAppointments, useRegisterWaitingWallets } from './useCompanyRegister';
import { useRegisterEvidence } from './useRegisterEvidence';

type Chosen = { member: string; fresh: boolean };

const AUTHORITIES = Object.entries(COPY.AUTHORITIES) as [RegisterCorrectionAuthority, string][];
const FAILED = 'The wallet link could not be prepared. Retry with the same details.';
const UNREAD = 'The waiting wallets could not be read.';

export function PrepareRegisterLinkScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  return <PrepareRegisterLink key={epoch} epoch={epoch} />;
}

function PrepareRegisterLink({ epoch }: { epoch: number }) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { company } = useRoute<RouteProp<CompanyStackParamList, 'PrepareRegisterLink'>>().params;
  const members = useCompanyMembers(epoch, company);
  const { appointments, steps } = useRegisterAppointments(epoch, company);
  const waiting = useRegisterWaitingWallets(epoch, company, !!steps?.prepare);
  const document = useRegisterEvidence(company, 'authority');
  const [chosen, setChosen] = useState<Record<string, Chosen>>({});
  const [authority, setAuthority] = useState<RegisterCorrectionAuthority>('director_resolution');
  const [approvingDirector, setApprovingDirector] = useState('');
  const [authorityReference, setAuthorityReference] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const pending = useRef(false);
  const retry = useRef<{ signature: string; operationId: string } | null>(null);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const waitingError = waiting.error;
  const readAppointments = appointments.refetch;
  useEffect(() => {
    if (failureStatus(waitingError) === 404) void readAppointments();
  }, [waitingError, readAppointments]);
  const wallets = waiting.data ?? [];
  const holders = members.data?.holders ?? [];
  const listed = new Set(holders.map(({ member }) => member));
  const open = new Set(wallets.map(({ address }) => address.toLowerCase()));
  const keep = (choices: Record<string, Chosen>) =>
    Object.fromEntries(
      Object.entries(choices).filter(
        ([address, choice]) => open.has(address) && (choice.fresh || listed.has(choice.member)),
      ),
    );
  const kept = keep(chosen);
  const reset = Object.keys(kept).length < Object.keys(chosen).length;
  useEffect(() => {
    if (reset && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(COPY.CHOICES_RESET);
  }, [reset]);
  const mapped = wallets.map(({ address }) => kept[address.toLowerCase()]?.member ?? null);
  const labels = openingMemberLabels([
    ...holders.map(({ member, name }) => ({ member, memberName: name || null, memberExists: true })),
    ...mapped.map((member) => ({ member, memberName: null, memberExists: false })),
  ]);
  const mapping = wallets.flatMap(({ address }, index) => {
    const member = mapped[index];
    return member ? [{ address, member }] : [];
  });
  const problem =
    mapping.length < wallets.length
      ? 'Choose a member for each wallet.'
      : !document.name
        ? 'Choose the authority document.'
        : authority === 'director_resolution' && !approvingDirector.trim()
          ? 'Name the director who approved the resolution.'
          : !authorityReference.trim() || !reason.trim()
            ? 'Enter the authority reference and the reason for the wallet link.'
            : null;
  const busy = submitting || document.busy;
  const ready =
    !problem &&
    !busy &&
    !!steps?.prepare &&
    members.isSuccess &&
    !members.isFetching &&
    waiting.isSuccess &&
    !waiting.isFetching &&
    appointments.isSuccess &&
    !appointments.isFetching;
  const choose = (address: string, member: string, fresh: boolean) =>
    setChosen((current) => ({ ...keep(current), [address.toLowerCase()]: { member, fresh } }));
  const pick = async () => {
    setError(null);
    try {
      await document.pick();
    } catch (cause) {
      if (live.current && epoch === getSessionEpoch())
        setError(getErrorMessage(cause, 'The document could not be selected. Try again.'));
    }
  };
  const submit = async () => {
    const appointment = steps?.prepare;
    if (!ready || !appointment || pending.current) return;
    const guard = () => {
      assertSessionEpoch(epoch);
      if (!live.current) throw new Error('This wallet link is no longer open.');
    };
    pending.current = true;
    setSubmitting(true);
    setChosen(keep);
    setError(null);
    try {
      guard();
      const evidence = await document.upload(appointment.uuid, guard);
      const request = {
        appointment: appointment.uuid,
        companyId: company,
        authorityEvidence: evidence.uuid,
        mapping,
        authority,
        approvingDirector: authority === 'director_resolution' ? approvingDirector.trim() : '',
        authorityReference: authorityReference.trim(),
        reason: reason.trim(),
      };
      const signature = JSON.stringify(request);
      const operationId = retry.current?.signature === signature ? retry.current.operationId : Crypto.randomUUID();
      retry.current = { signature, operationId };
      const preparation: RegisterLinkPreparation = { operationId, ...request };
      guard();
      const response = await prepareRegisterLink(apiClient, preparation, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: guard,
      });
      guard();
      if (!isPreparedRegisterLink(response.data, preparation))
        throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      retry.current = null;
      await queryClient.invalidateQueries({ queryKey: linksKey(epoch, company) });
      guard();
      navigation.goBack();
    } catch (cause) {
      const status = failureStatus(cause);
      if (status && status < 500) retry.current = null;
      try {
        guard();
      } catch {
        return;
      }
      setError(apiErrorSentence(cause, FAILED, FAILED));
      if (status === 409) await Promise.all([waiting.refetch(), members.refetch(), appointments.refetch()]);
      if (status === 404) await appointments.refetch();
    } finally {
      pending.current = false;
      if (live.current) setSubmitting(false);
    }
  };
  const title = DESTINATIONS.companyRegisterLinks.title;
  if (members.isPending || appointments.isPending)
    return (
      <Page title={title}>
        <Text style={styles.muted}>Loading the company’s members…</Text>
      </Page>
    );
  if (members.isError || appointments.isError)
    return (
      <Page title={title}>
        <Text accessibilityRole="alert" style={styles.error}>
          We couldn’t load the company’s members and your appointments.
        </Text>
        <Action
          label="Retry"
          disabled={members.isFetching || appointments.isFetching}
          onPress={() => {
            void members.refetch();
            void appointments.refetch();
          }}
        />
      </Page>
    );
  const lede = members.data.name ? `${COPY.PREPARE} for ${members.data.name}.` : undefined;
  if (!steps?.prepare)
    return (
      <Page title={title} lede={lede}>
        <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>
      </Page>
    );
  if (waiting.isPending)
    return (
      <Page title={title} lede={lede}>
        <Text style={styles.muted}>Reading the waiting wallets…</Text>
      </Page>
    );
  if (waiting.isError)
    return (
      <Page title={title} lede={lede}>
        <Text accessibilityRole="alert" style={styles.error}>
          {apiErrorSentence(waiting.error, UNREAD)}
        </Text>
        <Action label="Retry waiting wallets" disabled={waiting.isFetching} onPress={() => void waiting.refetch()} />
      </Page>
    );
  if (wallets.length === 0)
    return (
      <Page title={title} lede={lede}>
        <Text style={styles.muted}>{COPY.NOTHING_WAITING}</Text>
      </Page>
    );
  return (
    <Page testID="prepare-link-screen" title={title} lede={lede} keyboardShouldPersistTaps="handled">
      <Section title={COPY.WALLETS}>
        <Text style={styles.muted}>{COPY.MAPPING_NOTE}</Text>
        <Text style={styles.muted}>{COPY.STATUS_NOTE}</Text>
        {reset && (
          <Text accessibilityLiveRegion="polite" style={styles.text}>
            {COPY.CHOICES_RESET}
          </Text>
        )}
        {wallets.map((wallet, index) => {
          const number = index + 1;
          const member = mapped[index];
          return (
            <View key={wallet.address} style={[styles.entry, index === wallets.length - 1 && styles.lastEntry]}>
              <Text style={styles.heading}>Wallet {number}</Text>
              <Text selectable style={styles.muted}>
                {wallet.address}
              </Text>
              <Text style={styles.text}>{COPY.WAITING(wallet.waiting)}</Text>
              <WalletStatus wallet={wallet} member={(member && labels.get(member)) || 'Not chosen yet'} />
              <View style={styles.choices}>
                {[...labels].map(([value, label]) => (
                  <Choice
                    key={value}
                    label={label}
                    accessibilityRole="radio"
                    accessibilityLabel={`${label} for wallet ${number}`}
                    selected={member === value}
                    disabled={busy}
                    onPress={() => choose(wallet.address, value, !listed.has(value))}
                  />
                ))}
                <Choice
                  label={COPY.NEW_MEMBER}
                  accessibilityLabel={`${COPY.NEW_MEMBER} for wallet ${number}`}
                  selected={false}
                  disabled={busy}
                  onPress={() => choose(wallet.address, Crypto.randomUUID(), true)}
                />
              </View>
            </View>
          );
        })}
      </Section>
      <Section title={COPY.AUTHORITY}>
        <EvidencePicker
          title={COPY.AUTHORITY_DOCUMENT}
          noun="authority document"
          evidence={document}
          disabled={busy}
          onPick={() => void pick()}
        />
        <Text style={styles.muted}>{COPY.AUTHORITY_DOCUMENT_NOTE}</Text>
        <View style={styles.choices}>
          {AUTHORITIES.map(([value, label]) => (
            <Choice
              key={value}
              label={label}
              accessibilityRole="radio"
              selected={authority === value}
              disabled={busy}
              onPress={() => setAuthority(value)}
            />
          ))}
        </View>
        {authority === 'director_resolution' && (
          <Field
            label={COPY.APPROVING_DIRECTOR}
            value={approvingDirector}
            editable={!busy}
            maxLength={255}
            onChange={setApprovingDirector}
          />
        )}
        <Field
          label={COPY.AUTHORITY_REFERENCE}
          value={authorityReference}
          editable={!busy}
          maxLength={255}
          onChange={setAuthorityReference}
        />
        <Field label={COPY.REASON} value={reason} editable={!busy} multiline maxLength={1000} onChange={setReason} />
        {problem && <Text style={styles.muted}>{problem}</Text>}
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <Text style={styles.muted}>
          If a response is interrupted, prepare again without changing anything to retrieve the same wallet link. Any
          change prepares a new one.
        </Text>
        <Action
          label={submitting ? 'Preparing…' : COPY.SUBMIT}
          primary
          disabled={!ready}
          onPress={() => void submit()}
        />
      </Section>
    </Page>
  );
}

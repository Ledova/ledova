import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  apiErrorSentence,
  createUserFriendlyError,
  DESTINATIONS,
  formatDate,
  getErrorMessage,
  isPreparedRegisterOpening,
  prepareRegisterOpening,
  REGISTER_OPENING_COPY as COPY,
  type RegisterCorrectionAuthority,
  type RegisterOpeningPreparation,
} from '@ledova/shared';
import { Action, Choice, Row, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { memberLabels, shareCount } from './openingMembers';
import { EvidencePicker, Field } from './RegisterFields';
import { useCompanyStyles } from './styles';
import { openingsKey, useClassRegister, useOpeningHolders, useRegisterAppointments } from './useCompanyRegister';
import { useRegisterEvidence } from './useRegisterEvidence';

type Chosen = { member: string; fresh: boolean };

const AUTHORITIES = Object.entries(COPY.AUTHORITIES) as [RegisterCorrectionAuthority, string][];
const FAILED = 'The opening could not be prepared. Retry with the same details.';
const UNREAD = 'The holdings at the boundary could not be read.';
const MOVED = 'The opening mapping must cover exactly the wallet addresses holding shares at the captured boundary.';

const statusOf = (failure: unknown) => (failure as { response?: { status?: number } })?.response?.status;

export function PrepareRegisterOpeningScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  return <PrepareRegisterOpening key={epoch} epoch={epoch} />;
}

function PrepareRegisterOpening({ epoch }: { epoch: number }) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { tokenUuid, companyUuid } = useRoute<RouteProp<CompanyStackParamList, 'PrepareRegisterOpening'>>().params;
  const register = useClassRegister(epoch, tokenUuid);
  const holders = useOpeningHolders(epoch, tokenUuid);
  const { appointments, steps } = useRegisterAppointments(epoch, companyUuid);
  const document = useRegisterEvidence(companyUuid, 'authority');
  const [chosen, setChosen] = useState<Record<string, Chosen>>({});
  const [authority, setAuthority] = useState<RegisterCorrectionAuthority>('director_resolution');
  const [approvingDirector, setApprovingDirector] = useState('');
  const [authorityReference, setAuthorityReference] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const live = useRef(true);
  const pending = useRef(false);
  const retry = useRef<{ signature: string; operationId: string } | null>(null);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const holdingsError = holders.error;
  const readAppointments = appointments.refetch;
  useEffect(() => {
    if (statusOf(holdingsError) === 404) void readAppointments();
  }, [holdingsError, readAppointments]);
  const holdings = holders.data?.holdings ?? [];
  const linked = new Map(holdings.flatMap(({ member, memberName }) => (member ? [[member, memberName] as const] : [])));
  const mapped = holdings.map(({ address, member }) => {
    if (member) return member;
    const choice = chosen[address.toLowerCase()];
    return choice && (choice.fresh || linked.has(choice.member)) ? choice.member : undefined;
  });
  const labels = memberLabels(mapped, linked);
  const mapping = holdings.flatMap(({ address }, index) => {
    const member = mapped[index];
    return member ? [{ address, member }] : [];
  });
  const problem =
    mapping.length < holdings.length
      ? 'Choose a member for each holding.'
      : !document.name
        ? 'Choose the authority document.'
        : authority === 'director_resolution' && !approvingDirector.trim()
          ? 'Name the director who approved the resolution.'
          : !authorityReference.trim() || !reason.trim()
            ? 'Enter the authority reference and the reason for the opening.'
            : null;
  const busy = submitting || document.busy;
  const ready =
    !problem &&
    !busy &&
    !!steps?.prepare &&
    register.isSuccess &&
    !register.isFetching &&
    holders.isSuccess &&
    !holders.isFetching &&
    appointments.isSuccess &&
    !appointments.isFetching;
  const choose = (address: string, member: string, fresh: boolean) =>
    setChosen((current) => ({ ...current, [address.toLowerCase()]: { member, fresh } }));
  const reload = () => {
    setError(null);
    setMoved(false);
    void holders.refetch();
  };
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
      if (!live.current) throw new Error('This opening is no longer open.');
    };
    pending.current = true;
    setSubmitting(true);
    setError(null);
    setMoved(false);
    try {
      guard();
      const evidence = await document.upload(appointment.uuid, guard);
      const request = {
        appointment: appointment.uuid,
        tokenId: tokenUuid,
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
      const preparation: RegisterOpeningPreparation = { operationId, ...request };
      guard();
      const response = await prepareRegisterOpening(apiClient, preparation, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: guard,
      });
      guard();
      if (!isPreparedRegisterOpening(response.data, preparation))
        throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      retry.current = null;
      await queryClient.invalidateQueries({ queryKey: openingsKey(epoch, tokenUuid) });
      guard();
      navigation.goBack();
    } catch (cause) {
      const status = statusOf(cause);
      if (status && status < 500) retry.current = null;
      try {
        guard();
      } catch {
        return;
      }
      const message = apiErrorSentence(cause, FAILED, FAILED);
      setError(message);
      setMoved(status === 400 && message.includes(MOVED));
      if (status === 409) await Promise.all([holders.refetch(), appointments.refetch()]);
      if (status === 404) await appointments.refetch();
    } finally {
      pending.current = false;
      if (live.current) setSubmitting(false);
    }
  };
  const title = DESTINATIONS.companyRegisterOpening.title;
  if (register.isPending || appointments.isPending)
    return (
      <Page title={title}>
        <Text style={styles.muted}>Loading the share class…</Text>
      </Page>
    );
  if (register.isError || appointments.isError)
    return (
      <Page title={title}>
        <Text accessibilityRole="alert" style={styles.error}>
          We couldn’t load this share class and your appointments.
        </Text>
        <Action
          label="Retry"
          disabled={register.isFetching || appointments.isFetching}
          onPress={() => {
            void register.refetch();
            void appointments.refetch();
            void holders.refetch();
          }}
        />
      </Page>
    );
  const lede = `${COPY.PREPARE} for ${register.data.token.name}.`;
  if (!steps?.prepare)
    return (
      <Page title={title} lede={lede}>
        <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>
      </Page>
    );
  if (holders.isPending)
    return (
      <Page title={title} lede={lede}>
        <Text style={styles.muted}>Reading the holdings on chain…</Text>
      </Page>
    );
  if (holders.isError)
    return (
      <Page title={title} lede={lede}>
        <Text accessibilityRole="alert" style={styles.error}>
          {statusOf(holders.error) === 503 ? COPY.HOLDERS_UNAVAILABLE : apiErrorSentence(holders.error, UNREAD)}
        </Text>
        <Action label={COPY.RELOAD_HOLDINGS} disabled={holders.isFetching} onPress={reload} />
      </Page>
    );
  const { block } = holders.data;
  return (
    <Page testID="prepare-opening-screen" title={title} lede={lede} keyboardShouldPersistTaps="handled">
      <Section title={COPY.HOLDINGS}>
        <Rows>
          <Row label="Read at">{COPY.BOUNDARY_BLOCK(block.number, formatDate(block.date))}</Row>
        </Rows>
        <Text style={styles.muted}>{COPY.BOUNDARY_NOTE}</Text>
        <Text style={styles.muted}>{COPY.HOLDINGS_NOTE}</Text>
        {holdings.length === 0 ? (
          <Text style={styles.muted}>{COPY.NO_HOLDINGS}</Text>
        ) : (
          holdings.map((row, index) => {
            const number = index + 1;
            const member = mapped[index];
            return (
              <View key={row.address} style={[styles.entry, index === holdings.length - 1 && styles.lastEntry]}>
                <Text style={styles.heading}>Holding {number}</Text>
                <Text selectable style={styles.muted}>
                  {row.address}
                </Text>
                <Text style={styles.text}>{shareCount(row.shares)}</Text>
                <Rows>
                  <Row label={COPY.MEMBER}>{member ? labels.get(member) : 'Not chosen yet'}</Row>
                </Rows>
                {row.member ? (
                  <Text style={styles.muted}>{COPY.LINKED_NOTE}</Text>
                ) : (
                  <View style={styles.choices}>
                    {[...labels].map(([value, label]) => (
                      <Choice
                        key={value}
                        label={label}
                        accessibilityRole="radio"
                        accessibilityLabel={`${label} for holding ${number}`}
                        selected={member === value}
                        disabled={busy}
                        onPress={() => choose(row.address, value, !linked.has(value))}
                      />
                    ))}
                    <Choice
                      label={COPY.NEW_MEMBER}
                      accessibilityLabel={`${COPY.NEW_MEMBER} for holding ${number}`}
                      selected={false}
                      disabled={busy}
                      onPress={() => choose(row.address, Crypto.randomUUID(), true)}
                    />
                  </View>
                )}
              </View>
            );
          })
        )}
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
        {moved && (
          <>
            <Text style={styles.text}>{COPY.HOLDINGS_MOVED}</Text>
            <Action label={COPY.RELOAD_HOLDINGS} disabled={busy || holders.isFetching} onPress={reload} />
          </>
        )}
        <Text style={styles.muted}>
          If a response is interrupted, prepare again without changing anything to retrieve the same opening. Any change
          prepares a new one.
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

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  apiErrorSentence,
  createUserFriendlyError,
  DESTINATIONS,
  formatDate,
  formatRegisterChanges,
  getErrorMessage,
  isPreparedRegisterCorrection,
  prepareRegisterCorrection,
  REGISTER_CORRECTION_COPY as COPY,
  type RegisterCorrectionAuthority,
  type RegisterCorrectionPreparation,
} from '@ledova/shared';
import { Action, Choice, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { EvidencePicker, Field, isoDay } from './RegisterFields';
import { useCompanyStyles } from './styles';
import { correctionsKey, useClassRegister, useRegisterAppointments, useRegisterEntry } from './useCompanyRegister';
import { useRegisterEvidence } from './useRegisterEvidence';

const AUTHORITIES = Object.entries(COPY.AUTHORITIES) as [RegisterCorrectionAuthority, string][];
const FAILED = 'The correction could not be prepared. Retry with the same details.';

const utcToday = () => new Date().toISOString().slice(0, 10);

export function PrepareRegisterCorrectionScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  return <PrepareRegisterCorrection key={epoch} epoch={epoch} />;
}

function PrepareRegisterCorrection({ epoch }: { epoch: number }) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { tokenUuid, companyUuid, entryUuid } =
    useRoute<RouteProp<CompanyStackParamList, 'PrepareRegisterCorrection'>>().params;
  const register = useClassRegister(epoch, tokenUuid);
  const found = useRegisterEntry(epoch, tokenUuid, entryUuid);
  const { appointments, steps } = useRegisterAppointments(epoch, companyUuid);
  const document = useRegisterEvidence(companyUuid, 'authority');
  const [effectiveOn, setEffectiveOn] = useState(utcToday);
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
  const entry = found.data;
  const date = effectiveOn.trim();
  const problem = !document.name
    ? 'Choose the authority document.'
    : !isoDay(date) || date > utcToday()
      ? 'Enter the effective date as YYYY-MM-DD, today (UTC) or earlier.'
      : authority === 'director_resolution' && !approvingDirector.trim()
        ? 'Name the director who approved the resolution.'
        : !authorityReference.trim() || !reason.trim()
          ? 'Enter the authority reference and the reason for the correction.'
          : null;
  const busy = submitting || document.busy;
  const ready =
    !problem &&
    !busy &&
    !!steps?.prepare &&
    !!entry?.correctable &&
    register.isSuccess &&
    !register.isFetching &&
    found.isSuccess &&
    !found.isFetching &&
    appointments.isSuccess &&
    !appointments.isFetching;
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
      if (!live.current) throw new Error('This correction is no longer open.');
    };
    pending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      guard();
      const evidence = await document.upload(appointment.uuid, guard);
      const request = {
        appointment: appointment.uuid,
        correctsId: entryUuid,
        authorityEvidence: evidence.uuid,
        effectiveOn: date,
        authority,
        approvingDirector: authority === 'director_resolution' ? approvingDirector.trim() : '',
        authorityReference: authorityReference.trim(),
        reason: reason.trim(),
      };
      const signature = JSON.stringify(request);
      const operationId = retry.current?.signature === signature ? retry.current.operationId : Crypto.randomUUID();
      retry.current = { signature, operationId };
      const preparation: RegisterCorrectionPreparation = { operationId, ...request };
      guard();
      const response = await prepareRegisterCorrection(apiClient, preparation, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: guard,
      });
      guard();
      if (!isPreparedRegisterCorrection(response.data, preparation))
        throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      retry.current = null;
      await queryClient.invalidateQueries({ queryKey: correctionsKey(epoch, tokenUuid) });
      guard();
      navigation.goBack();
    } catch (cause) {
      const status = (cause as { response?: { status?: number } })?.response?.status;
      if (status && status < 500) retry.current = null;
      try {
        guard();
      } catch {
        return;
      }
      setError(apiErrorSentence(cause, FAILED, FAILED));
      if (status === 409) await Promise.all([found.refetch(), appointments.refetch()]);
    } finally {
      pending.current = false;
      if (live.current) setSubmitting(false);
    }
  };
  const title = DESTINATIONS.companyRegisterCorrection.title;
  if (register.isPending || found.isPending || appointments.isPending)
    return (
      <Page title={title}>
        <Text style={styles.muted}>Loading the register entry…</Text>
      </Page>
    );
  if (register.isError || found.isError || appointments.isError)
    return (
      <Page title={title}>
        <Text accessibilityRole="alert" style={styles.error}>
          We couldn’t load this register entry and your appointments.
        </Text>
        <Action
          label="Retry"
          disabled={register.isFetching || found.isFetching || appointments.isFetching}
          onPress={() => {
            void register.refetch();
            void found.refetch();
            void appointments.refetch();
          }}
        />
      </Page>
    );
  const lede = `${COPY.PREPARE} in the ${register.data.token.name} register.`;
  if (!steps?.prepare)
    return (
      <Page title={title} lede={lede}>
        <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>
      </Page>
    );
  if (!entry?.correctable)
    return (
      <Page title={title} lede={lede}>
        <Text style={styles.muted}>
          {entry
            ? 'A correction has reversed this entry, or it records no change, so it cannot be corrected.'
            : 'This entry is not in the register of this share class.'}
        </Text>
      </Page>
    );
  const inverse = entry.changes.map(({ member, shares }) => ({ member, shares: (-BigInt(shares)).toString() }));
  return (
    <Page
      testID="prepare-correction-screen"
      title={title}
      lede={`${lede} ${COPY.COMPENSATION_NOTE}`}
      keyboardShouldPersistTaps="handled"
    >
      <Section title={COPY.ORIGINAL_CHANGES}>
        <Text style={styles.heading}>
          Entry {entry.sequence} · {COPY.ENTRY_KINDS[entry.kind]}
        </Text>
        <Text style={styles.muted}>Effective {formatDate(entry.effectiveOn)}</Text>
        {formatRegisterChanges(entry.changes).map((line, index) => (
          <Text key={index} style={styles.text}>
            {line}
          </Text>
        ))}
      </Section>
      <Section title={COPY.COMPENSATING_CHANGES}>
        {formatRegisterChanges(inverse, entry.changes).map((line, index) => (
          <Text key={index} style={styles.text}>
            {line}
          </Text>
        ))}
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
        <Field
          label={`${COPY.EFFECTIVE_ON} (YYYY-MM-DD)`}
          accessibilityLabel={COPY.EFFECTIVE_ON}
          value={effectiveOn}
          editable={!busy}
          onChange={setEffectiveOn}
        />
        <Text style={styles.muted}>{COPY.EFFECTIVE_ON_NOTE}</Text>
        {problem && <Text style={styles.muted}>{problem}</Text>}
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <Text style={styles.muted}>
          If a response is interrupted, prepare again without changing anything to retrieve the same correction. Any
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

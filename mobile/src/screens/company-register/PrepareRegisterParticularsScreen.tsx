import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  apiErrorSentence,
  createUserFriendlyError,
  DESTINATIONS,
  failureStatus,
  getErrorMessage,
  isPreparedRegisterParticularsChange,
  prepareRegisterParticularsChange,
  REGISTER_PARTICULARS_COPY as COPY,
  type RegisterParticularsChangePreparation,
} from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { EvidencePicker, Field, isoDay, utcToday } from './RegisterFields';
import { useCompanyStyles } from './styles';
import { particularsKey, useClassRegister, useRegisterAppointments } from './useCompanyRegister';
import { useRegisterEvidence } from './useRegisterEvidence';

const FAILED = 'The change could not be prepared. Retry with the same details.';

export function PrepareRegisterParticularsScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  return <PrepareRegisterParticulars key={epoch} epoch={epoch} />;
}

function PrepareRegisterParticulars({ epoch }: { epoch: number }) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { tokenUuid, companyUuid, memberUuid } =
    useRoute<RouteProp<CompanyStackParamList, 'PrepareRegisterParticulars'>>().params;
  const register = useClassRegister(epoch, tokenUuid);
  const { appointments, steps } = useRegisterAppointments(epoch, companyUuid);
  const document = useRegisterEvidence(companyUuid, 'supporting');
  const [name, setName] = useState('');
  const [residentialAddress, setResidentialAddress] = useState('');
  const [asAt, setAsAt] = useState(utcToday);
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
  const date = asAt.trim();
  const problem =
    !name.trim() || !residentialAddress.trim() || !reason.trim()
      ? 'Enter the name, residential address and reason for the change.'
      : !isoDay(date) || date > utcToday()
        ? 'Enter the as-at date as YYYY-MM-DD, today (UTC) or earlier.'
        : !document.name
          ? 'Choose the supporting document.'
          : null;
  const busy = submitting || document.busy;
  const ready =
    !problem &&
    !busy &&
    !!steps?.prepare &&
    register.isSuccess &&
    !register.isFetching &&
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
      if (!live.current) throw new Error('This change is no longer open.');
    };
    pending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      guard();
      const evidence = await document.upload(appointment.uuid, guard);
      const request = {
        appointment: appointment.uuid,
        member: memberUuid,
        supportingEvidence: evidence.uuid,
        name: name.trim(),
        residentialAddress: residentialAddress.trim(),
        asAt: date,
        reason: reason.trim(),
      };
      const signature = JSON.stringify(request);
      const operationId = retry.current?.signature === signature ? retry.current.operationId : Crypto.randomUUID();
      retry.current = { signature, operationId };
      const preparation: RegisterParticularsChangePreparation = { operationId, ...request };
      guard();
      const response = await prepareRegisterParticularsChange(apiClient, preparation, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: guard,
      });
      guard();
      if (!isPreparedRegisterParticularsChange(response.data, preparation))
        throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      retry.current = null;
      await queryClient.invalidateQueries({ queryKey: particularsKey(epoch, companyUuid) });
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
      if (status === 409) await Promise.all([register.refetch(), appointments.refetch()]);
      if (status === 404) await appointments.refetch();
    } finally {
      pending.current = false;
      if (live.current) setSubmitting(false);
    }
  };
  const title = DESTINATIONS.companyRegisterParticulars.title;
  if (register.isPending || appointments.isPending)
    return (
      <Page title={title}>
        <Text style={styles.muted}>Loading the member…</Text>
      </Page>
    );
  if (register.isError || appointments.isError)
    return (
      <Page title={title}>
        <Text accessibilityRole="alert" style={styles.error}>
          We couldn’t load this member and your appointments.
        </Text>
        <Action
          label="Retry"
          disabled={register.isFetching || appointments.isFetching}
          onPress={() => {
            void register.refetch();
            void appointments.refetch();
          }}
        />
      </Page>
    );
  const member = register.data.holders.find((holder) => holder.member === memberUuid)?.name || COPY.UNNAMED_MEMBER;
  const lede = `${COPY.PREPARE} for ${member}.`;
  if (!steps?.prepare)
    return (
      <Page title={title} lede={lede}>
        <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>
      </Page>
    );
  return (
    <Page testID="prepare-particulars-screen" title={title} lede={lede} keyboardShouldPersistTaps="handled">
      <Section title={COPY.PROPOSED_PARTICULARS}>
        <Field label={COPY.NAME} value={name} editable={!busy} maxLength={255} onChange={setName} />
        <Field
          label={COPY.RESIDENTIAL_ADDRESS}
          value={residentialAddress}
          editable={!busy}
          multiline
          maxLength={1000}
          onChange={setResidentialAddress}
        />
        <Field
          label={`${COPY.AS_AT} (YYYY-MM-DD)`}
          accessibilityLabel={COPY.AS_AT}
          value={asAt}
          editable={!busy}
          onChange={setAsAt}
        />
        <Text style={styles.muted}>{COPY.AS_AT_NOTE}</Text>
        <Text style={styles.muted}>{COPY.PRECEDENCE_NOTE}</Text>
        <Field label={COPY.REASON} value={reason} editable={!busy} multiline maxLength={1000} onChange={setReason} />
        <EvidencePicker
          title={COPY.SUPPORTING_DOCUMENT}
          noun="supporting document"
          evidence={document}
          disabled={busy}
          onPick={() => void pick()}
        />
        <Text style={styles.muted}>{COPY.SUPPORTING_DOCUMENT_NOTE}</Text>
        {problem && <Text style={styles.muted}>{problem}</Text>}
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <Text style={styles.muted}>
          If a response is interrupted, prepare again without changing anything to retrieve the same change. Changing
          any detail prepares a new one.
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

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  getErrorMessage,
  isPreparedRegisterGrant,
  prepareRegisterGrant,
  REGISTER_GRANT_COPY as COPY,
  type RegisterGrantPreparation,
} from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { EvidencePicker, Field, isoDay, utcToday } from './RegisterFields';
import { useCompanyStyles } from './styles';
import { grantsKey, useClassRegister, useCompanyMembers, useRegisterAppointments } from './useCompanyRegister';
import { useRegisterEvidence } from './useRegisterEvidence';

const FAILED = 'The grant preparation response could not be confirmed. Retry with the same details.';

export function PrepareRegisterGrantScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  return <PrepareRegisterGrant key={epoch} epoch={epoch} />;
}

function PrepareRegisterGrant({ epoch }: { epoch: number }) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { tokenUuid, companyUuid } = useRoute<RouteProp<CompanyStackParamList, 'PrepareRegisterGrant'>>().params;
  const register = useClassRegister(epoch, tokenUuid);
  const members = useCompanyMembers(epoch, companyUuid);
  const { appointments, steps } = useRegisterAppointments(epoch, companyUuid);
  const authority = useRegisterEvidence(companyUuid, 'authority');
  const retainedTerms = useRegisterEvidence(companyUuid, 'supporting');
  const acceptance = useRegisterEvidence(companyUuid, 'supporting');
  const [newMemberId] = useState(() => Crypto.randomUUID());
  const [member, setMember] = useState('new');
  const [name, setName] = useState('');
  const [residentialAddress, setResidentialAddress] = useState('');
  const [shares, setShares] = useState('');
  const [termsOn, setTermsOn] = useState(utcToday);
  const [approvingDirector, setApprovingDirector] = useState('');
  const [terms, setTerms] = useState('');
  const [authorityReference, setAuthorityReference] = useState('');
  const [reason, setReason] = useState('');
  const [acceptanceRequired, setAcceptanceRequired] = useState(false);
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
  const date = termsOn.trim();
  const problem =
    member === 'new' && (!name.trim() || !residentialAddress.trim())
      ? 'Give the new member’s name and residential address.'
      : !/^[1-9]\d*$/.test(shares.trim())
        ? 'Enter a positive whole number of shares.'
        : !isoDay(date) || date > utcToday()
          ? 'Enter a terms date as YYYY-MM-DD, today (UTC) or earlier.'
          : !terms.trim() || !approvingDirector.trim() || !authorityReference.trim() || !reason.trim()
            ? 'Give the non-paid terms, approving director, authority reference and reason.'
            : !authority.name || !retainedTerms.name || (acceptanceRequired && !acceptance.name)
              ? 'Choose the authority, terms and any required acceptance documents.'
              : null;
  const busy = submitting || authority.busy || retainedTerms.busy || acceptance.busy;
  const fetching = register.isFetching || members.isFetching || appointments.isFetching;
  const supported = register.data?.initialized && register.data.token.status === 'draft';
  const ready =
    !problem &&
    !busy &&
    !!steps?.prepare &&
    supported &&
    register.isSuccess &&
    members.isSuccess &&
    appointments.isSuccess &&
    !fetching;
  const pick = async (document: ReturnType<typeof useRegisterEvidence>) => {
    setError(null);
    try {
      await document.pick();
    } catch (cause) {
      if (live.current && epoch === getSessionEpoch())
        setError(getErrorMessage(cause, 'The document could not be selected. Try again.'));
    }
  };
  const refresh = () => Promise.all([register.refetch(), members.refetch(), appointments.refetch()]);
  const submit = async () => {
    const appointment = steps?.prepare;
    if (!ready || !appointment || pending.current) return;
    const guard = () => {
      assertSessionEpoch(epoch);
      if (!live.current) throw new Error('This grant is no longer open.');
    };
    pending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      guard();
      const retainedAuthority = await authority.upload(appointment.uuid, guard);
      const retained = await retainedTerms.upload(appointment.uuid, guard);
      const accepted = acceptanceRequired ? await acceptance.upload(appointment.uuid, guard) : null;
      const request = {
        appointment: appointment.uuid,
        tokenId: tokenUuid,
        member: member === 'new' ? newMemberId : member,
        newMember: member === 'new',
        ...(member === 'new' ? { name: name.trim(), residentialAddress: residentialAddress.trim() } : {}),
        shares: shares.trim(),
        termsOn: date,
        terms: terms.trim(),
        approvingDirector: approvingDirector.trim(),
        authorityReference: authorityReference.trim(),
        reason: reason.trim(),
        authorityEvidence: retainedAuthority.uuid,
        termsEvidence: retained.uuid,
        acceptanceRequired,
        acceptanceEvidence: accepted?.uuid ?? null,
      };
      const signature = JSON.stringify(request);
      const operationId = retry.current?.signature === signature ? retry.current.operationId : Crypto.randomUUID();
      retry.current = { signature, operationId };
      const preparation: RegisterGrantPreparation = { operationId, ...request };
      guard();
      const response = await prepareRegisterGrant(apiClient, preparation, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: guard,
      });
      guard();
      if (!isPreparedRegisterGrant(response.data, preparation))
        throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
      retry.current = null;
      await queryClient.invalidateQueries({ queryKey: grantsKey(epoch, tokenUuid) });
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
      if (status === 400 || status === 404 || status === 409) await refresh();
    } finally {
      pending.current = false;
      if (live.current) setSubmitting(false);
    }
  };
  if (register.isPending || members.isPending || appointments.isPending)
    return (
      <Page title="Register">
        <Text style={styles.muted}>Loading the register and your appointments…</Text>
      </Page>
    );
  if (register.isError || members.isError || appointments.isError)
    return (
      <Page title="Register">
        <Text accessibilityRole="alert" style={styles.error}>
          The register and your appointments could not be loaded.
        </Text>
        <Action label="Retry" disabled={fetching} onPress={() => void refresh()} />
      </Page>
    );
  if (!steps?.prepare)
    return (
      <Page title="Register">
        <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>
      </Page>
    );
  if (!supported)
    return (
      <Page title="Register">
        <Text style={styles.muted}>
          This grant requires an opened register for a draft share class without a deployed contract.
        </Text>
      </Page>
    );
  return (
    <Page testID="prepare-grant-screen" title="Register" lede={COPY.NOTE} keyboardShouldPersistTaps="handled">
      <Section title={register.data.token.name}>
        <Text style={styles.heading}>Member</Text>
        <Text style={styles.text}>
          {member === 'new'
            ? 'New member'
            : members.data.holders.find((holder) => holder.member === member)?.name || member}
        </Text>
        <Action label="Use a new member" disabled={busy || member === 'new'} onPress={() => setMember('new')} />
        <View style={styles.choices}>
          {members.data.holders
            .filter((holder) => holder.wallets.length === 0)
            .map((holder) => (
              <Action
                key={holder.member}
                label={`Use ${holder.name || holder.member}`}
                accessibilityLabel={`Use existing member ${holder.name || holder.member} ${holder.member}`}
                disabled={busy || member === holder.member}
                onPress={() => setMember(holder.member)}
              />
            ))}
        </View>
        {member === 'new' ? (
          <>
            <Field label={COPY.NAME} value={name} editable={!busy} maxLength={255} onChange={setName} />
            <Field
              label={COPY.RESIDENTIAL_ADDRESS}
              value={residentialAddress}
              editable={!busy}
              multiline
              maxLength={1000}
              onChange={setResidentialAddress}
            />
          </>
        ) : (
          <Text style={styles.muted}>
            The grant retains the existing member’s current particulars. Preview them before approval.
          </Text>
        )}
        <Field label={COPY.SHARES} value={shares} editable={!busy} keyboardType="number-pad" onChange={setShares} />
        <Field
          label={`${COPY.TERMS_ON} (YYYY-MM-DD)`}
          accessibilityLabel={COPY.TERMS_ON}
          value={termsOn}
          editable={!busy}
          onChange={setTermsOn}
        />
        <Field label={COPY.TERMS} value={terms} editable={!busy} multiline maxLength={1000} onChange={setTerms} />
        <Field
          label={COPY.DIRECTOR}
          value={approvingDirector}
          editable={!busy}
          maxLength={255}
          onChange={setApprovingDirector}
        />
        <Text style={styles.muted}>
          {COPY.DIRECTOR_NOTE} {COPY.EFFECTIVE_NOTE}
        </Text>
        <Field
          label={COPY.AUTHORITY_REFERENCE}
          value={authorityReference}
          editable={!busy}
          maxLength={255}
          onChange={setAuthorityReference}
        />
        <Field label={COPY.REASON} value={reason} editable={!busy} multiline maxLength={1000} onChange={setReason} />
        <Text style={styles.text}>
          Recipient acceptance: {acceptanceRequired ? 'Required by the terms' : 'Not required by the terms'}
        </Text>
        <Action
          label={acceptanceRequired ? 'Terms do not require acceptance' : COPY.ACCEPTANCE_REQUIRED}
          disabled={busy}
          onPress={() => setAcceptanceRequired((value) => !value)}
        />
        <EvidencePicker
          title={COPY.AUTHORITY_DOCUMENT}
          noun="authority document"
          evidence={authority}
          disabled={busy}
          onPick={() => void pick(authority)}
        />
        <EvidencePicker
          title={COPY.TERMS_DOCUMENT}
          noun="terms document"
          evidence={retainedTerms}
          disabled={busy}
          onPick={() => void pick(retainedTerms)}
        />
        {acceptanceRequired && (
          <EvidencePicker
            title={COPY.ACCEPTANCE_DOCUMENT}
            noun="acceptance document"
            evidence={acceptance}
            disabled={busy}
            onPick={() => void pick(acceptance)}
          />
        )}
        <Text style={styles.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
        {problem && <Text style={styles.muted}>{problem}</Text>}
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <Text style={styles.muted}>
          If a response is interrupted, prepare again with the same details to retrieve the same grant.
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

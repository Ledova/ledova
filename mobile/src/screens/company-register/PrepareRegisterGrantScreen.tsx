import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Text, View } from 'react-native';
import { StackActions, useNavigation, usePreventRemove, useRoute, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  getErrorMessage,
  isPreparedRegisterGrant,
  getRegisterGrants,
  readEveryPage,
  useSubmissionOwner,
  useUserPreferences,
  formatShareCount,
  USER_PREFERENCES_QUERY_KEY,
  hasCurrentRegisterReadAuthority,
  prepareRegisterGrant,
  REGISTER_GRANT_COPY as COPY,
  type RegisterGrantPreparation,
  type OwnCompanyAppointment,
  type CompanyShareTokenListItem,
} from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { EvidencePicker, Field, isoDay, utcToday } from '../../components/register/RegisterFields';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import {
  grantsKey,
  registerAppointmentsKey,
  useClassRegister,
  useCompanyMembers,
  useRegisterAppointments,
  useTransferMembers,
  registerClassKey,
  registerMembersKey,
  registerClassesKey,
} from '../../hooks/useCompanyRegister';
import { useRegisterEvidence } from '../../hooks/useRegisterEvidence';
import { useRegisterAward } from './useRegisterAwards';

const FAILED = 'The grant preparation response could not be confirmed. Retry with the same details.';
const RETURN_FAILED = 'The preparation is confirmed. Refresh the company list before returning.';

export function PrepareRegisterGrantScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  const {
    tokenUuid,
    companyUuid,
    awardUuid = '',
  } = useRoute<RouteProp<CompanyStackParamList, 'PrepareRegisterGrant'>>().params;
  return <PrepareRegisterGrant key={`${epoch}/${tokenUuid}/${companyUuid}/${awardUuid}`} epoch={epoch} />;
}

function PrepareRegisterGrant({ epoch }: { epoch: number }) {
  const styles = useCompanyStyles();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const {
    tokenUuid,
    companyUuid,
    awardUuid = '',
  } = useRoute<RouteProp<CompanyStackParamList, 'PrepareRegisterGrant'>>().params;
  const register = useClassRegister(epoch, tokenUuid);
  const members = useCompanyMembers(epoch, companyUuid);
  const { appointments, steps } = useRegisterAppointments(epoch, companyUuid);
  const latestAppointments = useRef<OwnCompanyAppointment[]>([]);
  const readable = hasCurrentRegisterReadAuthority(appointments.isSuccess ? appointments.data : [], companyUuid);
  useLayoutEffect(() => {
    latestAppointments.current = appointments.isSuccess ? appointments.data : [];
  }, [appointments.isSuccess, appointments.data]);
  const live = useRef(true);
  const awardGuard = useMemo(
    () => () => {
      assertSessionEpoch(epoch);
      if (!live.current) throw new Error('This grant is no longer open.');
      if (!hasCurrentRegisterReadAuthority(latestAppointments.current, companyUuid))
        throw new Error('A current company register appointment is required.');
    },
    [epoch, companyUuid],
  );
  const award = useRegisterAward(epoch, companyUuid, tokenUuid, awardUuid, awardGuard, readable);
  const awardMembers = useTransferMembers(epoch, tokenUuid, !!awardUuid && readable && !!steps?.prepare);
  const fixed = awardUuid ? award.data : undefined;
  const awardMember = awardMembers.data?.find((row) => row.member === fixed?.member) ?? null;
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
  const pending = useRef(false);
  const [held, setHeld] = useState(false);
  const [completed, setCompleted] = useState(false);
  const operation = useRef<{ request: RegisterGrantPreparation; confirmed: boolean; uncertain: boolean } | null>(null);
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const preferenceRead = useUserPreferences();
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const date = fixed?.termsOn ?? termsOn.trim();
  const summary = fixed?.terms ?? terms.trim();
  const newRecipient = fixed ? !awardMember : member === 'new';
  const recipientName = fixed ? (awardMember?.name ?? fixed.name) : name.trim();
  const recipientAddress = fixed
    ? (awardMember?.residentialAddress ?? fixed.residentialAddress)
    : residentialAddress.trim();
  const problem =
    newRecipient && (!recipientName || !recipientAddress)
      ? 'Give the new member’s name and residential address.'
      : !/^[1-9]\d*$/.test(shares.trim())
        ? 'Enter a positive whole number of shares.'
        : fixed && BigInt(shares.trim()) > BigInt(fixed.availableShares)
          ? 'The grant quantity must fit the award’s vested and not yet issued shares.'
          : !isoDay(date) || date > utcToday()
            ? 'Enter a terms date as YYYY-MM-DD, today (UTC) or earlier.'
            : !summary || !approvingDirector.trim() || !authorityReference.trim() || !reason.trim()
              ? 'Give the non-paid terms, approving director, authority reference and reason.'
              : !authority.name || !retainedTerms.name || (acceptanceRequired && !acceptance.name)
                ? 'Choose the authority, terms and any required acceptance documents.'
                : null;
  const busy = submitting || authority.busy || retainedTerms.busy || acceptance.busy;
  const fetching =
    register.isFetching ||
    members.isFetching ||
    appointments.isFetching ||
    (!!awardUuid && (award.isFetching || awardMembers.isFetching));
  const supported = register.data?.initialized && register.data.token.status === 'draft';
  const ready =
    (!problem || held) &&
    !busy &&
    (!!steps?.prepare || held) &&
    supported &&
    register.isSuccess &&
    members.isSuccess &&
    appointments.isSuccess &&
    (!awardUuid || (readable && award.isSuccess && awardMembers.isSuccess)) &&
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
  const refresh = () =>
    Promise.all([
      preferenceRead.refetch(),
      register.refetch(),
      members.refetch(),
      appointments.refetch(),
      ...(awardUuid && readable ? [award.refetch(), awardMembers.refetch()] : []),
    ]);
  usePreventRemove(busy || held, () => {
    Alert.alert('Finish this share issue', 'Recover the original request before leaving this form.');
  });
  useEffect(() => {
    if (completed && !busy && !held) {
      const params = { section: 'awards', companyUuid, tokenUuid };
      navigation.dispatch(StackActions.popTo('CompanyMain', params));
    }
  }, [completed, busy, held, navigation, companyUuid, tokenUuid]);
  const preferences = queryClient.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const preferencesReady = preferences?.status === 'success' && preferences.fetchStatus === 'idle';
  const currentRead = useRef(false);
  useLayoutEffect(() => {
    currentRead.current =
      preferencesReady && register.isSuccess && members.isSuccess && appointments.isSuccess && !fetching && readable;
  }, [register.isSuccess, members.isSuccess, appointments.isSuccess, fetching, readable, preferencesReady]);
  const guard = () => {
    assertSessionEpoch(epoch);
    if (!live.current || !owner || boundary.get() !== owner)
      throw new Error('This grant or signed-in account is no longer current.');
    const sources = [
      USER_PREFERENCES_QUERY_KEY,
      registerAppointmentsKey(epoch),
      registerClassKey(epoch, tokenUuid),
      registerMembersKey(epoch, companyUuid),
    ].map((key) => queryClient.getQueryState(key));
    if (!currentRead.current || sources.some((state) => state?.status !== 'success' || state.fetchStatus !== 'idle'))
      throw new Error('Refresh the register and your current company authority.');
    if (awardUuid) awardGuard();
  };
  const lookup = async (request: RegisterGrantPreparation) => {
    const rows = await readEveryPage(async (page) => {
      guard();
      const response = await getRegisterGrants(
        apiClient,
        { token: tokenUuid, page },
        {
          ledovaSessionEpoch: epoch,
          ledovaSubmissionGuard: guard,
        },
      );
      guard();
      return response;
    });
    if (rows.some((row) => row.company !== companyUuid || row.token !== tokenUuid))
      throw createUserFriendlyError('The grants did not identify this company and share class.');
    const original = rows.find((row) => row.uuid === request.operationId);
    if (original && !isPreparedRegisterGrant(original, request))
      throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
    return original;
  };
  const submit = async () => {
    if (!ready || pending.current) return;
    pending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      guard();
      let command = operation.current;
      if (!command) {
        const appointment = steps?.prepare;
        if (!appointment) throw createUserFriendlyError('Current preparation authority is required.');
        const retainedAuthority = await authority.upload(appointment.uuid, guard);
        const retained = await retainedTerms.upload(appointment.uuid, guard);
        if (fixed && retained.sha256 !== fixed.agreementFingerprint)
          throw createUserFriendlyError('Upload the same agreement document retained for this award.');
        const accepted = acceptanceRequired ? await acceptance.upload(appointment.uuid, guard) : null;
        const request: RegisterGrantPreparation = {
          operationId: Crypto.randomUUID(),
          appointment: appointment.uuid,
          tokenId: tokenUuid,
          member: fixed?.member ?? (newRecipient ? newMemberId : member),
          newMember: newRecipient,
          ...(newRecipient ? { name: recipientName, residentialAddress: recipientAddress } : {}),
          ...(fixed ? { award: fixed.uuid } : {}),
          shares: shares.trim(),
          termsOn: date,
          terms: summary,
          approvingDirector: approvingDirector.trim(),
          authorityReference: authorityReference.trim(),
          reason: reason.trim(),
          authorityEvidence: retainedAuthority.uuid,
          termsEvidence: retained.uuid,
          acceptanceRequired,
          acceptanceEvidence: accepted?.uuid ?? null,
        };
        command = { request, confirmed: false, uncertain: false };
        operation.current = command;
        setHeld(true);
      }
      let absent = false;
      if (command.uncertain && !command.confirmed) {
        command.confirmed = !!(await lookup(command.request));
        absent = !command.confirmed;
      }
      if (!command.confirmed) {
        try {
          guard();
          const response = await prepareRegisterGrant(apiClient, command.request, {
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: guard,
          });
          guard();
          if (!isPreparedRegisterGrant(response.data, command.request))
            throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
          command.confirmed = true;
        } catch (failure) {
          const status = failureStatus(failure);
          if (!absent || !status || status < 400 || status >= 500) throw failure;
          command.confirmed = !!(await lookup(command.request));
          if (!command.confirmed) {
            operation.current = null;
            setHeld(false);
            setError(
              'The original grant was not recorded and the request was refused. Start again with current company authority.',
            );
            return;
          }
        }
      }
      await queryClient.invalidateQueries({ queryKey: grantsKey(epoch, tokenUuid) });
      guard();
      const classesKey = registerClassesKey(epoch);
      await queryClient.refetchQueries({ queryKey: classesKey, type: 'active' }, { throwOnError: true });
      guard();
      const classesRead = queryClient.getQueryState(classesKey);
      const classes = queryClient.getQueryData<CompanyShareTokenListItem[]>(classesKey);
      if (
        classesRead?.status !== 'success' ||
        classesRead.fetchStatus !== 'idle' ||
        !classes?.some((item) => item.uuid === tokenUuid && item.companyUuid === companyUuid)
      )
        throw createUserFriendlyError(RETURN_FAILED);
      operation.current = null;
      setHeld(false);
      setCompleted(true);
    } catch (cause) {
      const status = failureStatus(cause);
      if (operation.current && !operation.current.confirmed) {
        if (!status || status >= 500) operation.current.uncertain = true;
        else if (!operation.current.uncertain) {
          operation.current = null;
          setHeld(false);
        }
      }
      try {
        guard();
      } catch {
        return;
      }
      const fallback = operation.current?.confirmed ? RETURN_FAILED : FAILED;
      setError(apiErrorSentence(cause, fallback, fallback));
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
  if (!readable || fetching || !owner || !preferencesReady)
    return (
      <Page title="Prepare share issue">
        <Text style={styles.muted}>Refresh the register and your current company read access before continuing.</Text>
        <Action label="Refresh share issue" disabled={fetching} onPress={() => void refresh()} />
      </Page>
    );
  if (!steps?.prepare && !held)
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
  if (awardUuid && (!readable || award.isPending || awardMembers.isPending))
    return (
      <Page title="Register">
        <Text style={styles.muted}>Loading the award and your current company authority…</Text>
      </Page>
    );
  if (awardUuid && (award.isError || awardMembers.isError))
    return (
      <Page title="Register">
        <Text accessibilityRole="alert" style={styles.error}>
          The award and retained recipient could not be read.
        </Text>
        <Action label="Retry award" disabled={fetching} onPress={() => void refresh()} />
      </Page>
    );
  if (
    fixed &&
    ((awardMember && (!awardMember.walletless || !awardMember.particularsRetained)) ||
      (!awardMember && (!fixed.newMember || BigInt(fixed.issuedShares) > 0n)))
  )
    return (
      <Page title="Register">
        <Text style={styles.muted}>
          This award’s recipient needs current retained walletless particulars before a grant can be prepared.
        </Text>
      </Page>
    );
  return (
    <Page
      testID="prepare-grant-screen"
      title="Prepare share issue"
      lede={COPY.NOTE}
      keyboardShouldPersistTaps="handled"
    >
      <Section title={register.data.token.name}>
        <Text style={styles.heading}>Member</Text>
        <Text style={styles.text}>
          {fixed
            ? recipientName
            : member === 'new'
              ? 'New member'
              : members.data.holders.find((holder) => holder.member === member)?.name || member}
        </Text>
        {!fixed && (
          <>
            <Action
              label="Use a new member"
              disabled={busy || held || member === 'new'}
              onPress={() => setMember('new')}
            />
            <View style={styles.choices}>
              {members.data.holders
                .filter((holder) => holder.wallets.length === 0)
                .map((holder) => (
                  <Action
                    key={holder.member}
                    label={`Use ${holder.name || holder.member}`}
                    accessibilityLabel={`Use existing member ${holder.name || holder.member} ${holder.member}`}
                    disabled={busy || held || member === holder.member}
                    onPress={() => setMember(holder.member)}
                  />
                ))}
            </View>
          </>
        )}
        {!fixed && member === 'new' ? (
          <>
            <Field label={COPY.NAME} value={name} editable={!busy && !held} maxLength={255} onChange={setName} />
            <Field
              label={COPY.RESIDENTIAL_ADDRESS}
              value={residentialAddress}
              editable={!busy && !held}
              multiline
              maxLength={1000}
              onChange={setResidentialAddress}
            />
          </>
        ) : !fixed ? (
          <Text style={styles.muted}>
            The grant retains the existing member’s current particulars. Preview them before approval.
          </Text>
        ) : (
          <Text style={styles.muted}>
            {formatShareCount(fixed.availableShares)} vested shares available. The recipient and agreement are fixed;
            company approval and recording the issue remain separate.
          </Text>
        )}
        <Field
          label={COPY.SHARES}
          value={shares}
          editable={!busy && !held}
          keyboardType="number-pad"
          onChange={setShares}
        />
        <Text style={styles.heading}>Agreement and acceptance</Text>
        <Field
          label={`${COPY.TERMS_ON} (YYYY-MM-DD)`}
          accessibilityLabel={COPY.TERMS_ON}
          value={date}
          editable={!busy && !held && !fixed}
          onChange={setTermsOn}
        />
        <Field
          label={COPY.TERMS}
          value={summary}
          editable={!busy && !held && !fixed}
          multiline
          maxLength={1000}
          onChange={setTerms}
        />
        <Text style={styles.heading}>Company authority</Text>
        <Field
          label={COPY.DIRECTOR}
          value={approvingDirector}
          editable={!busy && !held}
          maxLength={255}
          onChange={setApprovingDirector}
        />
        <Text style={styles.muted}>
          {COPY.DIRECTOR_NOTE} {COPY.EFFECTIVE_NOTE}
        </Text>
        <Field
          label={COPY.AUTHORITY_REFERENCE}
          value={authorityReference}
          editable={!busy && !held}
          maxLength={255}
          onChange={setAuthorityReference}
        />
        <Field
          label={COPY.REASON}
          value={reason}
          editable={!busy && !held}
          multiline
          maxLength={1000}
          onChange={setReason}
        />
        <Text style={styles.text}>
          Recipient acceptance: {acceptanceRequired ? 'Required by the terms' : 'Not required by the terms'}
        </Text>
        <Action
          label={acceptanceRequired ? 'Terms do not require acceptance' : COPY.ACCEPTANCE_REQUIRED}
          disabled={busy || held}
          onPress={() => setAcceptanceRequired((value) => !value)}
        />
        <EvidencePicker
          title={COPY.AUTHORITY_DOCUMENT}
          noun="authority document"
          evidence={authority}
          disabled={busy || held}
          onPick={() => void pick(authority)}
        />
        <EvidencePicker
          title={COPY.TERMS_DOCUMENT}
          noun="terms document"
          evidence={retainedTerms}
          disabled={busy || held}
          onPick={() => void pick(retainedTerms)}
        />
        {acceptanceRequired && (
          <EvidencePicker
            title={COPY.ACCEPTANCE_DOCUMENT}
            noun="acceptance document"
            evidence={acceptance}
            disabled={busy || held}
            onPick={() => void pick(acceptance)}
          />
        )}
        <Text style={styles.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
        {fixed && (
          <Text style={styles.muted}>
            Choose the same agreement bytes as the award’s retained agreement for the terms document.
          </Text>
        )}
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
          label={submitting ? 'Preparing…' : held ? 'Retry original share issue' : 'Prepare share issue'}
          primary
          disabled={!ready}
          onPress={() => void submit()}
        />
      </Section>
    </Page>
  );
}

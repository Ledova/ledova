import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  NEW_PERSON_PROBLEMS,
  REGISTER_GRANT_COPY as COPY,
  REGISTER_GRANT_UNMET_COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureSentence,
  failureStatus,
  getRegisterGrants,
  hasProblems,
  isPreparedRegisterGrant,
  personRequest,
  prepareRegisterGrant,
  readEveryPage,
  refusalSentence,
  shareCount,
  shortReference,
  useErrorSummary,
  type OwnCompanyAppointment,
  type Person,
  type RegisterAward,
  type RegisterGrantPreparation,
  type RegisterTransferMember,
} from '@ledova/shared';
import { Action, Choice, Disclosure } from '../../components/Ledger';
import { ErrorSummary } from '../../components/ErrorSummary';
import { EvidencePicker, Field, isoDay, utcToday } from '../../components/register/RegisterFields';
import { PersonFields, PersonSelect } from '../../components/register/PersonPicker';
import { grantsKey } from '../../hooks/useCompanyRegister';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useRegisterEvidence } from '../../hooks/useRegisterEvidence';
import { apiClient } from '../../services/apiClient';

const FAILED = 'The grant preparation response could not be confirmed. Retry with the same details.';

export function GrantForm({
  epoch,
  company,
  token,
  people,
  appointment,
  guard,
  blocked,
  canPrepare,
  award,
  awardMember,
  onRefused,
  onRecorded,
  onCancel,
  onHeldChange,
}: {
  epoch: number;
  company: string;
  token: string;
  people: Person[];
  appointment: OwnCompanyAppointment;
  guard: () => void;
  blocked: boolean;
  canPrepare: boolean;
  award?: RegisterAward;
  awardMember?: RegisterTransferMember | null;
  onRefused: () => void;
  onRecorded: () => void;
  onCancel: () => void;
  onHeldChange: (held: boolean) => void;
}) {
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const today = utcToday();
  const [newMemberId] = useState(() => Crypto.randomUUID());
  const [member, setMember] = useState('new');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [shares, setShares] = useState('');
  const [companyEventOn, setCompanyEventOn] = useState('');
  const [termsOn, setTermsOn] = useState(today);
  const [terms, setTerms] = useState('');
  const [approvingDirector, setApprovingDirector] = useState('');
  const [authorityReference, setAuthorityReference] = useState('');
  const [reason, setReason] = useState('');
  const [acceptanceRequired, setAcceptanceRequired] = useState(false);
  const [awardDetails, setAwardDetails] = useState(false);
  const authority = useRegisterEvidence(company, 'authority');
  const retainedTerms = useRegisterEvidence(company, 'supporting');
  const acceptance = useRegisterEvidence(company, 'supporting');
  const [submitting, setSubmitting] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const busy = submitting || authority.busy || retainedTerms.busy || acceptance.busy;
  const mounted = useRef(true);
  const unavailable = useRef(blocked);
  const pending = useRef(false);
  const operation = useRef<{
    request: RegisterGrantPreparation;
    agreementFingerprint?: string;
    confirmed: boolean;
    uncertain: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    unavailable.current = blocked;
  }, [blocked]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onHeldChange(busy || held);
  }, [busy, held, onHeldChange]);
  useEffect(() => () => onHeldChange(false), [onHeldChange]);
  const check = () => {
    guard();
    if (unavailable.current)
      throw createUserFriendlyError('Refresh company access and register records before continuing.');
    if (!mounted.current) throw createUserFriendlyError('This grant form is closed. Reopen it before continuing.');
  };
  const newRecipient = !award && member === 'new';
  const recipientName = award ? (awardMember?.name ?? award.recipientName) : name.trim();
  const recipientAddress = award
    ? (awardMember?.residentialAddress ?? award.recipientResidentialAddress)
    : address.trim();
  const retainedDate = award?.termsOn ?? termsOn.trim();
  const retainedSummary = award?.terms ?? terms.trim();
  const past = (date: string) => !isoDay(date) || date > today;
  const problems = {
    name: newRecipient && !recipientName && NEW_PERSON_PROBLEMS.NAME,
    address: newRecipient && !recipientAddress && NEW_PERSON_PROBLEMS.ADDRESS,
    shares: !/^[1-9]\d*$/.test(shares.trim())
      ? 'Enter a positive whole number of shares.'
      : !!award &&
        BigInt(shares.trim()) > BigInt(award.availableShares) &&
        'The grant quantity must fit the award’s vested and not yet issued shares.',
    companyEventOn:
      past(companyEventOn.trim()) && 'Enter the company issue date as YYYY-MM-DD, no later than today (UTC).',
    termsOn: past(retainedDate) && 'Enter the terms date as YYYY-MM-DD, no later than today (UTC).',
    terms: !retainedSummary && 'Give the non-paid terms.',
    director: !approvingDirector.trim() && 'Name the approving director.',
    reference: !authorityReference.trim() && 'Give the authority reference.',
    reason: !reason.trim() && 'Give the reason.',
    authorityDocument: !authority.name && 'Choose the authority document.',
    termsDocument: !award && !retainedTerms.name && 'Choose the terms document.',
    acceptanceDocument: acceptanceRequired && !acceptance.name && 'Choose the acceptance document.',
  };
  const checks = useErrorSummary(problems);
  const lookup = async (request: RegisterGrantPreparation, agreementFingerprint?: string) => {
    const rows = await readEveryPage(async (page) => {
      check();
      const response = await getRegisterGrants(
        apiClient,
        { token, page },
        { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: check },
      );
      check();
      return response;
    });
    if (rows.some((row) => row.company !== company || row.token !== token))
      throw createUserFriendlyError('The grants did not identify this company and share class.');
    const original = rows.find((row) => row.uuid === request.operationId);
    if (original && !isPreparedRegisterGrant(original, request, agreementFingerprint))
      throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
    return original;
  };
  const pick = async (document: ReturnType<typeof useRegisterEvidence>) => {
    setError('');
    try {
      await document.pick();
    } catch (cause) {
      if (mounted.current) setError(failureSentence(cause, 'The document could not be selected. Try again.'));
    }
  };
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation.current && hasProblems(problems))) return;
    pending.current = true;
    setSubmitting(true);
    setError('');
    try {
      check();
      let command = operation.current;
      if (!command) {
        if (!canPrepare) throw createUserFriendlyError('Current preparation authority is required to prepare a grant.');
        const agreement = award ? { evidence: award.agreementEvidence, fingerprint: award.agreementFingerprint } : null;
        if (
          agreement &&
          (typeof agreement.evidence !== 'string' ||
            !agreement.evidence.trim() ||
            typeof agreement.fingerprint !== 'string' ||
            !/^[0-9a-f]{64}$/.test(agreement.fingerprint))
        )
          throw createUserFriendlyError('The retained award agreement could not be confirmed. Refresh the award.');
        const retainedAuthority = await authority.upload(appointment.uuid, check);
        const termsEvidence = agreement
          ? agreement.evidence
          : (await retainedTerms.upload(appointment.uuid, check)).uuid;
        const accepted = acceptanceRequired ? await acceptance.upload(appointment.uuid, check) : null;
        const request: RegisterGrantPreparation = {
          operationId: Crypto.randomUUID(),
          appointment: appointment.uuid,
          tokenId: token,
          ...(award
            ? { member: award.member, newMember: false, award: award.uuid }
            : personRequest(member, people, newMemberId, name, address)),
          shares: shares.trim(),
          companyEventOn: companyEventOn.trim(),
          termsOn: retainedDate,
          terms: retainedSummary,
          approvingDirector: approvingDirector.trim(),
          authorityReference: authorityReference.trim(),
          reason: reason.trim(),
          authorityEvidence: retainedAuthority.uuid,
          termsEvidence,
          acceptanceRequired,
          acceptanceEvidence: accepted?.uuid ?? null,
        };
        command = { request, agreementFingerprint: agreement?.fingerprint, confirmed: false, uncertain: false };
        operation.current = command;
        setHeld(true);
      }
      let absent = false;
      if (command.uncertain && !command.confirmed) {
        command.confirmed = !!(await lookup(command.request, command.agreementFingerprint));
        absent = !command.confirmed;
      }
      if (!command.confirmed) {
        try {
          check();
          const { data } = await prepareRegisterGrant(apiClient, command.request, {
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: check,
          });
          check();
          if (!isPreparedRegisterGrant(data, command.request, command.agreementFingerprint))
            throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
          command.confirmed = true;
        } catch (failure) {
          const status = failureStatus(failure);
          if (!absent || !status || status < 400 || status >= 500) throw failure;
          command.confirmed = !!(await lookup(command.request, command.agreementFingerprint));
          if (!command.confirmed) {
            operation.current = null;
            setHeld(false);
            setError(
              'The original grant was not recorded and the request was refused. Close this form and start again with current company authority.',
            );
            return;
          }
        }
      }
      await client.invalidateQueries({ queryKey: grantsKey(epoch, token) });
      check();
      operation.current = null;
      setHeld(false);
      onRecorded();
    } catch (failure) {
      const status = failureStatus(failure);
      if (operation.current && !operation.current.confirmed) {
        if (!status || status >= 500) operation.current.uncertain = true;
        else if (!operation.current.uncertain) {
          operation.current = null;
          setHeld(false);
        }
      }
      try {
        check();
      } catch {
        return;
      }
      setError(refusalSentence(failure, REGISTER_GRANT_UNMET_COPY) ?? apiErrorSentence(failure, FAILED, FAILED));
      if (status === 400 || status === 404 || status === 409) onRefused();
    } finally {
      pending.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };
  const editable = !busy && !blocked && !held && canPrepare;
  const document = (kind: 'authority' | 'terms' | 'acceptance') => {
    const evidence = { authority, terms: retainedTerms, acceptance }[kind];
    return (
      <EvidencePicker
        title={
          { authority: COPY.AUTHORITY_DOCUMENT, terms: COPY.TERMS_DOCUMENT, acceptance: COPY.ACCEPTANCE_DOCUMENT }[kind]
        }
        noun={`${kind} document`}
        evidence={evidence}
        error={checks.field(`${kind}Document`).error}
        disabled={!editable}
        onPick={() => void pick(evidence)}
      />
    );
  };
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        Issue details
      </Text>
      {award ? (
        <View style={styles.group}>
          <Text style={styles.text}>{recipientName}</Text>
          <Text style={styles.muted}>{shareCount(award.availableShares, 'vested')} available to issue</Text>
        </View>
      ) : (
        <PersonSelect
          label="Issue to"
          people={people.filter((row) => row.walletless && row.particularsRetained)}
          value={member}
          onChange={setMember}
          disabled={!editable}
        />
      )}
      {newRecipient && (
        <PersonFields
          name={name}
          residentialAddress={address}
          onName={setName}
          onResidentialAddress={setAddress}
          editable={editable}
          nameError={checks.field('name').error}
          addressError={checks.field('address').error}
        />
      )}
      <Field
        label={COPY.SHARES}
        value={shares}
        editable={editable}
        keyboardType="number-pad"
        maxLength={78}
        error={checks.field('shares').error}
        onChange={setShares}
      />
      <Field
        label={`${COPY.COMPANY_EVENT_ON} (YYYY-MM-DD)`}
        accessibilityLabel={COPY.COMPANY_EVENT_ON}
        value={companyEventOn}
        editable={editable}
        maxLength={10}
        error={checks.field('companyEventOn').error}
        onChange={setCompanyEventOn}
      />
      {award ? (
        <Disclosure
          open={awardDetails || !!checks.field('termsOn').error || !!checks.field('terms').error}
          onToggle={() => setAwardDetails((value) => !value)}
          accessibilityLabel="Award record details"
          summary={<Text style={styles.muted}>Award record details</Text>}
        >
          <Text style={styles.muted}>{recipientAddress}</Text>
          <Field
            label={`${COPY.TERMS_ON} (YYYY-MM-DD)`}
            accessibilityLabel={COPY.TERMS_ON}
            value={retainedDate}
            editable={false}
            error={checks.field('termsOn').error}
            onChange={setTermsOn}
          />
          <Field
            label={COPY.TERMS}
            value={retainedSummary}
            editable={false}
            multiline
            error={checks.field('terms').error}
            onChange={setTerms}
          />
          <Text style={styles.muted}>
            Award {shortReference(award.uuid)} · Member {shortReference(award.member)}
          </Text>
        </Disclosure>
      ) : (
        <>
          <Field
            label={`${COPY.TERMS_ON} (YYYY-MM-DD)`}
            accessibilityLabel={COPY.TERMS_ON}
            value={termsOn}
            editable={editable}
            maxLength={10}
            error={checks.field('termsOn').error}
            onChange={setTermsOn}
          />
          <Field
            label={COPY.TERMS}
            value={terms}
            editable={editable}
            multiline
            maxLength={1000}
            error={checks.field('terms').error}
            onChange={setTerms}
          />
          {document('terms')}
        </>
      )}
      <Text accessibilityRole="header" style={styles.heading}>
        Company authority
      </Text>
      <Field
        label={COPY.DIRECTOR}
        value={approvingDirector}
        editable={editable}
        maxLength={255}
        error={checks.field('director').error}
        onChange={setApprovingDirector}
      />
      <Field
        label={COPY.AUTHORITY_REFERENCE}
        value={authorityReference}
        editable={editable}
        maxLength={255}
        error={checks.field('reference').error}
        onChange={setAuthorityReference}
      />
      <Field
        label={COPY.REASON}
        value={reason}
        editable={editable}
        multiline
        maxLength={1000}
        error={checks.field('reason').error}
        onChange={setReason}
      />
      {document('authority')}
      <Choice
        label={COPY.ACCEPTANCE_REQUIRED}
        accessibilityRole="checkbox"
        selected={acceptanceRequired}
        disabled={!editable}
        onPress={() => setAcceptanceRequired((value) => !value)}
      />
      {acceptanceRequired && document('acceptance')}
      <ErrorSummary {...checks.summary} />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {held && (
        <Text style={styles.muted}>
          Recover the original preparation before starting another. Preparation creates no issued shares.
        </Text>
      )}
      <View style={styles.actions}>
        <Action label="Cancel" disabled={busy || held} onPress={onCancel} />
        <Action
          label={
            submitting
              ? 'Preparing grant…'
              : held
                ? 'Recover original grant preparation'
                : award
                  ? 'Prepare vested share issue'
                  : COPY.SUBMIT
          }
          primary
          disabled={busy || blocked || (!held && !canPrepare)}
          onPress={() => {
            if (held || checks.check()) void submit();
          }}
        />
      </View>
    </View>
  );
}

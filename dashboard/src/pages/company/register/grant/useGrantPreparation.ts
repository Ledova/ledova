import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_GRANT_COPY as COPY,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  getRegisterGrants,
  isPreparedRegisterGrant,
  isRegisterEvidenceReceipt,
  prepareRegisterGrant,
  readEveryPage,
  uploadRegisterEvidence,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterEvidence,
  type RegisterGrantPreparation,
  type RegisterAward,
  type RegisterTransferMember,
  type TokenHoldersResponse,
} from '@ledova/shared';

import apiClient from '@services/apiClient';
import { grantsKey } from '@pages/company/register/shared/useRegisterGrants';

export type DocumentKind = 'authority' | 'terms' | 'acceptance';

type Uploaded = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };

const FAILED = 'The grant preparation response could not be confirmed. Retry with the same details.';

export type GrantFormProps = {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  token: string;
  members: TokenHoldersResponse['holders'];
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onRefused: () => void;
  award?: RegisterAward;
  awardMember?: RegisterTransferMember | null;
  visible?: boolean;
  onHeldChange?: (held: boolean) => void;
  canPrepare?: boolean;
};

export function useGrantPreparation({
  owner,
  guard,
  company,
  token,
  appointment,
  blocked,
  onRefused,
  award,
  awardMember,
  visible = true,
  onHeldChange,
  canPrepare = true,
}: Omit<GrantFormProps, 'members'>) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [newMemberId] = useState(() => crypto.randomUUID());
  const [member, setMember] = useState('new');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [shares, setShares] = useState('');
  const [companyEventOn, setCompanyEventOn] = useState('');
  const [termsOn, setTermsOn] = useState(today);
  const [approvingDirector, setApprovingDirector] = useState('');
  const [terms, setTerms] = useState('');
  const [authorityReference, setAuthorityReference] = useState('');
  const [reason, setReason] = useState('');
  const [acceptanceRequired, setAcceptanceRequired] = useState(false);
  const [files, setFiles] = useState<Partial<Record<DocumentKind, File>>>({});
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const unavailable = useRef(blocked || !visible);
  useLayoutEffect(() => {
    unavailable.current = blocked || !visible;
  }, [blocked, visible]);
  const pending = useRef(false);
  const uploads = useRef<Partial<Record<DocumentKind, Uploaded>>>({});
  const operation = useRef<{
    request: RegisterGrantPreparation;
    agreementFingerprint?: string;
    confirmed: boolean;
    uncertain: boolean;
  } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (unavailable.current)
      throw createUserFriendlyError('Refresh company access and register records before continuing.');
    if (!mounted.current) throw createUserFriendlyError('This grant form is closed. Reopen it before continuing.');
  };
  const documentKinds: DocumentKind[] = [
    'authority',
    ...(!award ? ['terms' as const] : []),
    ...(acceptanceRequired ? ['acceptance' as const] : []),
  ];
  const newRecipient = award ? !awardMember : member === 'new';
  const recipientName = award ? (awardMember?.name ?? award.name) : name.trim();
  const recipientAddress = award ? (awardMember?.residentialAddress ?? award.residentialAddress) : address.trim();
  const retainedDate = award?.termsOn ?? termsOn;
  const retainedSummary = award?.terms ?? terms.trim();
  const problem =
    newRecipient && (!recipientName || !recipientAddress)
      ? 'Give the new member’s name and residential address.'
      : !/^[1-9]\d*$/.test(shares)
        ? 'Enter a positive whole number of shares.'
        : award && BigInt(shares) > BigInt(award.availableShares)
          ? 'The grant quantity must fit the award’s vested and not yet issued shares.'
          : !/^\d{4}-\d{2}-\d{2}$/.test(companyEventOn) || companyEventOn > today
            ? 'Enter the company issue date no later than today (UTC).'
            : !/^\d{4}-\d{2}-\d{2}$/.test(retainedDate) || retainedDate > today
              ? 'Enter a terms date no later than today (UTC).'
              : !retainedSummary || !approvingDirector.trim() || !authorityReference.trim() || !reason.trim()
                ? 'Give the non-paid terms, approving director, authority reference and reason.'
                : documentKinds.some((kind) => !files[kind])
                  ? award
                    ? 'Choose the authority and any required acceptance documents.'
                    : 'Choose the authority, terms and any required acceptance documents.'
                  : null;
  const upload = async (kind: DocumentKind) => {
    const file = files[kind]!;
    const previous = uploads.current[kind];
    const same = previous?.file === file && previous.appointment === appointment.uuid;
    if (same && previous.receipt) return previous.receipt;
    const key = same ? previous.key : crypto.randomUUID();
    uploads.current[kind] = { file, appointment: appointment.uuid, key, receipt: null };
    const request = {
      companyId: company,
      appointment: appointment.uuid,
      kind: kind === 'authority' ? ('authority' as const) : ('supporting' as const),
      idempotencyKey: key,
    };
    check();
    const { data } = await uploadRegisterEvidence(
      apiClient,
      { ...request, file },
      { ledovaSubmissionGuard: check },
    ).catch((failure) => {
      if (failureStatus(failure) === 409) delete uploads.current[kind];
      throw failure;
    });
    check();
    if (!isRegisterEvidenceReceipt(data, request, file.size)) {
      delete uploads.current[kind];
      throw createUserFriendlyError('The uploaded document could not be confirmed. Upload it again.');
    }
    uploads.current[kind] = { file, appointment: appointment.uuid, key, receipt: data };
    return data;
  };
  const lookup = async (request: RegisterGrantPreparation, agreementFingerprint?: string) => {
    const rows = await readEveryPage(async (page) => {
      check();
      const response = await getRegisterGrants(apiClient, { token, page }, { ledovaSubmissionGuard: check });
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
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation.current && problem)) return;
    pending.current = true;
    setBusy(true);
    onHeldChange?.(true);
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
        const authority = await upload('authority');
        const termsEvidence = agreement ? agreement.evidence : (await upload('terms')).uuid;
        const acceptance = acceptanceRequired ? await upload('acceptance') : null;
        const request: RegisterGrantPreparation = {
          operationId: crypto.randomUUID(),
          appointment: appointment.uuid,
          tokenId: token,
          member: award?.member ?? (newRecipient ? newMemberId : member),
          newMember: newRecipient,
          ...(newRecipient ? { name: recipientName, residentialAddress: recipientAddress } : {}),
          ...(award ? { award: award.uuid } : {}),
          shares,
          companyEventOn,
          termsOn: retainedDate,
          terms: retainedSummary,
          approvingDirector: approvingDirector.trim(),
          authorityReference: authorityReference.trim(),
          reason: reason.trim(),
          authorityEvidence: authority.uuid,
          termsEvidence,
          acceptanceRequired,
          acceptanceEvidence: acceptance?.uuid ?? null,
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
          const { data } = await prepareRegisterGrant(apiClient, command.request, { ledovaSubmissionGuard: check });
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
      await client.invalidateQueries({ queryKey: grantsKey(owner, token) });
      check();
      operation.current = null;
      setHeld(false);
      onHeldChange?.(false);
      navigate(
        `${DESTINATIONS.companyRegister.path}${award ? '#awards' : ''}`,
        award ? { state: { awardIssueToken: token, awardIssueCompany: company } } : undefined,
      );
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
      setError(apiErrorSentence(failure, FAILED, FAILED));
      if (status === 400 || status === 404 || status === 409) onRefused();
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        onHeldChange?.(!!operation.current);
      }
    }
  };
  if (!visible) return null;
  return {
    today,
    member,
    setMember,
    name,
    setName,
    address,
    setAddress,
    shares,
    setShares,
    companyEventOn,
    setCompanyEventOn,
    setTermsOn,
    approvingDirector,
    setApprovingDirector,
    setTerms,
    authorityReference,
    setAuthorityReference,
    reason,
    setReason,
    acceptanceRequired,
    setAcceptanceRequired,
    setFiles,
    busy,
    held,
    error,
    documentKinds,
    recipientName,
    recipientAddress,
    retainedDate,
    retainedSummary,
    problem,
    submit,
  } as const;
}

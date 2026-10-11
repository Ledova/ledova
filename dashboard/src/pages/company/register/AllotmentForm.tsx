import { useEffect, useRef, useState } from 'react';
import {
  REGISTER_ALLOTMENT_COPY as COPY,
  allotmentAud,
  apiErrorSentence,
  createUserFriendlyError,
  failureStatus,
  getRegisterAllotment,
  isPreparedRegisterAllotment,
  isRegisterEvidenceReceipt,
  prepareRegisterAllotment,
  uploadRegisterEvidence,
  type OwnCompanyAppointment,
  type RegisterAllotmentPreparation,
  type RegisterEvidence,
  type RegisterTransferMember,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';

type DocumentKind = 'authority' | 'agreement' | 'receipt';
const LABEL = 'block space-y-1 text-sm text-text-primary';

export function AllotmentForm({
  company,
  token,
  members,
  appointment,
  guard,
  newEffectGuard,
  blocked,
  onRecorded,
  onHeldChange,
}: {
  company: string;
  token: string;
  members: RegisterTransferMember[];
  appointment: OwnCompanyAppointment;
  guard: () => void;
  newEffectGuard: () => void;
  blocked: boolean;
  onRecorded: () => Promise<unknown>;
  onHeldChange: (held: boolean) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [memberId] = useState(() => crypto.randomUUID());
  const [member, setMember] = useState('new');
  const [fields, setFields] = useState({
    name: '',
    residentialAddress: '',
    shares: '',
    consideration: '',
    receivedAmount: '',
    agreementReference: '',
    agreementOn: today,
    receivedOn: today,
    terms: '',
    approvingDirector: '',
    authorityReference: '',
    reason: '',
  });
  const [files, setFiles] = useState<Partial<Record<DocumentKind, File>>>({});
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  const pending = useRef(false);
  const uploads = useRef<Partial<Record<DocumentKind, { file: File; key: string; receipt: RegisterEvidence | null }>>>(
    {},
  );
  const operation = useRef<{ request: RegisterAllotmentPreparation; confirmed: boolean; uncertain: boolean } | null>(
    null,
  );
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (!live.current) throw createUserFriendlyError('This allotment form is closed.');
  };
  const beforeWrite = () => {
    check();
    newEffectGuard();
  };
  const consideration = allotmentAud(fields.consideration);
  const received = allotmentAud(fields.receivedAmount);
  const problem =
    member === 'new' && (!fields.name.trim() || !fields.residentialAddress.trim())
      ? 'Give the investor’s name and residential address.'
      : !/^[1-9]\d*$/.test(fields.shares) || BigInt(fields.shares) >= 2n ** 256n
        ? 'Enter a positive whole number of shares.'
        : !consideration || received !== consideration
          ? 'The company-reported receipt must equal the full positive AUD consideration, with at most two decimal places.'
          : [fields.agreementOn, fields.receivedOn].some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today)
            ? 'Agreement and receipt dates must be today (UTC) or earlier.'
            : !fields.agreementReference.trim() ||
                !fields.terms.trim() ||
                !fields.approvingDirector.trim() ||
                !fields.authorityReference.trim() ||
                !fields.reason.trim()
              ? 'Give the external agreement, approving director, company authority and reason.'
              : (['authority', 'agreement', 'receipt'] as const).some((kind) => !files[kind])
                ? 'Choose the authority, agreement and receipt evidence.'
                : null;
  const upload = async (kind: DocumentKind) => {
    const file = files[kind]!;
    if (uploads.current[kind]?.file !== file) uploads.current[kind] = { file, key: crypto.randomUUID(), receipt: null };
    const saved = uploads.current[kind]!;
    if (!saved.receipt) {
      const request = {
        companyId: company,
        appointment: appointment.uuid,
        kind: kind === 'authority' ? ('authority' as const) : ('supporting' as const),
        idempotencyKey: saved.key,
      };
      beforeWrite();
      const { data } = await uploadRegisterEvidence(
        apiClient,
        { ...request, file },
        { ledovaSubmissionGuard: beforeWrite },
      );
      check();
      if (!isRegisterEvidenceReceipt(data, request, file.size)) {
        delete uploads.current[kind];
        throw createUserFriendlyError('The uploaded evidence could not be confirmed.');
      }
      saved.receipt = data;
    }
    return saved.receipt;
  };
  const submit = async () => {
    if (pending.current || busy || blocked || (!operation.current && problem)) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      check();
      let command = operation.current;
      if (!command) {
        const authority = await upload('authority');
        const agreement = await upload('agreement');
        const receipt = await upload('receipt');
        command = {
          request: {
            operationId: crypto.randomUUID(),
            appointment: appointment.uuid,
            tokenId: token,
            member: member === 'new' ? memberId : member,
            newMember: member === 'new',
            ...(member === 'new'
              ? { name: fields.name.trim(), residentialAddress: fields.residentialAddress.trim() }
              : {}),
            shares: fields.shares,
            consideration: consideration!,
            receivedAmount: received!,
            currency: 'AUD',
            agreementReference: fields.agreementReference.trim(),
            agreementOn: fields.agreementOn,
            terms: fields.terms.trim(),
            receivedOn: fields.receivedOn,
            approvingDirector: fields.approvingDirector.trim(),
            authorityReference: fields.authorityReference.trim(),
            reason: fields.reason.trim(),
            authorityEvidence: authority.uuid,
            agreementEvidence: agreement.uuid,
            receiptEvidence: receipt.uuid,
          },
          confirmed: false,
          uncertain: false,
        };
        operation.current = command;
        setHeld(true);
        onHeldChange(true);
      }
      if (command.uncertain && !command.confirmed) {
        try {
          check();
          const { data } = await getRegisterAllotment(apiClient, command.request.operationId, {
            ledovaSubmissionGuard: check,
          });
          check();
          if (!isPreparedRegisterAllotment(data, command.request, company))
            throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
          command.confirmed = true;
        } catch (cause) {
          check();
          if (failureStatus(cause) !== 404) throw cause;
        }
      }
      if (!command.confirmed) {
        beforeWrite();
        const { data } = await prepareRegisterAllotment(apiClient, command.request, {
          ledovaSubmissionGuard: beforeWrite,
        });
        check();
        if (!isPreparedRegisterAllotment(data, command.request, company))
          throw createUserFriendlyError(COPY.PREPARATION_RECEIPT_FAILED);
        command.confirmed = true;
      }
      await onRecorded();
      operation.current = null;
      if (live.current) {
        setHeld(false);
        onHeldChange(false);
      }
    } catch (cause) {
      const status = failureStatus(cause);
      if (operation.current && !operation.current.confirmed) {
        if (!status || status >= 500) operation.current.uncertain = true;
        else if (!operation.current.uncertain) {
          operation.current = null;
          if (live.current) {
            setHeld(false);
            onHeldChange(false);
          }
        }
      }
      try {
        check();
      } catch {
        return;
      }
      setError(apiErrorSentence(cause, COPY.PREPARATION_RECEIPT_FAILED, COPY.PREPARATION_RECEIPT_FAILED));
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy || blocked || held} className="space-y-4">
        <label className={LABEL}>
          Investor/member
          <select className={FIELD_CLASS} value={member} onChange={(event) => setMember(event.target.value)}>
            <option value="new">New investor/member</option>
            {members
              .filter((row) => row.walletless && row.particularsRetained)
              .map((row) => (
                <option key={row.member} value={row.member}>
                  {row.name} · {row.member}
                </option>
              ))}
          </select>
        </label>
        {(
          [
            ...(member === 'new' ? (['name', 'residentialAddress'] as const) : []),
            'shares',
            'consideration',
            'receivedAmount',
            'agreementReference',
            'agreementOn',
            'receivedOn',
            'terms',
            'approvingDirector',
            'authorityReference',
            'reason',
          ] as const
        ).map((key) => {
          const label = {
            name: 'Investor name',
            residentialAddress: 'Residential address',
            shares: COPY.SHARES,
            consideration: COPY.CONSIDERATION,
            receivedAmount: COPY.RECEIVED_AMOUNT,
            agreementReference: COPY.AGREEMENT_REFERENCE,
            agreementOn: COPY.AGREEMENT_ON,
            receivedOn: COPY.RECEIVED_ON,
            terms: COPY.TERMS,
            approvingDirector: COPY.DIRECTOR,
            authorityReference: COPY.AUTHORITY_REFERENCE,
            reason: COPY.REASON,
          }[key];
          return (
            <label key={key} className={LABEL}>
              {label}
              <input
                className={FIELD_CLASS}
                type={key.endsWith('On') ? 'date' : 'text'}
                max={key.endsWith('On') ? today : undefined}
                value={fields[key]}
                maxLength={key === 'shares' ? 78 : ['terms', 'reason', 'residentialAddress'].includes(key) ? 1000 : 255}
                onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))}
              />
            </label>
          );
        })}
        {(['authority', 'agreement', 'receipt'] as const).map((kind) => (
          <label key={kind} className={LABEL}>
            {COPY.DOCUMENTS[kind]}
            <input
              className={FIELD_CLASS}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(event) => setFiles((current) => ({ ...current, [kind]: event.target.files?.[0] }))}
            />
          </label>
        ))}
        <p className="text-sm text-text-muted">
          {COPY.RECEIPT_NOTE} The approving director must not be the recipient. {COPY.EFFECTIVE_NOTE}
        </p>
      </fieldset>
      {problem && <p className="text-sm text-text-muted">{problem}</p>}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <p className="text-sm text-text-muted">{COPY.RECOVERY_NOTE}</p>
      <PageAction
        label={busy ? 'Preparing allotment…' : COPY.SUBMIT}
        disabled={busy || blocked || (!held && !!problem)}
        onClick={() => void submit()}
      />
    </form>
  );
}

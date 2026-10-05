import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  DESTINATIONS,
  HOLDER_TYPE_LABELS,
  REGISTER_IMPORT_COPY,
  apiErrorSentence,
  createUserFriendlyError,
  formatDateToString,
  formatShareCount,
  isPreparedRegisterImport,
  isRegisterEvidenceReceipt,
  prepareRegisterImport,
  registerImportTotals,
  uploadRegisterEvidence,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterEvidence,
  type RegisterEvidenceKind,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { importsKey } from '../useRegisterImports';
import {
  blankFormer,
  blankMember,
  figuresDiffer,
  formerRows,
  initialMembers,
  memberRows,
  preparationProblems,
  statedFigures,
  type Authority,
  type FormerDraft,
  type MemberDraft,
  type PreparationDraft,
} from './preparation';

type Upload = { file: File; appointment: string; key: string; receipt: RegisterEvidence | null };

const FAILED = 'The import could not be prepared. Retry with the same details.';
const CLOSED = 'This import form is closed. Reopen it before continuing.';
const LABEL = 'block space-y-1 text-sm text-text-primary';
const EVIDENCE = 'application/pdf,image/png,image/jpeg';

function statusOf(failure: unknown) {
  return (failure as { response?: { status?: number } } | null)?.response?.status;
}

export function ImportForm({
  owner,
  guard,
  company,
  register,
  appointment,
  blocked,
  onConflict,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  register: TokenHoldersResponse;
  appointment: OwnCompanyAppointment;
  blocked: boolean;
  onConflict: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const today = formatDateToString(new Date());
  const [draft, setDraft] = useState<PreparationDraft>(() => ({
    registerFile: null,
    asicFile: null,
    asAt: today,
    authority: 'director_resolution',
    director: '',
    reference: '',
    reason: '',
    members: initialMembers(register),
    former: [],
    statedTotal: '',
    statedCount: '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const uploads = useRef<Partial<Record<RegisterEvidenceKind, Upload>>>({});
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (!mounted.current) throw createUserFriendlyError(CLOSED);
  };
  const update = (apply: (current: PreparationDraft) => PreparationDraft) => {
    setError('');
    setDraft(apply);
  };
  const setMember = (index: number, patch: Partial<MemberDraft>) =>
    update((current) => ({
      ...current,
      members: current.members.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    }));
  const setFormer = (index: number, patch: Partial<FormerDraft>) =>
    update((current) => ({
      ...current,
      former: current.former.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    }));
  const problems = preparationProblems(draft, today);
  const differs = figuresDiffer(draft);
  const imported = registerImportTotals(memberRows(draft.members));

  const upload = async (kind: RegisterEvidenceKind, file: File) => {
    const previous = uploads.current[kind];
    const same = previous?.file === file && previous.appointment === appointment.uuid;
    if (same && previous.receipt) return previous.receipt;
    const key = same ? previous.key : crypto.randomUUID();
    uploads.current[kind] = { file, appointment: appointment.uuid, key, receipt: null };
    const request = { companyId: company, appointment: appointment.uuid, kind, idempotencyKey: key };
    try {
      check();
      const { data } = await uploadRegisterEvidence(apiClient, { ...request, file }, { ledovaSubmissionGuard: check });
      check();
      if (!isRegisterEvidenceReceipt(data, request, file.size)) {
        delete uploads.current[kind];
        throw createUserFriendlyError(REGISTER_IMPORT_COPY.UPLOAD_RECEIPT_FAILED);
      }
      uploads.current[kind] = { file, appointment: appointment.uuid, key, receipt: data };
      return data;
    } catch (failure) {
      if (statusOf(failure) === 409) delete uploads.current[kind];
      throw failure;
    }
  };

  const submit = async () => {
    if (pending.current || busy || blocked || problems.length > 0 || differs || !draft.registerFile || !draft.asicFile)
      return;
    const stated = statedFigures(draft)!;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      check();
      const registerEvidence = await upload('share_register', draft.registerFile);
      const asicEvidence = await upload('asic_extract', draft.asicFile);
      const request = {
        appointment: appointment.uuid,
        tokenId: register.token.uuid,
        registerEvidence: registerEvidence.uuid,
        asicEvidence: asicEvidence.uuid,
        asicIssuedTotal: stated.total,
        asicMemberCount: stated.count,
        asAt: draft.asAt,
        members: memberRows(draft.members),
        formerMembers: formerRows(draft.former),
        authority: draft.authority,
        approvingDirector: draft.authority === 'director_resolution' ? draft.director.trim() : '',
        authorityReference: draft.reference.trim(),
        reason: draft.reason.trim(),
      };
      const signature = JSON.stringify(request);
      if (operation.current?.signature !== signature) operation.current = { signature, key: crypto.randomUUID() };
      const preparation = { operationId: operation.current.key, ...request };
      try {
        check();
        const { data } = await prepareRegisterImport(apiClient, preparation, { ledovaSubmissionGuard: check });
        check();
        if (!isPreparedRegisterImport(data, preparation))
          throw createUserFriendlyError(REGISTER_IMPORT_COPY.PREPARATION_RECEIPT_FAILED);
      } catch (failure) {
        if (statusOf(failure) === 409) {
          operation.current = null;
          onConflict();
        }
        throw failure;
      }
      check();
      await client.invalidateQueries({ queryKey: importsKey(owner, register.token.uuid) });
      check();
      navigate(DESTINATIONS.companyRegister.path);
    } catch (failure) {
      try {
        check();
        setError(apiErrorSentence(failure, FAILED, FAILED));
      } catch {
        return;
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy} className="space-y-5">
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Evidence provided by the company</legend>
          <label className={LABEL}>
            Current share register
            <input
              type="file"
              accept={EVIDENCE}
              className={FIELD_CLASS}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                update((current) => ({ ...current, registerFile: file }));
              }}
            />
          </label>
          <label className={LABEL}>
            ASIC extract
            <input
              type="file"
              accept={EVIDENCE}
              className={FIELD_CLASS}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                update((current) => ({ ...current, asicFile: file }));
              }}
            />
          </label>
          <p className="text-sm text-text-muted">PDF or image, max 10 MB. Ledova does not verify either document.</p>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Register date and authority</legend>
          <label className={LABEL}>
            Register date
            <input
              type="date"
              max={today}
              value={draft.asAt}
              className={FIELD_CLASS}
              onChange={(event) => {
                const asAt = event.target.value;
                update((current) => ({ ...current, asAt }));
              }}
            />
          </label>
          <label className={LABEL}>
            Authority
            <select
              value={draft.authority}
              className={FIELD_CLASS}
              onChange={(event) => {
                const authority = event.target.value as Authority;
                update((current) => ({ ...current, authority }));
              }}
            >
              <option value="director_resolution">Director resolution</option>
              <option value="court_order">Court order</option>
            </select>
          </label>
          {draft.authority === 'director_resolution' && (
            <label className={LABEL}>
              Approving director
              <input
                value={draft.director}
                maxLength={255}
                className={FIELD_CLASS}
                onChange={(event) => {
                  const director = event.target.value;
                  update((current) => ({ ...current, director }));
                }}
              />
            </label>
          )}
          <label className={LABEL}>
            Authority reference
            <input
              value={draft.reference}
              maxLength={255}
              className={FIELD_CLASS}
              onChange={(event) => {
                const reference = event.target.value;
                update((current) => ({ ...current, reference }));
              }}
            />
          </label>
          <label className={LABEL}>
            Reason
            <textarea
              rows={3}
              value={draft.reason}
              maxLength={1000}
              className={FIELD_CLASS}
              onChange={(event) => {
                const reason = event.target.value;
                update((current) => ({ ...current, reason }));
              }}
            />
          </label>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Current members</legend>
          <p className="text-sm text-text-muted">
            {!register.initialized
              ? "Each current member in the company's register, with their shares."
              : register.holders.length > 0
                ? 'Each current member of the stored register, with the shares it records.'
                : REGISTER_IMPORT_COPY.NO_HOLDERS}
          </p>
          {draft.members.map((row, index) => {
            const holder = register.initialized
              ? register.holders.find((item) => item.member === row.member)
              : undefined;
            return (
              <fieldset key={row.member} className="space-y-2 border-t border-border-subtle pt-3">
                <legend className="text-sm text-text-primary">Member {index + 1}</legend>
                {holder && (
                  <p className="text-xs text-text-muted">
                    {holder.name || HOLDER_TYPE_LABELS[holder.holderType]} · {formatShareCount(holder.balance)}{' '}
                    {holder.balance === '1' ? 'share' : 'shares'}
                  </p>
                )}
                <label className={LABEL}>
                  Name
                  <input
                    value={row.name}
                    maxLength={255}
                    className={FIELD_CLASS}
                    onChange={(event) => setMember(index, { name: event.target.value })}
                  />
                </label>
                <label className={LABEL}>
                  Residential address
                  <input
                    value={row.residentialAddress}
                    maxLength={1000}
                    className={FIELD_CLASS}
                    onChange={(event) => setMember(index, { residentialAddress: event.target.value })}
                  />
                </label>
                {!register.initialized && (
                  <label className={LABEL}>
                    Shares
                    <input
                      inputMode="numeric"
                      value={row.shares}
                      className={FIELD_CLASS}
                      onChange={(event) => setMember(index, { shares: event.target.value })}
                    />
                  </label>
                )}
                <label className={LABEL}>
                  Date entered
                  <input
                    type="date"
                    max={draft.asAt}
                    value={row.enteredOn}
                    className={FIELD_CLASS}
                    onChange={(event) => setMember(index, { enteredOn: event.target.value })}
                  />
                </label>
                <label className={LABEL}>
                  Amount paid (optional)
                  <input
                    inputMode="decimal"
                    placeholder="250.00"
                    value={row.amountPaid}
                    className={FIELD_CLASS}
                    onChange={(event) => setMember(index, { amountPaid: event.target.value })}
                  />
                </label>
                {!register.initialized && draft.members.length > 1 && (
                  <PageAction
                    label={`Remove member ${index + 1}`}
                    disabled={busy}
                    onClick={() =>
                      update((current) => ({ ...current, members: current.members.filter((_, at) => at !== index) }))
                    }
                  />
                )}
              </fieldset>
            );
          })}
          {!register.initialized && (
            <PageAction
              label="Add a member"
              disabled={busy}
              onClick={() => update((current) => ({ ...current, members: [...current.members, blankMember()] }))}
            />
          )}
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">Former members</legend>
          <p className="text-sm text-text-muted">
            Members who ceased within the last seven years, with the shares they held when they ceased.
          </p>
          {draft.former.map((row, index) => (
            <fieldset key={row.id} className="space-y-2 border-t border-border-subtle pt-3">
              <legend className="text-sm text-text-primary">Former member {index + 1}</legend>
              <label className={LABEL}>
                Name
                <input
                  value={row.name}
                  maxLength={255}
                  className={FIELD_CLASS}
                  onChange={(event) => setFormer(index, { name: event.target.value })}
                />
              </label>
              <label className={LABEL}>
                Residential address
                <input
                  value={row.residentialAddress}
                  maxLength={1000}
                  className={FIELD_CLASS}
                  onChange={(event) => setFormer(index, { residentialAddress: event.target.value })}
                />
              </label>
              <label className={LABEL}>
                Shares
                <input
                  inputMode="numeric"
                  value={row.shares}
                  className={FIELD_CLASS}
                  onChange={(event) => setFormer(index, { shares: event.target.value })}
                />
              </label>
              <label className={LABEL}>
                Date ceased
                <input
                  type="date"
                  max={draft.asAt}
                  value={row.ceasedOn}
                  className={FIELD_CLASS}
                  onChange={(event) => setFormer(index, { ceasedOn: event.target.value })}
                />
              </label>
              <PageAction
                label={`Remove former member ${index + 1}`}
                disabled={busy}
                onClick={() =>
                  update((current) => ({ ...current, former: current.former.filter((_, at) => at !== index) }))
                }
              />
            </fieldset>
          ))}
          <PageAction
            label="Add a former member"
            disabled={busy}
            onClick={() => update((current) => ({ ...current, former: [...current.former, blankFormer()] }))}
          />
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-text-primary">ASIC extract figures</legend>
          <label className={LABEL}>
            Issued shares in the ASIC extract
            <input
              inputMode="numeric"
              value={draft.statedTotal}
              className={FIELD_CLASS}
              onChange={(event) => {
                const statedTotal = event.target.value;
                update((current) => ({ ...current, statedTotal }));
              }}
            />
          </label>
          <label className={LABEL}>
            Members in the ASIC extract
            <input
              inputMode="numeric"
              value={draft.statedCount}
              className={FIELD_CLASS}
              onChange={(event) => {
                const statedCount = event.target.value;
                update((current) => ({ ...current, statedCount }));
              }}
            />
          </label>
          <p className="text-sm text-text-primary">
            {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(imported.total), imported.count)}
          </p>
          {differs && (
            <p role="alert" className="text-sm text-error-light">
              The ASIC extract figures differ from the import rows. Correct the rows or the figures before preparing the
              import.
            </p>
          )}
        </fieldset>
      </fieldset>
      {problems.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-text-muted">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <PageAction
        label={busy ? 'Preparing import…' : 'Prepare import'}
        disabled={busy || blocked || problems.length > 0 || differs}
        onClick={() => void submit()}
      />
    </form>
  );
}

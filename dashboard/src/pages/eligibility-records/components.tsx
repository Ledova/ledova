import { useState, type ReactNode } from 'react';
import type { CompanyEligibilityRequest, CompanyEligibilitySharedSummary, EligibilityAction } from '@ledova/shared';
import { FIELD_CLASS } from '@components/fieldClass';
import { Row, Rows, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-text-primary">
      {label}
      {children}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        className={FIELD_CLASS}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </Field>
  );
}

const summaryLabels = {
  category: 'Category',
  source: 'Evidence source',
  userAccount: 'Participant account',
  company: 'Exact company',
  submittedAt: 'Source submitted',
  requestedExpiresAt: 'Requested expiry',
  certificateIssuedAt: 'Certificate issued',
  certifierName: 'Certifier',
  certifierBody: 'Certifier body',
  certifierMembershipNumber: 'Certifier membership',
  associatedCompany: 'Associated company',
  offering: 'Approved offering',
  token: 'Share class',
  quantity: 'Whole-share quantity',
  pricePerShare: 'Price per share',
  priceCurrency: 'Currency',
  amountAud: 'Amount (AUD)',
  offeringTermsDigest: 'Offering terms digest',
} satisfies Partial<Record<keyof CompanyEligibilitySharedSummary, string>>;

export function EligibilitySummary({ summary }: { summary: CompanyEligibilitySharedSummary }) {
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{summary.declarationText}</p>
      <Rows>
        {Object.entries(summaryLabels).map(([key, label]) => {
          const value = summary[key as keyof CompanyEligibilitySharedSummary];
          return value === undefined || value === null ? null : (
            <Row key={key} label={label}>
              <span className="break-all">{String(value)}</span>
            </Row>
          );
        })}
      </Rows>
      {summary.offeringTerms !== undefined && (
        <div>
          <p className="text-sm text-text-muted">Exact offering terms</p>
          <pre className="whitespace-pre-wrap break-all text-sm text-text-primary">
            {JSON.stringify(summary.offeringTerms, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}

export function EligibilityHistory({ record }: { record: CompanyEligibilityRequest }) {
  const decision = record.decision;
  const revocation = decision?.revocation;
  return (
    <Section title="Retained request and outcome">
      <Rows>
        <Row label="Request">{record.uuid}</Row>
        <Row label="Outcome">{record.outcome}</Row>
        <Row label="Submitted">{record.submittedAt}</Row>
        <Row label="Submitted by">{record.submittedBy}</Row>
        <Row label="Request digest">{record.digest}</Row>
        <Row label="Request key">{record.idempotencyKey}</Row>
        {decision && (
          <>
            <Row label="Decision">{decision.outcome}</Row>
            <Row label="Decision maker">{decision.decidedBy}</Row>
            <Row label="Decision appointment">{decision.appointment}</Row>
            <Row label="Decision time">{decision.decidedAt}</Row>
            <Row label="Decision expiry">{decision.expiresAt ?? 'No acceptance expiry'}</Row>
            <Row label="Decision key">{decision.idempotencyKey}</Row>
            <Row label="Decision digest">{decision.digest}</Row>
            {decision.reason && <Row label="Refusal reason">{decision.reason}</Row>}
          </>
        )}
        {record.withdrawal && (
          <>
            <Row label="Withdrawn">{record.withdrawal.withdrawnAt}</Row>
            <Row label="Withdrawn by">{record.withdrawal.withdrawnBy}</Row>
            <Row label="Withdrawal key">{record.withdrawal.idempotencyKey}</Row>
          </>
        )}
        {revocation && (
          <>
            <Row label="Revoked">{revocation.revokedAt}</Row>
            <Row label="Revoked by">{revocation.revokedBy}</Row>
            <Row label="Revocation appointment">{revocation.appointment}</Row>
            <Row label="Revocation reason">{revocation.reason}</Row>
            <Row label="Revocation key">{revocation.idempotencyKey}</Row>
          </>
        )}
      </Rows>
      <EligibilitySummary summary={record.sharedSummary} />
      {record.outcome === 'accepted' && (
        <p className="text-sm text-text-muted">
          Acceptance remains subject to current requirements, evidence availability, expiry and revocation.
        </p>
      )}
    </Section>
  );
}

export function RecordsList({
  records,
  select,
  selected,
}: {
  records: CompanyEligibilityRequest[];
  select: (uuid: string) => void;
  selected?: string;
}) {
  return records.length === 0 ? (
    <p>No requests recorded.</p>
  ) : (
    <ul className="divide-y divide-border-subtle">
      {records.map((record) => (
        <li key={record.uuid} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0 text-sm">
            <p className="break-all">{record.uuid}</p>
            <p>
              {record.category} · {record.outcome}
            </p>
            <p className="break-all">Company {record.company}</p>
          </div>
          <PageAction
            label={`View request ${record.uuid}`}
            active={selected === record.uuid}
            onClick={() => select(record.uuid)}
          />
        </li>
      ))}
    </ul>
  );
}

export function ActionConfirmation({
  action,
  busy,
  confirm,
  cancel,
}: {
  action: EligibilityAction;
  busy: boolean;
  confirm: (
    action: EligibilityAction,
    checks: { sharingAccepted?: boolean; declarationAccepted?: boolean; confirmation?: boolean },
  ) => Promise<void>;
  cancel: () => void;
}) {
  const [consent, setConsent] = useState({ action, sharing: false, declaration: false, confirmed: false });
  const checks = consent.action === action ? consent : { action, sharing: false, declaration: false, confirmed: false };
  const { sharing, declaration, confirmed } = checks;
  const unmet = action.request?.unmetRequirements ?? action.decision?.unmetRequirements ?? [];
  const can =
    action.kind === 'request'
      ? action.request?.canSubmit && sharing && declaration
      : (action.kind !== 'decision' || action.decision?.canDecide) && confirmed;
  const label =
    action.kind === 'request'
      ? 'Submit company eligibility request'
      : action.kind === 'decision'
        ? 'Record company decision'
        : action.kind === 'withdrawal'
          ? 'Withdraw this request'
          : 'Revoke this acceptance';
  return (
    <Section title="Review exact action">
      {action.request && <EligibilitySummary summary={action.request.sharedSummary} />}
      {action.record && (
        <Rows>
          <Row label="Exact request">{action.record.uuid}</Row>
          <Row label="Exact company">{action.record.company}</Row>
          <Row label="Request digest">{action.record.digest}</Row>
        </Rows>
      )}
      {action.appointment && <p className="break-all text-sm">Selected appointment: {action.appointment}</p>}
      {action.outcome && (
        <Rows>
          <Row label="Exact decision outcome">{action.outcome}</Row>
          <Row label="Exact decision expiry">{action.expiresAt ?? 'No acceptance expiry'}</Row>
        </Rows>
      )}
      {action.reason && <p className="whitespace-pre-wrap text-sm">Reason: {action.reason}</p>}
      <p className="break-all text-sm text-text-muted">Request key: {action.key}</p>
      {(action.request || action.decision) && (
        <p className="break-all text-sm text-text-muted">
          Preview digest: {action.request?.previewDigest ?? action.decision?.previewDigest}
        </p>
      )}
      {unmet.length > 0 && (
        <ul aria-label="Unmet requirements" className="list-disc pl-5 text-sm text-text-muted">
          {unmet.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {action.uncertain && (
        <p role="status">
          The previous outcome is uncertain. Retry this identical action and key to recover the retained result.
        </p>
      )}
      {action.kind === 'request' ? (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={sharing}
              disabled={busy}
              onChange={(event) => setConsent({ ...checks, sharing: event.target.checked })}
            />
            I agree to share this exact summary with this company.
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={declaration}
              disabled={busy}
              onChange={(event) => setConsent({ ...checks, declaration: event.target.checked })}
            />
            I accept the declaration shown above.
          </label>
        </>
      ) : (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(event) => setConsent({ ...checks, confirmed: event.target.checked })}
          />
          I confirm this exact{' '}
          {action.kind === 'decision'
            ? 'company decision'
            : action.kind === 'withdrawal'
              ? 'request withdrawal'
              : 'acceptance revocation'}
          .
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <PageAction
          label={busy ? 'Recording…' : label}
          primary
          disabled={busy || !can}
          onClick={() =>
            void confirm(action, {
              sharingAccepted: sharing,
              declarationAccepted: declaration,
              confirmation: confirmed,
            })
          }
        />
        <PageAction label="Close confirmation" onClick={cancel} />
      </div>
    </Section>
  );
}

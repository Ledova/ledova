import { useState } from 'react';
import type { EligibilityAction } from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { EligibilitySummary } from './EligibilitySummary';

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

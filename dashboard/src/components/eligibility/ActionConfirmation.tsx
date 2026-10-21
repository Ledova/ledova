import { useState } from 'react';
import {
  COMPANY_ELIGIBILITY_UNMET_COPY,
  refusalSentences,
  type EligibilityAction,
  formatDateTime,
  ELIGIBILITY_OUTCOME_LABELS,
  shortReference,
} from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { CheckboxField } from '@components/Field';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { EligibilitySummary } from './EligibilitySummary';

type ConfirmationProps = {
  action: EligibilityAction;
  busy: boolean;
  confirm: (
    action: EligibilityAction,
    checks: { sharingAccepted?: boolean; declarationAccepted?: boolean; confirmation?: boolean },
  ) => Promise<void>;
  cancel: () => void;
};

export function ActionConfirmation(props: ConfirmationProps) {
  return <Confirmation key={props.action.key} {...props} />;
}

function Confirmation({ action, busy, confirm, cancel }: ConfirmationProps) {
  const [consent, setConsent] = useState({ action, sharing: false, declaration: false, confirmed: false });
  const checks = consent.action === action ? consent : { action, sharing: false, declaration: false, confirmed: false };
  const { sharing, declaration, confirmed } = checks;
  const unmet = action.request?.unmetRequirements ?? action.decision?.unmetRequirements ?? [];
  const can =
    action.kind === 'request'
      ? !!action.request?.canSubmit
      : action.kind !== 'decision' || !!action.decision?.canDecide;
  const subject =
    action.kind === 'decision'
      ? 'company decision'
      : action.kind === 'withdrawal'
        ? 'request withdrawal'
        : 'acceptance revocation';
  const requesting = action.kind === 'request';
  const review = useErrorSummary<'sharing' | 'declaration' | 'confirmed'>({
    sharing: requesting && !sharing && 'Agree to share this exact summary with this company.',
    declaration: requesting && !declaration && 'Accept the declaration shown above.',
    confirmed: !requesting && !confirmed && `Confirm this exact ${subject}.`,
  });
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
      <ErrorSummary {...review.summary} />
      {action.request && <EligibilitySummary summary={action.request.sharedSummary} />}
      {action.record && (
        <Rows>
          <Row label="Request">{shortReference(action.record.uuid)}</Row>
          <Row label="Company">{shortReference(action.record.company)}</Row>
          <Row label="Request digest">{action.record.digest}</Row>
        </Rows>
      )}
      {action.appointment && (
        <p className="break-all text-sm">Selected appointment: {shortReference(action.appointment)}</p>
      )}
      {action.outcome && (
        <Rows>
          <Row label="Exact decision outcome">{ELIGIBILITY_OUTCOME_LABELS[action.outcome]}</Row>
          <Row label="Exact decision expiry">{formatDateTime(action.expiresAt, 'No acceptance expiry')}</Row>
        </Rows>
      )}
      {action.reason && <p className="whitespace-pre-wrap text-sm">Reason: {action.reason}</p>}
      <p className="break-all text-sm text-text-muted">Request key: {shortReference(action.key)}</p>
      {(action.request || action.decision) && (
        <p className="break-all text-sm text-text-muted">
          Preview digest: {action.request?.previewDigest ?? action.decision?.previewDigest}
        </p>
      )}
      {unmet.length > 0 && (
        <ul aria-label="Unmet requirements" className="list-disc pl-5 text-sm text-text-muted">
          {refusalSentences(unmet, COMPANY_ELIGIBILITY_UNMET_COPY).map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      )}
      {action.uncertain && (
        <p role="status">
          The previous outcome is uncertain. Retry this identical action and key to recover the retained result.
        </p>
      )}
      {requesting ? (
        <>
          <CheckboxField
            {...review.field('sharing')}
            label="I agree to share this exact summary with this company."
            checked={sharing}
            disabled={busy}
            onChange={(event) => setConsent({ ...checks, sharing: event.target.checked })}
          />
          <CheckboxField
            {...review.field('declaration')}
            label="I accept the declaration shown above."
            checked={declaration}
            disabled={busy}
            onChange={(event) => setConsent({ ...checks, declaration: event.target.checked })}
          />
        </>
      ) : (
        <CheckboxField
          {...review.field('confirmed')}
          label={`I confirm this exact ${subject}.`}
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConsent({ ...checks, confirmed: event.target.checked })}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <PageAction
          label={label}
          busy={busy}
          busyLabel="Recording…"
          primary={action.kind === 'request' || action.kind === 'decision'}
          destructive={action.kind === 'withdrawal' || action.kind === 'revocation'}
          disabled={!can}
          onClick={() => {
            if (review.check())
              void confirm(action, {
                sharingAccepted: sharing,
                declarationAccepted: declaration,
                confirmation: confirmed,
              });
          }}
        />
        <PageAction label="Close confirmation" onClick={cancel} />
      </div>
    </Section>
  );
}

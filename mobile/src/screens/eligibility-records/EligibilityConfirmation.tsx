import { useState } from 'react';
import { Text } from 'react-native';
import { formatDateTime, type useParticipantEligibilityRecords } from '@ledova/shared';
import { Action, Choice, Row, Rows, Section } from '../../components/Ledger';
import { useCompanyStyles } from '../company-register/styles';
import { EligibilitySummary } from './EligibilitySummary';

type Records = ReturnType<typeof useParticipantEligibilityRecords>;

export function EligibilityConfirmation({
  action,
  busy,
  confirm,
  cancel,
}: {
  action: NonNullable<Records['action']>;
  busy: boolean;
  confirm: Records['confirm'];
  cancel: () => void;
}) {
  const styles = useCompanyStyles();
  const [consents, setConsents] = useState({
    action,
    sharingAccepted: false,
    declarationAccepted: false,
    confirmation: false,
  });
  const sharingAccepted = consents.action === action && consents.sharingAccepted;
  const declarationAccepted = consents.action === action && consents.declarationAccepted;
  const confirmation = consents.action === action && consents.confirmation;
  const toggle = (field: 'sharingAccepted' | 'declarationAccepted' | 'confirmation') =>
    setConsents((previous) => ({
      action,
      sharingAccepted,
      declarationAccepted,
      confirmation,
      [field]: previous.action !== action || !previous[field],
    }));
  const requirements = action.request?.unmetRequirements ?? action.decision?.unmetRequirements ?? [];
  const permitted =
    action.kind === 'request'
      ? action.request?.canSubmit === true
      : action.kind === 'decision'
        ? action.decision?.canDecide === true
        : true;
  const consent = action.kind === 'request' ? sharingAccepted && declarationAccepted : confirmation;
  return (
    <Section
      title={
        action.kind === 'request'
          ? 'Review sharing request'
          : action.kind === 'decision'
            ? 'Review company decision'
            : action.kind === 'withdrawal'
              ? 'Review withdrawal'
              : 'Review revocation'
      }
    >
      {action.request && <EligibilitySummary summary={action.request.sharedSummary} />}
      {action.kind === 'decision' && action.record && <EligibilitySummary summary={action.record.sharedSummary} />}
      <Rows>
        <Row label="Request key">{action.key}</Row>
        {(action.request?.previewDigest || action.decision?.previewDigest) && (
          <Row label="Preview digest">{action.request?.previewDigest ?? action.decision?.previewDigest}</Row>
        )}
      </Rows>
      {action.record && (
        <Rows>
          <Row label="Request">{action.record.uuid}</Row>
          <Row label="Company">{action.record.company}</Row>
          <Row label="Current outcome">{action.record.outcome}</Row>
        </Rows>
      )}
      {action.kind === 'decision' && (
        <Rows>
          <Row label="Decision to record">{action.outcome}</Row>
          {action.expiresAt && <Row label="Decision expiry">{formatDateTime(action.expiresAt)}</Row>}
          {action.reason && <Row label="Refusal reason">{action.reason}</Row>}
        </Rows>
      )}
      {action.appointment && (
        <Rows>
          <Row label="Your decision appointment">{action.appointment}</Row>
        </Rows>
      )}
      {action.kind === 'revocation' && action.reason && (
        <Rows>
          <Row label="Revocation reason">{action.reason}</Row>
        </Rows>
      )}
      {requirements.length > 0 && (
        <Text accessibilityRole="alert" style={styles.error}>
          {requirements.join('\n')}
        </Text>
      )}
      {action.uncertain && (
        <Text accessibilityRole="alert" style={styles.muted}>
          The outcome is unconfirmed. Retry this same review to recover the retained result, or refresh the records.
        </Text>
      )}
      {action.kind === 'request' ? (
        <>
          <Choice
            label="Share this exact summary with this company"
            accessibilityRole="checkbox"
            selected={sharingAccepted}
            disabled={busy}
            onPress={() => toggle('sharingAccepted')}
          />
          <Choice
            label="Confirm this exact declaration"
            accessibilityRole="checkbox"
            selected={declarationAccepted}
            disabled={busy}
            onPress={() => toggle('declarationAccepted')}
          />
        </>
      ) : (
        <Choice
          label={
            action.kind === 'decision'
              ? 'Confirm this exact company decision'
              : action.kind === 'withdrawal'
                ? 'Confirm withdrawal of this request'
                : 'Confirm revocation of this acceptance'
          }
          accessibilityRole="checkbox"
          selected={confirmation}
          disabled={busy}
          onPress={() => toggle('confirmation')}
        />
      )}
      <Action
        label={
          busy
            ? 'Recording…'
            : action.kind === 'request'
              ? 'Submit sharing request'
              : action.kind === 'decision'
                ? 'Record company decision'
                : action.kind === 'withdrawal'
                  ? 'Withdraw request'
                  : 'Revoke acceptance'
        }
        primary
        disabled={busy || !permitted || !consent}
        onPress={() => {
          if (permitted && consent && !busy)
            void confirm(action, { sharingAccepted, declarationAccepted, confirmation });
        }}
      />
      <Action label="Close review" disabled={busy} onPress={cancel} />
    </Section>
  );
}

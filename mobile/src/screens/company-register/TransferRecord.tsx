import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDate,
  formatDateTime,
  REGISTER_TRANSFER_COPY as COPY,
  REGISTER_TRANSFER_DECISIONS,
  shareCount,
  shortReference,
  type OwnCompanyAppointment,
  type RegisterStep,
  type RegisterTransfer,
  type RegisterTransferDecisionRequest,
} from '@ledova/shared';
import { Disclosure, Row, Rows, Status } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { RegisterCopy } from '../../components/register/RegisterCopy';
import { RegisterDecisions } from '../../components/register/RegisterDecisions';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { ISSUE_TONES, RecordSummary, SummaryCell, decisionRows } from './IssueSummary';
import { TransferReview } from './TransferReview';

const DECISION_COPY = { ...COPY, DECISIONS: { ...COPY.DECISIONS, approve: 'Approve', apply: 'Transfer recorded' } };

function TransferRows({ transfer }: { transfer: RegisterTransfer }) {
  return (
    <Rows>
      <Row label={COPY.FROM}>{transfer.fromName || shortReference(transfer.fromMember)}</Row>
      <Row label="Transferor residential address">{transfer.fromResidentialAddress}</Row>
      <Row label={COPY.TO}>{transfer.name || shortReference(transfer.toMember)}</Row>
      <Row label={COPY.ADDRESS}>{transfer.residentialAddress}</Row>
      <Row label="Recipient particulars">
        {transfer.newParticulars ? 'Retained from the signed instrument' : 'Existing retained particulars'}
      </Row>
      <Row label={COPY.SHARES}>{shareCount(transfer.shares)}</Row>
      <Row label={COPY.SIGNED_ON}>{formatDate(transfer.signedOn)}</Row>
      <Row label={COPY.LODGED_ON}>{formatDate(transfer.lodgedOn)}</Row>
      <Row label={COPY.COMPANY_EVENT_ON}>{formatDate(transfer.companyEventOn, 'Not recorded')}</Row>
      {!!transfer.registerEntry && !!transfer.effectiveOn && transfer.effectiveOn !== transfer.companyEventOn && (
        <Row label="Ledger date">{formatDate(transfer.effectiveOn)}</Row>
      )}
      <Row label={COPY.TERMS}>{transfer.terms}</Row>
      <Row label={COPY.DIRECTOR}>{transfer.approvingDirector}</Row>
    </Rows>
  );
}

export function TransferRecord({
  transfer,
  epoch,
  steps,
  last,
  onSettled,
  visible = true,
  guard,
  onHeldChange,
  onReviewChange,
}: {
  transfer: RegisterTransfer;
  epoch: number;
  steps: Partial<Record<RegisterStep, OwnCompanyAppointment | undefined>>;
  last: boolean;
  onSettled: () => Promise<unknown>;
  visible?: boolean;
  guard: () => void;
  onHeldChange?: (uuid: string, held: boolean) => void;
  onReviewChange: (uuid: string, open: boolean) => void;
}) {
  const styles = useCompanyStyles();
  const [details, setDetails] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const from = transfer.fromName || shortReference(transfer.fromMember);
  const to = transfer.name || shortReference(transfer.toMember);
  const description = `non-paid transfer from ${from} to ${to}, prepared ${formatDateTime(transfer.createdAt)}`;
  const family = {
    ...REGISTER_TRANSFER_DECISIONS,
    request: (request: RegisterTransferDecisionRequest): RegisterTransferDecisionRequest =>
      request.kind === 'approve'
        ? { ...request, completeTransfer: true, applyAppointment: steps.apply?.uuid ?? request.appointment }
        : request,
  };
  const reviewChanged = useCallback(
    (open: boolean) => {
      setReviewing(open);
      onReviewChange(transfer.uuid, open);
    },
    [transfer.uuid, onReviewChange],
  );
  const documents = (['authority', 'instrument'] as const).map((kind) => (
    <RegisterCopy
      key={kind}
      label={`Download ${kind} document`}
      accessibilityLabel={`Download ${kind} document of ${description}`}
      filename={`${kind}-${transfer.uuid}`}
      epoch={epoch}
      guard={guard}
      read={() => {
        const config = {
          responseType: 'arraybuffer' as const,
          ledovaSessionEpoch: epoch,
          ledovaSubmissionGuard: guard,
        };
        if (kind === 'authority')
          return apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_TRANSFER_FILE(transfer.uuid), config);
        return apiClient.get<ArrayBuffer>(
          COMPANY_TOKEN_ENDPOINTS.REGISTER_TRANSFER_INSTRUMENT_FILE(transfer.uuid),
          config,
        );
      }}
    />
  ));
  return (
    <View style={visible ? [styles.entry, last && styles.lastEntry] : undefined}>
      {visible && !reviewing && (
        <>
          <RecordSummary>
            <SummaryCell label="From">
              <Text accessibilityRole="header" style={styles.heading}>
                {from}
              </Text>
            </SummaryCell>
            <SummaryCell label="To">
              <Text style={styles.heading}>{to}</Text>
            </SummaryCell>
            <SummaryCell label="Shares">
              <Text style={styles.text}>{shareCount(transfer.shares)}</Text>
            </SummaryCell>
            <SummaryCell label="Transfer date">
              <Text style={styles.text}>{formatDate(transfer.companyEventOn, 'Not recorded')}</Text>
            </SummaryCell>
            <SummaryCell label="Status">
              <Status tone={ISSUE_TONES[transfer.stage] ?? 'waiting'}>
                {transfer.stage === 'applied'
                  ? 'Approved'
                  : transfer.stage === 'approved'
                    ? 'Ready to complete'
                    : (COPY.STAGES[transfer.stage] ?? transfer.stage)}
              </Status>
            </SummaryCell>
          </RecordSummary>
          <Disclosure
            open={details}
            onToggle={() => setDetails((value) => !value)}
            accessibilityLabel={`Details and documents for the transfer from ${from} to ${to}`}
            summary={<Text style={styles.muted}>Details and documents</Text>}
          >
            <Rows>
              <Row label="Stage">{COPY.STAGES[transfer.stage] ?? transfer.stage}</Row>
              <Row label="Prepared by">{transfer.preparedByName || 'Name not recorded'}</Row>
              <Row label="Prepared on">{formatDateTime(transfer.createdAt)}</Row>
              <Row label={COPY.AUTHORITY_REFERENCE}>{transfer.authorityReference}</Row>
              <Row label={COPY.REASON}>{transfer.reason}</Row>
              {decisionRows(transfer, DECISION_COPY.DECISIONS)}
              {!!transfer.registerEntry && <Row label="Register entry">{shortReference(transfer.registerEntry)}</Row>}
            </Rows>
            <TransferRows transfer={transfer} />
            <Text style={styles.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
            {documents}
          </Disclosure>
        </>
      )}
      <RegisterDecisions
        family={family}
        copy={DECISION_COPY}
        proposal={transfer}
        steps={{ ...steps, apply: undefined }}
        epoch={epoch}
        readGuard={guard}
        newEffectGuard={(kind) => {
          guard();
          if (kind === 'approve' && !steps.apply)
            throw new Error('Company authority to record share transfers is required.');
        }}
        description={description}
        onDecided={onSettled}
        onRefused={onSettled}
        visible={visible}
        onHeldChange={onHeldChange}
        approveLabel="Review and approve"
        review={{
          onChange: reviewChanged,
          labels: { approve: 'Approve', apply: 'Approve', reject: 'Reject transfer' },
        }}
      >
        {(preview, kind) => (
          <TransferReview
            preview={preview}
            proposal={transfer}
            documents={documents}
            showOwnership={kind !== 'reject'}
          />
        )}
      </RegisterDecisions>
    </View>
  );
}

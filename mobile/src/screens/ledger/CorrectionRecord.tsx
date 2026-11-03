import { useCallback } from 'react';
import { Text, View } from 'react-native';
import {
  REGISTER_COPY,
  REGISTER_CORRECTION_COPY as COPY,
  REGISTER_CORRECTION_DECISIONS,
  STAGE_TONES,
  apiErrorSentence,
  describeEntry,
  entryLabel,
  entryName,
  formatDate,
  formatDateTime,
  formatRegisterChanges,
  useCorrectionRecordDownload,
  type ClassCorrection,
  type RegisterDecisionKind,
  type RegisterSteps,
} from '@ledova/shared';
import { Action, Fact, Outcome, Rows, Status } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { RecordShell, decisionTrail } from './IssueRecord';
import { RegisterDecisions } from './RegisterDecisions';
import { useLedgerStyles } from './useLedgerStyles';

type Changes = Parameters<typeof formatRegisterChanges>[0];

const TITLES: Record<RegisterDecisionKind, string> = {
  approve: `${COPY.DECISIONS.approve} correction`,
  apply: `${COPY.DECISIONS.apply} correction`,
  reject: `${COPY.DECISIONS.reject} correction`,
};

export function RegisterChanges({ changes, named, lead }: { changes: Changes; named?: Changes; lead?: string }) {
  const look = useLedgerStyles();
  return (
    <View>
      {!!lead && <Text style={look.text}>{lead}</Text>}
      {formatRegisterChanges(changes, named).map((line, index) => (
        <Text key={index} style={look.text}>
          {line}
        </Text>
      ))}
    </View>
  );
}

export function CorrectionRecord({
  correction: { proposal, entry },
  steps,
  guard,
  onSettled,
  visible,
  onHeldChange,
  focusKey,
  onFocus,
  outcome,
  reviewing,
  onReviewChange,
  ruled,
}: {
  correction: ClassCorrection;
  steps: RegisterSteps;
  guard: () => void;
  onSettled: () => Promise<unknown>;
  visible: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
  focusKey?: string;
  onFocus?: (record: View) => void;
  outcome?: string;
  reviewing: string | null;
  onReviewChange: (uuid: string, open: boolean) => void;
  ruled: boolean;
}) {
  const look = useLedgerStyles();
  const styles = useCompanyStyles();
  const download = useCorrectionRecordDownload(proposal, guard, SHARE_SHEET_FILES, orderSubmissionSession);
  const context = `correction of the ${entryLabel(entry)}`;
  const reviewChanged = useCallback(
    (open: boolean) => onReviewChange(proposal.uuid, open),
    [proposal.uuid, onReviewChange],
  );
  const inReview = reviewing === proposal.uuid;
  const downloadLabel = download.isPending ? 'Downloading…' : COPY.DOWNLOAD;
  return (
    <RecordShell
      hidden={!visible || (!!reviewing && !inReview)}
      ruled={ruled && !reviewing}
      focusKey={focusKey}
      onFocus={onFocus}
    >
      {visible && (
        <View style={[look.summary, inReview && look.hidden]}>
          {!!outcome && <Outcome>{outcome}</Outcome>}
          <Text accessibilityRole="header" style={look.title}>
            {`Correction of the ${entryName(entry)}`}
          </Text>
          <Rows>
            <Fact label="Stage">
              <Status tone={STAGE_TONES[proposal.stage] ?? 'waiting'}>
                {COPY.STAGES[proposal.stage] ?? proposal.stage}
              </Status>
            </Fact>
            {proposal.preparedByName !== null && (
              <Fact label="Prepared by">{proposal.preparedByName || 'Not provided'}</Fact>
            )}
            <Fact label="Prepared on">{formatDateTime(proposal.createdAt)}</Fact>
            <Fact label={COPY.EFFECTIVE_ON}>{formatDate(proposal.effectiveOn)}</Fact>
            <Fact label={COPY.ORIGINAL_CHANGES}>
              <RegisterChanges lead={describeEntry(entry)} changes={entry.changes} />
            </Fact>
            <Fact label={COPY.COMPENSATING_CHANGES}>
              <RegisterChanges changes={proposal.changes} named={entry.changes} />
            </Fact>
            <Fact label={COPY.AUTHORITY}>{COPY.AUTHORITIES[proposal.authority] ?? proposal.authority}</Fact>
            {!!proposal.approvingDirector && <Fact label={COPY.APPROVING_DIRECTOR}>{proposal.approvingDirector}</Fact>}
            <Fact label={COPY.AUTHORITY_REFERENCE}>{proposal.authorityReference}</Fact>
            <Fact label={COPY.REASON}>{proposal.reason}</Fact>
            <Fact label="Evidence">
              {proposal.providedBy === 'company' ? COPY.PROVIDED_BY_COMPANY : COPY.STAFF_VERIFIED}
            </Fact>
            {decisionTrail(proposal, COPY.DECISIONS)}
          </Rows>
        </View>
      )}
      <RegisterDecisions
        approveLabel={COPY.DECISIONS.approve}
        family={REGISTER_CORRECTION_DECISIONS}
        copy={COPY}
        proposal={proposal}
        steps={steps}
        guard={guard}
        context={context}
        onDecided={onSettled}
        onRefused={onSettled}
        visible={visible}
        onHeldChange={onHeldChange}
        leadingAction={
          <Action
            label={downloadLabel}
            accessibilityLabel={`${downloadLabel} (${context})`}
            disabled={download.isPending}
            onPress={() => download.mutate()}
          />
        }
        note={(kind) => kind === 'apply' && <Text style={look.muted}>{COPY.COMPENSATION_NOTE}</Text>}
        review={{ onChange: reviewChanged, title: TITLES, labels: TITLES, confirmations: COPY.CONFIRMATIONS }}
      >
        {(preview) => (
          <Rows>
            <Fact label={COPY.EFFECTIVE_ON}>{formatDate(preview.effectiveOn)}</Fact>
            <Fact label={COPY.ORIGINAL_CHANGES}>
              <RegisterChanges changes={preview.originalChanges} named={entry.changes} />
            </Fact>
            <Fact label={COPY.COMPENSATING_CHANGES}>
              <RegisterChanges changes={preview.changes} named={entry.changes} />
            </Fact>
          </Rows>
        )}
      </RegisterDecisions>
      {visible && !inReview && download.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {apiErrorSentence(download.error, REGISTER_COPY.DOWNLOAD_FAILED, REGISTER_COPY.DOWNLOAD_FAILED)}
        </Text>
      )}
    </RecordShell>
  );
}

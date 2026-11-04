import { useCallback } from 'react';
import { Text, View } from 'react-native';
import {
  REGISTER_COPY,
  REGISTER_IMPORT_COPY as COPY,
  REGISTER_IMPORT_DECISIONS,
  REGISTER_MEMBER_DOCUMENT_CATEGORIES,
  STAGE_TONES,
  apiErrorSentence,
  formatDate,
  formatDateTime,
  formatShareCount,
  formatShortDate,
  importFigures,
  registerImportTotals,
  shareCount,
  sharePercentage,
  useImportRecordDownload,
  type RegisterDecisionKind,
  type RegisterImport,
  type RegisterImportDecisionPreview,
  type RegisterImportMemberRow,
  type RegisterSteps,
} from '@ledova/shared';
import { Action, Fact, Rows, ShowMore, Status } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { RecordShell, RecordSummary, decisionTrail } from './IssueRecord';
import { RegisterDecisions } from './RegisterDecisions';
import { useLedgerStyles } from './useLedgerStyles';

const TITLES: Record<RegisterDecisionKind, string> = {
  approve: `${COPY.DECISIONS.approve} import`,
  apply: `${COPY.DECISIONS.apply} import`,
  reject: `${COPY.DECISIONS.reject} import`,
};

export function MemberRecords({ members }: { members: RegisterImportMemberRow[] }) {
  const look = useLedgerStyles();
  const total = registerImportTotals(members).total;
  return (
    <View accessibilityLabel="Shareholders">
      {members.map((member, index) => (
        <View key={member.member} style={[look.summary, look.row, index > 0 && look.ruled]}>
          <View style={look.terms}>
            <Text style={look.title}>{member.name}</Text>
            <Text style={look.muted}>{member.residentialAddress}</Text>
          </View>
          <Rows>
            <Fact label="Shares held">{formatShareCount(member.shares)}</Fact>
            <Fact label="% of class">
              {/^\d+$/.test(member.shares) ? sharePercentage(member.shares, total) : 'Not recorded'}
            </Fact>
            <Fact label="Date added">{formatDate(member.enteredOn, '—')}</Fact>
          </Rows>
          <ShowMore show="Show allotments" hide="Hide allotments">
            {member.allotments?.length ? (
              member.allotments.map((allotment, number) => (
                <View key={number} style={[look.summary, look.ruled]}>
                  <Text accessibilityRole="header" style={look.title}>
                    {`Allotment ${number + 1}`}
                  </Text>
                  <Rows>
                    <Fact label="Allotment date">{formatDate(allotment.allottedOn, '—')}</Fact>
                    <Fact label="Shares in allotment">{formatShareCount(allotment.shares)}</Fact>
                    <Fact label="Amount paid">{allotment.amountPaid}</Fact>
                    <Fact label="Amount unpaid">{allotment.amountUnpaid}</Fact>
                    <Fact label="Payment status">{allotment.fullyPaid ? 'Fully paid' : 'Not fully paid'}</Fact>
                    <Fact label="Held for someone else?">
                      {allotment.beneficiallyHeld === null ? 'Not recorded' : allotment.beneficiallyHeld ? 'No' : 'Yes'}
                    </Fact>
                    {!!allotment.shareReference && <Fact label="Share reference">{allotment.shareReference}</Fact>}
                    {!!allotment.certificateReference && (
                      <Fact label="Certificate reference">{allotment.certificateReference}</Fact>
                    )}
                  </Rows>
                </View>
              ))
            ) : (
              <Text style={look.muted}>
                {member.allotments
                  ? 'No allotment history recorded.'
                  : 'Allotment particulars were not captured in this earlier snapshot.'}
              </Text>
            )}
            {!!member.documents?.length && (
              <View style={[look.summary, look.ruled]}>
                <Text accessibilityRole="header" style={look.title}>
                  Documents
                </Text>
                {member.documents.map((document) => (
                  <View key={document.evidence} style={look.terms}>
                    <Text style={look.text}>{document.snapshot?.name || 'Retained supporting document'}</Text>
                    <Text style={look.small}>{REGISTER_MEMBER_DOCUMENT_CATEGORIES[document.category]}</Text>
                  </View>
                ))}
              </View>
            )}
          </ShowMore>
        </View>
      ))}
    </View>
  );
}

export function ImportPreview({ preview }: { preview: RegisterImportDecisionPreview }) {
  const look = useLedgerStyles();
  const stated = importFigures(preview.statedTotal, preview.statedMemberCount);
  return (
    <>
      {!!stated && <Text style={look.text}>{stated}</Text>}
      <Text style={look.text}>
        {COPY.IMPORTED_FIGURES(formatShareCount(preview.importedTotal), preview.importedMemberCount)}
      </Text>
      <Text accessibilityRole="header" style={look.title}>
        Members compared with the stored ledger
      </Text>
      <View>
        {preview.comparison.map((row, index) => (
          <View key={row.member} style={index > 0 && look.ruled}>
            <Rows>
              <Fact label="Imported name">{row.name ?? 'Not in the import'}</Fact>
              <Fact label="Imported shares">
                {row.imported === null ? 'Not in the import' : formatShareCount(row.imported)}
              </Fact>
              <Fact label="Stored shares">{row.stored === null ? 'Not stored' : formatShareCount(row.stored)}</Fact>
              <Fact label="Imported date entered">{formatDate(row.importedEnteredOn, 'Not in the import')}</Fact>
              <Fact label="Stored date entered">{formatDate(row.enteredOn, 'Not stored')}</Fact>
              <Fact label="Live name">{row.liveName ?? 'No live identity'}</Fact>
              {!!row.liveAddress && <Fact label="Live address">{row.liveAddress}</Fact>}
              <Fact label="Wallets">{row.wallets.length > 0 ? row.wallets.join(', ') : REGISTER_COPY.NO_WALLET}</Fact>
            </Rows>
          </View>
        ))}
      </View>
    </>
  );
}

export function ImportRecord({
  proposal,
  steps,
  guard,
  visible,
  ruled,
  reviewing,
  onReviewChange,
  onHeldChange,
  onDecided,
  onRefused,
}: {
  proposal: RegisterImport;
  steps: RegisterSteps;
  guard: () => void;
  visible: boolean;
  ruled: boolean;
  reviewing: string | null;
  onReviewChange: (uuid: string, open: boolean) => void;
  onHeldChange?: (uuid: string, held: boolean) => void;
  onDecided: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
}) {
  const look = useLedgerStyles();
  const styles = useCompanyStyles();
  const download = useImportRecordDownload(proposal, guard, SHARE_SHEET_FILES, orderSubmissionSession);
  const totals = registerImportTotals(proposal.members);
  const stated = importFigures(proposal.asicIssuedTotal, proposal.asicMemberCount);
  const kind = proposal.correctionOf ? 'Copied opening correction' : 'Copied opening';
  const context = `${kind.toLowerCase()}, record date ${formatDate(proposal.asAt)}`;
  const reviewChanged = useCallback(
    (open: boolean) => onReviewChange(proposal.uuid, open),
    [proposal.uuid, onReviewChange],
  );
  const inReview = reviewing === proposal.uuid;
  const copies = [
    ...(proposal.registerEvidence || proposal.sourceDocument ? [['register', COPY.DOWNLOAD_REGISTER] as const] : []),
    ...(proposal.asicEvidence !== null ? [['asic', COPY.DOWNLOAD_ASIC] as const] : []),
  ];
  return (
    <RecordShell hidden={!visible || (!!reviewing && !inReview)} ruled={ruled && !reviewing}>
      {visible && (
        <View style={[look.summary, inReview && look.hidden]}>
          <RecordSummary
            name={kind}
            figure={shareCount(totals.total)}
            facts={`${formatShortDate(proposal.asAt)} · ${totals.count} ${totals.count === 1 ? 'member' : 'members'}`}
            status={
              proposal.stage === 'submitted' || proposal.stage === 'approved'
                ? {
                    tone: STAGE_TONES[proposal.stage] ?? 'waiting',
                    label: COPY.STAGES[proposal.stage] ?? proposal.stage,
                  }
                : undefined
            }
          >
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
              <Fact label="Record date">{formatDate(proposal.asAt)}</Fact>
              {!!proposal.sourceReference && <Fact label="Source record">{proposal.sourceReference}</Fact>}
              <Fact label="Reason">{proposal.reason}</Fact>
              <Fact label="Evidence">
                {proposal.providedBy === 'company' ? COPY.PROVIDED_BY_COMPANY : COPY.STAFF_VERIFIED}
              </Fact>
              {decisionTrail(proposal, COPY.TRAIL)}
            </Rows>
            {!!stated && <Text style={look.text}>{stated}</Text>}
            <Text style={look.text}>{COPY.IMPORTED_FIGURES(formatShareCount(totals.total), totals.count)}</Text>
            {totals.count > 0 && (
              <ShowMore
                show={`Show the shareholders (${totals.count})`}
                hide="Hide the shareholders"
                defaultOpen={proposal.status === 'submitted'}
              >
                <MemberRecords members={proposal.members} />
              </ShowMore>
            )}
            {copies.length > 0 && (
              <View style={look.wrap}>
                {copies.map(([copy, label]) => {
                  const shown = download.isPending && download.variables === copy ? 'Downloading…' : label;
                  return (
                    <Action
                      key={copy}
                      label={shown}
                      accessibilityLabel={`${shown} (${context})`}
                      disabled={download.isPending}
                      onPress={() => download.mutate(copy)}
                    />
                  );
                })}
              </View>
            )}
            {download.isError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {apiErrorSentence(download.error, REGISTER_COPY.DOWNLOAD_FAILED, REGISTER_COPY.DOWNLOAD_FAILED)}
              </Text>
            )}
          </RecordSummary>
        </View>
      )}
      <RegisterDecisions
        approveLabel={COPY.DECISIONS.approve}
        family={REGISTER_IMPORT_DECISIONS}
        copy={COPY}
        proposal={proposal}
        steps={steps}
        guard={guard}
        context={context}
        onDecided={onDecided}
        onRefused={onRefused}
        visible={visible}
        onHeldChange={onHeldChange}
        note={(decision, preview) =>
          decision === 'apply' && preview.opensRegister && <Text style={look.muted}>{COPY.NOT_ON_CHAIN_NOTE}</Text>
        }
        review={{ onChange: reviewChanged, title: TITLES, labels: TITLES, confirmations: COPY.CONFIRMATIONS }}
      >
        {(preview) => <ImportPreview preview={preview} />}
      </RegisterDecisions>
    </RecordShell>
  );
}

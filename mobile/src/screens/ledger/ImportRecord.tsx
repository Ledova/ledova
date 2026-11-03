import { Text, View } from 'react-native';
import {
  REGISTER_COPY,
  REGISTER_IMPORT_COPY as COPY,
  REGISTER_MEMBER_DOCUMENT_CATEGORIES,
  STAGE_TONES,
  apiErrorSentence,
  formatDate,
  formatDateTime,
  formatShareCount,
  registerImportTotals,
  sharePercentage,
  useImportRecordDownload,
  type RegisterImport,
  type RegisterImportMemberRow,
} from '@ledova/shared';
import { Action, Fact, FormActions, Rows, ShowMore, Status } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { RecordShell, decisionTrail } from './IssueRecord';
import { useLedgerStyles } from './useLedgerStyles';

function MemberRecords({ members }: { members: RegisterImportMemberRow[] }) {
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

export function ImportRecord({
  proposal,
  guard,
  visible,
  ruled,
}: {
  proposal: RegisterImport;
  guard: () => void;
  visible: boolean;
  ruled: boolean;
}) {
  const look = useLedgerStyles();
  const styles = useCompanyStyles();
  const download = useImportRecordDownload(proposal, guard, SHARE_SHEET_FILES, orderSubmissionSession);
  const totals = registerImportTotals(proposal.members);
  const copies = [
    ...(proposal.registerEvidence || proposal.sourceDocument ? [['register', COPY.DOWNLOAD_REGISTER] as const] : []),
    ...(proposal.asicEvidence !== null ? [['asic', COPY.DOWNLOAD_ASIC] as const] : []),
  ];
  return (
    <RecordShell hidden={!visible} ruled={ruled}>
      {visible && (
        <>
          <Text accessibilityRole="header" style={look.title}>
            {proposal.correctionOf ? 'Copied opening correction' : 'Copied opening'}
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
            <Fact label="Record date">{formatDate(proposal.asAt)}</Fact>
            {!!proposal.sourceReference && <Fact label="Source record">{proposal.sourceReference}</Fact>}
            <Fact label="Reason">{proposal.reason}</Fact>
            <Fact label="Evidence">
              {proposal.providedBy === 'company' ? COPY.PROVIDED_BY_COMPANY : COPY.STAFF_VERIFIED}
            </Fact>
            {decisionTrail(proposal, COPY.TRAIL)}
          </Rows>
          {(proposal.asicIssuedTotal !== null || proposal.asicMemberCount !== null) && (
            <Text style={look.text}>
              {proposal.asicIssuedTotal === null
                ? COPY.STATED_COUNT(proposal.asicMemberCount!)
                : proposal.asicMemberCount === null
                  ? COPY.STATED_TOTAL(formatShareCount(proposal.asicIssuedTotal))
                  : COPY.STATED_FIGURES(formatShareCount(proposal.asicIssuedTotal), proposal.asicMemberCount)}
            </Text>
          )}
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
            <FormActions>
              {copies.map(([copy, label]) => (
                <Action
                  key={copy}
                  label={download.isPending && download.variables === copy ? 'Downloading…' : label}
                  disabled={download.isPending}
                  onPress={() => download.mutate(copy)}
                />
              ))}
            </FormActions>
          )}
          {download.isError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {apiErrorSentence(download.error, REGISTER_COPY.DOWNLOAD_FAILED, REGISTER_COPY.DOWNLOAD_FAILED)}
            </Text>
          )}
        </>
      )}
    </RecordShell>
  );
}

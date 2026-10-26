import { RecordShell, RecordDownloadFailure, RecordStage } from './RecordShell';
import { useRegisterTaskGuard } from './useRegisterTaskGuard';
import {
  REGISTER_COPY,
  REGISTER_IMPORT_COPY,
  REGISTER_IMPORT_DECISIONS,
  formatDate,
  formatDateTime,
  formatShareCount,
  registerImportTotals,
  shortReference,
  type RegisterImport,
  type RegisterImportDecisionPreview,
} from '@ledova/shared';
import { Row, Rows, Disclosure } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { DecisionTrail } from '@pages/company/ledger/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { type RegisterSteps } from '@pages/company/shared/proposals';
import { MemberRecords } from '@pages/company/ledger/shared/MemberRecords';
import { useImportRecordDownload } from './useRegisterRecordDownload';

function ImportPreview({ preview }: { preview: RegisterImportDecisionPreview }) {
  return (
    <>
      {(preview.statedTotal !== null || preview.statedMemberCount !== null) && (
        <p className="text-sm text-text-primary">
          {preview.statedTotal === null
            ? REGISTER_IMPORT_COPY.STATED_COUNT(preview.statedMemberCount!)
            : preview.statedMemberCount === null
              ? REGISTER_IMPORT_COPY.STATED_TOTAL(formatShareCount(preview.statedTotal))
              : REGISTER_IMPORT_COPY.STATED_FIGURES(formatShareCount(preview.statedTotal), preview.statedMemberCount)}
        </p>
      )}
      <p className="text-sm text-text-primary">
        {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(preview.importedTotal), preview.importedMemberCount)}
      </p>
      <h3 className="text-sm font-medium text-text-primary">Members compared with the stored ledger</h3>
      <ul className="divide-y divide-border-subtle">
        {preview.comparison.map((row) => (
          <li key={row.member} className="py-2">
            <Rows>
              <Row label="Imported name">{row.name ?? 'Not in the import'}</Row>
              <Row label="Imported shares">
                <span className="break-all">
                  {row.imported === null ? 'Not in the import' : formatShareCount(row.imported)}
                </span>
              </Row>
              <Row label="Stored shares">
                <span className="break-all">{row.stored === null ? 'Not stored' : formatShareCount(row.stored)}</span>
              </Row>
              <Row label="Imported date entered">{formatDate(row.importedEnteredOn, 'Not in the import')}</Row>
              <Row label="Stored date entered">{formatDate(row.enteredOn, 'Not stored')}</Row>
              <Row label="Live name">{row.liveName ?? 'No live identity'}</Row>
              {row.liveAddress && <Row label="Live address">{row.liveAddress}</Row>}
              <Row label="Wallets">
                <span className="break-all">
                  {row.wallets.length > 0 ? row.wallets.join(', ') : REGISTER_COPY.NO_WALLET}
                </span>
              </Row>
            </Rows>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ImportRecord({
  proposal,
  steps,
  guard,
  onDecided,
  onRefused,
  visible = true,
  onHeldChange,
}: {
  proposal: RegisterImport;
  steps: RegisterSteps;
  guard: () => void;
  onDecided: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
}) {
  const check = useRegisterTaskGuard(visible, guard);
  const download = useImportRecordDownload(proposal, check);
  const totals = registerImportTotals(proposal.members);
  const downloadActions = (
    <>
      {(proposal.registerEvidence || proposal.sourceDocument) && (
        <PageAction
          label={REGISTER_IMPORT_COPY.DOWNLOAD_REGISTER}
          busy={download.isPending && download.variables === 'register'}
          busyLabel="Downloading…"
          disabled={download.isPending}
          onClick={() => download.mutate('register')}
        />
      )}
      {proposal.asicEvidence !== null && (
        <PageAction
          label={REGISTER_IMPORT_COPY.DOWNLOAD_ASIC}
          busy={download.isPending && download.variables === 'asic'}
          busyLabel="Downloading…"
          disabled={download.isPending}
          onClick={() => download.mutate('asic')}
        />
      )}
    </>
  );
  return (
    <RecordShell hidden={!visible}>
      {visible && (
        <Disclosure
          summary={`${proposal.correctionOf ? 'Copied opening correction' : 'Copied opening'} · ${formatDate(proposal.asAt)} · ${REGISTER_IMPORT_COPY.STAGES[proposal.stage] ?? proposal.stage}`}
          defaultOpen={proposal.status === 'submitted'}
        >
          <Rows>
            <RecordStage stage={proposal.stage}>
              {REGISTER_IMPORT_COPY.STAGES[proposal.stage] ?? proposal.stage}
            </RecordStage>
            {proposal.preparedByName !== null && (
              <Row label="Prepared by">{proposal.preparedByName || 'Not provided'}</Row>
            )}
            <Row label="Prepared on">{formatDateTime(proposal.createdAt)}</Row>
            <Row label="Record date">{formatDate(proposal.asAt)}</Row>
            {proposal.sourceReference && <Row label="Source record">{proposal.sourceReference}</Row>}
            {proposal.correctionOf && (
              <Row label="Corrects copied opening">{shortReference(proposal.correctionOf)}</Row>
            )}
            <Row label="Reason">{proposal.reason}</Row>
            <DecisionTrail proposal={proposal} labels={REGISTER_IMPORT_COPY.DECISIONS} />
          </Rows>
          <p className="text-sm text-text-muted">
            {proposal.providedBy === 'company'
              ? REGISTER_IMPORT_COPY.PROVIDED_BY_COMPANY
              : REGISTER_IMPORT_COPY.STAFF_VERIFIED}
          </p>
          {(proposal.asicIssuedTotal !== null || proposal.asicMemberCount !== null) && (
            <p className="text-sm text-text-primary">
              {proposal.asicIssuedTotal === null
                ? REGISTER_IMPORT_COPY.STATED_COUNT(proposal.asicMemberCount!)
                : proposal.asicMemberCount === null
                  ? REGISTER_IMPORT_COPY.STATED_TOTAL(formatShareCount(proposal.asicIssuedTotal))
                  : REGISTER_IMPORT_COPY.STATED_FIGURES(
                      formatShareCount(proposal.asicIssuedTotal),
                      proposal.asicMemberCount,
                    )}
            </p>
          )}
          <p className="text-sm text-text-primary">
            {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(totals.total), totals.count)}
          </p>
          <MemberRecords members={proposal.members} />
        </Disclosure>
      )}
      <FormActions>
        {downloadActions}
        <RegisterDecisions
          family={REGISTER_IMPORT_DECISIONS}
          copy={REGISTER_IMPORT_COPY}
          noun="import"
          proposal={proposal}
          steps={steps}
          guard={guard}
          newEffectGuard={check}
          visible={visible}
          onHeldChange={onHeldChange}
          onDecided={onDecided}
          onRefused={onRefused}
          note={(kind, preview) =>
            kind === 'apply' &&
            preview.opensRegister && <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.NOT_ON_CHAIN_NOTE}</p>
          }
        >
          {(preview) => <ImportPreview preview={preview} />}
        </RegisterDecisions>
      </FormActions>
      {download.isError && <RecordDownloadFailure error={download.error} />}
    </RecordShell>
  );
}

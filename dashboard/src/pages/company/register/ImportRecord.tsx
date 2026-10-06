import { useMutation } from '@tanstack/react-query';
import {
  REGISTER_COPY,
  REGISTER_IMPORT_COPY,
  REGISTER_IMPORT_DECISIONS,
  apiErrorSentence,
  downloadRegisterImportFile,
  formatDateTime,
  formatShareCount,
  registerImportTotals,
  type RegisterImport,
  type RegisterImportDecisionPreview,
} from '@ledova/shared';
import { Row, Rows, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { DecisionTrail } from './DecisionTrail';
import { RegisterDecisions } from './RegisterDecisions';
import { DOWNLOAD_FAILED, STAGE_TONES, retainedName, type RegisterSteps } from './proposals';
import { saveFile } from './useCompanyRegister';

function ImportPreview({ preview }: { preview: RegisterImportDecisionPreview }) {
  return (
    <>
      {preview.statedTotal !== null && preview.statedMemberCount !== null && (
        <p className="text-sm text-text-primary">
          {REGISTER_IMPORT_COPY.STATED_FIGURES(formatShareCount(preview.statedTotal), preview.statedMemberCount)}
        </p>
      )}
      <p className="text-sm text-text-primary">
        {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(preview.importedTotal), preview.importedMemberCount)}
      </p>
      <h3 className="text-sm font-medium text-text-primary">Members compared with the stored register</h3>
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
              <Row label="Imported date entered">{row.importedEnteredOn ?? 'Not in the import'}</Row>
              <Row label="Stored date entered">{row.enteredOn ?? 'Not stored'}</Row>
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
}: {
  proposal: RegisterImport;
  steps: RegisterSteps;
  guard: () => void;
  onDecided: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
}) {
  const download = useMutation({
    mutationFn: async (copy: 'register' | 'asic') => {
      guard();
      const { data } = await downloadRegisterImportFile(apiClient, proposal.uuid, copy, {
        ledovaSubmissionGuard: guard,
      });
      guard();
      saveFile(
        data,
        copy === 'asic'
          ? retainedName(proposal.asicSnapshot, `asic-extract-${proposal.uuid}`)
          : retainedName(proposal.evidenceSnapshot, `register-import-${proposal.uuid}`),
      );
    },
  });
  const totals = registerImportTotals(proposal.members);
  return (
    <li className="flex flex-col gap-3 py-4">
      <Rows>
        <Row label="Stage">
          <Status tone={STAGE_TONES[proposal.stage] ?? 'waiting'}>
            {REGISTER_IMPORT_COPY.STAGES[proposal.stage] ?? proposal.stage}
          </Status>
        </Row>
        {proposal.preparedByName !== null && <Row label="Prepared by">{proposal.preparedByName || 'Not provided'}</Row>}
        <Row label="Prepared on">{formatDateTime(proposal.createdAt)}</Row>
        <Row label="Register date">{proposal.asAt}</Row>
        <DecisionTrail proposal={proposal} labels={REGISTER_IMPORT_COPY.DECISIONS} />
      </Rows>
      <p className="text-sm text-text-muted">
        {proposal.providedBy === 'company'
          ? REGISTER_IMPORT_COPY.PROVIDED_BY_COMPANY
          : REGISTER_IMPORT_COPY.STAFF_VERIFIED}
      </p>
      {proposal.asicIssuedTotal !== null && proposal.asicMemberCount !== null && (
        <p className="text-sm text-text-primary">
          {REGISTER_IMPORT_COPY.STATED_FIGURES(formatShareCount(proposal.asicIssuedTotal), proposal.asicMemberCount)}
        </p>
      )}
      <p className="text-sm text-text-primary">
        {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(totals.total), totals.count)}
      </p>
      <div className="flex flex-wrap gap-2">
        <PageAction
          label={REGISTER_IMPORT_COPY.DOWNLOAD_REGISTER}
          disabled={download.isPending}
          onClick={() => download.mutate('register')}
        />
        {proposal.asicEvidence !== null && (
          <PageAction
            label={REGISTER_IMPORT_COPY.DOWNLOAD_ASIC}
            disabled={download.isPending}
            onClick={() => download.mutate('asic')}
          />
        )}
      </div>
      {download.isError && (
        <p role="alert" className="text-sm text-error-light">
          {apiErrorSentence(download.error, DOWNLOAD_FAILED, DOWNLOAD_FAILED)}
        </p>
      )}
      <RegisterDecisions
        family={REGISTER_IMPORT_DECISIONS}
        copy={REGISTER_IMPORT_COPY}
        noun="import"
        proposal={proposal}
        steps={steps}
        guard={guard}
        onDecided={onDecided}
        onRefused={onRefused}
        note={(kind, preview) =>
          kind === 'apply' &&
          preview.opensRegister && <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.NOT_ON_CHAIN_NOTE}</p>
        }
      >
        {(preview) => <ImportPreview preview={preview} />}
      </RegisterDecisions>
    </li>
  );
}

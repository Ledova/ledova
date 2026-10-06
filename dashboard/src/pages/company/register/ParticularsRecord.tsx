import { useMutation } from '@tanstack/react-query';
import {
  REGISTER_PARTICULARS_COPY,
  REGISTER_PARTICULARS_DECISIONS,
  apiErrorSentence,
  downloadRegisterParticularsChangeFile,
  formatDateTime,
  type RegisterParticularsChange,
} from '@ledova/shared';
import { Row, Rows, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { DecisionTrail } from './DecisionTrail';
import { RegisterDecisions } from './RegisterDecisions';
import { DOWNLOAD_FAILED, STAGE_TONES, retainedName, type RegisterSteps } from './proposals';
import { saveFile } from './useCompanyRegister';

const COPY = REGISTER_PARTICULARS_COPY;

type Held = { name: string; residentialAddress: string; asAt: string };

function Particulars({ title, held }: { title: string; held: Held | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-sm text-text-muted">{title}</p>
      {held ? (
        <Rows>
          <Row label={COPY.NAME}>{held.name}</Row>
          <Row label={COPY.RESIDENTIAL_ADDRESS}>{held.residentialAddress}</Row>
          <Row label={COPY.AS_AT}>{held.asAt}</Row>
        </Rows>
      ) : (
        <p className="text-sm text-text-primary">{COPY.NO_CURRENT_PARTICULARS}</p>
      )}
    </div>
  );
}

export function ParticularsRecord({
  change,
  member,
  steps,
  guard,
  onDecided,
  onRefused,
}: {
  change: RegisterParticularsChange;
  member: string;
  steps: RegisterSteps;
  guard: () => void;
  onDecided: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
}) {
  const download = useMutation({
    mutationFn: async () => {
      guard();
      const { data } = await downloadRegisterParticularsChangeFile(apiClient, change.uuid, {
        ledovaSubmissionGuard: guard,
      });
      guard();
      saveFile(data, retainedName(change.evidenceSnapshot, `particulars-change-${change.uuid}`));
    },
  });
  const context = `change for ${member} prepared ${formatDateTime(change.createdAt)}`;
  return (
    <li className="flex flex-col gap-3 py-4">
      <Rows>
        <Row label={COPY.MEMBER}>{member}</Row>
        <Row label="Stage">
          <Status tone={STAGE_TONES[change.stage] ?? 'waiting'}>{COPY.STAGES[change.stage] ?? change.stage}</Status>
        </Row>
        {change.preparedByName !== null && <Row label="Prepared by">{change.preparedByName || 'Not provided'}</Row>}
        <Row label="Prepared on">{formatDateTime(change.createdAt)}</Row>
      </Rows>
      <Particulars title={COPY.PROPOSED_PARTICULARS} held={change} />
      <Rows>
        <Row label={COPY.REASON}>{change.reason}</Row>
        <DecisionTrail proposal={change} labels={COPY.DECISIONS} />
      </Rows>
      <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
      <div className="flex flex-wrap gap-2">
        <PageAction
          label={COPY.DOWNLOAD}
          context={context}
          disabled={download.isPending}
          onClick={() => download.mutate()}
        />
      </div>
      {download.isError && (
        <p role="alert" className="text-sm text-error-light">
          {apiErrorSentence(download.error, DOWNLOAD_FAILED, DOWNLOAD_FAILED)}
        </p>
      )}
      <RegisterDecisions
        family={REGISTER_PARTICULARS_DECISIONS}
        copy={COPY}
        noun="particulars change"
        proposal={change}
        steps={steps}
        guard={guard}
        context={context}
        onDecided={onDecided}
        onRefused={onRefused}
        note={(kind) => kind !== 'reject' && <p className="text-sm text-text-muted">{COPY.PRECEDENCE_NOTE}</p>}
      >
        {(preview) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Particulars title={COPY.CURRENT_PARTICULARS} held={preview.current} />
            <Particulars title={COPY.PROPOSED_PARTICULARS} held={preview} />
          </div>
        )}
      </RegisterDecisions>
    </li>
  );
}

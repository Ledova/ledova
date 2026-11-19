import {
  classRightsTerms,
  rightsDetailsRecorded,
  rightsWithoutConditions,
  type useNewClassRights,
} from '@ledova/shared';
import { Failure, Outcome } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { RightsEditor, RightsSummary } from './ClassRights';

export function NewClassRights({
  rights,
  administrator,
  problems,
  classLocked,
  blocked,
}: {
  rights: ReturnType<typeof useNewClassRights>;
  administrator?: string;
  problems: string[];
  classLocked: boolean;
  blocked: boolean;
}) {
  const revision = rights.saved;
  const open = () => {
    if (!administrator || blocked) return;
    rights.open({
      appointment: administrator,
      previousRevision: revision?.revision ?? 0,
      attributes: rightsWithoutConditions(revision?.attributes ?? {}),
      summary: classRightsTerms(revision?.attributes ?? {}, revision?.summary ?? ''),
      effectiveDate: revision?.effectiveDate ?? '',
      documents: (revision?.documents ?? []).map((snapshot) => ({ id: snapshot.evidence, file: null, snapshot })),
    });
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-text-primary">Class rights</h3>
          {!rights.editor && !revision && <p className="text-sm text-text-muted">No rights recorded.</p>}
        </div>
        {!rights.editor && administrator && (
          <PageAction
            label={revision ? 'Edit class rights' : 'Add class rights'}
            onClick={open}
            disabled={rights.busy || blocked}
          />
        )}
      </div>
      {(rights.editor || revision) && (
        <p className="text-sm text-text-muted">Company-recorded terms. The governing documents determine the rights.</p>
      )}
      {rights.editor ? (
        <>
          {problems.map((problem) => (
            <Failure key={problem}>{problem}</Failure>
          ))}
          <RightsEditor
            rights={{ ...rights, stale: false }}
            saveLabel="Save class rights"
            saveDisabled={problems.length > 0 || !rightsDetailsRecorded(rights.editor)}
          />
        </>
      ) : (
        <>
          {revision && <RightsSummary revision={revision} />}
          <Outcome>{rights.outcome}</Outcome>
          <Failure>{rights.error}</Failure>
        </>
      )}
      {classLocked && rights.error && (
        <p className="text-sm text-text-muted">
          The original class details are kept. Retry the original save, or close this form and continue setup.
        </p>
      )}
    </div>
  );
}

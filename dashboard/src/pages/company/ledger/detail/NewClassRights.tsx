import { useEffect, useRef, type Ref, type RefObject } from 'react';
import {
  classRightsTerms,
  rightsDetailsRecorded,
  rightsWithoutConditions,
  type useNewClassRights,
} from '@ledova/shared';
import { Failure, Outcome } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { RightsEditor, RightsSummary } from './ClassRights';

export function NewClassRightsAction({
  ref,
  rights,
  administrator,
  blocked,
}: {
  ref?: Ref<HTMLButtonElement>;
  rights: ReturnType<typeof useNewClassRights>;
  administrator?: string;
  blocked: boolean;
}) {
  const revision = rights.saved;
  if (rights.editor || !administrator) return null;
  return (
    <PageAction
      ref={ref}
      label={revision ? 'Edit' : 'Add'}
      context="Class rights"
      disabled={rights.busy || blocked}
      onClick={() => {
        if (blocked) return;
        rights.open({
          appointment: administrator,
          previousRevision: revision?.revision ?? 0,
          attributes: rightsWithoutConditions(revision?.attributes ?? {}),
          summary: classRightsTerms(revision?.attributes ?? {}, revision?.summary ?? ''),
          effectiveDate: revision?.effectiveDate ?? '',
          documents: (revision?.documents ?? []).map((snapshot) => ({ id: snapshot.evidence, file: null, snapshot })),
        });
      }}
    />
  );
}

export function NewClassRights({
  rights,
  problems,
  classLocked,
  editActionRef,
}: {
  rights: ReturnType<typeof useNewClassRights>;
  problems: string[];
  classLocked: boolean;
  editActionRef: RefObject<HTMLButtonElement | null>;
}) {
  const revision = rights.saved;
  const wasEditing = useRef(false);
  useEffect(() => {
    if (rights.editor) wasEditing.current = true;
    else if (wasEditing.current && !rights.busy && !rights.pending && editActionRef.current) {
      wasEditing.current = false;
      editActionRef.current.focus();
    }
  }, [rights.editor, rights.busy, rights.pending, editActionRef]);
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-text-primary">Class rights</h3>
        {!rights.editor && !revision && <p className="text-sm text-text-muted">No rights recorded.</p>}
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

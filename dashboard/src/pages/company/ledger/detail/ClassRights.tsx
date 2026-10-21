import { useEffect, useId, useRef } from 'react';
import { FIELD_LIMITS, formatDateTime, type ClassRightsRevision } from '@ledova/shared';
import { Field, TextArea, TextInput } from '@components/Field';
import { ErrorSummary } from '@components/ErrorSummary';
import { Disclosure, LoadError, Loading, Outcome, Row, Rows, Section } from '@components/Ledger';
import { LoadMore } from '@components/List';
import { FormActions, PageAction } from '@components/Page';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useClassRights } from './useClassRights';

function RightsSummary({ revision }: { revision: ClassRightsRevision }) {
  return (
    <div className="space-y-3">
      {revision.summary ? (
        <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{revision.summary}</p>
      ) : (
        <p className="text-sm text-text-muted">No summary recorded.</p>
      )}
      {revision.documentReference && (
        <Rows>
          <Row label="Document reference">
            <span className="whitespace-pre-wrap break-words">{revision.documentReference}</span>
          </Row>
        </Rows>
      )}
      <p className="text-xs text-text-muted">
        {revision.recordedByName || 'Company administrator'} · {formatDateTime(revision.createdAt)}
      </p>
    </div>
  );
}

function RightsEditor({ rights }: { rights: ReturnType<typeof useClassRights> }) {
  const id = useId();
  const summary = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    summary.current?.focus();
  }, []);
  const editor = rights.editor!;
  const validation = useErrorSummary({
    summary:
      editor.summary.length > FIELD_LIMITS.CLASS_RIGHTS &&
      `Keep the summary within ${FIELD_LIMITS.CLASS_RIGHTS} characters.`,
    documentReference:
      editor.documentReference.length > FIELD_LIMITS.REFERENCE &&
      `Keep the document reference within ${FIELD_LIMITS.REFERENCE} characters.`,
  });
  const locked = rights.busy || rights.pending || rights.stale;
  return (
    <form
      aria-label="Edit class rights"
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (validation.check()) void rights.save();
      }}
    >
      <ErrorSummary {...validation.summary} />
      <Field label="Summary" optional {...validation.field('summary')}>
        <TextArea
          ref={summary}
          value={editor.summary}
          rows={6}
          maxLength={FIELD_LIMITS.CLASS_RIGHTS}
          disabled={locked}
          onChange={(event) => rights.setEditor({ ...editor, summary: event.target.value })}
        />
      </Field>
      <Field
        label="Document reference"
        optional
        hint="For example, the company constitution and its date. This is a reference, not an upload."
        {...validation.field('documentReference')}
      >
        <TextInput
          value={editor.documentReference}
          maxLength={FIELD_LIMITS.REFERENCE}
          disabled={locked}
          onChange={(event) => rights.setEditor({ ...editor, documentReference: event.target.value })}
        />
      </Field>
      {rights.stale && !rights.pending && (
        <p role="alert" className="text-sm text-error-light">
          The class rights or your administrator access changed. Close this form and reopen the current details.
        </p>
      )}
      {rights.error && (
        <p id={id} role="alert" className="text-sm text-error-light">
          {rights.error}
        </p>
      )}
      <FormActions>
        <PageAction label="Cancel" onClick={rights.close} disabled={rights.busy || rights.pending} />
        <PageAction
          type="submit"
          label={rights.pending ? 'Retry original save' : 'Save'}
          primary
          busy={rights.busy}
          busyLabel="Saving…"
          disabled={rights.stale && !rights.pending}
          describedBy={rights.error ? id : undefined}
        />
      </FormActions>
    </form>
  );
}

export function ClassRights({ rights }: { rights: ReturnType<typeof useClassRights> }) {
  const editAction = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (rights.editor) {
      wasEditing.current = true;
    } else if (rights.ready) {
      if (wasEditing.current) editAction.current?.focus();
      wasEditing.current = false;
    }
  }, [rights.editor, rights.ready]);
  if (!rights.tokenReady) return null;
  return (
    <Section title="Class rights">
      {rights.hasError ? (
        <LoadError retry={rights.retry} busy={rights.isRefreshing}>
          The class rights could not be loaded. They may be unavailable to this account.
        </LoadError>
      ) : !rights.ready ? (
        <Loading>Loading class rights…</Loading>
      ) : (
        <>
          <p className="text-sm text-text-muted">
            Company-supplied summary. The governing documents determine the rights.
          </p>
          {rights.editor ? (
            <RightsEditor rights={rights} />
          ) : rights.current ? (
            <RightsSummary revision={rights.current} />
          ) : (
            <p className="text-sm text-text-muted">No summary recorded.</p>
          )}
          {(rights.appointment || rights.pending) && !rights.editor && (
            <PageAction ref={editAction} label="Edit" context="Class rights" onClick={rights.open} />
          )}
          <Outcome>{rights.outcome}</Outcome>
          {!rights.editor && rights.count > 1 && (
            <Disclosure summary="Previous versions">
              <ul className="divide-y divide-border-subtle">
                {rights.revisions
                  .filter((revision) => revision.uuid !== rights.current?.uuid)
                  .map((revision) => (
                    <li key={revision.uuid} className="space-y-2 py-3">
                      <p className="text-sm font-medium text-text-primary">Version {revision.revision}</p>
                      <RightsSummary revision={revision} />
                    </li>
                  ))}
              </ul>
              <LoadMore
                noun={['version', 'versions']}
                hasMore={rights.query.hasNextPage}
                failed={rights.query.isFetchNextPageError}
                loading={rights.query.isFetchingNextPage}
                disabled={rights.query.isFetching}
                onLoad={() => void rights.query.fetchNextPage()}
              />
            </Disclosure>
          )}
        </>
      )}
    </Section>
  );
}

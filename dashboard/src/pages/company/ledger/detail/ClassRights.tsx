import { useEffect, useId, useRef } from 'react';
import { FIELD_LIMITS, formatDateTime, type ClassRightsRevision } from '@ledova/shared';
import { Field, FileField, TextArea } from '@components/Field';
import { ErrorSummary } from '@components/ErrorSummary';
import { Disclosure, LoadError, Loading, Outcome, Row, Rows, Section } from '@components/Ledger';
import { LoadMore } from '@components/List';
import { FormActions, PageAction } from '@components/Page';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useClassRights } from './useClassRights';

function RightsSummary({
  revision,
  rights,
}: {
  revision: ClassRightsRevision;
  rights: ReturnType<typeof useClassRights>;
}) {
  return (
    <div className="space-y-3">
      {revision.summary ? (
        <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{revision.summary}</p>
      ) : (
        <p className="text-sm text-text-muted">No summary recorded.</p>
      )}
      {revision.documentReference && (
        <Rows>
          <Row label="Earlier source note">
            <span className="whitespace-pre-wrap break-words">{revision.documentReference}</span>
          </Row>
        </Rows>
      )}
      {revision.documents.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-text-primary">Documents</h3>
          <ul className="divide-y divide-border-subtle">
            {revision.documents.map((document) => (
              <li key={document.evidence} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <p className="min-w-0 break-words text-sm text-text-primary">{document.name}</p>
                <PageAction
                  label="Download"
                  context={document.name}
                  busy={rights.downloading === `${revision.uuid}/${document.evidence}`}
                  busyLabel="Downloading…"
                  disabled={rights.busy}
                  onClick={() => void rights.download(revision, document)}
                />
              </li>
            ))}
          </ul>
        </div>
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
      <Field
        label="Rights summary"
        hint="Describe voting, dividends, repayment of capital and any other rights or restrictions."
        {...validation.field('summary')}
      >
        <TextArea
          ref={summary}
          value={editor.summary}
          rows={6}
          maxLength={FIELD_LIMITS.CLASS_RIGHTS}
          disabled={locked}
          onChange={(event) => rights.setEditor({ ...editor, summary: event.target.value })}
        />
      </Field>
      <fieldset disabled={locked} className="space-y-3 border-t border-border-subtle pt-4">
        <legend className="sr-only">Documents</legend>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-text-primary">Documents</h3>
          <PageAction
            label="Add document"
            disabled={locked || editor.documents.length >= 100}
            onClick={() =>
              rights.setEditor({ ...editor, documents: [...editor.documents, { id: crypto.randomUUID(), file: null }] })
            }
          />
        </div>
        {editor.documents.map((document, index) => (
          <fieldset key={document.id} className="min-w-0 space-y-3 border-t border-border-subtle pt-3">
            <legend className="sr-only">Document {index + 1}</legend>
            {document.snapshot || document.file ? (
              <p className="break-words text-sm text-text-primary">{document.snapshot?.name ?? document.file?.name}</p>
            ) : (
              <FileField
                label="File"
                onFile={(file) =>
                  rights.setEditor({
                    ...editor,
                    documents: editor.documents.map((row) => (row.id === document.id ? { ...row, file } : row)),
                  })
                }
              />
            )}
            <div className="flex justify-end">
              <PageAction
                label="Remove"
                context={`document ${index + 1}`}
                disabled={locked}
                onClick={() =>
                  rights.setEditor({ ...editor, documents: editor.documents.filter((row) => row.id !== document.id) })
                }
              />
            </div>
          </fieldset>
        ))}
      </fieldset>
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
            <RightsSummary revision={rights.current} rights={rights} />
          ) : (
            <p className="text-sm text-text-muted">No summary recorded.</p>
          )}
          {(rights.appointment || rights.pending) && !rights.editor && (
            <PageAction
              ref={editAction}
              label="Edit"
              context="Class rights"
              disabled={rights.busy}
              onClick={rights.open}
            />
          )}
          <Outcome>{rights.outcome}</Outcome>
          {!rights.editor && rights.error && (
            <p role="alert" className="text-sm text-error-light">
              {rights.error}
            </p>
          )}
          {!rights.editor && rights.count > 1 && (
            <Disclosure summary="Previous versions">
              <ul className="divide-y divide-border-subtle">
                {rights.revisions
                  .filter((revision) => revision.uuid !== rights.current?.uuid)
                  .map((revision) => (
                    <li key={revision.uuid} className="space-y-2 py-3">
                      <p className="text-sm font-medium text-text-primary">Version {revision.revision}</p>
                      <RightsSummary revision={revision} rights={rights} />
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

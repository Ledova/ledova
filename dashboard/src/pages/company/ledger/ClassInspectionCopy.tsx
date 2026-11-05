import { useEffect, useRef, useState } from 'react';
import { Field, TextInput } from '@components/Field';
import {
  FIELD_LIMITS,
  inspectionCopiesKey,
  useClassInspectionCopy,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
  formatDate,
} from '@ledova/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Outcome, Row, Rows, Section, Failure } from '@components/Ledger';
import { Actions, FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { BROWSER_FILES } from '@utils/saveFile';
import { InspectionCopyHistory } from './OutputHistory';

export function ClassInspectionCopy({
  owner,
  register,
  guard,
  sourceReady,
  onEditingChange,
}: {
  owner: OrderSubmissionOwner;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  onEditingChange?: (key: string, open: boolean) => void;
}) {
  const client = useQueryClient();
  return (
    <div className="space-y-6">
      <Section title="Prepared copies">
        <InspectionCopyHistory owner={owner} token={register.token.uuid} guard={guard} enabled={sourceReady} />
      </Section>
      <InspectionForm
        key={JSON.stringify([register, sourceReady])}
        register={register}
        guard={guard}
        sourceReady={sourceReady}
        onEditingChange={onEditingChange}
        onPrepared={() => void client.invalidateQueries({ queryKey: inspectionCopiesKey(owner, register.token.uuid) })}
      />
    </div>
  );
}

function InspectionForm({
  register,
  guard,
  sourceReady,
  onEditingChange,
  onPrepared,
}: {
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  onEditingChange?: (key: string, open: boolean) => void;
  onPrepared: () => void;
}) {
  const [open, setOpen] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const editingKey = `inspection/${register.token.uuid}`;
  useEffect(() => {
    onEditingChange?.(editingKey, open);
    return () => onEditingChange?.(editingKey, false);
  }, [editingKey, onEditingChange, open]);
  const { today, draft, setDraft, target, setTarget, busy, error, downloaded, problems, blocked, preview, download } =
    useClassInspectionCopy({ register, guard, sourceReady, onDownloaded: onPrepared, files: BROWSER_FILES });
  const checks = useErrorSummary(problems);
  useEffect(() => {
    if (open) (target ? heading.current : firstField.current)?.focus();
  }, [open, target]);
  if (!open)
    return (
      <Actions>
        <PageAction
          ref={opener}
          primary
          label="Prepare inspection copy"
          disabled={blocked}
          onClick={() => setOpen(true)}
        />
      </Actions>
    );
  return (
    <Section title="New inspection copy" headingRef={heading}>
      <form
        aria-label="New inspection copy"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!target && checks.check()) void preview();
        }}
      >
        <p className="text-sm text-text-muted">
          Prepare an inspection CSV under your current company appointment. It includes residential addresses. The
          company&apos;s request and output provenance are retained.
        </p>
        <ErrorSummary {...checks.summary} />
        {target ? (
          <Rows>
            <Row label="Share class">{register.token.name}</Row>
            <Row label="Instruction">{target.request.instruction}</Row>
            <Row label="Recipient">{target.request.recipient}</Row>
            <Row label="Request date">{formatDate(target.request.requestedOn)}</Row>
          </Rows>
        ) : (
          <fieldset disabled={blocked} className="grid gap-4 sm:grid-cols-2">
            <Field {...checks.field('instruction')} label="Written instruction reference">
              <TextInput
                ref={firstField}
                maxLength={FIELD_LIMITS.REFERENCE}
                value={draft.instruction}
                onChange={(event) => setDraft({ ...draft, instruction: event.target.value })}
              />
            </Field>
            <Field {...checks.field('recipient')} label="Recipient">
              <TextInput
                maxLength={FIELD_LIMITS.NAME}
                value={draft.recipient}
                onChange={(event) => setDraft({ ...draft, recipient: event.target.value })}
              />
            </Field>
            <Field {...checks.field('requestedOn')} label="Date of request (Sydney)">
              <TextInput
                type="date"
                max={today}
                value={draft.requestedOn}
                onChange={(event) => setDraft({ ...draft, requestedOn: event.target.value })}
              />
            </Field>
          </fieldset>
        )}
        <Failure>{error}</Failure>
        <Outcome>{downloaded && 'The inspection copy was downloaded.'}</Outcome>
        <FormActions>
          <PageAction
            label="Cancel"
            context="inspection copy"
            disabled={!!busy}
            onClick={() => {
              setOpen(false);
              requestAnimationFrame(() => opener.current?.focus());
            }}
          />
          {target && <PageAction label="Edit request" disabled={blocked} onClick={() => setTarget(null)} />}
          {target ? (
            <PageAction
              key="download"
              primary
              label="Confirm and download inspection copy"
              busy={busy === 'download'}
              busyLabel="Downloading inspection copy…"
              disabled={blocked}
              onClick={() => void download()}
            />
          ) : (
            <PageAction
              key="preview"
              type="submit"
              primary
              label="Preview inspection copy"
              busy={busy === 'preview'}
              busyLabel="Preparing preview…"
              disabled={blocked}
            />
          )}
        </FormActions>
      </form>
    </Section>
  );
}

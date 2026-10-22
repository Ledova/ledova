import { useEffect, useRef, useState } from 'react';
import { Field, TextInput } from '@components/Field';
import { FIELD_LIMITS, type TokenHoldersResponse, formatDate } from '@ledova/shared';
import { Outcome, Row, Rows } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useClassInspectionCopy } from './useClassInspectionCopy';

export function ClassInspectionCopy({
  register,
  guard,
  sourceReady,
  onEditingChange,
}: {
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  onEditingChange?: (key: string, open: boolean) => void;
}) {
  return (
    <InspectionForm
      key={JSON.stringify([register, sourceReady])}
      register={register}
      guard={guard}
      sourceReady={sourceReady}
      onEditingChange={onEditingChange}
    />
  );
}

function InspectionForm({
  register,
  guard,
  sourceReady,
  onEditingChange,
}: {
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  onEditingChange?: (key: string, open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const editingKey = `inspection/${register.token.uuid}`;
  useEffect(() => {
    onEditingChange?.(editingKey, open);
    if (open) firstField.current?.focus();
    return () => onEditingChange?.(editingKey, false);
  }, [editingKey, onEditingChange, open]);
  const { today, draft, setDraft, target, setTarget, busy, error, downloaded, problems, blocked, preview, download } =
    useClassInspectionCopy({ register, guard, sourceReady });
  const checks = useErrorSummary(problems);
  if (!open)
    return <PageAction ref={opener} label="Prepare inspection copy" disabled={blocked} onClick={() => setOpen(true)} />;
  return (
    <form
      aria-label="Inspection copy"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!target && checks.check()) void preview();
      }}
    >
      <h3 className="text-sm font-medium text-text-primary">Inspection copy</h3>
      <p className="text-sm text-text-muted">
        Prepare an inspection CSV under your current company appointment. It includes residential addresses. The
        company&apos;s request and output provenance are retained.
      </p>
      <ErrorSummary {...checks.summary} />
      <fieldset disabled={blocked || !!target} className="grid gap-4 sm:grid-cols-2">
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
      {target && (
        <Rows>
          <Row label="Share class">{register.token.name}</Row>
          <Row label="Register sequence">{target.preview.registerSequence}</Row>
          <Row label="Instruction">{target.request.instruction}</Row>
          <Row label="Recipient">{target.request.recipient}</Row>
          <Row label="Request date">{formatDate(target.request.requestedOn)}</Row>
        </Rows>
      )}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
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
  );
}

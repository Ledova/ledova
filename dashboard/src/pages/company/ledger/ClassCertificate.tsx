import { Field, TextInput } from '@components/Field';
import { FIELD_LIMITS, formatDate, formatDateTime } from '@ledova/shared';
import { useEffect, useRef, useState } from 'react';
import { Disclosure, Outcome, Row, Rows } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { RegisterChanges } from './shared/RegisterChanges';
import { useClassCertificate, type Source } from './useClassCertificate';

type Editing = { onEditingChange?: (entry: string, open: boolean) => void };

export function ClassCertificate({ sourceKey, onEditingChange, ...source }: Source & Editing & { sourceKey: string }) {
  if (
    !['issue', 'transfer'].includes(source.entry.kind) ||
    source.entry.correctedBy ||
    !Number.isSafeInteger(source.entry.sequence) ||
    source.entry.sequence < 1
  )
    return null;
  return (
    <CertificateRequest
      key={JSON.stringify([source.register, source.entry, sourceKey, source.sourceReady])}
      {...source}
      onEditingChange={onEditingChange}
    />
  );
}

function CertificateRequest({ onEditingChange, ...source }: Source & Editing) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    onEditingChange?.(source.entry.uuid, open);
    return () => onEditingChange?.(source.entry.uuid, false);
  }, [onEditingChange, open, source.entry.uuid]);
  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      opener.current?.focus();
    }
  }, [open]);
  return open ? (
    <CertificateForm
      {...source}
      close={() => {
        returnFocus.current = true;
        setOpen(false);
      }}
    />
  ) : (
    <PageAction
      ref={opener}
      label="Prepare unsigned certificate"
      context={`entry ${source.entry.sequence}`}
      disabled={!source.sourceReady || !source.register.initialized}
      onClick={() => setOpen(true)}
    />
  );
}

function CertificateForm({ register, entry, guard, sourceReady, close }: Source & { close: () => void }) {
  const instructionField = useRef<HTMLInputElement>(null);
  useEffect(() => instructionField.current?.focus(), []);
  const {
    instruction,
    setInstruction,
    target,
    setTarget,
    busy,
    error,
    downloaded,
    problems,
    blocked,
    preview,
    download,
  } = useClassCertificate({ register, entry, guard, sourceReady });
  const checks = useErrorSummary(problems);
  const context = `unsigned certificate for entry ${entry.sequence}`;
  return (
    <form
      aria-label={`Unsigned certificate for entry ${entry.sequence}`}
      className="flex w-full flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!target && checks.check()) void preview();
      }}
    >
      <h3 className="text-sm font-medium text-text-primary">Unsigned certificate</h3>
      <div className="text-sm text-text-primary">
        <RegisterChanges changes={entry.changes} />
      </div>
      <ErrorSummary {...checks.summary} />
      <p className="text-sm text-text-muted">Includes names and residential addresses. The company arranges signing.</p>
      <div className="max-w-xl">
        <Field {...checks.field('instruction')} label="Instruction reference">
          <TextInput
            ref={instructionField}
            maxLength={FIELD_LIMITS.REFERENCE}
            value={instruction}
            disabled={blocked || !!target}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </Field>
      </div>
      <Disclosure summary="Record details">
        <Rows>
          <Row label="Entry">{entry.sequence}</Row>
          <Row label="Company date">{formatDate(entry.companyEventOn, 'Not recorded')}</Row>
          <Row label="Ledger date">{formatDate(entry.effectiveOn)}</Row>
          <Row label="Recorded on">{formatDateTime(entry.recordedAt)}</Row>
          {target && (
            <>
              <Row label="Share class">{register.token.name}</Row>
              <Row label="PDF pages">{target.preview.pageCount}</Row>
              <Row label="Register sequence">{target.preview.registerSequence}</Row>
            </>
          )}
        </Rows>
      </Disclosure>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <Outcome>{downloaded && 'The unsigned certificate was downloaded.'}</Outcome>
      <FormActions>
        <PageAction label="Cancel" context={context} disabled={!!busy} onClick={close} />
        {target && <PageAction label="Edit" context={context} disabled={blocked} onClick={() => setTarget(null)} />}
        {target ? (
          <PageAction
            key="download"
            primary
            label="Download PDF"
            context={context}
            busy={busy === 'download'}
            busyLabel="Downloading…"
            disabled={blocked}
            onClick={() => void download()}
          />
        ) : (
          <PageAction
            key="preview"
            type="submit"
            primary
            label="Preview"
            context={context}
            busy={busy === 'preview'}
            busyLabel="Preparing preview…"
            disabled={blocked}
          />
        )}
      </FormActions>
    </form>
  );
}

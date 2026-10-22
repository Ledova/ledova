import { Field, TextInput } from '@components/Field';
import { FIELD_LIMITS } from '@ledova/shared';
import { useState } from 'react';
import { Disclosure, Outcome, Row, Rows } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useClassCertificate, type Source } from './useClassCertificate';

export function ClassCertificate({ sourceKey, ...source }: Source & { sourceKey: string }) {
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
    />
  );
}

function CertificateRequest(source: Source) {
  const [open, setOpen] = useState(false);
  return open ? (
    <CertificateForm {...source} close={() => setOpen(false)} />
  ) : (
    <PageAction
      label="Prepare unsigned certificate"
      context={`entry ${source.entry.sequence}`}
      disabled={!source.sourceReady || !source.register.initialized}
      onClick={() => setOpen(true)}
    />
  );
}

function CertificateForm({ register, entry, guard, sourceReady, close }: Source & { close: () => void }) {
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
      className="flex w-full flex-col gap-4 border-t border-border-subtle pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!target && checks.check()) void preview();
      }}
    >
      <h4 className="text-sm font-medium text-text-primary">Unsigned certificate</h4>
      <ErrorSummary {...checks.summary} />
      <p className="text-sm text-text-muted">Includes names and residential addresses. The company arranges signing.</p>
      <div className="max-w-xl">
        <Field {...checks.field('instruction')} label="Instruction reference">
          <TextInput
            maxLength={FIELD_LIMITS.REFERENCE}
            value={instruction}
            disabled={blocked || !!target}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </Field>
      </div>
      {target && (
        <>
          <Rows>
            <Row label="Share class">{register.token.name}</Row>
            <Row label="PDF pages">{target.preview.pageCount}</Row>
          </Rows>
          <Disclosure summary="Record details">
            <Rows>
              <Row label="Entry">{target.preview.sequence}</Row>
              <Row label="Register sequence">{target.preview.registerSequence}</Row>
            </Rows>
          </Disclosure>
        </>
      )}
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

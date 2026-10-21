import { Field, TextInput } from '@components/Field';
import { FIELD_LIMITS } from '@ledova/shared';
import { useState } from 'react';
import { Outcome, Row, Rows } from '@components/Ledger';
import { PageAction } from '@components/Page';
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
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
      <h4 className="text-sm font-medium text-text-primary">Unsigned certificate · Entry {entry.sequence}</h4>
      <ErrorSummary {...checks.summary} />
      <p className="text-sm text-text-muted">
        The PDF includes recorded names and residential addresses. A transfer can include more than one member&apos;s
        page. The company must arrange any required execution and signing.
      </p>
      <Field {...checks.field('instruction')} label="Certificate instruction reference">
        <TextInput
          maxLength={FIELD_LIMITS.REFERENCE}
          value={instruction}
          disabled={blocked || !!target}
          onChange={(event) => setInstruction(event.target.value)}
        />
      </Field>
      {!target ? (
        <PageAction
          primary
          label="Preview unsigned certificate"
          busy={busy === 'preview'}
          busyLabel="Preparing certificate preview…"
          disabled={blocked}
          onClick={() => {
            if (checks.check()) void preview();
          }}
        />
      ) : (
        <>
          <Rows>
            <Row label="Share class">{register.token.name}</Row>
            <Row label="Entry">{target.preview.sequence}</Row>
            <Row label="Register sequence">{target.preview.registerSequence}</Row>
            <Row label="PDF pages">{target.preview.pageCount}</Row>
            <Row label="Instruction">{target.request.instruction}</Row>
          </Rows>
          <div className="flex flex-wrap gap-2">
            <PageAction
              primary
              label="Confirm and download unsigned PDF"
              busy={busy === 'download'}
              busyLabel="Downloading certificate…"
              disabled={blocked}
              onClick={() => void download()}
            />
            <PageAction
              label="Refresh certificate preview"
              busy={busy === 'preview'}
              busyLabel="Refreshing…"
              disabled={blocked}
              onClick={() => void preview()}
            />
            <PageAction label="Edit certificate request" disabled={blocked} onClick={() => setTarget(null)} />
          </div>
        </>
      )}
      <PageAction label="Close certificate request" onClick={close} />
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <Outcome>{downloaded && 'The unsigned certificate was downloaded.'}</Outcome>
    </div>
  );
}

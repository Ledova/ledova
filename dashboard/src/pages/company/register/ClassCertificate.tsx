import { useState } from 'react';
import { Row, Rows } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
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
  const { instruction, setInstruction, target, setTarget, busy, error, downloaded, valid, blocked, preview, download } =
    useClassCertificate({ register, entry, guard, sourceReady });
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
      <h4 className="text-sm font-medium text-text-primary">Unsigned certificate · Entry {entry.sequence}</h4>
      <p className="text-sm text-text-muted">
        The PDF includes recorded names and residential addresses. A transfer can include more than one member&apos;s
        page. The company must arrange any required execution and signing.
      </p>
      <label className="block text-sm text-text-primary">
        Certificate instruction reference
        <input
          className={FIELD_CLASS}
          maxLength={255}
          value={instruction}
          disabled={blocked || !!target}
          onChange={(event) => setInstruction(event.target.value)}
        />
      </label>
      {!target ? (
        <PageAction
          primary
          label="Preview unsigned certificate"
          busy={busy === 'preview'}
          busyLabel="Preparing certificate preview…"
          disabled={blocked || !valid}
          onClick={() => void preview()}
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
            <PageAction label="Refresh certificate preview" disabled={blocked} onClick={() => void preview()} />
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
      {downloaded && (
        <p role="status" className="text-sm text-text-muted">
          The unsigned certificate was downloaded.
        </p>
      )}
    </div>
  );
}

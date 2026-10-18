import { useLayoutEffect, useRef, useState } from 'react';
import {
  createRegisterCertificate,
  getRegisterCertificatePreview,
  type RegisterCertificatePreview,
  type RegisterCertificateRequest,
  type RegisterEntry,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { saveFile } from '@utils/saveFile';

type Source = {
  register: TokenHoldersResponse;
  entry: RegisterEntry;
  guard: () => void;
  sourceReady: boolean;
};
type Target = { preview: RegisterCertificatePreview; request: Readonly<RegisterCertificateRequest> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const [instruction, setInstruction] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState<'preview' | 'download' | null>(null);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const mounted = useRef(true);
  const pending = useRef(false);
  const transport = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      transport.current?.abort();
    };
  }, []);
  const valid = !!instruction.trim() && instruction.trim().length <= 255;
  const blocked = !!busy || !sourceReady || !register.initialized;
  const assertCurrent = (controller: AbortController) => {
    guard();
    if (!mounted.current || !sourceReady || controller.signal.aborted)
      throw new Error('The certificate source changed.');
  };
  const preview = async () => {
    if (pending.current || blocked || !valid) return;
    pending.current = true;
    const controller = new AbortController();
    transport.current = controller;
    setBusy('preview');
    setTarget(null);
    setDownloaded(false);
    setError('');
    const captured = instruction.trim();
    try {
      assertCurrent(controller);
      const { data } = await getRegisterCertificatePreview(apiClient, register.token.uuid, entry.sequence, {
        signal: controller.signal,
        ledovaSubmissionGuard: () => assertCurrent(controller),
      });
      assertCurrent(controller);
      if (
        typeof data.token !== 'string' ||
        !UUID.test(data.token) ||
        data.token !== register.token.uuid ||
        typeof data.entry !== 'string' ||
        !UUID.test(data.entry) ||
        data.entry !== entry.uuid ||
        typeof data.appointment !== 'string' ||
        !UUID.test(data.appointment) ||
        !Number.isSafeInteger(data.sequence) ||
        data.sequence !== entry.sequence ||
        !Number.isSafeInteger(data.registerSequence) ||
        data.registerSequence < entry.sequence ||
        !Number.isSafeInteger(data.pageCount) ||
        data.pageCount < 1 ||
        data.pageCount > 2 ||
        typeof data.sourceDigest !== 'string' ||
        !/^[0-9a-f]{64}$/.test(data.sourceDigest)
      )
        throw new Error('The certificate preview could not be confirmed.');
      setTarget({
        preview: Object.freeze({ ...data }),
        request: Object.freeze({
          appointment: data.appointment,
          sequence: entry.sequence,
          sourceDigest: data.sourceDigest,
          instruction: captured,
        }),
      });
    } catch {
      if (mounted.current) setError('The certificate preview could not be confirmed. Try again.');
    } finally {
      pending.current = false;
      if (transport.current === controller) transport.current = null;
      if (mounted.current) setBusy(null);
    }
  };
  const download = async () => {
    if (!target || pending.current || blocked) return;
    pending.current = true;
    const controller = new AbortController();
    transport.current = controller;
    setBusy('download');
    setError('');
    try {
      assertCurrent(controller);
      const { data } = await createRegisterCertificate(apiClient, register.token.uuid, target.request, {
        signal: controller.signal,
        ledovaSubmissionGuard: () => assertCurrent(controller),
      });
      assertCurrent(controller);
      if (!(data instanceof Blob) || !/^application\/pdf(?:;|$)/.test(data.type) || data.size < 1)
        throw new Error('The certificate could not be confirmed.');
      saveFile(data, `certificate-${register.token.symbol ?? register.token.uuid}-${entry.sequence}.pdf`);
      setTarget(null);
      setDownloaded(true);
    } catch {
      if (mounted.current) {
        setTarget(null);
        setError('The certificate could not be downloaded. Refresh the preview and try again.');
      }
    } finally {
      pending.current = false;
      if (transport.current === controller) transport.current = null;
      if (mounted.current) setBusy(null);
    }
  };
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
          label={busy === 'preview' ? 'Preparing certificate preview…' : 'Preview unsigned certificate'}
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
              label={busy === 'download' ? 'Downloading certificate…' : 'Confirm and download unsigned PDF'}
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

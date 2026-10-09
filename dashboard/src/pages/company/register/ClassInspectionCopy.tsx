import { useLayoutEffect, useRef, useState } from 'react';
import {
  createRegisterInspectionCopy,
  getRegisterInspectionPreview,
  type RegisterInspectionPreview,
  type RegisterInspectionRequest,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { saveFile } from './useCompanyRegister';

type Draft = { instruction: string; recipient: string; requestedOn: string };
type Target = { preview: RegisterInspectionPreview; request: Readonly<RegisterInspectionRequest> };

export function ClassInspectionCopy({
  register,
  guard,
  sourceReady,
}: {
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
}) {
  return (
    <InspectionForm
      key={JSON.stringify([register, sourceReady])}
      register={register}
      guard={guard}
      sourceReady={sourceReady}
    />
  );
}

function InspectionForm({
  register,
  guard,
  sourceReady,
}: {
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
}) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [draft, setDraft] = useState<Draft>({ instruction: '', recipient: '', requestedOn: today });
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
  const validDate =
    /^\d{4}-\d{2}-\d{2}$/.test(draft.requestedOn) &&
    !Number.isNaN(Date.parse(`${draft.requestedOn}T00:00:00Z`)) &&
    new Date(`${draft.requestedOn}T00:00:00Z`).toISOString().slice(0, 10) === draft.requestedOn &&
    draft.requestedOn <= today;
  const valid =
    !!draft.instruction.trim() &&
    draft.instruction.trim().length <= 255 &&
    !!draft.recipient.trim() &&
    draft.recipient.trim().length <= 255 &&
    validDate;
  const blocked = !!busy || !sourceReady || !register.initialized;
  const assertCurrent = (controller: AbortController) => {
    guard();
    if (!mounted.current || !sourceReady || controller.signal.aborted)
      throw new Error('The inspection source changed.');
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
    const request = {
      instruction: draft.instruction.trim(),
      recipient: draft.recipient.trim(),
      requestedOn: draft.requestedOn,
    };
    try {
      assertCurrent(controller);
      const { data } = await getRegisterInspectionPreview(apiClient, register.token.uuid, {
        signal: controller.signal,
        ledovaSubmissionGuard: () => assertCurrent(controller),
      });
      assertCurrent(controller);
      if (
        data.token !== register.token.uuid ||
        typeof data.appointment !== 'string' ||
        !data.appointment ||
        !Number.isSafeInteger(data.registerSequence) ||
        data.registerSequence < 1 ||
        typeof data.sourceDigest !== 'string' ||
        !/^[0-9a-f]{64}$/.test(data.sourceDigest)
      )
        throw new Error('The inspection preview could not be confirmed.');
      setTarget({
        preview: Object.freeze({ ...data }),
        request: Object.freeze({ ...request, appointment: data.appointment, sourceDigest: data.sourceDigest }),
      });
    } catch {
      if (mounted.current) setError('The inspection preview could not be confirmed. Try again.');
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
      const { data } = await createRegisterInspectionCopy(apiClient, register.token.uuid, target.request, {
        signal: controller.signal,
        ledovaSubmissionGuard: () => assertCurrent(controller),
      });
      assertCurrent(controller);
      if (!(data instanceof Blob) || !/^text\/csv(?:;|$)/.test(data.type))
        throw new Error('The inspection copy could not be confirmed.');
      saveFile(data, `register-${register.token.symbol ?? register.token.uuid}-inspection-copy.csv`);
      setTarget(null);
      setDownloaded(true);
    } catch {
      if (mounted.current) {
        setTarget(null);
        setError('The inspection copy could not be downloaded. Refresh the preview and try again.');
      }
    } finally {
      pending.current = false;
      if (transport.current === controller) transport.current = null;
      if (mounted.current) setBusy(null);
    }
  };
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">Inspection copy</h3>
      <p className="text-sm text-text-muted">
        Prepare an inspection CSV under your current company appointment. It includes residential addresses. The
        company&apos;s request and output provenance are retained.
      </p>
      <fieldset disabled={blocked || !!target} className="space-y-3">
        <label className="block text-sm text-text-primary">
          Written instruction reference
          <input
            className={FIELD_CLASS}
            maxLength={255}
            value={draft.instruction}
            onChange={(event) => setDraft({ ...draft, instruction: event.target.value })}
          />
        </label>
        <label className="block text-sm text-text-primary">
          Recipient
          <input
            className={FIELD_CLASS}
            maxLength={255}
            value={draft.recipient}
            onChange={(event) => setDraft({ ...draft, recipient: event.target.value })}
          />
        </label>
        <label className="block text-sm text-text-primary">
          Date of request (Sydney)
          <input
            className={FIELD_CLASS}
            type="date"
            max={today}
            value={draft.requestedOn}
            onChange={(event) => setDraft({ ...draft, requestedOn: event.target.value })}
          />
        </label>
      </fieldset>
      {!target ? (
        <PageAction
          label={busy === 'preview' ? 'Preparing preview…' : 'Preview inspection copy'}
          disabled={blocked || !valid}
          onClick={() => void preview()}
        />
      ) : (
        <>
          <Rows>
            <Row label="Share class">{register.token.name}</Row>
            <Row label="Register sequence">{target.preview.registerSequence}</Row>
            <Row label="Instruction">{target.request.instruction}</Row>
            <Row label="Recipient">{target.request.recipient}</Row>
            <Row label="Request date">{target.request.requestedOn}</Row>
          </Rows>
          <div className="flex flex-wrap gap-2">
            <PageAction
              label={busy === 'download' ? 'Downloading inspection copy…' : 'Confirm and download inspection copy'}
              disabled={blocked}
              onClick={() => void download()}
            />
            <PageAction label="Refresh inspection preview" disabled={blocked} onClick={() => void preview()} />
            <PageAction label="Edit request" disabled={blocked} onClick={() => setTarget(null)} />
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {downloaded && (
        <p role="status" className="text-sm text-text-muted">
          The inspection copy was downloaded.
        </p>
      )}
    </div>
  );
}

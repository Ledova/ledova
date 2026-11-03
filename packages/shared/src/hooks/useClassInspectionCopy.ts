import { useLayoutEffect, useRef, useState } from 'react';
import { createRegisterInspectionCopy, getRegisterInspectionPreview } from '../services/company-tokens';
import type { RegisterInspectionPreview, RegisterInspectionRequest, TokenHoldersResponse } from '../types';
import { isCalendarDate, sydneyToday } from '../utils/date';
import { downloadedFile, type FileDelivery } from '../utils/downloads';
import { useApiClient } from './useApiClient';
import { hasProblems, type Problems } from './useErrorSummary';
import type { OrderSubmissionSession } from './useSubmissionOwner';

type Draft = { instruction: string; recipient: string; requestedOn: string };

type Target = { preview: RegisterInspectionPreview; request: Readonly<RegisterInspectionRequest> };

export function useClassInspectionCopy({
  register,
  guard,
  sourceReady,
  onDownloaded,
  files,
  session,
}: {
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  onDownloaded?: () => void;
  files: FileDelivery;
  session?: OrderSubmissionSession;
}) {
  const apiClient = useApiClient();
  const today = sydneyToday();
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
  const missing = (value: string) => !value.trim() || value.trim().length > 255;
  const problems: Problems<keyof Draft> = {
    instruction: missing(draft.instruction) && 'Give the written instruction reference.',
    recipient: missing(draft.recipient) && 'Give the recipient.',
    requestedOn:
      (!isCalendarDate(draft.requestedOn) || draft.requestedOn > today) &&
      'Enter a request date no later than today (Sydney).',
  };
  const blocked = !!busy || !sourceReady || !register.initialized;
  const assertCurrent = (controller: AbortController) => {
    guard();
    if (!mounted.current || !sourceReady || controller.signal.aborted)
      throw new Error('The inspection source changed.');
  };
  const preview = async () => {
    if (pending.current || blocked || hasProblems(problems)) return;
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
        ...session?.requestConfig(),
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
      const response = await createRegisterInspectionCopy(apiClient, register.token.uuid, target.request, {
        ...session?.requestConfig(),
        responseType: files.responseType ?? 'blob',
        signal: controller.signal,
        ledovaSubmissionGuard: () => assertCurrent(controller),
      });
      assertCurrent(controller);
      const file = downloadedFile(response);
      if (!file || !/^text\/csv(?:;|$)/.test(file.type)) throw new Error('The inspection copy could not be confirmed.');
      await files.save(
        file.data,
        `register-${register.token.symbol ?? register.token.uuid}-inspection-copy.csv`,
        file.type,
      );
      setTarget(null);
      setDownloaded(true);
      onDownloaded?.();
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
  return { today, draft, setDraft, target, setTarget, busy, error, downloaded, problems, blocked, preview, download };
}

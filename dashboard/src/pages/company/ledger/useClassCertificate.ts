import { useLayoutEffect, useRef, useState } from 'react';
import {
  createRegisterCertificate,
  getRegisterCertificatePreview,
  type RegisterCertificatePreview,
  type RegisterCertificateRequest,
  type RegisterEntry,
  type TokenHoldersResponse,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { saveFile } from '@utils/saveFile';

export type Source = {
  register: TokenHoldersResponse;
  entry: RegisterEntry;
  guard: () => void;
  sourceReady: boolean;
};

type Target = { preview: RegisterCertificatePreview; request: Readonly<RegisterCertificateRequest> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useClassCertificate({ register, entry, guard, sourceReady }: Source) {
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
  const blocked = !!busy || !sourceReady || !register.initialized;
  const assertCurrent = (controller: AbortController) => {
    guard();
    if (!mounted.current || !sourceReady || controller.signal.aborted)
      throw new Error('The certificate source changed.');
  };
  const preview = async () => {
    if (pending.current || blocked) return;
    pending.current = true;
    const controller = new AbortController();
    transport.current = controller;
    setBusy('preview');
    setTarget(null);
    setDownloaded(false);
    setError('');
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
  return {
    target,
    busy,
    error,
    downloaded,
    blocked,
    preview,
    download,
  };
}

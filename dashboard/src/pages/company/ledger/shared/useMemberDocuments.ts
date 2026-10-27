import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  appointmentForRegisterStep,
  createRegisterMemberDocument,
  createUserFriendlyError,
  downloadRegisterMemberDocumentFile,
  failureSentence,
  failureStatus,
  getRegisterMemberDocuments,
  hasCurrentRegisterReadAuthority,
  isRegisterEvidenceReceipt,
  isRegisterMemberDocumentReceipt,
  readEveryPage,
  uploadRegisterEvidence,
  type OrderSubmissionOwner,
  type RegisterEvidence,
  type RegisterMemberDocument,
  type RegisterMemberDocumentRequest,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING } from '@hooks/useRegisterAccess';
import { ownAppointmentsKey, useOwnAppointments } from '@hooks/useOwnAppointments';
import { saveFile } from '@utils/saveFile';
import type { DocumentDraft } from './documentAttachmentDraft';

export type DocumentHolding = { member: string; token: string; label: string };

type Editor = { member: string; token: string; documents: DocumentDraft[] };
type Pending = Editor & { appointment: string };
type Upload = { file: File; appointment: string; key: string; receipt?: RegisterEvidence };

export function memberDocumentsKey(owner: OrderSubmissionOwner, company: string) {
  return ['register-member-documents', owner.userUuid, owner.ownerAccountUuid, company];
}

export function useMemberDocuments({
  owner,
  guard,
  company,
  member,
  token,
  sourceReady,
  holdings,
  readsPaused = false,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  member?: string;
  token?: string;
  sourceReady: boolean;
  holdings: DocumentHolding[];
  readsPaused?: boolean;
}) {
  const client = useQueryClient();
  const mounted = useRef(true);
  const running = useRef(false);
  const pending = useRef<Pending | null>(null);
  const uploads = useRef(new Map<string, Upload>());
  const confirmed = useRef(new Set<string>());
  const requests = useRef(new Map<string, RegisterMemberDocumentRequest>());
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const appointments = useOwnAppointments(owner, guard, {
    enabled: sourceReady && !readsPaused,
  });
  const authorised =
    sourceReady &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const appointment = authorised ? appointmentForRegisterStep(appointments.data, company, 'prepare') : undefined;
  const latest = useRef({ sourceReady, holdings });
  useLayoutEffect(() => {
    latest.current = { sourceReady, holdings };
  }, [sourceReady, holdings]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (!mounted.current || !latest.current.sourceReady)
      throw createUserFriendlyError('Refresh the shareholder and share class before opening documents.');
    const state = client.getQueryState(ownAppointmentsKey(owner));
    const current = client.getQueryData<NonNullable<typeof appointments.data>>(ownAppointmentsKey(owner));
    if (
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      !current ||
      !hasCurrentRegisterReadAuthority(current, company)
    )
      throw createUserFriendlyError('Current company register access is required to open documents.');
  };
  const checkPreparation = (expected: string, holding: Pick<Editor, 'member' | 'token'>) => {
    check();
    const current = client.getQueryData<NonNullable<typeof appointments.data>>(ownAppointmentsKey(owner)) ?? [];
    if (
      appointmentForRegisterStep(current, company, 'prepare')?.uuid !== expected ||
      !latest.current.holdings.some((row) => row.member === holding.member && row.token === holding.token)
    )
      throw createUserFriendlyError('Refresh your preparation appointment and the shareholder’s holding.');
  };
  const query = useQuery({
    queryKey: [...memberDocumentsKey(owner, company), member ?? '', token ?? ''],
    enabled: authorised && !readsPaused,
    queryFn: () =>
      readEveryPage(async (page) => {
        check();
        const result = await getRegisterMemberDocuments(
          apiClient,
          { company, member, token, page },
          { ledovaSubmissionGuard: check },
        );
        check();
        return result;
      }),
    ...READ_TIMING,
    refetchOnMount: 'always',
  });
  const ready = authorised && query.isSuccess && query.fetchStatus === 'idle';
  const open = () => {
    if (!ready || !appointment || !holdings.length || pending.current) return;
    setError('');
    setEditor({ member: holdings[0].member, token: holdings[0].token, documents: [] });
  };
  const close = () => {
    if (running.current || pending.current) return;
    setError('');
    setEditor(null);
  };
  const save = async () => {
    if (running.current || !editor) return;
    running.current = true;
    setBusy(true);
    setError('');
    let refused = false;
    try {
      check();
      let requestSet = pending.current;
      if (!requestSet) {
        if (!appointment) throw createUserFriendlyError('Current preparation access is required to add documents.');
        checkPreparation(appointment.uuid, editor);
        const documents = editor.documents.filter((row) => row.file);
        if (!documents.length) throw createUserFriendlyError('Choose at least one document.');
        requestSet = { ...editor, documents, appointment: appointment.uuid };
        pending.current = requestSet;
        setHeld(true);
      }
      for (const document of requestSet.documents) {
        let request = requests.current.get(document.id);
        let receipt: RegisterMemberDocument | undefined;
        if (request) {
          const { data } = await getRegisterMemberDocuments(
            apiClient,
            { company, member: request.member, token: request.token, idempotencyKey: request.idempotencyKey },
            { ledovaSubmissionGuard: check },
          );
          check();
          receipt = data.results.find((row) => isRegisterMemberDocumentReceipt(row, request!));
          if (!receipt && data.results.length)
            throw createUserFriendlyError('The original document receipt did not match. Recover the original save.');
        }
        if (!receipt) {
          checkPreparation(requestSet.appointment, requestSet);
          if (!request) {
            const file = document.file!;
            let upload = uploads.current.get(document.id);
            if (upload?.file !== file || upload.appointment !== requestSet.appointment) {
              upload = { file, appointment: requestSet.appointment, key: crypto.randomUUID() };
              uploads.current.set(document.id, upload);
            }
            const uploadRequest = {
              companyId: company,
              appointment: requestSet.appointment,
              kind: 'supporting' as const,
              idempotencyKey: upload.key,
            };
            const checkUpload = () => checkPreparation(requestSet!.appointment, requestSet!);
            if (!upload.receipt) {
              const { data } = await uploadRegisterEvidence(
                apiClient,
                { ...uploadRequest, file },
                { ledovaSubmissionGuard: checkUpload },
              );
              checkUpload();
              if (!isRegisterEvidenceReceipt(data, uploadRequest, file.size))
                throw createUserFriendlyError('The document upload could not be confirmed. Recover the original save.');
              upload.receipt = data;
            }
            request = {
              companyId: company,
              member: requestSet.member,
              token: requestSet.token,
              evidence: upload.receipt.uuid,
              category: document.category,
              appointment: requestSet.appointment,
              idempotencyKey: crypto.randomUUID(),
            };
            requests.current.set(document.id, request);
          }
          const checkWrite = () => checkPreparation(requestSet!.appointment, requestSet!);
          const { data } = await createRegisterMemberDocument(apiClient, request, {
            ledovaSubmissionGuard: checkWrite,
          }).catch((failure) => {
            const status = failureStatus(failure);
            refused = status !== undefined && status >= 400 && status < 500;
            throw failure;
          });
          check();
          if (!isRegisterMemberDocumentReceipt(data, request))
            throw createUserFriendlyError('The document receipt could not be confirmed. Recover the original save.');
        }
        confirmed.current.add(document.id);
      }
      pending.current = null;
      requests.current.clear();
      uploads.current.clear();
      confirmed.current.clear();
      setHeld(false);
      setEditor(null);
      await client.invalidateQueries({ queryKey: memberDocumentsKey(owner, company) });
    } catch (failure) {
      try {
        guard();
        const status = failureStatus(failure);
        if (refused || (status !== undefined && status >= 400 && status < 500 && !requests.current.size)) {
          pending.current = null;
          const completed = new Set(confirmed.current);
          setEditor(
            (current) =>
              current && { ...current, documents: current.documents.filter((row) => !completed.has(row.id)) },
          );
          requests.current.clear();
          confirmed.current.clear();
          setHeld(false);
          void client.invalidateQueries({ queryKey: memberDocumentsKey(owner, company) });
        }
        if (mounted.current)
          setError(failureSentence(failure, 'The documents could not be confirmed. Recover the original save.'));
      } catch {
        return;
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const download = async (document: RegisterMemberDocument) => {
    if (running.current || !ready) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      check();
      const { data } = await downloadRegisterMemberDocumentFile(apiClient, document.uuid, {
        ledovaSubmissionGuard: check,
      });
      check();
      saveFile(data, document.snapshot.name);
    } catch (failure) {
      try {
        guard();
        if (mounted.current) setError(failureSentence(failure, 'The document could not be downloaded. Try again.'));
      } catch {
        return;
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return {
    query,
    appointments,
    authorised,
    ready,
    appointment,
    editor,
    setEditor,
    busy,
    held,
    error,
    open,
    close,
    save,
    download,
  };
}

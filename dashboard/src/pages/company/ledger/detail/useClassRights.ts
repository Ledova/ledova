import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  USER_PREFERENCES_QUERY_KEY,
  assertNextPageAdvances,
  createUserFriendlyError,
  downloadClassRightsFile,
  failureSentence,
  failureStatus,
  getClassRights,
  getNextPageParam,
  isRegisterEvidenceReceipt,
  isCalendarDate,
  isUuid,
  recordClassRights,
  uploadRegisterEvidence,
  useSubmissionOwner,
  useUserPreferences,
  type ClassRightsRequest,
  type ClassRightsRevision,
  type ClassRightsDocument,
  type ClassRightsAttributes,
  type OrderSubmissionOwner,
  type RegisterEvidence,
} from '@ledova/shared';
import { READ_TIMING } from '@hooks/useRegisterAccess';
import apiClient from '@services/apiClient';
import { saveFile } from '@utils/saveFile';
import {
  classRightsTerms,
  cleanRightsAttributes,
  isRightsAttributes,
  rightsWithoutConditions,
  sameRightsAttributes,
} from './rightsAttributes';

export function classRightsKey(owner: OrderSubmissionOwner | null, token: string) {
  return ['class-rights', owner?.userUuid, owner?.ownerAccountUuid, token];
}

type ClassDocumentDraft = { id: string; file: File | null; snapshot?: ClassRightsDocument };
type Editor = {
  appointment: string;
  previousRevision: number;
  attributes: ClassRightsAttributes;
  effectiveDate: string;
  summary: string;
  documents: ClassDocumentDraft[];
};
type Upload = { file: File; key: string; receipt?: RegisterEvidence };

function isDocument(document: ClassRightsDocument, company: string) {
  return (
    !!document &&
    document.company === company &&
    isUuid(document.evidence) &&
    document.providedBy === 'company' &&
    document.documentType === 'class_rights' &&
    typeof document.name === 'string' &&
    !!document.name.trim() &&
    Number.isSafeInteger(document.fileSize) &&
    document.fileSize > 0 &&
    typeof document.mimeType === 'string' &&
    !!document.mimeType.trim() &&
    /^[0-9a-f]{64}$/.test(document.sha256)
  );
}

function matchesDocument(actual: ClassRightsDocument, expected: ClassRightsDocument) {
  return (
    actual.evidence === expected.evidence &&
    actual.company === expected.company &&
    actual.name === expected.name &&
    actual.fileSize === expected.fileSize &&
    actual.mimeType === expected.mimeType &&
    actual.sha256 === expected.sha256 &&
    actual.documentType === expected.documentType &&
    actual.providedBy === expected.providedBy
  );
}

function matchesReceipt(
  receipt: ClassRightsRevision,
  request: ClassRightsRequest,
  token: string,
  documents: ClassRightsDocument[],
) {
  return (
    receipt.token === token &&
    receipt.idempotencyKey === request.idempotencyKey &&
    receipt.appointment === request.appointment &&
    receipt.revision === request.previousRevision + 1 &&
    receipt.summary === request.summary &&
    receipt.effectiveDate === (request.effectiveDate ?? null) &&
    isRightsAttributes(receipt.attributes) &&
    sameRightsAttributes(receipt.attributes, request.attributes ?? {}) &&
    receipt.documentReference === (request.documentReference ?? '') &&
    Array.isArray(receipt.documents) &&
    receipt.documents.length === documents.length &&
    receipt.documents.every((document, index) => matchesDocument(document, documents[index]))
  );
}

export function useClassRights(token: string, tokenReady: boolean, company: string | undefined) {
  const { owner, boundary } = useSubmissionOwner();
  const queryClient = useQueryClient();
  const preferences = useUserPreferences();
  const mounted = useRef(true);
  const pending = useRef<ClassRightsRequest | null>(null);
  const preparation = useRef<Editor | null>(null);
  const uploads = useRef(new Map<string, Upload>());
  const expectedDocuments = useRef<ClassRightsDocument[]>([]);
  const running = useRef(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const preferencesRead = queryClient.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const enabled =
    !!owner &&
    tokenReady &&
    !!company &&
    !!preferences.preferences &&
    preferencesRead?.status === 'success' &&
    preferences.fetchStatus === 'idle';
  const source = useRef(enabled);
  useLayoutEffect(() => {
    source.current = enabled;
  }, [enabled]);
  const guard = () => {
    if (!mounted.current || !owner || boundary.get() !== owner)
      throw createUserFriendlyError('Your signed-in account changed. Reopen the share class.');
    if (!source.current)
      throw createUserFriendlyError('The current share class and account could not be confirmed. Try again.');
  };
  const query = useInfiniteQuery({
    queryKey: classRightsKey(owner, token),
    enabled,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      guard();
      const { data } = await getClassRights(apiClient, token, { page: pageParam }, { ledovaSubmissionGuard: guard });
      guard();
      assertNextPageAdvances(pageParam, data);
      const valid = (revision: ClassRightsRevision) =>
        revision.token === token &&
        isRightsAttributes(revision.attributes) &&
        (revision.effectiveDate === null ||
          (typeof revision.effectiveDate === 'string' && isCalendarDate(revision.effectiveDate))) &&
        Array.isArray(revision.documents) &&
        revision.documents.every((document) => isDocument(document, company!)) &&
        new Set(revision.documents.map((document) => document.evidence)).size === revision.documents.length;
      if (data.results.some((revision) => !valid(revision)) || (data.current && !valid(data.current)))
        throw new Error('The class rights did not identify this share class.');
      return data;
    },
    getNextPageParam,
    ...READ_TIMING,
    refetchOnMount: 'always',
  });
  const first = query.data?.pages[0];
  const coherent = query.data?.pages.every((page) => page.current?.uuid === first?.current?.uuid) ?? true;
  const ready = enabled && query.isSuccess && query.fetchStatus === 'idle' && coherent;
  const current = ready ? (first?.current ?? null) : null;
  const appointment = ready ? (first?.administrationAppointment ?? null) : null;
  const read = useRef({ ready, current, appointment });
  useLayoutEffect(() => {
    read.current = { ready, current, appointment };
  }, [ready, current, appointment]);
  const clearPending = () => {
    pending.current = null;
    preparation.current = null;
    uploads.current.clear();
    expectedDocuments.current = [];
    setHeld(false);
  };
  const stale =
    !!editor && ready && (editor.previousRevision !== (current?.revision ?? 0) || editor.appointment !== appointment);
  const open = () => {
    guard();
    if (!ready || !appointment || pending.current || running.current) return;
    setError('');
    setOutcome('');
    setEditor({
      appointment,
      previousRevision: current?.revision ?? 0,
      attributes: rightsWithoutConditions(current?.attributes ?? {}),
      effectiveDate: current?.effectiveDate ?? '',
      summary: classRightsTerms(current?.attributes ?? {}, current?.summary ?? ''),
      documents: (current?.documents ?? []).map((snapshot) => ({
        id: snapshot.evidence,
        file: null,
        snapshot,
      })),
    });
  };
  const close = () => {
    if (running.current || pending.current || preparation.current) return;
    clearPending();
    setEditor(null);
    setError('');
  };
  const save = async () => {
    if (running.current || !editor) return;
    running.current = true;
    setBusy(true);
    setError('');
    setOutcome('');
    try {
      guard();
      if (!read.current.ready) throw createUserFriendlyError('Refresh the class rights before saving.');
      let request = pending.current;
      let receipt: ClassRightsRevision | undefined;
      if (request) {
        const { data } = await getClassRights(
          apiClient,
          token,
          { idempotency_key: request.idempotencyKey },
          { ledovaSubmissionGuard: guard },
        );
        guard();
        receipt = data.results.find((revision) => matchesReceipt(revision, request!, token, expectedDocuments.current));
        if (!receipt && data.results.length)
          throw createUserFriendlyError('The original class rights receipt did not match. Retry the original save.');
        if (!receipt && data.administrationAppointment !== request.appointment) {
          clearPending();
          throw createUserFriendlyError(
            'The original save was not found and your administrator access changed. Close this form and reopen the current details.',
          );
        }
      } else {
        const source = preparation.current ?? {
          ...editor,
          documents: editor.documents.filter((row) => row.file || row.snapshot),
        };
        const checkPreparation = () => {
          guard();
          if (!read.current.ready) throw createUserFriendlyError('Refresh the class rights before saving.');
          if (
            source.appointment !== read.current.appointment ||
            source.previousRevision !== (read.current.current?.revision ?? 0)
          ) {
            clearPending();
            throw createUserFriendlyError('The class rights changed. Close this form and reopen the current details.');
          }
        };
        checkPreparation();
        preparation.current = source;
        setHeld(true);
        const documents: ClassRightsDocument[] = [];
        for (const document of source.documents) {
          if (document.snapshot) {
            documents.push(document.snapshot);
            continue;
          }
          const file = document.file!;
          let upload = uploads.current.get(document.id);
          if (!upload || upload.file !== file) {
            upload = { file, key: crypto.randomUUID() };
            uploads.current.set(document.id, upload);
          }
          const uploadRequest = {
            companyId: company!,
            appointment: source.appointment,
            kind: 'class_rights' as const,
            idempotencyKey: upload.key,
          };
          checkPreparation();
          if (!upload.receipt) {
            const { data } = await uploadRegisterEvidence(
              apiClient,
              { ...uploadRequest, file },
              { ledovaSubmissionGuard: checkPreparation },
            );
            checkPreparation();
            if (!isRegisterEvidenceReceipt(data, uploadRequest, file.size))
              throw createUserFriendlyError(
                'The class document upload could not be confirmed. Retry the original save.',
              );
            upload.receipt = data;
          }
          const evidence = upload.receipt;
          documents.push({
            evidence: evidence.uuid,
            company: company!,
            providedBy: 'company',
            documentType: 'class_rights',
            name: evidence.originalFilename,
            fileSize: evidence.fileSize,
            mimeType: evidence.mimeType,
            sha256: evidence.sha256,
          });
        }
        documents.sort((left, right) => left.evidence.localeCompare(right.evidence));
        expectedDocuments.current = documents;
        request = {
          appointment: source.appointment,
          previousRevision: source.previousRevision,
          summary: source.summary.trim(),
          attributes: cleanRightsAttributes(source.attributes),
          effectiveDate: source.effectiveDate || null,
          documents: documents.map((document) => document.evidence),
          idempotencyKey: crypto.randomUUID(),
        };
        pending.current = request;
      }
      if (!receipt) {
        guard();
        ({ data: receipt } = await recordClassRights(apiClient, token, request, { ledovaSubmissionGuard: guard }));
        guard();
        if (!matchesReceipt(receipt, request, token, expectedDocuments.current))
          throw createUserFriendlyError('The class rights receipt could not be confirmed. Retry the original save.');
      }
      clearPending();
      setEditor(null);
      setOutcome('Class rights saved.');
      await query.refetch();
    } catch (failure) {
      try {
        guard();
        const status = failureStatus(failure);
        if (status !== undefined && status >= 400 && status < 500) {
          clearPending();
          void query.refetch();
        }
        setError(failureSentence(failure, 'The class rights could not be saved. Retry the original save.'));
      } catch {
        return;
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const download = async (revision: ClassRightsRevision, document: ClassRightsDocument) => {
    if (running.current || !ready || held) return;
    running.current = true;
    setBusy(true);
    setDownloading(`${revision.uuid}/${document.evidence}`);
    setError('');
    try {
      guard();
      const { data } = await downloadClassRightsFile(
        apiClient,
        token,
        { revision: revision.uuid, evidence: document.evidence },
        { ledovaSubmissionGuard: guard },
      );
      guard();
      saveFile(data, document.name);
    } catch (failure) {
      try {
        guard();
        setError(failureSentence(failure, 'The class document could not be downloaded. Try again.'));
      } catch {
        return;
      }
    } finally {
      running.current = false;
      if (mounted.current) {
        setBusy(false);
        setDownloading(null);
      }
    }
  };
  return {
    query,
    tokenReady,
    ready,
    hasError: preferences.isError || (enabled && (query.isError || !coherent)),
    isRefreshing: preferences.isFetching || query.isFetching,
    retry: () => (preferences.isError ? preferences.refetch() : query.refetch()),
    current,
    appointment,
    revisions: ready ? (query.data?.pages.flatMap((page) => page.results) ?? []) : [],
    count: ready ? (first?.count ?? 0) : 0,
    editor,
    setEditor,
    pending: held,
    stale,
    busy,
    error,
    outcome,
    open,
    close,
    save,
    download,
    downloading,
  };
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { downloadClassRightsFile, getClassRights } from '../services/class-rights';
import type { ClassRightsDocument, ClassRightsRevision } from '../types';
import { classRightsTerms, isRightsAttributes, rightsWithoutConditions } from '../utils/class-rights';
import { isCalendarDate } from '../utils/date';
import { downloadedFile, type FileDelivery } from '../utils/downloads';
import { createUserFriendlyError, failureSentence } from '../utils/errors';
import { assertNextPageAdvances, getNextPageParam } from '../utils/pagination';
import { isUuid } from '../utils/validation';
import { useApiClient } from './useApiClient';
import { useClassRightsWriter } from './useClassRightsWriter';
import { registerClassesKey } from './useCompanyOwnership';
import { shareClassKey } from './useShareClass';
import { useSubmissionOwner, type OrderSubmissionOwner, type OrderSubmissionSession } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY, useUserPreferences } from './useUserPreferences';

export function classRightsKey(owner: OrderSubmissionOwner | null, token: string) {
  return ['class-rights', owner?.userUuid, owner?.ownerAccountUuid, token];
}

const DOWNLOAD_FAILED = 'The class document could not be downloaded. Try again.';

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

export function useClassRights(
  token: string,
  tokenReady: boolean,
  company: string | undefined,
  files: FileDelivery,
  newKey: () => string,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  const { owner, boundary } = useSubmissionOwner(session);
  const queryClient = useQueryClient();
  const preferences = useUserPreferences();
  const mounted = useRef(true);
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
  const config = (ledovaSubmissionGuard: () => void) => ({ ...session?.requestConfig(), ledovaSubmissionGuard });
  const query = useInfiniteQuery({
    queryKey: classRightsKey(owner, token),
    enabled,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      guard();
      const { data } = await getClassRights(apiClient, token, { page: pageParam }, config(guard));
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
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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
  const writer = useClassRightsWriter({
    guard: () => {
      guard();
      if (!read.current.ready) throw createUserFriendlyError('Refresh the class rights before saving.');
    },
    newKey,
    session,
    resolveTarget: () => {
      if (!read.current.ready) throw createUserFriendlyError('Refresh the class rights before saving.');
      return {
        token,
        company: company!,
        appointment: read.current.appointment ?? '',
        previousRevision: read.current.current?.revision ?? 0,
      };
    },
    checkTarget: (target, draft) => {
      if (!read.current.ready) throw createUserFriendlyError('Refresh the class rights before saving.');
      if (
        target.token !== token ||
        target.company !== company ||
        target.appointment !== read.current.appointment ||
        target.previousRevision !== (read.current.current?.revision ?? 0) ||
        draft.appointment !== target.appointment ||
        draft.previousRevision !== target.previousRevision
      )
        return false;
    },
    onSaved: async () => {
      await query.refetch();
      await queryClient.invalidateQueries({ queryKey: registerClassesKey(owner), refetchType: 'none' });
      await queryClient.invalidateQueries({
        queryKey: [...shareClassKey(token), owner?.userUuid, owner?.ownerAccountUuid],
        exact: true,
      });
    },
    onRefused: () => {
      void query.refetch();
    },
  });
  const { editor, running } = writer;
  const stale =
    !!editor && ready && (editor.previousRevision !== (current?.revision ?? 0) || editor.appointment !== appointment);
  const open = () => {
    guard();
    if (!ready || !appointment || running.current) return;
    writer.open({
      appointment,
      previousRevision: current?.revision ?? 0,
      attributes: rightsWithoutConditions(current?.attributes ?? {}),
      effectiveDate: current?.effectiveDate ?? '',
      summary: classRightsTerms(current?.attributes ?? {}, current?.summary ?? ''),
      documents: (current?.documents ?? []).map((snapshot) => ({ id: snapshot.evidence, file: null, snapshot })),
    });
  };
  const download = async (revision: ClassRightsRevision, document: ClassRightsDocument) => {
    if (running.current || !ready || writer.pending) return;
    running.current = true;
    setDownloading(`${revision.uuid}/${document.evidence}`);
    writer.setError('');
    try {
      guard();
      const response = await downloadClassRightsFile(
        apiClient,
        token,
        { revision: revision.uuid, evidence: document.evidence },
        { ...config(guard), ...(files.responseType ? { responseType: files.responseType } : {}) },
      );
      guard();
      const file = downloadedFile(response);
      if (!file) throw createUserFriendlyError(DOWNLOAD_FAILED);
      await Promise.resolve(files.save(file.data, document.name, file.type)).catch(() => {
        throw createUserFriendlyError(DOWNLOAD_FAILED);
      });
    } catch (failure) {
      try {
        guard();
        writer.setError(failureSentence(failure, DOWNLOAD_FAILED));
      } catch {
        return;
      }
    } finally {
      running.current = false;
      if (mounted.current) {
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
    setEditor: writer.setEditor,
    pending: writer.pending,
    stale,
    busy: writer.busy || !!downloading,
    error: writer.error,
    outcome: writer.outcome,
    open,
    close: writer.close,
    save: writer.save,
    download,
    downloading,
  };
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  USER_PREFERENCES_QUERY_KEY,
  assertNextPageAdvances,
  createUserFriendlyError,
  failureSentence,
  failureStatus,
  getClassRights,
  getNextPageParam,
  recordClassRights,
  useSubmissionOwner,
  useUserPreferences,
  type ClassRightsRequest,
  type ClassRightsRevision,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { READ_TIMING } from '@hooks/useRegisterAccess';
import apiClient from '@services/apiClient';

export function classRightsKey(owner: OrderSubmissionOwner | null, token: string) {
  return ['class-rights', owner?.userUuid, owner?.ownerAccountUuid, token];
}

type Editor = Omit<ClassRightsRequest, 'idempotencyKey'>;

function matchesReceipt(receipt: ClassRightsRevision, request: ClassRightsRequest, token: string) {
  return (
    receipt.token === token &&
    receipt.idempotencyKey === request.idempotencyKey &&
    receipt.appointment === request.appointment &&
    receipt.revision === request.previousRevision + 1 &&
    receipt.summary === request.summary &&
    receipt.documentReference === request.documentReference
  );
}

export function useClassRights(token: string, tokenReady: boolean) {
  const { owner, boundary } = useSubmissionOwner();
  const queryClient = useQueryClient();
  const preferences = useUserPreferences();
  const mounted = useRef(true);
  const pending = useRef<ClassRightsRequest | null>(null);
  const running = useRef(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
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
      if (data.results.some((revision) => revision.token !== token) || (data.current && data.current.token !== token))
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
  const hold = (request: ClassRightsRequest | null) => {
    pending.current = request;
    setHeld(request !== null);
  };
  const stale =
    !!editor && ready && (editor.previousRevision !== (current?.revision ?? 0) || editor.appointment !== appointment);
  const open = () => {
    guard();
    if (!ready || !appointment || pending.current) return;
    setError('');
    setOutcome('');
    setEditor({
      appointment,
      previousRevision: current?.revision ?? 0,
      summary: current?.summary ?? '',
      documentReference: current?.documentReference ?? '',
    });
  };
  const close = () => {
    if (running.current || pending.current) return;
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
        receipt = data.results.find((revision) => matchesReceipt(revision, request!, token));
        if (!receipt && data.results.length)
          throw createUserFriendlyError('The original class rights receipt did not match. Retry the original save.');
        if (!receipt && data.administrationAppointment !== request.appointment) {
          hold(null);
          throw createUserFriendlyError(
            'The original save was not found and your administrator access changed. Close this form and reopen the current details.',
          );
        }
      } else {
        if (
          editor.appointment !== read.current.appointment ||
          editor.previousRevision !== (read.current.current?.revision ?? 0)
        )
          throw createUserFriendlyError('The class rights changed. Close this form and reopen the current details.');
        request = {
          ...editor,
          summary: editor.summary.trim(),
          documentReference: editor.documentReference.trim(),
          idempotencyKey: crypto.randomUUID(),
        };
        hold(request);
      }
      if (!receipt) {
        guard();
        ({ data: receipt } = await recordClassRights(apiClient, token, request, { ledovaSubmissionGuard: guard }));
        guard();
        if (!matchesReceipt(receipt, request, token))
          throw createUserFriendlyError('The class rights receipt could not be confirmed. Retry the original save.');
      }
      hold(null);
      setEditor(null);
      setOutcome('Class rights saved.');
      await query.refetch();
    } catch (failure) {
      try {
        guard();
        const status = failureStatus(failure);
        if (status !== undefined && status >= 400 && status < 500) {
          hold(null);
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
  };
}

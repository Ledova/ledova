import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { flushSync } from 'react-dom';
import {
  apiErrorSentence,
  createUserFriendlyError,
  deleteCompanyToken,
  failureStatus,
  getCompanyToken,
  registerClassesKey,
  registerHoldersKey,
  updateCompanyToken,
  type CompanyShareToken,
  type CompanyShareTokenUpdate,
  type OrderSubmissionOwner,
  type useShareClass,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';

type Editor = {
  target: CompanyShareToken;
  draft: Pick<CompanyShareTokenUpdate, 'name' | 'symbol' | 'tokenType'>;
};
type Attempt = {
  target: CompanyShareToken;
  changes?: CompanyShareTokenUpdate;
  uncertain: boolean;
};

export function useClassDetails(
  data: ReturnType<typeof useShareClass>,
  owner: OrderSubmissionOwner,
  available: boolean,
  onHeldChange: (held: boolean) => void,
) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const mounted = useRef(true);
  const running = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<CompanyShareToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  const current = useRef({ token: data.token.data, available, guard: data.guard });
  useLayoutEffect(() => {
    current.current = { token: data.token.data, available, guard: data.guard };
  }, [data.token.data, available, data.guard]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const held = !!editor || !!deleting || pending || busy;
  useEffect(() => {
    onHeldChange(held);
    return () => onHeldChange(false);
  }, [held, onHeldChange]);
  const guard = (target: CompanyShareToken, original = false) => {
    if (!mounted.current) throw createUserFriendlyError('This class action is closed. Reopen the share class.');
    current.current.guard();
    const token = current.current.token;
    if (!current.current.available || token?.uuid !== target.uuid || token.companyUuid !== target.companyUuid)
      throw createUserFriendlyError('Your current share class or company access could not be confirmed.');
    if (original && (token.updatedAt !== target.updatedAt || (deleting ? !token.canDelete : !token.canEditDetails)))
      throw createUserFriendlyError('The class changed. Cancel and review its current details before trying again.');
  };
  const invalidate = (detail = true) =>
    Promise.all([
      ...(detail ? [client.invalidateQueries({ queryKey: data.tokenKey })] : []),
      client.invalidateQueries({ queryKey: registerClassesKey(owner) }),
      client.invalidateQueries({ queryKey: registerHoldersKey(owner) }),
    ]);
  const leave = async (target: CompanyShareToken, confirmed: boolean) => {
    guard(target);
    attempt.current = null;
    flushSync(() => {
      setPending(false);
      setDeleting(null);
      setBusy(false);
    });
    current.current.guard();
    const place = registerPlace({ company: target.companyUuid });
    navigate(place.to, {
      state: {
        ...place.state,
        classNotice: confirmed
          ? 'Share class deleted.'
          : 'This share class is no longer available. Deletion was not confirmed.',
      },
    });
    await client.cancelQueries({ queryKey: data.tokenKey });
    client.removeQueries({ queryKey: data.tokenKey });
    await invalidate(false);
  };
  const saved = async (operation: Attempt, token: CompanyShareToken) => {
    guard(operation.target);
    if (
      token.uuid !== operation.target.uuid ||
      token.companyUuid !== operation.target.companyUuid ||
      token.company !== operation.target.company ||
      !token.updatedAt ||
      token.updatedAt === operation.target.updatedAt ||
      !operation.changes ||
      token.name !== operation.changes.name ||
      token.symbol !== operation.changes.symbol ||
      token.tokenType !== operation.changes.tokenType
    )
      throw createUserFriendlyError('The original class changes could not be confirmed. Check the original save.');
    client.setQueryData(data.tokenKey, token);
    attempt.current = null;
    setPending(false);
    setRetry(false);
    setEditor(null);
    setOutcome('Class details saved.');
    await invalidate();
  };
  const execute = async (operation: Attempt) => {
    if (running.current) return;
    try {
      guard(operation.target, true);
    } catch (failure) {
      setError(apiErrorSentence(failure, 'The class action is unavailable.', 'The class action is unavailable.'));
      return;
    }
    running.current = true;
    setBusy(true);
    setError('');
    setRetry(false);
    attempt.current = operation;
    try {
      const config = { ledovaSubmissionGuard: () => guard(operation.target, true) };
      if (operation.changes) {
        const response = await updateCompanyToken(apiClient, operation.target.uuid, operation.changes, config);
        await saved(operation, response.data);
      } else {
        const response = await deleteCompanyToken(
          apiClient,
          operation.target.uuid,
          { expected_updated_at: operation.target.updatedAt },
          config,
        );
        if (response.status !== 204) throw createUserFriendlyError('The original deletion could not be confirmed.');
        await leave(operation.target, true);
      }
    } catch (failure) {
      if (!mounted.current) return;
      const status = failureStatus(failure);
      const refused = status !== undefined && status >= 400 && status < 500;
      if (!refused || operation.uncertain) {
        operation.uncertain = true;
        setPending(true);
      } else {
        attempt.current = null;
        setPending(false);
        if ([403, 404, 409].includes(status)) void data.token.refetch();
      }
      setError(apiErrorSentence(failure, 'The class action could not be confirmed. Check the original request.'));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const recover = async () => {
    const operation = attempt.current;
    if (!operation || running.current) return;
    if (retry) return execute(operation);
    running.current = true;
    setBusy(true);
    setError('');
    try {
      guard(operation.target);
      const { data: token } = await getCompanyToken(apiClient, operation.target.uuid, {
        ledovaSubmissionGuard: () => guard(operation.target),
      });
      guard(operation.target);
      if (token.uuid !== operation.target.uuid || token.companyUuid !== operation.target.companyUuid)
        throw createUserFriendlyError('The current class reply did not match the original action.');
      if (operation.changes && token.updatedAt !== operation.target.updatedAt) {
        if (
          token.name === operation.changes.name &&
          token.symbol === operation.changes.symbol &&
          token.tokenType === operation.changes.tokenType
        )
          return await saved(operation, token);
        client.setQueryData(data.tokenKey, token);
        attempt.current = null;
        setPending(false);
        setError('The class changed after the original request. Cancel and review its current details.');
      } else if (token.updatedAt === operation.target.updatedAt) {
        setRetry(true);
        setError('The original result is not recorded. Retry the same request to confirm it safely.');
      } else {
        client.setQueryData(data.tokenKey, token);
        attempt.current = null;
        setPending(false);
        setError('The class changed. Cancel and review its current details before deleting it.');
      }
    } catch (failure) {
      if (!mounted.current) return;
      if (!operation.changes && failureStatus(failure) === 404) await leave(operation.target, false);
      else setError(apiErrorSentence(failure, 'The original result could not be checked. Try checking it again.'));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const open = (kind: 'edit' | 'delete') => {
    const token = current.current.token;
    if (!token || held) return;
    try {
      guard(token);
      if (kind === 'edit' ? !token.canEditDetails : !token.canDelete) return;
      setError('');
      setOutcome('');
      if (kind === 'delete') setDeleting(token);
      else setEditor({ target: token, draft: { name: token.name, symbol: token.symbol, tokenType: token.tokenType } });
    } catch (failure) {
      setError(apiErrorSentence(failure, 'The class action is unavailable.'));
    }
  };
  const close = () => {
    if (busy || pending) return;
    setEditor(null);
    setDeleting(null);
    setError('');
  };
  return {
    editor,
    setEditor,
    deleting,
    busy,
    pending,
    retry,
    error,
    outcome,
    held,
    open,
    close,
    recover,
    save: () =>
      editor &&
      execute({
        target: editor.target,
        changes: { ...editor.draft, name: editor.draft.name.trim(), expectedUpdatedAt: editor.target.updatedAt },
        uncertain: false,
      }),
    remove: () => deleting && execute({ target: deleting, uncertain: false }),
  };
}

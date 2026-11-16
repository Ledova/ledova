import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { deleteCompanyToken, getCompanyToken } from '../services/company-tokens';
import type { CompanyShareTokenListItem } from '../types';
import { apiErrorSentence, createUserFriendlyError, failureStatus } from '../utils/errors';
import { useApiClient } from './useApiClient';
import { registerClassesKey, registerHoldersKey } from './useCompanyOwnership';
import { importRegisterKey } from './useImportRegister';
import { registersQuery } from './useRegisters';
import { shareClassKey } from './useShareClass';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

type Target = Pick<CompanyShareTokenListItem, 'uuid' | 'companyUuid' | 'name' | 'symbol' | 'updatedAt'>;
type Removal = {
  targets: Target[];
  kept: Pick<CompanyShareTokenListItem, 'uuid' | 'name' | 'symbol' | 'deletionBlockedReason'>[];
  next: number;
  pending: boolean;
  retry: boolean;
  finished: boolean;
};

export function useClassDeletion({
  owner,
  company,
  classes,
  guard,
  available,
  onHeldChange,
  release = (update) => update(),
  session,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  classes: CompanyShareTokenListItem[];
  guard: () => void;
  available: boolean;
  onHeldChange: (held: boolean) => void;
  release?: (update: () => void) => void;
  session?: OrderSubmissionSession;
}) {
  const apiClient = useApiClient();
  const client = useQueryClient();
  const current = useRef({ company, classes, guard, available });
  const mounted = useRef(true);
  const running = useRef(false);
  const attempt = useRef<Removal | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  useLayoutEffect(() => {
    current.current = { company, classes, guard, available };
  }, [company, classes, guard, available]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onHeldChange(removal !== null);
    return () => onHeldChange(false);
  }, [removal !== null, onHeldChange]);
  const owned = () => {
    if (!mounted.current) return false;
    try {
      current.current.guard();
      return current.current.company === company;
    } catch {
      return false;
    }
  };
  const check = (target?: Target) => {
    if (!mounted.current) throw createUserFriendlyError('This class action is closed. Reopen Share classes.');
    current.current.guard();
    if (!current.current.available || current.current.company !== company || (target && target.companyUuid !== company))
      throw createUserFriendlyError('Your current company access could not be confirmed.');
  };
  const publish = (operation: Removal) => {
    if (owned()) setRemoval({ ...operation });
  };
  const execute = async () => {
    const operation = attempt.current;
    if (!operation || running.current || operation.finished) return;
    running.current = true;
    setBusy(true);
    setError('');
    operation.retry = false;
    let dispatched = false;
    try {
      while (operation.next < operation.targets.length) {
        dispatched = false;
        const target = operation.targets[operation.next];
        if (!target)
          throw createUserFriendlyError('The original class selection is unavailable. Reopen Share classes.');
        check(target);
        const live = current.current.classes.find(({ uuid }) => uuid === target.uuid);
        if (!live?.canDelete || live.updatedAt !== target.updatedAt)
          throw createUserFriendlyError('The class changed. Close and review the current selection.');
        dispatched = true;
        const response = await deleteCompanyToken(
          apiClient,
          target.uuid,
          { expected_updated_at: target.updatedAt },
          { ...session?.requestConfig(), ledovaSubmissionGuard: () => check(target) },
        );
        check(target);
        if (response.status !== 204) throw createUserFriendlyError('The original deletion could not be confirmed.');
        operation.next += 1;
        operation.pending = false;
        publish(operation);
      }
      operation.finished = true;
    } catch (failure) {
      if (!owned()) return;
      const status = failureStatus(failure);
      const refused = status !== undefined && status >= 400 && status < 500;
      operation.pending = operation.pending || (dispatched && !refused);
      operation.finished = !operation.pending;
      setError(apiErrorSentence(failure, 'Deletion stopped. Check the original request before continuing.'));
    } finally {
      running.current = false;
      if (owned()) {
        setBusy(false);
        publish(operation);
      }
    }
  };
  const recover = async () => {
    const operation = attempt.current;
    if (!operation || running.current || !operation.pending) return;
    if (operation.retry) return execute();
    const target = operation.targets[operation.next];
    if (!target) {
      setError('The original class selection is unavailable. Reopen Share classes.');
      return;
    }
    running.current = true;
    setBusy(true);
    setError('');
    try {
      check(target);
      const { data } = await getCompanyToken(apiClient, target.uuid, {
        ...session?.requestConfig(),
        ledovaSubmissionGuard: () => check(target),
      });
      check(target);
      if (data.uuid !== target.uuid || data.companyUuid !== company)
        throw createUserFriendlyError('The reply did not match the original share class.');
      if (data.updatedAt === target.updatedAt && data.canDelete) {
        operation.retry = true;
        setError('The original result is not recorded. Retry the same deletion safely.');
      } else {
        operation.pending = false;
        operation.finished = true;
        setError('The class changed. Close and review the current selection.');
      }
    } catch (failure) {
      if (!owned()) return;
      if (failureStatus(failure) === 404) {
        operation.pending = false;
        operation.finished = true;
        setError(
          `${target.name} is no longer available. Its deletion was not confirmed. Remaining classes were not sent.`,
        );
      } else setError(apiErrorSentence(failure, 'The original deletion could not be checked. Try checking it again.'));
    } finally {
      running.current = false;
      if (owned()) {
        setBusy(false);
        publish(operation);
      }
    }
  };
  const close = async () => {
    const operation = attempt.current;
    if (!operation || running.current || operation.pending || !owned()) return false;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      if (operation.finished || operation.next > 0) {
        const keys = operation.targets.flatMap((target) => [
          [...shareClassKey(target.uuid), owner.userUuid, owner.ownerAccountUuid],
          importRegisterKey(owner, target.uuid),
        ]);
        await Promise.all([
          client.cancelQueries({ queryKey: registerHoldersKey(owner) }),
          ...keys.map((queryKey) => client.cancelQueries({ queryKey, exact: true })),
        ]);
        for (const queryKey of keys) client.removeQueries({ queryKey, exact: true });
        await client.invalidateQueries({ queryKey: registerHoldersKey(owner), refetchType: 'none' });
        await client.invalidateQueries({ queryKey: registerClassesKey(owner) }, { throwOnError: true });
        if (!owned()) return false;
        const listed = client.getQueryData<CompanyShareTokenListItem[]>(registerClassesKey(owner));
        if (!listed) throw createUserFriendlyError('The current class list is unavailable. Try closing again.');
        const uuids = listed.filter((row) => row.companyUuid === company).map(({ uuid }) => uuid);
        if (uuids.length)
          await client.fetchQuery(registersQuery(apiClient, owner, uuids, current.current.guard, session));
      }
      if (!owned()) return false;
      attempt.current = null;
      setOutcome(
        operation.finished
          ? `${operation.next} ${operation.next === 1 ? 'share class' : 'share classes'} deleted.${operation.next < operation.targets.length ? ' Remaining classes were kept or need review.' : ''}`
          : '',
      );
      release(() => setRemoval(null));
      return true;
    } catch (failure) {
      if (owned()) setError(apiErrorSentence(failure, 'The class list could not be refreshed. Try closing again.'));
      return false;
    } finally {
      running.current = false;
      if (owned()) setBusy(false);
    }
  };
  return {
    removal,
    busy,
    error,
    outcome,
    execute,
    recover,
    close,
    open: (selected: ReadonlySet<string>) => {
      if (attempt.current || running.current) return;
      try {
        check();
        const chosen = current.current.classes.filter((row) => row.companyUuid === company && selected.has(row.uuid));
        const targets = chosen
          .filter((row) => row.canDelete)
          .map(({ uuid, companyUuid, name, symbol, updatedAt }) => ({ uuid, companyUuid, name, symbol, updatedAt }));
        if (!targets.length) return;
        const kept = chosen
          .filter((row) => !row.canDelete)
          .map(({ uuid, name, symbol, deletionBlockedReason }) => ({ uuid, name, symbol, deletionBlockedReason }));
        attempt.current = { targets, kept, next: 0, pending: false, retry: false, finished: false };
        setError('');
        setOutcome('');
        publish(attempt.current);
      } catch (failure) {
        if (owned()) setError(apiErrorSentence(failure, 'The class selection is unavailable.'));
      }
    },
  };
}

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { deleteRegisterEntry } from '../services/register-entries';
import type { RegisterEntry } from '../types';
import { createUserFriendlyError, failureSentence } from '../utils/errors';
import { entryWithPeople } from '../utils/register-entries';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function useRegisterEntryDeletion({
  owner,
  token,
  guard,
  session,
}: {
  owner: OrderSubmissionOwner;
  token: string;
  guard: () => void;
  session?: OrderSubmissionSession;
}) {
  const apiClient = useApiClient();
  const client = useQueryClient();
  const live = useRef(true);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const remove = async (entry: RegisterEntry) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setOutcome('');
    try {
      guard();
      const response = await deleteRegisterEntry(apiClient, token, entry.uuid, {
        ...session?.requestConfig(),
        ledovaSubmissionGuard: guard,
      });
      guard();
      if (response.status !== 204) throw createUserFriendlyError('The deletion could not be confirmed. Refresh first.');
      await client.invalidateQueries({ queryKey: registerKey(owner) });
      const name = entryWithPeople(entry);
      if (live.current) setOutcome(`${name.charAt(0).toUpperCase()}${name.slice(1)} deleted.`);
    } catch (failure) {
      try {
        guard();
        void client.invalidateQueries({ queryKey: registerKey(owner) });
        if (live.current) setError(failureSentence(failure, 'The entry could not be deleted. Refresh and try again.'));
      } catch {
        return;
      }
    } finally {
      running.current = false;
      if (live.current) setBusy(false);
    }
  };
  return { remove, busy, error, outcome };
}

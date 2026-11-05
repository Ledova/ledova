import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { submitCompanyAuthorityRequest } from '../services/company-authority';
import type { CompanyAuthorityRequest, CompanyCapability, CompanyListItem, UploadFile } from '../types';
import { isCalendarDate, utcToday } from '../utils/date';
import { useApiClient } from './useApiClient';
import { hasProblems, type Problems } from './useErrorSummary';
import type { OrderSubmissionSession } from './useSubmissionOwner';

export function useAuthorityRequestForm({
  company,
  disabled,
  guard,
  onSuccess,
  incomplete = {},
  session,
  newKey = () => crypto.randomUUID(),
}: {
  company: CompanyListItem;
  disabled: boolean;
  guard: () => void;
  onSuccess: (request: CompanyAuthorityRequest) => void;
  incomplete?: Partial<Record<'expiry', boolean>>;
  session?: OrderSubmissionSession;
  newKey?: () => string;
}) {
  const apiClient = useApiClient();
  const [file, setFile] = useState<UploadFile | null>(null);
  const [requested, setRequested] = useState<CompanyCapability[]>(['admin']);
  const [delegatable, setDelegatable] = useState<CompanyCapability[]>([]);
  const [expiry, setExpiry] = useState('');
  const key = useRef<string | null>(null);
  const submitting = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (!active.current) throw new Error('The selected company changed. Reopen the request to continue.');
  };
  const submission = useMutation({
    mutationFn: async () => {
      check();
      key.current ??= newKey();
      const response = await submitCompanyAuthorityRequest(
        apiClient,
        {
          company: company.uuid,
          ...(file ? { file } : {}),
          idempotencyKey: key.current,
          requestedCapabilities: requested,
          delegatableCapabilities: delegatable,
          ...(expiry ? { requestedExpiresAt: `${expiry}T23:59:59Z` } : {}),
        },
        { ...session?.requestConfig(), ledovaSubmissionGuard: check },
      );
      check();
      return response;
    },
    onSuccess: ({ data }) => onSuccess(data),
  });
  const change = (apply: () => void) => {
    key.current = null;
    submission.reset();
    apply();
  };
  const busy = submission.isPending;
  const available = !disabled && !busy;
  const problems: Problems<'actions' | 'expiry'> = {
    actions: !requested.length && !delegatable.length && 'Choose at least one action to request or to delegate.',
    expiry:
      (incomplete.expiry || (!!expiry && (!isCalendarDate(expiry) || expiry < utcToday()))) &&
      'Enter a requested expiry no earlier than today (UTC), or clear it.',
  };
  const toggle = (values: CompanyCapability[], value: CompanyCapability) =>
    values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value].sort();
  const send = async () => {
    if (!available || hasProblems(problems) || submitting.current) return;
    submitting.current = true;
    try {
      await submission.mutateAsync();
    } catch {
      return;
    } finally {
      submitting.current = false;
    }
  };
  return {
    file,
    setFile,
    requested,
    setRequested,
    delegatable,
    setDelegatable,
    expiry,
    setExpiry,
    submission,
    change,
    busy,
    problems,
    toggle,
    send,
  };
}

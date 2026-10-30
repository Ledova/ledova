import {
  assertSessionSettled,
  isCalendarDate,
  submitCompanyAuthorityRequest,
  type CompanyAuthorityRequest,
  type CompanyCapability,
  type CompanyListItem,
  utcToday,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { hasProblems, type Problems } from '@hooks/useErrorSummary';
import { useIncompleteDates } from '@hooks/useIncompleteDates';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

export function useAuthorityRequestForm({
  company,
  disabled,
  guard,
  onSuccess,
}: {
  company: CompanyListItem;
  disabled: boolean;
  guard: () => void;
  onSuccess: (request: CompanyAuthorityRequest) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
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
  const client = useQueryClient();
  const check = () => {
    guard();
    if (!active.current) throw new Error('The selected company changed. Reopen the request to continue.');
  };
  const sendCheck = () => {
    check();
    assertSessionSettled(client);
  };
  const submission = useMutation({
    mutationFn: async () => {
      sendCheck();
      key.current ??= crypto.randomUUID();
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
        { ledovaSubmissionGuard: sendCheck },
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
  const dates = useIncompleteDates<'expiry'>();
  const problems: Problems<'actions' | 'expiry'> = {
    actions: !requested.length && !delegatable.length && 'Choose at least one action to request or to delegate.',
    expiry:
      (dates.incomplete.expiry || (!!expiry && (!isCalendarDate(expiry) || expiry < utcToday()))) &&
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
    watchDate: dates.watch,
    toggle,
    send,
  };
}

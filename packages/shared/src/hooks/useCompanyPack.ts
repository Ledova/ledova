import { useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createCompanyPack } from '../services/companies';
import type { CompanyPackRequest, OwnCompanyAppointment } from '../types';
import { downloadedFile, downloadedText, type FileDelivery } from '../utils/downloads';
import { apiErrorSentence } from '../utils/errors';
import { appointmentForRegisterStep } from '../utils/register-commands';
import { useApiClient } from './useApiClient';
import { hasProblems, type Problems } from './useErrorSummary';
import { ownAppointmentsKey, useOwnAppointments } from './useOwnAppointments';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY } from './useUserPreferences';

const FAILED =
  'The company pack could not be downloaded. Check your current company appointment and try again. A full pack is unavailable when it includes unsupported records; use supported inspection copies or unsigned certificates where applicable.';

async function failureMessage(cause: unknown) {
  const response = (cause as { response?: { status?: number; data?: unknown; headers?: unknown } })?.response;
  const body = response && downloadedFile(response);
  if (response && body) {
    if (body.size > 65536 || body.type.split(';')[0] !== 'application/json') return FAILED;
    try {
      return apiErrorSentence({ response: { ...response, data: JSON.parse(await downloadedText(body)) } }, FAILED);
    } catch {
      return FAILED;
    }
  }
  return apiErrorSentence(cause, FAILED, FAILED);
}

function administrator(rows: OwnCompanyAppointment[], company: string) {
  return appointmentForRegisterStep(
    rows.filter((row) => row.capabilities.includes('admin')),
    company,
    'prepare',
  );
}

export function useCompanyPackAuthority({
  owner,
  guard,
  company,
  session,
  available = true,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  session?: OrderSubmissionSession;
  available?: boolean;
}) {
  const client = useQueryClient();
  const sourceAvailable = useRef(available);
  useLayoutEffect(() => {
    sourceAvailable.current = available;
  }, [available]);
  const appointments = useOwnAppointments(owner, guard, { session });
  const appointment =
    appointments.isSuccess && !appointments.isFetching ? administrator(appointments.data, company) : undefined;
  const check = () => {
    guard();
    const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    const state = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
    if (
      !sourceAvailable.current ||
      preferences?.status !== 'success' ||
      preferences.fetchStatus !== 'idle' ||
      !appointment ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      administrator(state.data ?? [], company)?.uuid !== appointment.uuid
    )
      throw new Error('The company appointment changed. Reopen the pack request.');
  };
  return { appointments, appointment, check };
}

export function useCompanyPack({
  company,
  appointment,
  guard,
  sourceReady,
  onDownloaded,
  files,
  session,
}: {
  company: string;
  appointment: string;
  guard: () => void;
  sourceReady: boolean;
  onDownloaded?: () => void;
  files: FileDelivery;
  session?: OrderSubmissionSession;
}) {
  const apiClient = useApiClient();
  const [instruction, setInstruction] = useState('');
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
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
  const missing = (value: string) => !value.trim() || value.trim().length > 255;
  const problems: Problems<'instruction' | 'recipient'> = {
    instruction: missing(instruction) && 'Give the pack instruction reference.',
    recipient: missing(recipient) && 'Give the pack recipient.',
  };
  const download = async () => {
    if (pending.current || !sourceReady || hasProblems(problems)) return;
    pending.current = true;
    const controller = new AbortController();
    transport.current = controller;
    const check = () => {
      guard();
      if (!mounted.current || !sourceReady || controller.signal.aborted)
        throw new Error('The company pack request changed.');
    };
    const request: Readonly<CompanyPackRequest> = Object.freeze({
      appointment,
      instruction: instruction.trim(),
      recipient: recipient.trim(),
    });
    setBusy(true);
    setError('');
    setDownloaded(false);
    try {
      check();
      const response = await createCompanyPack(apiClient, company, request, {
        ...session?.requestConfig(),
        responseType: files.responseType ?? 'blob',
        signal: controller.signal,
        ledovaSubmissionGuard: check,
      });
      check();
      const file = downloadedFile(response);
      if (!file || (file.type.split(';')[0] ?? '').trim().toLowerCase() !== 'application/zip' || file.size === 0)
        throw new Error('The company pack response is not a ZIP archive.');
      await files.save(file.data, `company-pack-${company}.zip`, file.type);
      setDownloaded(true);
      onDownloaded?.();
    } catch (cause) {
      const message = await failureMessage(cause);
      if (mounted.current) setError(message);
    } finally {
      pending.current = false;
      if (transport.current === controller) transport.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  return { instruction, setInstruction, recipient, setRecipient, busy, error, downloaded, problems, download };
}

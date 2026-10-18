import { useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  apiErrorSentence,
  appointmentForRegisterStep,
  createCompanyPack,
  USER_PREFERENCES_QUERY_KEY,
  type CompanyPackRequest,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';

import { saveFile } from '@utils/saveFile';
import { useOwnAppointments, ownAppointmentsKey } from '@pages/company/shared/useOwnAppointments';

const FAILED =
  'The company pack could not be downloaded. Refresh your appointment and try again. A full pack is unavailable when it includes unsupported records; use supported inspection copies or unsigned certificates where applicable.';

async function failureMessage(cause: unknown) {
  const response = (cause as { response?: { status?: number; data?: unknown } })?.response;
  if (response?.data instanceof Blob) {
    if (response.data.size > 65536 || response.data.type.split(';')[0] !== 'application/json') return FAILED;
    try {
      return apiErrorSentence({ response: { ...response, data: JSON.parse(await response.data.text()) } }, FAILED);
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

export function CompanyPack({
  owner,
  guard,
  company,
  sourceReady,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  sourceReady: boolean;
}) {
  const client = useQueryClient();
  const appointments = useOwnAppointments(owner, guard);
  const appointment =
    appointments.isSuccess && !appointments.isFetching ? administrator(appointments.data, company) : undefined;
  const check = () => {
    guard();
    const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    const state = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
    if (
      preferences?.status !== 'success' ||
      preferences.fetchStatus !== 'idle' ||
      !appointment ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      administrator(state.data ?? [], company)?.uuid !== appointment.uuid
    )
      throw new Error('The company appointment changed. Reopen the pack request.');
  };
  return (
    <Section title="Company pack">
      <p className="text-sm text-text-muted">
        This company ZIP includes residential addresses and private records. Current company administration, a written
        instruction and a named recipient are required; the captured records and generation time are retained.
      </p>
      <details className="text-sm text-text-muted">
        <summary className="cursor-pointer">Included records and limitations</summary>
        <p className="mt-2">
          Packs include non-tokenised registers, employee awards and fully paid external allotments. Unsupported records
          make the whole archive unavailable; use supported inspection copies or unsigned certificates instead.
        </p>
      </details>
      {appointment ? (
        <PackForm
          key={JSON.stringify([company, appointment.uuid, sourceReady])}
          company={company}
          appointment={appointment.uuid}
          guard={check}
          sourceReady={sourceReady}
        />
      ) : (
        <p className="text-sm text-text-muted">A current administrator appointment for this company is required.</p>
      )}
      <PageAction
        label="Refresh pack appointment"
        disabled={appointments.isFetching || !sourceReady}
        onClick={() => void appointments.refetch()}
      />
    </Section>
  );
}

function PackForm({
  company,
  appointment,
  guard,
  sourceReady,
}: {
  company: string;
  appointment: string;
  guard: () => void;
  sourceReady: boolean;
}) {
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
  const valid = [instruction, recipient].every((value) => !!value.trim() && value.trim().length <= 255);
  const download = async () => {
    if (pending.current || !sourceReady || !valid) return;
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
      const { data } = await createCompanyPack(apiClient, company, request, {
        signal: controller.signal,
        ledovaSubmissionGuard: check,
      });
      check();
      if (
        !(data instanceof Blob) ||
        data.type.split(';')[0].trim().toLowerCase() !== 'application/zip' ||
        data.size === 0
      )
        throw new Error('The company pack response is not a ZIP archive.');
      saveFile(data, `company-pack-${company}.zip`);
      setDownloaded(true);
    } catch (cause) {
      const message = await failureMessage(cause);
      if (mounted.current) setError(message);
    } finally {
      pending.current = false;
      if (transport.current === controller) transport.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 pt-3">
      <fieldset disabled={busy || !sourceReady} className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-text-primary">
          Pack instruction reference
          <input
            className={FIELD_CLASS}
            maxLength={255}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
        <label className="block text-sm text-text-primary">
          Pack recipient
          <input
            className={FIELD_CLASS}
            maxLength={255}
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
          />
        </label>
      </fieldset>
      <PageAction
        primary
        label={busy ? 'Preparing company pack…' : 'Prepare and download company pack'}
        disabled={busy || !sourceReady || !valid}
        onClick={() => void download()}
      />
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      {downloaded && (
        <p role="status" className="text-sm text-text-muted">
          The company pack was downloaded.
        </p>
      )}
    </div>
  );
}

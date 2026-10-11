import { useLayoutEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Buffer } from 'buffer';
import * as Sharing from 'expo-sharing';
import {
  apiErrorSentence,
  appointmentForRegisterStep,
  createCompanyPackBytes,
  createUserFriendlyError,
  useSubmissionOwner,
  USER_PREFERENCES_QUERY_KEY,
  type CompanyPackRequest,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { apiClient } from '../../services/apiClient';
import { shareDocumentCopy } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { assertSessionEpoch } from '../../services/sessionScope';
import { useCompanyStyles } from './styles';
import { registerAppointmentsKey, useRegisterAppointments } from './useCompanyRegister';

const FAILED =
  'The company pack could not be shared. Refresh your appointment and try again. A full pack is unavailable when it includes unsupported records; use supported inspection copies or unsigned certificates where applicable.';

function failureMessage(cause: unknown) {
  const response = (cause as { response?: { status?: number; data?: unknown; headers?: Record<string, unknown> } })
    ?.response;
  if (response?.data instanceof ArrayBuffer) {
    if (
      response.data.byteLength > 65536 ||
      String(response.headers?.['content-type']).split(';')[0] !== 'application/json'
    )
      return FAILED;
    try {
      return apiErrorSentence(
        { response: { ...response, data: JSON.parse(Buffer.from(response.data).toString('utf8')) } },
        FAILED,
      );
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

type Source = { epoch: number; company: string; name: string; disabled: boolean };

export function CompanyPack(source: Source) {
  const ownership = useSubmissionOwner(orderSubmissionSession);
  const styles = useCompanyStyles();
  return (
    <Section title="Company pack">
      <Text style={styles.muted}>
        The full company ZIP includes residential addresses and private company material. Preparation requires current
        company administration. The written instruction and recipient are recorded. The archive describes the captured
        records as at its generation time. Packs support non-tokenised core registers, employee awards and fully paid
        external allotments. If unsupported records are included, the whole archive is unavailable. Use supported
        inspection copies or unsigned certificates where applicable.
      </Text>
      {ownership.owner ? (
        <PackAppointments
          key={JSON.stringify([source.epoch, source.company, ownership.owner])}
          {...source}
          ownership={ownership}
        />
      ) : (
        <Text style={styles.muted}>Sign in again to prepare a company pack.</Text>
      )}
    </Section>
  );
}

function PackAppointments({ ownership, ...source }: Source & { ownership: ReturnType<typeof useSubmissionOwner> }) {
  const { appointments } = useRegisterAppointments(source.epoch, source.company);
  const client = useQueryClient();
  const styles = useCompanyStyles();
  const appointment =
    appointments.isSuccess && !appointments.isFetching ? administrator(appointments.data, source.company) : undefined;
  const check = () => {
    assertSessionEpoch(source.epoch);
    if (!ownership.owner || ownership.boundary.get() !== ownership.owner)
      throw new Error('The signed-in account changed.');
    const state = client.getQueryState<OwnCompanyAppointment[]>(registerAppointmentsKey(source.epoch));
    const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    if (
      preferences?.status !== 'success' ||
      preferences.fetchStatus !== 'idle' ||
      !appointment ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      administrator(state.data ?? [], source.company)?.uuid !== appointment.uuid
    )
      throw new Error('The company appointment changed. Reopen the pack request.');
  };
  return (
    <>
      {appointment ? (
        <PackForm
          key={JSON.stringify([appointment.uuid, source.disabled])}
          {...source}
          appointment={appointment.uuid}
          guard={check}
        />
      ) : (
        <Text style={styles.muted}>A current administrator appointment for this company is required.</Text>
      )}
      <Action
        label="Refresh pack appointment"
        disabled={appointments.isFetching || source.disabled}
        onPress={() => void appointments.refetch()}
      />
    </>
  );
}

function PackForm({
  epoch,
  company,
  name,
  disabled,
  appointment,
  guard,
}: Source & { appointment: string; guard: () => void }) {
  const styles = useCompanyStyles();
  const [visible, setVisible] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [recipient, setRecipient] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const mounted = useRef(true);
  const opened = useRef(false);
  const revision = useRef(0);
  const pending = useRef(false);
  const transport = useRef<AbortController | null>(null);
  const retire = () => {
    opened.current = false;
    revision.current++;
    transport.current?.abort();
  };
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      retire();
    };
  }, []);
  const valid = [instruction, recipient].every((value) => !!value.trim() && value.trim().length <= 255);
  const share = async () => {
    if (pending.current || disabled || !valid) return;
    pending.current = true;
    const controller = new AbortController();
    transport.current = controller;
    const captured = revision.current;
    const check = () => {
      guard();
      if (!mounted.current || !opened.current || disabled || revision.current !== captured || controller.signal.aborted)
        throw new Error('The company pack request changed.');
    };
    const request: Readonly<CompanyPackRequest> = Object.freeze({
      appointment,
      instruction: instruction.trim(),
      recipient: recipient.trim(),
    });
    setLoading(true);
    setError(null);
    setShared(false);
    try {
      check();
      if (!(await Sharing.isAvailableAsync()))
        throw createUserFriendlyError(
          'Sharing is unavailable on this device. Use the web Register to download this company pack.',
        );
      check();
      let sharedCopy = false;
      await shareDocumentCopy(
        epoch,
        async () => {
          check();
          const response = await createCompanyPackBytes(apiClient, company, request, {
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: check,
            signal: controller.signal,
          });
          check();
          const type = response.headers['content-type'];
          if (
            typeof type !== 'string' ||
            type.split(';')[0].trim().toLowerCase() !== 'application/zip' ||
            !(response.data instanceof ArrayBuffer) ||
            response.data.byteLength === 0
          )
            throw new Error('The company pack response is not a ZIP archive.');
          return { name: `company-pack-${company}.zip`, type: 'application/zip', bytes: new Uint8Array(response.data) };
        },
        async (uri, type) => {
          await Sharing.shareAsync(uri, { mimeType: type, UTI: 'public.zip-archive' });
          sharedCopy = true;
        },
        check,
      );
      check();
      if (!sharedCopy)
        throw createUserFriendlyError('Another document is being prepared. Wait for it to finish and try again.');
      setShared(true);
    } catch (cause) {
      if (mounted.current && opened.current) setError(failureMessage(cause));
    } finally {
      pending.current = false;
      if (transport.current === controller) transport.current = null;
      if (mounted.current) setLoading(false);
    }
  };
  return (
    <>
      <Action
        label="Prepare company pack"
        accessibilityLabel={`Prepare company pack for ${name}`}
        disabled={disabled || loading}
        onPress={() => {
          revision.current++;
          opened.current = true;
          setInstruction('');
          setRecipient('');
          setError(null);
          setShared(false);
          setVisible(true);
        }}
      />
      {visible && (
        <CustomModal
          visible
          title="Company pack"
          busy={loading}
          onClose={() => {
            retire();
            setVisible(false);
          }}
          actions={
            <Action
              label={loading ? 'Preparing company pack…' : 'Prepare and share company pack'}
              primary
              disabled={disabled || loading || !valid}
              onPress={() => void share()}
            />
          }
        >
          <Text style={styles.heading}>{name}</Text>
          <Text style={styles.muted}>
            Share this private ZIP only with the recorded recipient for the company’s permitted purpose. Packs support
            non-tokenised core registers, employee awards and fully paid external allotments. If unsupported records are
            included, the whole archive is unavailable. Use supported inspection copies or unsigned certificates where
            applicable.
          </Text>
          <View style={styles.group}>
            <Text style={styles.text}>Pack instruction reference</Text>
            <TextInput
              accessibilityLabel="Pack instruction reference"
              style={styles.input}
              value={instruction}
              maxLength={255}
              editable={!loading}
              onChangeText={setInstruction}
            />
            <Text style={styles.text}>Pack recipient</Text>
            <TextInput
              accessibilityLabel="Pack recipient"
              style={styles.input}
              value={recipient}
              maxLength={255}
              editable={!loading}
              onChangeText={setRecipient}
            />
          </View>
          {error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          {shared && <Text style={styles.muted}>The company pack was opened for sharing.</Text>}
        </CustomModal>
      )}
    </>
  );
}

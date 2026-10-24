import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  COMPANY_TOKEN_ENDPOINTS,
  REGISTER_MEMBER_DOCUMENT_CATEGORIES,
  appointmentForRegisterStep,
  createRegisterMemberDocument,
  createUserFriendlyError,
  failureSentence,
  failureStatus,
  getRegisterMemberDocuments,
  hasCurrentRegisterReadAuthority,
  isRegisterMemberDocumentReceipt,
  readEveryPage,
  type OwnCompanyAppointment,
  type RegisterMemberDocumentCategory,
  type RegisterMemberDocumentRequest,
} from '@ledova/shared';
import { Action, Choice, Section } from '../../components/Ledger';
import { EvidencePicker } from '../../components/register/RegisterFields';
import { RegisterCopy } from '../../components/register/RegisterCopy';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch } from '../../services/sessionScope';
import { registerAppointmentsKey, registerKey, useRegisterAppointments } from '../../hooks/useCompanyRegister';
import { useRegisterEvidence } from '../../hooks/useRegisterEvidence';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

export type DocumentHolding = { member: string; token: string; label: string };

type Editor = { member: string; token: string; category: RegisterMemberDocumentCategory };

export const memberDocumentsKey = (epoch: number, company: string) => [
  ...registerKey(epoch),
  'member-documents',
  company,
];

export function MemberDocuments({
  epoch,
  company,
  member,
  token,
  sourceReady,
  holdings,
}: {
  epoch: number;
  company: string;
  member?: string;
  token?: string;
  sourceReady: boolean;
  holdings: DocumentHolding[];
}) {
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const evidence = useRegisterEvidence(company, 'supporting');
  const { appointments } = useRegisterAppointments(epoch, company, sourceReady);
  const authorised =
    sourceReady && appointments.isSuccess && hasCurrentRegisterReadAuthority(appointments.data, company);
  const settled = authorised && appointments.fetchStatus === 'idle';
  const appointment = authorised ? appointmentForRegisterStep(appointments.data, company, 'prepare') : undefined;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  const running = useRef(false);
  const pending = useRef<RegisterMemberDocumentRequest | null>(null);
  const latest = useRef({ sourceReady, holdings });
  useLayoutEffect(() => {
    latest.current = { sourceReady, holdings };
  }, [sourceReady, holdings]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const check = () => {
    assertSessionEpoch(epoch);
    if (!live.current || !latest.current.sourceReady)
      throw createUserFriendlyError('Refresh the shareholder and share class before opening documents.');
    const state = client.getQueryState(registerAppointmentsKey(epoch));
    const current = client.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch));
    if (
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      !current ||
      !hasCurrentRegisterReadAuthority(current, company)
    )
      throw createUserFriendlyError('Current company register access is required to open documents.');
  };
  const checkPreparation = (expected: string, holding: Pick<Editor, 'member' | 'token'>) => {
    check();
    const current = client.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch)) ?? [];
    if (
      appointmentForRegisterStep(current, company, 'prepare')?.uuid !== expected ||
      !latest.current.holdings.some((row) => row.member === holding.member && row.token === holding.token)
    )
      throw createUserFriendlyError('Refresh your preparation appointment and the shareholder’s holding.');
  };
  const query = useQuery({
    queryKey: [...memberDocumentsKey(epoch, company), member ?? '', token ?? ''],
    enabled: settled,
    queryFn: ({ signal }) =>
      readEveryPage(async (page) => {
        check();
        const result = await getRegisterMemberDocuments(
          apiClient,
          { company, member, token, page },
          { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: check, signal },
        );
        check();
        return result;
      }),
  });
  const ready = settled && query.isSuccess && query.fetchStatus === 'idle';
  const label = (row: Pick<Editor, 'member' | 'token'>) =>
    holdings.find((holding) => holding.member === row.member && holding.token === row.token)?.label;
  const open = () => {
    if (!ready || !appointment || !holdings.length || pending.current) return;
    setError('');
    evidence.clear();
    setEditor({ member: holdings[0].member, token: holdings[0].token, category: 'other' });
  };
  const close = () => {
    if (running.current || pending.current) return;
    setError('');
    evidence.clear();
    setEditor(null);
  };
  const pick = async () => {
    setError('');
    try {
      await evidence.pick();
    } catch (failure) {
      if (live.current) setError(failureSentence(failure, 'The document could not be selected. Try again.'));
    }
  };
  const save = async () => {
    if (running.current || !editor) return;
    running.current = true;
    setBusy(true);
    setError('');
    let refused = false;
    try {
      check();
      let request = pending.current;
      let confirmed = false;
      if (request) {
        const original = request;
        const { data } = await getRegisterMemberDocuments(
          apiClient,
          { company, member: original.member, token: original.token, idempotencyKey: original.idempotencyKey },
          { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: check },
        );
        check();
        confirmed = data.results.some((row) => isRegisterMemberDocumentReceipt(row, original));
        if (!confirmed && data.results.length)
          throw createUserFriendlyError('The original document receipt did not match. Recover the original save.');
      } else {
        if (!appointment) throw createUserFriendlyError('Current preparation access is required to add documents.');
        const chosen = { ...editor, appointment: appointment.uuid };
        checkPreparation(chosen.appointment, chosen);
        if (!evidence.name) throw createUserFriendlyError('Choose the document.');
        const receipt = await evidence.upload(chosen.appointment, () => checkPreparation(chosen.appointment, chosen));
        request = {
          companyId: company,
          member: chosen.member,
          token: chosen.token,
          evidence: receipt.uuid,
          category: chosen.category,
          appointment: chosen.appointment,
          idempotencyKey: Crypto.randomUUID(),
        };
        pending.current = request;
        setHeld(true);
      }
      if (!confirmed) {
        const sent = request;
        const checkWrite = () => checkPreparation(sent.appointment, sent);
        checkWrite();
        const { data } = await createRegisterMemberDocument(apiClient, sent, {
          ledovaSessionEpoch: epoch,
          ledovaSubmissionGuard: checkWrite,
        }).catch((failure) => {
          const status = failureStatus(failure);
          refused = status !== undefined && status >= 400 && status < 500;
          throw failure;
        });
        check();
        if (!isRegisterMemberDocumentReceipt(data, sent))
          throw createUserFriendlyError('The document receipt could not be confirmed. Recover the original save.');
      }
      pending.current = null;
      setHeld(false);
      setEditor(null);
      evidence.clear();
      await client.invalidateQueries({ queryKey: memberDocumentsKey(epoch, company) });
    } catch (failure) {
      try {
        assertSessionEpoch(epoch);
      } catch {
        return;
      }
      if (refused) {
        pending.current = null;
        setHeld(false);
        void client.invalidateQueries({ queryKey: memberDocumentsKey(epoch, company) });
      }
      if (live.current)
        setError(failureSentence(failure, 'The document could not be confirmed. Recover the original save.'));
    } finally {
      running.current = false;
      if (live.current) setBusy(false);
    }
  };
  const fixed = busy || held || !ready;
  return (
    <Section title="Documents">
      {appointments.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            Your company appointments could not be loaded.
          </Text>
          <Action
            label="Retry appointments"
            disabled={appointments.isFetching}
            onPress={() => void appointments.refetch()}
          />
        </View>
      ) : !sourceReady || !appointments.isSuccess ? (
        <Text style={styles.muted}>Loading document access…</Text>
      ) : !authorised ? (
        <Text style={styles.muted}>Documents are private to current company register appointees.</Text>
      ) : query.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            Documents could not be loaded.
          </Text>
          <Action label="Retry documents" disabled={query.isFetching} onPress={() => void query.refetch()} />
        </View>
      ) : !query.isSuccess ? (
        <Text style={styles.muted}>Loading documents…</Text>
      ) : (
        <>
          {query.data.length ? (
            query.data.map((document, index) => (
              <View key={document.uuid} style={[styles.entry, index === query.data.length - 1 && styles.lastEntry]}>
                <Text style={styles.text}>{document.snapshot.name}</Text>
                <Text style={styles.muted}>
                  {[REGISTER_MEMBER_DOCUMENT_CATEGORIES[document.category], label(document)]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <RegisterCopy
                  label="Download"
                  accessibilityLabel={`Download ${document.snapshot.name}`}
                  filename={document.snapshot.name.replace(/\.[^.]+$/, '')}
                  epoch={epoch}
                  guard={check}
                  read={() =>
                    apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBER_DOCUMENT_FILE(document.uuid), {
                      responseType: 'arraybuffer',
                      ledovaSessionEpoch: epoch,
                      ledovaSubmissionGuard: check,
                    })
                  }
                />
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No supporting documents attached.</Text>
          )}
          {!editor && !!appointment && holdings.length > 0 && (
            <Action label="Add document" disabled={busy || !ready} onPress={open} />
          )}
        </>
      )}
      {editor && (
        <View style={styles.group}>
          {holdings.length > 1 && (
            <View style={styles.group}>
              <Text style={styles.muted}>{member ? 'Share class' : 'Shareholder'}</Text>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel={member ? 'Share class' : 'Shareholder'}
                style={styles.choices}
              >
                {holdings.map((holding) => (
                  <Choice
                    key={`${holding.member}/${holding.token}`}
                    label={holding.label}
                    accessibilityRole="radio"
                    selected={holding.member === editor.member && holding.token === editor.token}
                    disabled={fixed}
                    onPress={() => setEditor({ ...editor, member: holding.member, token: holding.token })}
                  />
                ))}
              </View>
            </View>
          )}
          <View style={styles.group}>
            <Text style={styles.muted}>Category</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Category" style={styles.choices}>
              {(Object.keys(REGISTER_MEMBER_DOCUMENT_CATEGORIES) as RegisterMemberDocumentCategory[]).map(
                (category) => (
                  <Choice
                    key={category}
                    label={REGISTER_MEMBER_DOCUMENT_CATEGORIES[category]}
                    accessibilityRole="radio"
                    selected={editor.category === category}
                    disabled={fixed}
                    onPress={() => setEditor({ ...editor, category })}
                  />
                ),
              )}
            </View>
          </View>
          <EvidencePicker
            title="File"
            noun="document"
            evidence={evidence}
            disabled={fixed || evidence.busy}
            onPick={() => void pick()}
          />
          {held && (
            <Text style={styles.muted}>
              Keep these details and recover the original save before changing documents.
            </Text>
          )}
          <View style={styles.actions}>
            <Action label="Cancel" disabled={busy || held} onPress={close} />
            <Action
              primary
              label={busy ? 'Saving document…' : held ? 'Recover original save' : 'Save document'}
              disabled={busy || evidence.busy || !ready || (!held && !evidence.name)}
              onPress={() => void save()}
            />
          </View>
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Section>
  );
}

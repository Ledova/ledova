import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import {
  DESTINATIONS,
  REGISTER_ALLOTMENT_COPY as COPY,
  hasCurrentRegisterReadAuthority,
  appointmentForRegisterStep,
  peopleFrom,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  entriesKey,
  registerAppointmentsKey,
  transferMembersKey,
  registerHoldersKey,
} from '../../hooks/useCompanyRegister';
import { Action, LinkRow } from '../../components/Ledger';
import { assertSessionEpoch } from '../../services/sessionScope';
import { AllotmentForm } from './AllotmentForm';
import { AllotmentRecord } from './AllotmentRecord';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useRegisterAppointments, useTransferMembers } from '../../hooks/useCompanyRegister';
import { allotmentsKey, useRegisterAllotments } from './useRegisterAllotments';

const HIDDEN = { display: 'none' } as const;

export function useInvestorIssues({
  company,
  register,
  epoch,
  sourceReady,
  onHeldChange,
  onSetUp,
  onOpenClass,
  reviewing,
  onReviewChange,
  issueMember,
  open,
  kept,
  onClosed,
}: {
  company: string;
  register: TokenHoldersResponse;
  epoch: number;
  sourceReady: boolean;
  onHeldChange?: (key: string, held: boolean) => void;
  onSetUp: () => void;
  onOpenClass: () => void;
  reviewing: string | null;
  onReviewChange: (uuid: string, open: boolean) => void;
  issueMember?: string;
  open: boolean;
  kept: boolean;
  onClosed: (recorded?: boolean) => void;
}) {
  const client = useQueryClient();
  const styles = useCompanyStyles();
  const [editing, setEditing] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);
  const [decisionHolds, setDecisionHolds] = useState<Record<string, boolean>>({});
  const live = useRef(true);
  const sourceAvailable = useRef(sourceReady);
  const privateAvailable = useRef(false);
  const writeReady = useRef(false);
  const latestAppointments = useRef<OwnCompanyAppointment[]>([]);
  const { appointments, steps } = useRegisterAppointments(epoch, company);
  const readable =
    appointments.isSuccess && !appointments.isFetching && hasCurrentRegisterReadAuthority(appointments.data, company);
  useLayoutEffect(() => {
    sourceAvailable.current = sourceReady;
  }, [sourceReady]);
  useLayoutEffect(() => {
    latestAppointments.current = appointments.isSuccess ? appointments.data : [];
  }, [appointments.isSuccess, appointments.data]);
  const appointment = readable ? steps?.prepare : undefined;
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const guard = useMemo(
    () => () => {
      assertSessionEpoch(epoch);
      if (!live.current) throw new Error('This allotment section is no longer open.');
      const state = client.getQueryState(registerAppointmentsKey(epoch));
      if (!sourceAvailable.current || state?.status !== 'success' || state.fetchStatus !== 'idle')
        throw new Error('Refresh the register and current company appointments.');
      if (
        !hasCurrentRegisterReadAuthority(
          client.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch)) ?? [],
          company,
        )
      )
        throw new Error('A current company register appointment is required.');
    },
    [epoch, company, client],
  );
  const allotments = useRegisterAllotments(epoch, company, register.token.uuid, guard, readable && sourceReady);
  const financialGuard = () => {
    guard();
    const current = client.getQueryState(allotmentsKey(epoch, register.token.uuid));
    if (!privateAvailable.current || current?.status !== 'success' || current.fetchStatus !== 'idle')
      throw new Error('Refresh the external allotments before reading private sources.');
  };
  const supported = register.initialized && register.token.status === 'draft';
  const members = useTransferMembers(epoch, register.token.uuid, (open || !!editing) && !!appointment && supported);
  const financialReady = allotments.isSuccess && allotments.fetchStatus === 'idle';
  const privateReady = readable && financialReady && sourceReady;
  const held = formHeld || Object.values(decisionHolds).some(Boolean);
  const blocked =
    (!appointment && !held) ||
    !readable ||
    !financialReady ||
    !sourceReady ||
    allotments.isFetching ||
    allotments.isError ||
    appointments.isFetching ||
    appointments.isError ||
    !supported;
  useLayoutEffect(() => {
    writeReady.current = !blocked;
    privateAvailable.current = privateReady;
  }, [blocked, privateReady]);
  if (
    open &&
    !editing &&
    appointment &&
    supported &&
    privateReady &&
    !blocked &&
    !held &&
    (!issueMember || (members.isSuccess && !members.isFetching))
  )
    setEditing(appointment);
  if (!kept && editing && !formHeld) setEditing(null);
  const recordHeld = useCallback((uuid: string, value: boolean) => {
    setDecisionHolds((previous) => (previous[uuid] === value ? previous : { ...previous, [uuid]: value }));
  }, []);
  useEffect(() => {
    onHeldChange?.(`allotments/${register.token.uuid}`, held);
  }, [onHeldChange, register.token.uuid, held]);
  useEffect(
    () => () => onHeldChange?.(`allotments/${register.token.uuid}`, false),
    [onHeldChange, register.token.uuid],
  );
  const refresh = async (throwOnError = false) => {
    assertSessionEpoch(epoch);
    await appointments.refetch({ throwOnError });
    guard();
    await allotments.refetch({ throwOnError });
    guard();
    await Promise.all([
      client.invalidateQueries({ queryKey: registerHoldersKey(epoch) }),
      client.invalidateQueries({ queryKey: entriesKey(epoch, register.token.uuid) }),
      client.invalidateQueries({ queryKey: transferMembersKey(epoch, register.token.uuid) }),
    ]);
  };
  const draft = register.token.status === 'draft';
  const setup = !supported && (
    <View style={styles.group}>
      {sourceReady && (
        <Text style={styles.muted}>
          {draft
            ? 'Set up this share register before issuing shares.'
            : 'Tokenised share issue controls remain on the Share class page.'}
        </Text>
      )}
      {!!appointment && privateReady && (
        <LinkRow
          label={draft ? DESTINATIONS.companyRegisterImport.title : DESTINATIONS.companyClass.title}
          onPress={draft ? onSetUp : onOpenClass}
        />
      )}
    </View>
  );
  const status = (
    <>
      {appointments.isSuccess && !appointment && <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>}
      {appointments.isError ? null : !appointments.isSuccess || appointments.isFetching ? (
        <Text style={styles.muted}>Loading external allotments…</Text>
      ) : !readable ? (
        <Text style={styles.muted}>
          A current company register appointment is required to read external allotments.
        </Text>
      ) : allotments.isPending || allotments.isFetching || !sourceReady ? (
        <Text style={styles.muted}>Loading external allotments…</Text>
      ) : allotments.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            External allotments could not be loaded.
          </Text>
          <Action
            label="Retry external allotments"
            disabled={allotments.isFetching || appointments.isFetching}
            onPress={() => void refresh().catch(() => {})}
          />
        </View>
      ) : null}
    </>
  );
  const form = editing && (
    <View style={open ? styles.group : HIDDEN}>
      <Text style={styles.muted}>
        Record the investment agreement and company receipt, then prepare the share issue for approval.
      </Text>
      {members.isPending ? (
        <Text style={styles.muted}>Loading retained recipients…</Text>
      ) : members.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            The retained recipients could not be loaded.
          </Text>
          <Action
            label="Retry allotment recipients"
            disabled={members.isFetching}
            onPress={() => void members.refetch()}
          />
        </View>
      ) : null}
      <AllotmentForm
        key={`${company}/${register.token.uuid}/${editing.uuid}/${issueMember ?? ''}`}
        company={company}
        token={register.token.uuid}
        epoch={epoch}
        classLabel={`${register.token.name} (${register.token.symbol})`}
        people={peopleFrom(members.data)}
        initialMember={issueMember}
        appointment={editing}
        guard={financialGuard}
        newEffectGuard={() => {
          if (
            !writeReady.current ||
            appointmentForRegisterStep(latestAppointments.current, company, 'prepare')?.uuid !== editing.uuid
          )
            throw new Error('Refresh the register and your preparation appointment.');
        }}
        blocked={blocked || members.isFetching}
        visible={privateReady && members.isSuccess && !members.isFetching}
        onHeldChange={setFormHeld}
        onCancel={() => onClosed()}
        onRecorded={async () => {
          guard();
          await refresh(true);
          guard();
          setEditing(null);
          onClosed(true);
        }}
      />
    </View>
  );
  const records = allotments.data?.map((allotment) => (
    <AllotmentRecord
      key={allotment.uuid}
      allotment={allotment}
      epoch={epoch}
      steps={steps ?? {}}
      guard={financialGuard}
      visible={privateReady && !kept && (!reviewing || reviewing === allotment.uuid)}
      onHeldChange={recordHeld}
      onReviewChange={onReviewChange}
      newEffectGuard={(kind) => {
        guard();
        if (!writeReady.current || !appointmentForRegisterStep(latestAppointments.current, company, kind))
          throw new Error('Refresh the register and your appointment before a new decision.');
      }}
      onSettled={() => refresh(true)}
    />
  ));
  return {
    setup,
    status,
    records,
    form,
    formShown: !!editing && privateReady && members.isSuccess && !members.isFetching,
    prepare: !!appointment && supported,
    empty: privateReady && allotments.data?.length === 0,
    held,
    refreshing: allotments.isFetching || appointments.isFetching,
    refresh,
  };
}

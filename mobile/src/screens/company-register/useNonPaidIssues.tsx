import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_GRANT_COPY as COPY,
  appointmentForRegisterStep,
  hasCurrentRegisterReadAuthority,
  peopleFrom,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { GrantForm } from './GrantForm';
import { GrantRecord } from './GrantRecord';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import {
  entriesKey,
  grantsKey,
  registerAppointmentsKey,
  transferMembersKey,
  useRegisterGrants,
  useTransferMembers,
} from '../../hooks/useCompanyRegister';
import { assertSessionEpoch } from '../../services/sessionScope';
import { awardsKey, useRegisterAward } from './useRegisterAwards';

const HIDDEN = { display: 'none' } as const;

export function useNonPaidIssues({
  epoch,
  company,
  register,
  steps,
  refreshHolders,
  refreshAppointments,
  sourceReady,
  onHeldChange,
  award: awardUuid = '',
  open,
  kept,
  onClosed,
  reviewing,
  onReviewChange,
}: {
  epoch: number;
  company: string;
  register: TokenHoldersResponse;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  refreshHolders: () => Promise<unknown>;
  refreshAppointments: () => Promise<unknown>;
  sourceReady: boolean;
  onHeldChange?: (key: string, held: boolean) => void;
  award?: string;
  open: boolean;
  kept: boolean;
  onClosed: (recorded?: boolean) => void;
  reviewing: string | null;
  onReviewChange: (uuid: string, open: boolean) => void;
}) {
  const styles = useCompanyStyles();
  const token = register.token.uuid;
  const sourceAvailable = useRef(sourceReady);
  useLayoutEffect(() => {
    sourceAvailable.current = sourceReady;
  }, [sourceReady]);
  const [holds, setHolds] = useState<Record<string, boolean>>({});
  const recordHeld = useCallback(
    (key: string, value: boolean) =>
      setHolds((previous) => (previous[key] === value ? previous : { ...previous, [key]: value })),
    [],
  );
  const [formAppointment, setFormAppointment] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);
  const held = formHeld || Object.values(holds).some(Boolean);
  useEffect(() => {
    onHeldChange?.(`grants/${token}`, held);
  }, [onHeldChange, token, held]);
  useEffect(() => () => onHeldChange?.(`grants/${token}`, false), [onHeldChange, token]);
  const queryClient = useQueryClient();
  const grants = useRegisterGrants(epoch, company, token);
  const currentAppointments = queryClient.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch)) ?? [];
  const appointmentRead = queryClient.getQueryState(registerAppointmentsKey(epoch));
  const readable =
    appointmentRead?.status === 'success' &&
    appointmentRead.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(currentAppointments, company);
  const privateReady = sourceReady && readable && grants.isSuccess && !grants.isFetching;
  const check = () => {
    assertSessionEpoch(epoch);
    const authority = queryClient.getQueryState(registerAppointmentsKey(epoch));
    if (
      !sourceAvailable.current ||
      authority?.status !== 'success' ||
      authority.fetchStatus !== 'idle' ||
      !hasCurrentRegisterReadAuthority(
        queryClient.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch)) ?? [],
        company,
      )
    )
      throw new Error('Refresh the register and your current company authority.');
  };
  const guard = () => {
    check();
    const records = queryClient.getQueryState(grantsKey(epoch, token));
    if (records?.status !== 'success' || records.fetchStatus !== 'idle')
      throw new Error('Refresh the register and your current company authority.');
  };
  const supported = register.initialized && register.token.status === 'draft';
  const newEffectGuard = (kind: RegisterDecisionKind) => {
    guard();
    if (
      !supported ||
      !appointmentForRegisterStep(
        queryClient.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch)) ?? [],
        company,
        kind,
      )
    )
      throw new Error('Current company authority is required for this issue.');
  };
  const refresh = async () => {
    await Promise.all([
      refreshHolders(),
      refreshAppointments(),
      queryClient.invalidateQueries({ queryKey: transferMembersKey(epoch, token) }),
    ]);
    await Promise.all([
      grants.refetch(),
      queryClient.refetchQueries({ queryKey: entriesKey(epoch, token), type: 'active' }),
      queryClient.refetchQueries({ queryKey: awardsKey(epoch, token), type: 'active' }),
    ]);
  };
  const appointment = readable ? steps?.prepare : undefined;
  const reading = (open || !!formAppointment) && !!appointment && supported && sourceReady;
  const people = useTransferMembers(epoch, token, reading);
  const award = useRegisterAward(epoch, company, token, awardUuid, check, reading);
  const awardMember = people.data?.members.find((row) => row.member === award.data?.member) ?? null;
  const recipientReady =
    !awardUuid || (award.isSuccess && people.isSuccess && !!awardMember?.walletless && awardMember.particularsRetained);
  const busy = appointmentRead?.fetchStatus !== 'idle' || people.isFetching || (!!awardUuid && award.isFetching);
  const stale = appointmentRead?.status === 'error' || people.isError || (!!awardUuid && award.isError);
  const ready =
    sourceReady &&
    readable &&
    people.isSuccess &&
    (!awardUuid || award.isSuccess) &&
    (!!formAppointment || (!!appointment && supported && recipientReady));
  const formVisible = ready && !stale && !busy;
  if (
    open &&
    formVisible &&
    appointment &&
    (!formAppointment || (!formHeld && formAppointment.uuid !== appointment.uuid))
  )
    setFormAppointment(appointment);
  if (!kept && formAppointment && !formHeld) setFormAppointment(null);
  const retry = async () => {
    await refreshAppointments();
    void refreshHolders();
    if (reading || formHeld) {
      void people.refetch();
      if (awardUuid) void award.refetch();
    }
  };
  const shown = open || formHeld;
  const form = (shown || !!formAppointment) && (
    <View style={shown ? styles.group : HIDDEN}>
      {stale ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            The non-paid issue form could not be loaded.
          </Text>
          <Action label="Retry non-paid issue form" disabled={busy} onPress={() => void retry()} />
        </View>
      ) : appointmentRead?.status === 'success' && !appointment && !formAppointment ? (
        <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>
      ) : award.isSuccess && people.isSuccess && !recipientReady ? (
        <Text style={styles.muted}>
          This award’s recipient needs current retained walletless particulars before a grant can be prepared.
        </Text>
      ) : (
        !formVisible && <Text style={styles.muted}>Loading the non-paid issue form…</Text>
      )}
      {!formHeld && !(formAppointment && formVisible) && (
        <View style={styles.actions}>
          <Action label="Cancel" onPress={() => onClosed()} />
        </View>
      )}
      {formAppointment && (
        <View style={formVisible ? undefined : HIDDEN}>
          <GrantForm
            key={`${formAppointment.uuid}/${awardUuid}`}
            epoch={epoch}
            company={company}
            token={token}
            people={peopleFrom(people.data)}
            appointment={formAppointment}
            guard={check}
            blocked={!ready || stale || busy}
            canPrepare={
              supported &&
              recipientReady &&
              !!appointmentForRegisterStep(
                currentAppointments.filter((item) => item.uuid === formAppointment.uuid),
                company,
                'prepare',
              )
            }
            award={awardUuid ? award.data : undefined}
            awardMember={awardMember}
            onHeldChange={setFormHeld}
            onRefused={() => void retry()}
            onCancel={() => onClosed()}
            onRecorded={() => {
              setFormAppointment(null);
              onClosed(true);
              void refresh();
            }}
          />
        </View>
      )}
    </View>
  );
  const status = (
    <>
      {readable && steps && !Object.values(steps).some(Boolean) && (
        <Text style={styles.muted}>{COPY.READ_ONLY_NOTE}</Text>
      )}
      {appointmentRead?.status === 'error' ? null : appointmentRead?.status !== 'success' ||
        appointmentRead.fetchStatus !== 'idle' ||
        !sourceReady ||
        (readable && (grants.isPending || grants.isFetching)) ? (
        <Text style={styles.muted}>Loading non-paid issues…</Text>
      ) : !readable ? (
        <Text style={styles.muted}>A current company register appointment is required to read non-paid issues.</Text>
      ) : grants.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            Non-paid issues could not be loaded.
          </Text>
          <Action label="Retry non-paid issues" disabled={grants.isFetching} onPress={() => void refresh()} />
        </View>
      ) : null}
    </>
  );
  const records = grants.data?.map((grant, index) => (
    <GrantRecord
      key={grant.uuid}
      grant={grant}
      epoch={epoch}
      steps={steps ?? {}}
      last={index === grants.data!.length - 1}
      onSettled={refresh}
      visible={privateReady && !kept && (!reviewing || reviewing === grant.uuid)}
      guard={guard}
      newEffectGuard={newEffectGuard}
      classLabel={`${register.token.name} (${register.token.symbol})`}
      onHeldChange={recordHeld}
      onReviewChange={onReviewChange}
    />
  ));
  return {
    form,
    status,
    records,
    empty: privateReady && grants.data?.length === 0,
    held,
    refreshRecords: () => grants.refetch({ cancelRefetch: false, throwOnError: true }),
  };
}

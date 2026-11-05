import { useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  PARTICULARS_GROUPS,
  REGISTER_COPY,
  REGISTER_PARTICULARS_COPY as COPY,
  STAGE_TONES,
  apiErrorSentence,
  formatDate,
  formatDateTime,
  formatShortDate,
  hasCurrentRegisterReadAuthority,
  ownAppointmentsKey,
  particularsChanged,
  particularsKey,
  registerMembers,
  useOwnAppointments,
  useParticularsRecordDownload,
  usePeople,
  useRegisterParticulars,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type RecordRow,
  type RegisterParticularsChange,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, Fact, LoadError, Loading, Rows, Section, Status } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { GroupedRecords } from './GroupedRecords';
import { RecordShell, RecordSummary, decisionTrail } from './IssueRecord';
import { useLedgerStyles } from './useLedgerStyles';

type Held = { name: string; residentialAddress: string; asAt: string };

function Particulars({ title, held }: { title: string; held: Held | null }) {
  const look = useLedgerStyles();
  return (
    <View style={look.terms}>
      <Text style={look.muted}>{title}</Text>
      {held ? (
        <Rows>
          <Fact label={COPY.NAME}>{held.name}</Fact>
          <Fact label={COPY.RESIDENTIAL_ADDRESS}>{held.residentialAddress}</Fact>
          <Fact label={COPY.AS_AT}>{formatDate(held.asAt)}</Fact>
        </Rows>
      ) : (
        <Text style={look.text}>{COPY.NOT_RECORDED_BEFORE}</Text>
      )}
    </View>
  );
}

function ParticularsRecord({
  change,
  member,
  guard,
  visible,
  ruled,
  collapsed,
}: {
  change: RegisterParticularsChange;
  member: string;
  guard: () => void;
  visible: boolean;
  ruled: boolean;
  collapsed: boolean;
}) {
  const look = useLedgerStyles();
  const styles = useCompanyStyles();
  const download = useParticularsRecordDownload(change, guard, SHARE_SHEET_FILES, orderSubmissionSession);
  const edit = !change.supportingEvidence;
  const downloadLabel = download.isPending ? 'Downloading…' : COPY.DOWNLOAD;
  return (
    <RecordShell hidden={!visible || collapsed} ruled={ruled}>
      {visible && (
        <RecordSummary
          name={member}
          facts={`${particularsChanged(change)} · ${formatShortDate(change.asAt)}`}
          status={
            change.stage === 'applied'
              ? undefined
              : { tone: STAGE_TONES[change.stage] ?? 'waiting', label: COPY.STAGES[change.stage] ?? change.stage }
          }
        >
          <Rows>
            <Fact label="Stage">
              <Status tone={STAGE_TONES[change.stage] ?? 'waiting'}>{COPY.STAGES[change.stage] ?? change.stage}</Status>
            </Fact>
            {change.providedBy === 'member' ? (
              <Fact label="Changed by">{COPY.PROVIDED_BY_MEMBER}</Fact>
            ) : (
              change.preparedByName !== null && (
                <Fact label={edit ? 'Changed by' : 'Prepared by'}>{change.preparedByName || 'Not provided'}</Fact>
              )
            )}
            <Fact label={edit ? 'Changed on' : 'Prepared on'}>{formatDateTime(change.createdAt)}</Fact>
          </Rows>
          {edit ? (
            <>
              <Particulars title={COPY.BEFORE} held={change.previousParticulars} />
              <Particulars title={COPY.AFTER} held={change} />
            </>
          ) : (
            <Particulars title={COPY.PROPOSED_PARTICULARS} held={change} />
          )}
          {(!!change.reason || !edit) && (
            <Rows>
              {!!change.reason && <Fact label={COPY.REASON}>{change.reason}</Fact>}
              {!edit && (
                <>
                  <Fact label="Evidence">{COPY.PROVIDED_BY_COMPANY}</Fact>
                  {decisionTrail(change, COPY.DECISIONS)}
                </>
              )}
            </Rows>
          )}
          {!edit && (
            <View style={look.wrap}>
              <Action
                label={downloadLabel}
                accessibilityLabel={`${downloadLabel} (change for ${member} prepared ${formatDateTime(change.createdAt)})`}
                disabled={download.isPending}
                onPress={() => download.mutate()}
              />
            </View>
          )}
          {download.isError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {apiErrorSentence(download.error, REGISTER_COPY.DOWNLOAD_FAILED, REGISTER_COPY.DOWNLOAD_FAILED)}
            </Text>
          )}
        </RecordSummary>
      )}
    </RecordShell>
  );
}

export function ParticularsChanges({
  owner,
  company,
  registers,
  guard,
  accountGuard,
  sourceReady,
  hidden,
  refreshRef,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  registers: TokenHoldersResponse[];
  guard: () => void;
  accountGuard: () => void;
  sourceReady: boolean;
  hidden: boolean;
  refreshRef: RefObject<() => Promise<unknown>>;
}) {
  const look = useLedgerStyles();
  const client = useQueryClient();
  const source = useRef(sourceReady);
  useLayoutEffect(() => {
    source.current = sourceReady;
  }, [sourceReady]);
  const appointments = useOwnAppointments(owner, accountGuard, { session: orderSubmissionSession });
  const readable = appointments.isSuccess && hasCurrentRegisterReadAuthority(appointments.data, company);
  const check = useMemo(
    () => () => {
      guard();
      const state = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
      if (
        !source.current ||
        state?.status !== 'success' ||
        state.fetchStatus !== 'idle' ||
        !hasCurrentRegisterReadAuthority(state.data ?? [], company)
      )
        throw new Error('Refresh the register and your current company appointment.');
    },
    [client, owner, company, guard],
  );
  const changes = useRegisterParticulars(
    owner,
    company,
    check,
    readable && !appointments.isFetching && sourceReady,
    orderSubmissionSession,
  );
  const privateReady =
    sourceReady &&
    readable &&
    appointments.fetchStatus === 'idle' &&
    changes.isSuccess &&
    changes.fetchStatus === 'idle';
  const names = registerMembers(registers);
  const firstClass = registers[0]?.token.uuid ?? '';
  const people = usePeople(
    owner,
    firstClass,
    check,
    readable &&
      !appointments.isFetching &&
      sourceReady &&
      !!firstClass &&
      (changes.data ?? []).some((change) => !names.get(change.member)),
    orderSubmissionSession,
  );
  const nameOf = (member: string) =>
    names.get(member) || people.data?.members.find((row) => row.member === member)?.name || COPY.UNNAMED_MEMBER;
  const recordGuard = () => {
    check();
    const state = client.getQueryState(particularsKey(owner, company));
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error('Refresh the particulars changes before continuing.');
  };
  useLayoutEffect(() => {
    refreshRef.current = () => changes.refetch({ cancelRefetch: false });
  });
  const rows: RecordRow<ReactNode>[] = (changes.data ?? []).map((change) => ({
    uuid: change.uuid,
    stage: change.stage,
    companyEventOn: change.asAt,
    createdAt: change.createdAt,
    shown: privateReady,
    held: false,
    render: ({ collapsed, ruled }) => (
      <ParticularsRecord
        change={change}
        member={nameOf(change.member)}
        guard={recordGuard}
        visible={privateReady}
        ruled={ruled}
        collapsed={collapsed}
      />
    ),
  }));
  if (!readable || (changes.isSuccess && changes.data.length === 0)) return null;
  return (
    <View style={hidden && look.hidden}>
      <Section title={COPY.TITLE}>
        {changes.isPending ? (
          <Loading>Loading particulars changes…</Loading>
        ) : changes.isError ? (
          <LoadError retry={() => changes.refetch()} busy={changes.isFetching}>
            Particulars changes could not be loaded.
          </LoadError>
        ) : null}
        <GroupedRecords grouping={PARTICULARS_GROUPS} rows={rows} browsing />
      </Section>
    </View>
  );
}

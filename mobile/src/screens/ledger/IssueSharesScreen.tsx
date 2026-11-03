import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  hasCurrentRegisterReadAuthority,
  ownAppointmentsKey,
  useSubmissionOwner,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { FilterPopover } from '../../components/FilterPopover';
import { Action, Actions, FormActions, LoadError, Loading, Section, useCardStyles } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { Choices } from '../../components/register/RegisterFields';
import { SelectField } from '../../components/SelectField';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useCompanyRegisters } from '../../hooks/useCompanyRegisters';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useInvestorIssues } from './useInvestorIssues';
import { useLedgerStyles } from './useLedgerStyles';
import { useNonPaidIssues } from './useNonPaidIssues';

const TITLE = DESTINATIONS.companyRegister.tasks.issue;
const LEDE = 'Record a company-approved share issue.';

const KINDS = [
  ['investor', 'Investor issue'],
  ['nonpaid', 'Non-paid issue'],
] as const;

type IssueKind = (typeof KINDS)[number][0];

type IssueRequest = { key: string; token?: string; member?: string; award?: string; record?: string };

export function IssueSharesScreen({ route }: { route: RouteProp<SignedInStackParamList, 'IssueShares'> }) {
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const { directory, companies, company } = useMemberRecordsState();
  const choosing = directory.isLoading || (!company && companies.length > 0);
  if (owner && company?.canReadRegister && !directory.hasError && !choosing) {
    const request = route.params?.company === company.uuid ? { key: route.key, ...route.params } : undefined;
    return (
      <CompanyIssues
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company.uuid}`}
        owner={owner}
        currentOwner={boundary.get}
        company={company.uuid}
        request={request}
      />
    );
  }
  return (
    <Page testID="issue-shares-scroll" title={TITLE} lede={LEDE}>
      {!owner ? (
        <AccountCheck />
      ) : directory.hasError ? (
        <LoadError retry={directory.retry} busy={directory.isRefreshing}>
          Your company access could not be confirmed.
        </LoadError>
      ) : choosing ? (
        <Loading>Loading the register…</Loading>
      ) : (
        <CompanyContextNotice />
      )}
    </Page>
  );
}

function CompanyIssues({
  owner,
  currentOwner,
  company,
  request,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  request?: IssueRequest;
}) {
  const theme = useAppTheme();
  const look = useLedgerStyles();
  const page = useRef<ScrollView>(null);
  const content = useRef<View>(null!);
  const source = useCompanyRegisters(owner, currentOwner, company, TITLE);
  const [chosen, setChosen] = useState(request?.token ?? '');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [kept, setKept] = useState<TokenHoldersResponse[]>([]);
  const refreshIssues = useRef<() => Promise<unknown>>(async () => undefined);
  if (source.registers && source.registers.length > 0 && source.registers !== kept) setKept(source.registers);
  const registers = source.registers ?? (busy ? kept : []);
  const register = registers.find(({ token }) => token.uuid === chosen) ?? registers[0];
  const toTop = useCallback(() => page.current?.scrollTo({ y: 0, animated: false }), []);
  const focusRecord = useCallback((record: View) => {
    if (!content.current) return;
    try {
      record.measureLayout(
        content.current,
        (_left, top) => page.current?.scrollTo({ y: top, animated: false }),
        () => undefined,
      );
    } catch {
      return;
    }
  }, []);
  return (
    <Page
      ref={page}
      innerViewRef={content}
      testID="issue-shares-scroll"
      title={TITLE}
      lede={LEDE}
      titleAction={
        source.sourceReady && registers.length > 1 && register ? (
          <FilterPopover>
            {(close) => (
              <SelectField
                label="Share class"
                options={registers.map(({ token }) => ({
                  value: token.uuid,
                  label: `${token.name} · ${token.symbol}`,
                }))}
                value={register.token.uuid}
                disabled={busy}
                onChange={(token) => {
                  if (busy || !source.sourceReady) return;
                  close();
                  setChosen(token);
                }}
              />
            )}
          </FilterPopover>
        ) : undefined
      }
      refreshControl={
        <RefreshControl
          testID="issue-shares-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing || busy) return;
            setRefreshing(true);
            void Promise.all([source.retry(), refreshIssues.current()]).finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {source.accountError ? (
        <LoadError retry={source.retryAccount} busy={source.isRefreshing}>
          Your account could not be loaded.
        </LoadError>
      ) : source.hasError || source.invalid ? (
        <LoadError retry={source.retry} busy={source.isRefreshing}>
          The register could not be loaded.
        </LoadError>
      ) : !source.sourceReady && !register ? (
        <Loading>Loading the register…</Loading>
      ) : null}
      {source.sourceReady && register && (
        <Text style={look.muted}>
          {register.token.name} · {register.token.symbol}
        </Text>
      )}
      {register && (
        <ClassIssues
          key={`${company}/${register.token.uuid}`}
          owner={owner}
          company={company}
          register={register}
          guard={source.guard}
          sourceReady={source.sourceReady}
          request={request && (!request.token || request.token === register.token.uuid) ? request : undefined}
          refreshRef={refreshIssues}
          onBusyChange={setBusy}
          onOpen={toTop}
          onFocusRecord={focusRecord}
        />
      )}
    </Page>
  );
}

function ClassIssues({
  owner,
  company,
  register,
  guard,
  sourceReady,
  request,
  refreshRef,
  onBusyChange,
  onOpen,
  onFocusRecord,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady: boolean;
  request?: IssueRequest;
  refreshRef: RefObject<() => Promise<unknown>>;
  onBusyChange: (busy: boolean) => void;
  onOpen: () => void;
  onFocusRecord: (record: View) => void;
}) {
  const card = useCardStyles();
  const look = useLedgerStyles();
  const client = useQueryClient();
  const [preparing, setPreparing] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const reviewChanged = useCallback((uuid: string, open: boolean) => {
    setReviewing((current) => (open ? uuid : current === uuid ? null : current));
  }, []);
  const [kind, setKind] = useState<IssueKind | ''>('');
  const [award, setAward] = useState<string | undefined>();
  const [member, setMember] = useState<string | undefined>();
  const [answered, setAnswered] = useState('');
  const [allotmentHeld, setAllotmentHeld] = useState(false);
  const [grantHeld, setGrantHeld] = useState(false);
  const close = () => {
    Keyboard.dismiss();
    setPreparing(false);
    setKind('');
    setAward(undefined);
    setMember(undefined);
  };
  const investor = useInvestorIssues({
    owner,
    company,
    register,
    guard,
    sourceReady,
    onHeldChange: setAllotmentHeld,
    issueMember: member,
    open: preparing && kind === 'investor',
    kept: preparing,
    onClosed: close,
    reviewing,
    onReviewChange: reviewChanged,
    onFocusRecord,
  });
  const nonPaid = useNonPaidIssues({
    owner,
    company,
    register,
    guard,
    sourceReady,
    onHeldChange: setGrantHeld,
    award,
    focusRecord: request?.record ? { key: request.key, uuid: request.record } : undefined,
    open: preparing && kind === 'nonpaid',
    kept: preparing,
    onClosed: close,
    reviewing,
    onReviewChange: reviewChanged,
    onFocusRecord,
  });
  const held = allotmentHeld || grantHeld;
  const open = preparing || !!reviewing;
  useEffect(() => {
    onBusyChange(open || held);
  }, [onBusyChange, open, held]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => {
    if (open) onOpen();
  }, [open, onOpen]);
  useLayoutEffect(() => {
    refreshRef.current = async () => {
      guard();
      await client.refetchQueries({ queryKey: ownAppointmentsKey(owner), exact: true });
      const appointments = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
      if (appointments?.status !== 'success' || !hasCurrentRegisterReadAuthority(appointments.data ?? [], company))
        return;
      await Promise.allSettled([investor.refreshRecords(), nonPaid.refreshRecords()]);
    };
  });
  if (request && answered !== request.key && !held) {
    setAnswered(request.key);
    if (request.award || request.member) {
      setPreparing(true);
      setKind(request.award ? 'nonpaid' : 'investor');
      setAward(request.award);
      setMember(request.member);
    }
  }
  const grouped = !investor.empty && !nonPaid.empty;
  const status = (
    <>
      {investor.setup}
      {investor.status}
      {nonPaid.status}
    </>
  );
  const browsing = !preparing && !reviewing;
  return (
    <>
      <View style={preparing ? look.hidden : reviewing ? undefined : card.card}>
        {browsing && (
          <Text accessibilityRole="header" style={card.title}>
            Share issues
          </Text>
        )}
        {!preparing && status}
        {browsing && investor.empty && nonPaid.empty && <Text style={look.muted}>No share issues recorded yet.</Text>}
        <View style={investor.empty && look.hidden}>{investor.records}</View>
        <View style={[nonPaid.empty && look.hidden, grouped && browsing && look.ruled]}>{nonPaid.records}</View>
      </View>
      {investor.prepare && browsing && (
        <Actions>
          <Action primary label="Prepare issue" disabled={held || !sourceReady} onPress={() => setPreparing(true)} />
        </Actions>
      )}
      <View style={!preparing && look.hidden}>
        <Section title="Prepare share issue">
          {preparing && status}
          <Choices
            legend="What kind of issue?"
            options={KINDS}
            value={kind}
            disabled={held}
            onChange={(next) => {
              Keyboard.dismiss();
              setKind(next);
            }}
          />
          {investor.form}
          {nonPaid.form}
          {!kind && (
            <FormActions>
              <Action label="Cancel" accessibilityLabel="Cancel (share issue)" disabled={held} onPress={close} />
            </FormActions>
          )}
        </Section>
      </View>
    </>
  );
}

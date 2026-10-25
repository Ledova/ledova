import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { AxiosRequestConfig, AxiosRequestTransformer } from 'axios';
import { useSubmissionOwner } from './useSubmissionOwner';
import { AUTH_QUERY_KEY } from './useAuth';
import { USER_PREFERENCES_QUERY_KEY } from './useUserPreferences';
import { isCurrentEligibilityAppointment } from './useCompanyEligibilityRecords';
import type { OrderSubmissionSession } from './useOrderSubmissions';
import { getOwnCompanyAppointments } from '../services/company-authority';
import { getCompanyWalletNominations, getCompanyWalletInstructions } from '../services/company-wallets';
import { getRegisterTransferMembers } from '../services/register-transfers';
import { getRegisterLinks, prepareRegisterLink } from '../services/register-links';
import { getRegisterIssues, prepareRegisterIssue } from '../services/register-issues';
import { readEveryPage } from '../utils/pagination';
import { appointmentForRegisterStep, type RegisterStep } from '../utils/register-commands';
import { isPreparedRegisterLink } from '../utils/register-links';
import { isPreparedRegisterIssue } from '../utils/register-issues';
import { failureStatus, createUserFriendlyError, refusalSentence, failureSentence } from '../utils/errors';
import { REGISTER_ISSUE_UNMET_COPY } from '../constants/business/register-issues';
import type {
  CompanyShareToken,
  CompanyWalletNomination,
  CompanyWalletInstruction,
  OwnCompanyAppointment,
  RegisterIssue,
  RegisterIssuePreparation,
  RegisterLink,
  RegisterLinkPreparation,
  RegisterTransferMembers,
  TokenHoldersResponse,
} from '../types';
import { useApiClient } from './useApiClient';

type IssueInput = Omit<RegisterIssuePreparation, 'operationId' | 'appointment' | 'token'>;
type LinkInput = Omit<RegisterLinkPreparation, 'operationId' | 'appointment' | 'companyId'>;
type Original =
  | { kind: 'issue'; body: RegisterIssuePreparation; address: string }
  | { kind: 'link'; body: RegisterLinkPreparation; nomination: string };

export function useCompanyIssueInstructions(
  tokenUuid: string,
  options: {
    token: CompanyShareToken | undefined;
    tokenKey: QueryKey;
    newKey: () => string;
    session?: OrderSubmissionSession;
    coordinatedReads?: boolean;
    paused?: boolean;
    onPrepared?: (kind: 'link' | 'issue') => void;
  },
) {
  const api = useApiClient();
  const client = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(options.session);
  const mounted = useRef(true);
  const pending = useRef(false);
  const current = useRef({ owner, tokenUuid, company: options.token?.companyUuid ?? '' });
  const company =
    options.token?.uuid === tokenUuid
      ? options.token.companyUuid
      : current.current.owner === owner && current.current.tokenUuid === tokenUuid
        ? current.current.company
        : '';
  const scope = [owner?.userUuid, owner?.ownerAccountUuid, options.session?.getEpoch() ?? 0, tokenUuid, company];
  const [view, setView] = useState({ owner, generation: 0 });
  if (view.owner !== owner) setView({ owner, generation: view.generation + 1 });
  const scopeKey = [...scope, view.generation].join('/');
  const appointmentKey = ['company-issue-appointments', ...scope];
  const nominationKey = ['company-issue-nominations', ...scope];
  const approvalKey = ['company-issue-wallet-approvals', ...scope];
  const memberKey = ['company-issue-members', ...scope];
  const linkKey = ['company-issue-links', ...scope];
  const issueKey = ['company-issues', ...scope];
  const [kept, setKept] = useState<{
    owner: typeof owner;
    company: string;
    issues: RegisterIssue[];
    links: RegisterLink[];
  }>({ owner, company, issues: [], links: [] });
  const [original, setOriginal] = useState<{
    owner: typeof owner;
    company: string;
    token: string;
    operation: Original;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [workingOwner, setWorkingOwner] = useState<typeof owner>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setClock] = useState(0);
  const readingPaused =
    !!options.paused ||
    (busy && workingOwner === owner) ||
    (original?.owner === owner && original.company === company && original.token === tokenUuid);
  const reading = !options.coordinatedReads || !readingPaused;
  const timing = options.coordinatedReads ? { refetchOnWindowFocus: false, refetchOnReconnect: false } : {};
  useLayoutEffect(() => {
    current.current = { owner, tokenUuid, company };
  }, [owner, tokenUuid, company]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setClock((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  const ownerGuard = () => {
    const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    const auth = client.getQueryState<{ data: { valid: boolean } }>(AUTH_QUERY_KEY);
    if (
      !mounted.current ||
      !owner ||
      boundary.get() !== owner ||
      current.current.tokenUuid !== tokenUuid ||
      current.current.company !== company ||
      preferences?.status !== 'success' ||
      preferences.fetchStatus !== 'idle' ||
      preferences.isInvalidated ||
      auth?.status !== 'success' ||
      auth.fetchStatus !== 'idle' ||
      auth.isInvalidated ||
      !auth.data?.data.valid
    )
      throw createUserFriendlyError('Your account or selected class changed. Reopen company grants.');
  };
  const config = (check = ownerGuard): AxiosRequestConfig => ({
    ...options.session?.requestConfig(),
    ledovaSubmissionGuard: check,
  });
  const appointments = useQuery({
    queryKey: appointmentKey,
    enabled: !!owner && !!company && reading,
    ...timing,
    queryFn: () =>
      readEveryPage(async (page) => {
        ownerGuard();
        const response = await getOwnCompanyAppointments(api, page, config());
        ownerGuard();
        return response;
      }),
  });
  const readable = (row: OwnCompanyAppointment) =>
    row.company === company &&
    isCurrentEligibilityAppointment(row) &&
    row.capabilities.some((capability) =>
      ['admin', 'read_register', 'prepare', 'approve', 'apply'].includes(capability),
    );
  const visible =
    !!owner && !!company && appointments.isSuccess && !appointments.isFetching && appointments.data.some(readable);
  const guard = () => {
    ownerGuard();
    const state = client.getQueryState<OwnCompanyAppointment[]>(appointmentKey);
    if (
      !company ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      state.isInvalidated ||
      !state.data?.some(readable)
    )
      throw createUserFriendlyError('Current personal register read access for this exact company is required.');
  };
  const nominations = useQuery({
    queryKey: nominationKey,
    enabled: visible && reading,
    ...timing,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const response = await getCompanyWalletNominations(api, { company, page }, config(guard));
        guard();
        if (response.data.results.some((row) => row.company !== company || row.chain !== 'base'))
          throw createUserFriendlyError('The nomination belongs to another company.');
        return response;
      }),
  });
  const walletApprovals = useQuery({
    queryKey: approvalKey,
    enabled: visible && reading,
    ...timing,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const response = await getCompanyWalletInstructions(api, { company, page }, config(guard));
        guard();
        if (response.data.results.some((row) => row.company !== company || row.snapshot.company.uuid !== company))
          throw createUserFriendlyError('The wallet approval belongs to another company.');
        return response;
      }),
  });
  const members = useQuery({
    queryKey: memberKey,
    enabled: visible && reading,
    ...timing,
    queryFn: async () => {
      guard();
      const response = await getRegisterTransferMembers(api, tokenUuid, config(guard));
      guard();
      return {
        ...response.data,
        members: response.data.members.filter((member) => member.onRegister !== false),
      };
    },
  });
  const links = useQuery({
    queryKey: linkKey,
    enabled: visible && reading,
    ...timing,
    queryFn: async () => {
      guard();
      const rows = await getRegisterLinks(api, { company }, config(guard));
      guard();
      if (rows.some((row) => row.company !== company))
        throw createUserFriendlyError('The member links belong to another company.');
      setKept((prior) => ({
        owner,
        company,
        links: [
          ...rows,
          ...(prior.owner === owner && prior.company === company
            ? prior.links.filter((row) => !rows.some((fresh) => fresh.uuid === row.uuid))
            : []),
        ],
        issues: prior.owner === owner && prior.company === company ? prior.issues : [],
      }));
      return rows;
    },
  });
  const instructions = useQuery({
    queryKey: issueKey,
    enabled: visible && reading,
    ...timing,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const response = await getRegisterIssues(api, { company, token: tokenUuid, page }, config(guard));
        guard();
        if (
          response.data.results.some(
            (row) =>
              row.company !== company ||
              row.token !== tokenUuid ||
              row.snapshot.company.uuid !== company ||
              row.snapshot.token.uuid !== tokenUuid,
          )
        )
          throw createUserFriendlyError('The grant records belong to another company or class.');
        return response;
      }).then((rows) => {
        guard();
        setKept((prior) => ({
          owner,
          company,
          issues: [
            ...rows,
            ...(prior.owner === owner && prior.company === company
              ? prior.issues.filter((row) => !rows.some((fresh) => fresh.uuid === row.uuid))
              : []),
          ],
          links: prior.owner === owner && prior.company === company ? prior.links : [],
        }));
        return rows;
      }),
  });
  const activeKept = kept.owner === owner && kept.company === company;
  const freshIssues = instructions.isSuccess && !instructions.isFetching ? instructions.data : [];
  const freshLinks = links.isSuccess && !links.isFetching ? links.data : [];
  const records = [
    ...freshIssues,
    ...(activeKept ? kept.issues.filter((row) => !freshIssues.some((item) => item.uuid === row.uuid)) : []),
  ];
  const linksRecords = [
    ...freshLinks,
    ...(activeKept ? kept.links.filter((row) => !freshLinks.some((item) => item.uuid === row.uuid)) : []),
  ];
  const steps = Object.fromEntries(
    (['prepare', 'approve', 'apply', 'reject'] as RegisterStep[]).map((kind) => [
      kind,
      visible ? appointmentForRegisterStep(appointments.data, company, kind) : undefined,
    ]),
  ) as Partial<Record<RegisterStep, OwnCompanyAppointment>>;
  const guardStep = (kind: RegisterStep) => {
    guard();
    const state = client.getQueryState<OwnCompanyAppointment[]>(appointmentKey);
    const appointment = state?.data && appointmentForRegisterStep(state.data, company, kind);
    if (!appointment || appointment.uuid !== steps[kind]?.uuid)
      throw createUserFriendlyError('Your personal company decision capability changed. Refresh appointments.');
  };
  const guardClass = () => {
    const state = client.getQueryState<CompanyShareToken>(options.tokenKey);
    if (
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      state.isInvalidated ||
      state.data?.uuid !== tokenUuid ||
      state.data.companyUuid !== company ||
      state.data.status !== 'deployed' ||
      state.data.chain !== 'base'
    )
      throw createUserFriendlyError('Refresh this deployed Base class before starting a new grant decision.');
  };
  const freshRows = <Row>(key: QueryKey): Row[] => {
    const state = client.getQueryState<Row[]>(key);
    if (state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || !state.data)
      throw createUserFriendlyError('Refresh the exact retained company source before continuing.');
    return state.data;
  };
  const nomination = (uuid: string) => {
    const row = freshRows<CompanyWalletNomination>(nominationKey).find(
      (item) => item.uuid === uuid && item.company === company,
    );
    if (!row) throw createUserFriendlyError('Select the exact wallet nomination shared with this company.');
    return row;
  };
  const guardIssue = (
    kind: RegisterStep,
    source: Pick<IssueInput, 'member' | 'nomination' | 'walletApproval'> | RegisterIssue,
  ) => {
    guardStep(kind);
    if ('uuid' in source) {
      const retained = freshRows<RegisterIssue>(issueKey).find((row) => row.uuid === source.uuid);
      if (
        !retained ||
        retained.status !== source.status ||
        retained.stage !== source.stage ||
        retained.intentDigest !== source.intentDigest ||
        JSON.stringify(retained.snapshot) !== JSON.stringify(source.snapshot) ||
        JSON.stringify(retained.decisions) !== JSON.stringify(source.decisions)
      )
        throw createUserFriendlyError('The exact retained grant changed. Refresh before a new decision.');
    }
    if (kind === 'reject') return;
    guardClass();
    if (!source.nomination) throw createUserFriendlyError('The retained grant has no exact participant nomination.');
    const nominated = nomination(source.nomination);
    const approved = freshRows<CompanyWalletInstruction>(approvalKey).find(
      (row) =>
        row.company === company &&
        row.action === 'add' &&
        row.nomination === nominated.uuid &&
        row.changeId === source.walletApproval &&
        row.status === 'applied' &&
        ['confirmed', 'unchanged'].includes(row.execution?.status ?? '') &&
        row.execution?.change === row.changeId,
    );
    const state = client.getQueryState<RegisterTransferMembers>(memberKey);
    const eligibilityExpiry = Date.parse(nominated.eligibilityExpiresAt);
    const approvalExpiry = Date.parse(approved?.expiresAt ?? '');
    const holderState = client.getQueryState<TokenHoldersResponse>([...options.tokenKey, 'holders']);
    const documented =
      freshRows<RegisterLink>(linkKey).some(
        (link) =>
          link.status === 'applied' &&
          link.mapping.some(
            (row) => row.member === source.member && row.address.toLowerCase() === nominated.address.toLowerCase(),
          ),
      ) ||
      (holderState?.status === 'success' &&
        holderState.fetchStatus === 'idle' &&
        !holderState.isInvalidated &&
        holderState.data?.holders.some(
          (holder) =>
            holder.member === source.member &&
            holder.wallets.some((wallet) => wallet.address.toLowerCase() === nominated.address.toLowerCase()),
        ));
    if (
      nominated.unmetRequirements.length ||
      !Number.isFinite(eligibilityExpiry) ||
      eligibilityExpiry <= Date.now() ||
      !approved ||
      !Number.isFinite(approvalExpiry) ||
      approvalExpiry % 1000 !== 0 ||
      approvalExpiry > eligibilityExpiry ||
      !documented ||
      approved.snapshot.target.address.toLowerCase() !== nominated.address.toLowerCase() ||
      !approved.expiresAt ||
      Date.parse(approved.expiresAt) <= Date.now() ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      state.isInvalidated ||
      !state.data?.members.some((member) => member.member === source.member && !member.walletless)
    )
      throw createUserFriendlyError(
        'Refresh genuine proof, finite approval and the exact linked member before this new grant decision.',
      );
  };
  const guardLink = (
    kind: RegisterStep,
    source: { mapping: RegisterLinkPreparation['mapping']; nomination: string } | RegisterLink,
  ) => {
    guardStep(kind);
    if (source.mapping.length !== 1 || !source.mapping[0]?.member || !source.mapping[0]?.address)
      throw createUserFriendlyError('Link this exact nominated address to one explicit stable member.');
    if ('uuid' in source) {
      const retained = freshRows<RegisterLink>(linkKey).find((row) => row.uuid === source.uuid);
      if (
        !retained ||
        retained.status !== source.status ||
        retained.stage !== source.stage ||
        retained.evidenceFingerprint !== source.evidenceFingerprint ||
        JSON.stringify(retained.mapping) !== JSON.stringify(source.mapping) ||
        JSON.stringify(retained.decisions) !== JSON.stringify(source.decisions)
      )
        throw createUserFriendlyError('The exact retained member link changed. Refresh before a new decision.');
    }
    if (kind !== 'reject') guardClass();
    if (!('uuid' in source)) {
      const nominated = nomination(source.nomination);
      if (source.mapping[0]!.address.toLowerCase() !== nominated.address.toLowerCase())
        throw createUserFriendlyError('The selected nominated address changed.');
    }
  };
  const refresh = async (available?: () => boolean) => {
    const currentRead = () =>
      !available || (available() && !readingPaused && !(pending.current && workingOwner === owner));
    if (!currentRead()) return;
    if (
      available &&
      [
        appointmentKey,
        issueKey,
        nominationKey,
        approvalKey,
        memberKey,
        linkKey,
        options.tokenKey,
        USER_PREFERENCES_QUERY_KEY,
        AUTH_QUERY_KEY,
      ].some((queryKey) => client.isFetching({ queryKey, exact: true }))
    )
      return false;
    setError(null);
    try {
      ownerGuard();
      if ((await appointments.refetch({ cancelRefetch: false })).isError || !currentRead()) return;
      guard();
      if (available) {
        await client.refetchQueries({ queryKey: options.tokenKey, exact: true }, { cancelRefetch: false });
        if (!currentRead()) return;
        guard();
        const source = client.getQueryState(options.tokenKey);
        if (source?.status !== 'success' || source.fetchStatus !== 'idle') return;
      }
      await Promise.all([
        nominations.refetch({ cancelRefetch: false }),
        walletApprovals.refetch({ cancelRefetch: false }),
        members.refetch({ cancelRefetch: false }),
        links.refetch({ cancelRefetch: false }),
        instructions.refetch({ cancelRefetch: false }),
      ]);
      if (!currentRead()) return;
      guard();
    } catch (failure) {
      if (mounted.current && boundary.get() === owner)
        setError(failureSentence(failure, 'Current company grant records could not be refreshed.'));
    }
  };
  const accept = async (record: RegisterIssue) => {
    guard();
    if (
      record.company !== company ||
      record.token !== tokenUuid ||
      record.snapshot.company.uuid !== company ||
      record.snapshot.token.uuid !== tokenUuid
    )
      throw createUserFriendlyError('The retained grant receipt identifies another company or class.');
    setKept((prior) => ({
      owner,
      company,
      issues: [
        record,
        ...(prior.owner === owner && prior.company === company
          ? prior.issues.filter((row) => row.uuid !== record.uuid)
          : []),
      ],
      links: prior.owner === owner && prior.company === company ? prior.links : [],
    }));
    await instructions.refetch();
    guard();
  };
  const acceptLink = async (record: RegisterLink) => {
    guard();
    if (record.company !== company) throw createUserFriendlyError('The link receipt identifies another company.');
    setKept((prior) => ({
      owner,
      company,
      links: [
        record,
        ...(prior.owner === owner && prior.company === company
          ? prior.links.filter((row) => row.uuid !== record.uuid)
          : []),
      ],
      issues: prior.owner === owner && prior.company === company ? prior.issues : [],
    }));
    await Promise.all([links.refetch(), members.refetch()]);
    guard();
  };
  const send = async (operation: Original, recovering: boolean) => {
    if (pending.current || (!recovering && original !== null && original.owner === owner)) return;
    pending.current = true;
    setWorkingOwner(owner);
    setBusy(true);
    setError(null);
    let dispatched = false;
    try {
      const fresh = () => {
        if (operation.body.appointment !== steps.prepare?.uuid)
          throw createUserFriendlyError('The preparation appointment changed.');
        if (operation.kind === 'issue') guardIssue('prepare', operation.body);
        else guardLink('prepare', { mapping: operation.body.mapping, nomination: operation.nomination });
      };
      const check = recovering ? guard : fresh;
      check();
      const requestConfig = config(check);
      const transforms = requestConfig.transformRequest ?? api.defaults?.transformRequest;
      const prior = Array.isArray(transforms) ? transforms : transforms ? [transforms] : [];
      const mark: AxiosRequestTransformer = (data) => {
        check();
        dispatched = true;
        return data;
      };
      requestConfig.transformRequest = [...prior, mark];
      setOriginal({ owner, company, token: tokenUuid, operation });
      if (operation.kind === 'issue') {
        const response = await prepareRegisterIssue(api, operation.body, requestConfig);
        guard();
        if (!isPreparedRegisterIssue(response.data, operation.body, company, operation.address))
          throw createUserFriendlyError('The grant receipt could not be confirmed. Recover its original request.');
        setOriginal(null);
        await accept(response.data);
        options.onPrepared?.('issue');
      } else {
        const response = await prepareRegisterLink(api, operation.body, requestConfig);
        guard();
        if (!isPreparedRegisterLink(response.data, operation.body))
          throw createUserFriendlyError(
            'The member link receipt could not be confirmed. Recover its original request.',
          );
        setOriginal(null);
        await acceptLink(response.data);
        options.onPrepared?.('link');
      }
    } catch (failure) {
      const cause = (failure as { originalError?: unknown }).originalError ?? failure;
      const status = failureStatus(cause);
      if (!dispatched || status === 400 || status === 409) setOriginal(null);
      if (mounted.current && boundary.get() === owner)
        setError(
          refusalSentence(failure, REGISTER_ISSUE_UNMET_COPY) ??
            failureSentence(failure, 'The outcome is uncertain. Recover the identical original request.'),
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const sendIssue = async (input: IssueInput) => {
    const nominated = nomination(input.nomination);
    await send(
      {
        kind: 'issue',
        body: { ...input, operationId: options.newKey(), appointment: steps.prepare?.uuid ?? '', token: tokenUuid },
        address: nominated.address,
      },
      false,
    );
  };
  const sendLink = async (input: LinkInput, nominated: string) =>
    send(
      {
        kind: 'link',
        body: { ...input, operationId: options.newKey(), appointment: steps.prepare?.uuid ?? '', companyId: company },
        nomination: nominated,
      },
      false,
    );
  const recovery =
    original?.owner === owner && original.company === company && original.token === tokenUuid
      ? original.operation
      : null;
  const recover = async () => {
    if (recovery) await send(recovery, true);
  };
  const classState = client.getQueryState<CompanyShareToken>(options.tokenKey);
  const canPrepare =
    visible &&
    !!steps.prepare &&
    !recovery &&
    classState?.status === 'success' &&
    classState.fetchStatus === 'idle' &&
    !classState.isInvalidated &&
    classState.data?.status === 'deployed' &&
    classState.data.chain === 'base';
  return {
    working: busy && workingOwner === owner,
    owner,
    company,
    scopeKey,
    readingPaused,
    visible,
    canPrepare,
    steps,
    appointments,
    nominations,
    walletApprovals,
    members,
    links,
    linksRecords,
    instructions,
    records,
    busy,
    error,
    recovery,
    guard,
    guardStep,
    guardIssue,
    guardLink,
    config,
    sendIssue,
    sendLink,
    recover,
    accept,
    acceptLink,
    refresh,
  };
}

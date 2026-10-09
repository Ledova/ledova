import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { AxiosInstance, AxiosRequestConfig, AxiosRequestTransformer } from 'axios';
import { useSubmissionOwner } from './useSubmissionOwner';
import { AUTH_QUERY_KEY } from './useAuth';
import { USER_PREFERENCES_QUERY_KEY } from './useUserPreferences';
import { isCurrentEligibilityAppointment } from './useCompanyEligibilityRecords';
import type { OrderSubmissionSession } from './useOrderSubmissions';
import { getOwnCompanyAppointments } from '../services/company-authority';
import {
  getRegisterPaidIssues,
  getRegisterPaidIssueSubscriptions,
  prepareRegisterPaidIssue,
} from '../services/register-paid-issues';
import { readEveryPage } from '../utils/pagination';
import { appointmentForRegisterStep, failureStatus, type RegisterStep } from '../utils/register-commands';
import { isPreparedRegisterPaidIssue, isRegisterPaidIssueSource } from '../utils/register-paid-issues';
import { createUserFriendlyError, getErrorMessage } from '../utils/errors';
import type {
  CompanyShareToken,
  OwnCompanyAppointment,
  RegisterPaidIssue,
  RegisterPaidIssuePreparation,
  RegisterPaidIssueSource,
} from '../types';

type Input = Omit<RegisterPaidIssuePreparation, 'operationId' | 'appointment'>;
type Source = { source: RegisterPaidIssueSource; token: CompanyShareToken | undefined };
type Original = { body: RegisterPaidIssuePreparation; source: Source };

export function useCompanyPaidIssues(
  api: AxiosInstance,
  tokenUuid: string,
  options: {
    token: CompanyShareToken | undefined;
    tokenKey: QueryKey;
    newKey: () => string;
    session?: OrderSubmissionSession;
  },
) {
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
  const scopeKey = scope.join('/');
  const appointmentKey = ['company-paid-issue-appointments', ...scope];
  const issueKey = ['company-paid-issues', ...scope];
  const [kept, setKept] = useState<{ owner: typeof owner; company: string; records: RegisterPaidIssue[] }>({
    owner,
    company,
    records: [],
  });
  const [original, setOriginal] = useState<{ owner: typeof owner; company: string; operation: Original } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setClock] = useState(0);
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
      throw createUserFriendlyError('Your account or selected class changed. Reopen company paid issue decisions.');
  };
  const config = (check = ownerGuard): AxiosRequestConfig => ({
    ...options.session?.requestConfig(),
    ledovaSubmissionGuard: check,
  });
  const appointments = useQuery({
    queryKey: appointmentKey,
    enabled: !!owner && !!company,
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
  const retain = (rows: RegisterPaidIssue[]) =>
    setKept((prior) => ({
      owner,
      company,
      records: [
        ...rows,
        ...(prior.owner === owner && prior.company === company
          ? prior.records.filter((row) => row.token === tokenUuid && !rows.some((fresh) => fresh.uuid === row.uuid))
          : []),
      ],
    }));
  const instructions = useQuery({
    queryKey: issueKey,
    enabled: visible,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const response = await getRegisterPaidIssues(api, { company, token: tokenUuid, page }, config(guard));
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
          throw createUserFriendlyError('The paid issue records belong to another company or class.');
        return response;
      }).then((rows) => {
        guard();
        retain(rows);
        return rows;
      }),
  });
  const fresh = instructions.isSuccess && !instructions.isFetching ? instructions.data : [];
  const records = [
    ...fresh,
    ...(kept.owner === owner && kept.company === company
      ? kept.records.filter((row) => row.token === tokenUuid && !fresh.some((item) => item.uuid === row.uuid))
      : []),
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
      state.data.chain !== 'base' ||
      state.data.decimals !== 0 ||
      !state.data.contractAddress
    )
      throw createUserFriendlyError('Refresh this supported deployed Base class before a new paid issue decision.');
    return state.data;
  };
  const currentRecords = () => {
    const state = client.getQueryState<RegisterPaidIssue[]>(issueKey);
    if (state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || !state.data)
      throw createUserFriendlyError('Refresh the exact company paid issue source before continuing.');
    return state.data;
  };
  const availableSubscriptions = useQuery({
    queryKey: ['company-paid-issue-sources', ...scope],
    enabled: visible && !!steps.prepare,
    queryFn: async () => {
      guardStep('prepare');
      const response = await getRegisterPaidIssueSubscriptions(
        api,
        { company, token: tokenUuid },
        config(() => guardStep('prepare')),
      );
      guardStep('prepare');
      if (
        response.data.some((source) => !isRegisterPaidIssueSource(source, company, tokenUuid)) ||
        new Set(response.data.map((source) => source.subscription)).size !== response.data.length
      )
        throw createUserFriendlyError('The paid subscription sources do not identify this company and class.');
      return response.data;
    },
  });
  const currentSources = () => {
    const state = client.getQueryState<RegisterPaidIssueSource[]>(['company-paid-issue-sources', ...scope]);
    if (state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || !state.data)
      throw createUserFriendlyError('Refresh the exact available paid subscription sources before continuing.');
    return state.data;
  };
  const guardPaidIssue = (kind: RegisterStep, source: Source | RegisterPaidIssue) => {
    guardStep(kind);
    const rows = currentRecords();
    if ('uuid' in source) {
      const record = rows.find((row) => row.uuid === source.uuid);
      if (
        !record ||
        record.status !== source.status ||
        record.stage !== source.stage ||
        record.subscription !== source.subscription ||
        record.request !== source.request ||
        record.intentDigest !== source.intentDigest ||
        record.evidenceFingerprint !== source.evidenceFingerprint ||
        JSON.stringify(record.snapshot) !== JSON.stringify(source.snapshot) ||
        JSON.stringify(record.decisions) !== JSON.stringify(source.decisions)
      )
        throw createUserFriendlyError('The exact retained paid issue changed. Refresh before a new decision.');
    } else {
      if (rows.some((row) => row.subscription === source.source.subscription && row.request))
        throw createUserFriendlyError('This paid subscription already has its original admitted issuance.');
      const currentSource = currentSources().find((row) => row.subscription === source.source.subscription);
      if (
        !currentSource ||
        !isRegisterPaidIssueSource(source.source, company, tokenUuid) ||
        JSON.stringify(currentSource) !== JSON.stringify(source.source)
      )
        throw createUserFriendlyError(
          'The captured paid subscription source changed. Select its current recorded terms.',
        );
    }
    if (kind === 'reject') return;
    const token = guardClass();
    const captured = 'uuid' in source ? source.snapshot.token : source.token;
    const capturedCompanyName = 'uuid' in source ? source.snapshot.company.name : source.token?.companyName;
    const authorised = 'uuid' in source ? source.snapshot.token.authorisedShares : source.token?.totalSupply;
    if (
      !captured ||
      captured.uuid !== tokenUuid ||
      captured.name !== token.name ||
      captured.symbol !== token.symbol ||
      captured.chain !== token.chain ||
      captured.contractAddress?.toLowerCase() !== token.contractAddress?.toLowerCase() ||
      capturedCompanyName !== token.companyName ||
      authorised !== token.totalSupply
    )
      throw createUserFriendlyError('The captured company or paid issue class changed. Select current source details.');
  };
  const refresh = async () => {
    try {
      ownerGuard();
      await appointments.refetch();
      guard();
      await instructions.refetch();
      guard();
      if (steps.prepare) {
        guardStep('prepare');
        await availableSubscriptions.refetch();
        guardStep('prepare');
      }
    } catch (failure) {
      if (mounted.current && boundary.get() === owner)
        setError(getErrorMessage(failure, 'Current paid issue records could not be refreshed.'));
    }
  };
  const accept = async (record: RegisterPaidIssue) => {
    guard();
    if (
      record.company !== company ||
      record.token !== tokenUuid ||
      record.snapshot.company.uuid !== company ||
      record.snapshot.token.uuid !== tokenUuid
    )
      throw createUserFriendlyError('The retained paid issue receipt identifies another company or class.');
    retain([record]);
    await instructions.refetch();
    guard();
  };
  const send = async (operation: Original, recovering: boolean) => {
    if (
      pending.current ||
      (!recovering &&
        original?.owner === owner &&
        original?.company === company &&
        original?.operation.source.source.token === tokenUuid)
    )
      return;
    pending.current = true;
    setBusy(true);
    setError(null);
    let dispatched = false;
    try {
      const freshGuard = () => {
        if (operation.body.appointment !== steps.prepare?.uuid)
          throw createUserFriendlyError('The preparation appointment changed.');
        if (operation.body.subscription !== operation.source.source.subscription)
          throw createUserFriendlyError('The original paid subscription identity changed.');
        guardPaidIssue('prepare', operation.source);
      };
      const check = recovering ? guard : freshGuard;
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
      setOriginal({ owner, company, operation });
      const response = await prepareRegisterPaidIssue(api, operation.body, requestConfig);
      guard();
      if (!isPreparedRegisterPaidIssue(response.data, operation.body, operation.source.source, operation.source.token))
        throw createUserFriendlyError('The paid issue receipt could not be confirmed. Recover its original request.');
      setOriginal(null);
      await accept(response.data);
    } catch (failure) {
      const cause = (failure as { originalError?: unknown }).originalError ?? failure;
      const status = failureStatus(cause);
      if (!dispatched || status === 400 || status === 409) setOriginal(null);
      if (mounted.current && boundary.get() === owner)
        setError(getErrorMessage(failure, 'The outcome is uncertain. Recover the identical original request.'));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const prepare = async (input: Input, source: Source) =>
    send(
      {
        body: { ...input, operationId: options.newKey(), appointment: steps.prepare?.uuid ?? '' },
        source: { source: { ...source.source }, token: source.token ? { ...source.token } : undefined },
      },
      false,
    );
  const recovery =
    original?.owner === owner && original.company === company && original.operation.source.source.token === tokenUuid
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
    classState.data?.chain === 'base' &&
    !!classState.data.contractAddress;
  return {
    owner,
    company,
    scopeKey,
    visible,
    canPrepare,
    steps,
    appointments,
    instructions,
    availableSubscriptions,
    records,
    source: classState?.data,
    busy,
    error,
    recovery,
    guard,
    guardStep,
    guardPaidIssue,
    config,
    prepare,
    recover,
    accept,
    refresh,
  };
}

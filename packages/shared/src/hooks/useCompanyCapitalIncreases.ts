import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { AxiosInstance, AxiosRequestConfig, AxiosRequestTransformer } from 'axios';
import { useSubmissionOwner } from './useSubmissionOwner';
import { AUTH_QUERY_KEY } from './useAuth';
import { USER_PREFERENCES_QUERY_KEY } from './useUserPreferences';
import { isCurrentEligibilityAppointment } from './useCompanyEligibilityRecords';
import type { OrderSubmissionSession } from './useOrderSubmissions';
import { getOwnCompanyAppointments } from '../services/company-authority';
import { getRegisterCapitalIncreases, prepareRegisterCapitalIncrease } from '../services/register-capital-increases';
import { readEveryPage } from '../utils/pagination';
import { appointmentForRegisterStep, failureStatus, type RegisterStep } from '../utils/register-commands';
import { isPreparedRegisterCapitalIncrease } from '../utils/register-capital-increases';
import { requestShares, wholeShares } from '../utils/share-quantities';
import { createUserFriendlyError, getErrorMessage } from '../utils/errors';
import type {
  CompanyShareToken,
  OwnCompanyAppointment,
  RegisterCapitalIncrease,
  RegisterCapitalIncreasePreparation,
} from '../types';

type Input = Omit<RegisterCapitalIncreasePreparation, 'operationId' | 'appointment' | 'token'>;
type Source = { priorAuthorizedTotal: string; additionalShares: number; newAuthorizedTotal: number };
type Original = { body: RegisterCapitalIncreasePreparation; priorAuthorizedTotal: string };

export function useCompanyCapitalIncreases(
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
  const appointmentKey = ['company-capital-appointments', ...scope];
  const increaseKey = ['company-capital-increases', ...scope];
  const [kept, setKept] = useState<{ owner: typeof owner; company: string; records: RegisterCapitalIncrease[] }>({
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
      throw createUserFriendlyError('Your account or selected class changed. Reopen company capital increases.');
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
  const retain = (rows: RegisterCapitalIncrease[]) =>
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
    queryKey: increaseKey,
    enabled: visible,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const response = await getRegisterCapitalIncreases(api, { company, token: tokenUuid, page }, config(guard));
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
          throw createUserFriendlyError('The capital records belong to another company or class.');
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
      !['deployed', 'paused'].includes(state.data.status) ||
      state.data.chain !== 'base' ||
      state.data.decimals !== 0 ||
      !state.data.contractAddress ||
      wholeShares(state.data.totalSupply) === null
    )
      throw createUserFriendlyError(
        'Refresh this supported deployed or paused Base class before a new capital decision.',
      );
    return state.data;
  };
  const currentRecords = () => {
    const state = client.getQueryState<RegisterCapitalIncrease[]>(increaseKey);
    if (state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || !state.data)
      throw createUserFriendlyError('Refresh the exact company capital source before continuing.');
    return state.data;
  };
  const guardCapital = (kind: RegisterStep, source: Source | RegisterCapitalIncrease) => {
    guardStep(kind);
    const rows = currentRecords();
    if ('uuid' in source) {
      const record = rows.find((row) => row.uuid === source.uuid);
      if (
        !record ||
        record.status !== source.status ||
        record.stage !== source.stage ||
        record.intentDigest !== source.intentDigest ||
        record.evidenceFingerprint !== source.evidenceFingerprint ||
        JSON.stringify(record.snapshot) !== JSON.stringify(source.snapshot) ||
        JSON.stringify(record.decisions) !== JSON.stringify(source.decisions)
      )
        throw createUserFriendlyError('The exact retained capital increase changed. Refresh before a new decision.');
    }
    if (kind === 'reject') return;
    const token = guardClass();
    const capital = 'uuid' in source ? source.snapshot.capital : source;
    const prior = wholeShares(capital.priorAuthorizedTotal);
    const delta = requestShares(String(capital.additionalShares));
    const target = requestShares(String(capital.newAuthorizedTotal));
    if (
      prior === null ||
      delta === null ||
      target === null ||
      prior + BigInt(delta) !== BigInt(target) ||
      token.totalSupply !== capital.priorAuthorizedTotal ||
      ('uuid' in source &&
        (source.snapshot.token.contractAddress!.toLowerCase() !== token.contractAddress!.toLowerCase() ||
          source.snapshot.token.name !== token.name ||
          source.snapshot.token.symbol !== token.symbol ||
          source.snapshot.company.name !== token.companyName ||
          source.snapshot.token.chain !== token.chain ||
          source.snapshot.token.decimals !== token.decimals))
    )
      throw createUserFriendlyError(
        'The captured authorised cap or exact increase changed. Refresh before a new capital decision.',
      );
  };
  const refresh = async () => {
    try {
      ownerGuard();
      await appointments.refetch();
      guard();
      await instructions.refetch();
      guard();
    } catch (failure) {
      if (mounted.current && boundary.get() === owner)
        setError(getErrorMessage(failure, 'Current capital records could not be refreshed.'));
    }
  };
  const accept = async (record: RegisterCapitalIncrease) => {
    guard();
    if (
      record.company !== company ||
      record.token !== tokenUuid ||
      record.snapshot.company.uuid !== company ||
      record.snapshot.token.uuid !== tokenUuid
    )
      throw createUserFriendlyError('The retained capital receipt identifies another company or class.');
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
        original?.operation.body.token === tokenUuid)
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
        guardCapital('prepare', {
          priorAuthorizedTotal: operation.priorAuthorizedTotal,
          additionalShares: operation.body.additionalShares,
          newAuthorizedTotal: operation.body.newAuthorizedTotal,
        });
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
      const response = await prepareRegisterCapitalIncrease(api, operation.body, requestConfig);
      guard();
      if (!isPreparedRegisterCapitalIncrease(response.data, operation.body, company, operation.priorAuthorizedTotal))
        throw createUserFriendlyError('The capital receipt could not be confirmed. Recover its original request.');
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
  const prepare = async (input: Input, priorAuthorizedTotal: string) =>
    send(
      {
        body: { ...input, operationId: options.newKey(), appointment: steps.prepare?.uuid ?? '', token: tokenUuid },
        priorAuthorizedTotal,
      },
      false,
    );
  const recovery =
    original?.owner === owner && original.company === company && original.operation.body.token === tokenUuid
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
    ['deployed', 'paused'].includes(classState.data?.status ?? '') &&
    classState.data?.chain === 'base' &&
    classState.data.decimals === 0 &&
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
    records,
    source: classState?.data,
    busy,
    error,
    recovery,
    guard,
    guardStep,
    guardCapital,
    config,
    prepare,
    recover,
    accept,
    refresh,
  };
}

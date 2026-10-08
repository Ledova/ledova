import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosInstance, AxiosRequestConfig, AxiosRequestTransformer } from 'axios';
import { useSubmissionOwner } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY } from './useUserPreferences';
import { isCurrentEligibilityAppointment } from './useCompanyEligibilityRecords';
import type { OrderSubmissionSession } from './useOrderSubmissions';
import { getOwnCompanyAppointments } from '../services/company-authority';
import {
  getCompanyWalletNominations,
  getCompanyWalletTargets,
  getCompanyWalletInstructions,
  prepareCompanyWalletInstruction,
} from '../services/company-wallets';
import { readEveryPage } from '../utils/pagination';
import { appointmentForRegisterStep, type RegisterStep } from '../utils/register-commands';
import { isPreparedCompanyWalletInstruction } from '../utils/company-wallets';
import { createUserFriendlyError, getErrorMessage } from '../utils/errors';
import type {
  OwnCompanyAppointment,
  CompanyWalletInstruction,
  CompanyWalletPreparation,
  CompanyWalletNomination,
  CompanyWalletTarget,
} from '../types';

export function useCompanyWalletInstructions(
  api: AxiosInstance,
  options: { newKey: () => string; session?: OrderSubmissionSession },
) {
  const client = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(options.session);
  const mounted = useRef(true);
  const selected = useRef({ owner, company: '' });
  const pending = useRef(false);
  const [companyUuid, setCompanyUuid] = useState('');
  const [kept, setKept] = useState<{ owner: typeof owner; company: string; records: CompanyWalletInstruction[] }>({
    owner,
    company: '',
    records: [],
  });
  const [retained, setRetained] = useState<{ owner: typeof owner; body: CompanyWalletPreparation } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const scope = [owner?.userUuid, owner?.ownerAccountUuid, options.session?.getEpoch() ?? 0];
  const scopeKey = [...scope, companyUuid].join('/');
  const appointmentKey = ['company-wallet-appointments', ...scope];
  const nominationKey = ['company-wallet-nominations', ...scope, companyUuid];
  const targetKey = ['company-wallet-targets', ...scope, companyUuid];
  const instructionKey = ['company-wallet-instructions', ...scope, companyUuid];
  useLayoutEffect(() => {
    selected.current = { owner, company: companyUuid };
  }, [owner, companyUuid]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const ownerGuard = () => {
    const state = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    if (
      !mounted.current ||
      !owner ||
      boundary.get() !== owner ||
      selected.current.company !== companyUuid ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      state.isInvalidated
    )
      throw createUserFriendlyError('Your account or selected company changed. Reopen wallet instructions.');
  };
  const config = (check = ownerGuard): AxiosRequestConfig => ({
    ...options.session?.requestConfig(),
    ledovaSubmissionGuard: check,
  });
  const appointments = useQuery({
    queryKey: appointmentKey,
    enabled: !!owner,
    queryFn: () =>
      readEveryPage(async (page) => {
        ownerGuard();
        const response = await getOwnCompanyAppointments(api, page, config());
        ownerGuard();
        return response;
      }),
  });
  const readable = (row: OwnCompanyAppointment) =>
    isCurrentEligibilityAppointment(row) &&
    row.capabilities.some((capability) =>
      ['admin', 'read_register', 'prepare', 'approve', 'apply'].includes(capability),
    );
  const guard = () => {
    ownerGuard();
    const state = client.getQueryState<OwnCompanyAppointment[]>(appointmentKey);
    if (
      !companyUuid ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      state.isInvalidated ||
      !state.data?.some((row) => row.company === companyUuid && readable(row))
    )
      throw createUserFriendlyError(
        'Current personal register access for this exact company is required. Refresh appointments.',
      );
  };
  const enabled =
    !!owner &&
    !!companyUuid &&
    appointments.isSuccess &&
    !appointments.isFetching &&
    appointments.data.some((row) => row.company === companyUuid && readable(row));
  const nominations = useQuery({
    queryKey: nominationKey,
    enabled,
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getCompanyWalletNominations(api, { company: companyUuid, page }, config(guard));
        guard();
        return response;
      });
      if (rows.some((row) => row.company !== companyUuid || row.chain !== 'base'))
        throw createUserFriendlyError('The nominations did not identify the selected company.');
      return rows;
    },
  });
  const targets = useQuery({
    queryKey: targetKey,
    enabled,
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getCompanyWalletTargets(api, { company: companyUuid, page }, config(guard));
        guard();
        return response;
      });
      if (rows.some((row) => row.company !== companyUuid || !['confirmed', 'unchanged'].includes(row.status)))
        throw createUserFriendlyError('The removal targets did not identify retained successful company ADD journals.');
      return rows;
    },
  });
  const instructions = useQuery({
    queryKey: instructionKey,
    enabled,
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getCompanyWalletInstructions(api, { company: companyUuid, page }, config(guard));
        guard();
        return response;
      });
      if (rows.some((row) => row.company !== companyUuid || row.snapshot.company.uuid !== companyUuid))
        throw createUserFriendlyError('The wallet instruction history did not identify the selected company.');
      setKept((prior) => ({
        owner,
        company: companyUuid,
        records: [
          ...rows,
          ...(prior.owner === owner && prior.company === companyUuid
            ? prior.records.filter((row) => !rows.some((fresh) => fresh.uuid === row.uuid))
            : []),
        ],
      }));
      return rows;
    },
  });
  const rows = appointments.isSuccess && !appointments.isFetching ? appointments.data : [];
  useEffect(() => {
    const expires = (appointments.data ?? [])
      .map((row) => Date.parse(row.expiresAt ?? ''))
      .filter((value) => Number.isFinite(value) && value > Date.now());
    if (!expires.length) return;
    const timer = setTimeout(
      () => setClock((value) => value + 1),
      Math.min(86400000, Math.max(1, Math.min(...expires) - Date.now() + 1)),
    );
    return () => clearTimeout(timer);
  }, [appointments.data, clock]);
  const steps = Object.fromEntries(
    (['prepare', 'approve', 'apply', 'reject'] as const).map((kind) => [
      kind,
      appointmentForRegisterStep(rows, companyUuid, kind),
    ]),
  ) as Partial<Record<RegisterStep, OwnCompanyAppointment>>;
  const guardStep = (step: RegisterStep) => {
    guard();
    const actual = client.getQueryData<OwnCompanyAppointment[]>(appointmentKey) ?? [];
    if (!steps[step] || appointmentForRegisterStep(actual, companyUuid, step)?.uuid !== steps[step]?.uuid)
      throw createUserFriendlyError(
        'Your exact appointment for this wallet instruction step changed. Refresh before continuing.',
      );
    if (step !== 'prepare') {
      const state = client.getQueryState(instructionKey);
      if (state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated)
        throw createUserFriendlyError('Refresh this exact company wallet instruction history before a new decision.');
    }
  };
  const guardInstruction = (step: RegisterStep, record: CompanyWalletInstruction) => {
    guardStep(step);
    const fresh = client
      .getQueryData<CompanyWalletInstruction[]>(instructionKey)
      ?.find((row) => row.uuid === record.uuid);
    if (
      !fresh ||
      fresh.company !== companyUuid ||
      fresh.status !== record.status ||
      fresh.stage !== record.stage ||
      fresh.intentDigest !== record.intentDigest ||
      JSON.stringify(fresh.snapshot) !== JSON.stringify(record.snapshot) ||
      JSON.stringify(fresh.decisions) !== JSON.stringify(record.decisions)
    )
      throw createUserFriendlyError(
        'The exact wallet instruction changed. Refresh its retained history before a new decision.',
      );
    if (record.action === 'add' && (step === 'approve' || step === 'apply')) {
      const state = client.getQueryState<CompanyWalletNomination[]>(nominationKey);
      const source = state?.data?.find((row) => row.uuid === record.nomination);
      if (
        state?.status !== 'success' ||
        state.fetchStatus !== 'idle' ||
        state.isInvalidated ||
        !source ||
        source.company !== companyUuid ||
        source.unmetRequirements.length ||
        source.address !== record.snapshot.target.address ||
        source.chain !== record.snapshot.target.chain ||
        source.request !== record.snapshot.source.request ||
        source.decision !== record.snapshot.source.decision ||
        source.proofCompletedAt !== record.snapshot.source.proofCompletedAt ||
        source.eligibilityExpiresAt !== record.snapshot.source.eligibilityExpiresAt ||
        Date.parse(record.expiresAt ?? '') <= Date.now() ||
        Date.parse(source.eligibilityExpiresAt) < Date.parse(record.expiresAt ?? '')
      )
        throw createUserFriendlyError(
          'The original wallet nomination or company eligibility changed. Refresh before a new approval or application.',
        );
    }
  };
  const refresh = async () => {
    try {
      ownerGuard();
      await appointments.refetch();
      ownerGuard();
      if (companyUuid) {
        guard();
        await Promise.all([nominations.refetch(), targets.refetch(), instructions.refetch()]);
        guard();
      }
    } catch (failure) {
      if (mounted.current && boundary.get() === owner)
        setError(
          getErrorMessage(
            failure,
            'Current private company wallet access could not be refreshed. Original requests are retained.',
          ),
        );
    }
  };
  const accept = async (record: CompanyWalletInstruction) => {
    guard();
    if (record.company !== companyUuid || record.snapshot.company.uuid !== companyUuid)
      throw createUserFriendlyError('The retained wallet receipt did not identify this company.');
    setKept((prior) => ({
      owner,
      company: companyUuid,
      records: [
        record,
        ...(prior.owner === owner && prior.company === companyUuid
          ? prior.records.filter((row) => row.uuid !== record.uuid)
          : []),
      ],
    }));
    await instructions.refetch();
    guard();
  };
  const send = async (input?: Omit<CompanyWalletPreparation, 'operationId' | 'appointment' | 'company'>) => {
    if (pending.current || (input && retained?.owner === owner && retained.body.company === companyUuid)) return;
    const recover = !input;
    const operation = recover
      ? retained
      : {
          owner,
          body: {
            ...input!,
            operationId: options.newKey(),
            appointment: steps.prepare?.uuid ?? '',
            company: companyUuid,
          },
        };
    if (!operation || operation.owner !== owner || operation.body.company !== companyUuid) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    let dispatched = false;
    try {
      const fresh = () => {
        guardStep('prepare');
        if (operation.body.appointment !== steps.prepare?.uuid)
          throw createUserFriendlyError('The original preparation appointment changed.');
        if (operation.body.action === 'add') {
          const state = client.getQueryState<CompanyWalletNomination[]>(nominationKey);
          const source = state?.data?.find(
            (row) =>
              row.uuid === operation.body.nomination &&
              row.company === companyUuid &&
              row.unmetRequirements.length === 0,
          );
          const expires = Date.parse(operation.body.expiresAt ?? '');
          if (
            state?.status !== 'success' ||
            state.fetchStatus !== 'idle' ||
            state.isInvalidated ||
            !source ||
            !Number.isFinite(expires) ||
            expires <= Date.now() ||
            expires > Date.parse(source.eligibilityExpiresAt) ||
            expires % 1000 !== 0
          )
            throw createUserFriendlyError(
              'Refresh and select the exact current company wallet nomination before preparing approval.',
            );
        } else {
          const state = client.getQueryState<CompanyWalletTarget[]>(targetKey);
          if (
            state?.status !== 'success' ||
            state.fetchStatus !== 'idle' ||
            state.isInvalidated ||
            !state.data?.some((row) => row.uuid === operation.body.targetChange && row.company === companyUuid)
          )
            throw createUserFriendlyError(
              'Refresh and select the exact retained company ADD journal before preparing removal.',
            );
        }
      };
      const check = recover ? guard : fresh;
      check();
      const dispatchConfig = config(check);
      const transforms = dispatchConfig.transformRequest ?? api.defaults.transformRequest;
      const prior = Array.isArray(transforms) ? transforms : transforms ? [transforms] : [];
      const dispatch: AxiosRequestTransformer = (data) => {
        check();
        dispatched = true;
        return data;
      };
      dispatchConfig.transformRequest = [...prior, dispatch];
      setRetained(operation);
      const response = await prepareCompanyWalletInstruction(api, operation.body, dispatchConfig);
      guard();
      if (!isPreparedCompanyWalletInstruction(response.data, operation.body))
        throw createUserFriendlyError(
          'The wallet instruction receipt could not be confirmed. Recover its identical original request.',
        );
      setRetained(null);
      await accept(response.data);
    } catch (failure) {
      const cause = (failure as { originalError?: unknown }).originalError ?? failure;
      const status = (cause as { response?: { status?: number } }).response?.status;
      if (!dispatched || status === 400 || status === 409) setRetained(null);
      if (mounted.current && boundary.get() === owner)
        setError(
          getErrorMessage(
            failure,
            'The preparation outcome is uncertain. Recover its identical original body and operation UUID.',
          ),
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const companies = [
    ...new Map(
      rows.filter(readable).map((row) => [row.company, { uuid: row.company, name: row.companyName }]),
    ).values(),
  ];
  const records = kept.owner === owner && kept.company === companyUuid ? kept.records : [];
  const original = retained?.owner === owner && retained.body.company === companyUuid ? retained : null;
  const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const canRead =
    enabled && preferences?.status === 'success' && preferences.fetchStatus === 'idle' && !preferences.isInvalidated;
  return {
    owner,
    canRead,
    scopeKey,
    appointments,
    companies,
    companyUuid,
    steps,
    nominations,
    targets,
    instructions,
    records: canRead ? records : [],
    retainedRecords: records,
    original: canRead ? original : null,
    busy,
    error,
    guard,
    guardStep,
    guardInstruction,
    refresh,
    accept,
    setCompany: (uuid: string) => {
      if (pending.current) return;
      selected.current = { owner, company: uuid };
      setCompanyUuid(uuid);
      setRetained(null);
      setError(null);
    },
    prepare: (input: Omit<CompanyWalletPreparation, 'operationId' | 'appointment' | 'company'>) => send(input),
    recover: () => send(),
  };
}

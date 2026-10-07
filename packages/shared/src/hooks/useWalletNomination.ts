import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosInstance, AxiosRequestConfig, AxiosRequestTransformer } from 'axios';
import { useSubmissionOwner } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY } from './useUserPreferences';
import type { OrderSubmissionSession } from './useOrderSubmissions';
import { getEligibilityRequest } from '../services/company-eligibility';
import { getWallets } from '../services/wallets';
import { createWalletNomination, getWalletNominations, previewWalletNomination } from '../services/company-wallets';
import { readEveryPage } from '../utils/pagination';
import { createUserFriendlyError, getErrorMessage } from '../utils/errors';
import { isWalletNominationReceipt } from '../utils/company-wallets';
import type {
  CompanyEligibilityRequest,
  Wallet,
  WalletNomination,
  WalletNominationPreview,
  WalletNominationRequest,
} from '../types';

export function useWalletNomination(
  api: AxiosInstance,
  options: { requestUuid: string; newKey: () => string; session?: OrderSubmissionSession; guardRequest?: () => void },
) {
  const client = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(options.session);
  const mounted = useRef(true);
  const selected = useRef({ owner, request: options.requestUuid, wallet: '' });
  const pending = useRef(false);
  const [walletSelection, setWalletSelection] = useState({ owner, uuid: '' });
  const walletUuid = walletSelection.owner === owner ? walletSelection.uuid : '';
  const [reviewed, setReviewed] = useState<{
    owner: typeof owner;
    body: WalletNominationRequest;
    preview: WalletNominationPreview;
    sourceDigest: string;
  } | null>(null);
  const [retained, setRetained] = useState<typeof reviewed>(null);
  const [receiptState, setReceipt] = useState<{ owner: typeof owner; record: WalletNomination } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = [owner?.userUuid, owner?.ownerAccountUuid, options.session?.getEpoch() ?? 0];
  const scopeKey = [...scope, options.requestUuid].join('/');
  const requestKey = ['eligibility-records', 'participant', ...scope, '', options.requestUuid];
  const walletKey = ['wallets', 'nomination', ...scope];
  const nominationKey = ['wallet-nominations', ...scope, options.requestUuid];
  useLayoutEffect(() => {
    selected.current = { owner, request: options.requestUuid, wallet: walletUuid };
  }, [owner, options.requestUuid, walletUuid]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const guard = () => {
    const state = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    if (
      !mounted.current ||
      !owner ||
      boundary.get() !== owner ||
      selected.current.request !== options.requestUuid ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      state.isInvalidated
    )
      throw createUserFriendlyError('Your account or selected eligibility request changed. Reopen wallet nomination.');
    options.guardRequest?.();
  };
  const config = (check = guard): AxiosRequestConfig => ({
    ...options.session?.requestConfig(),
    ledovaSubmissionGuard: check,
  });
  const request = useQuery({
    queryKey: requestKey,
    enabled: !!owner && !!options.requestUuid,
    queryFn: async () => {
      guard();
      const response = await getEligibilityRequest(api, options.requestUuid, config());
      guard();
      if (response.data.uuid !== options.requestUuid || response.data.userAccount !== owner!.ownerAccountUuid)
        throw createUserFriendlyError('The eligibility request did not identify this participant account.');
      return response.data;
    },
  });
  const wallets = useQuery({
    queryKey: walletKey,
    enabled: !!owner && !!options.requestUuid,
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getWallets(api, { chain: 'base', page }, config());
        guard();
        return response;
      });
      if (rows.some((row) => row.userAccount !== owner!.ownerAccountUuid || row.chain !== 'base'))
        throw createUserFriendlyError('The wallet selector did not identify your own Base wallets.');
      return rows;
    },
  });
  const nominations = useQuery({
    queryKey: nominationKey,
    enabled: !!owner && !!options.requestUuid,
    queryFn: async () => {
      const rows = await readEveryPage(async (page) => {
        guard();
        const response = await getWalletNominations(api, { request: options.requestUuid, page }, config());
        guard();
        return response;
      });
      if (
        rows.some(
          (row) => row.request !== options.requestUuid || (request.data && row.company !== request.data.company),
        )
      )
        throw createUserFriendlyError('The nomination history did not identify the selected company request.');
      return rows;
    },
  });
  const guardWallet = () => {
    guard();
    const source = client.getQueryState<CompanyEligibilityRequest>(requestKey);
    const own = client.getQueryState<Wallet[]>(walletKey);
    const wallet = own?.data?.find((row) => row.uuid === walletUuid);
    if (
      source?.status !== 'success' ||
      source.fetchStatus !== 'idle' ||
      source.isInvalidated ||
      source.data?.uuid !== options.requestUuid ||
      source.data.userAccount !== owner!.ownerAccountUuid ||
      own?.status !== 'success' ||
      own.fetchStatus !== 'idle' ||
      own.isInvalidated ||
      !wallet ||
      wallet.userAccount !== owner!.ownerAccountUuid ||
      wallet.chain !== 'base' ||
      selected.current.wallet !== walletUuid
    )
      throw createUserFriendlyError(
        'Refresh the exact own company request and selected Base wallet before continuing.',
      );
  };
  const refresh = async () => {
    try {
      guard();
      await Promise.all([request.refetch(), wallets.refetch(), nominations.refetch()]);
      guard();
    } catch (failure) {
      if (mounted.current && boundary.get() === owner)
        setError(
          getErrorMessage(failure, 'Current own wallet access could not be refreshed. Original requests are retained.'),
        );
    }
  };
  const review = async () => {
    if (pending.current || retained?.owner === owner) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setReviewed(null);
    try {
      guardWallet();
      const response = await previewWalletNomination(
        api,
        { request: options.requestUuid, wallet: walletUuid },
        config(guardWallet),
      );
      guardWallet();
      const source = client.getQueryData<CompanyEligibilityRequest>(requestKey)!;
      const wallet = client.getQueryData<Wallet[]>(walletKey)!.find((row) => row.uuid === walletUuid)!;
      const preview = response.data;
      if (
        preview.request !== options.requestUuid ||
        preview.company !== source.company ||
        preview.wallet !== walletUuid ||
        preview.address.toLowerCase() !== wallet.address.toLowerCase() ||
        preview.chain !== 'base' ||
        !/^[0-9a-f]{64}$/.test(preview.previewDigest)
      )
        throw createUserFriendlyError('The nomination preview could not be confirmed. Refresh before sharing.');
      setReviewed({
        owner,
        preview,
        sourceDigest: source.digest,
        body: {
          operationId: options.newKey(),
          request: options.requestUuid,
          wallet: walletUuid,
          previewDigest: preview.previewDigest,
          sharingAccepted: true,
        },
      });
    } catch (failure) {
      if (mounted.current && boundary.get() === owner)
        setError(getErrorMessage(failure, 'Wallet nomination could not be previewed.'));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const submit = async (recover: boolean) => {
    const original = recover ? retained : reviewed;
    if (pending.current || !original || original.owner !== owner || (!recover && !original.preview.canSubmit)) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    let dispatched = false;
    try {
      const check = recover
        ? guard
        : () => {
            guardWallet();
            if (selected.current.wallet !== original.body.wallet || selected.current.request !== original.body.request)
              throw createUserFriendlyError(
                'The reviewed wallet nomination changed. Review the exact selection again.',
              );
            const source = client.getQueryData<CompanyEligibilityRequest>(requestKey);
            const wallet = client.getQueryData<Wallet[]>(walletKey)?.find((row) => row.uuid === original.body.wallet);
            if (
              !source ||
              source.company !== original.preview.company ||
              source.digest !== original.sourceDigest ||
              source.outcome !== 'accepted' ||
              source.withdrawal ||
              source.decision?.uuid !== original.preview.decision ||
              source.decision.outcome !== 'accepted' ||
              source.decision.revocation ||
              Date.parse(source.decision.expiresAt ?? '') !== Date.parse(original.preview.eligibilityExpiresAt ?? '') ||
              Date.parse(source.decision.expiresAt ?? '') <= Date.now() ||
              !wallet ||
              wallet.address.toLowerCase() !== original.preview.address.toLowerCase() ||
              wallet.chain !== original.preview.chain ||
              wallet.verificationStatus !== 'VERIFIED' ||
              Date.parse(wallet.verifiedAt ?? '') !== Date.parse(original.preview.proofCompletedAt ?? '')
            )
              throw createUserFriendlyError(
                'The reviewed company eligibility or wallet proof changed. Review the exact nomination again.',
              );
          };
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
      setRetained(original);
      const response = await createWalletNomination(api, original.body, dispatchConfig);
      guard();
      if (!isWalletNominationReceipt(response.data, original.body, original.preview))
        throw createUserFriendlyError(
          'The nomination receipt could not be confirmed. Recover the identical original request.',
        );
      setReceipt({ owner, record: response.data });
      setRetained(null);
      setReviewed(null);
      await nominations.refetch();
      guard();
    } catch (failure) {
      const cause = (failure as { originalError?: unknown }).originalError ?? failure;
      const status = (cause as { response?: { status?: number } }).response?.status;
      if (!dispatched || status === 400 || status === 409) setRetained(null);
      if (mounted.current && boundary.get() === owner)
        setError(
          getErrorMessage(failure, 'The nomination outcome is uncertain. Recover its exact original body and key.'),
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const original = retained?.owner === owner && retained.body.request === options.requestUuid ? retained : null;
  const preview =
    reviewed?.owner === owner && reviewed.body.request === options.requestUuid && reviewed.body.wallet === walletUuid
      ? reviewed.preview
      : null;
  const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const available =
    !!owner && preferences?.status === 'success' && preferences.fetchStatus === 'idle' && !preferences.isInvalidated;
  const receipt =
    receiptState?.owner === owner && receiptState.record.request === options.requestUuid ? receiptState.record : null;
  return {
    owner: available ? owner : null,
    scopeKey,
    request,
    wallets,
    nominations,
    walletUuid,
    preview,
    original,
    receipt,
    busy,
    error,
    guard,
    guardWallet,
    refresh,
    review,
    setWallet: (uuid: string) => {
      if (original || pending.current) return;
      selected.current = { owner, request: options.requestUuid, wallet: uuid };
      setWalletSelection({ owner, uuid });
      setReviewed(null);
      setError(null);
    },
    confirm: () => submit(false),
    recover: () => submit(true),
  };
}

import { useState, useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  requestVerificationChallenge,
  verifyWalletSignature,
  getErrorMessage,
  getWallets,
  getEligibilityRequest,
  readEveryPage,
  isBitcoinChain,
  getChainShortCode,
  useSubmissionOwner,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
} from '@ledova/shared';
import type { Wallet, VerifyWalletResponse, CompanyEligibilityRequest } from '@ledova/shared';
import type { WalletsStackParamList } from '../../navigation/WalletsStackNavigator';
import { apiClient } from '../../services/apiClient';
import { getSeedPhrase } from '../../services/secureKeyStorage';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { signEthereumMessage, signBitcoinMessage } from '../../utils/softwareWallet';

type VerificationStep = 'instructions' | 'show-challenge-qr' | 'scan-signature';

interface UseWalletVerificationProps {
  wallet: Wallet;
  nomination?: WalletsStackParamList['WalletVerification']['nomination'];
}

const walletScope = (wallet: Wallet) =>
  JSON.stringify([
    wallet.uuid,
    wallet.userAccount,
    wallet.address,
    wallet.chain,
    wallet.signingPreference,
    wallet.derivationPath,
    wallet.masterFingerprint,
  ]);

export function useWalletVerification({ wallet, nomination }: UseWalletVerificationProps) {
  const queryClient = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch, getSessionEpoch);
  const mounted = useRef(true);
  const currentScope = useRef(JSON.stringify([walletScope(wallet), nomination?.request, nomination?.company]));
  const capturedScope = JSON.stringify([walletScope(wallet), nomination?.request, nomination?.company]);
  useLayoutEffect(() => {
    currentScope.current = capturedScope;
  }, [capturedScope]);
  const [verificationChallenge, setVerificationChallenge] = useState<string | null>(null);
  const [verificationStep, setVerificationStep] = useState<VerificationStep>('instructions');
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationSuccess, setVerificationSuccess] = useState(false);
  const [isRequestingChallenge, setRequestingChallenge] = useState(false);
  const [isVerifying, setVerifying] = useState(false);
  const pending = useRef(false);
  const challenge = useRef<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      challenge.current = null;
    };
  }, []);

  const guardScope = useCallback(() => {
    assertSessionEpoch(epoch);
    const auth = queryClient.getQueryState(AUTH_QUERY_KEY);
    const preferences = queryClient.getQueryState(USER_PREFERENCES_QUERY_KEY);
    if (
      !mounted.current ||
      auth?.status !== 'success' ||
      auth.fetchStatus !== 'idle' ||
      auth.isInvalidated ||
      preferences?.status !== 'success' ||
      preferences.fetchStatus !== 'idle' ||
      preferences.isInvalidated ||
      !owner ||
      boundary.get() !== owner ||
      wallet.userAccount !== owner.ownerAccountUuid ||
      currentScope.current !== capturedScope
    )
      throw new Error('The account or wallet changed. Reopen wallet verification to continue.');
  }, [boundary, capturedScope, epoch, owner, queryClient, wallet.userAccount]);
  const key = ['wallets', 'verification', epoch, owner?.userUuid, owner?.ownerAccountUuid, capturedScope];
  const ownWallets = useQuery({
    queryKey: key,
    enabled: !!owner && wallet.userAccount === owner.ownerAccountUuid,
    queryFn: ({ signal }) =>
      readEveryPage(async (page) => {
        guardScope();
        const response = await getWallets(
          apiClient,
          { page },
          {
            signal,
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: guardScope,
          },
        );
        guardScope();
        if (response.data.results.some((item) => item.userAccount !== owner?.ownerAccountUuid))
          throw new Error('These wallets do not belong to the current account.');
        return response;
      }),
  });
  const sourceKey = [
    'wallets',
    'verification-eligibility',
    epoch,
    owner?.userUuid,
    owner?.ownerAccountUuid,
    nomination?.request,
    nomination?.company,
  ];
  const source = useQuery({
    queryKey: sourceKey,
    enabled: !!owner && !!nomination,
    queryFn: async ({ signal }) => {
      guardScope();
      const response = await getEligibilityRequest(apiClient, nomination!.request, {
        signal,
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: guardScope,
      });
      guardScope();
      if (
        response.data.uuid !== nomination!.request ||
        response.data.company !== nomination!.company ||
        response.data.userAccount !== owner?.ownerAccountUuid
      )
        throw new Error('This eligibility request does not match the selected company and own account.');
      return response.data;
    },
  });
  const guard = () => {
    guardScope();
    const current = queryClient.getQueryState<Wallet[]>(key);
    const selected = current?.data?.find((item) => item.uuid === wallet.uuid);
    if (
      current?.status !== 'success' ||
      current.fetchStatus !== 'idle' ||
      current.isInvalidated ||
      !selected ||
      walletScope(selected) !== walletScope(wallet)
    )
      throw new Error('Refresh this own wallet before continuing verification.');
    if (nomination) {
      const currentSource = queryClient.getQueryState<CompanyEligibilityRequest>(sourceKey);
      const request = currentSource?.data;
      if (
        currentSource?.status !== 'success' ||
        currentSource.fetchStatus !== 'idle' ||
        currentSource.isInvalidated ||
        request?.uuid !== nomination.request ||
        request.company !== nomination.company ||
        request.userAccount !== owner?.ownerAccountUuid ||
        wallet.chain !== 'base' ||
        !['professional_investor', 'accountant_certificate'].includes(request.category) ||
        request.outcome !== 'accepted' ||
        request.withdrawal ||
        request.decision?.outcome !== 'accepted' ||
        request.decision.revocation ||
        request.decision.requestDigest !== request.digest ||
        JSON.stringify(request) !== JSON.stringify(source.data) ||
        !request.decision.expiresAt ||
        !Number.isFinite(Date.parse(request.decision.expiresAt)) ||
        Date.parse(request.decision.expiresAt) <= Date.now()
      )
        throw new Error(
          'Refresh this selected company’s current GENERAL eligibility before refreshing its wallet proof.',
        );
    }
  };
  const ready =
    ownWallets.isSuccess &&
    !ownWallets.isFetching &&
    ownWallets.data?.some((item) => walletScope(item) === walletScope(wallet)) &&
    (!nomination || (source.isSuccess && !source.isFetching));

  const run = async (work: (check: () => void) => Promise<void>) => {
    if (pending.current) return;
    const captured = generation.current;
    const check = () => {
      guard();
      if (captured !== generation.current) throw new Error('The wallet verification step changed.');
    };
    pending.current = true;
    setVerificationError(null);
    setVerificationSuccess(false);
    try {
      check();
      await work(check);
    } catch (error) {
      try {
        guardScope();
        if (captured === generation.current)
          setVerificationError(getErrorMessage(error, 'Wallet verification could not finish. Refresh and try again.'));
      } catch {}
    } finally {
      if (mounted.current && captured === generation.current) {
        setRequestingChallenge(false);
        setVerifying(false);
        pending.current = false;
      }
    }
  };
  const config = (check: () => void) => ({ ledovaSessionEpoch: epoch, ledovaSubmissionGuard: check });
  const completed = async (check: () => void, result: VerifyWalletResponse) => {
    check();
    if (!result.success || result.verificationStatus !== 'VERIFIED' || !Number.isFinite(Date.parse(result.verifiedAt)))
      throw new Error('The wallet proof completion could not be confirmed. Refresh its authoritative readiness.');
    await queryClient.invalidateQueries({ queryKey: ['wallets'] });
    check();
    setVerificationSuccess(true);
  };
  const requestChallenge = () =>
    void run(async (check) => {
      setRequestingChallenge(true);
      const response = await requestVerificationChallenge(apiClient, wallet.uuid, config(check));
      check();
      if (!response.data.challenge || response.data.walletAddress !== wallet.address)
        throw new Error('The wallet challenge does not match this own address.');
      challenge.current = response.data.challenge;
      setVerificationChallenge(response.data.challenge);
      setVerificationStep('show-challenge-qr');
    });
  const verifySignature = (signature: string) => {
    if (!challenge.current) return;
    const original = challenge.current;
    void run(async (check) => {
      const guarded = () => {
        check();
        if (challenge.current !== original) throw new Error('The wallet challenge changed.');
      };
      guarded();
      setVerifying(true);
      const verified = await verifyWalletSignature(apiClient, wallet.uuid, { signature }, config(guarded));
      guarded();
      await completed(guarded, verified.data);
    });
  };
  const autoVerify = () =>
    void run(async (check) => {
      if (wallet.signingPreference !== 'software' || !wallet.derivationPath || !wallet.masterFingerprint) return;
      setRequestingChallenge(true);
      const response = await requestVerificationChallenge(apiClient, wallet.uuid, config(check));
      check();
      if (!response.data.challenge || response.data.walletAddress !== wallet.address)
        throw new Error('The wallet challenge does not match this own address.');
      const original = response.data.challenge;
      challenge.current = original;
      setVerificationChallenge(original);
      const guarded = () => {
        check();
        if (challenge.current !== original) throw new Error('The wallet challenge changed.');
      };
      guarded();
      const mnemonic = await getSeedPhrase(wallet.masterFingerprint);
      guarded();
      if (!mnemonic) throw new Error('This wallet seed is unavailable. Restore it before continuing.');
      const signature = isBitcoinChain(getChainShortCode(wallet.chain))
        ? await signBitcoinMessage(mnemonic, wallet.derivationPath, original)
        : await signEthereumMessage(mnemonic, wallet.derivationPath, original);
      guarded();
      setVerifying(true);
      const verified = await verifyWalletSignature(apiClient, wallet.uuid, { signature }, config(guarded));
      guarded();
      await completed(guarded, verified.data);
    });
  const reset = useCallback(() => {
    generation.current++;
    challenge.current = null;
    pending.current = false;
    if (!mounted.current) return;
    setVerificationChallenge(null);
    setVerificationStep('instructions');
    setVerificationError(null);
    setVerificationSuccess(false);
    setRequestingChallenge(false);
    setVerifying(false);
  }, []);

  return {
    guard: guardScope,
    ready,
    refresh: () => Promise.all([ownWallets.refetch(), ...(nomination ? [source.refetch()] : [])]),
    verificationChallenge,
    verificationStep,
    isRequestingChallenge,
    isVerifying,
    verificationError: verificationError || getErrorMessage(ownWallets.error) || getErrorMessage(source.error),
    verificationSuccess,
    requestChallenge,
    proceedToScanSignature: () => {
      try {
        guard();
        setVerificationStep('scan-signature');
      } catch (error) {
        setVerificationError(getErrorMessage(error));
      }
    },
    goBackVerificationStep: () => setVerificationStep('show-challenge-qr'),
    verifySignature,
    autoVerify,
    reset,
  };
}

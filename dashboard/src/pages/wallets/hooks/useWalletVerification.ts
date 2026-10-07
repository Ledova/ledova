import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  requestVerificationChallenge,
  verifyWalletSignature,
  BLOCKCHAIN,
  getWalletVerificationEvmChainId,
  getErrorMessage,
  useSubmissionOwner,
  USER_PREFERENCES_QUERY_KEY,
} from '@ledova/shared';
import type { Wallet } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { encodeEthereumMessage, encodeBitcoinMessage } from '@utils/keystone/urEncoder';
import { DEFAULT_EVM_DERIVATION_PATH, deriveAddress, signEthereumMessage } from '@utils/softwareWallet/localSigner';

export type VerificationStep = 'instructions' | 'show-challenge-qr' | 'scan-signature' | 'sign-software' | 'success';
export type VerificationMode = 'hardware' | 'software';

type VerificationContext = {
  wallet: Wallet;
  owner: NonNullable<ReturnType<typeof useSubmissionOwner>['owner']>;
  generation: number;
  guard?: () => void;
};

export function useWalletVerification(wallet?: Wallet | null, externalGuard?: () => void) {
  const queryClient = useQueryClient();
  const { owner, boundary } = useSubmissionOwner();
  const mounted = useRef(true);
  const generation = useRef(0);
  const active = useRef<VerificationContext | null>(null);
  const selectedWallet = useRef(wallet);
  const [shownContext, setShownContext] = useState<VerificationContext | null>(null);
  const [verificationStep, setVerificationStep] = useState<VerificationStep>('instructions');
  const [verificationChallenge, setVerificationChallenge] = useState<string | null>(null);
  const [challengeQrData, setChallengeQrData] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationSuccess, setVerificationSuccess] = useState(false);
  const [isSigningWithSeedPhrase, setIsSigningWithSeedPhrase] = useState(false);
  const reset = useCallback(() => {
    generation.current += 1;
    active.current = null;
    setShownContext(null);
    setVerificationStep('instructions');
    setVerificationChallenge(null);
    setChallengeQrData(null);
    setVerificationError(null);
    setVerificationSuccess(false);
    setIsSigningWithSeedPhrase(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      active.current = null;
    };
  }, []);
  useEffect(() => {
    const changed = () => {
      if (active.current && active.current.owner !== boundary.get()) reset();
    };
    const unsubscribe = boundary.subscribe(changed);
    changed();
    return unsubscribe;
  }, [boundary, reset]);
  useLayoutEffect(() => {
    selectedWallet.current = wallet;
    const context = active.current;
    if (
      context &&
      wallet &&
      (wallet.uuid !== context.wallet.uuid ||
        wallet.userAccount !== context.wallet.userAccount ||
        wallet.address !== context.wallet.address ||
        wallet.chain !== context.wallet.chain)
    ) {
      generation.current += 1;
      active.current = null;
    }
  }, [wallet]);
  const guard = (context: VerificationContext) => {
    const state = queryClient.getQueryState(USER_PREFERENCES_QUERY_KEY);
    const selected = selectedWallet.current;
    if (
      !mounted.current ||
      boundary.get() !== context.owner ||
      active.current !== context ||
      generation.current !== context.generation ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      state.isInvalidated ||
      context.wallet.userAccount !== context.owner.ownerAccountUuid ||
      (selected &&
        (selected.uuid !== context.wallet.uuid ||
          selected.userAccount !== context.wallet.userAccount ||
          selected.address !== context.wallet.address ||
          selected.chain !== context.wallet.chain))
    )
      throw new Error('Your account, wallet or verification session changed. Reopen verification.');
    context.guard?.();
  };
  const current = (context: VerificationContext) =>
    mounted.current && active.current === context && boundary.get() === context.owner;
  const challengeMutation = useMutation({
    mutationFn: async ({ context, mode }: { context: VerificationContext; mode: VerificationMode }) => {
      guard(context);
      const response = await requestVerificationChallenge(apiClient, context.wallet.uuid, {
        ledovaSubmissionGuard: () => guard(context),
      });
      guard(context);
      if (
        !response.data.challenge ||
        response.data.walletAddress?.toLowerCase() !== context.wallet.address.toLowerCase()
      )
        throw new Error('The verification challenge did not identify this wallet. Refresh before signing.');
      return { data: response.data, context, mode };
    },
    onSuccess: ({ data, context, mode }) => {
      guard(context);
      setVerificationChallenge(data.challenge);
      if (mode === 'software') {
        setVerificationStep('sign-software');
        return;
      }
      const source = context.wallet;
      const chainId = getWalletVerificationEvmChainId(source.chain);
      const qrData =
        chainId !== null
          ? encodeEthereumMessage(
              source.address,
              data.challenge,
              source.derivationPath ?? undefined,
              source.masterFingerprint ?? undefined,
              chainId,
            )
          : source.chain === BLOCKCHAIN.BITCOIN
            ? encodeBitcoinMessage(
                source.address,
                data.challenge,
                source.derivationPath ?? undefined,
                source.masterFingerprint ?? undefined,
              )
            : null;
      if (qrData) {
        setChallengeQrData(qrData.urString);
        setVerificationStep('show-challenge-qr');
      } else setVerificationError('Failed to generate QR code. Missing wallet derivation data.');
    },
    onError: (error, { context }) => {
      if (current(context)) setVerificationError(getErrorMessage(error, 'Failed to request verification challenge.'));
    },
  });
  const verifyMutation = useMutation({
    mutationFn: async ({ context, signature }: { context: VerificationContext; signature: string }) => {
      guard(context);
      const response = await verifyWalletSignature(
        apiClient,
        context.wallet.uuid,
        { signature },
        {
          ledovaSubmissionGuard: () => guard(context),
        },
      );
      guard(context);
      if (
        !response.data.success ||
        response.data.verificationStatus !== 'VERIFIED' ||
        !Number.isFinite(Date.parse(response.data.verifiedAt ?? ''))
      )
        throw new Error('The verification result could not be confirmed. Refresh the original wallet proof.');
      return context;
    },
    onSuccess: async (context) => {
      guard(context);
      await queryClient.invalidateQueries({ queryKey: ['wallets'] });
      guard(context);
      setVerificationSuccess(true);
      setVerificationStep('success');
    },
    onError: (error, { context }) => {
      if (current(context)) setVerificationError(getErrorMessage(error, 'Signature verification failed.'));
    },
  });
  const startVerification = async (source: Wallet, mode: VerificationMode = 'hardware') => {
    reset();
    if (!owner) return;
    const context = { wallet: { ...source }, owner, generation: generation.current, guard: externalGuard };
    active.current = context;
    setShownContext(context);
    try {
      guard(context);
      if (mode === 'hardware' && (!source.derivationPath || !source.masterFingerprint)) {
        setVerificationError('This wallet cannot be verified with a hardware wallet. Missing hardware wallet data.');
        return;
      }
      await challengeMutation.mutateAsync({ context, mode });
    } catch (error) {
      if (current(context)) setVerificationError(getErrorMessage(error, 'Wallet verification could not start.'));
    }
  };
  const handleSignatureScanned = async (signature: string) => {
    const context = active.current;
    if (!context || !verificationChallenge) return;
    try {
      guard(context);
      await verifyMutation.mutateAsync({ context, signature });
    } catch (error) {
      if (current(context)) setVerificationError(getErrorMessage(error, 'Signature verification failed.'));
    }
  };
  const signWithSeedPhrase = async (seedPhrase: string) => {
    const context = active.current;
    if (!context || !verificationChallenge) return;
    const challenge = verificationChallenge;
    const path = context.wallet.derivationPath || DEFAULT_EVM_DERIVATION_PATH;
    try {
      guard(context);
      setVerificationError(null);
      setIsSigningWithSeedPhrase(true);
      const derived = deriveAddress(seedPhrase.trim(), path);
      if (derived.toLowerCase() !== context.wallet.address.toLowerCase()) {
        setVerificationError(`Seed phrase does not match this wallet address at ${path}.`);
        return;
      }
      const signature = await signEthereumMessage(seedPhrase.trim(), path, challenge);
      guard(context);
      await verifyMutation.mutateAsync({ context, signature });
    } catch (error) {
      if (current(context))
        setVerificationError(getErrorMessage(error, 'Could not sign with that seed phrase. Check the phrase.'));
    } finally {
      if (current(context)) setIsSigningWithSeedPhrase(false);
    }
  };
  const preferences = queryClient.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const available =
    !!owner &&
    preferences?.status === 'success' &&
    preferences.fetchStatus === 'idle' &&
    !preferences.isInvalidated &&
    (!wallet || wallet.userAccount === owner.ownerAccountUuid);
  const visible =
    shownContext?.owner === owner &&
    (!wallet ||
      (wallet.uuid === shownContext.wallet.uuid &&
        wallet.userAccount === shownContext.wallet.userAccount &&
        wallet.address === shownContext.wallet.address &&
        wallet.chain === shownContext.wallet.chain));
  return {
    owner,
    available,
    verificationStep: visible ? verificationStep : 'instructions',
    verificationChallenge: visible ? verificationChallenge : null,
    challengeQrData: visible ? challengeQrData : null,
    verificationError: !shownContext || visible ? verificationError : null,
    verificationSuccess: visible && verificationSuccess,
    isRequestingChallenge: challengeMutation.isPending,
    isVerifying: verifyMutation.isPending,
    isSigningWithSeedPhrase,
    startVerification,
    proceedToScanSignature: () => {
      if (active.current) guard(active.current);
      setVerificationStep('scan-signature');
      setVerificationError(null);
    },
    handleSignatureScanned,
    signWithSeedPhrase,
    goBack: () => {
      if (verificationStep === 'scan-signature') setVerificationStep('show-challenge-qr');
      else setVerificationStep('instructions');
      setVerificationError(null);
    },
    reset,
  };
}

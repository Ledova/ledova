import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useContext,
  useSyncExternalStore,
  useCallback,
} from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, AppState, type AppStateStatus } from 'react-native';
import {
  CurrencyCircleDollarIcon,
  CurrencyEthIcon,
  CurrencyBtcIcon,
  WarningCircleIcon,
  ArrowRightIcon,
} from 'phosphor-react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  BUYABLE_ASSETS,
  CACHE_TIMING,
  getWallets,
  getOnRampWidgetUrl,
  getUserProfiles,
  getUserVerificationStatus,
  readEveryPage,
} from '@ledova/shared';
import type { BuyableAssetConfig, Wallet } from '@ledova/shared';
import { Action, Rows } from '../../../components/Ledger';
import { WalletChoice } from '../../../components/wallet-list';
import { CustomModal, useDialogStyles } from '../../../components/modal';
import { apiClient } from '../../../services/apiClient';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { assertSessionEpoch, getSessionEpoch } from '../../../services/sessionScope';
import { createProviderLifetime } from '../../../hooks/useProviderViewLifecycle';
import { CameraAccessContext } from '../../../contexts/cameraAccess';

function getAssetIcon(symbol: string, theme: ReturnType<typeof useAppTheme>): React.ReactNode {
  switch (symbol) {
    case 'BTC':
      return (
        <CurrencyBtcIcon
          size={theme.icon.sizes.md}
          color={theme.icon.colors.primary}
          weight={theme.icon.weights.regular}
        />
      );
    case 'ETH':
      return (
        <CurrencyEthIcon
          size={theme.icon.sizes.md}
          color={theme.icon.colors.primary}
          weight={theme.icon.weights.regular}
        />
      );
    case 'USDC':
    case 'USDT':
      return (
        <CurrencyCircleDollarIcon
          size={theme.icon.sizes.md}
          color={theme.icon.colors.primary}
          weight={theme.icon.weights.regular}
        />
      );
    default:
      return (
        <CurrencyCircleDollarIcon
          size={theme.icon.sizes.md}
          color={theme.icon.colors.primary}
          weight={theme.icon.weights.regular}
        />
      );
  }
}

interface BuyCryptoModalProps {
  visible: boolean;
  onClose: () => void;
  onNavigateToWebView: (url: string, sessionEpoch: number) => void;
  onNavigateToProfile: () => void;
  userAccountUuid?: string;
  initialAsset?: string;
}

export function BuyCryptoModal({
  visible,
  onClose,
  onNavigateToWebView,
  onNavigateToProfile,
  userAccountUuid,
  initialAsset,
}: BuyCryptoModalProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    warningLine: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
    },
    warningText: {
      flex: 1,
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.xs,
      lineHeight: 18,
      color: theme.colors.status.warning.text,
    },
    optionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.smd,
    },
    optionLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.smd,
      flex: 1,
    },
    optionItemDisabled: {
      opacity: 0.5,
    },
    optionLabel: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
    },
    optionLabelDisabled: {
      color: theme.colors.text.muted,
    },
    failure: {
      gap: theme.spacing.smd,
    },
  }));
  const [selectedAsset, setSelectedAsset] = useState<BuyableAssetConfig | null>(null);
  const [showWalletStep, setShowWalletStep] = useState(false);
  const access = useContext(CameraAccessContext);
  const admission = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot);
  const [appState, setAppState] = useState(() => ({ status: AppState.currentState }));
  const requestScope = useMemo(
    () => ({ visible, userAccountUuid, selectedAsset, admission, appState, lifetime: createProviderLifetime() }),
    [visible, userAccountUuid, selectedAsset, admission, appState],
  );
  const isRequestActive = useCallback(
    (scope: typeof requestScope) =>
      scope.visible &&
      scope.lifetime.isActive() &&
      scope.admission.allowed &&
      access.getSnapshot() === scope.admission &&
      scope.appState.status === 'active' &&
      AppState.currentState === 'active',
    [access],
  );

  const userProfileQuery = useQuery({
    queryKey: ['userProfiles'],
    queryFn: () => getUserProfiles(apiClient),
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const isProfileLoading = userProfileQuery.isLoading;
  const userProfile = userProfileQuery.data?.data?.results?.[0] || null;
  const verificationStatus = getUserVerificationStatus(userProfile);
  const isVerified = verificationStatus.type === 'verified';

  useEffect(() => {
    if (visible && initialAsset && !selectedAsset) {
      const asset = BUYABLE_ASSETS.find((a) => a.symbol === initialAsset);
      if (asset) {
        setSelectedAsset(asset);
      }
    }
  }, [visible, initialAsset, selectedAsset]);

  const walletsQuery = useQuery({
    queryKey: [
      'wallets',
      { chain: selectedAsset?.chain, verification_status: 'VERIFIED', ordering: 'signing_preference' },
    ],
    queryFn: () =>
      readEveryPage((page) =>
        getWallets(apiClient, {
          chain: selectedAsset!.chain,
          verification_status: 'VERIFIED',
          ordering: 'signing_preference',
          page,
        }),
      ),
    enabled: visible && !!selectedAsset,
  });

  const walletsFailed = walletsQuery.isError;
  const matchingWallets = walletsFailed ? [] : (walletsQuery.data ?? []);
  const isLoadingWallets = walletsQuery.isPending;
  const walletsSettled = walletsQuery.fetchStatus === 'idle';

  const widgetMutation = useMutation({
    mutationFn: async (wallet: Wallet) => {
      if (!isRequestActive(requestScope)) throw new Error('The purchase request is no longer active.');
      const sessionEpoch = getSessionEpoch();
      const response = await getOnRampWidgetUrl(apiClient, {
        walletUuid: wallet.uuid,
        cryptoCurrencyCode: selectedAsset!.symbol,
      });
      assertSessionEpoch(sessionEpoch);
      return { response, sessionEpoch, scope: requestScope };
    },
    onSuccess: ({ response, sessionEpoch, scope }) => {
      if (!isRequestActive(scope) || scope !== requestScope || sessionEpoch !== getSessionEpoch()) return;
      resetAndClose();
      onNavigateToWebView(response.data.url, sessionEpoch);
    },
  });

  const resetWidget = widgetMutation.reset;
  useLayoutEffect(() => {
    requestScope.lifetime.mount();
    resetWidget();
    const onAppState = (status: AppStateStatus) => {
      if (status !== 'active') requestScope.lifetime.retire();
      setAppState((current) => (current.status === status ? current : { status }));
    };
    const subscription = AppState.addEventListener('change', onAppState);
    if (AppState.currentState !== requestScope.appState.status) onAppState(AppState.currentState);
    return () => {
      subscription.remove();
      requestScope.lifetime.unmount();
    };
  }, [requestScope, visible, resetWidget]);

  useEffect(() => {
    if (!isRequestActive(requestScope) || !selectedAsset || isLoadingWallets) return;

    if (matchingWallets.length !== 1) {
      setShowWalletStep(true);
    } else if (walletsSettled && widgetMutation.isIdle) {
      widgetMutation.mutate(matchingWallets[0]);
    }
  }, [requestScope, isRequestActive, selectedAsset, isLoadingWallets, walletsSettled, matchingWallets, widgetMutation]);

  const resetAndClose = () => {
    requestScope.lifetime.retire();
    setSelectedAsset(null);
    setShowWalletStep(false);
    widgetMutation.reset();
  };

  const handleClose = () => {
    resetAndClose();
    onClose();
  };

  const handleSelectAsset = (asset: BuyableAssetConfig) => {
    setSelectedAsset(asset);
  };

  const handleBack = () => {
    if (initialAsset) {
      handleClose();
    } else {
      resetAndClose();
    }
  };

  const handleSelectWallet = (wallet: Wallet) => {
    widgetMutation.mutate(wallet);
  };

  const isOnAssetStep = !showWalletStep;
  const isProcessingAsset = !!selectedAsset && isOnAssetStep;
  const isLoading = widgetMutation.isPending;

  return (
    <CustomModal
      visible={visible}
      title="Buy crypto"
      onClose={handleClose}
      showFooter={true}
      showCancelButton={true}
      cancelLabel={isOnAssetStep ? 'Cancel' : 'Back'}
      onCancel={isOnAssetStep ? handleClose : handleBack}
    >
      {isOnAssetStep && (
        <>
          <Text style={text.muted}>Select an asset to purchase</Text>

          {!isProfileLoading && !isVerified && (
            <TouchableOpacity
              style={styles.warningLine}
              onPress={() => {
                handleClose();
                onNavigateToProfile();
              }}
              activeOpacity={0.7}
            >
              <WarningCircleIcon size={theme.icon.sizes.sm} color={theme.colors.status.warning.icon} weight="fill" />
              <Text style={styles.warningText}>
                You must verify your identity before purchasing assets. Tap here to complete verification.
              </Text>
              <ArrowRightIcon size={theme.icon.sizes.sm} color={theme.colors.status.warning.icon} />
            </TouchableOpacity>
          )}

          <Rows>
            {BUYABLE_ASSETS.map((asset) => {
              const isAssetProcessing = isProcessingAsset && selectedAsset?.symbol === asset.symbol;
              const isDisabled = isProfileLoading || !isVerified || isProcessingAsset;

              return (
                <TouchableOpacity
                  key={asset.symbol}
                  style={[styles.optionItem, !isVerified && styles.optionItemDisabled]}
                  onPress={() => handleSelectAsset(asset)}
                  activeOpacity={isDisabled ? 1 : 0.7}
                  disabled={isDisabled}
                >
                  <View style={styles.optionLeft}>
                    {getAssetIcon(asset.symbol, theme)}
                    <Text style={[styles.optionLabel, !isVerified && styles.optionLabelDisabled]}>{asset.name}</Text>
                  </View>
                  {isAssetProcessing && <ActivityIndicator size="small" color={theme.colors.interactive.active} />}
                </TouchableOpacity>
              );
            })}
          </Rows>
        </>
      )}

      {!isOnAssetStep && walletsFailed && (
        <View style={styles.failure}>
          <Text accessibilityRole="alert" style={text.muted}>
            Your wallets could not be loaded. Try again before continuing.
          </Text>
          <Action label="Try again" onPress={() => void walletsQuery.refetch()} disabled={walletsQuery.isFetching} />
        </View>
      )}

      {!isOnAssetStep && !walletsFailed && matchingWallets.length === 0 && (
        <Text style={text.muted}>No verified wallets for {selectedAsset!.name}. Create one in Wallets.</Text>
      )}

      {!isOnAssetStep && matchingWallets.length > 0 && (
        <>
          <Text style={text.muted}>Choose a wallet to receive {selectedAsset!.name}</Text>

          <Rows>
            {matchingWallets.map((wallet: Wallet) => (
              <WalletChoice
                key={wallet.uuid}
                wallet={wallet}
                onChoose={() => handleSelectWallet(wallet)}
                disabled={isLoading || !walletsSettled}
                busy={isLoading && widgetMutation.variables?.uuid === wallet.uuid}
              />
            ))}
          </Rows>
        </>
      )}

      {widgetMutation.isError && (
        <Text style={text.error}>
          {widgetMutation.error instanceof Error ? widgetMutation.error.message : 'Something went wrong'}
        </Text>
      )}
    </CustomModal>
  );
}

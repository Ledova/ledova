import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { WarningCircleIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { useIdentityVerification } from '../../../hooks/useIdentityVerification';
import { useIsFocused } from '@react-navigation/native';
import { CustomModal, useDialogStyles } from '../../../components/modal';
import { StatusBanners } from '../../signup/identity-verification/components/StatusBanners';
import { VerificationFormModal } from '../../signup/identity-verification/components/VerificationFormModal';

interface VerificationModalProps {
  visible: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export function VerificationModal({ visible, onClose, onRefresh }: VerificationModalProps) {
  const isFocused = useIsFocused();
  const active = visible && isFocused;
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    loading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    needs: {
      gap: theme.spacing.xs,
    },
  }));
  const {
    status,
    isLoadingStatus,
    launchVerification,
    isLaunching,
    sdkError,
    isPending,
    isOnHold,
    isRejected,
    needsRetry,
    hasSubmitted,
    justSubmitted,
    isVerified,
    resetState,
    accessToken,
    formUrl,
    formSessionEpoch,
    showVerificationForm,
    handleFormComplete,
    closeFormModal,
  } = useIdentityVerification(active);

  useEffect(() => {
    if (active) {
      resetState();
    }
  }, [active, resetState]);

  useEffect(() => {
    if (justSubmitted && active) {
      const timer = setTimeout(() => {
        onClose();
        onRefresh();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [justSubmitted, active, onClose, onRefresh]);

  const handleStartVerification = async () => {
    try {
      await launchVerification();
    } catch {}
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const showStatusBanner = justSubmitted || hasSubmitted || isPending || isOnHold || isRejected || isVerified;
  const showInitialPhase = !showStatusBanner && !isLoadingStatus;

  const showPendingBanner = (justSubmitted || (isPending && !isVerified)) && !isRejected;
  const showOnHoldBanner = isOnHold && !justSubmitted;
  const showRejectedBanner = isRejected && !justSubmitted && !needsRetry;
  const showRetryBanner = needsRetry && !isVerified && !justSubmitted;

  return (
    <>
      <CustomModal
        visible={active && !showVerificationForm}
        title="Identity Verification"
        onClose={handleClose}
        showFooter={!isLaunching}
        cancelLabel={showInitialPhase ? 'Skip' : 'Close'}
        confirmLabel={showRetryBanner ? 'Retry Verification' : 'Start'}
        onConfirm={showInitialPhase || showRetryBanner ? handleStartVerification : undefined}
        confirmLoading={isLaunching}
        confirmDisabled={isLaunching}
      >
        <Text style={text.muted}>
          We need to verify your identity to comply with financial regulations and protect your account.
        </Text>

        {(isLaunching || isLoadingStatus) && (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={theme.colors.interactive.active} />
            <Text style={text.muted}>{isLaunching ? 'Preparing verification...' : 'Loading status...'}</Text>
          </View>
        )}

        {sdkError && (
          <View style={text.line}>
            <WarningCircleIcon size={theme.icon.sizes.md} color={theme.colors.status.error.icon} weight="regular" />
            <Text style={[text.error, text.lineText]}>{sdkError}</Text>
          </View>
        )}

        <StatusBanners
          plain
          isVerified={isVerified}
          showPendingBanner={showPendingBanner}
          showOnHoldBanner={showOnHoldBanner}
          showRejectedBanner={showRejectedBanner}
          showRetryBanner={showRetryBanner}
          rejectionLabels={status?.rejectionLabels}
        />

        {showInitialPhase && !isLaunching && (
          <View style={styles.needs}>
            <Text accessibilityRole="header" style={text.heading}>
              What You&apos;ll Need:
            </Text>
            <Text style={text.text}>{'\u2022'} A valid government-issued ID</Text>
            <Text style={text.text}>{'\u2022'} Good lighting for clear photos</Text>
            <Text style={text.text}>{'\u2022'} About 3-5 minutes</Text>
          </View>
        )}
      </CustomModal>

      <VerificationFormModal
        visible={active && showVerificationForm}
        accessToken={accessToken}
        formUrl={formUrl}
        sessionEpoch={formSessionEpoch}
        onComplete={handleFormComplete}
        onClose={closeFormModal}
      />
    </>
  );
}

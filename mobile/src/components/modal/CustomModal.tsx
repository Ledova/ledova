import { useContext, type ReactElement, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
} from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import { overlayColors, useThemedStyles } from '../../contexts';
import { Action, useCardStyles } from '../Ledger';

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

export function useDialogInsets() {
  return useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets ?? NO_INSETS;
}

export function useDialogStyles() {
  return useThemedStyles((theme) => ({
    text: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.sm,
      lineHeight: 21,
      color: theme.colors.text.primary,
    },
    muted: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.sm,
      lineHeight: 21,
      color: theme.colors.text.muted,
    },
    heading: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.sm,
      lineHeight: 21,
      color: theme.colors.text.primary,
    },
    error: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.sm,
      lineHeight: 21,
      color: theme.colors.status.error.text,
    },
    group: { gap: theme.spacing.xs },
    line: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: theme.spacing.sm },
    lineText: { flex: 1 },
    field: {
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface.raised,
      paddingHorizontal: theme.spacing.smd,
      paddingVertical: theme.spacing.smd,
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.base,
      color: theme.colors.text.primary,
    },
  }));
}

export function ModalActions({ children }: { children: ReactNode }) {
  const styles = useThemedStyles((theme) => ({
    row: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      justifyContent: 'flex-end' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.sm,
    },
  }));
  return <View style={styles.row}>{children}</View>;
}

interface CustomModalProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
  dismissLabel?: string;
  refreshControl?: ReactElement<RefreshControlProps>;
  showFooter?: boolean;
  showCancelButton?: boolean;
  cancelLabel?: string;
  onCancel?: () => void;
  actions?: ReactNode;
  confirmLabel?: string;
  onConfirm?: () => void;
  confirmDisabled?: boolean;
  confirmLoading?: boolean;
}

export function CustomModal({
  visible,
  title,
  onClose,
  children,
  busy = false,
  dismissLabel = 'Close dialog',
  refreshControl,
  showFooter = false,
  showCancelButton = true,
  cancelLabel = 'Cancel',
  onCancel,
  actions,
  confirmLabel = 'Confirm',
  onConfirm,
  confirmDisabled = false,
  confirmLoading = false,
}: CustomModalProps) {
  const insets = useDialogInsets();
  const card = useCardStyles();
  const styles = useThemedStyles((theme) => ({
    overlay: { flex: 1, backgroundColor: overlayColors.modal },
    keyboard: { flex: 1 },
    position: {
      flex: 1,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      paddingTop: insets.top + theme.spacing.md,
      paddingRight: insets.right + theme.spacing.md,
      paddingBottom: insets.bottom + theme.spacing.md,
      paddingLeft: insets.left + theme.spacing.md,
    },
    card: {
      width: '100%' as const,
      maxWidth: 520,
      maxHeight: '100%' as const,
      gap: theme.spacing.md,
      shadowColor: theme.colors.utility.black,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 16,
      elevation: 8,
    },
    body: { flexGrow: 0, flexShrink: 1 },
    content: { gap: theme.spacing.md },
  }));
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal testID={`modal-${title}`} visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable
          testID={`modal-backdrop-${title}`}
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
          style={StyleSheet.absoluteFill}
          disabled={busy}
          onPress={close}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
          pointerEvents="box-none"
        >
          <View style={styles.position} pointerEvents="box-none">
            <View accessibilityViewIsModal style={[card.card, styles.card]}>
              <Text accessibilityRole="header" style={card.title}>
                {title}
              </Text>
              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                refreshControl={refreshControl}
              >
                {children}
              </ScrollView>
              {(showFooter || actions !== undefined) && (
                <ModalActions>
                  {showCancelButton && (
                    <Action label={cancelLabel} disabled={busy || confirmLoading} onPress={onCancel ?? close} />
                  )}
                  {actions}
                  {onConfirm && (
                    <Action
                      label={confirmLoading ? 'Loading...' : confirmLabel}
                      primary
                      disabled={confirmDisabled || confirmLoading}
                      onPress={onConfirm}
                    />
                  )}
                </ModalActions>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

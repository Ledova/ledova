import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { useThemedStyles } from '../../contexts';
import { CustomModal, useDialogStyles } from '../modal';
import { useCameraScanner } from './useCameraScanner';
import { ScannerPreview } from './ScannerPreview';

interface QRScannerProps {
  visible: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
  title?: string;
  subtitle?: string;
}

export function QRScanner({ visible, onClose, onScan, title = 'Scan QR Code', subtitle }: QRScannerProps) {
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    cameraContainer: {
      width: '100%',
      height: 320,
      borderRadius: theme.borderRadius.lg,
      overflow: 'hidden',
      backgroundColor: theme.colors.utility.black,
      position: 'relative',
    },
    messageContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.xl,
    },
    message: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
      textAlign: 'center',
    },
    cameraOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scanArea: {
      width: 260,
      height: 260,
      borderWidth: 2,
      borderColor: theme.colors.interactive.active,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.utility.transparent,
    },
  }));
  const camera = useCameraScanner(visible, (data, finishScan) => {
    finishScan();
    onScan(data);
  });

  const handleClose = () => {
    camera.stop();
    onClose();
  };

  if (!visible) return null;

  return (
    <CustomModal visible={visible} title={title} onClose={handleClose} showFooter={true} cancelLabel="Cancel">
      {subtitle && <Text style={text.muted}>{subtitle}</Text>}

      <View style={styles.cameraContainer}>
        <ScannerPreview {...camera.preview} />
        {camera.message ? (
          <View style={styles.messageContainer}>
            <Text style={styles.message}>{camera.message}</Text>
          </View>
        ) : (
          <>
            <View style={styles.cameraOverlay}>
              <View style={styles.scanArea} />
            </View>
          </>
        )}
      </View>

      {camera.status === 'ready' && <Text style={text.muted}>Position the QR code within the frame</Text>}
    </CustomModal>
  );
}

import React, { useEffect } from 'react';
import { AccessibilityInfo, Platform, Text } from 'react-native';
import { useDialogStyles } from '../../../components/modal';

export function RefusalNotice({ message }: { message: string }) {
  const text = useDialogStyles();
  useEffect(() => {
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={text.error}>
      {message}
    </Text>
  );
}

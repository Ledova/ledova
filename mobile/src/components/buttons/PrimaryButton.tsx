import React from 'react';
import { Pressable, Text, ActivityIndicator, View, ViewStyle, TextStyle } from 'react-native';
import { useAppTheme, useThemedStyles } from '../../contexts';

interface PrimaryButtonProps {
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
  children: React.ReactNode;
  accessibilityLabel?: string;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function PrimaryButton({
  disabled = false,
  loading = false,
  onPress,
  children,
  accessibilityLabel,
  fullWidth = false,
  style: customStyle,
}: PrimaryButtonProps) {
  const theme = useAppTheme();
  const styles = useThemedStyles(() => ({
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
  }));

  const isDisabled = disabled || loading;
  const handlePress = () => {
    if (!isDisabled) {
      onPress();
    }
  };

  const buttonStyle: ViewStyle = {
    ...styles.button,
    height: 48,
    paddingHorizontal: 24,
    backgroundColor: isDisabled ? theme.colors.interactive.disabled : theme.colors.brand.default,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: 'transparent',
    ...(fullWidth && { width: '100%' }),
    ...customStyle,
  };

  const textStyle: TextStyle = {
    textAlign: 'center',
    fontSize: 16,
    fontFamily: theme.fontFamily.semibold,
    color: isDisabled ? theme.colors.text.subtle : theme.colors.utility.white,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof children === 'string' ? children : undefined)}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={handlePress}
      onAccessibilityTap={handlePress}
      disabled={isDisabled}
      style={({ pressed }) => [buttonStyle, { opacity: pressed ? 0.7 : (buttonStyle.opacity ?? 1) }]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={theme.colors.utility.white} />
      ) : (
        <View style={styles.content}>
          <Text style={textStyle}>{children}</Text>
        </View>
      )}
    </Pressable>
  );
}

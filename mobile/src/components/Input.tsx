import { forwardRef, type ReactNode } from 'react';
import {
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { EyeIcon, EyeSlashIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../contexts';

export function useControlFrame() {
  return useThemedStyles((theme) => ({
    frame: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.sm,
      minHeight: 48,
      paddingHorizontal: theme.spacing.smd,
      borderWidth: 1,
      borderRadius: theme.borderRadius.md,
      borderColor: theme.colors.border.default,
      backgroundColor: theme.colors.surface.raised,
    },
    filled: { paddingHorizontal: theme.spacing.md, backgroundColor: theme.colors.surface.tertiary },
    invalid: { borderColor: theme.colors.status.error.text, backgroundColor: theme.colors.error.subtle },
    text: { fontFamily: theme.fontFamily.regular, fontSize: theme.fontSize.base, color: theme.colors.text.primary },
    placeholder: { color: theme.colors.form.placeholder },
  }));
}

export type InputRef = TextInput;

export type InputProps = Omit<TextInputProps, 'style'> & {
  filled?: boolean;
  invalid?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  rows?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

const LINE = 22;

export const Input = forwardRef<InputRef, InputProps>(function Input(
  {
    filled = false,
    invalid = false,
    leading,
    trailing,
    rows = 2,
    style,
    textStyle,
    multiline,
    editable = true,
    accessibilityState,
    placeholderTextColor,
    ...props
  },
  ref,
) {
  const theme = useAppTheme();
  const frame = useControlFrame();
  const own = useThemedStyles((theme) => ({
    text: { flex: 1, alignSelf: 'stretch' as const, paddingHorizontal: 0, paddingVertical: theme.spacing.smd },
    lines: { minHeight: rows * LINE + 2 * theme.spacing.smd, textAlignVertical: 'top' as const },
    top: { alignItems: 'flex-start' as const },
    slot: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.sm },
    slotTop: { paddingTop: theme.spacing.smd },
  }));
  const slot = (content: ReactNode) => content && <View style={[own.slot, multiline && own.slotTop]}>{content}</View>;
  return (
    <View
      style={[frame.frame, filled && frame.filled, filled && invalid && frame.invalid, multiline && own.top, style]}
    >
      {slot(leading)}
      <TextInput
        ref={ref}
        {...props}
        multiline={multiline}
        editable={editable}
        accessibilityState={{ ...accessibilityState, disabled: !editable }}
        placeholderTextColor={placeholderTextColor ?? theme.colors.form.placeholder}
        style={[frame.text, own.text, multiline && own.lines, textStyle]}
      />
      {slot(trailing)}
    </View>
  );
});

export function PasswordToggle({
  shown,
  disabled,
  onPress,
}: {
  shown: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  const Icon = shown ? EyeSlashIcon : EyeIcon;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={shown ? 'Hide password' : 'Show password'}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
    >
      <Icon size={theme.icon.sizes.md} color={theme.colors.text.subtle} weight={theme.icon.weights.regular} />
    </TouchableOpacity>
  );
}

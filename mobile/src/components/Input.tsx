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

/**
 * The frame every form control shares: text inputs, selects and the date field. The default is the
 * in-app look and `filled` the sign-in and sign-up card look, as on the web (`FIELD_BASE` and
 * `AUTH_INPUT_CLASS`). The frame has a minimum height, never a fixed one. iOS confines the text being
 * edited to the input's own box, so a fixed height with vertical padding cuts off letters that hang
 * below the line, such as "g", while the keyboard is up.
 */
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
  /** The sign-in and sign-up card look. */
  filled?: boolean;
  /** Shows the error frame on the filled look; the in-app look shows errors as text, as on the web. */
  invalid?: boolean;
  /** Icon or control before the text, such as the phone number's country picker. */
  leading?: ReactNode;
  /** Control after the text, such as the show-password button. */
  trailing?: ReactNode;
  /** Visible lines when `multiline`. */
  rows?: number;
  /** The frame's place in its parent, such as `flex` or a margin. */
  style?: StyleProp<ViewStyle>;
  /** Text overrides, such as the verification code's size. Never a height. */
  textStyle?: StyleProp<TextStyle>;
};

const LINE = 22;

/** The app's one text input. `Field` adds a label, a hint and an error around it. */
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

/** The show-password button for an `Input`'s `trailing` slot. */
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

import { Children, Fragment, isValidElement, type ReactElement, type ReactNode, type Ref } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { CaretDownIcon, CaretRightIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../contexts';

const CARET_SIZE = 16;

export function useCardStyles() {
  return useThemedStyles((theme) => ({
    card: {
      gap: theme.spacing.smd,
      padding: theme.spacing.md,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.surface.raised,
    },
    title: { fontFamily: theme.fontFamily.display, fontSize: 25, color: theme.colors.text.primary },
  }));
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = useCardStyles();
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function items(children: ReactNode, prefix = ''): { key: string; node: ReactElement }[] {
  return Children.toArray(children).flatMap((child, index) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    const key = `${prefix}${child.key ?? index}`;
    return child.type === Fragment ? items(child.props.children, `${key}/`) : [{ key, node: child }];
  });
}

export function Rows({ children }: { children: ReactNode }) {
  const styles = useThemedStyles((theme) => ({
    rule: { height: 1, backgroundColor: theme.colors.border.subtle },
  }));
  return (
    <View>
      {items(children).map(({ key, node }, index) => (
        <Fragment key={key}>
          {index > 0 && <View style={styles.rule} />}
          {node}
        </Fragment>
      ))}
    </View>
  );
}

export function Row({ label, mono = false, children }: { label: string; mono?: boolean; children: ReactNode }) {
  const styles = useThemedStyles((theme) => ({
    row: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: theme.spacing.sm,
      paddingVertical: 10,
    },
    label: { flexShrink: 1, fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.muted },
    value: {
      flexGrow: 1,
      flexShrink: 1,
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      color: theme.colors.text.primary,
      textAlign: 'right' as const,
    },
    mono: { fontFamily: theme.fontFamily.mono },
  }));
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, mono && styles.mono]}>{children}</Text>
    </View>
  );
}

export function LinkRow({
  label,
  onPress,
  accessibilityLabel,
  children,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  children?: ReactNode;
}) {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.smd,
      paddingVertical: theme.spacing.smd,
    },
    text: { flex: 1, gap: theme.spacing.xs },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
  }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={styles.row}
    >
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {children}
      </View>
      <CaretRightIcon size={CARET_SIZE} color={theme.colors.text.muted} />
    </Pressable>
  );
}

export function Disclosure({
  ref,
  summary,
  open,
  onToggle,
  accessibilityLabel,
  children,
}: {
  ref?: Ref<View>;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  accessibilityLabel?: string;
  children: ReactNode;
}) {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    toggle: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: theme.spacing.smd,
      paddingVertical: theme.spacing.md,
    },
    caret: { height: 21, justifyContent: 'center' as const },
    summary: { flex: 1 },
    detail: { paddingLeft: CARET_SIZE + theme.spacing.smd, paddingBottom: theme.spacing.md },
  }));
  const Caret = open ? CaretDownIcon : CaretRightIcon;
  return (
    <View>
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={styles.toggle}
      >
        <View style={styles.caret}>
          <Caret size={CARET_SIZE} color={theme.colors.text.muted} />
        </View>
        <View style={styles.summary}>{summary}</View>
      </Pressable>
      <View accessibilityLiveRegion="polite" style={open ? styles.detail : undefined}>
        {open && children}
      </View>
    </View>
  );
}

export function SwitchRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const styles = useThemedStyles((theme) => ({
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 16 },
    text: { flex: 1, gap: 5 },
    label: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.body },
    description: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 22, color: theme.colors.text.muted },
  }));
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {!!description && <Text style={styles.description}>{description}</Text>}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={description}
        value={checked}
        disabled={disabled}
        onValueChange={onChange}
      />
    </View>
  );
}

export function Action({
  label,
  onPress,
  disabled = false,
  primary = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  accessibilityLabel?: string;
}) {
  const styles = useThemedStyles((theme) => ({
    button: {
      alignSelf: 'flex-start' as const,
      borderWidth: 1,
      borderColor: primary ? theme.colors.brand.default : theme.colors.border.default,
      borderRadius: 6,
      paddingHorizontal: 14,
      paddingVertical: 11,
      backgroundColor: primary ? theme.colors.brand.default : theme.colors.surface.transparent,
      opacity: disabled ? 0.5 : 1,
    },
    label: {
      fontFamily: theme.fontFamily.medium,
      fontSize: 14,
      color: primary ? '#ffffff' : theme.colors.text.primary,
    },
  }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

export function Choice({
  label,
  selected,
  onPress,
  disabled = false,
  accessibilityRole = 'button',
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  accessibilityRole?: 'button' | 'radio';
  accessibilityLabel?: string;
}) {
  const styles = useThemedStyles((theme) => ({
    choice: {
      alignSelf: 'flex-start' as const,
      borderWidth: 1,
      borderColor: selected ? theme.colors.interactive.defaultSubtle : theme.colors.border.default,
      borderRadius: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      opacity: disabled ? 0.5 : 1,
    },
    label: {
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      color: selected ? theme.colors.interactive.active : theme.colors.text.primary,
    },
  }));
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={
        accessibilityRole === 'radio' ? { checked: selected, selected, disabled } : { selected, disabled }
      }
      disabled={disabled}
      onPress={onPress}
      style={styles.choice}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

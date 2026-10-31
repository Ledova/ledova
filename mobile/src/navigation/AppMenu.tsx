import { useEffect, useState, type ComponentType } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  FilesIcon,
  GearIcon,
  HouseIcon,
  ListIcon,
  MoonIcon,
  SignOutIcon,
  SunIcon,
  XIcon,
  type IconProps,
} from 'phosphor-react-native';
import { useAppTheme, useThemeChoice } from '../contexts';
import { SignOutModal } from '../components/auth/SignOutModal';
import { LogoMark } from '../components/LogoMark';
import { useSignOut } from '../hooks/useSignOut';
import { useUserProfile } from '../hooks/useUserProfile';

export type Section = 'Dashboard' | 'Documents' | 'Settings';

const SECTIONS: { name: Section; label: string; icon: ComponentType<IconProps> }[] = [
  { name: 'Dashboard', label: 'Dashboard', icon: HouseIcon },
  { name: 'Documents', label: 'Documents', icon: FilesIcon },
];
const YOURS: { name: Section; label: string; icon: ComponentType<IconProps> }[] = [
  { name: 'Settings', label: 'Settings', icon: GearIcon },
];

const MENU_WIDTH = 208;

export function Wordmark() {
  const theme = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <LogoMark width={28} />
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: theme.fontFamily.display,
          fontSize: 26,
          letterSpacing: -0.26,
          color: theme.colors.text.primary,
          transform: [{ translateY: 3 }],
        }}
      >
        Ledova
      </Text>
    </View>
  );
}

export function MenuButton({ expanded, onPress }: { expanded: boolean; onPress: () => void }) {
  const theme = useAppTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Open navigation"
      accessibilityState={{ expanded }}
      onPress={onPress}
      hitSlop={2}
      style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
    >
      <ListIcon size={theme.icon.sizes.md} color={theme.colors.text.muted} />
    </TouchableOpacity>
  );
}

export function AppearanceButton() {
  const theme = useAppTheme();
  const { mode, setMode } = useThemeChoice();
  const dark = mode === 'dark';
  const Icon = dark ? SunIcon : MoonIcon;
  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityLabel="Dark theme"
      accessibilityState={{ checked: dark }}
      onPress={() => setMode(dark ? 'paper' : 'dark')}
      hitSlop={2}
      style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon size={theme.icon.sizes.md} color={theme.colors.text.muted} />
    </TouchableOpacity>
  );
}

export function AppMenu({
  visible,
  current,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current: Section | undefined;
  onSelect: (section: Section) => void;
  onClose: () => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { userProfile } = useUserProfile();
  const { signOut, signingOut } = useSignOut();
  const [progress] = useState(() => new Animated.Value(0));
  const [shown, setShown] = useState(visible);
  const [confirming, setConfirming] = useState(false);
  if (visible && !shown) setShown(true);
  useEffect(() => {
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setShown(false);
    });
  }, [progress, visible]);
  const person = userProfile?.fullName?.trim() || userProfile?.email;
  const currentBackground = theme.mode === 'dark' ? theme.colors.brand.tint : `${theme.colors.brand.mid}1a`;
  const item = (section: { name: Section; label: string; icon: ComponentType<IconProps> }) => {
    const active = section.name === current;
    const Icon = section.icon;
    return (
      <TouchableOpacity
        key={section.name}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={() => onSelect(section.name)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.smd,
          paddingHorizontal: theme.spacing.smd,
          paddingVertical: 10,
          borderRadius: theme.borderRadius.md,
          backgroundColor: active ? currentBackground : theme.colors.utility.transparent,
        }}
      >
        <Icon
          size={theme.icon.sizes.md}
          color={active ? theme.colors.brand.light : theme.colors.text.secondary}
          weight={active ? 'fill' : 'regular'}
        />
        <Text
          style={{
            fontFamily: theme.fontFamily.medium,
            fontSize: theme.fontSize.sm,
            color: active ? theme.colors.brand.light : theme.colors.text.secondary,
          }}
        >
          {section.label}
        </Text>
      </TouchableOpacity>
    );
  };
  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View
        style={{ flex: 1 }}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: theme.colors.utility.black,
              opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] }),
            },
          ]}
        >
          <Pressable accessible={false} importantForAccessibility="no" style={{ flex: 1 }} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: MENU_WIDTH,
            backgroundColor: theme.colors.surface.base,
            borderRightWidth: 1,
            borderRightColor: theme.colors.border.subtle,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-MENU_WIDTH, 0] }) }],
          }}
        >
          <View
            style={{
              height: 64,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingLeft: 20,
              paddingRight: 12,
            }}
          >
            <Wordmark />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close navigation"
              onPress={onClose}
              style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
            >
              <XIcon size={theme.icon.sizes.md} color={theme.colors.text.muted} />
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: theme.spacing.md, gap: theme.spacing.lg }}>
            <View style={{ gap: 4 }}>{SECTIONS.map(item)}</View>
            <View style={{ gap: 4 }}>{YOURS.map(item)}</View>
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border.subtle, padding: 12, gap: 4 }}>
            {person && (
              <Text
                numberOfLines={1}
                style={{
                  paddingHorizontal: 12,
                  fontFamily: theme.fontFamily.medium,
                  fontSize: theme.fontSize.xs,
                  color: theme.colors.text.primary,
                }}
              >
                {person}
              </Text>
            )}
            <TouchableOpacity
              accessibilityRole="button"
              disabled={signingOut}
              onPress={() => setConfirming(true)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.smd,
                paddingHorizontal: theme.spacing.smd,
                paddingVertical: 10,
                opacity: signingOut ? 0.5 : 1,
              }}
            >
              <SignOutIcon size={theme.icon.sizes.md} color={theme.colors.text.secondary} />
              <Text
                style={{
                  fontFamily: theme.fontFamily.medium,
                  fontSize: theme.fontSize.sm,
                  color: theme.colors.text.secondary,
                }}
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
        <SignOutModal
          visible={confirming}
          isLoading={signingOut}
          onClose={() => setConfirming(false)}
          onConfirm={() => void signOut()}
        />
      </View>
    </Modal>
  );
}

import { useEffect, useState, type ComponentType } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CaretDownIcon,
  CaretRightIcon,
  FilesIcon,
  GearIcon,
  HouseIcon,
  ListIcon,
  MoonIcon,
  ShieldCheckIcon,
  SignOutIcon,
  SunIcon,
  XIcon,
  type IconProps,
} from 'phosphor-react-native';
import { useAppTheme, useThemeChoice } from '../contexts';
import { SignOutModal } from '../components/auth/SignOutModal';
import { LogoMark } from '../components/LogoMark';
import { useRole } from '../hooks/useRole';
import { useSignOut } from '../hooks/useSignOut';
import { useUserProfile } from '../hooks/useUserProfile';
import { useMemberRecordsState } from '../screens/holdings/MemberRecordsProvider';

export type Section = 'Dashboard' | 'Documents' | 'Eligibility' | 'Settings';

export type MenuRoute = 'Dashboard' | 'Certificates' | 'Verification' | 'Settings' | 'Account' | 'DataPrivacy';

type MenuItem = {
  name: Section;
  label: string;
  icon: ComponentType<IconProps>;
  route: MenuRoute;
  items?: { route: MenuRoute; label: string }[];
};

const SECTIONS: MenuItem[] = [
  { name: 'Dashboard', label: 'Dashboard', icon: HouseIcon, route: 'Dashboard' },
  { name: 'Documents', label: 'Documents', icon: FilesIcon, route: 'Certificates' },
];
const ELIGIBILITY: MenuItem = {
  name: 'Eligibility',
  label: 'Eligibility',
  icon: ShieldCheckIcon,
  route: 'Verification',
};
const YOURS: MenuItem[] = [
  {
    name: 'Settings',
    label: 'Settings',
    icon: GearIcon,
    route: 'Settings',
    items: [
      { route: 'Settings', label: 'Profile' },
      { route: 'Account', label: 'Account' },
      { route: 'DataPrivacy', label: 'Data and privacy' },
    ],
  },
];

const MENU_WIDTH = 208;

function Wordmark() {
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

function AppearanceButton() {
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
  route,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current: Section | undefined;
  route: string;
  onSelect: (route: MenuRoute) => void;
  onClose: () => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { userProfile } = useUserProfile();
  const { company } = useMemberRecordsState();
  const role = useRole();
  const yours = role.isKnown && role.isInvestor ? [ELIGIBILITY, ...YOURS] : YOURS;
  const { signOut, signingOut } = useSignOut();
  const [progress] = useState(() => new Animated.Value(0));
  const [shown, setShown] = useState(visible);
  const [confirming, setConfirming] = useState(false);
  const [toggled, setToggled] = useState<Partial<Record<Section, boolean>>>({});
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
  const row = (here: boolean) => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.smd,
    paddingHorizontal: theme.spacing.smd,
    paddingVertical: 10,
    borderRadius: theme.borderRadius.md,
    backgroundColor: here ? currentBackground : theme.colors.utility.transparent,
  });
  const label = (active: boolean) => ({
    fontFamily: theme.fontFamily.medium,
    fontSize: theme.fontSize.sm,
    color: active ? theme.colors.brand.light : theme.colors.text.secondary,
  });
  const item = (section: MenuItem) => {
    const active = section.name === current;
    const here = active && !section.items;
    const expanded = toggled[section.name] ?? active;
    const Icon = section.icon;
    const Caret = expanded ? CaretDownIcon : CaretRightIcon;
    const link = (
      <TouchableOpacity
        key={section.name}
        accessibilityRole="button"
        accessibilityState={{ selected: here }}
        onPress={() => onSelect(section.route)}
        style={[row(here), !!section.items && { flex: 1 }]}
      >
        <Icon
          size={theme.icon.sizes.md}
          color={here ? theme.colors.brand.light : theme.colors.text.secondary}
          weight={active ? 'fill' : 'regular'}
        />
        <Text style={label(here)}>{section.label}</Text>
      </TouchableOpacity>
    );
    if (!section.items) return link;
    return (
      <View key={section.name}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {link}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${section.label} navigation`}
            accessibilityState={{ expanded }}
            onPress={() => setToggled((shown) => ({ ...shown, [section.name]: !expanded }))}
            hitSlop={{ top: 2, bottom: 2, left: 6, right: 6 }}
            style={{ width: 32, height: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <Caret size={theme.icon.sizes.sm} color={theme.colors.text.secondary} />
          </TouchableOpacity>
        </View>
        {expanded && (
          <View
            style={{
              marginLeft: 20,
              marginTop: 4,
              gap: 4,
              paddingLeft: 12,
              borderLeftWidth: 1,
              borderLeftColor: theme.colors.border.subtle,
            }}
          >
            {section.items.map((child) => (
              <TouchableOpacity
                key={child.route}
                accessibilityRole="button"
                accessibilityState={{ selected: child.route === route }}
                onPress={() => onSelect(child.route)}
                style={row(child.route === route)}
              >
                <Text style={label(child.route === route)}>{child.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
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
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: theme.spacing.md, gap: theme.spacing.lg }}
          >
            <View style={{ gap: 4 }}>{SECTIONS.map(item)}</View>
            <View style={{ gap: 4 }}>{yours.map(item)}</View>
          </ScrollView>
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
            {company && (
              <Text
                numberOfLines={1}
                style={{
                  paddingHorizontal: 12,
                  fontFamily: theme.fontFamily.regular,
                  fontSize: theme.fontSize.xs,
                  color: theme.colors.text.muted,
                }}
              >
                {company.company.name}
              </Text>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={signingOut}
                onPress={() => setConfirming(true)}
                style={{
                  flex: 1,
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
              <AppearanceButton />
            </View>
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

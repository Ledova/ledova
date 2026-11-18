import { createContext, useCallback, useContext, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { ScrollView, Text, View, type ScrollViewProps } from 'react-native';
import { useNavigation, type NavigationProp, type NavigationState, type ParamListBase } from '@react-navigation/native';
import { useThemedStyles } from '../contexts';
import { InSignedInFrame, type FrameOptions } from './InSignedInFrame';

export const PageScroll = createContext<(node: View | null) => void>(() => {});

type PageProps = Pick<
  ScrollViewProps,
  'testID' | 'refreshControl' | 'showsVerticalScrollIndicator' | 'innerViewRef'
> & {
  ref?: Ref<ScrollView>;
  title: string;
  titleAction?: ReactNode;
  links?: ReactNode;
  lede?: string;
  held?: boolean;
  available?: boolean;
  unavailable?: ReactNode;
  children?: ReactNode;
};

export function Page({
  ref,
  title,
  titleAction,
  links,
  lede,
  held = false,
  available = true,
  unavailable,
  children,
  ...scroll
}: PageProps) {
  const inFrame = useContext(InSignedInFrame);
  const navigation =
    useNavigation<NavigationProp<ParamListBase, string, string | undefined, NavigationState, FrameOptions>>();
  useLayoutEffect(() => {
    if (inFrame) navigation.setOptions({ title, action: titleAction, held });
  });
  const styles = useThemedStyles((theme) => ({
    page: { flex: 1, backgroundColor: theme.colors.surface.base },
    content: {
      paddingHorizontal: theme.spacing.md,
      paddingBottom: theme.spacing.xxxl,
      gap: theme.spacing.md,
    },
    framed: { paddingTop: theme.spacing.md },
    stack: { gap: theme.spacing.md },
    hidden: { display: 'none' as const },
    titleRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.md,
      minHeight: 64,
      paddingVertical: theme.spacing.sm,
    },
    title: {
      flex: 1,
      fontFamily: theme.fontFamily.display,
      fontSize: theme.fontSize.xxxl,
      lineHeight: 36,
      letterSpacing: -0.3,
      color: theme.colors.text.primary,
    },
    lede: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20, color: theme.colors.text.muted },
  }));
  const ledeText = !!lede && <Text style={styles.lede}>{lede}</Text>;
  const view = useRef<ScrollView | null>(null);
  const offset = useRef(0);
  const reveal = useCallback((node: View | null) => {
    const inner = view.current?.getInnerViewNode();
    if (!node || !inner) return;
    node.measureLayout?.(inner, (_x, y) => {
      if (y < offset.current) view.current?.scrollTo({ y: Math.max(0, y - 8), animated: false });
    });
  }, []);
  return (
    <ScrollView
      ref={(node) => {
        view.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      onScroll={(event) => {
        offset.current = event.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={64}
      style={styles.page}
      contentContainerStyle={[styles.content, inFrame && styles.framed]}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      {...scroll}
    >
      <PageScroll.Provider value={reveal}>
        {inFrame ? (
          <>
            {links}
            {ledeText}
          </>
        ) : (
          <View>
            <View style={styles.titleRow}>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              {titleAction}
            </View>
            {links}
            {ledeText}
          </View>
        )}
        {unavailable === undefined ? (
          children
        ) : (
          <>
            {!available && unavailable}
            <View
              style={[styles.stack, !available && styles.hidden]}
              accessibilityElementsHidden={!available}
              importantForAccessibility={available ? 'auto' : 'no-hide-descendants'}
            >
              {children}
            </View>
          </>
        )}
      </PageScroll.Provider>
    </ScrollView>
  );
}

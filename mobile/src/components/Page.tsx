import type { ReactNode, Ref } from 'react';
import { ScrollView, Text, View, type ScrollViewProps } from 'react-native';
import { useThemedStyles } from '../contexts';

type PageProps = Pick<ScrollViewProps, 'testID' | 'refreshControl' | 'showsVerticalScrollIndicator'> & {
  ref?: Ref<ScrollView>;
  title: string;
  titleAction?: ReactNode;
  lede?: string;
  children?: ReactNode;
};

export function Page({ ref, title, titleAction, lede, children, ...scroll }: PageProps) {
  const styles = useThemedStyles((theme) => ({
    page: { flex: 1, backgroundColor: theme.colors.surface.base },
    content: {
      paddingHorizontal: theme.spacing.md,
      paddingBottom: theme.spacing.xxxl,
      gap: theme.spacing.md,
    },
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
  return (
    <ScrollView
      ref={ref}
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      {...scroll}
    >
      <View>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          {titleAction}
        </View>
        {!!lede && <Text style={styles.lede}>{lede}</Text>}
      </View>
      {children}
    </ScrollView>
  );
}

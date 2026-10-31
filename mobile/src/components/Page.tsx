import type { ReactNode, Ref } from 'react';
import { ScrollView, Text, View, type ScrollViewProps } from 'react-native';
import { useThemedStyles } from '../contexts';

type PageProps = Pick<ScrollViewProps, 'testID' | 'refreshControl' | 'showsVerticalScrollIndicator'> & {
  ref?: Ref<ScrollView>;
  title: string;
  titleAction?: ReactNode;
  lede?: string;
  actions?: ReactNode;
  children?: ReactNode;
};

export function Page({ ref, title, titleAction, lede, actions, children, ...scroll }: PageProps) {
  const styles = useThemedStyles((theme) => ({
    page: { flex: 1, backgroundColor: theme.colors.surface.base },
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.smd,
      paddingBottom: theme.spacing.xxl,
      gap: theme.spacing.lg,
    },
    header: { gap: theme.spacing.sm },
    titleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.md },
    title: {
      flex: 1,
      fontFamily: theme.fontFamily.display,
      fontSize: theme.fontSize.xxxxl,
      color: theme.colors.text.primary,
    },
    lede: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
    actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: theme.spacing.sm },
  }));
  return (
    <ScrollView
      ref={ref}
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      {...scroll}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          {titleAction}
        </View>
        {!!lede && <Text style={styles.lede}>{lede}</Text>}
        {!!actions && <View style={styles.actions}>{actions}</View>}
      </View>
      {children}
    </ScrollView>
  );
}

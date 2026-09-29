import type { ReactNode } from 'react';
import { ScrollView, Text, View, type ScrollViewProps } from 'react-native';
import { useThemedStyles } from '../contexts';

type PageProps = Pick<
  ScrollViewProps,
  'testID' | 'refreshControl' | 'keyboardShouldPersistTaps' | 'showsVerticalScrollIndicator'
> & {
  title: string;
  lede?: string;
  actions?: ReactNode;
  children?: ReactNode;
};

export function Page({ title, lede, actions, children, ...scroll }: PageProps) {
  const styles = useThemedStyles((theme) => ({
    page: { flex: 1, backgroundColor: theme.colors.surface.base },
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.smd,
      paddingBottom: theme.spacing.xxl,
      gap: theme.spacing.lg,
    },
    header: { gap: theme.spacing.sm },
    title: { fontFamily: theme.fontFamily.display, fontSize: theme.fontSize.xxxxl, color: theme.colors.text.primary },
    lede: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
    actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: theme.spacing.sm },
  }));
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} {...scroll}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {!!lede && <Text style={styles.lede}>{lede}</Text>}
        {!!actions && <View style={styles.actions}>{actions}</View>}
      </View>
      {children}
    </ScrollView>
  );
}

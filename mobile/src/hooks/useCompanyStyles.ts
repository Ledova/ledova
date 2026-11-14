import { useThemedStyles } from '../contexts/index';

export const useCompanyStyles = () =>
  useThemedStyles((theme) => ({
    group: { gap: theme.spacing.smd },
    filledGroup: { gap: theme.spacing.sm },
    choices: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: theme.spacing.sm },
    actions: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      justifyContent: 'flex-end' as const,
      gap: theme.spacing.sm,
    },
    heading: { fontFamily: theme.fontFamily.medium, fontSize: 17, color: theme.colors.text.primary },
    text: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
    muted: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
    filledLabel: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 21, color: theme.colors.text.body },
    filledHint: { fontFamily: theme.fontFamily.regular, fontSize: 12, lineHeight: 18, color: theme.colors.text.subtle },
    error: {
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.status.error.text,
    },
  }));

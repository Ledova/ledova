import { useThemedStyles } from '../../contexts';

export const useCompanyStyles = () =>
  useThemedStyles((theme) => ({
    group: { gap: theme.spacing.smd },
    choices: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: theme.spacing.sm },
    entry: { gap: 8, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle },
    lastEntry: { paddingBottom: 0, borderBottomWidth: 0 },
    heading: { fontFamily: theme.fontFamily.medium, fontSize: 17, color: theme.colors.text.primary },
    text: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
    muted: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
    error: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.error.default },
    input: {
      fontFamily: theme.fontFamily.regular,
      fontSize: 16,
      color: theme.colors.text.primary,
      backgroundColor: theme.colors.surface.raised,
      borderColor: theme.colors.border.default,
      borderWidth: 1,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.smd,
    },
  }));

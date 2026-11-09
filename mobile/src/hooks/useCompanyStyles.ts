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
    error: {
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.status.error.text,
    },
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
    filled: {
      minHeight: 48,
      paddingHorizontal: theme.spacing.md,
      backgroundColor: theme.colors.surface.tertiary,
    },
    iconField: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.smd },
    iconText: {
      flex: 1,
      fontFamily: theme.fontFamily.regular,
      fontSize: 16,
      color: theme.colors.text.primary,
      padding: 0,
    },
  }));

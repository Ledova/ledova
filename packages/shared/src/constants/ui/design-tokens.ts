function buildColors(p: {
  surface: { base: string; raised: string; tertiary: string; overlay: string; disabled: string };
  text: { primary: string; secondary: string; body: string; muted: string; subtle: string };
  brand: { subtle: string; light: string; mid: string; default: string; hover: string };
  border: { default: string; subtle: string; strong: string; focus: string };
  success: { light: string; default: string; dark: string };
  error: { light: string; default: string; dark: string; subtle: string; backgroundSubtle: string };
  warning: { light: string; default: string };
  info: { light: string; default: string };
  badge: { successBg: string; infoBg: string };
  interactive: { selectedBg: string };
}) {
  const colors = {
    surface: { ...p.surface, transparent: 'transparent' },
    text: p.text,
    brand: p.brand,
    border: p.border,
    success: p.success,
    error: p.error,
    warning: p.warning,
    info: p.info,
    utility: { white: '#ffffff', black: '#000000', transparent: 'transparent' },

    status: {
      success: { icon: p.success.light, text: p.success.default },
      error: { icon: p.error.light, text: p.error.light },
      warning: { icon: p.warning.light, text: p.warning.light },
      info: { icon: p.info.light, text: p.info.light },
    },
    interactive: {
      default: p.brand.default,
      defaultSubtle: p.brand.mid,
      active: p.brand.light,
      disabled: p.surface.disabled,
      selected: {
        background: p.interactive.selectedBg,
        border: p.brand.default,
      },
    },
    badge: {
      success: { background: `${p.success.dark}80`, text: p.success.light },
      warning: { text: p.warning.light },
      info: { background: p.badge.infoBg, text: p.text.secondary },
    },
    form: {
      placeholder: p.text.muted,
      error: p.error.light,
      errorBackground: `${p.error.dark}80`,
      borderError: p.error.default,
    },
  } as const;
  return colors;
}

const PAPER_COLORS = {
  paper: { default: '#f6f3ec', deep: '#ece7dc', card: '#ffffff' },
  ink: { default: '#17191e', muted: '#5b5f66' },
  rule: { default: '#e3ded3', soft: '#eeeae1', strong: '#d6d0c3' },
  ledger: { default: '#2e6a57', hover: '#245446', tint: '#e6eeea' },
} as const;

const PAPER_THEME = buildColors({
  surface: {
    base: PAPER_COLORS.paper.default,
    raised: PAPER_COLORS.paper.card,
    tertiary: PAPER_COLORS.paper.deep,
    overlay: PAPER_COLORS.rule.default,
    disabled: PAPER_COLORS.rule.strong,
  },
  text: {
    primary: PAPER_COLORS.ink.default,
    secondary: '#2b2e35',
    body: '#3d4148',
    muted: PAPER_COLORS.ink.muted,
    subtle: '#686b72',
  },
  brand: {
    subtle: PAPER_COLORS.ledger.hover,
    light: PAPER_COLORS.ledger.default,
    mid: PAPER_COLORS.ledger.default,
    default: PAPER_COLORS.ledger.default,
    hover: PAPER_COLORS.ledger.hover,
  },
  border: {
    default: PAPER_COLORS.rule.strong,
    subtle: PAPER_COLORS.rule.default,
    strong: '#b9b2a3',
    focus: PAPER_COLORS.ledger.default,
  },
  success: { light: '#166534', default: '#166534', dark: '#14532d' },
  error: {
    light: '#b91c1c',
    default: '#b91c1c',
    dark: '#991b1b',
    subtle: '#fef2f2',
    backgroundSubtle: '#b91c1c14',
  },
  warning: { light: '#92400e', default: '#92400e' },
  info: { light: '#0369a1', default: '#0369a1' },
  badge: { successBg: '#16a34a20', infoBg: PAPER_COLORS.paper.deep },
  interactive: { selectedBg: PAPER_COLORS.ledger.default + '1A' },
});

function shadow(offsetY: number, blurRadius: number, opacity: number, elevation: number) {
  return {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: blurRadius,
    elevation,
    web: `0 ${offsetY}px ${blurRadius}px 0 rgba(0, 0, 0, ${opacity})`,
  } as const;
}

export const DESIGN_TOKENS = {
  colors: PAPER_THEME,

  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
    xxxl: 64,
    xxxxl: 80,
  },

  borderRadius: {
    none: 0,
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 24,
    full: 9999,
  },

  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    xxxl: 30,
    xxxxl: 36,
    xxxxxl: 48,
  },

  fontWeight: {
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },

  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
    loose: 2,
  },

  layout: {
    transparentHeaderPadding: 110,
    screenBottomPadding: 40,
    bottomTabBarHeight: 100,
    screenHeaderHeight: 160,
  },

  zIndex: {
    base: 0,
    dropdown: 1000,
    sticky: 1020,
    fixed: 1030,
    backdrop: 1040,
    modal: 1050,
    popover: 1060,
    tooltip: 1070,
  },

  animation: {
    duration: { instant: 0, fast: 150, normal: 300, slow: 500 },
    easing: {
      linear: 'linear' as const,
      easeIn: 'ease-in' as const,
      easeOut: 'ease-out' as const,
      easeInOut: 'ease-in-out' as const,
    },
  },

  shadows: {
    sm: shadow(1, 2, 0.05, 1),
    md: shadow(2, 4, 0.1, 3),
    lg: shadow(4, 8, 0.15, 5),
    xl: shadow(8, 16, 0.2, 8),
  },

  icon: {
    sizes: { xs: 12, sm: 16, md: 20, lg: 24, xl: 32, xxl: 48, hero: 40, display: 64 },
    weights: {
      thin: 'thin' as const,
      light: 'light' as const,
      regular: 'regular' as const,
      bold: 'bold' as const,
      fill: 'fill' as const,
    },
    colors: {
      primary: PAPER_THEME.text.primary,
      muted: PAPER_THEME.text.subtle,
    },
  },
} as const;

export { PAPER_COLORS, PAPER_THEME };

export type Shadow = typeof DESIGN_TOKENS.shadows;
export type Icon = typeof DESIGN_TOKENS.icon;

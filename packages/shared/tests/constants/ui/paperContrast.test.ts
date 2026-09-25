import { PAPER_COLORS, PAPER_THEME } from '../../../src/constants/ui/design-tokens';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const TEXT_COLOURS: Record<string, string> = {
  'text.primary': PAPER_THEME.text.primary,
  'text.secondary': PAPER_THEME.text.secondary,
  'text.body': PAPER_THEME.text.body,
  'text.muted': PAPER_THEME.text.muted,
  'text.subtle': PAPER_THEME.text.subtle,
  'brand.light': PAPER_THEME.brand.light,
  'error.light': PAPER_THEME.error.light,
  'success.light': PAPER_THEME.success.light,
  'warning.light': PAPER_THEME.warning.light,
  'info.light': PAPER_THEME.info.light,
};

const SURFACES: Record<string, string> = {
  paper: PAPER_COLORS.paper.default,
  card: PAPER_COLORS.paper.card,
  'deep paper': PAPER_COLORS.paper.deep,
};

const CASES = Object.entries(TEXT_COLOURS).flatMap(([name, colour]) =>
  Object.entries(SURFACES)
    .filter(([surface]) => !(name === 'text.subtle' && surface === 'deep paper'))
    .map(([surface, background]) => [name, surface, colour, background] as const),
);

describe('paper theme text contrast', () => {
  it.each(CASES)('%s reads at WCAG AA on %s', (_name, _surface, colour, background) => {
    expect(contrast(colour, background)).toBeGreaterThanOrEqual(4.5);
  });
});

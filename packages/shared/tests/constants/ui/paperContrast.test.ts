import { PAPER_COLORS, PAPER_THEME } from '../../../src/constants/ui/design-tokens';

function channel(hex: string, start: number): number {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
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

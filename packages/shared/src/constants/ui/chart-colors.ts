import { DESIGN_TOKENS } from './design-tokens';

export const getChartColor = (index: number, palette: readonly string[] = DESIGN_TOKENS.colors.chart): string =>
  palette[index % palette.length] as string;

import Svg, { Path, Rect } from 'react-native-svg';
import { useAppTheme } from '../contexts';

export function LogoMark({ width, height = width }: { width: number; height?: number }) {
  const theme = useAppTheme();
  return (
    <Svg width={width} height={height} viewBox="0 0 28 28" fill="none">
      <Rect x={1} y={1} width={26} height={26} rx={7} stroke={theme.colors.text.primary} strokeWidth={1.5} />
      <Path
        d="M10.75 7.25v12h8"
        stroke={theme.colors.brand.light}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

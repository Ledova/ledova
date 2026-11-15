import Svg, { Path, Rect } from 'react-native-svg';
import { useAppTheme } from '../contexts';

export function LogoMark({ width }: { width: number }) {
  const theme = useAppTheme();
  return (
    <Svg width={width} height={width} viewBox="0 0 28 28" fill="none">
      <Rect x={1} y={1} width={26} height={26} rx={7} stroke={theme.colors.text.primary} strokeWidth={1.75} />
      <Path
        d="M10.5 7.5v12h8"
        stroke={theme.colors.brand.light}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

import { init, use as registerCharts, type ComposeOption, type EChartsType } from 'echarts/core';
import { PieChart, type PieSeriesOption } from 'echarts/charts';
import { SVGRenderer } from 'echarts/renderers';
import type { OwnershipRingProps } from './OwnershipRing';
import { ownershipColor } from './ownershipColors';

registerCharts([PieChart, SVGRenderer]);

export interface OwnershipRingController {
  highlight: (uuid: string | null) => void;
  dispose: () => void;
}

export function renderOwnershipRing(
  container: HTMLDivElement,
  { classes, issuedSupply, onSelect, onHighlight }: Omit<OwnershipRingProps, 'highlighted'>,
): OwnershipRingController {
  const tokens = getComputedStyle(container);
  const color = (name: string) => tokens.getPropertyValue(`--color-${name}`).trim();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const eligible = classes.filter((item) => item.issuedSupply !== null && BigInt(item.issuedSupply) > 0n);
  const rowFrom = (parameters: unknown) => {
    if (!parameters || typeof parameters !== 'object' || !('data' in parameters)) return;
    const node = parameters.data;
    if (!node || typeof node !== 'object' || !('id' in node)) return;
    return eligible.find((item) => item.uuid === node.id);
  };
  const option = (): ComposeOption<PieSeriesOption> => ({
    animation: !reducedMotion.matches,
    animationDuration: 0,
    animationDurationUpdate: reducedMotion.matches ? 0 : 160,
    animationEasing: 'cubicOut',
    series: [
      {
        type: 'pie',
        radius: ['63%', '88%'],
        center: ['50%', '50%'],
        minAngle: 0,
        padAngle: 0,
        selectedMode: false,
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scale: !reducedMotion.matches, scaleSize: 5, focus: 'self' },
        stateAnimation: { duration: reducedMotion.matches ? 0 : 160, easing: 'cubicOut' },
        blur: { itemStyle: { opacity: 0.3 } },
        itemStyle: { borderColor: color('surface-raised'), borderWidth: 2 },
        data: eligible.map((item) => ({
          id: item.uuid,
          name: item.name,
          value: Number(item.issuedSupply!) / Number(issuedSupply),
          itemStyle: { color: tokens.getPropertyValue(ownershipColor(classes, item.uuid).slice(4, -1)).trim() },
        })),
      },
    ],
  });
  let chart: EChartsType | undefined;
  let highlighted: string | null = null;
  let nativeHover: string | null = null;
  const highlight = (uuid: string | null) => {
    highlighted = uuid;
    if (!chart || (nativeHover !== null && uuid === nativeHover)) return;
    chart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
    const dataIndex = eligible.findIndex((item) => item.uuid === uuid);
    if (dataIndex >= 0) chart.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex });
  };
  const resize = () => {
    if (container.clientWidth === 0) return;
    if (!chart) {
      chart = init(container, undefined, { renderer: 'svg' });
      chart.setOption(option());
      chart.on('click', (parameters) => {
        const row = rowFrom(parameters);
        if (row) onSelect(row.uuid);
      });
      chart.on('mouseover', (parameters) => {
        const row = rowFrom(parameters);
        if (!row) return;
        nativeHover = row.uuid;
        if (highlighted && highlighted !== row.uuid) {
          const dataIndex = eligible.findIndex((item) => item.uuid === highlighted);
          if (dataIndex >= 0) chart?.dispatchAction({ type: 'downplay', seriesIndex: 0, dataIndex });
        }
        onHighlight(row.uuid);
      });
      const leave = () => {
        nativeHover = null;
        onHighlight(null);
      };
      chart.on('mouseout', leave);
      chart.on('globalout', leave);
      highlight(highlighted);
    } else chart.resize();
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  const updateMotion = () => {
    chart?.setOption(option());
  };
  resize();
  observer?.observe(container);
  reducedMotion.addEventListener('change', updateMotion);
  return {
    highlight,
    dispose: () => {
      observer?.disconnect();
      reducedMotion.removeEventListener('change', updateMotion);
      chart?.dispose();
    },
  };
}

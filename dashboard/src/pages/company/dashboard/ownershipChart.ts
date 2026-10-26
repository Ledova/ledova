import { init, use as registerCharts, type ComposeOption, type EChartsType } from 'echarts/core';
import { PieChart, type PieSeriesOption } from 'echarts/charts';
import { TooltipComponent, type TooltipComponentOption } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { shareCount, sharePercentage } from '@ledova/shared';
import type { OwnershipRingProps } from './OwnershipRing';
import { ownershipColor } from './ownershipColors';

registerCharts([PieChart, TooltipComponent, SVGRenderer]);

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
  const eligible = classes.filter((item) => item.issuedSupply !== null && BigInt(item.issuedSupply) > 0n);
  const rowFrom = (parameters: unknown) => {
    if (!parameters || typeof parameters !== 'object' || !('data' in parameters)) return;
    const node = parameters.data;
    if (!node || typeof node !== 'object' || !('id' in node)) return;
    return eligible.find((item) => item.uuid === node.id);
  };
  const option: ComposeOption<PieSeriesOption | TooltipComponentOption> = {
    animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    animationDuration: 0,
    animationDurationUpdate: 200,
    tooltip: {
      renderMode: 'richText',
      backgroundColor: color('surface-raised'),
      borderColor: color('border'),
      textStyle: { color: color('text-primary'), fontFamily: tokens.fontFamily },
      formatter: (parameters) => {
        const row = rowFrom(parameters);
        return row
          ? `${row.name} (${row.symbol})\n${shareCount(row.issuedSupply!, 'issued')}\n${sharePercentage(row.issuedSupply!, issuedSupply)} of issued shares`
          : '';
      },
    },
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
        emphasis: { scale: false, focus: 'self' },
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
  };
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
      chart.setOption(option);
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
  observer?.observe(container);
  resize();
  return {
    highlight,
    dispose: () => {
      observer?.disconnect();
      chart?.dispose();
    },
  };
}

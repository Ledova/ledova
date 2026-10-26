import { init, use as registerCharts, type ComposeOption, type EChartsType } from 'echarts/core';
import { TreemapChart, type TreemapSeriesOption } from 'echarts/charts';
import { TooltipComponent, type TooltipComponentOption } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { formatShareCount, shareCount, sharePercentage } from '@ledova/shared';
import type { OwnershipMapProps } from './OwnershipMap';

registerCharts([TreemapChart, TooltipComponent, SVGRenderer]);

export function renderOwnershipMap(container: HTMLDivElement, { classes, issuedSupply, onSelect }: OwnershipMapProps) {
  const tokens = getComputedStyle(container);
  const color = (name: string) => tokens.getPropertyValue(`--color-${name}`).trim();
  const eligible = classes.filter((item) => item.issuedSupply !== null && BigInt(item.issuedSupply) > 0n);
  const rowFrom = (parameters: unknown) => {
    if (!parameters || typeof parameters !== 'object' || !('data' in parameters)) return;
    const node = parameters.data;
    if (!node || typeof node !== 'object' || !('id' in node)) return;
    return eligible.find((item) => item.uuid === node.id);
  };
  const option: ComposeOption<TreemapSeriesOption | TooltipComponentOption> = {
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
        type: 'treemap',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        sort: 'desc',
        labelLayout: { hideOverlap: true },
        label: {
          show: true,
          color: color('text-primary'),
          fontFamily: tokens.fontFamily,
          fontSize: 14,
          lineHeight: 21,
          overflow: 'truncate',
          formatter: (parameters) => {
            const row = rowFrom(parameters);
            return row
              ? `${row.symbol}\n${formatShareCount(row.issuedSupply!)}\n${sharePercentage(row.issuedSupply!, issuedSupply)}`
              : '';
          },
        },
        itemStyle: { color: color('brand-tint'), borderColor: color('surface-raised'), borderWidth: 3, gapWidth: 3 },
        emphasis: { itemStyle: { borderColor: color('brand-light'), borderWidth: 3 } },
        data: eligible.map((item) => ({
          id: item.uuid,
          name: item.name,
          value: Number((BigInt(item.issuedSupply!) * 1000000000n) / BigInt(issuedSupply)),
          itemStyle: { color: color(item.tokenType === 'ordinary' ? 'brand-tint' : 'surface-tertiary') },
        })),
      },
    ],
  };
  let chart: EChartsType | undefined;
  const resize = () => {
    if (container.clientWidth === 0) return;
    if (!chart) {
      chart = init(container, undefined, { renderer: 'svg' });
      chart.setOption(option);
      chart.on('click', (parameters) => {
        const row = rowFrom(parameters);
        if (row) onSelect(row.uuid);
      });
    } else chart.resize();
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  observer?.observe(container);
  resize();
  return () => {
    observer?.disconnect();
    chart?.dispose();
  };
}

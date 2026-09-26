// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { PortfolioSnapshotDataPoint } from '@ledova/shared';
import { PerformanceSection } from './PerformanceSection';

const rate = vi.hoisted(() => ({ value: 1 }));
const drawn = vi.hoisted(() => ({ total: [] as unknown[], byAsset: [] as unknown[] }));

vi.mock('@hooks/useCurrency', () => ({
  useCurrency: () => ({
    formatDisplayCurrency: (value: number) => `$${(value * rate.value).toFixed(2)}`,
    exchangeRate: rate.value,
  }),
}));
vi.mock('./performance/PortfolioValueChart', () => ({
  PortfolioValueChart: ({ chartData }: { chartData: { values: number[] } | null }) => {
    drawn.total.push(chartData?.values);
    return null;
  },
}));
vi.mock('./performance/HoldingsChart', () => ({
  HoldingsChart: ({
    instrumentData,
    onActivePointChange,
  }: {
    instrumentData: { data: unknown[] };
    onActivePointChange: (index: number) => void;
  }) => {
    drawn.byAsset.push(instrumentData.data);
    return <button onClick={() => onActivePointChange(0)}>Earlier date</button>;
  },
}));

afterEach(() => {
  cleanup();
  rate.value = 1;
  drawn.total.length = 0;
  drawn.byAsset.length = 0;
});

function point(dayIndex: number, baseQuantity: string): PortfolioSnapshotDataPoint {
  return {
    dayIndex,
    date: `2026-09-0${dayIndex + 1}`,
    totalMarketValue: 200 + Number(baseQuantity) * 100,
    assetValues: { ETH: 200 + Number(baseQuantity) * 100 },
    assetSymbols: ['ETH'],
    assetHoldings: {
      ETH: {
        assetUuid: 'eth',
        quantity: String(2 + Number(baseQuantity)),
        wallets: ['base-wallet', 'ethereum-wallet'],
        marketValue: String(200 + Number(baseQuantity) * 100),
        perChain: [
          {
            chain: 'base',
            quantity: baseQuantity,
            marketValue: String(Number(baseQuantity) * 100),
            wallets: ['base-wallet'],
          },
          { chain: 'ethereum', quantity: '2', marketValue: '200', wallets: ['ethereum-wallet'] },
        ],
      },
    },
  };
}

function show(snapshotData: PortfolioSnapshotDataPoint[]) {
  const view = render(
    <PerformanceSection
      snapshotData={snapshotData}
      timeRanges={[]}
      selectedTimeRange="3M"
      onTimeRangeChange={() => {}}
      isLoading={false}
      error={null}
    />,
  );
  fireEvent.click(view.getByText('Holdings'));
  return view;
}

describe('the historical network breakdown', () => {
  it('expands one asset and follows the selected historical point', () => {
    const view = show([point(0, '1'), point(1, '3')]);
    expect(view.queryByText('base')).toBeNull();
    fireEvent.click(view.getByLabelText('Show ETH by network'));
    expect(view.getByText('3 ETH')).toBeTruthy();
    expect(view.getByText('$300.00')).toBeTruthy();
    fireEvent.click(view.getByText('Earlier date'));
    expect(view.getByText('1 ETH')).toBeTruthy();
    expect(view.getByText('$100.00')).toBeTruthy();
    expect(view.queryByText('3 ETH')).toBeNull();
    fireEvent.click(view.getByLabelText('Hide ETH by network'));
    expect(view.queryByText('base')).toBeNull();
  });

  it('keeps an unpriced slice distinct from a real zero', () => {
    const snapshot = point(0, '0');
    delete snapshot.assetHoldings.ETH.perChain![1].marketValue;
    const view = show([snapshot]);
    fireEvent.click(view.getByLabelText('Show ETH by network'));
    expect(view.getByText('$0.00')).toBeTruthy();
    expect(view.getByText('Unpriced')).toBeTruthy();
  });

  it('returns to the latest point when new data replaces the selected history', () => {
    const view = show([point(0, '1'), point(1, '3')]);
    expect(view.getByText('ETH: $500.00')).toBeTruthy();
    fireEvent.click(view.getByText('Earlier date'));
    expect(view.getByText('ETH: $300.00')).toBeTruthy();
    view.rerender(
      <PerformanceSection
        snapshotData={[point(0, '2'), point(1, '4')]}
        timeRanges={[]}
        selectedTimeRange="3M"
        onTimeRangeChange={() => {}}
        isLoading={false}
        error={null}
      />,
    );
    expect(view.getByText('ETH: $600.00')).toBeTruthy();
    expect(view.queryByText('ETH: $400.00')).toBeNull();
  });

  it.each([undefined, [point(0, '1').assetHoldings.ETH.perChain![0]]])(
    'does not invent a split for older or single-network data',
    (perChain) => {
      const snapshot = point(0, '1');
      Object.assign(snapshot.assetHoldings.ETH, { perChain });
      const view = show([snapshot]);
      expect(view.queryByLabelText('Show ETH by network')).toBeNull();
    },
  );
});

describe('the charts, in the same currency as the figures above them', () => {
  function showChart(snapshotData: PortfolioSnapshotDataPoint[]) {
    return render(
      <PerformanceSection
        snapshotData={snapshotData}
        timeRanges={[]}
        selectedTimeRange="3M"
        onTimeRangeChange={() => {}}
        isLoading={false}
        error={null}
      />,
    );
  }

  it('draws both charts in AUD, at the rate the headline uses', () => {
    rate.value = 1.5;
    const view = showChart([point(0, '1'), point(1, '2')]);

    expect(view.getByText('$600.00')).toBeTruthy();
    expect(drawn.total.at(-1)).toEqual([450, 600]);
    fireEvent.click(view.getByText('Holdings'));
    expect(drawn.byAsset.at(-1)).toEqual([{ ETH: 450 }, { ETH: 600 }]);
  });

  it('draws no chart while the exchange rate is unknown', () => {
    rate.value = 0;
    const view = showChart([point(0, '1'), point(1, '2')]);
    fireEvent.click(view.getByText('Holdings'));

    expect(drawn.total).toEqual([]);
    expect(drawn.byAsset).toEqual([]);
    expect(view.queryByText('Earlier date')).toBeNull();
  });
});

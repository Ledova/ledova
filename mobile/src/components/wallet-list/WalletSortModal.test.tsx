import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { WalletSortModal } from './WalletSortModal';

afterEach(async () => {
  await cleanup();
});

it('is titled Sort Wallets and lists the sort options as ruled rows with small headings', async () => {
  const apply = jest.fn();
  const close = jest.fn();
  const view = await render(
    <WalletSortModal visible selectedChain="all" selectedSort="default" onClose={close} onApply={apply} />,
  );
  expect(view.getByRole('header', { name: 'Sort Wallets' })).toBeTruthy();
  expect(view.getByRole('header', { name: 'Chain' })).toBeTruthy();
  expect(view.getByRole('header', { name: 'Sort By' })).toBeTruthy();
  const chosen = view.getByRole('button', { name: /^Default/, selected: true });
  expect(chosen).not.toHaveStyle({ borderWidth: 2 });
  expect(chosen.props.style).not.toHaveProperty('backgroundColor');
  const [, rule] = chosen.parent!.children;
  expect(rule).toHaveStyle({ height: 1 });
  expect(view.getByRole('button', { name: 'All', selected: true })).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'BASE' }));
  await fireEvent.press(view.getByRole('button', { name: /^Alphabetical/ }));
  expect(view.getByRole('button', { name: 'BASE', selected: true })).toBeTruthy();
  expect(view.getByRole('button', { name: /^Alphabetical/, selected: true })).toBeTruthy();
  const closeButton = view.getByRole('button', { name: 'Close' });
  expect(closeButton.parent!.children).toEqual([closeButton, view.getByRole('button', { name: 'Apply' })]);
  await fireEvent.press(view.getByRole('button', { name: 'Apply' }));
  expect(apply).toHaveBeenCalledWith('base', 'name');
  expect(close).toHaveBeenCalledTimes(1);
});

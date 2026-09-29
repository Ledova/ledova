import type { ComponentProps } from 'react';
import { Text } from 'react-native';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Action } from '../Ledger';
import { CustomModal } from './CustomModal';

afterEach(async () => {
  await cleanup();
});

function dialog(props: Partial<ComponentProps<typeof CustomModal>> = {}) {
  return (
    <CustomModal
      visible
      title="Rename wallet"
      onClose={jest.fn()}
      showFooter
      confirmLabel="Save"
      onConfirm={jest.fn()}
      {...props}
    >
      <Text>Body copy</Text>
    </CustomModal>
  );
}

it('is the card over the dimmed page, labelled by its title and ended by one right-aligned action row', async () => {
  const close = jest.fn();
  const save = jest.fn();
  const view = await render(
    dialog({ onClose: close, onConfirm: save, actions: <Action label="Remove" onPress={jest.fn()} /> }),
  );
  const title = view.getByRole('header', { name: 'Rename wallet' });
  const card = title.parent!;
  expect(card).toHaveStyle({ borderWidth: 1, borderRadius: 12, padding: 16, maxHeight: '100%' });
  expect(card.children[0]).toBe(title);
  const cancel = view.getByRole('button', { name: 'Cancel' });
  const row = cancel.parent!;
  expect(row.children).toEqual([
    cancel,
    view.getByRole('button', { name: 'Remove' }),
    view.getByRole('button', { name: 'Save' }),
  ]);
  expect(row).toHaveStyle({ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end' });
  expect(row).not.toHaveStyle({ borderTopWidth: 1 });
  expect(card.children.at(-1)).toBe(row);
  expect(cancel).toHaveStyle({ alignSelf: 'flex-start' });
  expect(cancel).not.toHaveStyle({ flex: 1 });
  await fireEvent.press(cancel);
  expect(close).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByRole('button', { name: 'Save' }));
  expect(save).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByRole('button', { name: 'Close dialog' }));
  expect(close).toHaveBeenCalledTimes(2);
});

it('keeps the card inside the safe area of the screen', async () => {
  const view = await render(
    <SafeAreaInsetsContext.Provider value={{ top: 47, right: 0, bottom: 34, left: 0 }}>
      {dialog()}
    </SafeAreaInsetsContext.Provider>,
  );
  const card = view.getByRole('header', { name: 'Rename wallet' }).parent!;
  expect(card.parent).toHaveStyle({ paddingTop: 63, paddingBottom: 50, paddingLeft: 16, paddingRight: 16 });
});

it('scrolls its body inside the card', async () => {
  const view = await render(dialog());
  const body = view.getByText('Body copy').parent!.parent!;
  expect(body).toHaveStyle({ flexGrow: 0, flexShrink: 1 });
});

it('holds every way out while busy and shows the primary as loading', async () => {
  const close = jest.fn();
  const view = await render(
    dialog({ onClose: close, busy: true, dismissLabel: 'Dismiss request', confirmLoading: true }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Dismiss request' }));
  await fireEvent(view.getByTestId('modal-Rename wallet'), 'requestClose');
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  expect(view.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(view.getByRole('button', { name: 'Loading...' })).toBeDisabled();
  expect(close).not.toHaveBeenCalled();
});

it('leaves out the action row when a dialog has no actions', async () => {
  const view = await render(dialog({ showFooter: false, onConfirm: undefined }));
  expect(view.getByRole('header', { name: 'Rename wallet' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Cancel' })).toBeNull();
  expect(view.getByText('Body copy')).toBeTruthy();
});

import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { SignOutModal } from './SignOutModal';

afterEach(async () => {
  await cleanup();
});

it('cannot be dismissed from the backdrop, Android Back or Cancel while signing out', async () => {
  const close = jest.fn();
  const view = await render(<SignOutModal visible isLoading onConfirm={jest.fn()} onClose={close} />);
  await fireEvent.press(view.getByRole('button', { name: 'Close dialog' }));
  await fireEvent(view.getByTestId('modal-Sign Out'), 'requestClose');
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  expect(close).not.toHaveBeenCalled();
  expect(view.getByRole('button', { name: 'Loading...' })).toBeDisabled();
});

it('closes from the backdrop when it is not signing out', async () => {
  const close = jest.fn();
  const view = await render(<SignOutModal visible onConfirm={jest.fn()} onClose={close} />);
  await fireEvent.press(view.getByRole('button', { name: 'Close dialog' }));
  expect(close).toHaveBeenCalledTimes(1);
});

import React from 'react';
import { Text, View } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

afterEach(async () => {
  await cleanup();
});

describe.each([
  ['primary', PrimaryButton],
  ['secondary', SecondaryButton],
] as const)('%s button', (_, Component) => {
  it.each(['touch', 'accessibility'] as const)('activates once through %s', async (route) => {
    const press = jest.fn();
    const view = await render(<Component onPress={press}>Continue</Component>);
    const button = view.getByRole('button', { name: 'Continue' });

    if (route === 'touch') {
      await fireEvent.press(button);
    } else {
      await fireEvent(button, 'accessibilityTap');
    }

    expect(press).toHaveBeenCalledTimes(1);
  });

  it.each(['disabled', 'loading'] as const)('refuses touch and direct native activation while %s', async (state) => {
    const press = jest.fn();
    const view = await render(
      <Component onPress={press} disabled={state === 'disabled'} loading={state === 'loading'}>
        Continue
      </Component>,
    );
    const button = view.getByRole('button', { name: 'Continue' });
    expect(button).toBeDisabled();
    expect(button.props.accessibilityState.busy).toBe(state === 'loading');

    await fireEvent.press(button);
    await act(() => button.props.onAccessibilityTap());

    expect(press).not.toHaveBeenCalled();
  });
});

it('keeps a compound action named and refuses activation when its content becomes a loading spinner', async () => {
  const press = jest.fn();
  const content = (
    <View>
      <Text>Sign In</Text>
    </View>
  );
  const view = await render(
    <PrimaryButton onPress={press} accessibilityLabel="Sign In">
      {content}
    </PrimaryButton>,
  );
  await fireEvent(view.getByRole('button', { name: 'Sign In' }), 'accessibilityTap');
  expect(press).toHaveBeenCalledTimes(1);

  await view.rerender(
    <PrimaryButton onPress={press} accessibilityLabel="Sign In" loading>
      {content}
    </PrimaryButton>,
  );
  const button = view.getByRole('button', { name: 'Sign In', busy: true, disabled: true });
  expect(view.queryByText('Sign In')).toBeNull();
  await act(() => button.props.onAccessibilityTap());
  expect(press).toHaveBeenCalledTimes(1);
});

it('keeps the existing pressed opacity and restores the caller opacity after release', async () => {
  const press = jest.fn();
  const view = await render(
    <PrimaryButton onPress={press} style={{ opacity: 0.6 }}>
      Continue
    </PrimaryButton>,
  );
  const button = view.getByRole('button', { name: 'Continue' });
  expect(button).toHaveStyle({ opacity: 0.6, height: 48 });
  const event = { persist: jest.fn(), currentTarget: 1, nativeEvent: { timestamp: Date.now() } };

  await fireEvent(button, 'responderGrant', event);
  expect(button).toHaveStyle({ opacity: 0.7 });
  await fireEvent(button, 'responderRelease', event);
  await waitFor(() => expect(button).toHaveStyle({ opacity: 0.6 }));
  expect(press).toHaveBeenCalledTimes(1);
});

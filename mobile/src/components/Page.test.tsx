import React from 'react';
import { RefreshControl, StyleSheet, Text } from 'react-native';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { Action, Section } from './Ledger';
import { Page } from './Page';

afterEach(async () => {
  await cleanup();
});

it.each([
  ['with a lede and actions', 'Select an entry for its status and details.', true],
  ['with neither', undefined, false],
])('heads the page with its title as a header block %s, and the first card follows it', async (_, lede, acts) => {
  const filter = jest.fn();
  const view = await render(
    <Page title="Activity" lede={lede} actions={acts && <Action label="Filter" onPress={filter} />}>
      <Section title="Transfers">
        <Text>No activity yet.</Text>
      </Section>
    </Page>,
  );

  const title = view.getByRole('header', { name: 'Activity' });
  const header = title.parent!;
  const card = view.getByRole('header', { name: 'Transfers' }).parent!;
  if (lede) {
    const button = view.getByRole('button', { name: 'Filter' });
    expect(header.children).toEqual([title, view.getByText(lede), button.parent]);
    await fireEvent.press(button);
    expect(filter).toHaveBeenCalledTimes(1);
  } else {
    expect(header.children).toEqual([title]);
  }
  expect(header.parent!.children).toEqual([header, card]);
});

it('sets every page in one title style, one side padding and one gap before and between its cards', async () => {
  const view = await render(
    <Page testID="register-screen" title="Register">
      <Section title="Share classes">
        <Text>Your company has no share classes yet.</Text>
      </Section>
      <Section title="Register instructions">
        <Text>Staff verify and apply them.</Text>
      </Section>
    </Page>,
  );

  expect(view.getByRole('header', { name: 'Register' })).toHaveStyle({
    fontFamily: 'Newsreader_500Medium',
    fontSize: 36,
  });
  expect(StyleSheet.flatten(view.getByTestId('register-screen').props.contentContainerStyle)).toMatchObject({
    paddingHorizontal: 24,
    gap: 24,
  });
});

it('keeps the screen scrolling with its own pull to refresh and keyboard handling', async () => {
  const refresh = jest.fn();
  const view = await render(
    <Page
      testID="profile-scroll"
      title="Profile"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
    >
      <Text>Personal information</Text>
    </Page>,
  );

  const scroll = view.getByTestId('profile-scroll');
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  await scroll.props.refreshControl.props.onRefresh();
  expect(refresh).toHaveBeenCalledTimes(1);
});

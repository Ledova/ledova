import React from 'react';
import { Text, View } from 'react-native';
import { render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PAPER_THEME, useUserPreferences } from '@ledova/shared';
import { ThemeProvider, useAppTheme } from './ThemeContext';

jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: jest.fn(() => ({ data: { theme: 'dark' } })),
}));

function Sample() {
  const theme = useAppTheme();
  return (
    <View testID="paper" style={{ backgroundColor: theme.colors.surface.base }}>
      <Text style={{ color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular }}>Holdings</Text>
    </View>
  );
}

it('uses paper independently of old local and account dark-mode choices', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValue('dark');
  const view = await render(
    <ThemeProvider>
      <Sample />
    </ThemeProvider>,
  );
  expect(view.getByTestId('paper')).toHaveStyle({ backgroundColor: PAPER_THEME.surface.base });
  expect(view.getByText('Holdings')).toHaveStyle({
    color: PAPER_THEME.text.primary,
    fontFamily: 'InstrumentSans_400Regular',
  });
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(useUserPreferences).not.toHaveBeenCalled();
});

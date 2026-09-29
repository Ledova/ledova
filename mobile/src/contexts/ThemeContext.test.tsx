import React from 'react';
import { Text, View } from 'react-native';
import { render } from '@testing-library/react-native';
import { PAPER_THEME } from '@ledova/shared';
import { ThemeProvider, useAppTheme } from './ThemeContext';

function Sample() {
  const theme = useAppTheme();
  return (
    <View testID="paper" style={{ backgroundColor: theme.colors.surface.base }}>
      <Text style={{ color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular }}>Holdings</Text>
    </View>
  );
}

it('renders the paper palette in Instrument Sans', async () => {
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
});

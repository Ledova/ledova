// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import RadioGroupField from './RadioGroupField';

const OPTIONS = [
  { value: 'long_term', label: 'Long-term investment' },
  { value: 'other', label: 'Other' },
];

afterEach(() => {
  cleanup();
});

it('names the group by its question and each option by its own label', async () => {
  const onChange = vi.fn();
  render(
    <RadioGroupField
      label="What is your intended use of the platform?"
      value="long_term"
      options={OPTIONS}
      onChange={onChange}
    />,
  );

  expect(screen.getByRole('radiogroup', { name: 'What is your intended use of the platform?' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Long-term investment' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('radio', { name: 'Other' }).getAttribute('aria-checked')).toBe('false');

  await userEvent.click(screen.getByText('Other'));

  expect(onChange).toHaveBeenCalledWith('other');
});

it('links its error to the group so it is read with the question', () => {
  render(
    <RadioGroupField
      label="What is your intended use of the platform?"
      value="long_term"
      options={OPTIONS}
      error={['Choose how you will use Ledova.']}
      onChange={vi.fn()}
    />,
  );

  expect(
    screen.getByRole('radiogroup', {
      name: 'What is your intended use of the platform?',
      description: 'Choose how you will use Ledova.',
    }),
  ).toBeTruthy();
});

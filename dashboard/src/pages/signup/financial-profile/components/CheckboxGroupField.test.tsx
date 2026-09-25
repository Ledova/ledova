// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import CheckboxGroupField from './CheckboxGroupField';

const OPTIONS = [
  { value: 'employment', label: 'Employment income' },
  { value: 'savings', label: 'Savings' },
];

afterEach(() => {
  cleanup();
});

it('offers each source of funds as a named checkbox that the keyboard can tick', async () => {
  const onChange = vi.fn();
  render(
    <CheckboxGroupField
      label="What is your primary source of funds?"
      value={['savings']}
      options={OPTIONS}
      onChange={onChange}
    />,
  );

  expect(screen.getByRole('checkbox', { name: 'Savings' }).getAttribute('aria-checked')).toBe('true');
  const employment = screen.getByRole('checkbox', { name: 'Employment income' });
  expect(employment.getAttribute('aria-checked')).toBe('false');

  employment.focus();
  await userEvent.keyboard(' ');

  expect(onChange).toHaveBeenCalledWith(['savings', 'employment']);
});

it('unticks a source of funds when its label is clicked', async () => {
  const onChange = vi.fn();
  render(
    <CheckboxGroupField
      label="What is your primary source of funds?"
      value={['savings', 'employment']}
      options={OPTIONS}
      onChange={onChange}
    />,
  );

  await userEvent.click(screen.getByText('Savings'));

  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(['employment']);
});

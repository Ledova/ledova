export const AUTH_BUTTON_CLASS =
  'w-full bg-brand-mid hover:bg-brand disabled:bg-surface-disabled disabled:text-text-secondary ' +
  'disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg transition-colors shadow-lg ' +
  'shadow-brand-light/40 disabled:shadow-none dark:shadow-none focus:outline-none focus:ring-2 focus:ring-border-focus ' +
  'focus:ring-offset-2 focus:ring-offset-surface-base';

export const AUTH_INPUT_CLASS =
  'w-full bg-surface-tertiary border border-border rounded-lg pl-10 pr-3 py-3 text-text-primary ' +
  'placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-brand-mid focus:border-transparent ' +
  'transition-colors';

export const ERROR_BANNER_CLASS = 'bg-error-subtle border border-error-dark rounded-lg p-4';

export const authFieldBorder = (error: unknown, background = true, focus = 'focus:ring-border-focus') =>
  error
    ? background
      ? 'border-error bg-error-subtle focus:ring-error'
      : 'border-error focus:ring-error'
    : `border-border ${focus}`;

export const authFieldClass = (
  error: unknown,
  padding = 'px-3',
  background = true,
  focus = 'focus:ring-border-focus',
) =>
  `w-full bg-surface-tertiary border ${authFieldBorder(
    error,
    background,
    focus,
  )} rounded-lg ${padding} py-3 text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:border-transparent transition-colors`;

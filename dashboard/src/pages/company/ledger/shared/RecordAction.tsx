import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { ICON_SM } from '@components/iconSizes';

export function RecordAction({
  action,
  label,
  text,
  disabled = false,
  onClick,
}: {
  action: 'add' | 'edit' | 'remove';
  label: string;
  text?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const Icon = action === 'add' ? PlusIcon : action === 'edit' ? PencilSimpleIcon : TrashIcon;
  const tooltipId = useId();
  const interaction = useRef({ hovered: false, focused: false });
  const [tooltip, setTooltip] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const show = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    setTooltip({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)),
      ...(rect.top > 64 ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    });
  };
  useEffect(() => {
    if (!tooltip) return;
    const hide = () => setTooltip(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('keydown', escape);
    };
  }, [tooltip]);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-describedby={tooltip ? tooltipId : undefined}
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={(event) => {
          interaction.current.hovered = true;
          show(event.currentTarget);
        }}
        onMouseLeave={() => {
          interaction.current.hovered = false;
          if (!interaction.current.focused) setTooltip(null);
        }}
        onFocus={(event) => {
          interaction.current.focused = true;
          show(event.currentTarget);
        }}
        onBlur={() => {
          interaction.current.focused = false;
          if (!interaction.current.hovered) setTooltip(null);
        }}
        className={`inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-text-muted transition-colors hover:bg-surface-tertiary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-mid disabled:cursor-not-allowed disabled:opacity-50 ${text ? 'px-3' : 'w-10'}`}
      >
        <Icon size={ICON_SM} aria-hidden="true" />
        {text}
      </button>
      {tooltip &&
        createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            style={tooltip}
            className="pointer-events-none fixed z-50 w-max max-w-[min(15rem,calc(100vw-1rem))] rounded-md bg-text-primary px-2 py-1 text-xs text-surface-raised shadow-md"
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Field,
  Label,
} from '@headlessui/react';
import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react';
import { formatShareCount } from '@ledova/shared';
import { FIELD_BASE, LABEL } from '@components/fieldClass';
import { ICON_SM } from '@components/iconSizes';

export interface SearchChoice {
  value: string;
  label: string;
  detail?: string;
  unavailable?: string;
}

const SHOWN = 50;
const NONE: readonly SearchChoice[] = [];
const MOVES = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']);

const folded = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-AU');

function Choice({ choice }: { choice: SearchChoice }) {
  const detail = [choice.detail, choice.unavailable].filter(Boolean).join(' · ');
  return (
    <ComboboxOption
      value={choice.value}
      disabled={!!choice.unavailable}
      aria-label={detail ? `${choice.label} · ${detail}` : undefined}
      className="group flex cursor-default select-none items-start gap-2 px-3 py-2 data-[disabled]:opacity-60 data-[focus]:bg-surface-tertiary"
    >
      <CheckIcon size={ICON_SM} aria-hidden className="invisible mt-0.5 shrink-0 group-data-[selected]:visible" />
      <span className="min-w-0">
        <span className="block break-words text-sm text-text-primary">{choice.label}</span>
        {detail && <span className="block break-words text-xs text-text-muted">{detail}</span>}
      </span>
    </ComboboxOption>
  );
}

export function SearchSelect({
  label,
  choices,
  value,
  onChange,
  first = NONE,
  placeholder = 'Type to search',
  disabled = false,
  noun = ['option', 'options'],
}: {
  label: string;
  choices: readonly SearchChoice[];
  value: string;
  onChange: (value: string) => void;
  first?: readonly SearchChoice[];
  placeholder?: string;
  disabled?: boolean;
  noun?: readonly [string, string];
}) {
  const [query, setQuery] = useState('');
  const moved = useRef(false);
  const known = useMemo(
    () => new Map([...first, ...choices].map((choice) => [choice.value, choice.label])),
    [first, choices],
  );
  const searchable = useMemo(
    () => choices.map((choice) => ({ choice, text: folded(`${choice.label} ${choice.detail ?? ''}`) })),
    [choices],
  );
  const words = folded(query).split(/\s+/).filter(Boolean);
  const typed = words.length > 0;
  const found = typed
    ? searchable.filter(({ text }) => words.every((word) => text.includes(word))).map(({ choice }) => choice)
    : choices;
  const matched = typed && found.some((choice) => !choice.unavailable);
  const counted = (count: number) => `${formatShareCount(String(count))} ${count === 1 ? noun[0] : noun[1]}`;
  const searched = query.trim();
  const status = !typed
    ? ''
    : found.length
      ? `${counted(found.length)} ${found.length === 1 ? 'matches' : 'match'} “${searched}”.`
      : `No ${noun[1]} match “${searched}”.`;
  const more =
    found.length > SHOWN ? `Showing the first ${SHOWN} of ${counted(found.length)}. Type more to narrow the list.` : '';
  const keepChoice = (open: boolean) => (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (MOVES.has(event.key)) moved.current = true;
    else if (open && (event.key === 'Enter' || event.key === 'Tab') && !moved.current && !matched) {
      event.stopPropagation();
      if (event.key === 'Enter') event.preventDefault();
    }
  };
  return (
    <Field className={LABEL} disabled={disabled}>
      <Combobox
        value={value}
        onChange={(next) => next && onChange(next)}
        onClose={() => {
          setQuery('');
          moved.current = false;
        }}
        immediate
      >
        {({ open }) => (
          <>
            <Label>{label}</Label>
            <div className="relative mt-1" onKeyDownCapture={keepChoice(open)}>
              <ComboboxInput
                className={`${FIELD_BASE} pr-9`}
                autoComplete="off"
                data-1p-ignore
                placeholder={placeholder}
                displayValue={(current: string) => known.get(current) ?? ''}
                onChange={(event) => {
                  moved.current = false;
                  setQuery(event.target.value);
                }}
                onFocus={(event) => event.currentTarget.select()}
                onMouseUp={(event) => {
                  if (query) return;
                  event.preventDefault();
                  event.currentTarget.select();
                }}
              />
              <ComboboxButton className="absolute inset-y-0 right-0 flex items-center px-2.5 text-text-muted transition-colors hover:text-text-primary">
                <CaretDownIcon size={ICON_SM} aria-hidden />
              </ComboboxButton>
            </div>
            <ComboboxOptions
              anchor="bottom start"
              modal={false}
              className="z-50 max-h-72 w-[var(--input-width)] overflow-y-auto rounded-lg border border-border bg-surface-raised py-1 shadow-lg [--anchor-gap:4px] empty:invisible"
            >
              {!typed && first.map((choice) => <Choice key={choice.value} choice={choice} />)}
              {found.slice(0, SHOWN).map((choice) => (
                <Choice key={choice.value} choice={choice} />
              ))}
              {typed && !matched && first.map((choice) => <Choice key={choice.value} choice={choice} />)}
              {typed && found.length === 0 && (
                <p aria-hidden className="px-3 py-2 text-sm text-text-muted">
                  {status}
                </p>
              )}
              {more && (
                <p aria-hidden className="px-3 py-2 text-xs text-text-muted">
                  {more}
                </p>
              )}
            </ComboboxOptions>
            <p role="status" className="sr-only">
              {open ? [status, more].filter(Boolean).join(' ') : ''}
            </p>
          </>
        )}
      </Combobox>
    </Field>
  );
}

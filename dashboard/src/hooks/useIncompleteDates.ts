import { useState } from 'react';

export function useIncompleteDates<K extends string>() {
  const [incomplete, setIncomplete] = useState<Partial<Record<K, boolean>>>({});
  return {
    incomplete,
    watch: (key: K) => {
      const update = (event: { currentTarget: HTMLInputElement }) => {
        const bad = event.currentTarget.validity.badInput;
        setIncomplete((current) => (!!current[key] === bad ? current : { ...current, [key]: bad }));
      };
      return { onKeyUp: update, onBlur: update, onInput: update };
    },
  };
}

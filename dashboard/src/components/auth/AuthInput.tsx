import { Input, type InputProps } from '@headlessui/react';
import type { Ref } from 'react';
import { AUTH_INPUT_CLASS } from './classes';

export function AuthInput({ className = AUTH_INPUT_CLASS, ...props }: InputProps & { ref?: Ref<HTMLInputElement> }) {
  return <Input {...props} className={className} />;
}

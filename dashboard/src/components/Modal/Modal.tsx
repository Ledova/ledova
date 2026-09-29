import { Fragment, type ReactNode } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { PageAction } from '@components/Page';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  showFooter?: boolean;
  showCancelButton?: boolean;
  cancelLabel?: string;
  confirmLabel?: string;
  onCancel?: () => void;
  onConfirm?: () => void;
  confirmDisabled?: boolean;
  confirmLoading?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  fullHeight?: boolean;
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
};

export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  showFooter = false,
  showCancelButton = true,
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  onCancel,
  onConfirm,
  confirmDisabled = false,
  confirmLoading = false,
  size = 'md',
  fullHeight = false,
}: ModalProps) {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-100"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel
                className={`flex w-full ${sizeClasses[size]} transform flex-col gap-4 rounded-xl border border-border bg-surface-raised p-4 shadow-2xl transition-all sm:p-5`}
              >
                <DialogTitle className="break-words font-display text-xl tracking-[-0.01em] text-text-primary">
                  {title}
                </DialogTitle>

                <div className={`-m-1 overflow-y-auto p-1 ${fullHeight ? '' : 'max-h-[70vh]'}`}>{children}</div>

                {showFooter && (
                  <ModalActions>
                    {showCancelButton && (
                      <PageAction label={cancelLabel} onClick={onCancel ?? onClose} disabled={confirmLoading} />
                    )}
                    {onConfirm && (
                      <PageAction
                        label={confirmLoading ? 'Loading...' : confirmLabel}
                        primary
                        onClick={onConfirm}
                        disabled={confirmDisabled || confirmLoading}
                      />
                    )}
                  </ModalActions>
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

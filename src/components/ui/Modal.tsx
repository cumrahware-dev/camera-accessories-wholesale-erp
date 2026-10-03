'use client';

import * as Dialog from '@radix-ui/react-dialog';
import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
  '3xl': 'max-w-6xl',
};

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-1.5rem)] max-h-[calc(100dvh-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-surface shadow-popover focus:outline-none animate-slide-up',
            sizeClasses[size]
          )}
        >
          {(title || description) && (
            <div className="shrink-0 flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                {title && <Dialog.Title className="text-sm font-semibold text-ink">{title}</Dialog.Title>}
                {description && (
                  <Dialog.Description className="text-xs text-muted mt-1">{description}</Dialog.Description>
                )}
              </div>
              <Dialog.Close asChild>
                <button className="flex h-11 w-11 items-center justify-center -mr-2.5 -mt-2.5 shrink-0 text-muted hover:text-ink rounded-full hover:bg-surface-muted" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
          )}
          <div className="flex-1 min-h-0 px-4 sm:px-5 py-4 overflow-y-auto overscroll-contain">{children}</div>
          {footer && <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 sm:px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] max-sm:[&>*]:flex-1 max-sm:[&>*]:min-w-[120px]">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg';
}

const drawerWidthClasses = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-xl' };

export function Drawer({ open, onClose, title, description, children, footer, width = 'md' }: DrawerProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed right-0 top-0 z-50 h-full h-[100dvh] w-full border-l border-line bg-surface shadow-popover flex flex-col focus:outline-none',
            drawerWidthClasses[width]
          )}
        >
          {(title || description) && (
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 shrink-0">
              <div>
                {title && <Dialog.Title className="text-sm font-semibold text-ink">{title}</Dialog.Title>}
                {description && (
                  <Dialog.Description className="text-xs text-muted mt-1">{description}</Dialog.Description>
                )}
              </div>
              <Dialog.Close asChild>
                <button className="flex h-11 w-11 items-center justify-center -mr-2.5 -mt-2.5 shrink-0 text-muted hover:text-ink rounded-full hover:bg-surface-muted" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4">{children}</div>
          {footer && <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  );
}

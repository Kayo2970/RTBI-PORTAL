'use client';

import { ToastViewport } from '@/components/ui/toast';
import { ConfirmHost } from '@/components/ui/confirm-dialog';

/** App-wide feedback hosts: toasts + promise-based confirm dialog. Mounted once in the root layout. */
export function FeedbackProviders() {
  return (
    <>
      <ToastViewport />
      <ConfirmHost />
    </>
  );
}

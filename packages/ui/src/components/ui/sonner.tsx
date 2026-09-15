import type * as React from 'react';
import { Toaster as SonnerToaster, toast } from 'sonner';

/**
 * Notifications (brief §9): stacked, auto-dismissing toasts. The operator must
 * never have to acknowledge one to carry on weighing, so nothing here blocks —
 * no modal confirmations, no `closeButton`-only toasts, and a short duration.
 */
function Toaster(props: React.ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      duration={3500}
      toastOptions={{
        classNames: {
          toast: 'rounded-md border shadow-md',
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };

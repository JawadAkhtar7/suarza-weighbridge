import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@suarza/ui';
import { App } from './App.js';
import { PrintReceiptPage, parsePrintRequest } from './pages/print-receipt-page.js';
import { ReceiptSettingsProvider } from './components/receipt-settings-provider.js';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Everything this app reads comes from a service on the same machine.
      // Refetching on focus would fire a burst every time the operator clicks
      // back into the window, and buys nothing over the existing polling.
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

/**
 * One route, checked here rather than with a router: `/print/:slip` is a
 * separate tab showing one receipt, and pulling in a routing library for a
 * single leaf page would cost more than it explains.
 */
const printRequest = parsePrintRequest(new URL(window.location.href));

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ReceiptSettingsProvider>
        {printRequest ? <PrintReceiptPage request={printRequest} /> : <App />}
      </ReceiptSettingsProvider>
      {/* Bottom-left is the only corner that stays clear in both modes: the
          live-weight panel sits top-left, the mode switch top-right, and the
          action buttons bottom-right. A stack of toasts must never cover the
          scale reading or the button the operator is reaching for. */}
      <Toaster position="bottom-left" />
    </QueryClientProvider>
  </StrictMode>,
);

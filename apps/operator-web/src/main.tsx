import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@suarza/ui';
import { App } from './App.js';
import { PrintReceiptPage, parsePrintRequest } from './pages/print-receipt-page.js';
import { MeasurePicturesPage, MEASURE_PICTURES_PATH } from './pages/measure-pictures-page.js';
import { ReceiptSettingsProvider } from './components/receipt-settings-provider.js';
import { ShiftProvider, useShift } from './components/shift-provider.js';
import { ShiftLogin } from './components/shift-login.js';
import './index.css';
/* The slip's four families, self-hosted. The weighbridge PC can be offline for
   days and a slip set in Arial is a slip the client rejects. */
import '@suarza/ui/slip-fonts.css';

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
/* The picture-box measuring sheet, also a tab of its own (Settings -> Print). */
const measuring = window.location.pathname === MEASURE_PICTURES_PATH;

/**
 * The weighing screen, once somebody has started a shift.
 *
 * No session, no screen — there is no bridge state that lets somebody past
 * this. A bridge holding no accounts is not an open one: the sign-in screen
 * says it has none and offers to fetch them.
 *
 * Only this screen is gated. The print tab and the measuring sheet are
 * leaves opened BY the weighing screen, in a window that already belongs to
 * a signed-in operator, and a sign-in box appearing in the print tab with a
 * driver waiting for his slip would be an obstacle with nothing behind it.
 */
function WeighingScreen() {
  const { session, loading } = useShift();
  if (loading) return null;
  if (!session) return <ShiftLogin />;
  return <App />;
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ReceiptSettingsProvider>
        {printRequest ? (
          <PrintReceiptPage request={printRequest} />
        ) : measuring ? (
          <MeasurePicturesPage />
        ) : (
          <ShiftProvider>
            <WeighingScreen />
          </ShiftProvider>
        )}
      </ReceiptSettingsProvider>
      {/* Bottom-left is the only corner that stays clear in both modes: the
          live-weight panel sits top-left, the mode switch top-right, and the
          action buttons bottom-right. A stack of toasts must never cover the
          scale reading or the button the operator is reaching for. */}
      <Toaster position="bottom-left" />
    </QueryClientProvider>
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@suarza/ui';
import { App } from './App.js';
import { AuthProvider } from './components/auth-provider.js';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Managers refresh to get new data (brief §4) — a deliberate decision,
      // so nothing here polls or streams. Figures are a few seconds' work to
      // fetch and are always read straight from the database.
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>,
);

/**
 * Manager dashboard shell.
 *
 * Role-aware (brief §10): an operator's token is refused by the API, so the
 * shell says so plainly rather than showing an empty dashboard that errors on
 * every request.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Button } from '@suarza/ui';
import { roleCan } from '@suarza/shared';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from './hooks/use-auth.js';
import { AppShell } from './components/app-shell.js';
import { LoginPage } from './pages/login-page.js';
import { Dashboard } from './pages/dashboard.js';
import { LedgerPage } from './pages/ledger-page.js';
import { LedgerCustomerPage } from './pages/ledger-customer-page.js';
import { CustomersPage } from './pages/customers-page.js';
import { VehicleTypesPage } from './pages/vehicle-types-page.js';

function NoAccess() {
  const { user, signOut } = useAuth();

  return (
    <div className="flex min-h-full items-center bg-muted/40 px-4 py-10">
      <div className="mx-auto max-w-md rounded-lg border bg-background p-8 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="mt-3 text-lg font-semibold">No access to the dashboard</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The <span className="font-medium">{user?.role}</span> role is for the weighbridge screens.
          Ask an administrator for a manager account.
        </p>
        <Button variant="outline" className="mt-5" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

export function App() {
  const { user } = useAuth();

  if (!user) return <LoginPage />;
  if (!roleCan(user.role, 'dashboard')) return <NoAccess />;

  const canSeeLedger = roleCan(user.role, 'ledger');

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          {/* Guarded in the UI as well as the API: a role without the ledger
              capability should not be shown a page every call 403s on. */}
          {canSeeLedger && <Route path="ledger" element={<LedgerPage />} />}
          {canSeeLedger && <Route path="ledger/:customerId" element={<LedgerCustomerPage />} />}
          {canSeeLedger && <Route path="customers" element={<CustomersPage />} />}
          {canSeeLedger && <Route path="vehicle-types" element={<VehicleTypesPage />} />}
          {/* Anything else is a mistyped or stale URL; the dashboard is the
              safe landing place. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

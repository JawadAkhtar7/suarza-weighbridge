/**
 * Manager dashboard shell.
 *
 * Role-aware (brief §10): an operator's token is refused by the API, so the
 * shell says so plainly rather than showing an empty dashboard that errors on
 * every request.
 */

import { Badge, Button, cn } from '@suarza/ui';
import { roleCan } from '@suarza/shared';
import { LogOut, ShieldAlert } from 'lucide-react';
import { useAuth } from './hooks/use-auth.js';
import { LoginPage } from './pages/login-page.js';
import { Dashboard } from './pages/dashboard.js';

export function App() {
  const { user, signOut } = useAuth();

  if (!user) return <LoginPage />;

  const canSeeDashboard = roleCan(user.role, 'dashboard');

  return (
    <div className="min-h-full bg-muted/40">
      <header className="sticky top-0 z-20 border-b-2 border-b-primary/20 bg-background shadow-sm">
        <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
          {/* The logo is the whole identity here — `mr-auto` sits on it now that
              the wording beside it is gone, so the controls stay right. */}
          <img
            src="/logo.png"
            srcSet="/logo.png 1x, /logo@3x.png 3x"
            alt="Suarza International"
            className="mr-auto h-12 w-auto shrink-0"
          />

          <div className="flex items-center gap-3">
            {/* Who is signed in is carried by the role badge alone. */}
            <Badge variant="secondary" className="shrink-0">
              {user.role}
            </Badge>
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className={cn('mx-auto max-w-[100rem] px-4 py-6 sm:px-6')}>
        {canSeeDashboard ? (
          <Dashboard />
        ) : (
          <div className="mx-auto max-w-md rounded-lg border bg-background p-8 text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="mt-3 text-lg font-semibold">No access to the dashboard</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The <span className="font-medium">{user.role}</span> role is for the weighbridge
              screens. Ask an administrator for a manager account.
            </p>
            <Button variant="outline" className="mt-5" onClick={signOut}>
              Sign out
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

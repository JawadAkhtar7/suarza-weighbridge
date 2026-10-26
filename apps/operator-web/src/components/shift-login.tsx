/**
 * Starting a shift.
 *
 * One box, filling the screen, with nothing else on it: this is the first
 * thing an operator sees at six in the morning, often one-handed with a
 * truck already on the weighbridge. The username is remembered between
 * shifts because the same two people use this machine every day.
 *
 * It signs in against the copy of the accounts held on this PC — see the
 * agent's operator-auth route — so a morning with no internet is a morning
 * that still weighs trucks.
 */

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label, toast } from '@suarza/ui';
import { CloudDownload, LogIn } from 'lucide-react';
import { agentApi, AgentApiError } from '../lib/api.js';
import { useShift } from './shift-provider.js';

const LAST_USER_KEY = 'suarza.shift.username';

function readLastUsername(): string {
  try {
    return window.localStorage.getItem(LAST_USER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function ShiftLogin() {
  const { signIn } = useShift();
  const queryClient = useQueryClient();
  const [fetching, setFetching] = React.useState(false);

  /**
   * Fetch the accounts, from the sign-in screen.
   *
   * The only way past this door for a bridge that has none — and it has to
   * be here, because the Settings screen it would otherwise live behind is
   * on the other side of the door.
   */
  const fetchAccounts = async () => {
    setFetching(true);
    try {
      const outcome = await agentApi.syncOperators();
      await queryClient.invalidateQueries({ queryKey: ['operator-auth'] });
      toast.success(
        outcome.total > 0
          ? `${outcome.total} account(s) fetched — sign in now`
          : 'The manager has set up nobody yet',
      );
    } catch (error) {
      toast.error('Could not fetch the accounts', {
        description:
          error instanceof AgentApiError
            ? error.message
            : 'Check this PC\u2019s internet connection.',
      });
    } finally {
      setFetching(false);
    }
  };
  const [username, setUsername] = React.useState(readLastUsername);
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    try {
      const { session } = await agentApi.startShift(username.trim(), password);
      try {
        window.localStorage.setItem(LAST_USER_KEY, session.username);
      } catch {
        // Only a convenience; a browser that refuses storage still signs in.
      }
      setPassword('');
      signIn(session);
      toast.success(`Shift started — ${session.name}`);
    } catch (error) {
      const message =
        error instanceof AgentApiError ? error.message : 'Could not start the shift. Try again.';
      toast.error('Not signed in', { description: message });
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-muted/30 px-4 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-xl border bg-background p-8 shadow-sm"
      >
        <div className="space-y-3 text-center">
          <img
            src="/logo.png"
            srcSet="/logo.png 1x, /logo@3x.png 3x"
            alt="Suarza International"
            className="mx-auto h-14 w-auto"
          />
          <h1 className="text-lg font-semibold">Login</h1>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="shift-username" className="text-xs font-normal">
              Username
            </Label>
            <Input
              id="shift-username"
              autoFocus={username === ''}
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="shift-password" className="text-xs font-normal">
              Password
            </Label>
            <Input
              id="shift-password"
              type="password"
              autoFocus={username !== ''}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        <Button
          type="submit"
          variant="brand"
          className="w-full"
          disabled={busy || username.trim() === '' || password === ''}
        >
          <LogIn className="h-4 w-4" />
          {busy ? 'Starting…' : 'Start shift'}
        </Button>

        {/*
         * The one thing this screen can do besides sign somebody in.
         *
         * It has to be here rather than in Settings, because Settings is on
         * the other side of this door: a bridge that has never fetched the
         * accounts has nobody to sign in as, and an operator whose password
         * the manager changed an hour ago has a stale copy of it. Both are
         * answered by the same press.
         */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={() => void fetchAccounts()}
          disabled={fetching}
        >
          <CloudDownload className="h-4 w-4" />
          {fetching ? 'Syncing…' : 'Sync accounts'}
        </Button>
      </form>
    </div>
  );
}

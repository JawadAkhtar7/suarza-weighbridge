/**
 * Holds the manager's session.
 *
 * The token lives in sessionStorage, which is scoped to the one tab and is
 * thrown away when that tab closes. So a refresh — or following a link, or a
 * dashboard left open all afternoon — keeps the manager signed in, and
 * closing the tab signs them out: the next person to open the dashboard on
 * that PC has to log in.
 *
 * NOT localStorage, which is where this used to be. That is shared by every
 * tab and survives the browser being closed and the machine being restarted,
 * so a token sat in it until it expired twelve hours later, whether or not
 * anybody was still meant to be using it.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser } from '@suarza/shared';
import { api, setAuthToken } from '../lib/api.js';
import { AuthContext } from '../hooks/use-auth.js';

/* The same key in both storages: only the storage changed, so this is also
   the key a session from before this change is sitting under. */
const STORAGE_KEY = 'suarza.manager.session.v1';

interface StoredSession {
  token: string;
  user: AuthUser;
  expires_at: string;
}

function loadSession(): StoredSession | null {
  /*
   * Anything left in localStorage by a build from before this change is a
   * token that would otherwise sit on the machine until it expired. Clearing
   * it here means the move to per-tab sessions actually signs those people
   * out, rather than merely stopping new sessions being stored that way.
   */
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A browser that refuses storage has nothing to clear.
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredSession;
    // An expired token would only fail on the first request; better to start
    // signed out than to show a dashboard that immediately errors.
    if (new Date(session.expires_at).getTime() <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Kept in sync with the api module so every request carries the token.
  useEffect(() => {
    setAuthToken(session?.token ?? null);
  }, [session]);

  const signIn = useCallback(async (username: string, password: string) => {
    setIsSigningIn(true);
    try {
      const response = await api.login(username, password);
      const next: StoredSession = {
        token: response.token,
        user: response.user,
        expires_at: response.expires_at,
      };
      setSession(next);
      setAuthToken(next.token);
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private browsing — the session still works until this tab reloads.
      }
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    setAuthToken(null);
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clean up.
    }
  }, []);

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      token: session?.token ?? null,
      signIn,
      signOut,
      isSigningIn,
    }),
    [session, signIn, signOut, isSigningIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Holds the manager's session.
 *
 * The token lives in localStorage so a refresh doesn't sign them out — the
 * dashboard is read-only and the token is short-lived (12h by default), which
 * is the trade the brief's simple-auth design implies (§10).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser } from '@suarza/shared';
import { api, setAuthToken } from '../lib/api.js';
import { AuthContext } from '../hooks/use-auth.js';

const STORAGE_KEY = 'suarza.manager.session.v1';

interface StoredSession {
  token: string;
  user: AuthUser;
  expires_at: string;
}

function loadSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private browsing — the session still works for this tab.
      }
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    setAuthToken(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
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

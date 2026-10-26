/**
 * The shift: who is at the window, from when, and how they leave.
 *
 * The session lives on the weighbridge PC — the agent holds it — and this
 * keeps only the token, so a refresh, a crash or a Windows update does not
 * end somebody's shift at eleven at night. The token is in localStorage for
 * the same reason, and it is worth nothing anywhere else: it opens one
 * screen, on one machine, over loopback.
 *
 * NOBODY GETS PAST WITHOUT SIGNING IN. A bridge that has never pulled the
 * operator list down used to let everybody through, so that a new install
 * could still weigh a truck — but that meant an unsynced weighbridge was an
 * open one, which is not what "operators sign in" can be allowed to mean.
 *
 * The way out for a bridge with no accounts is to fetch them, not to walk
 * past the door: the sign-in screen carries the button that does it.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OperatorSession, ShiftCashMovement } from '@suarza/shared';
import { agentApi, setShiftToken } from '../lib/api.js';

const TOKEN_KEY = 'suarza.shift.token';

/** localStorage throws in a locked-down browser; a shift is not worth a blank screen. */
function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // A browser that refuses storage still works; the shift just ends with
    // the tab.
  }
}

export interface ShiftState {
  /** Null when nobody is signed in. The weighing screen is then not shown. */
  session: OperatorSession | null;
  loading: boolean;
  signIn: (session: OperatorSession) => void;
  /** With the closing handover, when the operator filled the form in. */
  endShift: (cash?: ShiftCashMovement) => Promise<void>;
}

const ShiftContext = React.createContext<ShiftState | null>(null);

export function ShiftProvider({ children }: { children: React.ReactNode }) {
  /* Set before the first request goes out, not in an effect: a token applied
     one render late is a render's worth of calls made anonymously. */
  const [token, setToken] = React.useState(() => {
    const stored = readToken();
    setShiftToken(stored);
    return stored;
  });

  const auth = useQuery({
    queryKey: ['operator-auth', token],
    queryFn: agentApi.operatorAuth,
    // The agent is on this machine; asking again costs nothing and catches a
    // shift ended from another tab.
    refetchInterval: 60_000,
    retry: false,
  });

  const signIn = React.useCallback((session: OperatorSession) => {
    setShiftToken(session.token, session.username);
    writeToken(session.token);
    setToken(session.token);
  }, []);

  const forget = React.useCallback(() => {
    setShiftToken(null);
    writeToken(null);
    setToken(null);
  }, []);

  const endShift = React.useCallback(
    async (cash?: ShiftCashMovement) => {
      try {
        await agentApi.endShift(cash);
      } finally {
        /* Forgotten here whatever the agent said. A token it does not know is
         not a shift, and leaving the operator signed in because the request
         failed would be the one outcome nobody wants at the end of a day. */
        forget();
      }
    },
    [forget],
  );

  /* An unknown or expired token: the agent says nobody is signed in while we
     still hold one. Drop it, or every call carries a token that means
     nothing and the sign-in screen never settles. */
  const session = auth.data?.session ?? null;

  /* The agent is the one that knows whose shift this is — after a reload the
     token comes back from storage with no name attached, and the records
     saved before this answered would otherwise be stamped with the fallback
     username rather than the person at the window. */
  React.useEffect(() => {
    if (session) setShiftToken(session.token, session.username);
  }, [session]);

  React.useEffect(() => {
    if (token && auth.isSuccess && !session) forget();
  }, [token, auth.isSuccess, session, forget]);

  const value = React.useMemo<ShiftState>(
    () => ({
      session,
      loading: auth.isLoading,
      signIn,
      endShift,
    }),
    [session, auth.isLoading, signIn, endShift],
  );

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>;
}

export function useShift(): ShiftState {
  const value = React.useContext(ShiftContext);
  if (!value) throw new Error('useShift must be used inside a ShiftProvider');
  return value;
}

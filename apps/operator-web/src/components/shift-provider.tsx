/**
 * The shift: who is at the window, from when, and how they leave.
 *
 * The session lives on the weighbridge PC — the agent holds it — and this
 * keeps only the token, so a refresh, a crash or a Windows update does not
 * end somebody's shift at eleven at night. The token is in localStorage for
 * the same reason, and it is worth nothing anywhere else: it opens one
 * screen, on one machine, over loopback.
 *
 * A BRIDGE WITH NO ACCOUNTS LETS EVERYBODY IN. That is deliberate. A yard
 * whose agent has never pulled the operator list down — a new install, a
 * bridge whose cloud is not configured — must still be able to weigh a
 * truck; locking the screen until a manager can be reached would be a worse
 * failure than no sign-in at all.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OperatorSession } from '@suarza/shared';
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
  /** Null when nobody is signed in, or when this bridge asks nobody to. */
  session: OperatorSession | null;
  /** False on a bridge with no operator accounts: the screen is open.  */
  required: boolean;
  loading: boolean;
  signIn: (session: OperatorSession) => void;
  endShift: () => Promise<void>;
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

  const endShift = React.useCallback(async () => {
    try {
      await agentApi.endShift();
    } finally {
      /* Forgotten here whatever the agent said. A token it does not know is
         not a shift, and leaving the operator signed in because the request
         failed would be the one outcome nobody wants at the end of a day. */
      forget();
    }
  }, [forget]);

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
      /* On a bridge the screen cannot reach, nothing is required — the error
         belongs to the weighing screen, which says it far better than a
         sign-in box refusing to let anybody past. */
      required: auth.data?.required ?? false,
      loading: auth.isLoading,
      signIn,
      endShift,
    }),
    [session, auth.data?.required, auth.isLoading, signIn, endShift],
  );

  return <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>;
}

export function useShift(): ShiftState {
  const value = React.useContext(ShiftContext);
  if (!value) throw new Error('useShift must be used inside a ShiftProvider');
  return value;
}

/** Session state (brief §10). JWT issued by the cloud API, held per browser. */

import { createContext, useContext } from 'react';
import type { AuthUser } from '@suarza/shared';

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  isSigningIn: boolean;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

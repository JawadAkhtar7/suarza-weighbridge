/** Sign-in (brief §10). No registration — accounts are provisioned, not created. */

import { useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@suarza/ui';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/use-auth.js';
import { ApiError } from '../lib/api.js';

export function LoginPage() {
  const { signIn, isSigningIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await signIn(username, password);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not sign in. Please try again.',
      );
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <img
            src="/logo.png"
            srcSet="/logo.png 1x, /logo@3x.png 3x"
            alt="Suarza International"
            className="h-14 w-auto"
          />
          <p className="text-sm text-muted-foreground">Weighbridge — Manager dashboard</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Sign in</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              {error && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" size="lg" disabled={isSigningIn}>
                {isSigningIn && <Loader2 className="animate-spin" />}
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

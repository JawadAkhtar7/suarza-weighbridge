/**
 * The people who may sign in at the weighbridge.
 *
 * A plain list: a name, a username, a password and whether they are an
 * administrator. Add as many as the yard has people, edit any of them,
 * remove the ones who have left.
 *
 * IT WAS A ROSTER — two shifts and an administrator, one person in each,
 * with the shift hours configurable underneath. The yard turned out to have
 * more people than slots, and tying "who may sign in" to "which hours they
 * work" meant neither question could be answered on its own. Hours are read
 * off the clock now (a weighing records when it happened), so this screen
 * answers only the first.
 *
 * These are NOT dashboard logins: they open the weighing screen on the PC in
 * the yard. The bridge keeps its own copy of them, which is what lets a
 * shift start at six in the morning with the internet down.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@suarza/ui';
import { OPERATOR_ROLE_LABELS, formatDatePkt, type Operator } from '@suarza/shared';
import {
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../hooks/use-auth.js';

/** The form's state: what the dialog is editing, or null when it is shut. */
interface Draft {
  id?: string;
  name: string;
  username: string;
  password: string;
  isAdmin: boolean;
}

const blankDraft = (): Draft => ({ name: '', username: '', password: '', isAdmin: false });

const draftFrom = (person: Operator): Draft => ({
  id: person.id,
  name: person.name,
  username: person.username ?? '',
  password: '',
  isAdmin: person.role === 'ADMIN',
});

export function OperatorsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<Draft | null>(null);
  /** Whether the password box shows what is in it. Off every time it opens. */
  const [showPassword, setShowPassword] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<Operator | null>(null);

  const roster = useQuery({ queryKey: ['roster'], queryFn: api.roster });
  const people = roster.data?.operators ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['roster'] });

  const save = useMutation({
    mutationFn: (values: Draft) =>
      api.saveOperator({
        ...(values.id ? { id: values.id } : {}),
        name: values.name.trim(),
        username: values.username.trim().toLowerCase(),
        /* Omitted rather than empty: an untouched password box means "leave
           the one you have", and sending '' would read as a change. */
        ...(values.password ? { password: values.password } : {}),
        role: values.isAdmin ? 'ADMIN' : 'OPERATOR',
      }),
    onSuccess: (saved) => {
      void refresh();
      setDraft(null);
      toast.success(`${saved.name} saved`, {
        description: saved.has_password
          ? 'They can sign in at the weighbridge once it syncs.'
          : 'No password set — they cannot sign in yet.',
      });
    },
    onError: (error) =>
      toast.error('Could not save', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  const remove = useMutation({
    mutationFn: (person: Operator) => api.removeOperator(person.id),
    onSuccess: () => {
      void refresh();
      setConfirmRemove(null);
      toast.success('Removed');
    },
    onError: (error) =>
      toast.error('Could not remove', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  const editing = Boolean(draft?.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Operators</h1>
          <p className="text-sm text-muted-foreground">
            Who may sign in at the weighbridge, and who may change how it is set up.
          </p>
        </div>

        <Button
          variant="brand"
          disabled={!canEdit}
          onClick={() => {
            setShowPassword(false);
            setDraft(blankDraft());
          }}
        >
          <UserPlus className="h-4 w-4" />
          Add person
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="text-right">&nbsp;</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {roster.isLoading ? (
                Array.from({ length: 3 }, (_, index) => (
                  <TableRow key={index}>
                    {Array.from({ length: 5 }, (_, cell) => (
                      <TableCell key={cell}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : people.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    Nobody yet. Add the people who work the bridge.
                  </TableCell>
                </TableRow>
              ) : (
                people.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                          aria-hidden
                        >
                          <UserRound className="h-4 w-4" />
                        </span>
                        <span className="font-medium">{person.name}</span>
                      </div>
                    </TableCell>

                    <TableCell className="tabular text-muted-foreground">
                      {person.username ?? '—'}
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          person.role === 'ADMIN' ? 'gap-1.5 bg-primary/10 text-primary' : 'gap-1.5'
                        }
                      >
                        {person.role === 'ADMIN' && <ShieldCheck className="h-3.5 w-3.5" />}
                        {OPERATOR_ROLE_LABELS[person.role]}
                      </Badge>
                      {!person.has_password && (
                        <span className="ml-2 text-xs text-muted-foreground">no password</span>
                      )}
                    </TableCell>

                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDatePkt(person.created_at)}
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canEdit}
                          onClick={() => {
                            setShowPassword(false);
                            setDraft(draftFrom(person));
                          }}
                          aria-label={`Edit ${person.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={!canEdit}
                          onClick={() => setConfirmRemove(person)}
                          aria-label={`Remove ${person.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          Only an administrator can change who may sign in.
        </p>
      )}

      {/* Add and edit are one dialog: they differ in whether a password is
          required, and two dialogs would be two copies of the same four
          fields. */}
      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit person' : 'Add person'}</DialogTitle>
            <DialogDescription>
              They sign in with this at the weighbridge, not on this dashboard.
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="person-name" className="text-xs font-normal">
                  Name
                </Label>
                <Input
                  id="person-name"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Imran Shah"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="person-username" className="text-xs font-normal">
                  Username
                </Label>
                <Input
                  id="person-username"
                  autoComplete="off"
                  value={draft.username}
                  onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                  placeholder="imran"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="person-password" className="text-xs font-normal">
                  Password
                </Label>

                {/*
                 * The eye shows what is being TYPED, which is the thing a
                 * manager setting a password for somebody else actually
                 * needs: they have to read it out over the telephone, and
                 * a row of dots cannot be read out.
                 *
                 * It cannot show the password somebody already has. What
                 * is stored is a bcrypt hash — a one-way fingerprint, not
                 * the password in a locked box — so nothing on this
                 * machine or the server can turn it back into the word
                 * they chose. Setting them a new one is the way to give
                 * somebody their password back.
                 */}
                <div className="relative">
                  <Input
                    id="person-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className="pr-10"
                    value={draft.password}
                    onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                    /* Said in the box, because a blank field that means "keep
                       the old one" is otherwise indistinguishable from one
                       that means "there is no password". */
                    placeholder={editing ? 'Unchanged' : 'Set a password'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    aria-pressed={showPassword}
                    aria-label={showPassword ? 'Hide the password' : 'Show the password'}
                    title={showPassword ? 'Hide' : 'Show'}
                    className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {editing && (
                  <p className="text-xs text-muted-foreground">
                    The password they have now cannot be shown — it is stored as a one-way hash.
                    Type a new one to replace it.
                  </p>
                )}
              </div>

              <label className="flex cursor-pointer select-none items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium hover:bg-muted/60">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={draft.isAdmin}
                  onChange={(event) => setDraft({ ...draft, isAdmin: event.target.checked })}
                />
                <ShieldCheck className="h-4 w-4 text-primary" />
                Administrator
                <span className="text-xs font-normal text-muted-foreground">
                  (may change the station&apos;s settings)
                </span>
              </label>

              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5" />
                The weighbridge picks this up on its next sync.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={
                save.isPending ||
                !draft ||
                draft.name.trim() === '' ||
                draft.username.trim() === '' ||
                (!editing && draft.password === '')
              }
              onClick={() => draft && save.mutate(draft)}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmRemove !== null}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {confirmRemove?.name}?</DialogTitle>
            <DialogDescription>
              They will not be able to sign in at the weighbridge after its next sync. The weighings
              they saved stay exactly as they are.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => confirmRemove && remove.mutate(confirmRemove)}
            >
              {remove.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

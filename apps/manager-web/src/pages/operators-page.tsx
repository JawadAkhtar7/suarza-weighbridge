/**
 * Who is on the weighbridge, what they sign in with, and when the shifts
 * change over.
 *
 * THREE SLOTS, not a list. The yard runs one person in the morning and one at
 * night, and an administrator who can be at the window at any hour; a table
 * you add rows to would invite a second morning operator, which is not a
 * thing the yard has and not a thing the records could be read against.
 *
 * These ARE logins now — the operator starts their shift at the bridge with
 * the username and password set here. They are not dashboard logins: they
 * open the weighing screen on the PC in the yard and nothing else. The bridge
 * keeps its own copy of them, which is what lets a shift start at six in the
 * morning with the internet down.
 *
 * The hours are stored as two start times rather than four boundaries,
 * because the two shifts divide the whole day between them — each runs until
 * the other begins. Four numbers could describe a yard with a gap in it, and
 * a weighing that fell in the gap would belong to no shift at all. The
 * administrator has no hours for the same reason: theirs would be a fiction.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, Input, Label, Skeleton, toast } from '@suarza/ui';
import {
  OPERATOR_SLOTS,
  OPERATOR_SLOT_LABELS,
  clockToMinutes,
  minutesToClock,
  type Operator,
  type OperatorSlot,
} from '@suarza/shared';
import { Clock, KeyRound, Trash2, UserPlus } from 'lucide-react';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../hooks/use-auth.js';

/** One slot: who holds it, what they sign in with, and how to change it. */
function SlotCard({
  slot,
  operator,
  hours,
  canEdit,
}: {
  slot: OperatorSlot;
  operator: Operator | undefined;
  /** What the screen says this shift runs; empty for the administrator. */
  hours: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(operator?.name ?? '');
  const [username, setUsername] = useState(operator?.username ?? '');
  const [password, setPassword] = useState('');
  const [dirty, setDirty] = useState(false);

  /* Follow the server when it answers, unless the manager is mid-edit —
     typing a name and having it replaced by a refetch is maddening. */
  useEffect(() => {
    if (dirty) return;
    setName(operator?.name ?? '');
    setUsername(operator?.username ?? '');
  }, [operator?.name, operator?.username, dirty]);

  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setDirty(true);
    };

  const save = useMutation({
    mutationFn: () =>
      api.setOperator({
        name: name.trim(),
        slot,
        username: username.trim().toLowerCase(),
        /* Omitted rather than empty: an untouched password box means "leave
           the one you have", and sending '' would read as a change. */
        ...(password ? { password } : {}),
      }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['roster'] });
      setPassword('');
      setDirty(false);
      toast.success(`${saved.name} saved`, {
        description: saved.has_password
          ? 'They can start a shift at the weighbridge with these details.'
          : 'No password set yet — they cannot sign in at the weighbridge.',
      });
    },
    onError: (error) =>
      toast.error('Could not save', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  const remove = useMutation({
    mutationFn: () => api.removeOperator(operator!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roster'] });
      setPassword('');
      setDirty(false);
      toast.success(`${OPERATOR_SLOT_LABELS[slot]} has nobody in it`);
    },
    onError: (error) =>
      toast.error('Could not remove', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  const busy = save.isPending || remove.isPending;
  const field = (part: string) => `${slot.toLowerCase()}-${part}`;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">
              {slot === 'ADMIN' ? 'Administrator' : `${OPERATOR_SLOT_LABELS[slot]} shift`}
            </h2>
            <p className="text-sm text-muted-foreground">
              {slot === 'ADMIN' ? 'No fixed hours — may sign in at any time' : hours}
            </p>
          </div>

          {operator && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => remove.mutate()}
              disabled={!canEdit || busy}
              aria-label={`Remove the ${OPERATOR_SLOT_LABELS[slot].toLowerCase()} operator`}
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </Button>
          )}
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={field('name')} className="text-xs font-normal">
              Name
            </Label>
            <Input
              id={field('name')}
              placeholder="Operator name"
              value={name}
              onChange={(event) => edit(setName)(event.target.value)}
              disabled={!canEdit || busy}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={field('username')} className="text-xs font-normal">
                Username
              </Label>
              <Input
                id={field('username')}
                autoComplete="off"
                placeholder="e.g. imran"
                value={username}
                onChange={(event) => edit(setUsername)(event.target.value)}
                disabled={!canEdit || busy}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor={field('password')} className="text-xs font-normal">
                Password
              </Label>
              <Input
                id={field('password')}
                type="password"
                autoComplete="new-password"
                /* Said in the box, because a blank field that means "keep the
                   old one" is otherwise indistinguishable from one that means
                   "there is no password". */
                placeholder={operator?.has_password ? 'Unchanged' : 'Set a password'}
                value={password}
                onChange={(event) => edit(setPassword)(event.target.value)}
                disabled={!canEdit || busy}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="brand"
            onClick={() => save.mutate()}
            disabled={!canEdit || busy || name.trim() === ''}
          >
            <UserPlus className="h-4 w-4" />
            {operator ? 'Save' : 'Add'}
          </Button>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <KeyRound className="h-3.5 w-3.5" />
            {operator?.has_password
              ? 'Can sign in at the weighbridge'
              : 'Cannot sign in until a username and password are set'}
          </p>
        </div>

        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Only an administrator can change the roster.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** The two start times, which between them define both shifts. */
function ShiftHours({
  morning,
  night,
  canEdit,
}: {
  morning: number;
  night: number;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [morningClock, setMorningClock] = useState(minutesToClock(morning));
  const [nightClock, setNightClock] = useState(minutesToClock(night));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setMorningClock(minutesToClock(morning));
    setNightClock(minutesToClock(night));
  }, [morning, night, dirty]);

  const save = useMutation({
    mutationFn: () => {
      const MORNING = clockToMinutes(morningClock);
      const NIGHT = clockToMinutes(nightClock);
      if (MORNING === null || NIGHT === null) {
        throw new Error('Use 24-hour times, like 08:00 and 20:00.');
      }
      return api.setShiftTimings({ MORNING, NIGHT });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roster'] });
      /* The dashboard and the ledger read a record's shift from these, so
         every list and every figure on screen is now answering an older
         question. */
      void queryClient.invalidateQueries({ queryKey: ['weighments'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
      setDirty(false);
      toast.success('Shift hours saved');
    },
    onError: (error) =>
      toast.error('Could not save the hours', {
        description: error instanceof Error ? error.message : 'Unexpected error.',
      }),
  });

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Clock className="h-4 w-4" />
            Shift hours
          </h2>
          <p className="text-sm text-muted-foreground">
            When each shift begins. Each one runs until the other starts, so the night shift
            crossing midnight needs no second figure.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="morning-start" className="text-xs font-normal">
              Morning starts
            </Label>
            <Input
              id="morning-start"
              type="time"
              value={morningClock}
              onChange={(event) => {
                setMorningClock(event.target.value);
                setDirty(true);
              }}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="night-start" className="text-xs font-normal">
              Night starts
            </Label>
            <Input
              id="night-start"
              type="time"
              value={nightClock}
              onChange={(event) => {
                setNightClock(event.target.value);
                setDirty(true);
              }}
              disabled={!canEdit}
            />
          </div>
        </div>

        <Button
          type="button"
          variant="brand"
          onClick={() => save.mutate()}
          disabled={!canEdit || !dirty || save.isPending}
        >
          Save hours
        </Button>

        <p className="text-xs text-muted-foreground">
          Changing these re-reads every past weighing: a slip belongs to whichever shift its own
          time falls in, so correcting the hours corrects the history rather than only what happens
          next.
        </p>
      </CardContent>
    </Card>
  );
}

export function OperatorsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN';

  const roster = useQuery({ queryKey: ['roster'], queryFn: api.roster });

  if (roster.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const operators = roster.data?.operators ?? [];
  const timings = roster.data?.shift_timings;
  const bySlot = (slot: OperatorSlot) => operators.find((operator) => operator.slot === slot);

  const hoursFor = (slot: OperatorSlot) => {
    if (!timings || slot === 'ADMIN') return '';
    const from = minutesToClock(slot === 'MORNING' ? timings.MORNING : timings.NIGHT);
    const to = minutesToClock(slot === 'MORNING' ? timings.NIGHT : timings.MORNING);
    return `${from} to ${to}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Operators</h1>
        <p className="text-sm text-muted-foreground">
          Who is on the bridge, by shift, and what they sign in with. Used to label weighings, to
          filter the dashboard and the ledger, and to start a shift at the weighbridge itself.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {OPERATOR_SLOTS.map((slot) => (
          <SlotCard
            key={slot}
            slot={slot}
            operator={bySlot(slot)}
            hours={hoursFor(slot)}
            canEdit={canEdit}
          />
        ))}
      </div>

      {timings && <ShiftHours morning={timings.MORNING} night={timings.NIGHT} canEdit={canEdit} />}
    </div>
  );
}

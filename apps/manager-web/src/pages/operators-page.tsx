/**
 * Who is on the weighbridge, and when the shifts change over.
 *
 * TWO SLOTS, not a list. The yard runs one person in the morning and one at
 * night, so the screen shows those two and who holds them — a table you add
 * rows to would invite a second morning operator, which is not a thing the
 * yard has and not a thing the records could be read against.
 *
 * This is NOT a login. The weighbridge has one operator account used by
 * whoever is at the window; this is the manager's note of who that is, so a
 * shift's weighings and takings can be read back against a name. Nothing here
 * lets anybody sign in anywhere.
 *
 * The hours are stored as two start times rather than four boundaries,
 * because the shifts divide the whole day between them — each runs until the
 * other begins. Four numbers could describe a yard with a gap in it, and a
 * weighing that fell in the gap would belong to no shift at all.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, Input, Label, Skeleton, toast } from '@suarza/ui';
import {
  clockToMinutes,
  minutesToClock,
  SHIFTS,
  SHIFT_LABELS,
  type Operator,
  type Shift,
} from '@suarza/shared';
import { Clock, Pencil, Trash2, UserPlus } from 'lucide-react';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../hooks/use-auth.js';

/** One shift's slot: who holds it, and the two things you can do about it. */
function ShiftSlot({
  shift,
  operator,
  hours,
  canEdit,
}: {
  shift: Shift;
  operator: Operator | undefined;
  /** What the screen says this shift runs, for context beside the name. */
  hours: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(operator?.name ?? '');

  /* Follow the server when it answers, unless the manager is mid-edit —
     typing a name and having it replaced by a refetch is maddening. */
  useEffect(() => {
    if (!editing) setName(operator?.name ?? '');
  }, [operator?.name, editing]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['roster'] });

  const save = useMutation({
    mutationFn: () => api.setOperator({ name: name.trim(), shift }),
    onSuccess: (saved) => {
      void invalidate();
      setEditing(false);
      toast.success(`${saved.name} is on the ${SHIFT_LABELS[shift].toLowerCase()} shift`);
    },
    onError: (error) =>
      toast.error('Could not save', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  const remove = useMutation({
    mutationFn: () => api.removeOperator(operator!.id),
    onSuccess: () => {
      void invalidate();
      toast.success(`${SHIFT_LABELS[shift]} shift has nobody on it`);
    },
    onError: (error) =>
      toast.error('Could not remove', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  const busy = save.isPending || remove.isPending;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h2 className="text-lg font-semibold">{SHIFT_LABELS[shift]} shift</h2>
          <p className="text-sm text-muted-foreground">{hours}</p>
        </div>

        {editing || !operator ? (
          <div className="space-y-2">
            <Label htmlFor={`${shift}-name`} className="text-xs font-normal">
              Operator name
            </Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={`${shift}-name`}
                className="min-w-[12rem] flex-1"
                placeholder="Operator name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && name.trim() && canEdit) save.mutate();
                }}
                disabled={!canEdit || busy}
              />
              <Button
                type="button"
                variant="brand"
                onClick={() => save.mutate()}
                disabled={!canEdit || busy || name.trim() === ''}
              >
                <UserPlus className="h-4 w-4" />
                {operator ? 'Save' : 'Add'}
              </Button>
              {editing && (
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 text-xl font-semibold">{operator.name}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={!canEdit}
            >
              <Pencil className="h-4 w-4" />
              Change
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => remove.mutate()}
              disabled={!canEdit || busy}
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </Button>
          </div>
        )}

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
         every list on screen is now answering an older question. */
      void queryClient.invalidateQueries({ queryKey: ['weighments'] });
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
  const byShift = (shift: Shift) => operators.find((operator) => operator.shift === shift);

  const hoursFor = (shift: Shift) => {
    if (!timings) return '';
    const from = minutesToClock(shift === 'MORNING' ? timings.MORNING : timings.NIGHT);
    const to = minutesToClock(shift === 'MORNING' ? timings.NIGHT : timings.MORNING);
    return `${from} to ${to}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Operators</h1>
        <p className="text-sm text-muted-foreground">
          Who is on the bridge, by shift. Used to label weighings and to filter the dashboard and
          the ledger — not to sign in anywhere.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {SHIFTS.map((shift) => (
          <ShiftSlot
            key={shift}
            shift={shift}
            operator={byShift(shift)}
            hours={hoursFor(shift)}
            canEdit={canEdit}
          />
        ))}
      </div>

      {timings && <ShiftHours morning={timings.MORNING} night={timings.NIGHT} canEdit={canEdit} />}
    </div>
  );
}

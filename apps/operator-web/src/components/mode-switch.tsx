/**
 * Choosing what is happening at the gate right now.
 *
 * This is the first decision of every weighing and, for a new operator, the
 * only place the whole job can be misunderstood. The old version was two small
 * tabs in the header reading "First weight" and "Main" — which asked the
 * operator to know the product's vocabulary before they could use it, and gave
 * no clue that the two are one job done in two halves.
 *
 * So it is built to teach rather than to label:
 *
 *  - it sits at the top of the work area, not tucked in the header, because it
 *    is the first thing to decide and the thing to change when a truck returns
 *  - each option is numbered, so the order is visible without being explained
 *  - the icons carry the meaning without words: an empty truck arriving, the
 *    same truck loaded on its way back. That contrast is readable at a glance
 *    and in any language, which matters more here than the labels do
 *  - each carries one line of what will happen next, so the consequence of the
 *    choice is on screen before it is made
 *
 * Big targets on purpose: this is pressed all day, often with gloves on, on a
 * screen that may be at arm's length.
 */

import { cn } from '@suarza/ui';
import { EmptyTruckIcon, LoadedTruckIcon } from './truck-icons.js';

export type WeighingMode = 'first' | 'second';

interface ModeOption {
  key: WeighingMode;
  step: string;
  title: string;
  detail: string;
  icon: typeof EmptyTruckIcon;
}

const OPTIONS: ModeOption[] = [
  {
    key: 'first',
    step: '1',
    title: 'First Weight',
    detail: 'Truck just arrived — weigh it and start a slip',
    icon: EmptyTruckIcon,
  },
  {
    key: 'second',
    step: '2',
    title: 'Second Weight',
    detail: 'Truck is back with a slip — weigh again and finish',
    icon: LoadedTruckIcon,
  },
];

export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: WeighingMode;
  onChange: (mode: WeighingMode) => void;
}) {
  return (
    <div
      // A radiogroup, not a tablist: these are two answers to one question, and
      // a screen reader should say which is chosen rather than which panel is
      // showing.
      role="radiogroup"
      aria-label="What is happening at the weighbridge"
      className="grid gap-3 sm:grid-cols-2"
    >
      {OPTIONS.map((option) => {
        const active = mode === option.key;
        const Icon = option.icon;

        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.key)}
            className={cn(
              'flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-colors',
              active
                ? 'border-brand bg-brand/10 shadow-sm'
                : 'border-border bg-background hover:border-brand/40 hover:bg-muted/60',
            )}
          >
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                active ? 'bg-brand text-brand-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {option.step}
            </span>

            <Icon
              className={cn('h-7 w-7 shrink-0', active ? 'text-brand' : 'text-muted-foreground')}
            />

            <span className="min-w-0">
              <span
                className={cn(
                  'block text-base font-semibold leading-tight',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {option.title}
              </span>
              <span className="block text-xs leading-tight text-muted-foreground">
                {option.detail}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

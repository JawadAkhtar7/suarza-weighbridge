/**
 * The headline figures (brief §9).
 *
 * Deliberately NOT charts: four single numbers have no shape to show, and a
 * donut of "1 of 4 statuses" would be decoration. A stat tile reads in a
 * glance, which is what a manager opening this on a phone actually wants.
 *
 * Colour here carries meaning rather than decorating: money is the brand green,
 * open tickets are the warning colour because they are the only tile that ever
 * needs acting on, and the two neutral measures stay neutral. Giving all four
 * tiles their own colour would make none of them mean anything.
 */

import { Card, CardContent, Skeleton, cn } from '@suarza/ui';
import { formatKg, formatPKR, type Analytics } from '@suarza/shared';
import { CircleDollarSign, ClipboardList, Scale, Timer, type LucideIcon } from 'lucide-react';

interface StatTilesProps {
  analytics: Analytics | undefined;
  isLoading: boolean;
}

interface Tile {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  /** Only the tiles that mean something get a colour. */
  tone: 'brand' | 'warning' | 'neutral';
  /** Raised when there is actually something to act on. */
  emphasise?: boolean;
}

const TONES = {
  brand: { icon: 'text-primary', chip: 'bg-primary/10 text-primary', edge: 'before:bg-primary' },
  warning: { icon: 'text-brand', chip: 'bg-brand/10 text-brand', edge: 'before:bg-brand' },
  neutral: {
    icon: 'text-muted-foreground',
    chip: 'bg-muted text-muted-foreground',
    // Visible enough that the four tiles read as one set. Invisible bars made
    // the coloured one look like a rendering fault rather than a signal.
    edge: 'before:bg-muted-foreground/30',
  },
} as const;

export function StatTiles({ analytics, isLoading }: StatTilesProps) {
  const tiles: Tile[] = [
    {
      label: 'Revenue',
      value: analytics ? formatPKR(analytics.total_revenue) : '—',
      note: 'Voided tickets excluded',
      icon: CircleDollarSign,
      tone: 'brand',
    },
    {
      label: 'Weighments',
      value: analytics ? analytics.total_weighments.toLocaleString() : '—',
      note: analytics ? `${analytics.completed_weighments} completed` : '',
      icon: ClipboardList,
      tone: 'neutral',
    },
    {
      label: 'Material weighed',
      value: analytics ? formatKg(analytics.total_net_weight_kg) : '—',
      note: analytics ? `${(analytics.total_net_weight_kg / 1000).toFixed(1)} ton` : '',
      icon: Scale,
      tone: 'neutral',
    },
    {
      label: 'Open tickets',
      value: analytics ? analytics.open_weighments.toLocaleString() : '—',
      note: 'Awaiting a second weighing',
      icon: Timer,
      // Coloured only when there ARE open tickets. A permanent orange tile
      // showing zero would train the manager to ignore it.
      tone: analytics && analytics.open_weighments > 0 ? 'warning' : 'neutral',
      emphasise: Boolean(analytics && analytics.open_weighments > 0),
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => {
        const tone = TONES[tile.tone];
        return (
          <Card
            key={tile.label}
            className={cn(
              'relative overflow-hidden transition-shadow hover:shadow-md',
              // A colour bar down the edge, so the tiles read as a set rather
              // than four boxes that happen to be next to each other.
              'before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-[""]',
              tone.edge,
            )}
          >
            <CardContent className="space-y-1 p-5 pl-6">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">{tile.label}</span>
                <span className={cn('rounded-md p-1.5', tone.chip)}>
                  <tile.icon className="h-4 w-4" />
                </span>
              </div>

              {isLoading ? (
                <Skeleton className="h-9 w-32" />
              ) : (
                <p
                  className={cn(
                    'tabular text-3xl font-bold leading-tight',
                    tile.emphasise && 'text-brand',
                  )}
                >
                  {tile.value}
                </p>
              )}

              {tile.note && <p className="text-xs text-muted-foreground">{tile.note}</p>}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

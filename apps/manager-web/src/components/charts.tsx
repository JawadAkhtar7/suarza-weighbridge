/**
 * Dashboard charts (brief §9).
 *
 * Every chart here is SINGLE-SERIES on purpose. Identity — which vehicle type,
 * which company, which day — is carried by the axis, so colour would encode
 * nothing. One validated hue keeps the palette honest and avoids inventing a
 * colourblind-hostile rainbow for eleven vehicle types.
 *
 * Count and revenue are never plotted on one pair of axes. Two measures of
 * different scale get two charts, not two y-scales.
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@suarza/ui';
import { formatPKR, vehicleTypeLabel, type Analytics, type VehicleType } from '@suarza/shared';
import { format, parseISO } from 'date-fns';
import { MD_BREAKPOINT, useMediaQuery } from '../hooks/use-media-query.js';
import {
  CHART_AXIS_TEXT,
  CHART_GRID,
  CHART_SERIES_LIGHT,
  CHART_TOOLTIP_STYLE,
} from '../lib/chart-theme.js';

/** Past this, the tail folds into "Other" rather than becoming unreadable. */
const MAX_BARS = 7;

interface ChartsProps {
  analytics: Analytics | undefined;
  isLoading: boolean;
}

function ChartCard({
  title,
  subtitle,
  isLoading,
  isEmpty,
  children,
}: {
  title: string;
  subtitle?: string;
  isLoading: boolean;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[240px] w-full" />
        ) : isEmpty ? (
          <p className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
            Nothing in this range.
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export function WeighmentsOverTime({ analytics, isLoading }: ChartsProps) {
  const data = (analytics?.weighments_over_time ?? []).map((row) => ({
    ...row,
    label: format(parseISO(row.date), 'd MMM'),
  }));

  return (
    <ChartCard
      title="Weighments over time"
      subtitle="By the day the truck was weighed, in Pakistan time"
      isLoading={isLoading}
      isEmpty={data.length === 0}
    >
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="weighmentsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_SERIES_LIGHT} stopOpacity={0.22} />
              <stop offset="100%" stopColor={CHART_SERIES_LIGHT} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_GRID} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: CHART_AXIS_TEXT, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: CHART_GRID }}
            tickMargin={8}
            // Inset the first and last ticks, or the leading label sits on top
            // of the y-axis zero and the trailing one runs off the card.
            padding={{ left: 12, right: 12 }}
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: CHART_AXIS_TEXT, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={32}
            tickMargin={4}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            cursor={{ stroke: CHART_GRID }}
            formatter={(value: number) => [value, 'Weighments']}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke={CHART_SERIES_LIGHT}
            strokeWidth={2}
            fill="url(#weighmentsFill)"
            // Big enough to hit on a phone.
            activeDot={{ r: 5, strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function RevenueByVehicleType({ analytics, isLoading }: ChartsProps) {
  const rows = analytics?.revenue_by_vehicle_type ?? [];
  const data = foldTail(
    rows.map((row) => ({
      label: vehicleTypeLabel(row.vehicle_type as VehicleType),
      value: row.revenue,
    })),
  );

  return (
    <ChartCard
      title="Revenue by vehicle type"
      subtitle="Voided tickets excluded"
      isLoading={isLoading}
      isEmpty={data.length === 0}
    >
      <HorizontalBars data={data} formatValue={formatPKR} />
    </ChartCard>
  );
}

interface BarDatum {
  label: string;
  value: number;
}

/** Keeps the long tail from turning the axis into unreadable slivers. */
export function foldTail(rows: BarDatum[]): BarDatum[] {
  const sorted = [...rows].sort((a, b) => b.value - a.value).filter((row) => row.value > 0);
  if (sorted.length <= MAX_BARS) return sorted;

  const head = sorted.slice(0, MAX_BARS - 1);
  const tail = sorted.slice(MAX_BARS - 1);
  return [
    ...head,
    { label: `Other (${tail.length})`, value: tail.reduce((sum, r) => sum + r.value, 0) },
  ];
}

function HorizontalBars({
  data,
  formatValue,
}: {
  data: BarDatum[];
  formatValue: (value: number) => string;
}) {
  const isWide = useMediaQuery(MD_BREAKPOINT);

  // On a phone the category column and the value label together leave almost
  // no room for the bar itself, so both shrink and long names are elided.
  const axisWidth = isWide ? 140 : 84;
  const valueGutter = isWide ? 56 : 48;

  return (
    <ResponsiveContainer width="100%" height={Math.max(240, data.length * 34 + 24)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: valueGutter, left: 4, bottom: 4 }}
      >
        <CartesianGrid stroke={CHART_GRID} horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fill: CHART_AXIS_TEXT, fontSize: isWide ? 12 : 11 }}
          tickLine={false}
          axisLine={false}
          width={axisWidth}
          tickFormatter={(label: string) =>
            isWide || label.length <= 14 ? label : `${label.slice(0, 13)}…`
          }
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          cursor={{ fill: 'hsl(210 40% 96%)' }}
          formatter={(value: number) => [formatValue(value), 'Revenue']}
        />
        <Bar
          dataKey="value"
          radius={[0, 4, 4, 0]}
          barSize={18}
          label={{
            position: 'right',
            fill: CHART_AXIS_TEXT,
            fontSize: isWide ? 12 : 10,
            formatter: (value: number) => formatValue(value),
          }}
        >
          {data.map((row) => (
            // One hue throughout: the category is the axis label, so colour
            // would be decoration, and eleven generated hues would be worse.
            <Cell key={row.label} fill={CHART_SERIES_LIGHT} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface DashboardChartsProps {
  analytics: Analytics | undefined;
  isLoading: boolean;
}

/**
 * Default export so `React.lazy` has a single entry point — and so the whole
 * Recharts bundle arrives in one chunk rather than three.
 */
export default function DashboardCharts({ analytics, isLoading }: DashboardChartsProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <WeighmentsOverTime analytics={analytics} isLoading={isLoading} />
      <RevenueByVehicleType analytics={analytics} isLoading={isLoading} />
    </div>
  );
}

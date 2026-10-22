/**
 * Filters (brief §9). One row above the data, as the dashboard's only control
 * surface — everything below reflects exactly what is set here, charts and
 * table alike, so the two can never disagree about what is being looked at.
 */

import { useState } from 'react';
import { DayPicker, type DateRange as PickerRange } from 'react-day-picker';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@suarza/ui';
import {
  SHIFTS,
  SHIFT_LABELS,
  VEHICLE_TYPE_DEFS,
  formatDatePkt,
  type Shift,
  type VehicleType,
} from '@suarza/shared';
import { CalendarDays, X } from 'lucide-react';
import { QUICK_RANGES, RANGE_LABELS, resolveRange, type RangeKey } from '../lib/date-ranges.js';
import { FilterAutocomplete } from './filter-autocomplete.js';

export interface DashboardFilters {
  rangeKey: RangeKey;
  customFrom?: Date;
  customTo?: Date;
  customerName: string;
  customerCompany: string;
  /** A plate, or any part of one. */
  vehiclePlate: string;
  vehicleType: VehicleType | 'all';
  /** Which shift's weighings, by the hours the manager has set. */
  shift: Shift | 'all';
}

export const DEFAULT_FILTERS: DashboardFilters = {
  /* Today, not the last seven days: the manager opens this to see how the
     yard is doing now, and a week's figures answered a question they had not
     asked. Every other range is one button away. */
  rangeKey: 'today',
  customerName: '',
  customerCompany: '',
  vehiclePlate: '',
  vehicleType: 'all',
  shift: 'all',
};

/** Turns the UI state into the query the API understands. */
export function toQuery(filters: DashboardFilters) {
  const range = resolveRange(filters.rangeKey, { from: filters.customFrom, to: filters.customTo });
  return {
    ...range,
    customer_name: filters.customerName.trim() || undefined,
    customer_company: filters.customerCompany.trim() || undefined,
    vehicle_plate: filters.vehiclePlate.trim() || undefined,
    vehicle_type: filters.vehicleType === 'all' ? undefined : filters.vehicleType,
    shift: filters.shift === 'all' ? undefined : filters.shift,
  };
}

interface FiltersBarProps {
  filters: DashboardFilters;
  onChange: (filters: DashboardFilters) => void;
}

export function FiltersBar({ filters, onChange }: FiltersBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<PickerRange | undefined>();

  const set = (patch: Partial<DashboardFilters>) => onChange({ ...filters, ...patch });

  const customLabel =
    filters.customFrom && filters.customTo
      ? `${formatDatePkt(filters.customFrom)} – ${formatDatePkt(filters.customTo)}`
      : RANGE_LABELS.custom;

  /* The Clear button hides when there is nothing to clear; a shift chosen
     counts, or clearing it would be the one filter with no way back. */
  const hasTextFilters =
    filters.customerName !== '' ||
    filters.customerCompany !== '' ||
    filters.vehiclePlate !== '' ||
    filters.shift !== 'all';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_RANGES.map((key) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={filters.rangeKey === key ? 'default' : 'outline'}
            onClick={() => set({ rangeKey: key })}
          >
            {RANGE_LABELS[key]}
          </Button>
        ))}

        <Button
          type="button"
          size="sm"
          variant={filters.rangeKey === 'custom' ? 'default' : 'outline'}
          onClick={() => {
            setDraftRange(
              filters.customFrom ? { from: filters.customFrom, to: filters.customTo } : undefined,
            );
            setPickerOpen(true);
          }}
        >
          <CalendarDays className="h-4 w-4" />
          {filters.rangeKey === 'custom' ? customLabel : RANGE_LABELS.custom}
        </Button>
      </div>

      {/* Three across rather than a single long row: the plate makes five
          controls, and squeezing five into one row left each of them too
          narrow to read a company name in. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FilterAutocomplete
          id="filter-name"
          label="Customer name"
          field="customer_name"
          placeholder="Any customer"
          value={filters.customerName}
          onChange={(customerName) => set({ customerName })}
        />

        <FilterAutocomplete
          id="filter-company"
          label="Company"
          field="customer_company"
          placeholder="Any company"
          value={filters.customerCompany}
          onChange={(customerCompany) => set({ customerCompany })}
        />

        <FilterAutocomplete
          id="filter-plate"
          label="Vehicle plate"
          field="vehicle_plate"
          placeholder="Any plate"
          value={filters.vehiclePlate}
          onChange={(vehiclePlate) => set({ vehiclePlate })}
        />

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Vehicle type</Label>
          <Select
            value={filters.vehicleType}
            onValueChange={(value) =>
              set({ vehicleType: value as DashboardFilters['vehicleType'] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vehicle types</SelectItem>
              {VEHICLE_TYPE_DEFS.map((def) => (
                <SelectItem key={def.key} value={def.key}>
                  {def.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="shift-filter" className="text-xs font-normal">
            Shift
          </Label>
          <Select
            value={filters.shift}
            onValueChange={(value) => set({ shift: value as Shift | 'all' })}
          >
            <SelectTrigger id="shift-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Both shifts</SelectItem>
              {SHIFTS.map((shift) => (
                <SelectItem key={shift} value={shift}>
                  {SHIFT_LABELS[shift]} shift
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className={cn('flex items-end', !hasTextFilters && 'hidden lg:flex lg:invisible')}>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              set({
                customerName: '',
                customerCompany: '',
                vehiclePlate: '',
                vehicleType: 'all',
                shift: 'all',
              })
            }
          >
            <X className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-fit">
          <DialogHeader>
            <DialogTitle>Choose a date range</DialogTitle>
          </DialogHeader>

          <DayPicker
            mode="range"
            selected={draftRange}
            onSelect={setDraftRange}
            numberOfMonths={1}
            // Nobody needs to filter to a day that has not happened yet.
            disabled={{ after: new Date() }}
            className="rdp-suarza"
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!draftRange?.from}
              onClick={() => {
                set({
                  rangeKey: 'custom',
                  customFrom: draftRange?.from,
                  // A single-day click means that one day, not an open end.
                  customTo: draftRange?.to ?? draftRange?.from,
                });
                setPickerOpen(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * A weighing, as the strings that go on the slip.
 *
 * Kept apart from the renderer so there is exactly one answer to "what does
 * this slip say", whichever of the three views is drawing it and whichever app
 * is doing the drawing. The renderer places strings; it never decides them.
 *
 * Every format here is copied from the client's artwork rather than from the
 * rest of the product — the date reads `02-10-2026   |   10:53 AM` on their
 * slip, and a receipt that quietly used the system's own `02 Oct 2026, 10:53 AM`
 * would be a difference the client can see at ten paces.
 */

import {
  COMPANY,
  DISPLAY_TIMEZONE,
  KG_PER_MAUND,
  netWeightKg,
  type Weighment,
} from '@suarza/shared';
import type { SlipValues } from './layout.js';

/** `02-10-2026` in Pakistan time, as the artwork writes it. */
export function slipDate(value: Date | string | number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')}`;
}

/** `10:53 AM` in Pakistan time. */
export function slipTime(value: Date | string | number): string {
  /* Upper-cased: recent ICU renders en-GB's meridiem as "am", the artwork
     prints "AM", and that is a difference the client can see. */
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date(value))
    .replace(/\b(am|pm)\b/i, (meridiem) => meridiem.toUpperCase());
}

/**
 * `02-10-2026   |   10:53 AM`.
 *
 * The three spaces each side of the bar are the artwork's, not an accident:
 * the string is positioned as one run of preformatted text, so the spacing is
 * part of the layout rather than something CSS could be asked for.
 */
export function slipDateTime(value: Date | string | number): string {
  return `${slipDate(value)}   |   ${slipTime(value)}`;
}

/** `32,480 Kg` — the artwork capitalises the unit. */
export function slipKg(kg: number): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(kg))} Kg`;
}

/**
 * The net weight in maunds — "mann" on the slip, the same unit under its
 * Punjabi name. Two decimals, as the artwork shows.
 */
export function slipMann(kg: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(kg / KG_PER_MAUND);
}

/** `PKR 5000/-` — the client's own way of writing a settled amount. */
export function slipAmount(amount: number, currency: string): string {
  if (!Number.isFinite(amount) || amount <= 0) return '';
  /* No thousands separator: the artwork writes "PKR 5000/-", and this one
     figure is the client's own convention rather than the system's. */
  return `${currency} ${Math.round(amount)}/-`;
}

/**
 * What the second weight and the net read on a first-weight slip.
 *
 * The driver walks away holding this one, and a pair of empty boxes reads as
 * a misprint - or worse, as a load that weighed nothing. "Pending" says the
 * slip is half of a pair and the truck is expected back.
 */
export const SLIP_PENDING = 'Pending';

/** How the slip marks a weight somebody typed instead of the scale reporting it. */
export const MANUAL_MARK = '(MANUAL)';

/**
 * Is this a first-weight slip, still waiting on the truck?
 *
 * Derived from the values rather than passed in as a prop. Every caller
 * already hands the renderer a `SlipValues`, and a separate flag is a second
 * source of truth that one of the four call sites would eventually forget to
 * pass — leaving a slip that says `Pending` under a MANN box.
 */
export function isPendingSlip(values: SlipValues): boolean {
  return values.net_kg === SLIP_PENDING;
}

export interface SlipValuesOptions {
  weighment: Weighment;
  /** When the slip was printed. Defaults to now, which is what a reprint wants. */
  printedAt?: Date | string | number;
}

/**
 * Everything the slip shows, for one weighing.
 *
 * A field with nothing in it returns an empty string and the renderer draws
 * nothing — on a pre-printed pad an absent value has to leave the box empty,
 * not print a dash into it.
 *
 * The second weight and the net are the exception: before the truck comes
 * back they read `Pending` rather than blank. See SLIP_PENDING.
 */
export function slipValues({ weighment, printedAt }: SlipValuesOptions): SlipValues {
  const net = netWeightKg(weighment.first_weight_kg, weighment.second_weight_kg);
  const hasSecond = weighment.second_weight_kg !== null && weighment.second_weight_kg !== undefined;

  return {
    slip_number: weighment.slip_number,
    printed_at: slipDateTime(printedAt ?? Date.now()),

    /* The slip calls the person in the cab the driver; the system calls them the
       customer, and the company they weigh for is the account. */
    driver_name: weighment.customer_name,
    driver_phone: weighment.customer_phone ?? '',
    customer: weighment.customer_company,

    /* Upper-cased here as well as in the schema: the schema fixes everything
       written from now on, this fixes what is already stored. */
    vehicle_plate: weighment.vehicle_plate.toUpperCase(),
    vehicle_type: weighment.vehicle_type_label || weighment.vehicle_type,
    container_number: (weighment.container_number ?? '').toUpperCase(),
    product: weighment.product,
    amount: slipAmount(weighment.amount_charged, weighment.currency),

    first_at: slipDateTime(weighment.first_weight_at),
    first_kg: slipKg(weighment.first_weight_kg),
    second_at: weighment.second_weight_at ? slipDateTime(weighment.second_weight_at) : '',
    second_kg: hasSecond ? slipKg(weighment.second_weight_kg as number) : SLIP_PENDING,
    /* Only when the figure was typed rather than read off the indicator — the
       one thing on the slip that says a human chose the number rather than
       the scale reporting it.
       On BOTH weights, not just the second. The one-visit flow types the empty
       weight in by hand, so a slip whose first figure never came off the
       indicator has to say so too, or it reads as a measurement it is not. */
    first_manual: weighment.first_weight_src === 'MANUAL' ? MANUAL_MARK : '',
    second_manual: hasSecond && weighment.second_weight_src === 'MANUAL' ? MANUAL_MARK : '',
    net_kg: hasSecond ? slipKg(net) : SLIP_PENDING,
    mann: hasSecond ? slipMann(net) : '',

    /* Suarza's own details, from code — see COMPANY. The artwork gives the
       address two lines and the constant is written that way, so nothing here
       has to guess where a long address should break. */
    company_phone: `Operator No.: ${COMPANY.phone}`,
    company_web: COMPANY.website,
    company_address_1: COMPANY.addressLines[0] ?? '',
    company_address_2: COMPANY.addressLines[1] ?? '',
  };
}

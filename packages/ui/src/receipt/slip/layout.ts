/**
 * The slip, as coordinates.
 *
 * Every position, size, colour and font size on this page is transcribed from
 * the client's own A5 artwork. They live here as data rather than as markup for
 * one reason, and it is the reason the whole module is built this way:
 *
 *   The pad is pre-printed. The operator's printer puts ONLY the values onto
 *   paper that already carries the boxes, labels and branding. The printed
 *   value and the pre-printed box it lands in must therefore be positioned from
 *   the SAME numbers — if they are not, they will not line up, and no amount of
 *   care in two separate layouts will keep them lined up through a change.
 *
 * So each item carries a `layer`:
 *
 *   'chrome' — the design: boxes, labels, logo, footer. Pre-printed on the pad.
 *   'value'  — what this particular weighing says. Printed by the operator.
 *
 * and the three views are three filters over one list:
 *
 *   soft      chrome + value   screen, the QR page, print-to-PDF
 *   overprint value            onto the pre-printed pad
 *   template  chrome           to print blank pads, and to prove the alignment
 *
 * Hold a template page and an overprint page up to the light together. If every
 * value sits inside its box, the alignment is right — and it has to be, because
 * both pages came from the numbers below.
 *
 * ---------------------------------------------------------------------------
 * Units
 *
 * The artwork is 560 x 794 "design pixels". A5 is 148 x 210 mm, so one design
 * pixel is 148/560 mm and the page is driven by that single scale — see
 * `UNIT_MM`. Nothing here is in CSS pixels: a browser's pixel is 1/96 inch only
 * if it feels like it, and "only if it feels like it" is not good enough when
 * the output has to land inside a pre-printed box.
 */

/**
 * The artboard, in design pixels.
 *
 * CSS pixels at 96 dpi, which is the unit the client's design tool exports in:
 * 140 mm is 529.1338 px and 200 mm is 755.9055 px. Keeping the artboard in the
 * exporter's own unit means a coordinate can be read off the design and typed
 * in here unchanged, with no arithmetic in between to get wrong.
 */
import { SLIP_PAGE_MM } from '@suarza/shared';

export const CANVAS = { width: 529.1338, height: 755.9055 } as const;

/**
 * The client's pad, in millimetres.
 *
 * Not A5. The pads are 140 x 200 — 8 mm narrower and 10 mm shorter — and the
 * design was redrawn for them rather than scaled, so the proportions differ as
 * well as the size (140/200 is 0.700, A5 is 0.705). Nothing here may be
 * derived from A5.
 */
export const PAGE_MM = SLIP_PAGE_MM;

/**
 * One design pixel, in millimetres.
 *
 * Works out at exactly 25.4/96, because the artboard is in CSS pixels. Taken
 * from the width all the same: horizontal drift is what pushes a value out of
 * its box, since the boxes are wide and short.
 */
export const UNIT_MM = PAGE_MM.width / CANVAS.width;

export const COLOURS = {
  /** The brand green, from the artwork. */
  green: '#125b31',
  /** The pale fill behind the slip row and the weights. */
  wash: '#eef2ef',
  /** The darker pale fill behind the Mann figure. */
  washDark: '#d9e2db',
  ink: '#231f20',
  white: '#ffffff',
} as const;

export const FONTS = {
  /** Headings, labels and every figure. */
  display: "'Montserrat', sans-serif",
  /** Urdu. */
  urdu: "'Noto Naskh Arabic', serif",
  /** The header's contact lines. */
  contact: "'Archivo', sans-serif",
  /** A handful of small labels the artwork sets apart. */
  label: "'Open Sans', sans-serif",
} as const;

/** Which of the three views an item belongs to. */
export type Layer = 'chrome' | 'value';

interface Placed {
  /** From the left edge, in design pixels. Omitted when `right` is given. */
  left?: number;
  /** From the right edge — the artwork anchors its Urdu this way. */
  right?: number;
  top: number;
  layer: Layer;
  /**
   * Drop this item from a first-weight slip.
   *
   * Before the truck comes back the second weight and the net read `Pending`,
   * and the furniture around a number it does not have yet — the clock icon
   * waiting for a timestamp, the MANN box waiting for a conversion — reads as
   * a slip that failed to print rather than one that is honestly half done.
   */
  omitWhenPending?: true;
  /**
   * Where this item sits on a first-weight slip instead.
   *
   * Only the net weight needs it. It normally rides high to leave room for
   * the MANN box beneath; with that box gone it drops to the second weight's
   * baseline so the two `Pending`s line up.
   */
  topWhenPending?: number;
}

export interface BoxItem extends Placed {
  kind: 'box';
  width: number;
  height: number;
  fill?: string;
  border?: { width: number; colour: string };
  radius?: string;
}

export interface TextItem extends Placed {
  kind: 'text';
  /** A key the renderer resolves to a string, or literal text for chrome. */
  text?: string;
  field?: ValueField;
  size: number;
  weight: number;
  colour: string;
  font: keyof typeof FONTS;
  tracking?: number;
  /** Urdu runs right-to-left and must say so, or the glyphs reorder. */
  rtl?: boolean;
}

export interface ImageItem extends Placed {
  kind: 'image';
  width: number;
  height: number;
  /** Matches the rounded box behind it, so square corners do not poke out. */
  radius?: string;
  /**
   * Crop in by this factor before drawing.
   *
   * These cameras are mounted far back and wide, so the truck is a small part
   * of the frame. 1 draws what the camera sent; 1.3 shows the middle 77% of
   * it, bigger. Overflow is clipped by a wrapper, not by the page.
   */
  zoom?: number;
  /** A key into the generated art module, or a slot the renderer fills. */
  art?: string;
  slot?: 'front-view' | 'side-view' | 'qr' | 'logo';
  alt: string;
}

export type SlipItem = BoxItem | TextItem | ImageItem;

/** Every string the renderer has to supply for a given weighing. */
export type ValueField =
  | 'slip_number'
  | 'printed_at'
  | 'driver_name'
  | 'vehicle_plate'
  | 'driver_phone'
  | 'vehicle_type'
  | 'container_number'
  | 'product'
  | 'customer'
  | 'amount'
  | 'first_at'
  | 'first_kg'
  | 'first_manual'
  | 'second_at'
  | 'second_kg'
  | 'second_manual'
  | 'net_kg'
  | 'mann';

const green = COLOURS.green;
const ink = COLOURS.ink;
const white = COLOURS.white;

/**
 * The slip, top to bottom.
 *
 * Order is paint order: a box listed before a label sits behind it. Kept in
 * reading order so this list can be checked against the artwork side by side.
 */
export const SLIP: SlipItem[] = [
  /* ---------------------------------------------------------------- chrome */
  /*
   * The whole pre-printed design, as one exact vector.
   *
   * The A5 slip was assembled here from about a hundred boxes, labels, icons
   * and Urdu runs, each transcribed from the client's artwork. This one is a
   * single SVG of that artwork — 575 outlined paths, no live text — so there
   * is nothing left to transcribe and nothing that can drift from the PDF the
   * pads are printed from. It also needs no fonts: the chrome cannot fall back
   * to the wrong typeface because it is no longer type.
   *
   * It carries the company's phone, website and address, baked in. Those are
   * therefore NOT value fields any more, and changing COMPANY in code will not
   * change what a slip says — only a new export of the artwork will.
   */
  {
    kind: 'image',
    layer: 'chrome',
    art: 'TEMPLATE',
    left: 0,
    top: 0,
    width: CANVAS.width,
    height: CANVAS.height,
    alt: 'Suarza International weight bridge slip',
  },

  /* ----------------------------------------------------------- the slip row */
  { kind: 'text', layer: 'value', left: 146.3, top: 181.36, field: 'slip_number', size: 11.35, weight: 700, colour: ink, font: 'display', tracking: 0.28 },
  /* The one value the design sets in Open Sans rather than Montserrat. */
  { kind: 'text', layer: 'value', left: 383.9, top: 180.33, field: 'printed_at', size: 9.99, weight: 600, colour: ink, font: 'label', tracking: -0.22 },

  /* -------------------------------------------------------- details, left */
  { kind: 'text', layer: 'value', left: 147, top: 225.86, field: 'driver_name', size: 11.35, weight: 600, colour: ink, font: 'display', tracking: -0.27 },
  { kind: 'text', layer: 'value', left: 147, top: 259.76, field: 'vehicle_plate', size: 11.35, weight: 600, colour: ink, font: 'display', tracking: 0.08 },
  { kind: 'text', layer: 'value', left: 147, top: 293.66, field: 'driver_phone', size: 11.35, weight: 600, colour: ink, font: 'display', tracking: 0.26 },
  { kind: 'text', layer: 'value', left: 147, top: 327.56, field: 'vehicle_type', size: 11.35, weight: 600, colour: ink, font: 'display', tracking: 0.17 },

  /* ------------------------------------------------------- details, right */
  { kind: 'text', layer: 'value', left: 410.6, top: 225.86, field: 'container_number', size: 11.35, weight: 600, colour: ink, font: 'display', tracking: -0.05 },
  { kind: 'text', layer: 'value', left: 410.6, top: 259.76, field: 'product', size: 11.35, weight: 600, colour: ink, font: 'display', tracking: -0.16 },
  { kind: 'text', layer: 'value', left: 410.6, top: 293.66, field: 'customer', size: 11.35, weight: 600, colour: ink, font: 'display', tracking: -0.17 },
  { kind: 'text', layer: 'value', left: 410.6, top: 327.56, field: 'amount', size: 11.35, weight: 600, colour: ink, font: 'display', tracking: 0.33 },

  /* ------------------------------------------------------------- the weights */
  { kind: 'text', layer: 'value', left: 63.9, top: 416.39, field: 'first_at', size: 8.28, weight: 500, colour: ink, font: 'display', tracking: 0.26 },
  { kind: 'text', layer: 'value', left: 39.6, top: 439.24, field: 'first_kg', size: 25.23, weight: 900, colour: ink, font: 'display', tracking: -0.42 },
  /*
   * The first weight's MANUAL marker.
   *
   * Not in the client's sample, which only ever marks the second. Placed at
   * the same offset from its own figure that the second one has from its own
   * (232.9 - 198.6 = 34.3), on the same baseline, so the pair reads as one
   * decision rather than two placements.
   */
  { kind: 'text', layer: 'value', left: 73.9, top: 473.02, field: 'first_manual', size: 8.83, weight: 500, colour: ink, font: 'display', tracking: 0.21 },

  { kind: 'text', layer: 'value', left: 222.9, top: 416.39, field: 'second_at', size: 8.28, weight: 500, colour: ink, font: 'display', tracking: 0.26 },
  { kind: 'text', layer: 'value', left: 198.6, top: 439.24, field: 'second_kg', size: 25.23, weight: 900, colour: ink, font: 'display', tracking: -0.4 },
  { kind: 'text', layer: 'value', left: 232.9, top: 473.02, field: 'second_manual', size: 8.83, weight: 500, colour: ink, font: 'display', tracking: 0.21 },

  { kind: 'text', layer: 'value', left: 357.4, top: 420.44, field: 'net_kg', size: 25.23, weight: 900, colour: ink, font: 'display', tracking: -0.59 },
  { kind: 'text', layer: 'value', left: 370, top: 465.33, field: 'mann', size: 15.11, weight: 700, colour: ink, font: 'display', tracking: 0.14 },

  /* ------------------------------------------------------------ the photos */
  { kind: 'image', layer: 'value', slot: 'front-view', left: 40.6, top: 537.65, width: 197.8, height: 101.1, radius: '2px', zoom: 1.3, alt: 'Truck on the weighbridge, front view' },
  { kind: 'image', layer: 'value', slot: 'side-view', left: 290.8, top: 537.65, width: 197.8, height: 101.1, radius: '2px', alt: 'Truck on the weighbridge, side view' },

  /* ---------------------------------------------------------------- the QR */
  /* Moved for this size: it used to sit centred above the footer, and now
     lives in the "SCAN TO VERIFY" box at the bottom right. */
  { kind: 'image', layer: 'value', slot: 'qr', left: 443.9, top: 670.2, width: 54.8, height: 54.8, alt: 'Scan to verify this slip' },
];

export const LAYERS: Record<SlipView, readonly Layer[]> = {
  soft: ['chrome', 'value'],
  overprint: ['value'],
  template: ['chrome'],
};

export type SlipView = 'soft' | 'overprint' | 'template';

/** The strings a given weighing puts on the slip. */
export type SlipValues = Partial<Record<ValueField, string>>;

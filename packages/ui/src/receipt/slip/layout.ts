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
import { FRONT_VIEW_ZOOM, SLIP_PAGE_MM } from '@suarza/shared';

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

/**
 * Which of the three views an item belongs to.
 *
 * `screen` is the odd one: it is neither the pad's printed design nor a value
 * that belongs on the pad. It is what the soft copy can say and the paper
 * cannot — the operator's name — and it exists because an overprint has
 * nowhere to put it: every square millimetre of that sheet is already
 * printed, and ink laid over the artwork is a smudge, not a note.
 */
export type Layer = 'chrome' | 'value' | 'screen';

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
  /**
   * Which calibration group moves this item on the PRINTED sheet.
   *
   * Left out means `details`: the print date/time and the customer fields.
   * The slip number has its own (`slip-number`), as do the figures in the
   * three weight boxes (`weights`) and each weight's date/time beside its
   * calendar icon (`first-time`, `second-time`), so each can be put right on
   * the pad without moving its neighbours. `none` is for an item that must
   * never move, which the front view is — nothing has asked for it, and a
   * control nobody needs is one more thing to set wrong.
   */
  group?: 'slip-number' | 'details' | 'weights' | 'first-time' | 'second-time' | 'qr' | 'none';
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
  /**
   * Centre the string in a box this wide, with `left` as the box's left edge.
   *
   * The design positions every value by its left edge, which is right for a
   * field that grows to the right and wrong for one sitting in a box of its
   * own. "SU-0005236" left-aligned looked centred by luck; a real slip number
   * is "202635", six characters, and it sat a quarter of the box off centre.
   */
  width?: number;
  align?: 'center';
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
   *
   * The front view's figure here is only a starting point: it is what every
   * renderer falls back to, and the station's own setting overrides it. The
   * right crop depends on where the camera ended up on its pole, which is not
   * something this table can know.
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
  | 'mann'
  /** Soft copy only — see the `screen` layer. */
  | 'operator'
  /** The owner's declaration, on both the soft copy and the paper. */
  | 'declaration';

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
  /* Centred in the white box, measured off the artwork at 130.53 -> 258.82. */
  {
    kind: 'text',
    layer: 'value',
    group: 'slip-number',
    left: 130.53,
    width: 128.28,
    align: 'center',
    top: 181.36,
    field: 'slip_number',
    size: 11.35,
    weight: 700,
    colour: ink,
    font: 'display',
    tracking: 0.28,
  },
  /* The one value the design sets in Open Sans rather than Montserrat. */
  /* Centred in the space to the right of the "Print Date/Time" label, which
     the artwork ends at 362.84. */
  {
    kind: 'text',
    layer: 'value',
    left: 368,
    width: 138,
    align: 'center',
    top: 180.33,
    field: 'printed_at',
    size: 9.99,
    weight: 600,
    colour: ink,
    font: 'label',
    tracking: -0.22,
  },

  /* -------------------------------------------------------- details, left */
  {
    kind: 'text',
    layer: 'value',
    left: 147,
    top: 225.86,
    field: 'driver_name',
    size: 11.35,
    weight: 600,
    colour: ink,
    font: 'display',
    tracking: -0.27,
  },
  {
    kind: 'text',
    layer: 'value',
    left: 147,
    top: 259.76,
    field: 'vehicle_plate',
    size: 11.35,
    weight: 600,
    colour: ink,
    font: 'display',
    tracking: 0.08,
  },
  {
    kind: 'text',
    layer: 'value',
    left: 147,
    top: 293.66,
    field: 'driver_phone',
    size: 11.35,
    weight: 600,
    colour: ink,
    font: 'display',
    tracking: 0.26,
  },
  {
    kind: 'text',
    layer: 'value',
    left: 147,
    top: 327.56,
    field: 'vehicle_type',
    size: 11.35,
    weight: 600,
    colour: ink,
    font: 'display',
    tracking: 0.17,
  },

  /* ------------------------------------------------------- details, right */
  {
    kind: 'text',
    layer: 'value',
    left: 410.6,
    top: 225.86,
    field: 'container_number',
    size: 11.35,
    weight: 600,
    colour: ink,
    font: 'display',
    tracking: -0.05,
  },
  {
    kind: 'text',
    layer: 'value',
    left: 410.6,
    top: 259.76,
    field: 'product',
    size: 11.35,
    weight: 600,
    colour: ink,
    font: 'display',
    tracking: -0.16,
  },
  {
    kind: 'text',
    layer: 'value',
    left: 410.6,
    top: 293.66,
    field: 'customer',
    size: 11.35,
    weight: 600,
    colour: ink,
    font: 'display',
    tracking: -0.17,
  },
  {
    kind: 'text',
    layer: 'value',
    left: 410.6,
    top: 327.56,
    field: 'amount',
    size: 11.35,
    weight: 600,
    colour: ink,
    font: 'display',
    tracking: 0.33,
  },

  /* ------------------------------------------------------------- the weights */
  /* The figures are the `weights` group: Settings -> Print moves them on
     their own, not with the slip number and customer fields above. */
  /*
   * The date/time beside each calendar icon: `first-time` and `second-time`,
   * each moved on its own.
   *
   * Centred on the icon in the design, measured off an 8x render: the icon's
   * ink spans 413.75-427.63 (centre 420.69), the digits' 417.5-423.5 (centre
   * 420.5). On paper the icon is the pad's, wherever its press put it, so the
   * centring there is a calibration, set in Settings -> Print.
   */
  {
    kind: 'text',
    layer: 'value',
    group: 'first-time',
    left: 63.9,
    top: 416.39,
    field: 'first_at',
    size: 8.28,
    weight: 500,
    colour: ink,
    font: 'display',
    tracking: 0.26,
  },
  {
    kind: 'text',
    layer: 'value',
    group: 'weights',
    left: 39.6,
    top: 439.24,
    field: 'first_kg',
    size: 25.23,
    weight: 900,
    colour: ink,
    font: 'display',
    tracking: -0.42,
  },
  /*
   * The first weight's MANUAL marker.
   *
   * Not in the client's sample, which only ever marks the second. Placed at
   * the same offset from its own figure that the second one has from its own
   * (232.9 - 198.6 = 34.3), on the same baseline, so the pair reads as one
   * decision rather than two placements.
   */
  {
    kind: 'text',
    layer: 'value',
    group: 'weights',
    left: 73.9,
    top: 473.02,
    field: 'first_manual',
    size: 8.83,
    weight: 500,
    colour: ink,
    font: 'display',
    tracking: 0.21,
  },

  {
    kind: 'text',
    layer: 'value',
    group: 'second-time',
    left: 222.9,
    top: 416.39,
    field: 'second_at',
    size: 8.28,
    weight: 500,
    colour: ink,
    font: 'display',
    tracking: 0.26,
  },
  {
    kind: 'text',
    layer: 'value',
    group: 'weights',
    left: 198.6,
    top: 439.24,
    field: 'second_kg',
    size: 25.23,
    weight: 900,
    colour: ink,
    font: 'display',
    tracking: -0.4,
  },
  {
    kind: 'text',
    layer: 'value',
    group: 'weights',
    left: 232.9,
    top: 473.02,
    field: 'second_manual',
    size: 8.83,
    weight: 500,
    colour: ink,
    font: 'display',
    tracking: 0.21,
  },

  {
    kind: 'text',
    layer: 'value',
    group: 'weights',
    left: 357.4,
    top: 420.44,
    field: 'net_kg',
    size: 25.23,
    weight: 900,
    colour: ink,
    font: 'display',
    tracking: -0.59,
  },
  {
    kind: 'text',
    layer: 'value',
    group: 'weights',
    left: 370,
    top: 465.33,
    field: 'mann',
    size: 15.11,
    weight: 700,
    colour: ink,
    font: 'display',
    tracking: 0.14,
  },

  /* ------------------------------------------------------------ the photos */
  /*
   * Filling the box, not floating in it.
   *
   * Measured off template.svg rendered at 8x. Each box is a 1.13 px green
   * line, rounded at the bottom, under a solid label band:
   *
   *   front   lines at 18.00-19.13 and 259.75-260.88
   *   side    lines at 268.25-269.38 and 510.00-511.00
   *   both    band ends at 526.63, bottom line at 649.13-650.25
   *
   * TWO GEOMETRIES. On screen, in the PDF and behind the QR the photo sits
   * just inside the drawn border (1.2-1.9 px of inset), which is how the
   * design reads. On paper each is printed in its box as measured on this
   * station's own pads — `photo_boxes_mm` in the print settings, read off a
   * measuring sheet — and not from these coordinates at all (SlipA5).
   */
  {
    kind: 'image',
    layer: 'value',
    slot: 'front-view',
    group: 'none',
    left: 21,
    top: 528.63,
    width: 237.31,
    height: 119.28,
    radius: '3px',
    zoom: FRONT_VIEW_ZOOM.default,
    alt: 'Truck on the weighbridge, front view',
  },
  {
    kind: 'image',
    layer: 'value',
    slot: 'side-view',
    group: 'none',
    left: 271.32,
    top: 528.63,
    width: 237.31,
    height: 119.28,
    radius: '3px',
    alt: 'Truck on the weighbridge, side view',
  },

  /* ---------------------------------------------------------------- the QR */
  /* Moved for this size: it used to sit centred above the footer, and now
     lives in the "SCAN TO VERIFY" box at the bottom right. */
  /* Dead centre of the SCAN TO VERIFY box, measured at 438.86 -> 504.13 by
     667.67 -> 726.68. The box is wider than it is tall, so the square sits
     centred on both axes rather than filling either. */
  {
    kind: 'image',
    layer: 'value',
    slot: 'qr',
    group: 'qr',
    left: 443.99,
    top: 669.67,
    width: 55,
    height: 55,
    alt: 'Scan to verify this slip',
  },

  /* ------------------------------------------------------ the soft copy only */
  /*
   * Who weighed it, under the two picture boxes.
   *
   * The strip between the pictures (which end at 647.91) and the "Thanks"
   * mark (which begins around 665) is the one piece of white left on the
   * sheet, measured off a render of the artwork. Small and quiet on purpose:
   * it is a note for whoever looks the slip up later, not a line the customer
   * is meant to read first.
   */
  /*
   * The owner's declaration, when the load is the customer's own figure.
   *
   * On the `value` layer, so it reaches the PAPER as well as the screen: a
   * disclaimer that appeared only on the copy nobody keeps would be no
   * disclaimer at all. `group: 'none'` keeps it off the calibration
   * offsets, which nudge the three boxes of values into their pre-printed
   * frames; this sits on open paper with no frame to miss.
   *
   * Above the operator line rather than beside it: the two together run to
   * 500 design pixels on one line, which crosses the SCAN TO VERIFY box.
   * Measured on a render, both here and at the sizes below.
   */
  {
    kind: 'text',
    layer: 'value',
    group: 'none',
    left: 21,
    top: 649.5,
    field: 'declaration',
    size: 6.6,
    weight: 600,
    colour: ink,
    font: 'label',
    tracking: 0.05,
  },

  {
    kind: 'text',
    layer: 'screen',
    left: 21,
    top: 658,
    field: 'operator',
    size: 7.2,
    weight: 600,
    colour: green,
    font: 'label',
    tracking: 0.1,
  },
];

/**
 * Each camera view's box, width over height (both ~1.99).
 *
 * The shape the operator's live preview takes, so framing the picture there
 * frames exactly what the slip shows: the framing is stored as a fraction of
 * the box, which only means the same thing in boxes of the same shape. The
 * printed boxes (`paper`) are within a few per cent of them.
 */
function boxAspect(slot: 'front-view' | 'side-view'): number {
  const box = SLIP.find((item) => item.kind === 'image' && item.slot === slot) as {
    width: number;
    height: number;
  };
  return box.width / box.height;
}

/**
 * The pre-printed boxes that the movable groups of values sit inside, in
 * millimetres from the sheet's top-left.
 *
 * Measured off the artwork itself rather than typed from the design file: the
 * template was rendered at four times size and scanned for the dark green
 * stroke of each box, taking the middle of the stroke — which is the same
 * thing the picture boxes are read to on a printed pad, so a reading of one
 * means what a reading of the other means. In the artwork's own design pixels
 * they are:
 *
 *   slip number   129.91 - 259.32  x  175.29 - 198.93
 *   details        17.88 - 511.38  x  212.80 - 362.34
 *   weights        19.00 - 510.63  x  373.59 - 498.74
 *
 * The weights box is the pale green band as a whole, not the three boxes
 * inside it. The three figures move together — one `weights` offset carries
 * all of them — so one box around the lot is the thing worth measuring, and
 * it is the only outline the artwork draws around them anyway.
 *
 * These are the ARTWORK's boxes, which is what makes them useful on the
 * measuring sheet and useless anywhere else: the pads are printed larger than
 * the artwork and off-centre, so where a box really lands on paper is a
 * question only a sheet printed on a pad can answer. See DEFAULT_PHOTO_BOXES_MM
 * for the same point made about the photographs.
 */
export const GROUP_BOXES_MM = {
  'slip-number': { left: 34.37, right: 68.61, top: 46.38, bottom: 52.63 },
  details: { left: 4.73, right: 135.3, top: 56.3, bottom: 95.87 },
  weights: { left: 5.03, right: 135.1, top: 98.88, bottom: 131.94 },
} as const;

export type MeasurableGroup = keyof typeof GROUP_BOXES_MM;

export const VIEW_ASPECT = {
  'front-view': boxAspect('front-view'),
  'side-view': boxAspect('side-view'),
} as const;

export const LAYERS: Record<SlipView, readonly Layer[]> = {
  /* The only view that carries `screen`: the paper has no room for an
     operator line, and the blank template is the pad's own design. */
  soft: ['chrome', 'value', 'screen'],
  overprint: ['value'],
  template: ['chrome'],
};

export type SlipView = 'soft' | 'overprint' | 'template';

/** The strings a given weighing puts on the slip. */
export type SlipValues = Partial<Record<ValueField, string>>;

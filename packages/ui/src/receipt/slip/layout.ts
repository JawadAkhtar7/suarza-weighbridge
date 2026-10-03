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

/** The artboard, in design pixels. */
export const CANVAS = { width: 560, height: 794 } as const;

/** A5, in millimetres. */
export const PAGE_MM = { width: 148, height: 210 } as const;

/**
 * One design pixel, in millimetres.
 *
 * Taken from the width: horizontal drift is what pushes a value out of its box,
 * since the boxes are wide and short. The height works out at 209.84 mm, which
 * leaves 0.08 mm of slack at the top and bottom of an A5 sheet — a tenth of the
 * thickness of a printed line.
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
  | 'second_at'
  | 'second_kg'
  | 'second_manual'
  | 'net_kg'
  | 'mann'
  | 'company_phone'
  | 'company_web'
  | 'company_address_1'
  | 'company_address_2';

const green = COLOURS.green;
const ink = COLOURS.ink;
const white = COLOURS.white;

/** A green English label in the details grid. */
const label = (left: number, top: number, text: string, size = 12, tracking = 0): TextItem => ({
  kind: 'text', layer: 'chrome', left, top, text, size, weight: 600, colour: green,
  font: 'display', tracking,
});

/** Its Urdu line, underneath. */
const urdu = (
  pos: { left?: number; right?: number },
  top: number,
  text: string,
  size = 9.33,
  weight = 400,
  colour: string = green,
): TextItem => ({
  kind: 'text', layer: 'chrome', ...pos, top, text, size, weight, colour, font: 'urdu', rtl: true,
});

/** The colon between a label and its value. */
const colon = (left: number, top: number): TextItem => ({
  kind: 'text', layer: 'chrome', left, top, text: ':', size: 13.33, weight: 600, colour: green,
  font: 'display',
});

/** What this weighing says, in the details grid. */
const value = (left: number, top: number, field: ValueField, tracking = 0): TextItem => ({
  kind: 'text', layer: 'value', left, top, field, size: 12, weight: 600, colour: ink,
  font: 'display', tracking,
});

/**
 * The slip, top to bottom.
 *
 * Order is paint order: a box listed before a label sits behind it. Kept in
 * reading order so this list can be checked against the artwork side by side.
 */
export const SLIP: SlipItem[] = [
  /* ---------------------------------------------------------------- header */
  { kind: 'image', layer: 'chrome', slot: 'logo', left: 18.4, top: 18.4, width: 171.93, height: 87.61, alt: 'Suarza International' },
  { kind: 'text', layer: 'chrome', right: 52.7, top: 35.65, field: 'company_phone', size: 12, weight: 600, colour: green, font: 'contact', tracking: -0.17 },
  { kind: 'text', layer: 'chrome', right: 52.8, top: 54.9, field: 'company_web', size: 10.67, weight: 500, colour: green, font: 'contact', tracking: -0.2 },
  { kind: 'text', layer: 'chrome', right: 52.8, top: 73.55, field: 'company_address_1', size: 9.33, weight: 500, colour: green, font: 'contact', tracking: -0.07 },
  { kind: 'text', layer: 'chrome', right: 52.8, top: 84.75, field: 'company_address_2', size: 9.33, weight: 500, colour: green, font: 'contact', tracking: -0.08 },
  { kind: 'image', layer: 'chrome', art: 'CONTACT_ICONS', left: 514.85, top: 18.9, width: 25.62, height: 79, alt: '' },

  /* ------------------------------------------------------------- title bar */
  { kind: 'box', layer: 'chrome', left: 18.9, top: 116.09, width: 521.57, height: 45.36, radius: '4.78px', fill: green },
  { kind: 'image', layer: 'chrome', art: 'TITLE_TRUCK', left: 29.61, top: 130.89, width: 87.77, height: 20.52, alt: '' },
  { kind: 'text', layer: 'chrome', left: 131.9, top: 124.9, text: 'WEIGHT BRIDGE SLIP', size: 26.67, weight: 900, colour: white, font: 'display', tracking: -0.7 },
  { kind: 'image', layer: 'chrome', art: 'TITLE_SLASHES', left: 464.73, top: 114.76, width: 29.26, height: 48.02, alt: '' },

  /* -------------------------------------------------------------- slip row */
  { kind: 'box', layer: 'chrome', left: 18.9, top: 169.03, width: 521.57, height: 37.8, radius: '4.78px', fill: COLOURS.wash },
  /*
   * The white box is painted BEFORE the green chip, although the design export
   * lists it after.
   *
   * The two overlap by 14 design pixels, and the Urdu "سلپ نمبر" is white text
   * that sits inside that overlap. Drawn in the export's order the box covers
   * it — white on white, invisible. The client's own artwork shows the chip
   * ending cleanly at x=139 with the box starting there, which is what this
   * order produces, and both rectangles keep the coordinates the design gives
   * them. Measured off their slip: the box's right edge lands at 274, exactly
   * where 125.08 + 149.76 says it should.
   */
  { kind: 'box', layer: 'chrome', left: 125.08, top: 174.7, width: 149.76, height: 26.46, radius: '4.78px', fill: white, border: { width: 1.33, colour: green } },
  { kind: 'box', layer: 'chrome', left: 32.23, top: 174.7, width: 106.82, height: 26.46, radius: '4.78px', fill: green },
  { kind: 'text', layer: 'chrome', left: 34.9, top: 180.96, text: 'SLIP NO', size: 13.33, weight: 700, colour: white, font: 'display', tracking: -0.07 },
  urdu({ right: 423.6 }, 182.6, 'سلپ نمبر', 10.67, 600, white),
  { kind: 'text', layer: 'value', left: 154.6, top: 181.71, field: 'slip_number', size: 12, weight: 700, colour: ink, font: 'display', tracking: 0.3 },
  { kind: 'image', layer: 'chrome', art: 'ICON_PRINT_TIME', left: 291.17, top: 180.98, width: 14.83, height: 14.76, alt: '' },
  { kind: 'text', layer: 'chrome', left: 308.1, top: 175.77, text: 'Print Date/Time', size: 10.56, weight: 600, colour: green, font: 'label', tracking: -0.33 },
  urdu({ right: 183.3 }, 188.49, 'پرنٹ تاریخ/وقت'),
  { kind: 'text', layer: 'value', left: 404.9, top: 180.61, field: 'printed_at', size: 10.56, weight: 600, colour: ink, font: 'label', tracking: -0.23 },

  /* ----------------------------------------------------------- details box */
  { kind: 'box', layer: 'chrome', left: 18.24, top: 214.44, width: 522.9, height: 160.08, radius: '5.45px', fill: white, border: { width: 1.33, colour: green } },
  { kind: 'box', layer: 'chrome', left: 265.41, top: 224.56, width: 1.89, height: 143.62, radius: '0.95px', fill: green },

  /* left column */
  { kind: 'image', layer: 'chrome', art: 'ICON_DRIVER', left: 32.67, top: 227.59, width: 12.39, height: 12.35, alt: '' },
  { kind: 'image', layer: 'chrome', art: 'ICON_VEHICLE', left: 33.28, top: 265.25, width: 11.21, height: 9.35, alt: '' },
  { kind: 'image', layer: 'chrome', art: 'ICON_PHONE', left: 32.68, top: 300.24, width: 12.38, height: 12.36, alt: '' },
  { kind: 'image', layer: 'chrome', art: 'ICON_VEHICLE_TYPE', left: 32.89, top: 336.96, width: 12, height: 12, alt: '' },
  label(48.2, 228.12, 'Driver Name', 12, -0.25),
  label(48.2, 264.12, 'Vehicle No', 12, -0.18),
  label(48.2, 300.12, 'Driver No', 12, -0.1),
  label(48.2, 336.12, 'Vehicle Type', 12, -0.17),
  urdu({ left: 49.3 }, 242.99, 'ڈرائیورکانام'),
  urdu({ left: 49.3 }, 277.05, 'گاڑی نمبر'),
  urdu({ left: 49.3 }, 313.19, 'ڈرائیورکا نمبر'),
  urdu({ left: 49.3 }, 351.35, 'گاڑی کی قسم'),
  colon(139.1, 226.98), colon(139.1, 262.98), colon(139.1, 298.98), colon(139.1, 334.98),
  value(154.6, 229.05, 'driver_name', -0.29),
  value(154.6, 265.05, 'vehicle_plate', 0.09),
  value(154.6, 301.05, 'driver_phone', 0.27),
  value(154.6, 337.05, 'vehicle_type', 0.18),

  /* right column */
  { kind: 'image', layer: 'chrome', art: 'ICON_CONTAINER', left: 278.62, top: 228.06, width: 13.78, height: 11.41, alt: '' },
  { kind: 'image', layer: 'chrome', art: 'ICON_PRODUCT', left: 279.79, top: 264.15, width: 11.5, height: 11.52, alt: '' },
  { kind: 'image', layer: 'chrome', art: 'ICON_CUSTOMER', left: 281.28, top: 299.86, width: 9, height: 11.06, alt: '' },
  { kind: 'image', layer: 'chrome', art: 'ICON_AMOUNT', left: 279.61, top: 334.79, width: 12.34, height: 12.34, alt: '' },
  label(298.9, 226.98, 'Container No', 13.33, -0.17),
  label(298.9, 262.98, 'Product', 13.33, -0.33),
  label(298.9, 298.98, 'Customer', 13.33, -0.35),
  label(298.9, 334.98, 'Amount', 13.33, -0.56),
  urdu({ left: 300.1 }, 242.99, 'کنٹینرنمبر'),
  urdu({ left: 300.1 }, 277.05, 'پروڈکٹ'),
  urdu({ left: 300.1 }, 314.53, 'کسٹمرکانام'),
  urdu({ left: 300.1 }, 351.35, 'وصول‌شدہ‌رقم'),
  colon(400.5, 225.24), colon(400.5, 261.24), colon(400.5, 297.24), colon(400.5, 333.24),
  value(432.4, 229.05, 'container_number', -0.05),
  value(432.4, 265.05, 'product', -0.17),
  value(432.4, 301.05, 'customer', -0.18),
  value(432.4, 337.05, 'amount', 0.35),

  /* ----------------------------------------------------------- weights box */
  { kind: 'box', layer: 'chrome', left: 18.24, top: 381.9, width: 522.9, height: 135.94, radius: '5.45px', fill: COLOURS.wash, border: { width: 1.33, colour: green } },
  { kind: 'box', layer: 'chrome', left: 195.3, top: 391, width: 0.75, height: 117.8, fill: green },
  { kind: 'box', layer: 'chrome', left: 363.3, top: 391, width: 0.75, height: 117.8, fill: green },

  /* first */
  { kind: 'box', layer: 'chrome', left: 32.23, top: 392.11, width: 158.74, height: 22.68, radius: '4.78px', fill: green },
  { kind: 'text', layer: 'chrome', left: 46.7, top: 397.77, text: 'FIRST WEIGHT', size: 12, weight: 700, colour: white, font: 'display', tracking: -0.27 },
  urdu({ right: 377.5 }, 397.55, 'پہلاوزن', 12, 700, white),
  { kind: 'image', layer: 'chrome', art: 'ICON_WEIGH_TIME', left: 45.39, top: 425.31, width: 15.88, height: 15.8, alt: '' },
  { kind: 'text', layer: 'value', left: 67.5, top: 428.67, field: 'first_at', size: 8.75, weight: 500, colour: ink, font: 'display', tracking: 0.28 },
  { kind: 'text', layer: 'value', left: 41.8, top: 452.77, field: 'first_kg', size: 26.67, weight: 900, colour: ink, font: 'display', tracking: -0.44 },

  /* second */
  { kind: 'box', layer: 'chrome', left: 200.31, top: 392.11, width: 158.74, height: 22.68, radius: '4.78px', fill: green },
  { kind: 'text', layer: 'chrome', left: 204.8, top: 398.14, text: 'SECOND WEIGHT', size: 11.33, weight: 700, colour: white, font: 'display', tracking: -0.33 },
  urdu({ right: 205.5 }, 397.36, 'دوسراوزن', 12, 700, white),
  { kind: 'image', layer: 'chrome', art: 'ICON_WEIGH_TIME', left: 213.49, top: 425.31, width: 15.88, height: 15.8, alt: '' },
  { kind: 'text', layer: 'value', left: 235.6, top: 428.67, field: 'second_at', size: 8.75, weight: 500, colour: ink, font: 'display', tracking: 0.28 },
  { kind: 'text', layer: 'value', left: 209.8, top: 452.77, field: 'second_kg', size: 26.67, weight: 900, colour: ink, font: 'display', tracking: -0.42 },
  { kind: 'text', layer: 'value', left: 246.1, top: 488.54, field: 'second_manual', size: 9.33, weight: 500, colour: ink, font: 'display', tracking: 0.22 },

  /* net */
  { kind: 'box', layer: 'chrome', left: 368.4, top: 392.11, width: 158.74, height: 22.68, radius: '4.78px', fill: green },
  { kind: 'text', layer: 'chrome', left: 381.3, top: 398.14, text: 'NET WEIGHT', size: 11.33, weight: 700, colour: white, font: 'display', tracking: -0.27 },
  urdu({ right: 45.8 }, 397.36, 'صافی وزن', 12, 700, white),
  { kind: 'text', layer: 'value', left: 377.8, top: 432.77, field: 'net_kg', size: 26.67, weight: 900, colour: ink, font: 'display', tracking: -0.62 },
  { kind: 'box', layer: 'chrome', left: 372.89, top: 474.64, width: 149.76, height: 31.45, radius: '4.78px', fill: COLOURS.washDark },
  { kind: 'text', layer: 'value', left: 391.1, top: 480.62, field: 'mann', size: 15.97, weight: 700, colour: ink, font: 'display', tracking: 0.15 },
  { kind: 'text', layer: 'chrome', left: 477.3, top: 478.21, text: 'MANN', size: 11.33, weight: 700, colour: green, font: 'display', tracking: -0.48 },
  urdu({ right: 58 }, 489.06, 'من', 12, 700),

  /* ------------------------------------------------------------ the photos */
  { kind: 'box', layer: 'chrome', left: 18.9, top: 524.7, width: 257.01, height: 22.43, radius: '4.78px 4.78px 0 0', fill: green },
  { kind: 'text', layer: 'chrome', left: 53.1, top: 530.71, text: 'FRONT VIEW', size: 12, weight: 700, colour: white, font: 'display', tracking: -0.26 },
  urdu({ right: 306.1 }, 530.49, 'سامنے کا منظر', 12, 700, white),
  { kind: 'box', layer: 'chrome', left: 18.9, top: 547.13, width: 257.01, height: 117.41, radius: '0 0 4.78px 4.78px', fill: white, border: { width: 1.33, colour: green } },
  { kind: 'image', layer: 'value', slot: 'front-view', left: 42.65, top: 553.22, width: 209.12, height: 106.86, alt: 'Truck on the weighbridge, front view' },

  { kind: 'box', layer: 'chrome', left: 283.46, top: 524.7, width: 257.01, height: 22.43, radius: '4.78px 4.78px 0 0', fill: green },
  { kind: 'text', layer: 'chrome', left: 326.5, top: 531.76, text: 'SIDE VIEW', size: 12, weight: 700, colour: white, font: 'display', tracking: -0.34 },
  urdu({ right: 36.5 }, 531.55, 'سائیڈ کا منظر', 12, 700, white),
  { kind: 'box', layer: 'chrome', left: 283.46, top: 547.13, width: 257.01, height: 117.41, radius: '0 0 4.78px 4.78px', fill: white, border: { width: 1.33, colour: green } },
  { kind: 'image', layer: 'value', slot: 'side-view', left: 301.49, top: 553.22, width: 209.12, height: 106.86, alt: 'Truck on the weighbridge, side view' },

  /* ---------------------------------------------------------------- footer */
  { kind: 'image', layer: 'chrome', art: 'FOOTER_THANKS', left: 0, top: 680, width: 560, height: 114, alt: '' },
  { kind: 'text', layer: 'chrome', left: 62.4, top: 727.03, text: 'FOR YOUR COOPERATION', size: 8.75, weight: 600, colour: green, font: 'label', tracking: -0.49 },

  /* The QR sits above the footer wave, so it is listed after it. */
  { kind: 'box', layer: 'chrome', left: 243.47, top: 672.71, width: 72.14, height: 78.64, radius: '3.88px', fill: white, border: { width: 1.33, colour: green } },
  { kind: 'box', layer: 'chrome', left: 243.47, top: 672.71, width: 72.14, height: 14.23, radius: '3.88px 3.88px 0 0', fill: green },
  { kind: 'text', layer: 'chrome', left: 247.2, top: 676.03, text: 'SCAN TO VERIFY', size: 8, weight: 700, colour: white, font: 'label', tracking: -0.07 },
  { kind: 'image', layer: 'value', slot: 'qr', left: 250.6, top: 688.85, width: 57.95, height: 57.95, alt: 'Scan to verify this slip' },
];

/** Which items a view draws. */
export const LAYERS: Record<SlipView, readonly Layer[]> = {
  soft: ['chrome', 'value'],
  overprint: ['value'],
  template: ['chrome'],
};

export type SlipView = 'soft' | 'overprint' | 'template';

/** The strings a given weighing puts on the slip. */
export type SlipValues = Partial<Record<ValueField, string>>;

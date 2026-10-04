/**
 * The A5 weighbridge slip.
 *
 * One component, three views — see layout.ts for why they must come from one
 * set of coordinates, and what each view is for.
 *
 * Everything is laid out in MILLIMETRES, converted from the artwork's design
 * pixels by a single scale. Not CSS pixels: a browser's pixel is 1/96 inch only
 * when it feels like it, and "when it feels like it" is not good enough when the
 * output has to land inside a box that is already printed on the paper.
 *
 * The page carries no JavaScript and no layout engine of its own. Every item is
 * absolutely positioned, which is usually a smell and is here the whole point:
 * absolute positions are the only kind that survive a printer driver.
 */

import * as React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  CANVAS,
  LAYERS,
  PAGE_MM,
  SLIP,
  UNIT_MM,
  FONTS,
  type SlipItem,
  type SlipValues,
  type SlipView,
} from './layout.js';
import { isPendingSlip } from './values.js';
import * as ART from './art.js';

/** Design pixels to millimetres, as a CSS length. */
const mm = (designPx: number) => `${(designPx * UNIT_MM).toFixed(4)}mm`;

export type { SlipValues };

export interface SlipA5Props {
  view: SlipView;
  values: SlipValues;
  /** What the QR code should lead to. Omitted draws no code. */
  verifyUrl?: string;
  /** The two camera stills. Both fall back to the bundled placeholder. */
  frontImageUrl?: string;
  sideImageUrl?: string;
  /** Overrides the bundled Suarza mark, for a station with its own. */
  logoUrl?: string;
  /**
   * Printer calibration, in millimetres.
   *
   * No two printers put the page down in quite the same place, and an overprint
   * is only as good as that placement. These shift the whole sheet so the
   * operator can dial it in against a real pad instead of waiting for a code
   * change — which, from hundreds of kilometres away, is the difference between
   * a five-minute fix and a trip.
   */
  offsetXmm?: number;
  offsetYmm?: number;
  /** For an on-screen preview; never applied when printing. */
  className?: string;
}

const ART_BY_KEY = ART as unknown as Record<string, string>;

export function SlipA5({
  view,
  values,
  verifyUrl,
  frontImageUrl,
  sideImageUrl,
  logoUrl,
  offsetXmm = 0,
  offsetYmm = 0,
  className,
}: SlipA5Props) {
  const layers = LAYERS[view];
  /* A first-weight slip loses the furniture that belongs to numbers it does
     not have yet, and the net drops to line up with the second weight. */
  const pending = isPendingSlip(values);
  const items = SLIP.filter(
    (item) => layers.includes(item.layer) && !(pending && item.omitWhenPending),
  ).map((item) =>
    pending && item.topWhenPending !== undefined ? { ...item, top: item.topWhenPending } : item,
  );

  /* The overprint goes onto paper that is already printed, so it draws no
     background of its own — white ink does not exist, and a white rectangle
     over a pre-printed box would show as a pale patch on a colour laser. */
  const transparent = view === 'overprint';

  return (
    <div
      className={className}
      data-slip-view={view}
      style={{
        position: 'relative',
        boxSizing: 'border-box',
        width: `${PAGE_MM.width}mm`,
        height: `${PAGE_MM.height}mm`,
        overflow: 'hidden',
        background: transparent ? 'transparent' : '#ffffff',
        fontFamily: FONTS.display,
        /* Calibration. Rounded to a hundredth of a millimetre, which is finer
           than any office printer can place a sheet anyway. */
        transform:
          offsetXmm || offsetYmm
            ? `translate(${offsetXmm.toFixed(2)}mm, ${offsetYmm.toFixed(2)}mm)`
            : undefined,
      }}
    >
      {items.map((item, index) => (
        <Item
          key={index}
          item={item}
          values={values}
          verifyUrl={verifyUrl}
          frontImageUrl={frontImageUrl}
          sideImageUrl={sideImageUrl}
          logoUrl={logoUrl}
        />
      ))}
    </div>
  );
}

function Item({
  item,
  values,
  verifyUrl,
  frontImageUrl,
  sideImageUrl,
  logoUrl,
}: {
  item: SlipItem;
  values: SlipValues;
  verifyUrl?: string;
  frontImageUrl?: string;
  sideImageUrl?: string;
  logoUrl?: string;
}) {
  const place: React.CSSProperties = {
    position: 'absolute',
    top: mm(item.top),
    ...(item.left === undefined ? {} : { left: mm(item.left) }),
    ...(item.right === undefined ? {} : { right: mm(item.right) }),
  };

  if (item.kind === 'box') {
    return (
      <div
        style={{
          ...place,
          boxSizing: 'border-box',
          width: mm(item.width),
          height: mm(item.height),
          background: item.fill,
          borderRadius: item.radius,
          border: item.border ? `${mm(item.border.width)} solid ${item.border.colour}` : undefined,
          /* Printer drivers drop background colour unless told twice. */
          WebkitPrintColorAdjust: 'exact',
          printColorAdjust: 'exact',
        }}
      />
    );
  }

  if (item.kind === 'image') {
    const src =
      item.slot === 'front-view'
        ? (frontImageUrl ?? ART.TRUCK_PLACEHOLDER)
        : item.slot === 'side-view'
          ? (sideImageUrl ?? ART.TRUCK_PLACEHOLDER)
          : item.slot === 'logo'
            ? (logoUrl ?? ART.LOGO)
            : item.art
              ? ART_BY_KEY[item.art]
              : undefined;

    if (item.slot === 'qr') {
      if (!verifyUrl) return null;
      return (
        <div style={{ ...place, width: mm(item.width), height: mm(item.height) }}>
          <QRCodeSVG
            value={verifyUrl}
            /* Sized in CSS, not in pixels: the SVG scales, and a QR drawn at a
               pixel size then scaled is the one thing a phone fails to read. */
            style={{ width: '100%', height: '100%', display: 'block' }}
            level="M"
            marginSize={0}
            title={item.alt}
          />
        </div>
      );
    }

    if (!src) return null;
    return (
      <img
        src={src}
        alt={item.alt}
        style={{
          ...place,
          display: 'block',
          width: mm(item.width),
          height: mm(item.height),
          objectFit: item.slot ? 'cover' : undefined,
        }}
      />
    );
  }

  const text = item.field ? (values[item.field] ?? '') : (item.text ?? '');
  if (text === '') return null;

  return (
    <p
      lang={item.rtl ? 'ur' : undefined}
      dir={item.rtl ? 'rtl' : undefined}
      style={{
        ...place,
        margin: 0,
        /* The artwork positions every string by the top of a line box with no
           leading. Anything else moves every baseline on the page. */
        lineHeight: 1,
        whiteSpace: 'pre',
        fontFamily: FONTS[item.font],
        fontSize: mm(item.size),
        fontWeight: item.weight,
        color: item.colour,
        letterSpacing: item.tracking ? mm(item.tracking) : undefined,
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
      }}
    >
      {text}
    </p>
  );
}

/**
 * The page rules a sheet of this needs, wherever it is printed from.
 *
 * Exported as a string so the operator app can inject it, the manager can
 * inject it, and the cloud's server-rendered page can put the same text in a
 * <style> tag — three hosts, one set of rules, no chance of them disagreeing
 * about the paper size.
 */
export const SLIP_PAGE_CSS = `
@page { size: ${PAGE_MM.width}mm ${PAGE_MM.height}mm; margin: 0; }

@media print {
  /* !important because the host app sets a page background for the screen, and
     a tinted sheet would print a block of colour over the pre-printed pad. */
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  /* One slip, one sheet. */
  [data-slip-view] { page-break-after: avoid; page-break-inside: avoid; }
  /* Screen furniture never reaches paper. */
  [data-slip-screen-only] { display: none !important; }
  /* ...and the sheet meant for paper appears only there. */
  [data-slip-print-only] { display: block !important; }
}

/*
 * What prints is NOT what the screen shows, which is the one thing about this
 * page that will surprise someone reading it later. The screen shows the whole
 * slip so the operator can check it; the printer puts down only the values,
 * because the paper in the tray already carries the design. Both are the same
 * component reading the same coordinates, so they cannot disagree about where
 * anything goes.
 *
 * These two rules live here rather than in a utility class so the behaviour
 * travels with the page CSS — a host that injects this gets it right without
 * knowing the convention.
 */
[data-slip-print-only] { display: none; }

/* The artwork is drawn in solid colour; an "economy" print mode that drops it
   would leave the labels invisible on a blank pad. */
[data-slip-view] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;

/** The artboard, for anyone needing to scale a preview. */
export const SLIP_CANVAS = CANVAS;

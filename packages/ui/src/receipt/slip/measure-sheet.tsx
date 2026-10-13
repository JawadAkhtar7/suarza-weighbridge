/**
 * The measuring sheet: millimetre scales across every edge of every box on the
 * pad that something is printed into, printed on a pad to read where those
 * boxes really are.
 *
 * Why a printed scale rather than a ruler: the pads were printed larger than
 * the artwork and off-centre, and the printer places the page with its own
 * small error on top. A ruler against the paper's edge measures the first
 * roughly and cannot see the second at all. A scale printed by the SAME
 * printer, in the SAME coordinates the slip uses, lands with exactly the same
 * error as the values will — so the number printed where the scale crosses
 * one of the pad's own lines IS that edge, in the slip's own millimetres, to
 * about a quarter of a millimetre. One pad, every reading, done.
 *
 * TWO KINDS OF SCALE, because the two kinds of setting want different numbers:
 *
 *   photographs   Settings holds the box itself, as four absolute edges. Those
 *                 scales are numbered in absolute millimetres from the sheet's
 *                 top-left, so a reading is typed in as it is read.
 *
 *   value groups  Settings holds how far to MOVE the group, not where it is.
 *                 Those scales are numbered outwards from zero at the edge the
 *                 artwork puts the box at, so the reading at the pad's own line
 *                 is already the distance to move — again, typed in as read.
 *
 * Neither asks the operator to subtract anything, which is the whole point:
 * arithmetic at a weighbridge window, on a sheet covered in numbers, is where
 * calibration goes wrong.
 */

import * as React from 'react';
import type { PhotoBox } from '@suarza/shared';
import { GROUP_BOXES_MM, PAGE_MM, type MeasurableGroup } from './layout.js';

/** How far each scale reaches either side of the edge it is centred on. */
const REACH_MM = 6;

export interface RulerMark {
  /** Where, in absolute millimetres. */
  at: number;
  /** Whole millimetres are long marks; halves are short. */
  whole: boolean;
  /** Printed at every second millimetre, so three-digit numbers never touch. */
  label: string | null;
  /** The edge itself, on a scale numbered outwards from it. */
  origin?: true;
}

/**
 * The marks for a scale centred on `centre`, every half millimetre, kept
 * between `min` and `max` so no scale runs off the sheet.
 *
 * Marks land on absolute half-millimetres rather than on halves measured from
 * the edge, because the number beside each one is its absolute position.
 */
export function rulerMarks(
  centre: number,
  reach = REACH_MM,
  min = 0.5,
  max = Number.POSITIVE_INFINITY,
): RulerMark[] {
  const from = Math.ceil(Math.max(min, centre - reach) * 2) / 2;
  const to = Math.floor(Math.min(max, centre + reach) * 2) / 2;
  const marks: RulerMark[] = [];
  for (let at = from; at <= to + 1e-9; at += 0.5) {
    const value = Math.round(at * 2) / 2;
    const whole = Number.isInteger(value);
    marks.push({ at: value, whole, label: whole && value % 2 === 0 ? String(value) : null });
  }
  return marks;
}

/**
 * The marks for a scale numbered outwards from `centre`, which reads zero.
 *
 * Measured FROM the edge rather than from the sheet, so the zero falls exactly
 * on the edge however awkward its absolute position is — 34.37 mm, say. That
 * is what lets the reading at the pad's own line be typed straight into an
 * offset: it is already a distance, already signed, already in millimetres.
 */
export function offsetMarks(
  centre: number,
  reach = REACH_MM,
  min = 0.5,
  max = Number.POSITIVE_INFINITY,
): RulerMark[] {
  const marks: RulerMark[] = [];
  for (let step = -reach * 2; step <= reach * 2; step++) {
    const offset = step / 2;
    const at = centre + offset;
    if (at < min || at > max) continue;
    const whole = Number.isInteger(offset);
    marks.push({
      at,
      whole,
      // A sign on everything but zero: an unsigned "4" on a scale that runs
      // both ways is the one number on this sheet that could be read backwards.
      label: whole && offset % 2 === 0 ? (offset > 0 ? `+${offset}` : String(offset)) : null,
      ...(offset === 0 ? { origin: true as const } : {}),
    });
  }
  return marks;
}

const INK = '#000';
const STROKE = 0.12;
const LABEL = 1.7;
const CAPTION = 1.4;

/** How far a mark reaches either side of its scale line. */
function armOf(mark: RulerMark): number {
  // The zero of an offset scale stands clear of its neighbours: it is the one
  // mark whose position has to be read at a glance from across a counter.
  if (mark.origin) return 2.6;
  return mark.whole ? 1.6 : 0.8;
}

interface ScaleProps {
  /** The edge this scale is centred on, in absolute millimetres. */
  edge: number;
  caption: string;
  /** Numbered outwards from the edge rather than from the sheet's corner. */
  offsets?: boolean;
  /**
   * Where the scale must stop, when something on the pad is in the way.
   *
   * Black on dark green is nothing at all: the pad's header band, its three
   * weight tabs and its two picture tabs are solid colour, and a scale drawn
   * across one simply vanishes there. Several edges sit within six
   * millimetres of one, so those scales are cut short rather than run into
   * it — lopsided, and every mark on them readable, which is the trade worth
   * making. The pads are out by a millimetre or two, not by six.
   */
  min?: number;
  max?: number;
}

/**
 * A scale across a left or right edge: runs left-right at height `y`.
 *
 * Its numbers stand upright, one narrow column each: written across, the
 * three-digit ones at the side box's right edge ran into each other at two
 * millimetres apart.
 */
function AcrossScale({ edge, y, caption, offsets, min, max }: ScaleProps & { y: number }) {
  const marks = (offsets ? offsetMarks : rulerMarks)(
    edge,
    REACH_MM,
    Math.max(0.5, min ?? 0),
    Math.min(PAGE_MM.width - 0.5, max ?? PAGE_MM.width),
  );
  if (marks.length === 0) return null;
  const first = marks[0]!.at;
  const last = marks[marks.length - 1]!.at;
  return (
    <g>
      <line x1={first} y1={y} x2={last} y2={y} stroke={INK} strokeWidth={STROKE} />
      {marks.map((mark) => (
        <React.Fragment key={mark.at}>
          <line
            x1={mark.at}
            x2={mark.at}
            y1={y - armOf(mark)}
            y2={y + armOf(mark)}
            stroke={INK}
            strokeWidth={mark.origin ? STROKE * 2 : STROKE}
          />
          {mark.label && (
            <text
              transform={`translate(${mark.at + 0.55} ${y - 3.1}) rotate(-90)`}
              fontSize={LABEL}
              fontWeight={mark.origin ? 700 : 400}
              fill={INK}
            >
              {mark.label}
            </text>
          )}
        </React.Fragment>
      ))}
      {/* Centred under the scale, except near a side of the sheet, where a
          centred caption would run off the paper. */}
      <text
        x={edge > PAGE_MM.width - 10 ? last : edge < 10 ? first : edge}
        y={y + 4.4}
        fontSize={CAPTION}
        textAnchor={edge > PAGE_MM.width - 10 ? 'end' : edge < 10 ? 'start' : 'middle'}
        fill={INK}
      >
        {caption}
      </text>
    </g>
  );
}

/** A scale across a top or bottom edge: runs up-down at `x`. */
function DownScale({ edge, x, caption, offsets, min, max }: ScaleProps & { x: number }) {
  const marks = (offsets ? offsetMarks : rulerMarks)(
    edge,
    REACH_MM,
    Math.max(0.5, min ?? 0),
    Math.min(PAGE_MM.height - 0.5, max ?? PAGE_MM.height),
  );
  if (marks.length === 0) return null;
  const first = marks[0]!.at;
  const last = marks[marks.length - 1]!.at;
  return (
    <g>
      <line x1={x} y1={first} x2={x} y2={last} stroke={INK} strokeWidth={STROKE} />
      {marks.map((mark) => (
        <React.Fragment key={mark.at}>
          <line
            y1={mark.at}
            y2={mark.at}
            x1={x - armOf(mark)}
            x2={x + armOf(mark)}
            stroke={INK}
            strokeWidth={mark.origin ? STROKE * 2 : STROKE}
          />
          {mark.label && (
            <text
              x={x + 3.1}
              y={mark.at + 0.6}
              fontSize={LABEL}
              fontWeight={mark.origin ? 700 : 400}
              fill={INK}
            >
              {mark.label}
            </text>
          )}
        </React.Fragment>
      ))}
      <text x={x - 3.1} y={edge + 0.5} fontSize={CAPTION} textAnchor="end" fill={INK}>
        {caption}
      </text>
    </g>
  );
}

/**
 * Where each group's scales sit, chosen one at a time against the artwork.
 *
 * By hand, and by measurement: the template was rendered and scanned for dark
 * ink under every candidate position, because the two things that spoil a
 * scale here are both specific. One is the pad's own solid colour, which
 * black ink disappears into — hence the cut-short scales. The other is the
 * scales colliding with each other: the details box and the weights band
 * agree on their left and right edges to within a third of a millimetre, so
 * their side scales are at different heights, and the slip number's box is
 * barely six millimetres tall, so its top and bottom scales are at different
 * widths or they would be drawn through one another.
 *
 * `y` on a side scale is the height its line runs at; `x` on a top or bottom
 * scale is the width its line runs down.
 */
type GroupScale = { y: number; min?: number; max?: number };
type GroupScaleX = { x: number; min?: number; max?: number };

const GROUP_SCALES: Record<
  MeasurableGroup,
  {
    name: string;
    /** Absent where the pad leaves no room for a readable one. */
    left?: GroupScale;
    right?: GroupScale;
    top: GroupScaleX;
    bottom: GroupScaleX;
  }
> = {
  /*
   * No left scale. The pad's green SLIP NO tab runs right up to that edge, so
   * half of such a scale would be printed into solid colour and the half that
   * mattered — a box set a little to the left — would be the invisible half.
   * The right edge answers the same question: the group moves as one piece,
   * so both edges shift by the same amount.
   *
   * The top scale stops at 43, clear of the green title band above it.
   */
  'slip-number': {
    name: 'Slip no',
    right: { y: 50 },
    top: { x: 52, min: 43 },
    /*
     * Cut short at the top as well, though nothing is printed there: its
     * topmost label would otherwise be drawn across the caption of the top
     * scale beside it. The two scales measure the same sideways-nothing and
     * the same up-and-down something, so losing a millimetre and a half from
     * one end of one of them costs nothing at all.
     */
    bottom: { x: 38, min: 48 },
  },
  details: {
    name: 'Details',
    left: { y: 86 },
    right: { y: 86 },
    top: { x: 108 },
    // Stops clear of the three green weight tabs just below.
    bottom: { x: 44, max: 100.6 },
  },
  weights: {
    name: 'Weights',
    left: { y: 118.5 },
    right: { y: 118.5 },
    // Its top edge sits two millimetres above those same tabs...
    top: { x: 92, max: 100.6 },
    // ...and its bottom three above the two green picture tabs.
    bottom: { x: 68, max: 134.4 },
  },
};

export interface MeasureSheetProps {
  /** The picture boxes as currently set: each scale is centred on its edge. */
  boxes: Record<'front' | 'side', PhotoBox>;
}

/** The whole sheet, 140 x 200 mm, drawn in millimetres. */
export function MeasureSheet({ boxes }: MeasureSheetProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={`${PAGE_MM.width}mm`}
      height={`${PAGE_MM.height}mm`}
      viewBox={`0 0 ${PAGE_MM.width} ${PAGE_MM.height}`}
      style={{ display: 'block', fontFamily: 'Arial, Helvetica, sans-serif' }}
      data-measure-sheet
    >
      {/*
       * The value groups: numbered outwards from zero, because what goes into
       * Settings for these is a distance to move and not a position.
       *
       * The date and time beside the slip number, and the one beside each
       * calendar icon, have scales of their own in Settings but none here.
       * They are small, they sit among the figures and icons they belong to,
       * and four more scales apiece would have made this sheet unreadable for
       * the sake of the three adjustments least often needed. The date beside
       * the slip number moves with the details group in any case.
       */}
      {(Object.keys(GROUP_SCALES) as MeasurableGroup[]).map((group) => {
        const box = GROUP_BOXES_MM[group];
        const { name, left, right, top, bottom } = GROUP_SCALES[group];
        return (
          <g key={group}>
            {left && <AcrossScale edge={box.left} {...left} caption={`${name} left`} offsets />}
            {right && <AcrossScale edge={box.right} {...right} caption={`${name} right`} offsets />}
            <DownScale edge={box.top} {...top} caption={`${name} top`} offsets />
            <DownScale edge={box.bottom} {...bottom} caption={`${name} bottom`} offsets />
          </g>
        );
      })}

      {/* The photographs: numbered in absolute millimetres, because Settings
          holds their boxes rather than a distance to move them. */}
      {(['front', 'side'] as const).map((which) => {
        const box = boxes[which];
        const name = which === 'front' ? 'Front' : 'Side';
        const middleY = (box.top + box.bottom) / 2;
        const middleX = (box.left + box.right) / 2;
        /* Left-edge scales a little above the middle, right-edge ones a
           little below: the front's right and the side's left edges are
           under 2 mm apart, and at one height their scales overlapped. */
        return (
          <g key={which}>
            <AcrossScale edge={box.left} y={middleY - 5} caption={`${name} left`} />
            <AcrossScale edge={box.right} y={middleY + 6} caption={`${name} right`} />
            <DownScale edge={box.top} x={middleX} caption={`${name} top`} />
            <DownScale edge={box.bottom} x={middleX} caption={`${name} bottom`} />
          </g>
        );
      })}
    </svg>
  );
}

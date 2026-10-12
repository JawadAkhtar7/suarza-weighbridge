/**
 * The picture-box measuring sheet: millimetre scales across every edge of the
 * two photograph boxes, printed on a pad to read where the boxes really are.
 *
 * Why a printed scale rather than a ruler: the pads were printed larger than
 * the artwork and off-centre, and the printer places the page with its own
 * small error on top. A ruler against the paper's edge measures the first
 * roughly and cannot see the second at all. A scale printed by the SAME
 * printer, in the SAME coordinates the slip uses, lands with exactly the same
 * error as the photographs will — so the number printed where the scale
 * crosses a green line IS that edge, in the slip's own millimetres, to about
 * a quarter of a millimetre. One pad, eight readings, done.
 *
 * Every number on it is absolute (millimetres from the sheet's top-left), so
 * a reading goes straight into Settings without arithmetic.
 */

import * as React from 'react';
import type { PhotoBox } from '@suarza/shared';
import { PAGE_MM } from './layout.js';

/** How far each scale reaches either side of the edge it is centred on. */
const REACH_MM = 6;

export interface RulerMark {
  /** Where, in absolute millimetres. */
  at: number;
  /** Whole millimetres are long marks; halves are short. */
  whole: boolean;
  /** Printed at every second millimetre, so three-digit numbers never touch. */
  label: string | null;
}

/**
 * The marks for a scale centred on `centre`, every half millimetre, kept
 * between `min` and `max` so no scale runs off the sheet.
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

const INK = '#000';
const STROKE = 0.12;
const LABEL = 1.7;
const CAPTION = 1.4;

/**
 * A scale across a left or right edge: runs left-right at height `y`.
 *
 * Its numbers stand upright, one narrow column each: written across, the
 * three-digit ones at the side box's right edge ran into each other at two
 * millimetres apart.
 */
function AcrossScale({ edge, y, caption }: { edge: number; y: number; caption: string }) {
  const marks = rulerMarks(edge, REACH_MM, 0.5, PAGE_MM.width - 0.5);
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
            y1={y - (mark.whole ? 1.6 : 0.8)}
            y2={y + (mark.whole ? 1.6 : 0.8)}
            stroke={INK}
            strokeWidth={STROKE}
          />
          {mark.label && (
            <text
              transform={`translate(${mark.at + 0.55} ${y - 2.1}) rotate(-90)`}
              fontSize={LABEL}
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
        y={y + 3.6}
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
function DownScale({ edge, x, caption }: { edge: number; x: number; caption: string }) {
  const marks = rulerMarks(edge, REACH_MM, 0.5, PAGE_MM.height - 0.5);
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
            x1={x - (mark.whole ? 1.6 : 0.8)}
            x2={x + (mark.whole ? 1.6 : 0.8)}
            stroke={INK}
            strokeWidth={STROKE}
          />
          {mark.label && (
            <text x={x + 2.1} y={mark.at + 0.6} fontSize={LABEL} fill={INK}>
              {mark.label}
            </text>
          )}
        </React.Fragment>
      ))}
      <text x={x - 2.1} y={edge + 0.5} fontSize={CAPTION} textAnchor="end" fill={INK}>
        {caption}
      </text>
    </g>
  );
}

export interface MeasureSheetProps {
  /** The boxes as currently set: each scale is centred on its edge. */
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

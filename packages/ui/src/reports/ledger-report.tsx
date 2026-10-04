/**
 * A customer's ledger, as a page they can be handed or sent.
 *
 * Built on A4 rather than the slip's A5: a statement is a list that grows,
 * and a list that runs over the page break has to break somewhere sensible
 * rather than somewhere a fixed coordinate table decided.
 *
 * It borrows the slip's header and footer artwork, colours and fonts so the
 * two read as one business. It does NOT borrow the slip's coordinate table:
 * that table exists so a printed value lands inside a pre-printed box, and
 * nothing here is pre-printed. The content flows.
 *
 * The styles live in a <style> block rather than in Tailwind classes. This
 * page has to look the same inside the manager app, in a print preview and in
 * a standalone HTML file, and a utility class that depends on the host app's
 * Tailwind build is the one thing that would not survive the trip.
 */

import * as React from 'react';
import {
  COMPANY,
  formatDateTimePkt,
  formatDatePkt,
  formatPKR,
  LEDGER_KIND_LABELS,
  type LedgerCustomer,
  type LedgerEntryWithBalance,
} from '@suarza/shared';
import { COLOURS, FONTS } from '../receipt/slip/layout.js';
import * as ART from '../receipt/slip/art.js';

export interface LedgerReportProps {
  customer: LedgerCustomer;
  /** Oldest first — a statement reads downwards, like a bank's. */
  entries: LedgerEntryWithBalance[];
  /** Defaults to now, which is what a download wants. */
  printedAt?: Date | string | number;
}

/** Red for debit. The slip's palette has no red, so this is the report's own. */
const DEBIT = '#b3261e';

/**
 * Page CSS for printing. Handed to react-to-print, or inlined in a standalone
 * file. `print-color-adjust` is the important line: without it browsers drop
 * the green header to save ink and the page prints as a grey skeleton.
 */
export const LEDGER_REPORT_PAGE_CSS = `
  @page { size: A4; margin: 0; }
  @media print {
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .slr-sheet { box-shadow: none !important; margin: 0 !important; }
  }
`;

const STYLES = `
.slr-sheet {
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 0;
  background: #fff;
  color: ${COLOURS.ink};
  font-family: ${FONTS.display};
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.slr-body { flex: 1 0 auto; padding: 0 12mm; }

/* ----------------------------------------------------------------- header */
.slr-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8mm;
  padding: 6mm 12mm 0;
}
.slr-logo { width: 58mm; height: auto; display: block; }
.slr-contact {
  text-align: right;
  font-family: ${FONTS.contact};
  color: ${COLOURS.green};
  line-height: 1.45;
}
.slr-contact .slr-phone { font-size: 11pt; font-weight: 600; }
.slr-contact .slr-web { font-size: 10pt; font-weight: 500; }
.slr-contact .slr-addr { font-size: 8.5pt; font-weight: 500; }
.slr-conticons { width: 7mm; height: auto; display: block; margin-top: 1mm; }

/* -------------------------------------------------------------- title bar */
.slr-title {
  position: relative;
  margin: 5mm 12mm 0;
  background: ${COLOURS.green};
  border-radius: 1.6mm;
  height: 12.5mm;
  display: flex;
  align-items: center;
  overflow: hidden;
}
.slr-title h1 {
  margin: 0 0 0 7mm;
  color: ${COLOURS.white};
  font-size: 18pt;
  font-weight: 900;
  letter-spacing: -0.3px;
}
.slr-title .slr-slashes { position: absolute; right: 14mm; top: 0; height: 12.5mm; }

/* ------------------------------------------------------------- who/when */
.slr-who {
  margin-top: 4mm;
  background: ${COLOURS.wash};
  border-radius: 1.6mm;
  padding: 3.4mm 5mm;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3mm 5mm;
}
.slr-who dt {
  font-family: ${FONTS.label};
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: ${COLOURS.green};
  margin: 0 0 0.8mm;
}
.slr-who dd { margin: 0; font-size: 10.5pt; font-weight: 600; word-break: break-word; }

/* --------------------------------------------------------------- totals */
.slr-tiles { margin-top: 4mm; display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
.slr-tile { border: 0.4mm solid ${COLOURS.washDark}; border-radius: 1.6mm; padding: 3.4mm; }
.slr-tile .slr-k {
  font-family: ${FONTS.label};
  font-size: 7.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: ${COLOURS.green};
}
.slr-tile .slr-v { margin-top: 1.2mm; font-size: 16pt; font-weight: 800; letter-spacing: -0.3px; }
.slr-tile.slr-debit { background: #fdf2f1; border-color: #f0d4d1; }
.slr-tile.slr-debit .slr-k, .slr-tile.slr-debit .slr-v { color: ${DEBIT}; }
.slr-tile.slr-credit { background: ${COLOURS.wash}; }
.slr-tile.slr-credit .slr-v { color: ${COLOURS.green}; }
.slr-tile.slr-balance { background: ${COLOURS.green}; border-color: ${COLOURS.green}; }
.slr-tile.slr-balance .slr-k { color: rgba(255, 255, 255, 0.82); }
.slr-tile.slr-balance .slr-v { color: ${COLOURS.white}; }
.slr-tile .slr-sub { margin-top: 0.8mm; font-size: 8pt; font-weight: 600; }
.slr-tile.slr-balance .slr-sub { color: rgba(255, 255, 255, 0.82); }

/* ---------------------------------------------------------------- table */
.slr-table { width: 100%; border-collapse: collapse; margin-top: 4mm; font-size: 9.5pt; }
.slr-table thead th {
  background: ${COLOURS.green};
  color: ${COLOURS.white};
  font-family: ${FONTS.label};
  font-size: 8pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  text-align: left;
  padding: 2.6mm 3mm;
}
.slr-table thead th.slr-num { text-align: right; }
/* Repeat the head on every printed page — a column of bare numbers on page
   two is unreadable without it. */
.slr-table thead { display: table-header-group; }
.slr-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
.slr-table tbody tr:nth-child(even) { background: ${COLOURS.wash}; }
.slr-table td { padding: 1.9mm 3mm; border-bottom: 0.25mm solid ${COLOURS.washDark}; vertical-align: top; }
.slr-table td.slr-date { white-space: nowrap; }
.slr-table td.slr-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.slr-table td.slr-debit { color: ${DEBIT}; font-weight: 700; }
.slr-table td.slr-credit { color: ${COLOURS.green}; font-weight: 700; }
.slr-table td.slr-bal { font-weight: 700; }
.slr-detail-note { display: block; font-size: 8pt; font-weight: 400; color: #5b6560; margin-top: 0.6mm; }
.slr-voided { text-decoration: line-through; opacity: 0.55; }
.slr-tag {
  display: inline-block;
  margin-left: 1.5mm;
  padding: 0.2mm 1.4mm;
  border-radius: 0.8mm;
  background: ${COLOURS.washDark};
  font-size: 7pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  text-decoration: none;
  opacity: 1;
}
.slr-table tfoot td {
  border-top: 0.6mm solid ${COLOURS.green};
  border-bottom: none;
  padding: 3mm;
  font-weight: 800;
  font-size: 10.5pt;
}
.slr-empty { padding: 10mm 3mm; text-align: center; color: #5b6560; font-size: 10pt; }

/* --------------------------------------------------------------- footer */
.slr-foot { flex-shrink: 0; margin-top: 4mm; }
.slr-footnote {
  display: flex;
  justify-content: space-between;
  gap: 6mm;
  padding: 0 12mm 2mm;
  font-family: ${FONTS.label};
  font-size: 7.5pt;
  color: #5b6560;
}
.slr-thanks { display: block; width: 100%; }
`;

function Money({ value }: { value: number }) {
  return <>{formatPKR(Math.abs(value))}</>;
}

/** `Rs 1,200 debit` — never a bare negative, which reads as a mistake. */
function balanceWords(balancePkr: number): { amount: number; word: string } {
  const rounded = Math.round(balancePkr * 100) / 100;
  if (rounded < 0) return { amount: rounded, word: 'debit' };
  if (rounded > 0) return { amount: rounded, word: 'credit' };
  return { amount: 0, word: 'settled' };
}

export function LedgerReport({ customer, entries, printedAt }: LedgerReportProps) {
  const printed = printedAt ?? Date.now();
  const balance = balanceWords(customer.balance_pkr);

  /*
   * Oldest first. The page shows newest first, because a manager opening it
   * wants to know what just happened; a statement is read the other way, so
   * the balance column climbs down the page in the order it actually moved.
   */
  const rows = React.useMemo(
    () => [...entries].sort((a, b) => a.at.localeCompare(b.at)),
    [entries],
  );

  const period =
    rows.length > 0
      ? `${formatDatePkt(rows[0]!.at)} — ${formatDatePkt(rows[rows.length - 1]!.at)}`
      : '—';

  return (
    <div className="slr-sheet">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <header className="slr-head">
        <img className="slr-logo" src={ART.LOGO} alt={COMPANY.name} />
        <div style={{ display: 'flex', gap: '3mm', alignItems: 'flex-start' }}>
          <div className="slr-contact">
            <div className="slr-phone">Operator No.: {COMPANY.phone}</div>
            <div className="slr-web">{COMPANY.website}</div>
            {COMPANY.addressLines.map((line) => (
              <div className="slr-addr" key={line}>
                {line}
              </div>
            ))}
          </div>
          <img className="slr-conticons" src={ART.CONTACT_ICONS} alt="" />
        </div>
      </header>

      <div className="slr-title">
        <h1>CUSTOMER LEDGER</h1>
        <img className="slr-slashes" src={ART.TITLE_SLASHES} alt="" />
      </div>

      <div className="slr-body">
        <dl className="slr-who">
          <div>
            <dt>Customer</dt>
            <dd>{customer.name || '—'}</dd>
          </div>
          <div>
            <dt>Company</dt>
            <dd>{customer.company || '—'}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{customer.phone || '—'}</dd>
          </div>
          <div>
            <dt>Entries</dt>
            <dd>{rows.length}</dd>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <dt>Period</dt>
            <dd>{period}</dd>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <dt>Printed</dt>
            <dd>{formatDateTimePkt(printed)}</dd>
          </div>
        </dl>

        <div className="slr-tiles">
          <div className="slr-tile slr-debit">
            <div className="slr-k">Total debit</div>
            <div className="slr-v">{formatPKR(customer.total_charged_pkr)}</div>
            <div className="slr-sub">Weighings and corrections</div>
          </div>
          <div className="slr-tile slr-credit">
            <div className="slr-k">Total credit</div>
            <div className="slr-v">{formatPKR(customer.total_paid_pkr)}</div>
            <div className="slr-sub">Received from the customer</div>
          </div>
          <div className="slr-tile slr-balance">
            <div className="slr-k">Balance</div>
            <div className="slr-v">
              <Money value={balance.amount} />
            </div>
            <div className="slr-sub">{balance.word}</div>
          </div>
        </div>

        <table className="slr-table">
          <thead>
            <tr>
              <th style={{ width: '27mm' }}>Date</th>
              <th>Detail</th>
              <th style={{ width: '24mm' }}>Slip</th>
              <th className="slr-num" style={{ width: '26mm' }}>
                Debit
              </th>
              <th className="slr-num" style={{ width: '26mm' }}>
                Credit
              </th>
              <th className="slr-num" style={{ width: '30mm' }}>
                Balance
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="slr-empty" colSpan={6}>
                  No entries on this account yet.
                </td>
              </tr>
            ) : (
              rows.map((entry) => {
                const after = balanceWords(entry.balance_after_pkr);
                const struck = entry.voided ? ' slr-voided' : '';
                return (
                  <tr key={entry.id}>
                    <td className="slr-date">{formatDatePkt(entry.at)}</td>
                    <td className={entry.voided ? 'slr-voided' : undefined}>
                      {LEDGER_KIND_LABELS[entry.kind]}
                      {entry.voided && <span className="slr-tag">Voided</span>}
                      {entry.note && <span className="slr-detail-note">{entry.note}</span>}
                    </td>
                    <td>{entry.slip_number ?? '—'}</td>
                    <td className={`slr-num${entry.direction === 'DEBIT' ? ' slr-debit' : ''}${struck}`}>
                      {entry.direction === 'DEBIT' ? <Money value={entry.amount_pkr} /> : ''}
                    </td>
                    <td className={`slr-num${entry.direction === 'CREDIT' ? ' slr-credit' : ''}${struck}`}>
                      {entry.direction === 'CREDIT' ? <Money value={entry.amount_pkr} /> : ''}
                    </td>
                    <td className="slr-num slr-bal">
                      <Money value={after.amount} />
                      {after.word !== 'settled' && (
                        <span style={{ fontWeight: 400, fontSize: '7.5pt' }}> {after.word}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3}>Closing balance</td>
                <td className="slr-num" style={{ color: DEBIT }}>
                  {formatPKR(customer.total_charged_pkr)}
                </td>
                <td className="slr-num" style={{ color: COLOURS.green }}>
                  {formatPKR(customer.total_paid_pkr)}
                </td>
                <td className="slr-num">
                  <Money value={balance.amount} />
                  <span style={{ fontWeight: 400, fontSize: '7.5pt' }}> {balance.word}</span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <footer className="slr-foot">
        <div className="slr-footnote">
          <span>
            {customer.name || 'Customer'} · account {customer.id}
          </span>
          <span>Generated by {COMPANY.name} weighbridge · {formatDateTimePkt(printed)}</span>
        </div>
        <img className="slr-thanks" src={ART.FOOTER_THANKS} alt="" />
      </footer>
    </div>
  );
}

/**
 * The weighment receipt (brief §8), in its two visual forms.
 *
 * SOFT — screen preview, the PDF, and the branded page behind the QR code:
 * company header and footer included.
 * HARD — what reaches the printer: the central block ONLY, because the paper is
 * a pre-printed letterhead pad that already carries the branding.
 *
 * Both forms are this one component; `@media print` decides which parts survive
 * (see print-style.ts). Two components would drift, and a receipt whose screen
 * preview disagreed with the paper would be worse than useless.
 *
 * The layout follows the client's own slip design: a titled banner, the slip
 * number and both timestamps up top, identity on the left with the commercial
 * facts on the right, then the three weights as equal cards — because the three
 * weights are what everyone actually looks at.
 *
 * Every filled panel reverts to black-on-white when printing. The pad is
 * pre-printed in colour precisely so the slip printer does not have to be, and
 * flooding an A5 page with green would cost the client a cartridge a week.
 *
 * It lives in the shared kit rather than in the operator app because three
 * places need exactly this markup: the operator's printout, the manager
 * dashboard's reprint, and the public QR page served from the cloud.
 */

/*
 * React is imported explicitly, and must stay imported.
 *
 * This file is server-rendered by the cloud API, whose dev runner (tsx) ignores
 * `"jsx": "react-jsx"` and always emits the CLASSIC transform — so the JSX below
 * becomes `React.createElement` and needs React in scope. The bundled build uses
 * the automatic runtime and does not, but an extra import costs nothing there.
 * Without this the public QR receipt page 500s in dev with
 * "ReferenceError: React is not defined".
 */
import * as React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  formatDateTimePkt,
  formatKg,
  formatPKR,
  formatTon,
  vehicleTypeLabel,
  type NetWeight,
  type Weighment,
} from '@suarza/shared';
import { Scale, Weight } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { PRINT_BLOCK_CLASS, SOFT_ONLY_CLASS } from './print-style.js';

export interface ReceiptCompany {
  name: string;
  address: string;
  phone: string;
  logoUrl?: string;
}

export interface ReceiptProps {
  weighment: Weighment;
  net: NetWeight;
  /** FIRST prints after pass 1 and carries no net; SECOND is the full receipt. */
  variant: 'FIRST' | 'SECOND';
  company: ReceiptCompany;
  /** Cloud URL the QR encodes. Null hides the QR rather than printing a dead one. */
  receiptUrl: string | null;
  className?: string;
}

/**
 * Maunds as a trader reads them: `253`, not `253.000`. The shared formatter
 * keeps three decimals because the completion screen needs the precision; on
 * paper the trailing zeros are just noise.
 */
function mann(maund: number): string {
  return maund.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** The client's brand green. One constant, so a rebrand is one edit. */
const BRAND = 'text-[#155932]';
const BRAND_BG = 'bg-[#155932]';
const BRAND_BORDER = 'border-[#155932]';
/** Reverts every filled panel to plain ink for the pre-printed pad. */
const PRINT_PLAIN = 'print:bg-white print:text-black print:border-black';

export function Receipt({
  weighment,
  net,
  variant,
  company,
  receiptUrl,
  className,
}: ReceiptProps) {
  const isComplete = variant === 'SECOND';

  return (
    <div className={cn('mx-auto w-full max-w-[150mm] bg-white text-black', className)}>
      <ReceiptHeader company={company} />

      <section className={cn(PRINT_BLOCK_CLASS, 'px-5 py-4')}>
        <SlipRow weighment={weighment} />

        {weighment.status === 'VOID' && (
          <p className={cn('mt-2 border-2 px-2 py-1 text-center text-xs font-bold uppercase tracking-wide', BRAND_BORDER, BRAND, PRINT_PLAIN)}>
            Voided{weighment.void_reason ? ` — ${weighment.void_reason}` : ''}
          </p>
        )}

        <DetailsRow weighment={weighment} isComplete={isComplete} receiptUrl={receiptUrl} />

        <WeightCards weighment={weighment} net={net} isComplete={isComplete} />

        <FooterRow weighment={weighment} />
      </section>

      <ReceiptFooter company={company} />
    </div>
  );
}

/* ── Slip number + time in ─────────────────────────────────────────────── */

function SlipRow({ weighment }: { weighment: Weighment }) {
  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border-2 px-3 py-2',
        BRAND_BORDER,
        // The slip number is the one thing anyone quotes back over the phone, so
        // in the soft form it carries the brand fill. The pad already has it
        // printed, hence PRINT_PLAIN.
        BRAND_BG,
        'text-white',
        PRINT_PLAIN,
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] font-bold uppercase leading-none tracking-wide text-white print:text-black">
          Slip No.
          <span className="urdu ml-1 inline-block text-[9px] leading-relaxed">سلپ نمبر</span>
        </span>
        <span className="tabular text-xl font-bold leading-none">{weighment.slip_number}</span>
      </div>

      <div className="text-right">
        <p className="text-[8px] font-bold uppercase leading-none tracking-wide text-white print:text-black">
          Date &amp; Time
        </p>
        <p className="urdu text-[8px] leading-relaxed">تاریخ و وقت</p>
        <p className="tabular text-[10px] font-semibold">
          {formatDateTimePkt(weighment.first_weight_at)}
        </p>
      </div>
    </div>
  );
}

/* ── Identity (left) + commercial (right) ──────────────────────────────── */

function DetailsRow({
  weighment,
  isComplete,
  receiptUrl,
}: {
  weighment: Weighment;
  isComplete: boolean;
  receiptUrl: string | null;
}) {
  return (
    <div className="mt-2 grid grid-cols-[1.6fr_1fr] gap-2">
      <dl className={cn('rounded-md border px-3 py-2 text-[10.5px]', BRAND_BORDER, PRINT_PLAIN)}>
        <DetailRow label="Customer Name" urdu="کسٹمر کا نام" value={weighment.customer_name} />
        <DetailRow label="Company" urdu="کمپنی" value={weighment.customer_company || '—'} />
        <DetailRow label="Vehicle Number" urdu="گاڑی نمبر" value={weighment.vehicle_plate} />
        <DetailRow label="Vehicle Type" urdu="گاڑی کی قسم" value={vehicleTypeLabel(weighment.vehicle_type)} />
        <DetailRow label="Container Number" urdu="کنٹینر نمبر" value={weighment.container_number ?? '—'} />
        <DetailRow label="Phone" urdu="فون نمبر" value={weighment.customer_phone ?? '—'} />
        <DetailRow label="Product" urdu="پروڈکٹ" value={weighment.product} />
      </dl>

      <div className="space-y-2">
        {isComplete && (
          <Panel
            label="Amount Charged"
            urdu="چارج شدہ رقم"
            value={`${formatPKR(weighment.amount_charged)}/-`}
          />
        )}

        {/* The QR sits here rather than along the bottom: this column has the
            room, and the width it gives back at the foot of the slip goes to
            the weight figures, which are what everyone actually reads. */}
        <QrPanel receiptUrl={receiptUrl} />
      </div>
    </div>
  );
}

function DetailRow({ label, urdu, value }: { label: string; urdu: string; value: string }) {
  return (
    <div className="grid grid-cols-[7.2rem_0.5rem_1fr] items-start gap-x-1 py-[2.5px]">
      <dt className="min-w-0">
        {/* `whitespace-nowrap` keeps "Container Number" on one line — a wrapped
            label makes every row a different height and the colons stop lining
            up, which is the first thing the eye notices on a form. */}
        <span className="block whitespace-nowrap font-semibold leading-[1.15]">{label}</span>
        <span className="urdu block text-left text-[8px] leading-[1.25] text-black/60">{urdu}</span>
      </dt>
      <span className="font-semibold leading-[1.15]">:</span>
      <dd className="min-w-0 break-words font-medium leading-[1.15]">{value}</dd>
    </div>
  );
}

function Panel({ label, urdu, value }: { label: string; urdu: string; value: string }) {
  return (
    <div className={cn('rounded-md border px-3 py-3.5 text-center', BRAND_BORDER, PRINT_PLAIN)}>
      <p className={cn('text-[9px] font-bold uppercase leading-none tracking-wide', BRAND, 'print:text-black')}>
        {label}
      </p>
      {/* `leading-loose`, not `leading-none`: Nastaliq descends well below its
          baseline and was sitting on top of the label above it. The column has
          the height to spare, so the panel takes it. */}
      <p className="urdu mt-0.5 text-[10px] leading-loose">{urdu}</p>
      {/* As big as the net weight — it is read just as often, and by the person
          paying it. */}
      <p className="tabular mt-1 text-2xl font-bold leading-none">{value}</p>
    </div>
  );
}

/* ── The three weights ─────────────────────────────────────────────────── */

function WeightCards({
  weighment,
  net,
  isComplete,
}: {
  weighment: Weighment;
  net: NetWeight;
  isComplete: boolean;
}) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      <WeightCard
        icon={<Scale className="h-3.5 w-3.5" />}
        label="First Weight"
        urdu="پہلا وزن"
        at={weighment.first_weight_at}
        kg={weighment.first_weight_kg}
        manual={weighment.first_weight_src === 'MANUAL'}
      />

      <WeightCard
        icon={<Scale className="h-3.5 w-3.5" />}
        label="Second Weight"
        urdu="دوسرا وزن"
        at={weighment.second_weight_at}
        kg={weighment.second_weight_kg}
        manual={weighment.second_weight_src === 'MANUAL'}
      />

      <div className={cn('overflow-hidden rounded-md border-2', BRAND_BORDER, PRINT_PLAIN)}>
        <div className={cn('flex items-center justify-center gap-1 px-1 py-1 text-white', BRAND_BG, PRINT_PLAIN, 'print:border-b print:border-black')}>
          <Weight className="h-3.5 w-3.5" />
          <div className="text-center leading-none">
            <p className="text-[8px] font-bold uppercase tracking-wide">Net Weight</p>
            <p className="urdu text-[8px] leading-relaxed">خالص وزن</p>
          </div>
        </div>

        <div className="px-2 py-1.5 text-center">
          {isComplete ? (
            <>
              <p className="tabular text-2xl font-bold leading-none">{formatKg(net.kg)}</p>
              <p className="urdu text-[8px] leading-tight">کلوگرام</p>
              <div className="mt-1 border-t pt-1">
                <p className="tabular text-xl font-bold leading-none">
                  {mann(net.maund)} <span className="text-[11px]">Mann</span>
                  <span className="urdu ml-1 text-[10px]">(من)</span>
                </p>
                <p className="tabular text-[9px] leading-tight">{formatTon(net.ton)}</p>
              </div>
            </>
          ) : (
            <p className="py-2 text-[10px] font-medium italic leading-tight">
              Pending second weighing
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function WeightCard({
  icon,
  label,
  urdu,
  at,
  kg,
  manual,
}: {
  icon: React.ReactNode;
  label: string;
  urdu: string;
  at: string | null;
  kg: number | null;
  manual: boolean;
}) {
  return (
    <div className={cn('overflow-hidden rounded-md border', BRAND_BORDER, PRINT_PLAIN)}>
      <div className={cn('flex items-center justify-center gap-1 px-1 py-1 text-white', BRAND_BG, PRINT_PLAIN, 'print:border-b print:border-black')}>
        {icon}
        <div className="text-center leading-none">
          <p className="text-[8px] font-bold uppercase tracking-wide">{label}</p>
          <p className="urdu text-[8px] leading-relaxed">{urdu}</p>
        </div>
      </div>

      <div className="px-2 py-1.5 text-center">
        <p className="tabular text-[8px] leading-tight">{at ? formatDateTimePkt(at) : '—'}</p>
        <p className="tabular text-xl font-bold leading-tight">
          {kg === null ? 'pending' : formatKg(kg)}
        </p>
        <p className="urdu text-[8px] leading-tight">کلوگرام</p>
        {manual && (
          // Flagged on the paper, not just in the database — the audit trail is
          // no use to someone holding the receipt.
          <p className="text-[7px] font-bold uppercase leading-none">(manual entry)</p>
        )}
      </div>
    </div>
  );
}

/* ── QR + signature ────────────────────────────────────────────────────── */

/**
 * The QR, in the right-hand column under the amount.
 *
 * Nothing is rendered at all without a URL: an instruction to scan a code that
 * is not on the paper just sends the customer hunting for it.
 */
function QrPanel({ receiptUrl }: { receiptUrl: string | null }) {
  if (!receiptUrl) return null;

  return (
    <div className={cn('rounded-md border px-3 py-3 text-center', BRAND_BORDER, PRINT_PLAIN)}>
      <p className={cn('text-[9px] font-bold uppercase leading-none tracking-wide', BRAND, 'print:text-black')}>
        Scan to Verify
      </p>
      <p className="urdu mt-0.5 text-[10px] leading-loose">تصدیق کے لیے اسکین کریں</p>
      {/* The class is the only stable way to tell the QR apart from the
          lucide icons elsewhere on the receipt, which are also <svg>. */}
      <QRCodeSVG
        className="receipt-qr mx-auto mt-1.5"
        value={receiptUrl}
        size={68}
        level="M"
        marginSize={0}
      />
    </div>
  );
}

function FooterRow({ weighment }: { weighment: Weighment }) {
  return (
    <div className={cn('mt-2 grid grid-cols-[1fr_auto] items-end gap-3 rounded-md border px-3 py-2', BRAND_BORDER, PRINT_PLAIN)}>
      {/* No station on the slip: there is one weighbridge, so naming it told the
          customer nothing. The id is still recorded against every weighment. */}
      <p className="text-[7px] leading-[1.2]">Operator: {weighment.operator_username}</p>

      <div className="w-[52mm] text-center">
        <p className="text-[9px] font-bold uppercase tracking-wide">Weighing Officer Signature</p>
        <p className="urdu text-[8px] leading-relaxed">وزن کرنے والے افسر کے دستخط</p>
        <p className="mt-3 border-t border-dashed border-black/60 pt-0.5 text-[7px]">&nbsp;</p>
      </div>
    </div>
  );
}

/* ── Branded header & footer — hidden when printing ────────────────────── */

function ReceiptHeader({ company }: { company: ReceiptCompany }) {
  return (
    <header className={cn(SOFT_ONLY_CLASS, 'border-b-4 px-5 pb-3 pt-5', BRAND_BORDER)}>
      <div className="flex items-end justify-between gap-4">
        {company.logoUrl ? (
          // The mark already says "Suarza International" — repeating it in
          // text beside it just competes with itself.
          <img src={company.logoUrl} alt={company.name} className="h-16 w-auto object-contain" />
        ) : (
          <h1 className={cn('text-2xl font-bold uppercase leading-tight tracking-wide', BRAND)}>
            {company.name}
          </h1>
        )}

        <div className="min-w-0 text-right text-[11px] leading-snug">
          <p>{company.address}</p>
          <p className="font-semibold">{company.phone}</p>
        </div>
      </div>
    </header>
  );
}

function ReceiptFooter({ company }: { company: ReceiptCompany }) {
  return (
    <footer className={cn(SOFT_ONLY_CLASS, 'border-t-2 px-5 pb-5 pt-2 text-center', BRAND_BORDER)}>
      <p className="text-[10px]">
        {company.name} · {company.phone}
      </p>
      <p className="text-[10px]">
        This receipt is generated from the weighbridge record and is valid without a signature.
      </p>
    </footer>
  );
}

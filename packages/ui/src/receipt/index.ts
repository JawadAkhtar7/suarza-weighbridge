export { Receipt } from './receipt.js';
export type { ReceiptProps, ReceiptCompany } from './receipt.js';
export {
  buildPageStyle,
  buildTestPrintStyle,
  PRINT_BLOCK_CLASS,
  SOFT_ONLY_CLASS,
} from './print-style.js';

// The client's A5 slip — the paper form, the overprint onto pre-printed pads,
// and the page behind the QR code. See ./slip/layout.ts.
export * from './slip/index.js';

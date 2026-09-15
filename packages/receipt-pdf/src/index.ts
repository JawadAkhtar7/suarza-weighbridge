/**
 * Receipt PDF generation.
 *
 * Its own package because BOTH Node tiers need it and neither can borrow the
 * other's copy: the cloud server serves the PDF behind the QR code, and the
 * agent serves it to the operator — who must be able to download a receipt
 * with no internet at all. PDFKit is Node-only, so this cannot live in the
 * isomorphic `shared` package.
 */

export { buildReceiptPdf, pdfFileName } from './build-pdf.js';
export type { BuildPdfOptions, PdfCompany } from './build-pdf.js';

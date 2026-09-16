/**
 * The one page left behind the QR code.
 *
 * Scanning a slip now goes straight to the PDF — `/r/:slip` redirects to
 * `/r/:slip/pdf`, so the driver gets the file rather than a page with a button
 * on it. The only thing still rendered here is the answer when there is no such
 * record, which is a real and expected outcome: the QR is printed the instant a
 * truck is weighed, and the record reaches the cloud a moment later.
 *
 * That leaves one small page with no JavaScript, no framework and no build
 * step. It used to server-render the shared Receipt component against a
 * compiled Tailwind stylesheet, which cost a watcher in the dev script, a
 * separate CSS build on deploy, and a run of bugs all its own — an uncompiled
 * stylesheet served as-is, a JSX transform that needed React in scope, and a
 * font-smoothing rule that made the same receipt look a different size here
 * than on the operator's screen. None of it was buying anything once the page
 * stopped showing a receipt.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Enough CSS for one card of text, inline.
 *
 * A phone at a weighbridge gate is on whatever signal it can find, and a
 * stylesheet that has to be fetched is one more thing between a driver and an
 * answer.
 */
const STYLE = `
  :root { color-scheme: light; }
  body {
    margin: 0;
    padding: 24px 16px;
    background: #f5f5f5;
    color: #171717;
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 34rem; margin: 0 auto; }
  .card {
    background: #fff;
    border-radius: 12px;
    padding: 32px 24px;
    text-align: center;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.1), 0 1px 2px rgb(0 0 0 / 0.06);
  }
  h1 { margin: 0; font-size: 1.25rem; color: #155932; }
  p { margin: 12px 0 0; font-size: 0.9rem; line-height: 1.5; color: #525252; }
  .slip { font-weight: 600; color: #171717; }
  .quiet { margin-top: 24px; font-size: 0.78rem; color: #737373; }
`;

export function renderNotFoundPage(slipNumber: string, companyName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Receipt ${escapeHtml(slipNumber)} — not found</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <div class="card">
    <h1>Receipt not available yet</h1>
    <p>
      We have no record for slip
      <span class="slip">${escapeHtml(slipNumber)}</span>.
    </p>
    <p>
      If this slip was issued just now, the weighbridge may not have sent it yet —
      that happens within seconds of the connection returning. Try again shortly.
    </p>
    <p class="quiet">
      Check the number on your slip, or contact ${escapeHtml(companyName)}.
    </p>
  </div>
</main>
</body>
</html>`;
}

import { describe, expect, it } from 'vitest';
import { buildReceiptUrl, defaultReceiptSettings } from '../src/lib/receipt-settings.js';

describe('buildReceiptUrl', () => {
  it('builds the cloud receipt URL for a slip (brief §8)', () => {
    expect(buildReceiptUrl('https://wb.example.com', 'SI-000123')).toBe(
      'https://wb.example.com/r/SI-000123',
    );
  });

  it('tolerates a trailing slash on the configured address', () => {
    expect(buildReceiptUrl('https://wb.example.com/', 'SI-000123')).toBe(
      'https://wb.example.com/r/SI-000123',
    );
  });

  it('returns null until the cloud address is configured', () => {
    // A QR that resolves nowhere must never be printed on a customer receipt.
    expect(buildReceiptUrl('', 'SI-000123')).toBeNull();
    expect(buildReceiptUrl('   ', 'SI-000123')).toBeNull();
  });

  it('escapes a slip number rather than pasting it into the URL raw', () => {
    expect(buildReceiptUrl('https://wb.example.com', 'SI 000123')).toBe(
      'https://wb.example.com/r/SI%20000123',
    );
  });
});

describe('defaults', () => {
  it('starts on A5 with no offsets — the one paper the station prints on', () => {
    const settings = defaultReceiptSettings();
    expect(settings.print.paper_size).toBe('A5');
    expect(settings.print.offset_top_mm).toBe(0);
    expect(settings.print.scale_percent).toBe(100);
  });

  it('prints automatically after a save by default', () => {
    expect(defaultReceiptSettings().auto_print).toBe(true);
  });

  it('has no receipt web address until the cloud server is live', () => {
    expect(defaultReceiptSettings().receipt_base_url).toBe('');
  });
});

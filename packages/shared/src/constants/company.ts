/**
 * Suarza's own details, as they appear on every slip.
 *
 * Hard-coded, in one place, on purpose.
 *
 * They used to live in three: the operator's Settings screen, the station
 * profile that rode along with every sync batch, and a set of COMPANY_*
 * environment variables on the cloud. That is three chances for the paper slip,
 * the page behind its own QR code and the manager's reprint to disagree about
 * the company's phone number — and three places to edit when it changes.
 *
 * They are not a setting because nobody at a weighbridge should be able to
 * change the company's address by mistake, and not configuration because they
 * are the same for every station this software will ever run on. Changing them
 * is a code change: edit here, push, and the operator presses Update.
 */

export const COMPANY = {
  name: 'Suarza International',
  phone: '+92 300 1231231',
  website: 'www.suarza.com',
  /**
   * Printed as two lines on the slip, exactly as written here — the artwork
   * gives the header two lines and this is how the client writes it.
   */
  addressLines: ['2 Km, Chowk Hujra Shah Muqeem,', 'Near Hansa Wala Morr,Kasur Road Depalpur'],
} as const;

/** The address as one string, for anywhere that wants it on a single line. */
export const COMPANY_ADDRESS = COMPANY.addressLines.join(' ');

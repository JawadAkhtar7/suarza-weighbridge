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

/**
 * What a slip says when its load is the customer's own figure.
 *
 * Printed on the container re-weigh (step 4), where nothing was weighed: the
 * customer declares what is inside the container and the slip is issued on
 * that declaration. The wording is the client's own, and it is on BOTH the
 * soft copy and the paper — a disclaimer that only appeared on the screen
 * copy would be a disclaimer on the one copy nobody keeps.
 */
export const OWNER_DECLARATION =
  '* Manual Weight declared by owner; SUARZA Kanta is not responsible for its accuracy.';

/**
 * Taken off a declared payload before the slip is issued.
 *
 * The client's rule, not an arithmetic one: the figure the owner gives is
 * for the goods, and this is the allowance the yard applies to it.
 */
export const DECLARED_PAYLOAD_DEDUCTION_KG = 100;

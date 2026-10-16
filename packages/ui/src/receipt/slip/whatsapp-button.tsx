/**
 * "WhatsApp" — the slip on the clipboard, WhatsApp Desktop open beside it.
 *
 * Press it, pick a chat, press Ctrl+V. The paste does not consume the
 * clipboard, so the same press covers as many chats and groups as the slip
 * needs to reach.
 *
 * This replaced `navigator.share`, which needs no pasting and could not be
 * relied on: see share.ts for the Windows behaviour that made the first press
 * of every session a minute of nothing. One keystroke, every time, beats no
 * keystroke most of the time — especially with a driver at the window.
 *
 * The picture is still drawn before the button is pressed, and still checked
 * before it is used; that part was hard-won and none of it changed.
 */

import * as React from 'react';
import { Button, type ButtonProps } from '../../components/ui/button.js';
import { toast } from '../../components/ui/sonner.js';
import {
  canvasToFile,
  copyImageToClipboard,
  downloadFile,
  openWhatsAppApp,
  renderSlipCanvas,
} from './share.js';

/**
 * WhatsApp's own glyph, drawn rather than fetched.
 *
 * lucide dropped its brand icons, and the point of this button is that an
 * operator picks it out of a row of buttons without reading — which a generic
 * speech bubble does not achieve.
 */
function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.08-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.42-.07-.13-.27-.2-.57-.35Z" />
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.33 4.96L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.02h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.17 8.17 0 0 1-1.25-4.35c0-4.53 3.69-8.22 8.23-8.22 2.2 0 4.26.86 5.81 2.41a8.16 8.16 0 0 1 2.41 5.82c0 4.54-3.7 8.2-8.23 8.2Z" />
    </svg>
  );
}

export interface WhatsAppShareButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  /**
   * The slip on screen.
   *
   * A getter rather than the element, because the caller usually has a ref
   * and a ref read at render time is a ref read too early.
   */
  target: () => HTMLElement | null;
  /** The sent file's name, without an extension. Also keys the drawing. */
  fileName: string;
  children?: React.ReactNode;
}

export function WhatsAppShareButton({
  target,
  fileName,
  variant = 'outline',
  children = 'WhatsApp',
  disabled,
  ...rest
}: WhatsAppShareButtonProps) {
  const canvas = React.useRef<HTMLCanvasElement | null>(null);
  /** The JPEG, made up front so `canShare` can be asked inside the click. */
  const file = React.useRef<File | null>(null);
  const [ready, setReady] = React.useState(false);

  /**
   * Draw the slip, and keep both the canvas and the file it makes.
   *
   * False when the window is not in front, which is less a failure than a
   * "not now": the drawing is tried again the moment it is.
   */
  const draw = React.useCallback(async (): Promise<boolean> => {
    const node = target();
    if (!node) return false;

    try {
      const drawn = await renderSlipCanvas(node);
      canvas.current = drawn;
      file.current = await canvasToFile(drawn, fileName, 'image/jpeg');
      return true;
    } catch {
      canvas.current = null;
      file.current = null;
      return false;
    }
    // `target` is a fresh closure every render; the slip it points at is what
    // matters, and that changes with the file name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName]);

  /*
   * Drawn as soon as the window is in front, and kept trying until it is.
   *
   * KEEPING TRYING is the point. Drawing needs this window in front, and the
   * minutes after a slip is saved are full of reasons it is not: the app
   * opens the print tab by itself, the print dialog takes the focus from
   * that, a driver asks something and the operator alt-tabs. Attempting only
   * when focus returns sounds equivalent and is not — a single attempt that
   * lands in one of those gaps leaves the slip undrawn, and nothing tries
   * again until the operator happens to leave the window and come back.
   *
   * That was the whole bug: with nothing drawn, pressing the button could not
   * offer the share sheet — handing a file to WhatsApp needs the finished
   * file inside the click itself — so it quietly took the clipboard route
   * instead. Which looked, from the outside, exactly like Windows refusing.
   */
  React.useEffect(() => {
    let cancelled = false;
    canvas.current = null;
    file.current = null;
    setReady(false);

    let timer = 0;
    let attempts = 0;

    const attempt = () => {
      if (cancelled || file.current) return;

      window.clearTimeout(timer);
      /* The first wait is longer: nobody looks at this button in the half
         second after a save, and the photographs are still arriving. */
      timer = window.setTimeout(
        () => {
          if (cancelled || file.current) return;
          attempts += 1;

          void draw().then((done) => {
            if (cancelled) return;
            if (done) {
              setReady(true);
              return;
            }
            // Not in front, or not ready. Try again, for a while.
            if (attempts < 40) attempt();
          });
        },
        attempts === 0 ? 400 : 1500,
      );
    };

    attempt();
    /* Still worth listening: coming back to the window is the likeliest
       moment for an attempt to succeed, and waiting out the interval would
       be a second and a half of the button being the lesser thing. */
    document.addEventListener('visibilitychange', attempt);
    window.addEventListener('focus', attempt);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', attempt);
      window.removeEventListener('focus', attempt);
    };
  }, [draw]);

  /**
   * The press, in one place so the draw-then-send path can repeat it.
   *
   * A ref because `send` refers to itself: a first press that finds nothing
   * drawn draws it and then carries on, rather than making the operator press
   * twice for the first slip of a session.
   */
  const sendRef = React.useRef<() => void>(() => undefined);

  /**
   * Copy the slip and open WhatsApp.
   *
   * The order matters: a clipboard write needs this document focused, and
   * launching WhatsApp takes the focus away. Copy first, then launch.
   */
  const send = () => {
    const drawn = canvas.current;

    if (!drawn) {
      /* Not drawn yet. The window is in front now — they just pressed a
         button on it — so draw, and carry straight on once it is there. */
      void draw().then((done) => {
        if (!done) {
          toast.error('Could not draw the slip', {
            description: 'Keep this window in front and press WhatsApp again.',
          });
          return;
        }
        setReady(true);
        sendRef.current();
      });
      return;
    }

    /*
     * Encoded and copied in one step, the blob handed over as a promise.
     * Browsers tie a clipboard write to the click behind it, and awaiting the
     * encoding first is long enough to lose that claim.
     */
    void copyImageToClipboard(canvasToFile(drawn, fileName, 'image/png'))
      .then(() => {
        openWhatsAppApp();
        toast.success('Slip copied — WhatsApp opening', {
          description:
            'Pick a chat and press Ctrl+V. It stays copied, so you can paste it into as many chats as you like.',
          duration: 12_000,
        });
      })
      .catch((error: unknown) => {
        console.warn('Could not copy the slip:', error);

        /*
         * The one fallback left, and it is not a different errand: the file
         * goes to Downloads and WhatsApp still opens, so the operator drags
         * it in rather than pasting. Said plainly, because it is a different
         * set of keystrokes from the one they were expecting.
         */
        void canvasToFile(drawn, fileName, 'image/png')
          .then((png) => {
            downloadFile(png);
            openWhatsAppApp();
            toast.warning('Slip downloaded instead', {
              description:
                'This PC would not let the page copy a picture. Drag the downloaded file into the chat.',
              duration: 20_000,
            });
          })
          .catch(() => {
            toast.error('Could not prepare the slip', {
              description: 'Please try again, or print it and send a photograph.',
            });
          });
      });
  };

  sendRef.current = send;

  return (
    <Button type="button" variant={variant} onClick={send} disabled={disabled} {...rest}>
      <WhatsAppGlyph className="h-4 w-4" />
      {children}
      {/* Never disabled: if the slip is not drawn yet the press draws it,
          with the window in front by definition. Said only to a screen
          reader, because a label that flickers between two words on a button
          an operator is about to press is worse than one that does not. */}
      {!ready && <span className="sr-only">(preparing)</span>}
    </Button>
  );
}

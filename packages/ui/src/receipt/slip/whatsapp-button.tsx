/**
 * "WhatsApp" — the slip, sent from the app that just printed it.
 *
 * The picture is drawn BEFORE the button is pressed, a moment after the slip
 * appears, and three things depend on that:
 *
 *   it is instant     the click has nothing to wait for
 *   it is not blank   drawing happens while this tab is the focused one.
 *                     Drawing it after a new tab had been opened put the work
 *                     in a background tab, where Chrome throttles timers to a
 *                     crawl: the picture came out white and the new tab sat
 *                     on about:blank until the operator clicked back.
 *   it can share      `navigator.canShare` needs the finished file to answer,
 *                     and the answer has to be known inside the click itself
 *
 * See share.ts for what the two routes out are and why neither can attach a
 * file to WhatsApp Web for you.
 */

import * as React from 'react';
import { Button, type ButtonProps } from '../../components/ui/button.js';
import { toast } from '../../components/ui/sonner.js';
import { canShareFile, canvasToFile, renderSlipCanvas } from './share.js';

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
   * The share we are waiting on, if any, by attempt number.
   *
   * Numbered rather than a flag because a hung attempt has to be told apart
   * from the one after it. On this machine the FIRST share of a session does
   * not open a dialog at all: Windows spins — the cursor goes busy — for the
   * best part of a minute and then fails with `AbortError: Share Error`, and
   * the very next press opens the dialog at once. Whatever is cold in the
   * system's share stack, the first call warms it.
   *
   * So a hung attempt is given up on quickly and the operator invited to
   * press again, which works. When the abandoned one finally does fail, its
   * number no longer matches and it is allowed to die quietly rather than
   * throwing an error over a slip that has since gone.
   */
  const sharing = React.useRef(0);
  const attempts = React.useRef(0);
  /** Re-rendered while a share is outstanding, so the button can say so. */
  const [waiting, setWaiting] = React.useState(false);

  /**
   * The press, in one place so a failed attempt can offer to repeat it.
   *
   * Held in a ref because the retry lives inside a toast raised by this very
   * function: pressing that button is a fresh gesture, which is the only way
   * `navigator.share` can be called again — a retry on a timer would be
   * refused for having no press behind it.
   */
  const sendRef = React.useRef<() => void>(() => undefined);

  /**
   * Hand the slip to Windows, which asks the operator which app gets it.
   *
   * ONE ROUTE, and no fallback. Copying to the clipboard or opening WhatsApp
   * Web instead is a different job the operator did not ask for, and doing it
   * silently is what made an occasional refusal look like random behaviour.
   * If this cannot be done, it says so and offers to try again.
   *
   * Every refusal below is reported with the name the browser gave it. There
   * are several quite different reasons Chrome says no on Windows, they are
   * indistinguishable from the outside, and the one that mattered could not
   * be caught by somebody opening the console while it happened.
   */
  const send = () => {
    const drawn = file.current;

    if (!drawn) {
      /* Not drawn yet. The window is in front now — they just pressed a
         button on it — so draw, then let them press again: `share` only runs
         while the browser still sees that press, and it is long gone by the
         time a slip has been drawn. */
      void draw().then((done) => {
        if (done) {
          setReady(true);
          toast.info('Slip ready', {
            description: 'Press WhatsApp again to choose where it goes.',
          });
        } else {
          toast.error('Could not draw the slip', {
            description: 'Keep this window in front and press WhatsApp again.',
          });
        }
      });
      return;
    }

    if (sharing.current) {
      /*
       * Chrome holds a lock of its own for as long as a share is outstanding
       * and refuses any other with `InvalidStateError: An earlier share has
       * not yet completed`. So pressing again here cannot work, whatever the
       * button looks like, and inviting it was worse than saying nothing.
       */
      toast.info('Windows is still working on it', {
        description: 'The first one can take a minute. It will say when it is ready.',
      });
      return;
    }

    if (!canShareFile(drawn)) {
      /* Chrome itself says this machine cannot pass a file to another app —
         no WhatsApp, no Mail, nothing. Worth saying plainly rather than
         quietly doing something else. */
      toast.error('This PC cannot pass files to other apps', {
        description: 'Chrome reports no file sharing on this machine.',
        duration: 20_000,
      });
      return;
    }

    const attempt = (attempts.current += 1);
    sharing.current = attempt;
    setWaiting(true);

    /*
     * Waited out, not given up on.
     *
     * Abandoning the wait early was tried and made things worse: Chrome's own
     * lock is still held by the outstanding call, so the press it invited
     * failed with `InvalidStateError` every time. There is nothing to do with
     * a hung share but wait for it to fail — after which the next one works.
     *
     * The timer is only a backstop against a promise that never settles at
     * all, which would otherwise leave the button saying "waiting" for ever.
     */
    const backstop = window.setTimeout(() => {
      if (sharing.current !== attempt) return;
      sharing.current = 0;
      setWaiting(false);
    }, 120_000);

    const settled = () => {
      window.clearTimeout(backstop);
      if (sharing.current === attempt) {
        sharing.current = 0;
        setWaiting(false);
      }
    };

    /* No title and no text: the file name carries the slip number, and the
       fewer things a share target has to accept, the fewer ways it refuses. */
    void navigator
      .share({ files: [drawn] })
      .then(settled)
      .catch((error: unknown) => {
        settled();

        const name = error instanceof Error ? error.name : 'unknown';
        const message = error instanceof Error ? error.message : String(error);
        console.warn('Web Share refused the slip:', name, message, error);

        if (attempt !== attempts.current) return;

        /*
         * Chrome reports a cancelled dialog and a broken one under the SAME
         * name — AbortError — and only the message tells them apart. A
         * dismissed dialog is a decision and says nothing; anything else
         * belongs on the screen.
         */
        if (name === 'AbortError' && !/internal|error|fail/i.test(message)) return;

        /*
         * Not an apology: an invitation.
         *
         * A failure here is almost always the cold first call, and the next
         * attempt opens the dialog at once — the lock this one was holding is
         * released by its own failure. So the operator is told it is ready
         * and given a button, which is also the gesture `navigator.share`
         * needs: a retry on a timer would be refused for having no press
         * behind it.
         */
        toast.warning('Windows is ready now', {
          description: `Press Send to choose the app (first try: ${name}).`,
          duration: Number.POSITIVE_INFINITY,
          action: { label: 'Send', onClick: () => sendRef.current() },
        });
      });
  };

  sendRef.current = send;

  return (
    <Button
      type="button"
      variant={variant}
      onClick={send}
      /* Nothing can be shared while Chrome holds its lock, so the button says
         so rather than letting a press earn an InvalidStateError. */
      disabled={disabled || waiting}
      {...rest}
    >
      <WhatsAppGlyph className="h-4 w-4" />
      {waiting ? 'Waiting for Windows…' : children}
      {/* Never disabled: if the slip is not drawn yet the press draws it,
          with the window in front by definition. Said only to a screen
          reader, because a label that flickers between two words on a button
          an operator is about to press is worse than one that does not. */}
      {!ready && <span className="sr-only">(preparing)</span>}
    </Button>
  );
}

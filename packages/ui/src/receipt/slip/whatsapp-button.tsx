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
import {
  canShareFile,
  canvasToFile,
  downloadFile,
  renderSlipCanvas,
  WHATSAPP_WEB_URL,
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
  const [drawing, setDrawing] = React.useState(true);

  /*
   * Drawn shortly after the slip appears, while this tab still has focus.
   *
   * Deferred rather than immediate so it does not compete with the print tab
   * opening and the photographs arriving — the operator is not looking at
   * this button in the first half second.
   */
  React.useEffect(() => {
    let cancelled = false;
    canvas.current = null;
    file.current = null;
    setDrawing(true);

    const timer = window.setTimeout(() => {
      const node = target();
      if (!node) {
        if (!cancelled) setDrawing(false);
        return;
      }

      void renderSlipCanvas(node)
        .then(async (drawn) => {
          if (cancelled) return;
          canvas.current = drawn;
          file.current = await canvasToFile(drawn, fileName, 'image/jpeg');
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setDrawing(false);
        });
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `target` is a fresh closure every render; the slip it points at is what
    // matters, and that changes with the file name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName]);

  /**
   * The route with no pasting in it.
   *
   * Called synchronously from the click so the browser still counts it as the
   * operator's own action, which `navigator.share` requires.
   */
  const shareToApp = (ready: File): boolean => {
    if (!canShareFile(ready)) return false;
    void navigator.share({ files: [ready], title: fileName }).catch((error: unknown) => {
      // Closing the share sheet without choosing is not a failure.
      if (error instanceof Error && error.name === 'AbortError') return;
      toast.error('Could not hand the slip to WhatsApp', {
        description: 'Try again, or use the clipboard: press WhatsApp once more.',
      });
    });
    return true;
  };

  /** The route through WhatsApp Web: copy, open, paste. */
  const shareThroughWeb = async (): Promise<void> => {
    const drawn = canvas.current;
    if (!drawn) throw new Error('The slip has not been drawn');

    const png = await canvasToFile(drawn, fileName, 'image/png');

    try {
      /*
       * The clipboard FIRST, and only then the new tab. A clipboard write
       * needs this document focused, and opening WhatsApp first takes the
       * focus away — the write then fails with nothing to show for it.
       */
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } catch {
      downloadFile(png);
      window.open(WHATSAPP_WEB_URL, '_blank');
      toast.warning('Slip downloaded instead', {
        description:
          'This browser would not let the page copy a picture. Drag the downloaded file into the chat.',
      });
      return;
    }

    const tab = window.open(WHATSAPP_WEB_URL, '_blank');
    toast.success('Slip copied', {
      description: tab
        ? 'In WhatsApp, open the chat and press Ctrl+V to attach it.'
        : 'Open WhatsApp Web, open the chat and press Ctrl+V to attach it.',
    });
  };

  const send = () => {
    const ready = file.current;

    if (ready && shareToApp(ready)) return;

    if (!canvas.current) {
      toast.error('The slip is not ready yet', {
        description: 'Give it a moment and press WhatsApp again.',
      });
      return;
    }

    void shareThroughWeb().catch(() => {
      toast.error('Could not prepare the slip', {
        description: 'Please try again, or print it and send a photograph.',
      });
    });
  };

  return (
    <Button type="button" variant={variant} onClick={send} disabled={disabled || drawing} {...rest}>
      <WhatsAppGlyph className="h-4 w-4" />
      {drawing ? 'Preparing…' : children}
    </Button>
  );
}

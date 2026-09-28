/**
 * Listen to the indicator and show exactly what it sends — `pnpm sniff`.
 *
 * Run this before touching any configuration. Every indicator in this class
 * claims to speak "RS232" and then emits its own frame shape, so the only
 * reliable way to configure the parser is to look at the bytes. Output is shown
 * as printable text AND hex, because the framing characters (STX, CR, LF) are
 * the part that decides how lines are split, and they are invisible otherwise.
 *
 *   pnpm --filter @suarza/agent sniff                  # list the ports
 *   pnpm --filter @suarza/agent sniff COM3             # listen at 9600
 *   pnpm --filter @suarza/agent sniff COM3 4800        # listen at 4800
 *   pnpm --filter @suarza/agent sniff COM3 scan        # try every common baud
 */

import { SerialPort } from 'serialport';

const COMMON_BAUD = [9600, 4800, 19200, 2400, 38400, 1200, 57600, 115200];

function printable(buffer: Buffer): string {
  return [...buffer]
    .map((byte) => {
      if (byte === 0x02) return '<STX>';
      if (byte === 0x03) return '<ETX>';
      if (byte === 0x0d) return '<CR>';
      if (byte === 0x0a) return '<LF>\n';
      return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : `<${byte.toString(16).padStart(2, '0')}>`;
    })
    .join('');
}

async function listPorts(): Promise<void> {
  const ports = await SerialPort.list();
  if (ports.length === 0) {
    console.log('No serial ports found.');
    console.log('On Windows, check Device Manager → Ports (COM & LPT).');
    console.log('A USB-to-RS232 adapter needs its driver installed before it appears.');
    return;
  }
  console.log('Serial ports on this machine:\n');
  for (const port of ports) {
    /* `friendlyName` is Windows-only and absent from the cross-platform type,
       but it is the field that says "USB Serial Port (COM3)" — worth showing. */
    const windows = port as typeof port & { friendlyName?: string };
    const parts = [port.path];
    if (windows.friendlyName && windows.friendlyName !== port.path) parts.push(windows.friendlyName);
    if (port.manufacturer) parts.push(port.manufacturer);
    console.log('  ' + parts.join('  —  '));
  }
  console.log('\nThen: pnpm --filter @suarza/agent sniff <PORT> [baud|scan]');
}

/** Listens for a few seconds and reports whether anything readable arrived. */
function listen(path: string, baudRate: number, seconds: number): Promise<number> {
  return new Promise((resolve) => {
    let bytes = 0;
    const port = new SerialPort({ path, baudRate, dataBits: 8, stopBits: 1, parity: 'none' }, (error) => {
      if (error) {
        console.error(`Could not open ${path} at ${baudRate}: ${error.message}`);
        resolve(0);
      }
    });

    port.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      process.stdout.write(printable(chunk));
    });

    setTimeout(() => {
      port.close(() => resolve(bytes));
    }, seconds * 1000);
  });
}

async function main(): Promise<void> {
  const [path, baudArg] = process.argv.slice(2);

  if (!path) {
    await listPorts();
    return;
  }

  if (baudArg === 'scan') {
    console.log(`Scanning ${path} — 4 seconds per speed. Put some weight on the scale.\n`);
    for (const baudRate of COMMON_BAUD) {
      console.log(`\n--- ${baudRate} baud ---`);
      const bytes = await listen(path, baudRate, 4);
      console.log(`\n(${bytes} bytes)`);
      // Garbage arrives at the wrong speed too, so the eye decides: the right
      // baud rate is the one where the numbers look like the display.
    }
    console.log('\nThe correct speed is the one whose output matches the indicator display.');
    return;
  }

  const baudRate = Number(baudArg ?? 9600);
  console.log(`Listening on ${path} at ${baudRate} baud. Ctrl-C to stop.\n`);
  await listen(path, baudRate, 3600);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

/**
 * Serial indicator reader (RS-232/USB).
 *
 * The port is opened lazily and re-opened with backoff: at a weighbridge the
 * indicator gets switched off overnight, unplugged by a cleaner, or hidden
 * behind a USB hub that re-enumerates the port. None of that may kill the
 * agent — the operator falls back to manual entry (brief §3B, §7.5) and the
 * reader quietly keeps trying until the hardware comes back.
 */

import { BaseWeightReader } from './reader.js';
import { WeightParser, type ParserConfig } from './parser.js';

export interface SerialReaderOptions extends ParserConfig {
  path: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 1.5 | 2;
  parity: 'none' | 'even' | 'odd' | 'mark' | 'space';
  /** Line framing, already unescaped (`\r\n`, not the literal characters). */
  delimiter: string;
  staleMs: number;
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];

interface MinimalPort {
  isOpen: boolean;
  close(callback?: (error?: Error | null) => void): void;
}

export class SerialWeightReader extends BaseWeightReader {
  readonly kind = 'serial' as const;

  private port: MinimalPort | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private stopped = false;
  private readonly parser: WeightParser;
  /** Counts lenient-fallback parses so a wrong SERIAL_PATTERN is visible. */
  private fallbackParses = 0;
  private unparsedLines = 0;

  constructor(private readonly options: SerialReaderOptions) {
    super(options.staleMs);
    this.parser = new WeightParser(options);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.open();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.closePort();
    this.portOpen = false;
  }

  getDiagnostics(): { fallbackParses: number; unparsedLines: number; reconnectAttempt: number } {
    return {
      fallbackParses: this.fallbackParses,
      unparsedLines: this.unparsedLines,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.options.onLog?.(level, message);
  }

  private async open(): Promise<void> {
    if (this.stopped) return;

    try {
      // Imported here rather than at module load so the native bindings are
      // never touched when the simulator is in use — which is every dev
      // machine and every CI run.
      const { SerialPort, DelimiterParser } = await import('serialport');

      const port = new SerialPort({
        path: this.options.path,
        baudRate: this.options.baudRate,
        dataBits: this.options.dataBits,
        stopBits: this.options.stopBits,
        parity: this.options.parity,
        autoOpen: false,
      });

      await new Promise<void>((resolve, reject) => {
        port.open((error) => (error ? reject(error) : resolve()));
      });

      const lineStream = port.pipe(
        new DelimiterParser({ delimiter: Buffer.from(this.options.delimiter) }),
      );

      lineStream.on('data', (chunk: Buffer) => this.handleLine(chunk.toString('ascii')));

      port.on('error', (error: Error) => {
        this.fail(`Serial error: ${error.message}`);
        this.log('error', `Serial error on ${this.options.path}: ${error.message}`);
        void this.scheduleReconnect();
      });

      port.on('close', () => {
        this.portOpen = false;
        this.fail('Serial port closed');
        this.log('warn', `Serial port ${this.options.path} closed`);
        void this.scheduleReconnect();
      });

      this.port = port;
      this.portOpen = true;
      this.reconnectAttempt = 0;
      this.log(
        'info',
        `Indicator connected on ${this.options.path} @ ${this.options.baudRate} baud`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.portOpen = false;
      this.fail(`Cannot open ${this.options.path}: ${message}`);
      this.log('warn', `Cannot open ${this.options.path}: ${message}`);
      await this.scheduleReconnect();
    }
  }

  private handleLine(line: string): void {
    const reading = this.parser.parse(line);
    if (!reading) {
      this.unparsedLines += 1;
      // Noisy lines are normal on startup (partial frames, status banners), so
      // this is counted rather than logged per line.
      return;
    }
    if (reading.fallback) this.fallbackParses += 1;
    this.record(reading.weightKg, reading.stable);
  }

  private scheduleReconnect(): Promise<void> {
    if (this.stopped || this.reconnectTimer) return Promise.resolve();

    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!;
    this.reconnectAttempt += 1;

    return this.closePort().then(() => {
      if (this.stopped) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.open();
      }, delay);
      this.reconnectTimer.unref?.();
    });
  }

  private closePort(): Promise<void> {
    const port = this.port;
    this.port = null;
    if (!port?.isOpen) return Promise.resolve();
    return new Promise<void>((resolve) => {
      port.close(() => resolve());
    });
  }
}

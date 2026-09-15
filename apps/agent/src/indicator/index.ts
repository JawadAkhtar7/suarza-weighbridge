/** Chooses the indicator implementation from config (brief §13-M1). */

import type { AgentConfig } from '../config.js';
import { unescapeDelimiter } from '../config.js';
import type { WeightReader } from './reader.js';
import { SerialWeightReader } from './serial-reader.js';
import { SimulatorWeightReader } from './simulator.js';

export type { WeightReader } from './reader.js';
export { SimulatorWeightReader } from './simulator.js';
export { SerialWeightReader } from './serial-reader.js';
export { WeightParser, DEFAULT_WEIGHT_PATTERN } from './parser.js';

export interface CreateReaderOptions {
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export function createWeightReader(
  config: AgentConfig,
  { onLog }: CreateReaderOptions = {},
): WeightReader {
  if (config.USE_SIMULATOR) {
    onLog?.('info', 'Weight simulator enabled — no serial hardware required');
    return new SimulatorWeightReader({ staleMs: config.READING_STALE_MS });
  }

  return new SerialWeightReader({
    path: config.SERIAL_PORT,
    baudRate: config.SERIAL_BAUD_RATE,
    dataBits: config.SERIAL_DATA_BITS as 5 | 6 | 7 | 8,
    stopBits: config.SERIAL_STOP_BITS as 1 | 1.5 | 2,
    parity: config.SERIAL_PARITY,
    delimiter: unescapeDelimiter(config.SERIAL_DELIMITER),
    pattern: config.SERIAL_PATTERN,
    unit: config.SERIAL_UNIT,
    staleMs: config.READING_STALE_MS,
    onLog,
  });
}

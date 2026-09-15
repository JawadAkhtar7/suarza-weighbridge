/**
 * The agent's one connection to the outside world (brief §4, §12).
 *
 * It holds an ingest API key and nothing else — no database credential ever
 * reaches the factory PC, so a compromised weighbridge machine can push
 * weighments and do nothing more.
 */

import type { AuditEntry, IngestResponse, Weighment } from '@suarza/shared';

export interface CloudClientOptions {
  baseUrl: string;
  apiKey: string;
  stationId: string;
  /** A stalled request must not wedge the worker; the retry will come round. */
  timeoutMs?: number;
}

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** False for a network failure — worth retrying immediately on reconnect. */
    readonly isServerResponse: boolean,
  ) {
    super(message);
    this.name = 'CloudError';
  }
}

export interface CloudClient {
  ingest(weighments: Weighment[], auditEntries: AuditEntry[]): Promise<IngestResponse>;
  ping(): Promise<boolean>;
}

export function createCloudClient(options: CloudClientOptions): CloudClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 20_000;

  async function post(path: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': options.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async ingest(weighments, auditEntries) {
      let response: Response;
      try {
        response = await post('/ingest', {
          station_id: options.stationId,
          weighments,
          audit_entries: auditEntries,
        });
      } catch (error) {
        // No internet, DNS failure, timeout — the normal state at a factory
        // with an intermittent link, and not something to log as an incident.
        const message = error instanceof Error ? error.message : String(error);
        throw new CloudError(`Cannot reach the cloud: ${message}`, null, false);
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new CloudError(
          `Cloud rejected the batch (${response.status}): ${text.slice(0, 300)}`,
          response.status,
          true,
        );
      }

      return (await response.json()) as IngestResponse;
    },

    async ping() {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
        clearTimeout(timer);
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

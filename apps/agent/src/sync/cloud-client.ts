/**
 * The agent's one connection to the outside world (brief §4, §12).
 *
 * It holds an ingest API key and nothing else — no database credential ever
 * reaches the factory PC, so a compromised weighbridge machine can push
 * weighments and do nothing more.
 */

import type { AuditEntry, IngestResponse, StationProfile, Weighment } from '@suarza/shared';

export interface CloudClientOptions {
  baseUrl: string;
  apiKey: string;
  stationId: string;
  /**
   * The station's company details, read fresh on each send.
   *
   * A function rather than a value because Settings can be edited while the
   * agent runs, and a snapshot taken at startup would keep publishing the old
   * address until the next restart.
   */
  profile?: () => StationProfile | null;
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

/** One camera still on its way up. */
export interface CaptureUpload {
  id: string;
  weighmentId: string;
  slipNumber: string;
  pass: 'FIRST' | 'SECOND';
  view: 'FRONT' | 'SIDE';
  takenAt: string;
  body: Buffer;
}

export interface CloudClient {
  ingest(weighments: Weighment[], auditEntries: AuditEntry[]): Promise<IngestResponse>;
  /** Resolves when the cloud has the picture; throws CloudError otherwise. */
  uploadCapture(capture: CaptureUpload): Promise<void>;
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
          // Rides along so the cloud's receipt page shows what this station
          // prints, instead of whatever COMPANY_* on the server happens to say.
          station: options.profile?.() ?? undefined,
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

    /**
     * Send one still.
     *
     * The JPEG goes up as the raw body with its metadata in the query string,
     * rather than as multipart/form-data. Multipart would mean a parser on
     * the server and a form builder here, for a request that carries exactly
     * one file and six short strings. Raw bytes need neither.
     *
     * One picture per request, not a batch: at 23 KB each this is cheap, and
     * a batch that fails half way would have to be unpicked to know which
     * pictures actually landed.
     */
    async uploadCapture(capture) {
      const query = new URLSearchParams({
        weighment_id: capture.weighmentId,
        slip_number: capture.slipNumber,
        pass: capture.pass,
        view: capture.view,
        taken_at: capture.takenAt,
      });

      let response: Response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          response = await fetch(
            `${baseUrl}/ingest/captures/${encodeURIComponent(capture.id)}?${query}`,
            {
              method: 'POST',
              headers: { 'content-type': 'image/jpeg', 'x-api-key': options.apiKey },
              body: new Uint8Array(capture.body),
              signal: controller.signal,
            },
          );
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CloudError(`Cannot reach the cloud: ${message}`, null, false);
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new CloudError(
          `Cloud rejected a camera image (${response.status}): ${text.slice(0, 200)}`,
          response.status,
          true,
        );
      }
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

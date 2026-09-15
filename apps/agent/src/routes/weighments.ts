/** Weighment routes — the operator app's entire write surface (brief §13-M1). */

import type { FastifyInstance } from 'fastify';
import {
  completeWeighmentSchema,
  createWeighmentSchema,
  netWeightAllUnits,
  reprintWeighmentSchema,
  voidWeighmentSchema,
} from '@suarza/shared';
import { buildReceiptPdf, pdfFileName } from '@suarza/receipt-pdf';
import type { AgentDeps } from '../server.js';
import { parse } from './helpers.js';
import { toDto } from '../db/weighments.js';

interface SlipParams {
  slip: string;
}

export function registerWeighmentRoutes(app: FastifyInstance, deps: AgentDeps): void {
  // --- Pass 1 --------------------------------------------------------------
  app.post('/weighments', (request, reply) => {
    const input = parse(createWeighmentSchema, request.body);
    const { weighment, warnings } = deps.service.createFirstWeight(input);

    request.log.info(
      { slip_number: weighment.slip_number, first_weight_kg: weighment.first_weight_kg },
      'First weight saved',
    );

    // 201 with the warnings alongside: a duplicate open plate is advice, so it
    // travels with a successful save rather than replacing it (brief §3B).
    return reply.code(201).send({ weighment, warnings });
  });

  app.get('/weighments', (request) => {
    const query = request.query as { status?: string; limit?: string; offset?: string };
    const rows = deps.service.list({
      status: query.status as never,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });
    return { rows: rows.map(toDto), count: rows.length };
  });

  /**
   * Customers the station has weighed before, for the searchable picker.
   * An empty query returns the most recent, so the dropdown is useful before
   * the operator has typed anything.
   */
  app.get('/customers', (request) => {
    const query = request.query as { q?: string; limit?: string };
    return {
      customers: deps.service.searchCustomers(
        query.q ?? '',
        query.limit ? Math.min(50, Number(query.limit)) : undefined,
      ),
    };
  });

  /**
   * The receipt as a PDF, built here on the weighbridge PC.
   *
   * Deliberately not proxied to the cloud: the operator must be able to hand a
   * customer a PDF with the internet down, which is exactly when the cloud
   * copy is unreachable.
   */
  app.get<{ Params: SlipParams }>('/weighments/:slip/pdf', async (request, reply) => {
    const record = deps.service.getBySlip(request.params.slip);
    const settings = deps.settings?.get();

    const pdf = await buildReceiptPdf({
      weighment: toDto(record),
      company: {
        name: settings?.company_name ?? 'Suarza International',
        address: settings?.company_address ?? '',
        phone: settings?.company_phone ?? '',
      },
      receiptUrl: settings?.receipt_base_url
        ? `${settings.receipt_base_url.replace(/\/+$/, '')}/r/${encodeURIComponent(record.slip_number)}`
        : null,
      // A custom paper size describes the pre-printed pad, not a sheet the PDF
      // can be produced on, so it falls back to the size the slip is drawn at.
      paperSize:
        settings && settings.print.paper_size !== 'CUSTOM' ? settings.print.paper_size : 'A5',
    });

    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${pdfFileName(toDto(record))}"`)
      .send(pdf);
  });

  // --- Pass 2 --------------------------------------------------------------
  app.get<{ Params: SlipParams }>('/weighments/:slip', (request) => {
    const record = deps.service.getBySlip(request.params.slip);
    return {
      weighment: toDto(record),
      // Pre-computed so the completion screen and the receipt can never
      // disagree with each other about the net figure.
      net: netWeightAllUnits(record.first_weight_kg, record.second_weight_kg),
    };
  });

  app.get<{ Params: SlipParams }>('/weighments/:slip/audit', (request) => {
    const record = deps.service.getBySlip(request.params.slip);
    return { entries: deps.service.auditTrail(record.id) };
  });

  app.patch<{ Params: SlipParams }>('/weighments/:slip/complete', (request) => {
    const input = parse(completeWeighmentSchema, request.body);
    const weighment = deps.service.complete(request.params.slip, input);

    request.log.info(
      { slip_number: weighment.slip_number, net_weight_kg: weighment.net_weight_kg },
      'Weighment completed',
    );

    return {
      weighment,
      net: netWeightAllUnits(weighment.first_weight_kg, weighment.second_weight_kg),
    };
  });

  app.post<{ Params: SlipParams }>('/weighments/:slip/void', (request) => {
    const input = parse(voidWeighmentSchema, request.body);
    const weighment = deps.service.void(request.params.slip, input);
    request.log.warn(
      { slip_number: weighment.slip_number, reason: input.reason },
      'Weighment voided',
    );
    return { weighment };
  });

  /**
   * The outbox quarantine: records the cloud permanently refused, and the way
   * back out. Without these a blocked record would be invisible on the
   * weighbridge PC and only recoverable by hand-editing SQLite.
   */
  app.get('/sync/blocked', () => ({ weighments: deps.service.listBlockedSync() }));

  app.post<{ Params: SlipParams }>('/sync/blocked/:slip/retry', (request) => ({
    weighment: deps.service.retrySync(request.params.slip),
  }));

  app.post<{ Params: SlipParams }>('/weighments/:slip/reprint', (request) => {
    const input = parse(reprintWeighmentSchema, request.body);
    const { weighment, entry } = deps.service.recordReprint(request.params.slip, input);
    return {
      weighment,
      net: netWeightAllUnits(weighment.first_weight_kg, weighment.second_weight_kg),
      audit_entry: entry,
    };
  });
}

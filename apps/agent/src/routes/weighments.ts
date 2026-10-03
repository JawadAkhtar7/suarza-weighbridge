/** Weighment routes — the operator app's entire write surface (brief §13-M1). */

import type { FastifyInstance } from 'fastify';
import {
  completeWeighmentSchema,
  createCompletedWeighmentSchema,
  createWeighmentSchema,
  netWeightAllUnits,
  reprintWeighmentSchema,
  voidWeighmentSchema,
} from '@suarza/shared';
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

  /**
   * A weighing done in one visit — the customer told us his empty weight.
   *
   * A static path, so Fastify matches it ahead of `/weighments/:slip`.
   */
  app.post('/weighments/complete', (request, reply) => {
    const input = parse(createCompletedWeighmentSchema, request.body);
    const { weighment, warnings } = deps.service.createCompleted(input);

    request.log.info(
      {
        slip_number: weighment.slip_number,
        first_weight_kg: weighment.first_weight_kg,
        second_weight_kg: weighment.second_weight_kg,
        net_weight_kg: weighment.net_weight_kg,
      },
      'Single-visit weighing saved',
    );

    return reply.code(201).send({
      weighment,
      net: netWeightAllUnits(weighment.first_weight_kg, weighment.second_weight_kg),
      warnings,
    });
  });

  app.get('/weighments', (request) => {
    const query = request.query as {
      status?: string;
      q?: string;
      limit?: string;
      offset?: string;
    };
    const rows = deps.service.list({
      status: query.status as never,
      q: query.q,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });
    // `total` is what lets the operator's list know whether a "Load more"
    // button has anything left to load; `count` is just this page.
    return {
      rows: rows.map(toDto),
      count: rows.length,
      total: deps.service.countWeighments({ status: query.status as never, q: query.q }),
    };
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
   * The slip as a page, rendered here on the weighbridge PC.
   *
   * It was a PDF, drawn a second time by hand with PDFKit. That could never
   * match the paper slip: PDFKit does not shape Arabic script, so it dropped
   * every Urdu label the client's design is built on, and any change to the
   * design had to be made twice. The print tab is now the one rendering, and
   * "Save as PDF" in the browser produces the file at A5 exactly.
   *
   * Still served from the weighbridge and not proxied to the cloud: the
   * operator must be able to hand a customer a copy with the internet down,
   * which is exactly when the cloud copy is unreachable.
   */
  app.get<{ Params: SlipParams }>('/weighments/:slip/pdf', (request, reply) => {
    // Throws a 404 through the usual path if there is no such slip, so the
    // redirect can never point at a page that will not load.
    const record = deps.service.getBySlip(request.params.slip);
    return reply.redirect(`/print/${encodeURIComponent(record.slip_number)}`, 302);
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

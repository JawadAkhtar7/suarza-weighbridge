/**
 * Simulator controls — registered only when `USE_SIMULATOR=true`.
 *
 * These exist so a two-pass transaction can be driven deterministically
 * (park at 8,000 kg, save first weight, park at 20,000 kg, complete) without
 * waiting on the automatic cycle. That makes the M9 end-to-end run repeatable
 * and keeps the operator flows testable with no hardware.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SimulatorWeightReader } from '../indicator/simulator.js';
import { parse } from './helpers.js';

const setWeightSchema = z.object({
  weight_kg: z.number().finite().min(0).max(200_000),
  stable: z.boolean().default(true),
});

const resumeSchema = z.object({
  target_kg: z.number().finite().min(0).max(200_000).optional(),
});

export function registerSimulatorRoutes(
  app: FastifyInstance,
  simulator: SimulatorWeightReader,
): void {
  app.get('/simulator', () => simulator.getState());

  app.post('/simulator/weight', (request) => {
    const input = parse(setWeightSchema, request.body);
    simulator.setWeight(input.weight_kg, { stable: input.stable });
    return simulator.getState();
  });

  app.post('/simulator/resume', (request) => {
    const input = parse(resumeSchema, request.body ?? {});
    simulator.resumeCycle(input.target_kg);
    return simulator.getState();
  });
}

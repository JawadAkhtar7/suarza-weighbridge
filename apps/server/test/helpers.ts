/**
 * Test harness: a real MongoDB, started in memory.
 *
 * The aggregations, indexes and upsert semantics under test are MongoDB
 * behaviour, not ours — mocking the driver would test the mock.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { Express } from 'express';
import { buildApp } from '../src/app.js';
import { loadConfig, type ServerConfig } from '../src/config.js';
import { WeighmentModel } from '../src/models/weighment.model.js';
import { StationModel } from '../src/models/station.model.js';
import { AuditModel } from '../src/models/audit.model.js';
import { UserModel } from '../src/models/user.model.js';
import { newId, nowUtc, type Weighment } from '@suarza/shared';

let mongod: MongoMemoryServer | null = null;

export const TEST_API_KEY = 'test-ingest-key-0123456789';
export const TEST_JWT_SECRET = 'test-jwt-secret-0123456789abcdef';

export async function startDatabase(): Promise<string> {
  mongod = await MongoMemoryServer.create();
  const uri = `${mongod.getUri()}suarzaweightbridge`;
  await mongoose.connect(uri);
  return uri;
}

export async function stopDatabase(): Promise<void> {
  await mongoose.disconnect();
  await mongod?.stop();
  mongod = null;
}

/** Clears records but leaves the user accounts in place. */
export async function clearWeighments(): Promise<void> {
  await Promise.all([WeighmentModel.deleteMany({}), AuditModel.deleteMany({})]);
}

export async function clearDatabase(): Promise<void> {
  await Promise.all([
    WeighmentModel.deleteMany({}),
    AuditModel.deleteMany({}),
    UserModel.deleteMany({}),
    // Station profiles outlive a weighment, so leaving them would let one
    // test's company details brand the next test's receipt.
    StationModel.deleteMany({}),
  ]);
}

export function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): ServerConfig {
  return loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/suarzaweightbridge',
    JWT_SECRET: TEST_JWT_SECRET,
    INGEST_API_KEY: TEST_API_KEY,
    APP_DOMAIN: 'https://weighbridge.example.com',
    COMPANY_NAME: 'Suarza International',
    COMPANY_ADDRESS: '12 Industrial Road, Lahore',
    COMPANY_PHONE: '+92 300 0000000',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

export function testApp(overrides: Partial<NodeJS.ProcessEnv> = {}): Express {
  return buildApp({
    config: testConfig(overrides),
    // Tests drive the API; there is no manager build to serve.
    serveManagerWeb: false,
    logger: { error: () => {}, info: () => {} },
  });
}

/** A weighment as the agent would send it. */
export function weighment(overrides: Partial<Weighment> = {}): Weighment {
  const at = overrides.first_weight_at ?? '2026-09-14T09:00:00.000Z';
  return {
    id: newId(),
    slip_number: 'SI-000001',
    status: 'OPEN',
    station_id: 'A',
    customer_name: 'Ali Raza',
    customer_company: 'Raza Traders',
    customer_phone: undefined,
    vehicle_type: 'truck',
    vehicle_type_label: 'Truck',
    vehicle_plate: 'LES-1234',
    container_number: undefined,
    product: 'Cement',
    payment_status: 'PAID',
    first_weight_kg: 8000,
    first_weight_at: at,
    first_weight_src: 'SERIAL',
    second_weight_kg: null,
    second_weight_at: null,
    second_weight_src: null,
    net_weight_kg: 0,
    amount_charged: 300,
    currency: 'PKR',
    operator_username: 'operator',
    created_at: at,
    updated_at: at,
    void_reason: null,
    voided_at: null,
    ...overrides,
  };
}

export function completedWeighment(overrides: Partial<Weighment> = {}): Weighment {
  return weighment({
    status: 'COMPLETED',
    second_weight_kg: 20_000,
    second_weight_at: '2026-09-14T11:00:00.000Z',
    second_weight_src: 'SERIAL',
    net_weight_kg: 12_000,
    updated_at: '2026-09-14T11:00:00.000Z',
    ...overrides,
  });
}

export function auditEntry(weighmentId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: newId(),
    weighment_id: weighmentId,
    action: 'CREATED' as const,
    actor_username: 'operator',
    detail: {},
    at: nowUtc(),
    ...overrides,
  };
}

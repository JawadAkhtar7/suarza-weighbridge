import { afterEach, describe, expect, it } from 'vitest';
import { SimulatorWeightReader } from '../src/indicator/simulator.js';

let reader: SimulatorWeightReader | null = null;

afterEach(async () => {
  await reader?.stop();
  reader = null;
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('SimulatorWeightReader', () => {
  it('streams a reading as soon as it starts', async () => {
    reader = new SimulatorWeightReader({ staleMs: 3000, intervalMs: 20 });
    await reader.start();

    const reading = reader.read();
    expect(reading.connected).toBe(true);
    expect(reading.simulated).toBe(true);
    expect(Number.isFinite(reading.weight_kg)).toBe(true);
  });

  it('keeps producing new readings over time', async () => {
    reader = new SimulatorWeightReader({ staleMs: 3000, intervalMs: 20 });
    await reader.start();

    const first = reader.read().at;
    await wait(80);
    expect(reader.read().at).not.toBe(first);
  });

  it('parks on an exact weight and reports it stable', async () => {
    reader = new SimulatorWeightReader({ staleMs: 3000, intervalMs: 20 });
    await reader.start();

    reader.setWeight(8000);
    const reading = reader.read();
    expect(reading.weight_kg).toBe(8000);
    expect(reading.stable).toBe(true);
    expect(reader.getState().autoCycle).toBe(false);
  });

  it('holds the pinned weight across ticks, not just on the first read', async () => {
    reader = new SimulatorWeightReader({ staleMs: 3000, intervalMs: 10 });
    await reader.start();
    reader.setWeight(20_000);

    // Parking must survive the emit loop: a QA script that polls a moment
    // later has to see the number it asked for, not that number plus noise.
    for (let i = 0; i < 10; i++) {
      await wait(12);
      expect(reader.read().weight_kg).toBe(20_000);
    }
  });

  it('resumes the automatic cycle on request', async () => {
    reader = new SimulatorWeightReader({ staleMs: 3000, intervalMs: 10 });
    await reader.start();
    reader.setWeight(20_000);
    reader.resumeCycle(15_000);

    expect(reader.getState()).toMatchObject({ autoCycle: true, targetKg: 15_000 });
  });

  it('can hold a weight that is explicitly unstable', async () => {
    reader = new SimulatorWeightReader({ staleMs: 3000, intervalMs: 20 });
    await reader.start();

    reader.setWeight(8000, { stable: false });
    expect(reader.read().stable).toBe(false);
  });

  it('reports disconnected once readings go stale', async () => {
    reader = new SimulatorWeightReader({ staleMs: 50, intervalMs: 20 });
    await reader.start();
    expect(reader.read().connected).toBe(true);

    await reader.stop();
    await wait(80);

    const reading = reader.read();
    expect(reading.connected).toBe(false);
    // A stale reading is never presented as stable — capture must be blocked.
    expect(reading.stable).toBe(false);
  });

  it('swings before it settles, so stable capture is actually exercised', async () => {
    reader = new SimulatorWeightReader({ staleMs: 3000, intervalMs: 10 });
    await reader.start();
    reader.resumeCycle(20_000);

    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      samples.push(reader.read().weight_kg);
      await wait(10);
    }

    // The drive-on ramp must not be a single flat value.
    expect(new Set(samples).size).toBeGreaterThan(5);
  });

  it('never reports a negative weight', async () => {
    reader = new SimulatorWeightReader({ staleMs: 3000, intervalMs: 5 });
    await reader.start();

    for (let i = 0; i < 60; i++) {
      expect(reader.read().weight_kg).toBeGreaterThanOrEqual(0);
      await wait(5);
    }
  });
});

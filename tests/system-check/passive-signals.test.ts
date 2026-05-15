import { collectPassiveSystemSignals } from '../../src/system-check/passive-signals';

describe('passive system signal collector', () => {
  test('returns browser-reported memory and passive WebGPU availability', async () => {
    const signals = await collectPassiveSystemSignals({
      deviceMemory: 8,
      gpu: { requestAdapter: jest.fn().mockResolvedValue({}) },
    } as unknown as Navigator);

    expect(signals).toEqual({ browserMemoryGb: 8, webGpu: 'available' });
  });

  test('does not require memory or WebGPU APIs', async () => {
    const signals = await collectPassiveSystemSignals({} as Navigator);

    expect(signals).toEqual({ webGpu: 'unavailable' });
  });
});

import type { PassiveSystemSignals, WebGpuAvailability } from '../shared/system-compatibility-policy';

interface NavigatorWithPassiveHardwareSignals extends Navigator {
  deviceMemory?: number;
  gpu?: {
    requestAdapter?: () => Promise<unknown>;
  };
}

async function collectPassiveWebGpuAvailability(navigatorLike: NavigatorWithPassiveHardwareSignals): Promise<WebGpuAvailability> {
  if (!navigatorLike.gpu) return 'unavailable';
  if (typeof navigatorLike.gpu.requestAdapter !== 'function') return 'available';
  try {
    const adapter = await navigatorLike.gpu.requestAdapter();
    return adapter ? 'available' : 'unavailable';
  } catch {
    return 'unknown';
  }
}

export async function collectPassiveSystemSignals(
  navigatorLike: NavigatorWithPassiveHardwareSignals = navigator as NavigatorWithPassiveHardwareSignals,
): Promise<PassiveSystemSignals> {
  const browserMemoryGb = typeof navigatorLike.deviceMemory === 'number' && Number.isFinite(navigatorLike.deviceMemory)
    ? navigatorLike.deviceMemory
    : undefined;

  return {
    browserMemoryGb,
    webGpu: await collectPassiveWebGpuAvailability(navigatorLike),
  };
}

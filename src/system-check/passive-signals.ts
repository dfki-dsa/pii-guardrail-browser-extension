import type { PassiveSystemSignals, WebGpuAvailability } from '../shared/system-compatibility-policy';

/**
 * A navigator-like object carrying the optional hardware signals for probing.
 * 
 *    In TypeScript, Partial<T> constructs a type with all properties of T 
 *    set to optional. Useful for testing, mocking, or building safe 
 *    feature-detection utilities.
 *
 *    Put `Partial<Navigator> &` instead of `extends Navigator` because:
 * 
 *  - GPU is required in the newer lib.dom.d.ts which fails on extending 
 *    optional 'gpu?'. So an editor with its own typescript bundle might
 *    report it but workspace 'tsc' might not.
 * 
 *  - Not extending the 'Navigator' will remove properties common with 'Navigator'
 *    so callers passing '{...} as Navigator' will fail.
 *    
 *  - Hence using 'Partial<Navigator>' will keep the overlap that casting needs
 *    and type-checks under both old and new DOM lib version
 */
type NavigatorWithPassiveHardwareSignals = Partial<Navigator> & {
  deviceMemory?: number;
  gpu?: {
    requestAdapter?: () => Promise<unknown>;
  };
};

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

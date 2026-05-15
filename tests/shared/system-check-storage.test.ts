import {
  SYSTEM_CHECK_STORAGE_KEY,
  buildSystemCheckResult,
  loadSystemCheckResult,
  markCriticalModalDismissed,
  normalizeSystemCheckResult,
  recordLoadFailure,
  recordLocalAiEnabled,
  recordLowMemoryAutoDisable,
  recordLowMemoryOverride,
  recordRecommendationDeclined,
  recordRuntimeState,
  recordUserLocalAiOff,
  saveSystemCheckResult,
} from '../../src/shared/system-check-storage';

describe('system-check storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('normalizes missing and older schema state to null', () => {
    expect(normalizeSystemCheckResult(undefined)).toBeNull();
    expect(normalizeSystemCheckResult({ schemaVersion: 0 })).toBeNull();
  });

  test('builds and persists a versioned compatibility result separately from settings', async () => {
    const result = buildSystemCheckResult({ browserMemoryGb: 12, webGpu: 'available' }, 123);

    await saveSystemCheckResult(result);

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [SYSTEM_CHECK_STORAGE_KEY]: expect.objectContaining({
        schemaVersion: 1,
        policyVersion: 1,
        checkedAt: 123,
        browserMemoryGb: 12,
        tier: 'warning',
      }),
    });
  });

  test('loads normalized valid state', async () => {
    const result = buildSystemCheckResult({ browserMemoryGb: 16, webGpu: 'unavailable' }, 456);
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({ [SYSTEM_CHECK_STORAGE_KEY]: result });

    await expect(loadSystemCheckResult()).resolves.toEqual(expect.objectContaining({ tier: 'ok' }));
  });

  test('records modal dismissal, enable, override, auto-disable, user-off, and load failure state', async () => {
    const base = buildSystemCheckResult({ browserMemoryGb: 8, webGpu: 'unknown' }, 100);
    (chrome.storage.local.get as jest.Mock)
      .mockResolvedValueOnce({ [SYSTEM_CHECK_STORAGE_KEY]: { ...base, criticalModal: 'pending' } })
      .mockResolvedValueOnce({ [SYSTEM_CHECK_STORAGE_KEY]: { ...base, localAiState: 'off-user-choice' } })
      .mockResolvedValueOnce({ [SYSTEM_CHECK_STORAGE_KEY]: base })
      .mockResolvedValueOnce({ [SYSTEM_CHECK_STORAGE_KEY]: base });

    await markCriticalModalDismissed();
    await recordLocalAiEnabled();
    await recordLowMemoryOverride();
    await recordLowMemoryAutoDisable(base);
    await recordUserLocalAiOff(base);
    await recordLoadFailure('boom', 200);

    expect(chrome.storage.local.set).toHaveBeenNthCalledWith(1, {
      [SYSTEM_CHECK_STORAGE_KEY]: expect.objectContaining({ criticalModal: 'dismissed' }),
    });
    expect(chrome.storage.local.set).toHaveBeenNthCalledWith(2, {
      [SYSTEM_CHECK_STORAGE_KEY]: expect.objectContaining({ localAiState: 'enabled' }),
    });
    expect(chrome.storage.local.set).toHaveBeenNthCalledWith(3, {
      [SYSTEM_CHECK_STORAGE_KEY]: expect.objectContaining({ localAiState: 'enabled-low-memory-override', lowMemoryOverride: true }),
    });
    expect(chrome.storage.local.set).toHaveBeenNthCalledWith(4, {
      [SYSTEM_CHECK_STORAGE_KEY]: expect.objectContaining({ localAiState: 'off-low-memory-auto', criticalModal: 'pending' }),
    });
    expect(chrome.storage.local.set).toHaveBeenNthCalledWith(5, {
      [SYSTEM_CHECK_STORAGE_KEY]: expect.objectContaining({ localAiState: 'off-user-choice' }),
    });
    expect(chrome.storage.local.set).toHaveBeenNthCalledWith(6, {
      [SYSTEM_CHECK_STORAGE_KEY]: expect.objectContaining({ localAiState: 'off-load-failure', runtimeState: 'failed' }),
    });
  });

  test('re-enabling Local AI clears any prior load-failure record', async () => {
    const previouslyFailed = {
      ...buildSystemCheckResult({ browserMemoryGb: 16, webGpu: 'available' }, 100),
      localAiState: 'off-load-failure' as const,
      runtimeState: 'failed' as const,
      loadFailure: { message: 'boom', at: 99 },
    };
    (chrome.storage.local.get as jest.Mock)
      .mockResolvedValueOnce({ [SYSTEM_CHECK_STORAGE_KEY]: previouslyFailed })
      .mockResolvedValueOnce({ [SYSTEM_CHECK_STORAGE_KEY]: previouslyFailed });

    await recordLocalAiEnabled();
    await recordLowMemoryOverride();

    expect(chrome.storage.local.set).toHaveBeenNthCalledWith(1, {
      [SYSTEM_CHECK_STORAGE_KEY]: expect.objectContaining({ localAiState: 'enabled', loadFailure: undefined }),
    });
    expect(chrome.storage.local.set).toHaveBeenNthCalledWith(2, {
      [SYSTEM_CHECK_STORAGE_KEY]: expect.objectContaining({ localAiState: 'enabled-low-memory-override', loadFailure: undefined }),
    });
  });

  test('recordRuntimeState updates only the runtimeState field and skips identical writes', async () => {
    const base = {
      ...buildSystemCheckResult({ browserMemoryGb: 16, webGpu: 'available' }, 100),
      runtimeState: 'not-loaded' as const,
    };
    (chrome.storage.local.get as jest.Mock)
      .mockResolvedValueOnce({ [SYSTEM_CHECK_STORAGE_KEY]: base })
      .mockResolvedValueOnce({ [SYSTEM_CHECK_STORAGE_KEY]: { ...base, runtimeState: 'ready' } });

    await recordRuntimeState('ready');
    await recordRuntimeState('ready');

    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [SYSTEM_CHECK_STORAGE_KEY]: expect.objectContaining({ runtimeState: 'ready' }),
    });
  });

  test('recordRecommendationDeclined stamps recommendationDeclinedAt without touching localAiState', async () => {
    const base = {
      ...buildSystemCheckResult({ browserMemoryGb: 8, webGpu: 'available' }, 100),
      localAiState: 'enabled' as const,
    };
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({ [SYSTEM_CHECK_STORAGE_KEY]: base });

    const result = await recordRecommendationDeclined(777);

    expect(result).toEqual(expect.objectContaining({
      localAiState: 'enabled',
      recommendationDeclinedAt: 777,
    }));
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [SYSTEM_CHECK_STORAGE_KEY]: expect.objectContaining({ recommendationDeclinedAt: 777 }),
    });
  });
});

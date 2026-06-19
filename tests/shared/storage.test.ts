import { DEFAULT_SETTINGS } from '../../src/shared/constants';
import { loadSettings, saveSettings } from '../../src/shared/storage';

describe('settings storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loads the default transformer NER provider when no setting is stored', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({});

    await expect(loadSettings()).resolves.toEqual(
      expect.objectContaining({
        nerProvider: 'transformers',
        nerModel: 'bardsai',
        clipboardInterceptEnabled: true,
        cancelDetectionBehavior: 'ask',
        localAiUnloadTimeoutMs: 600000,
        keepLocalAiLoadedWhileActive: true,
        autoWarmLocalAiOnActiveSupportedPage: true,
      })
    );
  });

  test('persists a selected NER provider mode', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      pg_settings: DEFAULT_SETTINGS,
    });

    await saveSettings({ nerProvider: 'fixture' });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      pg_settings: expect.objectContaining({ nerProvider: 'fixture' }),
    });
  });

  test('persists BardsAI as an active transformer NER model selection', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      pg_settings: DEFAULT_SETTINGS,
    });

    await saveSettings({ nerModel: 'bardsai' });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      pg_settings: expect.objectContaining({ nerModel: 'bardsai' }),
    });
  });

  test('normalizes invalid stored NER provider modes to the default', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      pg_settings: { ...DEFAULT_SETTINGS, nerProvider: 'banana' },
    });

    await expect(loadSettings()).resolves.toEqual(
      expect.objectContaining({ nerProvider: 'transformers' })
    );
  });

  test('normalizes invalid stored NER model keys to the default', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      pg_settings: { ...DEFAULT_SETTINGS, nerModel: 'banana' },
    });

    await expect(loadSettings()).resolves.toEqual(
      expect.objectContaining({ nerModel: 'bardsai' })
    );
  });

  test('defaults missing and invalid WebGPU dtype preferences to the low-memory artifact', async () => {
    const { nerWebGpuDtype: _omitted, ...storedBeforeFlag } = DEFAULT_SETTINGS;
    (chrome.storage.local.get as jest.Mock)
      .mockResolvedValueOnce({ pg_settings: storedBeforeFlag })
      .mockResolvedValueOnce({ pg_settings: { ...DEFAULT_SETTINGS, nerWebGpuDtype: 'q8' } });

    await expect(loadSettings()).resolves.toEqual(
      expect.objectContaining({ nerWebGpuDtype: 'q4f16' })
    );
    // 'q8' is a valid artifact but never a WebGPU preference — reject it too.
    await expect(loadSettings()).resolves.toEqual(
      expect.objectContaining({ nerWebGpuDtype: 'q4f16' })
    );
  });

  test('normalizes obsolete WebGPU dtype preferences to q4f16 on save', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      pg_settings: DEFAULT_SETTINGS,
    });

    await saveSettings({ nerWebGpuDtype: 'fp16' as never });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      pg_settings: expect.objectContaining({ nerWebGpuDtype: 'q4f16' }),
    });
  });

  test('defaults existing stored settings to clipboard interception enabled', async () => {
    const { clipboardInterceptEnabled: _omitted, ...storedBeforeFlag } = DEFAULT_SETTINGS;
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      pg_settings: storedBeforeFlag,
    });

    await expect(loadSettings()).resolves.toEqual(
      expect.objectContaining({ clipboardInterceptEnabled: true })
    );
  });

  test('persists clipboard interception preference', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      pg_settings: DEFAULT_SETTINGS,
    });

    await saveSettings({ clipboardInterceptEnabled: false });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      pg_settings: expect.objectContaining({ clipboardInterceptEnabled: false }),
    });
  });

  test('normalizes missing and invalid cancel detection behavior to ask', async () => {
    const { cancelDetectionBehavior: _omitted, ...storedBeforeFlag } = DEFAULT_SETTINGS;
    (chrome.storage.local.get as jest.Mock)
      .mockResolvedValueOnce({ pg_settings: storedBeforeFlag })
      .mockResolvedValueOnce({ pg_settings: { ...DEFAULT_SETTINGS, cancelDetectionBehavior: 'banana' } });

    await expect(loadSettings()).resolves.toEqual(
      expect.objectContaining({ cancelDetectionBehavior: 'ask' })
    );
    await expect(loadSettings()).resolves.toEqual(
      expect.objectContaining({ cancelDetectionBehavior: 'ask' })
    );
  });

  test('persists a valid cancel detection behavior', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      pg_settings: DEFAULT_SETTINGS,
    });

    await saveSettings({ cancelDetectionBehavior: 'paste-original' });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      pg_settings: expect.objectContaining({ cancelDetectionBehavior: 'paste-original' }),
    });
  });

  test('normalizes Local AI runtime lifecycle settings', async () => {
    const { localAiUnloadTimeoutMs: _timeout, keepLocalAiLoadedWhileActive: _keep, autoWarmLocalAiOnActiveSupportedPage: _warm, ...storedBeforeFlags } = DEFAULT_SETTINGS;
    (chrome.storage.local.get as jest.Mock)
      .mockResolvedValueOnce({ pg_settings: storedBeforeFlags })
      .mockResolvedValueOnce({
        pg_settings: {
          ...DEFAULT_SETTINGS,
          localAiUnloadTimeoutMs: 42,
          keepLocalAiLoadedWhileActive: 'yes',
          autoWarmLocalAiOnActiveSupportedPage: 'no',
        },
      });

    await expect(loadSettings()).resolves.toEqual(
      expect.objectContaining({
        localAiUnloadTimeoutMs: 600000,
        keepLocalAiLoadedWhileActive: true,
        autoWarmLocalAiOnActiveSupportedPage: true,
      })
    );
    await expect(loadSettings()).resolves.toEqual(
      expect.objectContaining({
        localAiUnloadTimeoutMs: 600000,
        keepLocalAiLoadedWhileActive: true,
        autoWarmLocalAiOnActiveSupportedPage: true,
      })
    );
  });

  test('persists valid Local AI runtime lifecycle settings', async () => {
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      pg_settings: DEFAULT_SETTINGS,
    });

    await saveSettings({
      localAiUnloadTimeoutMs: null,
      keepLocalAiLoadedWhileActive: false,
      autoWarmLocalAiOnActiveSupportedPage: true,
    });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      pg_settings: expect.objectContaining({
        localAiUnloadTimeoutMs: null,
        keepLocalAiLoadedWhileActive: false,
        autoWarmLocalAiOnActiveSupportedPage: true,
      }),
    });
  });
});

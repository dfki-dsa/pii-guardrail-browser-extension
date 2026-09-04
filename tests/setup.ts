// Mock Chrome extension APIs for testing
(globalThis as any).chrome = {
  storage: {
    local: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
    // Where conversation records go for a profile with cross-session memory
    // switched off. Present here because production code must degrade rather
    // than fail when it is missing — tests that need it to be absent delete it
    // explicitly.
    session: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      setAccessLevel: jest.fn().mockResolvedValue(undefined),
    },
  },
  runtime: {
    getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
    sendMessage: jest.fn().mockResolvedValue({}),
  },
  tabs: {
    query: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn().mockResolvedValue(undefined),
  },
};

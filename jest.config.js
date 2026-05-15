/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'js'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  // The Svelte runtime ships ESM and the overlay imports compiled
  // .svelte component modules + a raw CSS string — none of which Jest's
  // CJS pipeline can parse. Stub them so the wrapper class under test
  // (overlay.ts) loads cleanly; the lifecycle paths exercised by the
  // existing tests don't need a real Svelte renderer.
  moduleNameMapper: {
    '^svelte$': '<rootDir>/tests/mocks/svelte-stub.ts',
    '^svelte/store$': '<rootDir>/tests/mocks/svelte-store-stub.ts',
    '\\.svelte$': '<rootDir>/tests/mocks/svelte-component-stub.ts',
    '\\.css$': '<rootDir>/tests/mocks/css-stub.ts',
  },
  // Chrome API mocks are set up in test setup file
  setupFiles: ['<rootDir>/tests/setup.ts'],
};

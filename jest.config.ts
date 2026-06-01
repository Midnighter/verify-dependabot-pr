import type { Config } from 'jest';

const shared = {
  preset: 'ts-jest' as const,
  testEnvironment: 'node' as const,
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@actions/core$': '<rootDir>/tests/__mocks__/@actions/core.ts',
    '^@actions/github$': '<rootDir>/tests/__mocks__/@actions/github.ts',
    '^@octokit/plugin-retry$': '<rootDir>/tests/__mocks__/@octokit/plugin-retry.ts',
  },
};

const config: Config = {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
    },
    {
      ...shared,
      displayName: 'acceptance',
      testMatch: ['<rootDir>/tests/acceptance/**/*.steps.ts'],
    },
  ],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
};

export default config;

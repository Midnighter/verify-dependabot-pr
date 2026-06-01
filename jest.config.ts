import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@actions/core$': '<rootDir>/tests/__mocks__/@actions/core.ts',
    '^@actions/github$': '<rootDir>/tests/__mocks__/@actions/github.ts',
    '^@octokit/plugin-retry$': '<rootDir>/tests/__mocks__/@octokit/plugin-retry.ts',
  },
};

export default config;

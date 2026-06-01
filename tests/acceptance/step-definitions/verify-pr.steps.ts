import { loadFeature, defineFeature } from 'jest-cucumber';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { run } from '../../../src/main';
import * as path from 'path';
import * as fs from 'fs';

const feature = loadFeature(
  path.join(__dirname, '..', 'features', 'verify-dependabot-pr.feature'),
);

const fixturesDir = path.join(__dirname, '..', '..', '..', '__fixtures__');

function loadFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8')) as T;
}

const mockGetInput = core.getInput as jest.Mock;
const mockGetBooleanInput = core.getBooleanInput as jest.Mock;
const mockSetOutput = core.setOutput as jest.Mock;
const mockSetFailed = core.setFailed as jest.Mock;
const mockGetOctokit = github.getOctokit as jest.Mock;

interface World {
  stringInputs: Record<string, string>;
  booleanInputs: Record<string, boolean>;
  prFixture: unknown | null;
  commitsFixture: unknown | null;
  throwNonError: string | null;
}

function createWorld(): World {
  return {
    stringInputs: {},
    booleanInputs: {},
    prFixture: null,
    commitsFixture: null,
    throwNonError: null,
  };
}

function wireMocksAndRun(world: World): Promise<void> {
  jest.clearAllMocks();

  mockGetInput.mockImplementation((name: string) => {
    return world.stringInputs[name] ?? '';
  });

  mockGetBooleanInput.mockImplementation((name: string) => {
    return world.booleanInputs[name] ?? false;
  });

  if (world.throwNonError !== null) {
    const mockOctokit = {
      rest: {
        pulls: {
          get: jest.fn().mockRejectedValue(world.throwNonError),
          listCommits: jest.fn(),
        },
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);
  } else if (world.prFixture !== null) {
    const headers = { 'x-ratelimit-remaining': '4999' };
    const mockOctokit = {
      rest: {
        pulls: {
          get: jest.fn().mockResolvedValue({ data: world.prFixture, headers }),
          listCommits: jest
            .fn()
            .mockResolvedValue({ data: world.commitsFixture ?? [], headers }),
        },
      },
    };
    mockGetOctokit.mockReturnValue(mockOctokit);
  }

  return run();
}

// Step matchers reused across scenarios.
const inputIsPattern = /^the "(.*)" input is "(.*)"$/;
const inputEnabledPattern = /^the "(.*)" input is enabled$/;
const inputDisabledPattern = /^the "(.*)" input is disabled$/;
const prFixturePattern = /^the GitHub API returns PR fixture "(.*)"$/;
const commitsFixturePattern = /^the GitHub API returns commits fixture "(.*)"$/;
const throwNonErrorPattern = /^the GitHub API throws a non-Error value "(.*)"$/;
const failsWithPattern = /^the action fails with a message containing "(.*)"$/;
const outputIsPattern = /^the "(.*)" output is "(.*)"$/;

defineFeature(feature, (defineScenario) => {
  // Scenario: Missing PR number fails the action
  // Steps: background(1) + given(1) + when(1) + then(1) = 4
  defineScenario('Missing PR number fails the action', ({ given, when, then }) => {
    let world: World;

    given(/^the GitHub token is "(.*)"$/, (token: string) => {
      world = createWorld();
      world.stringInputs['github-token'] = token;
    });

    given(inputIsPattern, (inputName: string, value: string) => {
      world.stringInputs[inputName] = value;
    });

    when('the action runs', async () => {
      await wireMocksAndRun(world);
    });

    then(failsWithPattern, (message: string) => {
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining(message),
      );
    });
  });

  // Scenario: Invalid PR number fails the action
  // Steps: background(1) + given(1) + when(1) + then(1) = 4
  defineScenario('Invalid PR number fails the action', ({ given, when, then }) => {
    let world: World;

    given(/^the GitHub token is "(.*)"$/, (token: string) => {
      world = createWorld();
      world.stringInputs['github-token'] = token;
    });

    given(inputIsPattern, (inputName: string, value: string) => {
      world.stringInputs[inputName] = value;
    });

    when('the action runs', async () => {
      await wireMocksAndRun(world);
    });

    then(failsWithPattern, (message: string) => {
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining(message),
      );
    });
  });

  // Scenario: Invalid expected-id fails the action
  // Steps: background(1) + given(1) + and(1) + when(1) + then(1) = 5
  defineScenario(
    'Invalid expected-id fails the action',
    ({ given, when, then, and }) => {
      let world: World;

      given(/^the GitHub token is "(.*)"$/, (token: string) => {
        world = createWorld();
        world.stringInputs['github-token'] = token;
      });

      given(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      and(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      when('the action runs', async () => {
        await wireMocksAndRun(world);
      });

      then(failsWithPattern, (message: string) => {
        expect(mockSetFailed).toHaveBeenCalledWith(
          expect.stringContaining(message),
        );
      });
    },
  );

  // Scenario: Successful Dependabot PR verification
  // Steps: background(1) + given(1) + and(3 string) + and(3 enabled) + and(1 disabled)
  //       + and(1 pr fixture) + and(1 commits fixture) + when(1) + then(1) + and(1) = 14
  defineScenario(
    'Successful Dependabot PR verification',
    ({ given, when, then, and }) => {
      let world: World;

      given(/^the GitHub token is "(.*)"$/, (token: string) => {
        world = createWorld();
        world.stringInputs['github-token'] = token;
      });

      given(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      and(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      and(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      and(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      and(inputEnabledPattern, (inputName: string) => {
        world.booleanInputs[inputName] = true;
      });

      and(inputEnabledPattern, (inputName: string) => {
        world.booleanInputs[inputName] = true;
      });

      and(inputEnabledPattern, (inputName: string) => {
        world.booleanInputs[inputName] = true;
      });

      and(inputDisabledPattern, (inputName: string) => {
        world.booleanInputs[inputName] = false;
      });

      and(prFixturePattern, (fixtureName: string) => {
        world.prFixture = loadFixture(fixtureName);
      });

      and(commitsFixturePattern, (fixtureName: string) => {
        world.commitsFixture = loadFixture(fixtureName);
      });

      when('the action runs', async () => {
        await wireMocksAndRun(world);
      });

      then(outputIsPattern, (outputName: string, value: string) => {
        expect(mockSetOutput).toHaveBeenCalledWith(outputName, value);
      });

      and('the action does not fail', () => {
        expect(mockSetFailed).not.toHaveBeenCalled();
      });
    },
  );

  // Scenario: PR author login mismatch fails verification
  // Steps: background(1) + given(1) + and(3 string) + and(3 enabled) + and(1 disabled)
  //       + and(1 pr fixture) + and(1 commits fixture) + when(1) + then(1) + and(1) = 14
  defineScenario(
    'PR author login mismatch fails verification',
    ({ given, when, then, and }) => {
      let world: World;

      given(/^the GitHub token is "(.*)"$/, (token: string) => {
        world = createWorld();
        world.stringInputs['github-token'] = token;
      });

      given(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      and(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      and(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      and(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      and(inputEnabledPattern, (inputName: string) => {
        world.booleanInputs[inputName] = true;
      });

      and(inputEnabledPattern, (inputName: string) => {
        world.booleanInputs[inputName] = true;
      });

      and(inputEnabledPattern, (inputName: string) => {
        world.booleanInputs[inputName] = true;
      });

      and(inputDisabledPattern, (inputName: string) => {
        world.booleanInputs[inputName] = false;
      });

      and(prFixturePattern, (fixtureName: string) => {
        world.prFixture = loadFixture(fixtureName);
      });

      and(commitsFixturePattern, (fixtureName: string) => {
        world.commitsFixture = loadFixture(fixtureName);
      });

      when('the action runs', async () => {
        await wireMocksAndRun(world);
      });

      then(outputIsPattern, (outputName: string, value: string) => {
        expect(mockSetOutput).toHaveBeenCalledWith(outputName, value);
      });

      and(failsWithPattern, (message: string) => {
        expect(mockSetFailed).toHaveBeenCalledWith(
          expect.stringContaining(message),
        );
      });
    },
  );

  // Scenario: Non-Error exception is handled gracefully
  // Steps: background(1) + given(1) + and(3 string) + and(3 enabled) + and(1 disabled)
  //       + and(1 throw) + when(1) + then(1) = 12
  defineScenario(
    'Non-Error exception is handled gracefully',
    ({ given, when, then, and }) => {
      let world: World;

      given(/^the GitHub token is "(.*)"$/, (token: string) => {
        world = createWorld();
        world.stringInputs['github-token'] = token;
      });

      given(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      and(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      and(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      and(inputIsPattern, (inputName: string, value: string) => {
        world.stringInputs[inputName] = value;
      });

      and(inputEnabledPattern, (inputName: string) => {
        world.booleanInputs[inputName] = true;
      });

      and(inputEnabledPattern, (inputName: string) => {
        world.booleanInputs[inputName] = true;
      });

      and(inputEnabledPattern, (inputName: string) => {
        world.booleanInputs[inputName] = true;
      });

      and(inputDisabledPattern, (inputName: string) => {
        world.booleanInputs[inputName] = false;
      });

      and(throwNonErrorPattern, (errorValue: string) => {
        world.throwNonError = errorValue;
      });

      when('the action runs', async () => {
        await wireMocksAndRun(world);
      });

      then(failsWithPattern, (message: string) => {
        expect(mockSetFailed).toHaveBeenCalledWith(
          expect.stringContaining(message),
        );
      });
    },
  );
});

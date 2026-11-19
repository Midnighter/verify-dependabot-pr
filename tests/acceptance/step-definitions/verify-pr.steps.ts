import { autoBindSteps, loadFeatures, type StepDefinitions } from 'jest-cucumber';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { parse } from 'yaml';
import { run } from '../../../src/main';
import * as path from 'path';
import * as fs from 'fs';

const repoRoot = path.join(__dirname, '..', '..', '..');
const fixturesDir = path.join(repoRoot, '__fixtures__');

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf-8'));
}

// The runner gives every input its default from action.yml, so the scenarios
// run with the same defaults.
const actionDefaults: Record<string, string> = Object.fromEntries(
  Object.entries(
    (
      parse(fs.readFileSync(path.join(repoRoot, 'action.yml'), 'utf-8')) as {
        inputs: Record<string, { default?: string }>;
      }
    ).inputs,
  ).map(([name, input]) => [name, input.default ?? '']),
);

// Values the runner substitutes for the expressions in those defaults. The
// scenarios don't simulate a pull_request event, so they set the PR inputs.
const expressionValues: Record<string, () => string> = {
  'github.token': () => '',
  'github.event.pull_request.number': () => '',
  'github.event.pull_request.head.sha': () => '',
};

function resolveDefault(value: string): string {
  const expression = /^\$\{\{\s*(.+?)\s*\}\}$/.exec(value);
  if (expression === null) {
    return value;
  }
  const resolve = expressionValues[expression[1]];
  if (resolve === undefined) {
    throw new Error(`The harness cannot resolve the action.yml default "${value}".`);
  }
  return resolve();
}

const mockGetInput = core.getInput as jest.Mock;
const mockGetBooleanInput = core.getBooleanInput as jest.Mock;
const mockSetOutput = core.setOutput as jest.Mock;
const mockSetFailed = core.setFailed as jest.Mock;
const mockGetOctokit = github.getOctokit as jest.Mock;

interface World {
  inputs: Record<string, string>;
  pr: Record<string, unknown> | null;
  commits: unknown[];
  throwNonError: string | null;
}

let world: World;
const originalEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  world = { inputs: {}, pr: null, commits: [], throwNonError: null };
  process.env.GITHUB_SERVER_URL = 'https://github.com';
  process.env.GITHUB_API_URL = 'https://api.github.com';
});

afterEach(() => {
  process.env = { ...originalEnv };
});

// Same contract as @actions/core: trimmed value, error when required and empty.
function getInput(name: string, options?: core.InputOptions): string {
  const value = (
    world.inputs[name] ?? resolveDefault(actionDefaults[name] ?? '')
  ).trim();
  if (options?.required && value === '') {
    throw new Error(`Input required and not supplied: ${name}`);
  }
  return value;
}

// Same contract as @actions/core: only YAML 1.2 Core Schema booleans.
function getBooleanInput(name: string, options?: core.InputOptions): boolean {
  const value = getInput(name, options);
  if (['true', 'True', 'TRUE'].includes(value)) {
    return true;
  }
  if (['false', 'False', 'FALSE'].includes(value)) {
    return false;
  }
  throw new TypeError(
    `Input does not meet YAML 1.2 "Core Schema" specification: ${name}`,
  );
}

/** Set a dotted path such as "head.repo.id" on a copy of the PR fixture. */
function setField(target: Record<string, unknown>, fieldPath: string, value: unknown) {
  const keys = fieldPath.split('.');
  let node = target;
  for (const key of keys.slice(0, -1)) {
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
}

function lastOutput(name: string): unknown {
  const calls = mockSetOutput.mock.calls.filter(([outputName]) => outputName === name);
  return calls.length === 0 ? undefined : calls[calls.length - 1][1];
}

async function runAction(): Promise<void> {
  mockGetInput.mockImplementation(getInput);
  mockGetBooleanInput.mockImplementation(getBooleanInput);

  const headers = { 'x-ratelimit-remaining': '4999' };
  const pulls =
    world.throwNonError !== null
      ? {
          get: jest.fn().mockRejectedValue(world.throwNonError),
          listCommits: jest.fn(),
        }
      : {
          get: jest.fn().mockResolvedValue({ data: world.pr, headers }),
          listCommits: jest.fn().mockResolvedValue({ data: world.commits, headers }),
        };
  mockGetOctokit.mockReturnValue({ rest: { pulls } });

  await run();
}

const steps: StepDefinitions = ({ given, when, then }) => {
  // The PR every scenario starts from. Its head commit is the head.sha in
  // pr_dependabot.json and the last commit in commits_verified.json.
  given('a genuine Dependabot PR whose head commit is "def456"', () => {
    world.inputs['github-token'] = 'test-token';
    world.inputs['pr-number'] = '42';
    world.inputs['head-sha'] = 'def456';
    world.pr = loadFixture('pr_dependabot.json') as Record<string, unknown>;
    world.commits = loadFixture('commits_verified.json') as unknown[];
  });

  given(/^the "(.*)" input is "(.*)"$/, (name: string, value: string) => {
    world.inputs[name] = value;
  });

  given(/^the "(.*)" input is enabled$/, (name: string) => {
    world.inputs[name] = 'true';
  });

  given(/^the "(.*)" input is disabled$/, (name: string) => {
    world.inputs[name] = 'false';
  });

  given(
    /^the "(.*)" environment variable is "(.*)"$/,
    (name: string, value: string) => {
      process.env[name] = value;
    },
  );

  given(/^the GitHub API returns PR fixture "(.*)"$/, (name: string) => {
    world.pr = loadFixture(name) as Record<string, unknown>;
  });

  // The value is JSON, so "fed789" is a string and 3 a number.
  given(/^the PR field "(.*)" is (.*)$/, (fieldPath: string, value: string) => {
    setField(world.pr as Record<string, unknown>, fieldPath, JSON.parse(value));
  });

  given(/^the GitHub API returns commits fixture "(.*)"$/, (name: string) => {
    world.commits = loadFixture(name) as unknown[];
  });

  // The value is JSON, as for the PR field step. Applies to every commit, so a
  // scenario can vary one field without needing its own fixture.
  given(/^every commit field "(.*)" is (.*)$/, (fieldPath: string, value: string) => {
    for (const commit of world.commits) {
      setField(commit as Record<string, unknown>, fieldPath, JSON.parse(value));
    }
  });

  given(/^the GitHub API throws a non-Error value "(.*)"$/, (value: string) => {
    world.throwNonError = value;
  });

  when('the action runs', runAction);

  then(/^the "(.*)" output is "(.*)"$/, (name: string, value: string) => {
    expect(lastOutput(name)).toBe(value);
  });

  then('the action does not fail', () => {
    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  then(/^the action fails with a message containing "(.*)"$/, (message: string) => {
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining(message));
  });

  // getOctokit falls back to GITHUB_API_URL when it gets no baseUrl.
  then(/^the GitHub API client uses "(.*)"$/, (baseUrl: string) => {
    expect(
      mockGetOctokit.mock.calls.map(
        ([, options]) =>
          (options as { baseUrl?: string } | undefined)?.baseUrl ??
          process.env.GITHUB_API_URL,
      ),
    ).toEqual([baseUrl]);
  });
};

autoBindSteps(loadFeatures(path.join(__dirname, '..', 'features', '*.feature')), [
  steps,
]);

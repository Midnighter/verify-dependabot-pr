export const getOctokit = jest.fn();
export const context = {
  repo: { owner: 'owner', repo: 'repo' },
  // Read on each use so that a test can change the variable. The real context
  // reads it once, when the action starts.
  get serverUrl() {
    return process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  },
};

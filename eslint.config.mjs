import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/', 'lib/', 'coverage/', '__fixtures__/', 'tests/acceptance/features/', '*.mjs'],
  },
);

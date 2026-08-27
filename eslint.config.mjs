import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import css from '@eslint/css';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    ...pluginReact.configs.flat.recommended,
  },
  {
    files: ['**/*.css'],
    plugins: { css },
    language: 'css/css',
    extends: ['css/recommended'],
    rules: {
      'css/no-invalid-properties': 'off',
      'css/font-family-fallbacks': 'off',
      'css/no-important': 'off',
      'css/no-empty-blocks': 'off',
      'css/use-baseline': 'off',
    },
  },
  {
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    // Zod must not reach the browser bundle. The client may use inferred types
    // from the canonical schemas, because type imports are erased, but a value
    // import pulls the whole Zod runtime into a chunk. Zod-free helpers live in
    // `src/shared/scoresheetDocument.ts`.
    files: ['src/client/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'zod',
              message:
                'Zod must stay out of the client bundle. Validate on the server, or use the Zod-free helpers in src/shared/scoresheetDocument.ts.',
            },
          ],
          patterns: [
            {
              group: [
                '**/shared/scoresheetSchema',
                '**/shared/validationPrimitives',
                '**/server/validation/*',
                '@shared/scoresheetSchema',
                '@shared/validationPrimitives',
              ],
              allowTypeImports: true,
              message:
                'Import types only from this module; its value exports pull the Zod runtime into the client bundle. Runtime helpers live in src/shared/scoresheetDocument.ts.',
            },
          ],
        },
      ],
    },
  },
]);

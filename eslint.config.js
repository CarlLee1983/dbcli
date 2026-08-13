import js from '@eslint/js'
import ts from 'typescript-eslint'

export default [
  {
    ignores: ['node_modules/', 'dist/', 'coverage/', 'src/ui-template/*.config.js'],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
      'no-useless-escape': 'warn',
      'no-require-imports': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Plain-Node ESM helpers (the postinstall check runs under node, not bun).
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
      'no-empty': 'warn',
      'no-useless-catch': 'warn',
      'no-useless-escape': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
]

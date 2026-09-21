import eslintConfigPrettier from 'eslint-config-prettier/flat'
import globals from 'globals'

export default [
  {
    ignores: ['**/dist/**', '**/coverage/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  eslintConfigPrettier,
]

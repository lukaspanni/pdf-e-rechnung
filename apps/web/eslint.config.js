import { tanstackConfig } from '@tanstack/eslint-config'
import sharedConfig from '../../eslint.shared.config.mjs'

export default [
  ...tanstackConfig,
  ...sharedConfig,
  {
    files: ['packages/**/*.ts', 'apps/api-azure/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        projectService: false,
      },
    },
  },
  {
    ignores: ['eslint.config.js', 'routeTree.gen.ts'],
  },
]

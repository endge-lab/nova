import { createEndgeEslintConfig } from './eslint.endge.config.mjs'

export default [
  ...await createEndgeEslintConfig(),
  {
    files: [
      'src/model/runtime/app/NovaRaphRuntime.ts',
      'src/model/runtime/app/createNovaRaphRuntime.ts',
      'src/model/runtime/tree/NovaRaphNode.ts',
      'src/test/app/NovaRaphRuntime.test.ts',
    ],
    rules: {
      'style/max-statements-per-line': 'off',
    },
  },
]

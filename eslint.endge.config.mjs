import antfu from '@antfu/eslint-config'

const scriptFiles = ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}']
const sourceFiles = ['src/**/*.{js,mjs,cjs,ts,tsx,mts,cts,vue}']
const typedFiles = ['**/*.{ts,tsx,mts,cts,vue}']

const endgeConfigs = [
  {
    name: 'endge/ignores',
    ignores: [
      '**/.cache/**',
      '**/.codex/**',
      '**/.next/**',
      '**/.nova-generated/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/.pnpm-store/**',
      '**/.svelte-kit/**',
      '**/.turbo/**',
      '**/.vite/**',
      '**/.vitepress/cache/**',
      '**/.vitepress/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/dist/**',
      '**/fixtures/**/generated/**',
      '**/mock/**/*.{json,json5}',
      '**/node_modules/**',
      '**/out/**',
      '**/storybook-static/**',
      '**/target/**',
      '**/*.binary.{js,mjs,cjs,ts,mts,cts}',
      '**/*.generated.*',
      '**/*.min.{js,mjs,cjs}',
      '**/*.tsbuildinfo',
      'artifacts/**',
    ],
  },
  {
    name: 'endge/common',
    files: [...scriptFiles, '**/*.vue'],
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      curly: ['error', 'all'],
    },
  },
  {
    name: 'endge/typescript',
    files: typedFiles,
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: ['memberLike'],
          modifiers: ['private'],
          format: null,
          leadingUnderscore: 'require',
        },
        {
          selector: ['parameterProperty'],
          modifiers: ['private'],
          format: null,
          leadingUnderscore: 'require',
        },
      ],
      'ts/no-use-before-define': ['error', {
        classes: true,
        functions: false,
        typedefs: false,
        variables: true,
      }],
    },
  },
  {
    name: 'endge/vue',
    files: ['**/*.vue'],
    rules: {
      'vue/no-mutating-props': 'error',
    },
  },
  {
    name: 'endge/pinia',
    files: sourceFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'pinia', message: 'FE-PINIA-001: state принадлежит Federation/Module.' },
          ],
        },
      ],
    },
  },
  {
    name: 'endge/domain-boundary',
    files: ['src/**/domain/**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    ignores: [
      'src/**/modules/domain/**',
      'src/test/**',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'FE-DOMAIN-001: domain получает готовые данные вне DOM.' },
        { name: 'fetch', message: 'FE-DOMAIN-001: external operation выполняется вне domain.' },
        { name: 'localStorage', message: 'FE-DOMAIN-001: persistence выполняется вне domain.' },
        { name: 'window', message: 'FE-DOMAIN-001: browser operation выполняется вне domain.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'axios', message: 'FE-DOMAIN-001: network client запрещён в domain.' },
            { name: 'ky', message: 'FE-DOMAIN-001: network client запрещён в domain.' },
            { name: 'pinia', message: 'FE-DOMAIN-001: framework state запрещён в domain.' },
            { name: 'vue', message: 'FE-DOMAIN-001: Vue запрещён в domain.' },
          ],
          patterns: [
            {
              group: ['**/ui/**', '**/*.vue'],
              message: 'FE-DOMAIN-001: domain не зависит от UI.',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'endge/ui-boundary',
    files: ['src/**/ui/**/*.{js,mjs,cjs,ts,tsx,mts,cts,vue}', 'src/**/*.vue'],
    ignores: [
      'src/**/modules/ui/**',
      'src/test/**',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'FE-UI-STATIC-001: UI вызывает Module, а не raw transport.' },
        { name: 'localStorage', message: 'FE-UI-STATIC-001: persistent state принадлежит Module.' },
        { name: 'sessionStorage', message: 'FE-UI-STATIC-001: persistent state принадлежит Module.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'axios', message: 'FE-UI-STATIC-001: network client запрещён в UI.' },
            { name: 'ky', message: 'FE-UI-STATIC-001: network client запрещён в UI.' },
            { name: 'pinia', message: 'FE-PINIA-001: UI получает state через Federation/Module.' },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.type=\'Identifier\'][callee.name=/(_(?:Service|Module|Federation)|(?:Service|Module|Federation))$/]',
          message: 'FE-UI-STATIC-001: UI получает Module через Federation и не создаёт architectural layers.',
        },
        {
          selector: 'MemberExpression[object.name=/^(window|globalThis)$/][property.name=/^(localStorage|sessionStorage)$/]',
          message: 'FE-UI-STATIC-001: persistent state принадлежит Module.',
        },
      ],
    },
  },
  {
    name: 'endge/module-layout',
    files: [
      'src/**/*Federation.{ts,tsx,mts,cts}',
      'src/**/*Module.{ts,tsx,mts,cts}',
      'src/**/*_Federation.{ts,tsx,mts,cts}',
      'src/**/*_Module.{ts,tsx,mts,cts}',
    ],
    rules: {
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'explicit' }],
    },
  },
]

/**
 * Создаёт обязательный ESLint-профиль Endge поверх target-specific overlays
 */
export function createEndgeEslintConfig(...targetConfigs) {
  return antfu({ markdown: false, typescript: true, vue: true }, ...targetConfigs, ...endgeConfigs)
}

export default createEndgeEslintConfig()

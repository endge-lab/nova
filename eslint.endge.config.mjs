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
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'FE-DOMAIN-001: DOM принадлежит внешнему Adapter.' },
        { name: 'fetch', message: 'FE-DOMAIN-001: transport принадлежит внешнему Adapter.' },
        { name: 'localStorage', message: 'FE-DOMAIN-001: storage принадлежит внешнему Adapter.' },
        { name: 'window', message: 'FE-DOMAIN-001: browser API принадлежит внешнему Adapter.' },
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
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'FE-UI-STATIC-001: UI вызывает Module, а не raw transport.' },
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
    },
  },
  {
    name: 'endge/service-boundary',
    files: [
      'src/**/services/**/*.{js,mjs,cjs,ts,tsx,mts,cts}',
      'src/**/*Service.{js,mjs,cjs,ts,tsx,mts,cts}',
      'src/**/*_Service.{js,mjs,cjs,ts,tsx,mts,cts}',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'FE-SERVICE-DEPENDENCY-001: Service не использует DOM.' },
        { name: 'fetch', message: 'FE-SERVICE-DEPENDENCY-001: Service не использует transport.' },
        { name: 'localStorage', message: 'FE-SERVICE-DEPENDENCY-001: Service не использует storage.' },
        { name: 'window', message: 'FE-SERVICE-DEPENDENCY-001: Service не использует browser API.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'axios', message: 'FE-SERVICE-DEPENDENCY-001: transport принадлежит Adapter.' },
            { name: 'ky', message: 'FE-SERVICE-DEPENDENCY-001: transport принадлежит Adapter.' },
            { name: 'pinia', message: 'FE-SERVICE-DEPENDENCY-001: Service не владеет application state.' },
            { name: 'vue', message: 'FE-SERVICE-DEPENDENCY-001: Service не зависит от UI framework.' },
          ],
          patterns: [
            {
              group: ['**/adapters/**', '**/federations/**', '**/modules/**', '**/ui/**', '**/*.vue'],
              message: 'FE-SERVICE-DEPENDENCY-001: Service зависит только от contracts, Services и tools.',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'endge/module-external-boundary',
    files: [
      'src/**/modules/**/*.{js,mjs,cjs,ts,tsx,mts,cts}',
      'src/**/*Module.{js,mjs,cjs,ts,tsx,mts,cts}',
      'src/**/*_Module.{js,mjs,cjs,ts,tsx,mts,cts}',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'FE-ADAPTER-BOUNDARY-001: DOM принадлежит Adapter.' },
        { name: 'fetch', message: 'FE-ADAPTER-BOUNDARY-001: transport принадлежит Adapter.' },
        { name: 'localStorage', message: 'FE-ADAPTER-BOUNDARY-001: storage принадлежит Adapter.' },
        { name: 'window', message: 'FE-ADAPTER-BOUNDARY-001: browser API принадлежит Adapter.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'axios', message: 'FE-ADAPTER-BOUNDARY-001: network client принадлежит Adapter.' },
            { name: 'ky', message: 'FE-ADAPTER-BOUNDARY-001: network client принадлежит Adapter.' },
            { name: 'pinia', message: 'FE-PINIA-001: Module сам является owner state.' },
          ],
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

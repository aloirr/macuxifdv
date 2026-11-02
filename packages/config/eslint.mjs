/**
 * ESLint compartilhado (flat config). Herdado da Fase M, com ignores do monorepo modular.
 * A raiz (eslint.config.mjs) reexporta esta configuração; cada pacote roda `eslint .`.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { ARQUIVOS_DE_TESTE, pluginMacuxi } from './regras/hora-fixa.mjs';

export const macuxiEslint = tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.expo/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      '**/expo-env.d.ts',
      // fixtures do teste de fronteira: violam as regras de propósito
      '**/__fixtures__/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      // O Babel do Metro (babel-preset-expo) rejeita `declare` em campo de classe e o build EAS cai no bundle
      // (T-0004 §7, ADR 0008 adendo). Vale no monorepo todo: platform-sdk e modules/* vão para o app.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'PropertyDefinition[declare=true]',
          message:
            'Sem `declare` em campo de classe: o Babel do Metro não aceita (T-0004 §7). Use `override readonly x = valor as const;`.',
        },
      ],
    },
  },
  {
    // T-0043 (ADR 0015): teste não mistura instante fixo com o relógio real. AVISO até virar erro (data no ADR);
    // exceção pontual com `// hora-fixa-ok: <motivo>`.
    files: ARQUIVOS_DE_TESTE,
    plugins: { macuxi: pluginMacuxi },
    rules: { 'macuxi/hora-fixa-em-teste': 'warn' },
  },
);

export default macuxiEslint;

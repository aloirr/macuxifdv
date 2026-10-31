# ADR 0001 — Monorepo modular: workspace, pacotes base e fronteiras no CI

- **Status**: aceita
- **Data**: 2026-10-31
- **Tarefa**: T-0001 (Fase A)
- **Autor**: engenheiro-software

## Contexto
A Fase M (`C:\Users\domon\dev\forca-vendas`) é um monorepo pnpm + turbo com `packages/domain` e
`packages/contracts` únicos e três apps (web, mobile, mock-api). O produto agora é uma plataforma de
8 módulos licenciáveis (docs/produto/02 e 04) com fronteiras rígidas: um módulo só importa
`packages/*`, `modules/core/contracts` e `modules/<outro>/contracts`, e isso precisa ser checado no CI.

## Decisão
1. **Workspace pnpm** com `apps/*`, `packages/*` e `modules/*`; `nodeLinker: hoisted` (Expo/React Native),
   `minimumReleaseAge: 1440` — mesmas escolhas da Fase M. **Turbo** orquestra `lint`, `typecheck`, `test`, `build`.
2. **Cada módulo é um pacote** `@macuxi/<modulo>` com `exports` restrito: `./contracts` (para outros módulos)
   e `./manifest`, `./api`, `./app`, `./web` (só para shells). Código TypeScript puro, sem build
   (os shells transpilam: `transpilePackages` no Next, Metro no Expo).
3. **Pacotes base** (escopo `@macuxi/`):
   - `config` — tsconfig (base/web/mobile), ESLint flat e regras de fronteira;
   - `platform-sdk` — `defineModule`, módulos efetivos, extensões, barramento de eventos, sync, acesso;
     subcaminho `./web` com cliente HTTP e sessão;
   - `ui` — kit web (`./web`) e kit mobile (`./mobile`) vindos da Fase M;
   - `comum` — dinheiro e calendário (ADR 0002).
4. **Fronteiras com dependency-cruiser** (`packages/config/dependency-cruiser.cjs`, rodado por
   `pnpm fronteiras`, que faz parte de `pnpm lint` e do CI). Regras de erro:
   `modulo-importa-interno-de-outro`, `modulo-importa-caminho-nao-exportado`, `modulo-importa-app`,
   `pacote-importa-modulo-ou-app`, `contracts-importa-camada-interna`, `domain-importa-camada-interna`,
   `domain-usa-modulo-do-node`. `tsPreCompilationDeps: true` para pegar também `import type`.
   Fixtures em `packages/config/__fixtures__/{violacao,ok}` provam que a violação FALHA (exit = nº de erros).
5. Ferramentas herdadas da Fase M sem mudança de versão: TypeScript ~5.9 (mobile ~6.0 como na Fase M),
   Vitest 3, ESLint 9 + typescript-eslint, Zod 3.25, Next 16, Expo 57. Nova dependência de dev:
   **dependency-cruiser 17** (só CI/dev, não vai para o app).

## Alternativas consideradas
- **Regra de fronteira só no ESLint** (`eslint-plugin-boundaries` / `no-restricted-imports`): exige
  configuração por módulo e não enxerga `import type` resolvido por symlink do workspace; depcruise
  resolve caminhos reais e é o que o doc 04 já previa.
- **Só `exports` do package.json**: bloqueia imports por nome de pacote, mas não imports relativos
  (`../../catalogo/domain`). Usamos os dois (exports + depcruise).
- **Nx/Bazel**: mais poder (grafo, cache distribuído), muito mais peso e curva; turbo basta.

## Consequências
- Todo módulo novo segue o modelo de `docs/desenho/T-0001.md` (package.json, tsconfig, manifest.ts).
- Precisa de algo interno de outro módulo → pedir ao dono para expor em `contracts` (recado).
- `pnpm lint` falha no CI se a fronteira for violada; a revisão do engenheiro confere também.

## Adendo (2026-10-31, revisão final da T-0001)
- O workspace inclui também `db` (`@macuxi/db`, T-0002).
- `tests/` (agente `testes`, T-0006) não é pacote do workspace: roda como **tarefas raiz do turbo**
  (`//#lint:tests`, `//#typecheck:tests`, `//#test:tests`, scripts `lint:tests`/`typecheck:tests`/`test:tests` do
  `package.json` da raiz), chamadas por `pnpm lint`, `pnpm typecheck` e `pnpm test` e, portanto, pelo CI.
  `tests/fixtures/**` fica fora do lint (são violações de propósito).

# ADR 0003 — Motor de sync e registro de telas dos módulos no `platform-sdk`

- **Status**: aceita
- **Data**: 2026-10-31
- **Tarefa**: T-0001 (Fase A2) · prepara T-0004
- **Autor**: engenheiro-software

## Contexto
Na Fase M, `apps/mobile/src/state/app-store.tsx` (1.082 linhas) concentrava sessão, cache, fila de envio,
sincronização, pedido, visita, rascunho e carteira — tudo do app do vendedor. No monorepo modular isso
quebra três regras: o shell passaria a conhecer regras de módulo (pedido, visita), um módulo novo
(promotor, pesquisa, treinamento) teria de editar o shell para sincronizar, e nada impediria um módulo
desativado de deixar dados no aparelho (RN-CORE-02). O mesmo vale para menus e abas fixos nos shells
(`OPERATION`/`ANALYST` no web, `TABS` no app).

## Decisão
1. **Motor de sync genérico no `platform-sdk`** (`criarMotorSync`, puro TS, sem React/rede/disco):
   outbox FIFO persistida e idempotente pelo UUID do aparelho; push em lotes de até 500 com resultado por
   item (aceito / rejeitado com código / conflito); pull por entidade de módulo efetivo com cursor
   `(updated_at, id)`; etapas de carga próprias por módulo; RN-CORE-02 (fila de módulo desativado é
   tentada, marcada "não enviado — módulo desativado" e só apagada com confirmação). Armazenamento e
   transporte são **adaptadores injetados** (AsyncStorage/SQLite e HTTP no app; memória e
   `criarServidorSyncSimulado` nos testes).
2. **Registro de telas** (`definirModuloShell` / `criarShell(app, modulos).montar(ctx)`): cada módulo
   exporta `moduloWeb` (de `web/index.ts`) e `moduloApp` (de `app/index.ts`) com páginas, entidades e
   etapas de sync. O shell monta menus/abas e rotas só de módulos efetivos, da variante, do perfil e com
   permissão por ação (ADR 0004); valida tudo no carregamento (rótulo no manifesto, caminho único, ação
   declarada, entidade no `sync` do manifesto).
3. **Contexto React** em `@macuxi/platform-sdk/react` (`ShellProvider`, `useVisaoShell`, `usePode`,
   `SePode`, `useMotorSync`): é como uma tela de módulo fala com o shell sem importar `apps/*`.
4. **Estado de plataforma** do app em `apps/mobile/src/state/plataforma.tsx` (sessão, servidor, modo sem
   sinal, módulos efetivos, timers); o estado de pedido/visita volta para `modules/vendedor|core/app` na
   B2, guardado em `motor.armazenamentoDoModulo(m)` (apagado junto com o módulo).

## Alternativas consideradas
- **Manter o `app-store` no shell e "fatiar" depois**: mais rápido agora, mas a B2 copiaria telas que
  dependem dele e o acoplamento ficaria permanente.
- **Uma biblioteca de sync pronta (WatermelonDB, PowerSync, RxDB)**: dependência pesada, exige schema
  próprio no servidor e não conhece licença por módulo; revisitar quando o volume (20 mil SKUs) pedir
  SQLite com índices — o adaptador de armazenamento isola essa troca.
- **Um registro por app (web e mobile separados)**: mesma regra duas vezes; o genérico `C` (tipo do
  componente) cobre React e React Native.

## Consequências
- Módulo novo sincroniza e aparece nos shells só declarando manifesto + `moduloApp`/`moduloWeb`; o shell
  só ganha uma linha em `lib/modulos.ts` (instalação).
- Enquanto `apps/api` não tem `/v1/sync/*`, o app usa o transporte `fase-m` (mapeia pedido/visita para o
  push legado do mock-api) e as `etapasSync` REST dos módulos; `EXPO_PUBLIC_SYNC=v1` liga o contrato novo.
- Armazenamento chave→JSON (AsyncStorage) atende a Sprint 0; a troca por SQLite é só um adaptador.
- Testes de componente montam o shell com `criarShell(...).montar(...)` + `ShellProvider` (registro
  injetável), sem rede nem aparelho.

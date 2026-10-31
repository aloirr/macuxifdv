# ADR 0003 — Motor de sync e registro de telas dos módulos no `platform-sdk`

- **Status**: aceita
- **Data**: 2026-10-31
- **Tarefa**: T-0001 (Fase A2; adendos da A3) · prepara T-0004 e T-0008
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
- Armazenamento chave→JSON (AsyncStorage) atende a Sprint 0; a troca por SQLite é só um adaptador
  (gatilho e critérios no adendo "Troca do armazenamento" abaixo — T-0008).
- Testes de componente montam o shell com `criarShell(...).montar(...)` + `ShellProvider` (registro
  injetável), sem rede nem aparelho.

## Adendo 2026-10-31 (T-0001 A3) — ambiente do aparelho no contexto do SDK
- `ContextoEtapaSync` estende `AmbienteAparelho` (`packages/platform-sdk/src/ambiente.ts`): as etapas recebem
  `ctx.http` (`get`/`requisitar`, com a sessão do shell), `ctx.online()`, `ctx.novoId()` (UUID do aparelho) e
  `ctx.usuario()`. As telas recebem o mesmo por `useAmbiente()`/`useHttp()` (`@macuxi/platform-sdk/react`) e
  `motor.ambiente`/`motor.http`. O shell injeta o ambiente em `criarMotorSync({ ambiente })` e no `ShellProvider`.
- Modo sem sinal: o `http` lança `ErroSemConexao` sem tocar a rede (nada sai do aparelho). Erro da API vira
  `ErroHttp` (`status`, `codigo`, `detalhes`). Sem ambiente (antes do login, testes), vale o "indisponível":
  offline e `http` falhando com mensagem em português.
- Escrita de negócio continua pela fila (`enfileirar`); `requisitar` com POST/PUT é só para o que exige resposta
  na hora (editar/cancelar pedido já enviado) e o módulo trata `ErroSemConexao`.
- A outbox legada do shell (`apps/mobile/src/lib/outbox.ts`) saiu; 4 dos 6 casos da Fase M foram reescritos sobre o
  motor (`motor-sync.fase-m.test.ts`) e os 2 de pedido foram para `modules/vendedor/app/lib`.
- Alternativa descartada: um "ambiente" por módulo (`definirAmbienteVendedor`, estado global do módulo) — cada
  módulo reinventaria sessão/sinal/UUID e o shell teria de conhecer todos. Fica só como ponte de transição até o
  Vendedor migrar.

## Adendo 2026-10-31 — Troca do armazenamento chave→JSON por SQLite com FTS5 (gatilho da T-0008)
Decisão do Alexandre (R-20261031-021714): o armazenamento chave→JSON (AsyncStorage) não atende o volume e a busca
offline do doc 04 (20 mil SKUs, 500 clientes, busca < 300 ms). A troca é feita na **T-0008 (Sprint 1)**, como novo
adaptador de `ArmazenamentoSync`, sem mudar a interface do motor nem os módulos.

- **Gatilho**: antes de o módulo Catálogo (busca offline) entrar no aparelho; a T-0008 é pré-requisito dele. Também
  dispara antes se, na T-0004, a carga de produto/cliente no aparelho de teste travar a UI ou passar de 2 s para
  abrir o app.
- **O que muda**: adaptador SQLite (`expo-sqlite`) com uma tabela por entidade de sync (linhas indexadas por `id` e
  `(updated_at, id)`), tabela da fila (outbox) e tabela chave→valor para o resto; índice **FTS5** para a busca
  offline do Catálogo (sinônimos do tenant, correção de digitação e atributos — doc 04 "Busca"). O schema SQLite do
  aparelho é desenhado com o banco-dados.
- **O que não muda**: `ArmazenamentoSync`, `criarMotorSync`, `etapasSync`, `armazenamentoDoModulo` e RN-CORE-02
  (dados de módulo desativado apagados junto). O chave→JSON fica para testes e para o navegador.
- **Critérios (T-0008)**: carga de 20 mil SKUs e 500 clientes sem travar a UI; busca offline por texto < 300 ms;
  os mesmos testes do motor verdes nos dois adaptadores (chave→JSON e SQLite).
- Nova dependência (`expo-sqlite`) entra com este adendo; nenhuma biblioteca de sync pronta (ver Alternativas).

# ADR 0013 — CI em jobs paralelos, cache do Turborepo e check obrigatório `ci-ok`

- **Status**: proposta (2026-11-01, PR da T-0033; vira aceita com o merge do Alexandre). Item 7 (custo) revisto em 01/11 a
  pedido do Alexandre: escopo de coordenação ampliado, matriz enxuta também no push ao `main` e matriz completa só no run diário.
- **Data**: 2026-11-01
- **Tarefa**: T-0033 (pedido do Alexandre, R-20261101-073742, item 2)
- **Autor**: engenheiro-software
- **Base**: T-0005 (CI único com `verificar --base`/`--por-commit`), R-20261101-014652 (CI roda tudo e mostra todas as falhas),
  doc 07 "Frentes de trabalho" (merge da nuvem só com CI verde)

## Contexto
O CI era **um job só** (`verificar`) num runner `ubuntu-latest` de repositório privado (**2 vCPU**): coord e guardiões, install,
lint, fronteiras, typecheck, testes (19 tarefas do turbo de uma vez, todas disputando os 2 núcleos), build do BKO e bundle do
app, em série. Nos 5 últimos runs verdes do `main` levou de **6m40 a 8m58 (média 7m55)**; `testes` (~200 s) e `typecheck`
(~115 s) somavam 2/3 do tempo. O `tests/` da raiz sozinho levou 163 s: com 2 vCPU o Vitest usa **1 worker** (núcleos − 1), então
os 26 arquivos rodam em fila. Sem cache, todo PR refazia lint/typecheck/testes de todos os pacotes, mesmo os que não mudaram.

Ao preparar o cache, apareceu um defeito latente do `turbo.json`: o hash de `lint`/`typecheck`/`test` **não incluía as
dependências internas** (nenhum `dependsOn`), então mudar o `platform-sdk` não invalidava o `typecheck` do Core. Localmente isso
já podia devolver "verde" velho; no CI com cache seria certo.

## Decisão
1. **Jobs paralelos**, cada um no seu runner, sem `fail-fast`, e todos os passos de cada job com `if: !cancelled()` (nenhuma falha
   esconde outra):
   | job | o que roda | Postgres | cache do turbo |
   |---|---|---|---|
   | `governanca` | **decide o escopo e as matrizes** (`scripts/ci/escopo.mjs`, 1º passo; os outros jobs têm `needs` nela), testes do coord e dos guardiões, guardas de `scripts/ci`, `verificar --base` (PR) / `--por-commit` (push) | — | — |
   | `lint` | `turbo run lint lint:tests --continue` + `pnpm fronteiras` | — | sim |
   | `typecheck` | `turbo run typecheck typecheck:tests --continue`; run diário e manual: 2 grupos, `core-vendedor` (~30% do tsc) e `demais` (por exclusão; inclui o `//#typecheck:tests`); PR e push: 1 grupo | — | sim |
   | `testes-pacotes` | `turbo run test --continue`; run diário e manual: 2 grupos, `core-db-api-mock` e `demais` (por **exclusão**: pacote novo cai nele sozinho); PR e push: 1 grupo | sim | sim |
   | `testes-integracao` | `pnpm test:tests` em 3 execuções: `visitas-campo` sozinho (~60 s, 40% da suíte) e o resto com `--exclude` dele + `--shard=1/2` e `2/2` (a união é a suíte inteira; arquivo novo cai no resto). Diário e manual: 3 jobs; PR e push: 2 jobs (`visitas-campo` + `resto 2/2` em sequência, e `resto 1/2`) | sim | — (cache false) |
   | `build` | `next build` do BKO (com `.next/cache`) + bundle Metro das variantes campo e gestao | — | — |
   | `ci-ok` | `needs` de todos, `if: always()`; escopo completo: verde **só** se todos terminaram em `success`; escopo `coordenacao`: verde só se a governança passou e **todos** os outros foram `skipped` | — | — |
2. **Check obrigatório = `ci-ok`**. Pulado (fora do escopo `coordenacao`), cancelado ou falho em qualquer job = vermelho. A regra "merge da nuvem só com CI
   verde" (doc 07) passa a olhar o `ci-ok`. Observação: o plano atual do GitHub (privado, sem Pro) não deixa configurar branch
   protection/rulesets — o check é obrigatório por convenção do time até o plano permitir.
3. **Cache do turbo** (`.turbo/cache`, `actions/cache/restore` + `actions/cache/save`), um por job/grupo:
   chave `turbo-v1-<job>-<hash do pnpm-lock>-<sha>`, restauração pelo prefixo `turbo-v1-<job>-`; salvo mesmo com falha (o turbo
   só grava tarefa que passou); entradas com mais de 7 dias são podadas antes de salvar. O store do pnpm segue no `setup-node`.
   - **PR**: lê o cache (do `main` e do próprio PR — escopo de branch do GitHub) e só roda o que o turbo considera mudado. O
     grupo único do PR restaura também os caches dos 2 grupos do `main` (`cache-turbo-extra`; o turbo guarda por hash, os
     caches se somam).
   - **push ao `main`, run diário e manual**: não restauram; `TURBO_FORCE=true` **roda tudo** e grava o cache. O `main` nunca lê cache de PR.
   - Não usamos `--affected` (depende de histórico git e de base de comparação); o cache por hash de conteúdo dá o mesmo ganho
     com menos jeito de errar. Cache remoto (Vercel) continua fora — só com nova ADR.
4. **Grafo do turbo correto**: tarefa `transit` (`dependsOn: ["^transit"]`, sem script) em `lint`, `typecheck` e `test`, para o
   hash incluir as dependências declaradas no `package.json` sem serializar a execução. Onde o código escapa do grafo declarado
   (db, mobile e mock-api importam `modules/` por caminho relativo; `db` importa o `platform-sdk` sem declarar; o teste da
   Integração lê `docs/modulos/`; o `tests/` da raiz importa tudo), a tarefa ganha `inputs` com `$TURBO_ROOT$/<pasta>/**` e as
   exclusões de `node_modules`, `.turbo`, `.next`, `.expo`, `dist` e `*.tsbuildinfo` (glob explícito do turbo **não** respeita o
   `.gitignore`; sem as exclusões os logs `.turbo/turbo-*.log` mudariam o hash a cada execução).
5. **Guarda no CI** (`scripts/ci/grafo-turbo.mjs`, com teste): falha se (R1) `lint`/`typecheck`/`test` não dependem de `transit`;
   (R2) há import de `@macuxi/*` não declarado, import relativo ou leitura de arquivo (`'../'` literal, só para `test`) fora do
   pacote sem `$TURBO_ROOT$/<pasta>/**` nos inputs; (R3) há glob `$TURBO_ROOT$` sem as exclusões. Tarefa com `cache: false`
   está dispensada de R1–R3. (R4) nenhum código de pacote nem do `tests/` lê os caminhos de coordenação do item 7 (vale também
   com `cache: false`), condição para o escopo `coordenacao`. Assim um import novo fora do grafo não vira cache envenenado em silêncio.
6. **Banco modelo do Postgres** (parte do `banco-dados` e do `testes`, por recado): `criarBancoDeTeste` passa a copiar um banco
   `macuxi_modelo_<hash das migrações>` já migrado (`CREATE DATABASE … TEMPLATE`), criado uma vez por servidor sob advisory lock,
   com `IS_TEMPLATE true` e `ALLOW_CONNECTIONS false`; `MACUXI_PG_MODELO=0` volta ao caminho antigo. Medido no Postgres 16 local:
   migrar do zero ~0,5 s por banco × cópia do modelo ~0,12 s (a fixture dois-tenants ~0,15 s pode ir para um 2º modelo quando os
   parâmetros forem fixos). Ganho pequeno por arquivo, mas soma em cada `subirApi()`/`criarBancoDeTeste` e não muda o isolamento
   (cada arquivo segue com o próprio banco; papéis são do cluster; as migrações não usam `ALTER DATABASE`).
7. **Custo** (aprovado pelo Alexandre em 01/11; repositório privado no plano gratuito, 2.000 min/mês; o GitHub cobra cada
   job arredondado para cima ao minuto, e cada job paga ~30–40 s de preparo). Critério: **todo run disparado por commit (PR e
   push ao `main`) otimiza minutos dentro de ~200 s de parede; a cobertura máxima em paralelo fica num run diário.**
   - **Escopo `coordenacao`**: commit/PR em que TODO arquivo alterado é de coordenação — `.coord/**`, `docs/status/**`,
     `docs/backlog.md`, `docs/produto/**` (lista única `COORDENACAO` em `scripts/ci/escopo.mjs`) — roda só `governanca` (coord,
     guardiões, `verificar --por-commit`/`--base`) e `ci-ok` → 2 min. O resto de `docs/**` **não** entra (o teste da Integração
     lê `docs/modulos/`, R2). A guarda **R4** prova que nenhum código de pacote nem do `tests/` lê esses caminhos (nem uma pasta
     acima, como `docs`); hoje nenhum lê, então nenhum caminho pedido ficou de fora. Lista vazia, erro de git ou `ANTES` zerado
     = escopo completo (padrão seguro).
   - **Matriz enxuta no PR e no push ao `main`** (typecheck e testes de pacotes em 1 grupo; `tests/` em 2 partes —
     `visitas-campo` + `resto 2/2` em sequência, e `resto 1/2`). **Matriz completa** (2 + 2 + 3 jobs) só no **run agendado
     diário (07:00 UTC)** e no **manual** (`workflow_dispatch`), sempre forçado. As duas matrizes ficam em
     `scripts/ci/escopo.mjs`, com teste que garante que cobrem as mesmas execuções e que os grupos por exclusão casam.
   - **Fora do PR o CI roda tudo** (`TURBO_FORCE`, sem restaurar cache): a mudança no `main` foi só de quantos runners, não do
     que roda. O grupo único do PR lê o cache do próprio PR e o do `main` (inclusive os 2 grupos do diário).
   - **Concurrency**: no PR, um grupo por PR com `cancel-in-progress`. No `main` (push, agendado, manual), um grupo por evento +
     commit e **nada é cancelado**: o `verificar --por-commit` confere só `ANTES..DEPOIS` daquele push.
   - **Custo por run** (medido no PR #26 ou estimado a partir dos jobs medidos; detalhe no PR):
     | evento | antes (1 job) | depois |
     |---|---|---|
     | PR | 423 s · 7,2 min | 195 s · **13 min** (medido, cache quente) |
     | push ao `main` | 467 s · 8,2 min | ~190 s · **~17 min** (estimado, enxuta forçada) |
     | push só de coordenação | 489 s · 9 min | ~35 s · **2 min** (estimado) |
     | run diário completo | — | ~165 s · **~22 min** (estimado, 1×/dia) |
   - **Estimativa mensal** (30 dias; ritmo de 31/10–01/11 = 22 pushes ao `main` + ~20 runs de PR por dia):
     | cenário | antes | depois |
     |---|---|---|
     | ritmo atual, sem mudar o gerente (14% dos pushes só de coordenação) | ~9.800 | ~18.500 |
     | gerente com push só ao fechar tarefa ou de 2 em 2 h (~10 pushes/dia, 3 só de coordenação) + PRs no ritmo atual | ~6.900 | ~12.400 (main + diário ~4.400; PRs ~8.000) |
     | idem, com ~2 runs de PR/dia (fim do crédito da nuvem em 05/11) | ~2.900 | ~5.200 |
     **Conclusão**: no mesmo ritmo, o CI paralelo custa ~1,8× o antigo em minutos (cada job paga preparo e arredondamento),
     e os runs de PR são ~2/3 do total. Com estas regras nenhum cenário cabe nos 2.000 min/mês; o que mais pesa é o número de
     runs, não a matriz.
   - **Próximas alavancas** (não implementadas; decisão do Alexandre), em ordem de economia:
     1. **PR em rascunho não roda a matriz** (só governança e `ci-ok`; a matriz roda ao marcar "pronto para revisão" e nos
        pushes seguintes): hoje são ~5 runs por PR da nuvem; viraria ~1–2 → PRs de ~8.000 para ~2.500 min/mês.
     2. **Modo econômico em PR e push** (2 jobs pesados: estático + testes de pacotes num, `tests/` no outro): ~9 min e ~250 s
        por run, contra 13 min e 195 s.
     3. **Run diário só em dias úteis** (−~200 min/mês) ou desligado enquanto a cota estiver apertada (−~660 min/mês).

## Alternativas consideradas
- **Um job só com mais paralelismo do turbo/Vitest** (`--concurrency`, `--maxWorkers`): o gargalo é a CPU do runner (2 vCPU);
  mais concorrência no mesmo runner só aumenta a disputa. Runner maior (4+ vCPU) é pago à parte.
- **`turbo --affected`** em vez de cache: precisa de histórico completo e base certa em cada evento; errar a base pula teste.
- **Só `--shard=i/3` do Vitest**: foi a 1ª versão; o Vitest divide por hash do caminho, não por tempo, e o shard com o
  `visitas-campo` e o `notificacoes` ficou com ~100 s contra 20–31 s dos outros. Ficou o arquivo pesado isolado + shard do resto
  por exclusão (sem lista de arquivos à mão para envelhecer; se ele mudar de nome, o job dele falha com "No test files found").
- **`paths-ignore: .coord/**` no workflow + um 2º workflow só de governança**: sem job extra, mas o `ci-ok` some nos commits
  só de `.coord` ("ausente" vira ambíguo com "ainda não rodou") e a governança rodaria em dobro nos commits de código.
- **Job `escopo` separado** (sem `needs` na governança): ~30 s a menos de parede, mas +1 min cobrado em todo run.
- **Matriz completa em todo push ao `main`** (1ª versão do item 7): ~20 min por push e ~160 s de parede; trocada pela enxuta
  (~17 min, ~190 s) + o run diário completo, a pedido do Alexandre (cota do plano gratuito).
- **Cache remoto do turbo** (Vercel/servidor próprio): compartilharia com as máquinas locais, mas é serviço externo com
  credencial; não precisa agora.

## Consequências
- O tempo do CI passa a ser o do job mais lento (não a soma). Tabela antes × depois no PR da T-0033 e no recado ao Alexandre.
- **Minutos cobrados**: ver item 7 — por run, PR ~1,8× o antigo, push ao `main` ~2×, push só de coordenação ~0,25×, mais
  ~22 min/dia do run diário. A `governanca` é porta de entrada dos outros jobs (+~30 s de parede) para não pagar um job a mais
  só para decidir o escopo. Ajuste fino em `scripts/ci/escopo.mjs`.
- **Run diário vermelho** não bloqueia ninguém sozinho: o gerente confere no início da rodada
  (`gh run list --workflow CI --event schedule --limit 1`) e trata como `main` vermelho.
- Riscos e mitigação: **cache envenenado** — só o push ao `main` grava cache lido por todos e ele roda forçado; o PR só lê o
  próprio e o do `main`; guarda R1–R4 no CI. **Escopo `coordenacao` pular algo que importa** — só os 4 caminhos da lista entram, R4
  garante que nenhum código os lê, e a governança (que lê `.coord/donos.json`) roda sempre. **Regressão que só a matriz
  completa pegaria** (ex.: teste dependente da divisão em shards) — aparece no run diário, no máximo 24 h depois. **Teste instável no shard** — cada shard tem Postgres e `globalSetup` próprios
  (sem estado compartilhado entre shards); se um teste depender da ordem dos arquivos, aparece aqui e vai por recado ao `testes`.
  **Check obrigatório sem branch protection** — vale pela regra do time (doc 07) até o plano do GitHub permitir.
- Para o local nada muda nos comandos (`pnpm lint|typecheck|test`); o `transit` corrige o cache local também.

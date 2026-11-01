# ADR 0013 — CI em jobs paralelos, cache do Turborepo e check obrigatório `ci-ok`

- **Status**: proposta (2026-11-01, PR da T-0033; vira aceita com o merge do Alexandre)
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
   | `governanca` | testes do coord e dos guardiões, guarda do cache (`scripts/ci`), `verificar --base` (PR) / `--por-commit` (push) | — | — |
   | `lint` | `turbo run lint lint:tests --continue` + `pnpm fronteiras` | — | sim |
   | `typecheck` | `turbo run typecheck typecheck:tests --continue` | — | sim |
   | `testes-pacotes` ×2 | `turbo run test --continue` em 2 grupos: `core-db-api-mock` e `demais` (por **exclusão**: pacote novo cai nele sozinho) | sim | sim |
   | `testes-integracao` ×3 | `pnpm test:tests --shard=i/3` (Vitest divide por arquivo; a união é a suíte inteira) | sim | — (cache false) |
   | `build` | `next build` do BKO (com `.next/cache`) + bundle Metro das variantes campo e gestao | — | — |
   | `ci-ok` | `needs` de todos, `if: always()`; verde **só** se todos terminaram em `success` | — | — |
2. **Check obrigatório = `ci-ok`**. Pulado, cancelado ou falho em qualquer job = vermelho. A regra "merge da nuvem só com CI
   verde" (doc 07) passa a olhar o `ci-ok`. Observação: o plano atual do GitHub (privado, sem Pro) não deixa configurar branch
   protection/rulesets — o check é obrigatório por convenção do time até o plano permitir.
3. **Cache do turbo** (`.turbo/cache`, `actions/cache/restore` + `actions/cache/save`), um por job/grupo:
   chave `turbo-v1-<job>-<hash do pnpm-lock>-<sha>`, restauração pelo prefixo `turbo-v1-<job>-`; salvo mesmo com falha (o turbo
   só grava tarefa que passou); entradas com mais de 7 dias são podadas antes de salvar. O store do pnpm segue no `setup-node`.
   - **PR**: lê o cache (do `main` e do próprio PR — escopo de branch do GitHub) e só roda o que o turbo considera mudado.
   - **push ao `main`**: `TURBO_FORCE=true` ignora o cache restaurado e **roda tudo**, regravando o cache. O `main` nunca lê
     cache de PR.
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
   está dispensada. Assim um import novo fora do grafo não vira cache envenenado em silêncio.
6. **Banco modelo do Postgres** (parte do `banco-dados` e do `testes`, por recado): `criarBancoDeTeste` passa a copiar um banco
   `macuxi_modelo_<hash das migrações>` já migrado (`CREATE DATABASE … TEMPLATE`), criado uma vez por servidor sob advisory lock,
   com `IS_TEMPLATE true` e `ALLOW_CONNECTIONS false`; `MACUXI_PG_MODELO=0` volta ao caminho antigo. Medido no Postgres 16 local:
   migrar do zero ~0,5 s por banco × cópia do modelo ~0,12 s (a fixture dois-tenants ~0,15 s pode ir para um 2º modelo quando os
   parâmetros forem fixos). Ganho pequeno por arquivo, mas soma em cada `subirApi()`/`criarBancoDeTeste` e não muda o isolamento
   (cada arquivo segue com o próprio banco; papéis são do cluster; as migrações não usam `ALTER DATABASE`).

## Alternativas consideradas
- **Um job só com mais paralelismo do turbo/Vitest** (`--concurrency`, `--maxWorkers`): o gargalo é a CPU do runner (2 vCPU);
  mais concorrência no mesmo runner só aumenta a disputa. Runner maior (4+ vCPU) é pago à parte.
- **`turbo --affected`** em vez de cache: precisa de histórico completo e base certa em cada evento; errar a base pula teste.
- **Sharding por tempo** (arquivos pesados separados à mão): melhor equilíbrio, mas lista à mão envelhece; fica como ajuste se o
  shard mais pesado virar o caminho crítico (o `visitas-campo` leva ~66 s sozinho).
- **Cache remoto do turbo** (Vercel/servidor próprio): compartilharia com as máquinas locais, mas é serviço externo com
  credencial; não precisa agora.

## Consequências
- O tempo do CI passa a ser o do job mais lento (não a soma). Tabela antes × depois no PR da T-0033 e no recado ao Alexandre.
- **Minutos cobrados sobem**: são ~10 jobs por run (cada um arredonda para cima e paga ~40 s de preparo). No PR o cache
  reduz lint/typecheck/testes-pacotes; no `main` (força tudo) o custo em minutos fica ~2× o de antes. Os grupos e o número de
  shards ficam no `matrix` do workflow para ajuste fino.
- Riscos e mitigação: **cache envenenado** — só o push ao `main` grava cache lido por todos e ele roda forçado; o PR só lê o
  próprio e o do `main`; guarda R1–R3 no CI. **Teste instável no shard** — cada shard tem Postgres e `globalSetup` próprios
  (sem estado compartilhado entre shards); se um teste depender da ordem dos arquivos, aparece aqui e vai por recado ao `testes`.
  **Check obrigatório sem branch protection** — vale pela regra do time (doc 07) até o plano do GitHub permitir.
- Para o local nada muda nos comandos (`pnpm lint|typecheck|test`); o `transit` corrige o cache local também.

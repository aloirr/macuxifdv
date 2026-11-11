# ADR 0044 — CI por pacotes afetados, 5 jobs e reaproveitamento da árvore verde

- **Status**: proposta em 2026-11-11, no branch `agente/t0160-actions`. Mexe em `.github/**`, então o merge segue o rito de governança, com o "aprovo" do dono do produto.
- **Data**: 2026-11-11
- **Tarefa**: T-0160 (itens 1 a 7). Proposta R-20261110-193300-gerente-projetos, aprovada em R-20261110-202509-alexandre.
- **Autor**: engenheiro-software
- **Altera**: ADR 0014 (§custo e matrizes) e o gatilho da ADR 0020 (`demo-publicar`).

## Contexto
De 04 a 11/11, o CI rodou 244 vezes:

| Evento | Runs | Minutos cobrados por run | Minutos na semana |
|---|---|---|---|
| ensaio (`workflow_dispatch`) | 104 | ~47 | ~4.900 |
| push ao `main` | 70 | ~43 | ~3.000 |
| PR | 63 | ~30 | ~1.900 |
| noturno | 7 | ~47 | ~330 |

- O CI é ~90% do consumo. Some ~600 min do `demo-publicar` e ~300 do stack isolado.
- Cada job paga a preparação (checkout + `pnpm install`, ~1,5 min) e o minuto arredondado para cima. A matriz tinha até 12 jobs.
- O push ao `main` repetia o mesmo commit que o ensaio já tinha testado. Fora do PR, o turbo rodava todos os pacotes (`TURBO_FORCE`).

## Decisão
1. **Pacotes afetados** em PR, ensaio e push (`scripts/ci/escopo.mjs`):
   - entram os pacotes alterados, os dependentes declarados (em cadeia, como o `transit`) e os que leem a pasta alterada pelos inputs `$TURBO_ROOT$/<pasta>/**` do `turbo.json`, calculados por tarefa;
   - o tests/ da raiz (lint, typecheck e a suíte de integração) roda inteiro sempre que há código;
   - arquivo fora de pacote (lockfile, `package.json`, `turbo.json`, tsconfig, `.github`, `scripts`) roda todos os pacotes;
   - **todos os pacotes** no noturno, na sexta-feira em Manaus (véspera da produção) e no manual com `completo`.
2. **Árvore verde reaproveitada:**
   - o `ci-ok` verde com código grava o artefato `ci-verde-<matriz>-<tree SHA>`;
   - o push ao `main` da mesma árvore (ensaio que sobe em fast-forward, ou PR em dia com o `main`) roda só a governança;
   - o `escopo.mjs` confere três coisas: o run verde do `ci.yml`, a árvore do commit do run igual à do push (o `ci.yml` que rodou é o mesmo) e, na sexta, matriz completa;
   - a base do push é o último push verde do `main`: com `cancel-in-progress`, o push cancelado não deixa commit sem verificação de donos nem pacote sem teste.
3. **Só documentação não roda testes** (CI e `demo-publicar`):
   - documentação = `.coord/**`, `docs/**` e `*.md` da raiz, menos as pastas que o código lê (inputs do `turbo.json`: hoje `docs/modulos/`);
   - a guarda R4 (`grafo-turbo.mjs`) passa a cobrir essa documentação: literal relativo a partir do arquivo, e literal solto só se o caminho existe na raiz.
4. **5 jobs** em vez de 12, todos com o cache do pnpm, e o turbo com cache no PR:
   - `governanca`;
   - `estatico`: lint, fronteiras, timers, typecheck e build, este só se web ou mobile foram afetados;
   - `testes-pacotes`: os testes do turbo e, se o `@macuxi/db` foi afetado, a suíte sem superusuário num segundo Postgres (5433);
   - `testes-integracao`: o tests/ numa execução só;
   - `ci-ok`: exige `success` nos jobs da lista do escopo e `skipped` nos outros.
5. **PR em rascunho não roda** (`ready_for_review` roda), e `cancel-in-progress` vale em todo evento.
6. **`demo-publicar`:** no gatilho do CI, um job `mudou` compara com o commit do último deploy verde na VM (`scripts/ci/demo-mudou.mjs`):
   - publica só com mudança em `apps/**`, `modules/**`, `packages/**`, `db/**`, no que monta a imagem (`package.json`, lockfile, `pnpm-workspace.yaml`, `.nvmrc`, `turbo.json`) ou em `scripts/deploy/demo/**`;
   - o disparo manual sempre publica.
7. **Noturno só em dias úteis** (`0 7 * * 1-5`). A carga de 20 mil continua semanal (`carga-t0107.yml`, sem mudança).

## Alternativas consideradas
- **`turbo --filter=...[origin/main]` direto:** depende de histórico em cada job e não enxerga as pastas dos inputs nem o tests/ da raiz. O cálculo no `governanca`, que já tem o histórico, sai uma vez e vale para os 3 jobs.
- **Ler o cache do turbo também no `main`:** economiza mais, mas reabre o risco de cache envenenado que a ADR 0014 fechou. Fica fora.
- **Dividir tests/ por área:** não há mapa confiável de teste para pacote. A suíte inteira é o que garante o mesmo nível de verificação antes do `main`.
- **Marcar a árvore verde no cache do Actions:** o `main` não lê cache de outro branch. O artefato é lido pela API.

## Consequências
- Estimativa por semana, com os números de 04 a 11/11:
  - antes: ~10.300 min (CI ~9.400, `demo-publicar` ~600, stack isolado ~300);
  - depois, com o ritmo de hoje (104 ensaios): ~6.100 min (−40%);
  - depois, com 1 ensaio por lote (~50): ~4.500 min (−56%);
  - o item 8 (Telegram no repositório de recados) soma à parte.
- Por run: ~28 min cobrados com código afetado e ~37 com todos os pacotes, contra ~43–47. O push ao `main` de um ensaio verde e o commit só de documentação ficam em ~2.
  - O que sobra é a suíte de integração, ~12 min em todo run com código.
  - O que ainda pesa é o número de ensaios.
- Pacote novo entra sozinho (o grafo vem dos `package.json`). Pasta de documentação lida por código precisa estar nos inputs do `turbo.json`, ou a R4 fica vermelha.
- Wall time: o `testes-integracao` num job só leva ~12 min, contra ~7 antes, e passa a ser o caminho crítico.
- Reverter = voltar o `ci.yml`, o `escopo.mjs` e a R4 desta ADR. Não há estado guardado além dos artefatos de 14 dias.

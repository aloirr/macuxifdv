---
name: entrega
description: Fecha a sprint do Macuxi FDV — qualidade, revisão, recados pendentes, quadro, status e roteiro de demonstração.
disable-model-invocation: true
---

1. Rode `pnpm lint`, `pnpm typecheck`, `pnpm test`. Falhou → pare e mostre o erro e o agente dono.
2. `node scripts/coord.mjs pendencias`: nenhuma pendência aberta de tarefas da sprint (ou justificativa).
3. Donos: em branch de agente (`agente/T-nnnn-<agente>`) ou com trailer `Agente:`, rode `node scripts/coord.mjs verificar <agente> --base origin/main` (sem o agente, ele é inferido do branch/trailer) — saída 0 = OK, 1 = violação, 2 = erro de uso. Sem agente definido (sprint inteira na árvore compartilhada), rode `node scripts/coord.mjs verificar --por-dono`: alterações agrupadas por dono, sem caminhos `sem-dono` ou `congelado`. Violação → pare e mostre o arquivo e o dono.
4. Peça ao `engenheiro-software` a revisão do que mudou na sprint e ao `testes` o relatório consolidado.
5. Confira os critérios de pronto da sprint em `docs/produto/05-roadmap.md`.
6. Atualize `.coord/quadro.md`, `docs/backlog.md` e `docs/status/AAAA-MM-DD.md` (o que entrou, testes por pacote, pendências, riscos, próximo passo).
7. Envie recado `entrega` para `alexandre` com um roteiro de demonstração de 5 a 8 passos.

**1 push por PR** e testes de banco na sessão antes do push: doc 07, seção 3, e `CLAUDE.md` (R-20261115-215000-alexandre).

**Testes dos dependentes antes do push** (R-20261115-213600-alexandre; caso: o main ficou vermelho em `bc26a241`, às 22h30 de 15/11, porque o #386 do core quebrou testes do `apps/mobile` e o #385 quebrou `tests/modulos/t0140`, e a sessão do dono só rodou o próprio pacote):
- rode os testes do pacote alterado e dos que dependem dele com `pnpm turbo run test --filter=...[origin/main]`, sem banco, mais os arquivos de `tests/` que tocam o que mudou;
- com o Postgres local (`db/scripts/pg-local.sh`, PR #450), rode também os `*.db.test` e o `tests/` com banco;
- ponha o resumo no corpo do PR.

Responda com um resumo de até 15 linhas.

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
Responda com um resumo de até 15 linhas.

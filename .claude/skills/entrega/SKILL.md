---
name: entrega
description: Fecha a sprint do Macuxi FDV — qualidade, revisão, recados pendentes, quadro, status e roteiro de demonstração.
disable-model-invocation: true
---

1. Rode `pnpm lint`, `pnpm typecheck`, `pnpm test`. Falhou → pare e mostre o erro e o agente dono.
2. `node scripts/coord.mjs pendencias`: nenhuma pendência aberta de tarefas da sprint (ou justificativa).
3. `node scripts/coord.mjs verificar`: alterações agrupadas por dono, sem caminhos `sem-dono`.
4. Peça ao `engenheiro-software` a revisão do que mudou na sprint e ao `testes` o relatório consolidado.
5. Confira os critérios de pronto da sprint em `docs/produto/05-roadmap.md`.
6. Atualize `.coord/quadro.md`, `docs/backlog.md` e `docs/status/AAAA-MM-DD.md` (o que entrou, testes por pacote, pendências, riscos, próximo passo).
7. Envie recado `entrega` para `alexandre` com um roteiro de demonstração de 5 a 8 passos.
Responda com um resumo de até 15 linhas.

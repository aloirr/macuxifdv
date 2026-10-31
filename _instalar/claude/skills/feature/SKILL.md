---
name: feature
description: Gerente de projetos conduz uma funcionalidade de ponta a ponta com o time (tarefa, desenho, banco, módulos, testes, revisão, fechamento).
argument-hint: <RF-... ou descrição da funcionalidade>
disable-model-invocation: true
---

Conduza a funcionalidade: **$ARGUMENTS**

1. Crie a tarefa `.coord/tarefas/T-nnnn.md` (modelo em `.coord/modelos/tarefa.md`) com critérios de aceite verificáveis e atualize `.coord/quadro.md`. Mostre-me o resumo (objetivo, critérios, módulos e agentes) e **aguarde meu OK**.
2. `engenheiro-software`: desenho técnico e contratos (`docs/desenho/T-nnnn.md`, `.coord/contratos/`).
3. `banco-dados`: schema e migração dos módulos afetados.
4. Agentes dos módulos afetados (em paralelo só se independentes, máx. 3).
5. `testes`: matriz de cenários e relatório critério → teste → resultado.
6. `engenheiro-software`: revisão final. Havendo 🔴, devolva ao dono via recado e repita 4–6.
7. `node scripts/coord.mjs pendencias` e `node scripts/coord.mjs verificar` sem pendências/violações.
8. Feche a tarefa, atualize o quadro e me entregue: o que foi feito, como testar em 5 passos, premissas, pendências e a mensagem de commit sugerida (Conventional Commits em português). Não faça commit sem eu pedir.

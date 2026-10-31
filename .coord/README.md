# .coord — coordenação do time de agentes

| Pasta/arquivo | Para quê | Quem altera |
|---|---|---|
| `donos.json` | Dono de cada caminho do repo (primeira regra vence) | Só o Alexandre |
| `quadro.md` | Quadro de tarefas da sprint | gerente-projetos |
| `tarefas/T-nnnn.md` | Uma tarefa: objetivo, critérios, agentes | gerente-projetos |
| `recados/<destino>/R-*.md` | Recados imutáveis entre agentes (e para `alexandre`/`todos`) | Qualquer agente cria; ninguém edita |
| `diario/<agente>.md` | Linha do tempo do agente | O próprio agente |
| `lidos/<agente>.txt` | Recados informativos já lidos | O próprio agente (via CLI) |
| `contratos/` | Registro de eventos, extensões e dependências entre módulos | engenheiro-software |
| `modelos/` | Modelos de tarefa e recado | gerente-projetos |

CLI: `node scripts/coord.mjs` (sem argumentos mostra a ajuda). Protocolo completo: `docs/produto/07-agentes-e-coordenacao.md`.

Você (Alexandre) também conversa por aqui: `node scripts/coord.mjs caixa alexandre` mostra o que o time te mandou; `node scripts/coord.mjs enviar --de alexandre --para gerente-projetos --tipo pedido --assunto "..." --corpo "..."` deixa uma ordem.

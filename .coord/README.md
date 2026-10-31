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

## Verificação de donos (`verificar`)

Confere os arquivos alterados contra `donos.json` (a primeira regra que casa define o dono).

```bash
node scripts/coord.mjs verificar modulo-core                     # árvore de trabalho × HEAD (árvore compartilhada)
node scripts/coord.mjs verificar modulo-core --base origin/main  # diff do branch (PR/CI)
node scripts/coord.mjs verificar --base origin/main              # agente inferido do branch ou do trailer
node scripts/coord.mjs verificar --por-dono                      # tudo o que mudou, agrupado por dono
```

| Situação | Sem `--base` | Com `--base <ref>` |
|---|---|---|
| Arquivo do próprio agente | OK | OK |
| Arquivo de outro dono | **Outros donos** (informativo, não muda a saída) | **VIOLAÇÃO** |
| Caminho `sem-dono` ou `congelado` | VIOLAÇÃO | VIOLAÇÃO |
| Recado **novo** em `recados/<destino>/` (qualquer agente) | exceção | exceção |
| Recado existente alterado ou apagado | VIOLAÇÃO | VIOLAÇÃO |
| `diario/<agente>.md` e `lidos/<agente>.txt` do próprio agente | exceção | exceção |
| Diário/lidos de outro agente | Outros donos | VIOLAÇÃO |

- `--base <ref>` compara com o merge-base entre `HEAD` e `<ref>` (o mesmo que `git diff <merge-base>...HEAD`) e soma o que ainda não foi commitado e os arquivos não rastreados. Renomear conta como apagar + criar.
- Agente omitido: vem do branch `agente/T-nnnn-<agente>` (ou `alexandre/...` → `alexandre`), de `GITHUB_HEAD_REF` no CI, ou do trailer `Agente: <nome>` no último commit (no CI, também do último commit do PR). Sem como inferir → erro de uso.
- `alexandre` é o dono do produto: arquivos de outros donos aparecem como informativos mesmo com `--base`; `sem-dono`, `congelado` e recado alterado continuam violação.
- Caminhos com `\` (Windows) são normalizados para `/`.
- Código de saída: **0** sem violação · **1** com violação · **2** erro de uso ou de git (ex.: ref inexistente).
- No CI (checkout limpo) a base precisa existir localmente: `actions/checkout` com `fetch-depth: 0` ou `git fetch origin main` antes de rodar `node scripts/coord.mjs verificar --base origin/main`.
- Testes do script: `node --test scripts/coord-verificar.test.mjs`.

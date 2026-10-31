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
node scripts/coord.mjs verificar --base origin/main              # agente inferido do branch ou dos trailers
node scripts/coord.mjs verificar                                 # sem agente: lista agrupada por dono
node scripts/coord.mjs verificar --por-dono                      # idem, mesmo com agente no branch
```

| Situação | Sem `--base` | Com `--base <ref>` |
|---|---|---|
| Arquivo do próprio agente | OK | OK |
| Arquivo de outro dono (inclui os do `alexandre`) | **Outros donos** (informativo, não muda a saída) | **VIOLAÇÃO** |
| Caminho `sem-dono` ou `congelado` | VIOLAÇÃO | VIOLAÇÃO |
| Recado **novo** do próprio agente em `recados/<destino>/` | exceção | exceção |
| Recado novo com o nome de **outro** remetente | Outros donos (do remetente) | VIOLAÇÃO "o nome do recado precisa conter o remetente" |
| Recado em destino inválido ou sem remetente no nome | VIOLAÇÃO | VIOLAÇÃO |
| Recado existente alterado ou apagado | VIOLAÇÃO | VIOLAÇÃO |
| `diario/<agente>.md` e `lidos/<agente>.txt` do próprio agente | exceção | exceção |
| Diário/lidos de outro agente | Outros donos (do agente) | VIOLAÇÃO |

- `--base <ref>` compara com o merge-base entre `HEAD` e `<ref>` (o mesmo que `git diff <merge-base>...HEAD`) e soma o que ainda não foi commitado e os arquivos não rastreados. O que o `main` mudou depois do branch não aparece. Renomear conta como apagar + criar (os dois caminhos são conferidos); apagar também é alterar.
- **Agente** (nesta ordem): o informado no comando; o do branch — `<agente>/T-nnnn[-assunto]` (ex.: `modulo-core/T-0003-licencas`), `agente/T-nnnn-<agente>` ou `alexandre/...` → `alexandre` —, local ou de `GITHUB_HEAD_REF` no CI; só com `--base`, o trailer `Agente: <nome>` dos commits do PR (sem os de merge).
  - Pelo trailer, **todos** os commits do PR precisam dele e com o mesmo agente. Agentes diferentes → erro `agente ambíguo: a, b`; commit sem trailer → erro com a lista dos commits.
  - Branch `nuvem/*`: o agente vem só do trailer, obrigatório em todos os commits (sem trailer → erro).
  - Sem nada disso: com `--base` → erro `informe o agente ou use branch <agente>/T-nnnn` (diff vazio é OK); sem `--base` → a lista agrupada por dono (recados pelo remetente, diário/lidos pelo agente).
- `alexandre` é o dono do produto: arquivos de outros donos aparecem como informativos mesmo com `--base`; `sem-dono`, `congelado` e recado alterado continuam violação.
- Caminhos com espaço, acento ou parênteses são lidos do git sem aspas (`core.quotePath=false`) e casam com as regras como texto literal; `\` (Windows) vira `/`.
- Código de saída: **0** sem violação · **1** com violação · **2** erro de uso ou de git (agente desconhecido ou ambíguo, ref não encontrada, trailer faltando).
- No CI (checkout limpo) a base precisa existir localmente: `actions/checkout` com `fetch-depth: 0` ou `git fetch origin main` antes de rodar `node scripts/coord.mjs verificar --base origin/main`.
- Testes do script: `node --test scripts/coord-verificar.test.mjs` (casos A1–A11 e B1–B12 do engenheiro, R-20261031-071802-engenheiro-software).

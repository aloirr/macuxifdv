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

## Rondas, commit, push e PR (time 100% na nuvem)

Decisão do Alexandre (chat, 14/11/2026: "Migre tudo para a nuvem"), valendo desde o build Oficial v1.0.7. Base técnica: ADR do time na nuvem (proposto), do engenheiro-software. Detalhes: doc 07, seções 1 a 5.

- **Onde**: todo agente roda numa sessão do claude.ai/code, num branch `nuvem/*`, `alexandre/*` ou `agente/*`. O PC (VS Code, `C:\macuxifdv`) não roda mais o time. A pasta da Fase M continua só para consulta.
- **Rondas**: o gerente-projetos é uma sessão fixa com rondas agendadas a cada 15–20 min (caixas, PRs `[PRONTO PARA MERGE]`, CI, quadro, vagas). As 7 vagas são 7 sessões da nuvem.
- **Commit e push**: um commit por PR (`T-nnnn: <resumo>` + `Agente: <dono>`; ajustes por `--amend` antes do push) e um push só. Lint, typecheck e testes rodam na sessão antes.
- **PR**: um por dono e por lote; merge (squash) só com o CI do PR verde e o `main` verde. Nada direto no `main`. Governança só pelo rito de autorização do Alexandre.
- **Actions**: um rerun só, e apenas para falha de infraestrutura. Build pelo `eas-build.yml` (`so_conferir=true` testa o `EXPO_TOKEN` sem build); deploy pelos workflows `producao-*`, com "aprovo deploy vX.Y.Z".
- **Recados**: no repositório `aloirr/macuxifdv-recados`, fora dos commits de código (as linhas `recados/` e `lidos/` da tabela acima são histórico).

## Verificação de donos (`verificar`)

Confere os arquivos alterados contra `donos.json` (a primeira regra que casa define o dono).

```bash
node scripts/coord.mjs verificar modulo-core                     # árvore de trabalho × HEAD (árvore compartilhada)
node scripts/coord.mjs verificar modulo-core --base origin/main  # diff do branch (PR/CI)
node scripts/coord.mjs verificar --base origin/main              # agente inferido do branch ou dos trailers
node scripts/coord.mjs verificar                                 # sem agente: lista agrupada por dono
node scripts/coord.mjs verificar --por-dono                      # idem, mesmo com agente no branch
node scripts/coord.mjs verificar --por-commit origin/main..HEAD  # cada commit × o agente do próprio trailer
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

### Por commit (`--por-commit <de>..<até>`) — conferência do `main`

Desde 14/11/2026 nada vai direto ao `main`: tudo entra por PR (squash), e cada commit leva o trailer `Agente: <nome>`. O `--por-commit` continua no CI do push ao `main` e serve para conferir um intervalo de commits de vários donos. O `--base` olha o branch inteiro como de um só agente; o `--por-commit` confere **cada** commit de `git log <de>..<até>` contra o agente do trailer **daquele** commit, com as mesmas regras e exceções do `--base` (tabela acima, coluna "Com `--base`").

- Commit de merge (mais de um pai) é ignorado.
- Commit sem o trailer, com agente fora do time ou com dois agentes diferentes → código **2** com a lista desses commits (os demais são conferidos e aparecem na saída).
- `alexandre` nunca viola por dono (sem-dono, congelado e recado alterado continuam violação).
- Intervalo vazio → OK (0). Início `000…0` (push que cria o branch), ref inexistente ou combinar com agente/`--base`/`--por-dono` → 2.
- Saída: um bloco por commit (`== <sha> <assunto> — agente: <nome> (trailer)` + OK/Exceções/Outros donos/VIOLAÇÃO) e o resultado; **0** sem violação · **1** com violação · **2** erro.
- No CI, no push ao `main`: `actions/checkout` com `fetch-depth: 0` e os SHAs por variável de ambiente (sem interpolar `${{ }}` no shell): `env: { ANTES: ${{ github.event.before }}, DEPOIS: ${{ github.sha }} }` → `node scripts/coord.mjs verificar --por-commit "$ANTES..$DEPOIS"`.

## Identificação do agente nos guardiões (guardião v4)

Os guardiões (`.claude/hooks/guarda-donos.mjs` para Edit/Write e `guarda-bash.mjs` para o Bash) descobrem o agente da sessão nesta ordem (`identificarAgente` em `scripts/coord-lib.mjs`):

1. **Subagente** (`agent_id` no JSON do hook): o próprio subagente (argumento do hook ou `agent_type`). Vence `MACUXI_AGENTE`, que todo subagente herda do processo do Claude Code: um `modulo-core` lançado numa sessão com `MACUXI_AGENTE=alexandre` continua `modulo-core`.
2. Variável **`MACUXI_AGENTE`** (ex.: `MACUXI_AGENTE=alexandre`), só para a sessão principal.
3. O agente de sempre numa **sessão local de agente**: argumento do hook (frontmatter) ou `agent_type`. Na nuvem (`CLAUDE_CODE_REMOTE=true`) o `agent_type` só vale se for diferente do `"agent"` do `.claude/settings.json`, porque a sessão principal da nuvem sempre recebe `gerente-projetos` dali.
4. **Branch atual**: `<agente>/T-nnnn-...` ou `agente/T-nnnn-<agente>` → esse agente do time; `nuvem/*` → trailer `Agente: <nome>`, que precisa ter **um único nome em todos os commits do branch** (desde o `origin/main`) que têm o trailer — commits sem trailer não contam; dois nomes diferentes = ambíguo.
5. Fonte ausente, ambígua ou que declara `alexandre` → **restrito**: o `agent_type` da sessão; sem `agent_type`, sessão manual **local** = liberada; na nuvem sem agente, o `"agent"` do `settings.json`.

- **`alexandre` só por fonte confiável**: `MACUXI_AGENTE=alexandre` ou a sessão manual local (sem agente). O branch `alexandre/*` e o trailer `Agente: alexandre` são declarados pelo próprio agente e **não** dão a identidade `alexandre` nos hooks (valem a regra comum acima). Na nuvem, uma tarefa do Alexandre em `.claude/**` ou `scripts/coord*.mjs` precisa de `MACUXI_AGENTE=alexandre` nas variáveis do ambiente.
- **Trabalhar no branch de um agente = trabalhar como ele**: uma sessão manual local num branch `<agente>/T-nnnn-...` fica restrita aos caminhos desse agente.
- Na nuvem, numa tarefa `nuvem/*`, o **primeiro commit** com o trailer `Agente: <nome>` é o que identifica a sessão; antes dele o guardião trata a sessão como `gerente-projetos`. Use um branch `<agente>/T-nnnn-...` para ser identificado desde o início.
- `alexandre` identificado altera arquivo de qualquer dono; `sem-dono`, `congelado`, recado existente e diário/lidos de outro continuam barrados.
- Desempenho: a branch e o HEAD são lidos direto do `.git`; o `git log` dos trailers fica em cache por HEAD (+ base) num arquivo temporário (`<tmp>/macuxi-guarda/ident-*.json`) e só é refeito quando um dos dois muda.
- Testes: `node --test .claude/hooks/*.test.mjs`.

## O lock acompanha a dependência (`verificar --base` e `--por-commit`)

`pnpm-lock.yaml` e `pnpm-workspace.yaml` são do `engenheiro-software`, mas um agente que adiciona ou troca dependência no **próprio** pacote precisa mandar o lock junto. Regra:

- Com `--base` (PR) ou em cada commit do `--por-commit`: a mudança em `pnpm-lock.yaml` e a do `pnpm-workspace.yaml` feita **só** em `allowBuilds`/`onlyBuiltDependencies` são aceitas para o agente quando, no **mesmo PR/commit**, ele alterou o `package.json` de um pacote que é dele.
- A saída lista essas mudanças na seção **"Lock acompanhando dependência (aceito — revisão do engenheiro-software)"**, com o motivo `lock acompanhando dependência de <pacote>`; o resultado continua 0, com a contagem para revisão.
- Sem `package.json` do próprio agente no mesmo PR/commit (lock sozinho, ou `package.json` de outro dono) → continua **VIOLAÇÃO**. Mudança em outra chave do `pnpm-workspace.yaml` (ex.: `packages`, `minimumReleaseAge`) também. Apagar o lock nunca é "acompanhar".
- Sem `--base` (árvore compartilhada) nada muda: o lock de outro dono é informativo.

`alexandre` pelo trailer (ou pelo branch `alexandre/*`) continua aceito no `verificar`, mas a saída marca `Atenção: identidade alexandre declarada por trailer` (ou `por branch`); o CI de governança cobre o resto.

## Governança (`governanca --base <ref>`)

```bash
node scripts/coord.mjs governanca --base origin/main
```

Lista os arquivos do diff do branch (merge-base com `<ref>` + não commitados) em caminhos de governança: `.claude/**`, `.coord/donos.json`, `scripts/coord*.mjs` e `.github/**`. Saída **1** com a lista (o PR exige revisão do Alexandre, sem merge automático) · **0** sem nenhum · **2** erro de uso ou de git. No CI, só em `pull_request`: `node scripts/coord.mjs governanca --base origin/$BASE_REF`.

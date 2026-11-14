# ADR 0046 — Trava do deploy de produção por issue ("aprovado vX.Y.Z")

- **Status**: proposta. É governança (`.github/**`): só entra pelo rito, com a autorização do dono do produto (número do PR e SHA).
- **Data**: 2026-11-14
- **Autor**: engenheiro-software
- **Origem**: a v1.0.7 subiu sem parar no environment `PRODUCAO`. O repositório é privado e o plano não tem "Required reviewers", então o environment não espera ninguém. O dono do produto quer a trava no GitHub e quer aprovar pelo chat; a ponte comenta na issue com a conta dele (`aloirr`).
- **Altera**: ADR 0028 (publicação só por tag `v*` com aprovação no `PRODUCAO`) e o fluxo do PR #241 (`producao-liberar.yml`, R-20261114-121700-alexandre). A aprovação passa a ser a issue; o environment `PRODUCAO` continua guardando os secrets.

## Decisão
1. **`producao — liberar versão`** (`producao-liberar.yml`, `workflow_dispatch` com `versao` e `sha`) faz as conferências de hoje (`producao-conferir.mjs entrada` e `conferir`). Depois abre a issue **"Aprovar deploy vX.Y.Z"** e para ali, sem criar tag e sem disparar deploy. A issue leva:
   - o rótulo `trava-deploy`, criado se não existir;
   - o marcador `<!-- trava-deploy versao=vX.Y.Z sha=<40 hex> -->`, o SHA e o link do run;
   - os commits e PRs desde a última tag `v*`.

   Se já houver uma issue aberta da mesma versão, o workflow recusa.
2. **`producao — aprovar versão`** (`producao-aprovar.yml`, `issue_comment: created`) roda sempre o arquivo do `main`.
   - **Filtro barato no `if:` do job**, sem runner: a issue não é PR, está aberta, tem o rótulo `trava-deploy` e o comentário é do `aloirr`.
   - **Conferência fina** em `scripts/ci/producao-trava.mjs comentario`, pelo `GITHUB_EVENT_PATH`: a issue foi aberta pelo `github-actions[bot]`, o título é "Aprovar deploy vX.Y.Z" e o marcador traz a mesma versão. O comentário precisa ter **uma linha que seja exatamente `aprovado vX.Y.Z`**, sem diferenciar maiúsculas, com negrito ou ponto final aceitos. "não aprovado …", a citação "> aprovado …" e outra versão não valem. O rodapé de atribuição nas outras linhas é aceito.
   - **Comentário que não aprova é ignorado**: fica só o motivo no log e nada é comentado.
   - **Comentário que aprova** passa de novo por `entrada` e `conferir`: tag nova, commit no main, CI verde e imagem da API no GHCR. Depois o workflow cria a tag com o `GITHUB_TOKEN`, põe o rótulo `aprovado` e fecha a issue (`state_reason=completed`). Só então dispara o `producao-publicar.yml` na tag e comenta o link do run.
   - **Aprovação válida que falha na conferência**: um comentário com o link do run, e a issue continua aberta.
3. **`producao — publicar`** (`producao-publicar.yml`): o job `conferir` roda `producao-trava.mjs publicar` antes do BKO e do `PRODUCAO`. A tag só publica se uma issue "Aprovar deploy <tag>" com `trava-deploy` cumprir tudo isto:
   - fechada como `completed`, com o rótulo `aprovado`, aberta pelo bot;
   - o SHA do marcador é o commit da tag;
   - tem o comentário `aprovado <tag>` do `aloirr`.

   Uma tag criada à mão, sem a issue, fica vermelha no `conferir`. O **"Re-run all jobs"** de uma tag já aprovada (voltar atrás) passa, porque a issue continua aprovada.
4. **Permissões**: `permissions: {}` no topo dos três workflows; cada job pede só o que usa.

   | Job | Permissões |
   |---|---|
   | `liberar/abrir` | `contents: read`, `issues: write` |
   | `aprovar/conferir` | só leitura |
   | `aprovar/liberar` | `contents`, `actions` e `issues: write` |
   | `aprovar/falha` | `issues: write` |
   | `publicar/conferir` | `issues: read` a mais |

   Não há secret novo nem job em espera: a aprovação é um evento, não um job parado gastando minutos. Nenhum texto do evento nem input é interpolado no shell; tudo passa por `env:` ou pelo arquivo do evento.
5. **Tags anteriores à trava (até `v1.0.7`)**: sem lista de legadas no código. O GitHub roda o `producao-publicar.yml` **do commit da tag** (push, disparo na tag e re-run). As tags `v1.0.0` (`71b3540`) e `v1.0.7` (`8cff349`) apontam para commits sem a trava; o re-run delas (volta atrás) roda o publicar antigo e continua funcionando como antes, sem issue. Uma tag em commit com a trava sempre exige a issue. Uma lista de legadas no publicar novo nunca seria lida, e por isso seria código morto. A primeira versão travada é a primeira tag criada num commit que já contém esta ADR.

## Riscos que ficam (o que a trava não resolve)
- **Conta compartilhada**: a trava confere o login `aloirr`. Se uma sessão de agente usa o token do `aloirr`, ela também consegue comentar como ele. A trava impede o deploy **sem intenção**, como o da v1.0.7. Ela não segura quem tem o token do dono. O freio é de processo: só a ponte, a pedido do dono no chat, escreve `aprovado vX.Y.Z`.
- **Tag nova num commit antigo**: uma tag `v*` criada à mão num commit do main anterior à trava roda o publicar antigo, que não tem a trava. **Recomendado ao dono do produto**, configuração manual, sem código:
  - no environment `PRODUCAO`, "Deployment branches and tags" = **Selected**, com `main` (tenant, super-admin e ensaio) e tags `v*` (publicar);
  - se o plano permitir, um ruleset de tags `v*` que restrinja criação, atualização e exclusão a quem pode contornar (bypass) a regra.
- **`producao — criar tenant`, `producao — super-admin` e `producao — ensaio de restauração`** não publicam a partir de tag: são `workflow_dispatch` manuais de operação e ficam como estão. Se o dono quiser, a mesma trava pode valer para eles, com uma issue por execução, em tarefa própria.

## Alternativas
- **Required reviewers no `PRODUCAO`**: indisponível no plano do repositório privado.
- **Job em espera (polling) até a aprovação**: gasta minutos parado e contraria a economia do Actions (ADR 0045).
- **GitHub App ou token próprio para aprovar**: pede secret novo e mais um lugar para guardar segredo.
- **Tornar o repositório público** para ganhar os reviewers: expõe o código.

## Consequências
- Aprovar = o dono diz "aprovo deploy vX.Y.Z" no chat e a ponte comenta `aprovado vX.Y.Z` na issue. Fechar a issue sem comentar recusa.
- Toda execução de comentário no repositório cria um run do `producao-aprovar.yml`. Fora das issues de trava, o job é pulado no `if:` sem runner e sem minutos.
- Testes: `scripts/ci/producao-trava.test.mjs` (decisão do comentário, aprovação no publicar, corpo da issue e forma dos workflows) e `scripts/ci/producao-conferir.test.mjs` (a mesma conferência nos três workflows).

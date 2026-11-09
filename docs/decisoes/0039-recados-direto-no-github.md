# ADR 0039 — Recados direto no GitHub, sem clone, junção nem sincronização pelo PC

- **Status**: **proposta** em 2026-11-09. Vale com o ok do dono do produto ao patch de governança ([T-0143.patch](../desenho/T-0143.patch)).
- **Data**: 2026-11-09
- **Tarefa**: T-0143 ([desenho](../desenho/T-0143.md))
- **Autor**: engenheiro-software
- **Origem**: dono do produto no chat, 09/11/2026 ~12h30: "programe os recados para serem enviados diretamente ao macuxi recados sempre. assim nao precisa ficar sincronizando do pc com o github" (R-20261109-121702-alexandre).
- **Altera**: [ADR 0035](0035-recados-em-repositorio-proprio.md) §2 (junções), §4 (sincronização a cada 2 min) e o plano de volta. Continuam valendo: o repositório `aloirr/macuxifdv-recados` como fonte única (§1), `merge=union` (§3, agora só uma garantia a mais), as Actions (§5 e §8), o `verificar` pela marca do `.gitignore` (§6) e o histórico (§7).

## Contexto

- O corte da ADR 0035 (09/11, 05h24) fez de `.coord/recados` e `.coord/lidos` junções para o clone `C:\macuxifdv-recados`.
- A tarefa do Agendador nunca foi cadastrada. Às 12h50, o clone tinha **193 recados e 11 arquivos de lidos (88 linhas)** que nunca chegaram ao GitHub, enquanto o dono do produto e o Telegram só enxergam o GitHub.
- O `coord.mjs` lê os 4.700 recados do disco a cada `enviar`, `caixa` e `pendencias`. No PC carregado, a `caixa` levou **5 min 17 s** (medido às 12h20) e o `enviar` passa de 120 s.
- Um clone com árvore de trabalho, compartilhado por 7 agentes em paralelo, disputa o `index.lock` e o rebase. As sessões da nuvem nem têm o clone.

## Decisão

### 1. Escrita direto na API do GitHub (GraphQL `createCommitOnBranch`)
- `enviar` grava **um commit** no `main` do repositório de recados, com um arquivo por destino (`recados/<destino>/<id>.md`), pela mutação `createCommitOnBranch`.
- **Concorrência otimista:** a mutação leva o `expectedHeadOid` (o commit que o `coord` acabou de ler). Se outro agente, o formulário ou o Telegram gravou antes, o GitHub recusa. O `coord` relê e tenta de novo, até 6 vezes, com espera de 0,25 s × tentativa + até 0,5 s aleatório.
- **Nunca sobrescreve:** o id é escolhido contra a árvore daquele mesmo commit (`R-AAAAMMDD-HHMMSS[-n]-<remetente>`), e o commit só entra se o topo ainda for ele.
- **Atômico:** todos os destinos ou nenhum. Não há "gravado pela metade".
- **"Enviado" só com o GitHub confirmando:** a saída traz o commit (`GitHub aloirr/macuxifdv-recados@abc1234`). Se a resposta se perder (rede caiu depois do commit), o `coord` confere o arquivo no GitHub pelo hash do git: achou o mesmo conteúdo, diz "confirmado na conferência"; não conseguiu conferir, diz "NÃO foi confirmado" e manda conferir com `ler <id>` antes de reenviar.
- **`lido`:** relê `lidos/<agente>.txt` no topo do `main`, acrescenta só os ids que faltam e grava com o mesmo `expectedHeadOid`. Duas marcações ao mesmo tempo nunca perdem linha: a segunda é recusada, relê e regrava sobre a primeira. Marcar de novo não duplica.
- O formato do recado e dos lidos não muda (teste que compara o arquivo do modo GitHub com o do modo local). Os workflows do formulário e do Telegram seguem iguais.

### 2. Leitura no estado atual do GitHub, com índice local
- `caixa`, `pendencias`, `ler` e `fio` leem o `main` do GitHub **na hora**.
- **Índice local por commit:** `%LOCALAPPDATA%\Macuxi\recados\aloirr-macuxifdv-recados.json` (no Linux, `~/.cache/Macuxi/recados`; `MACUXI_RECADOS_CACHE` troca). Ele guarda o commit, o caminho e o oid de cada recado e lidos, e o texto de cada blob.
  - Primeira leitura: lista a árvore numa consulta GraphQL e baixa os textos em lotes de 100 por consulta, em paralelo.
  - Leituras seguintes: um `compare` REST do commit do cache até o `main` e só os blobs novos. Sem mudança, é uma chamada.
  - Os textos do cache só valem se o hash do git bater com o oid (cache adulterado ou corrompido é baixado de novo).
  - Sem GitHub, a leitura mostra a cópia local com a linha "Atenção: sem o GitHub agora (...): mostrando a cópia local de <hora> (commit abc1234)". A escrita nunca usa a cópia: sem GitHub, falha.
- **Autorização de merge (`guarda-merge`):** a lista de `recados/gerente-projetos` vem sempre direto do GitHub, nunca do cache (que fica fora da raiz e qualquer agente poderia adulterar). Só os recados do Alexandre são baixados. Sem GitHub, nenhuma autorização (falha fechada).

### 3. Sem dependência, síncrono, igual no PC, na nuvem e no CI
- Tudo na `scripts/coord-lib.mjs`, sem pacote novo. O HTTP é o `fetch` do Node num *worker thread*, esperado de forma síncrona (`Atomics.wait` + `receiveMessageOnPort`). Assim o `coord.mjs` e os guardiões continuam síncronos, e a conexão TLS é reaproveitada no mesmo comando.
- Com `HTTPS_PROXY`/`HTTP_PROXY` no ambiente (nuvem, rede com proxy), o HTTP vai por um processo filho com `NODE_USE_ENV_PROXY=1`, que respeita o proxy e o `NO_PROXY`.
- **Token só do ambiente**, nesta ordem: `MACUXI_RECADOS_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` e `gh auth token`.
  - No PC, o `gh` já logado basta. Uma variável de usuário `MACUXI_RECADOS_TOKEN` (token fine-grained só com *Contents: read and write* no `aloirr/macuxifdv-recados`) poupa de 1 a 5 s por comando (o `gh auth token` leva isso no PC carregado) e tem menos permissão que o token do `gh`.
  - Na nuvem (claude.ai/code) e no CI: `MACUXI_RECADOS_TOKEN` nas variáveis do ambiente ou nos secrets.
  - O token não vai para arquivo, argumento de processo nem log. Vai ao worker pela memória ou ao processo filho pelo stdin. Os erros mostram só a origem do token e o código HTTP.
- `MACUXI_RECADOS_REPO` e `MACUXI_RECADOS_API` existem para os testes (servidor HTTP local de mentira).

### 4. Modo pela marca do `.gitignore`
- `modoDosRecados`: com a marca da ADR 0035 no `.gitignore` (`/.coord/recados`), o modo é **github**. Sem a marca (antes do corte, testes antigos), **local**, igual a antes. `MACUXI_RECADOS=local|github` força.
- No modo github, o guardião (`podeAlterar`) barra qualquer escrita em `.coord/recados/**` e `.coord/lidos/**` no disco, inclusive pelo caminho do clone antigo. O arquivo ficaria fora do repositório de recados e se perderia. A mensagem manda usar `coord.mjs enviar` ou `lido`.
- As regras de autoria do recado (nome com o remetente, `de:` do próprio agente, `de: alexandre` só o Alexandre) saem do `podeAlterar` para `regraDoRecadoNovo` e valem igual no envio ao GitHub.

### 5. O que sai
- Hook `sincronizar-recados.mjs` (SessionStart e Stop) e as duas entradas do `.claude/settings.json`: **removidos**.
- `additionalDirectories` para `C:/macuxifdv-recados`: **removido**.
- Junções: **removidas** com `rmdir` (nunca recursivo). O clone vira arquivo (`C:\macuxifdv-recados-arquivo-20261109`).
- `scripts/sincronizar-recados.ps1` e `scripts/recados/{agendar-sincronizacao,corte,volta,comum}.ps1`: **desligados**, ficam no repositório para a volta. A tarefa do Agendador nunca foi cadastrada; se tiver sido, `agendar-sincronizacao.ps1 -Remover`.
- O código das junções no guardião fica, sem efeito sem junção (`juncoesDeRecados` vazio), para a volta.

### 6. Subida única dos pendentes
- `node scripts/recados/subir-pendentes.mjs --simular`, e depois sem `--simular`.
- Pega no clone os arquivos novos ou alterados em `recados/` e `lidos/` (git status + commits locais fora do `origin/main`) e compara cada um com o `main` do GitHub.
  - Recado que falta sobe; igual "já está"; mesmo caminho com outro conteúdo é **conflito**: nada é sobrescrito, e ele fica listado (saída 1).
  - Lidos: une as linhas do GitHub com as do PC que faltam.
- Um commit só, conferido depois pelo hash. Não altera o clone. Rodar de novo é seguro.

## Alternativas consideradas
- **Contents API (`PUT /contents`)**: um commit por arquivo. Um recado com 3 destinos viraria 3 commits, sem atomicidade, e a falha no meio deixaria o recado pela metade. Rejeitada.
- **Git Data API (blob, tree, commit, ref)**: atômica, mas são 4 ou 5 chamadas por envio e o mesmo cuidado de concorrência no `PATCH ref`. A `createCommitOnBranch` faz o mesmo numa chamada, com o `expectedHeadOid`. Rejeitada.
- **Clone com commit e push síncronos e nova tentativa**: 7 agentes no mesmo clone com árvore de trabalho disputam o `index.lock` e o rebase; a leitura no estado do GitHub exige `pull` antes de cada `caixa`; a nuvem não tem o clone; e o `git push` da nuvem passa pelo proxy de git da sessão, que só conhece o repositório da sessão. Rejeitada.
- **Clone sem árvore (bare) só para leitura, com `git fetch`**: leitura rápida, mas autenticação de git diferente em cada ambiente (GCM no PC, proxy na nuvem) e um segundo caminho além da API para escrever. Rejeitada.
- **`gh api` por chamada**: cada chamada abre um processo do `gh` (de 1 a 5 s no PC carregado) e o `gh` pode não existir na nuvem. O `gh` fica só como fonte do token. Rejeitada.
- **Baixar o tarball do repositório a cada leitura**: 4,7 MB e 4,9 s por leitura, e o redirecionamento para `codeload.github.com` pode não estar liberado na nuvem. Rejeitada.

## Riscos e mitigação
| Risco | Mitigação |
|---|---|
| Sem rede ou GitHub fora do ar | Escrita falha com "recado NÃO enviado (nada foi gravado)" e código 1. Leitura mostra a cópia local com aviso. Nunca "enviado" sem commit confirmado. |
| Vários agentes ao mesmo tempo | `expectedHeadOid` + nova tentativa (até 6). Testado com 4 envios e 3 marcações simultâneos em processos separados: nada se perde, um commit por operação. |
| Cota da API (5.000/h por token) | Leitura sem mudança: 1 chamada; com mudança: 2 ou 3. Envio: 2 ou 3. Com 8 agentes ativos, fica na casa de centenas por hora. |
| Cache adulterado | Texto conferido pelo hash do git. A autorização de merge lê a lista direto do GitHub. |
| Token do `gh` com permissão ampla | Recomendação: `MACUXI_RECADOS_TOKEN` fine-grained, só neste repositório. |
| Agente grava recado no disco por engano | O guardião barra `.coord/recados/**` e `.coord/lidos/**` no modo github. |
| Agente escreve direto pela API com o token | O guardião v7 já barra `gh api` de escrita. É o mesmo risco de antes com o `git push` do clone. |
| Recados escritos no PC entre o patch e a subida | A subida roda logo depois de aplicar o patch e pode rodar de novo (idempotente). |
| Latência no PC carregado | Medida: ver desenho. Bem abaixo dos minutos de hoje. |

## Plano de volta
1. **Sem reverter código** (minutos): variável de usuário `MACUXI_RECADOS=local`; renomear o clone de volta, `git pull`; recriar as junções (`mklink /J`); `scripts/recados/agendar-sincronizacao.ps1`. O `coord` e o guardião voltam ao comportamento da ADR 0035. Só o hook de sessão não volta.
2. **Completa:** `git revert` do commit do patch (volta o hook e o `settings.json`), mais o passo 1 sem a variável.
3. Os recados gravados direto no GitHub chegam ao clone pelo `git pull` do passo 1. Nada se perde, porque o GitHub sempre foi a fonte.

## Consequências
- Recado chega ao GitHub (e ao Telegram) na hora do `enviar`, sem Agendador nem PC ligado para quem escreve da nuvem.
- `caixa` e `pendencias` mostram o formulário e o Telegram sem esperar sincronização.
- Sessões da nuvem com `MACUXI_RECADOS_TOKEN` passam a usar o `coord.mjs` como no PC. Sem o token, continuam com a seção "Recados para o time" no corpo do PR.
- Cada envio e cada marcação viram um commit `recados: <id>` ou `lidos: <agente> (n)`, com o autor do token.
- Anexos (`recados/anexos/`) entram pelo GitHub (upload na web ou anexo da issue do formulário), não mais pela pasta do PC.
- O relógio do PC passa a importar mais: o id e o `criado_em` vêm da hora do PC, e o formulário e o Telegram usam a hora do GitHub. Em 09/11 o PC estava 41 min atrasado.
- O gerente atualiza o doc 07 (§ recados), o `CLAUDE.md` (bloco "Recados no repositório próprio") e o quadro.

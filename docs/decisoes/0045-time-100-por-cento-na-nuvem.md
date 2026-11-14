# ADR 0045 — Time 100% na nuvem: sessões por agente, PR com CI e guardião ligado

- **Status**: **proposto, aguardando o Alexandre**. A parte de CI (`.github/**`) segue o rito de governança: só entra com o recado "autorizo o merge do PR #N no commit <sha>".
- **Data**: 2026-11-14
- **Tarefa**: migração para a nuvem (branch `nuvem/migracao-nuvem-engenheiro-software`; o gerente atribui o número)
- **Autor**: engenheiro-software
- **Origem**: dono do produto no chat, 14/11/2026: "Migre tudo para a nuvem. Sobre o guardiao, ele é importante." Começa depois do build Oficial v1.0.7, que já saiu.
- **Altera**:
  - doc 07, "Frentes de trabalho: local e nuvem": o fim da frente local, dos lotes `verificacao/*` e da regra "no PC";
  - ADR 0044, só no uso: um CI por PR, e não mais um ensaio por lote;
  - ADR 0039: o token dos recados passa a existir só nas variáveis do ambiente da nuvem.

## Contexto
- Hoje o time roda no PC do Alexandre (Windows, `C:\macuxifdv`):
  - são 7 vagas locais;
  - o gerente sobe lotes direto ao `main` por `verificacao/*`, em fast-forward e com o ensaio verde;
  - a nuvem já trabalha por PR (`nuvem/*`), com o merge feito pelo gerente.
- **O guardião já roda em Linux.**
  - O CI (ubuntu) roda `node --test .claude/hooks/*.test.mjs` desde a T-0005.
  - Nesta sessão da nuvem (14/11), um `Write` do engenheiro-software em `modules/core/` foi barrado pelo `guarda-donos.mjs` ("pertence a modulo-core").
  - O teste novo `scripts/ci/guardiao-nuvem.test.mjs` roda os hooks de verdade, por processo filho e pela linha exata do `.claude/settings.json` no `/bin/sh`, com caminhos POSIX absolutos. Ele confere o bloqueio (saída 2) e a liberação (saída 0).
  - Ele confere também que os hooks só chamam `git`, `gh` (achado no `PATH`) e o próprio `node`, sem shell, e que nenhum caminho do Windows é requisito.
  - Os 9 arquivos de teste dos hooks passam em Linux (Node 22, container da nuvem). **Nenhum achado de falha.**
- **Restos do Windows que não quebram, mas não servem na nuvem:**
  - `additionalDirectories: C:/Users/domon/dev/forca-vendas` (`.claude/settings.json`) e `somente_leitura` com o mesmo caminho (`.coord/donos.json`). Na nuvem a Fase M não existe, então nem a leitura nem a trava valem;
  - o `gh` também é procurado em `%ProgramFiles%` (inofensivo no Linux);
  - `scripts/sincronizar-recados.ps1`, obsoleto desde a ADR 0039;
  - `_instalar/*.cmd` e `scripts/demo/*.ps1`, que eram a demo local.
- **Identidade do agente.**
  - Toda sessão nasce `gerente-projetos` (o `"agent"` do `settings.json`).
  - O subagente é identificado pelo `agent_id`/`agent_type`, e isso já funciona na nuvem.
  - Numa sessão própria de um agente, em `nuvem/*`, a identidade vem do trailer `Agente:` dos commits do branch. Antes do 1º commit, a sessão é o gerente; daí o rito do "commit vazio com trailer".
- **Custo.** Os minutos do Actions estouraram o limite de cobrança em 14/11. Até o limite subir ou o ciclo virar, nenhum CI roda e nada entra no `main`, porque o CI verde é o critério.

## Decisão
1. **Gerente fixo na nuvem**:
   - uma sessão do `gerente-projetos` fica aberta no claude.ai/code, acordada por **tarefa agendada a cada 15–20 min**;
   - a cada vez que acorda, faz o que a rodada local fazia: caixa e pendências; PRs prontos (`gh pr list`) e CI (`gh run list`); merge pela regra A ou pelo rito de governança; disparo das frentes; status. Sem novidade, encerra logo;
   - a cobrança de recado não lido passa de 5 min para cada vez que ele acorda.
2. **Um agente, uma sessão, um branch**:
   - cada frente roda numa sessão própria da nuvem, no branch `nuvem/T-nnnn-<assunto>--<agente>` (ver item 6);
   - **um PR por dono e por lote**, aberto em rascunho e marcado "pronto" uma vez só, porque PR em rascunho não roda CI (ADR 0044);
   - revisões (testes, corretor, engenheiro, designer) rodam como subagente ou sessão própria e respondem por recado. Não alteram arquivo de outro dono.
3. **Git só por PR**:
   - a sessão do agente faz o commit e o push do próprio branch: `git push origin nuvem/*`, que o `settings.json` já permite;
   - a mensagem leva `T-nnnn: <resumo>` e o trailer `Agente: <dono>` no último bloco;
   - o `main` só recebe **merge squash** feito pelo gerente, com o CI verde, `--match-head-commit` e o corpo `Agente: <dono>`. Na governança, o rito com `Agente: alexandre`;
   - acabam os lotes `verificacao/*` em fast-forward e o push direto ao `main`;
   - o pedido ao Alexandre para travar isso no GitHub está no item 4 de "Próximos passos".
4. **O PC deixa de ser necessário**:
   - nada do time depende de `C:\macuxifdv`;
   - a pasta da Fase M continua só de consulta. O que ainda for preciso dela, o Alexandre copia para o repositório (ou para um repositório privado só de leitura) e manda o caminho por recado;
   - lint, typecheck e testes "no PC" passam a rodar **na sessão**, com o mesmo script do CI;
   - Docker continua proibido nas sessões; testes de banco e stack isolado só no CI;
   - build EAS pelo `eas-build.yml` (manual, já existe); publicação e demo pelos workflows que já existem.
5. **Guardião ligado nas duas pontas**:
   - os hooks do `.claude/settings.json` valem em toda sessão da nuvem (evidência no Contexto);
   - o job "governança" do CI repete a checagem no que chega por PR. O que já existia: "verificar donos do PR", "governança no main só com Agente: alexandre" e "PR sem recado de autorização de merge". O que entra agora:
     - **guardião ligado** (`scripts/ci/guardiao-ligado.mjs`): vermelho se o job roda com `MACUXI_GUARDA=off` ou com `MACUXI_GH_SIMULADO` no ambiente;
       - vermelho também se um arquivo de configuração **versionado** atribui `MACUXI_GUARDA` = off (ou por expressão, `${{ }}`/`$VAR`) ou atribui qualquer valor a `MACUXI_GH_SIMULADO`;
       - os arquivos olhados são workflows, `settings*.json` do Claude, `.devcontainer`, `.vscode`, `package.json`, `turbo.json`, `.npmrc`, `pnpm-workspace.yaml` e scripts de shell; nenhum `.env*` é lido;
     - **agente do branch da nuvem × trailer** (`scripts/ci/agente-do-branch.mjs`, item 6);
   - `MACUXI_GUARDA=off` **não vale no CI nem na nuvem**. A parte do CI entrou aqui. A do hook é o pedido 1.
6. **Identidade por sessão: sufixo `--<agente>` no branch.**
   - **Forma**: `nuvem/T-nnnn-<assunto>--<agente>`, com **dois hífens** antes do nome do agente do time. Ex.: `nuvem/T-0172-sync--modulo-vendedor`.
   - **Por que dois hífens**:
     - com um hífen só, o fim do assunto colide com nome de agente. `nuvem/T-0170-ajuste-testes` (assunto "ajuste de testes") seria lido como agente `testes`;
     - os nomes dos agentes não têm `--`, e o assunto não precisa ter.
   - **Riscos e respostas**:

     | Risco | Resposta |
     |---|---|
     | O branch é escolhido por quem abre a sessão (o Alexandre ou a tarefa agendada do gerente). | É a fonte certa: quem abre decide quem trabalha. |
     | O próprio agente pode trocar o branch (`git checkout -b`) e "virar" outro. | No CI, o "verificar donos do PR" prende o PR aos caminhos de **um** dono, e o passo novo exige trailer = sufixo. No hook, o pedido 3 barra criar ou renomear branch para outro agente. |
     | `--alexandre`. | Nunca dá a identidade alexandre: vermelho no CI, e o hook ignora. O Alexandre usa `MACUXI_AGENTE=alexandre` no ambiente dele. |
     | Sufixo com nome fora do time. | Vermelho no CI. |
   - **`MACUXI_AGENTE` no ambiente da nuvem**:
     - é a fonte mais forte, porque o agente não altera o ambiente do processo do Claude Code e os hooks leem esse ambiente, não o do Bash;
     - exige um ambiente da nuvem por agente (16), e o ambiente é escolhido na abertura da sessão, como o branch;
     - fica **só para o Alexandre** (`MACUXI_AGENTE=alexandre`, como hoje) e, se ele quiser, para o ambiente fixo do gerente.
   - **Implementado nos caminhos do engenheiro**: o passo do CI que compara sufixo e trailer:
     - `--<agente>` com trailer de outro agente (alexandre inclusive): vermelho;
     - `--alexandre` ou `--<fora do time>`: vermelho;
     - sufixo de um hífen que casa com um agente e trailer de outro: aviso;
     - trailer `Agente: alexandre` em `nuvem/*`: aviso de que o merge só sai pelo rito.
   - **Falta no hook** (pedido 2): o hook reconhecer o sufixo **antes** do trailer. Com isso, a sessão é o agente desde o 1º passo, e acaba o rito do commit vazio.
7. **Economia do Actions** (regra para todos; guarda barata no CI):

   | Regra | Guarda no CI |
   |---|---|
   | Um PR por dono por lote, aberto em rascunho até ficar pronto. | Já existe: rascunho não roda. |
   | Um commit por PR; nada de commit novo com o CI rodando, salvo correção (revisão ou CI vermelho). | Mais de um commit no PR vira **aviso** (`economia-actions.mjs commits`), nunca vermelho. |
   | Um rerun só, e só para infraestrutura (saída 137, desligamento do runner). | A 3ª tentativa do mesmo run fica **vermelha antes do escopo** (`economia-actions.mjs tentativa`), então nenhum job pesado roda. Cobre o "Re-run all jobs"; o "Re-run failed jobs" não roda a governança de novo, e ali vale a regra escrita. |
   | Push no `main` só por merge. | Proteção do branch (pedido 4). |
   | `cancel-in-progress` em todo workflow de PR. | Já existe no `ci.yml` e no `stack-isolado.yml`; os outros são manuais ou de deploy, e lá o cancelamento seria errado. |
   - Os três passos novos rodam em segundos dentro do job "governança", que já existe: nenhum job, runner ou instalação nova.

### Autorização retroativa (14/11/2026)
- **Impasse:** os squashes `706c96f2` (#232) e `f7c87190` (#237) alteraram `.github/workflows/eas-build.yml` e entraram no `main` pela ponte com o último bloco "Agente: engenheiro-software", sem o rito "Agente: alexandre". O passo `brechas-governanca.mjs trailer` confere `BASE..DEPOIS`, e o BASE é o último push verde do `main` (`scripts/ci/escopo.mjs`, `baseDoPush`). Por isso todo push seguinte continuaria vermelho. O conteúdo foi autorizado pelo Alexandre às 8h13, no recado `R-20261114-112000-alexandre`.
- **Decisão:** a lista versionada `.github/governanca-retroativa.json` (`autorizacoes`: `sha`, `pr`, `recado`, `motivo`). O commit listado sai como `::notice::` (autorização retroativa) em vez de `::error::`. As regras:
  - o SHA é completo (40 hex minúsculos) e casa exato;
  - o recado é do Alexandre (`R-AAAAMMDD-HHMMSS-alexandre`);
  - o `pr` é inteiro positivo, o motivo não é vazio e SHA repetido é erro;
  - a lista é lida no **topo** do intervalo (`DEPOIS`). Se o arquivo não existe, a lista fica vazia;
  - lista inválida dá saída 2 (falha fechada);
  - a lista fica em `.github/**`, que é governança. Ela só entra pelo rito (squash com "Agente: alexandre"), e quem a altera sem o rito fica vermelho no mesmo passo.
- **O caminho normal continua sendo o rito.** A lista é exceção para squash já feito e não substitui o rito: cada entrada precisa da autorização escrita do Alexandre num recado.

## Alternativas consideradas
- **Manter o PC como frente local e a nuvem só para tarefas isoladas:** foi recusada pelo dono do produto ("migre tudo").
- **Uma sessão só (o gerente) com todos os agentes como subagentes, na mesma árvore:**
  - a identidade funciona (por `agent_id`), mas é um branch só, que mistura donos num PR e quebra "um PR por dono";
  - fica para revisões e tarefas curtas, que não alteram arquivo.
- **Identidade só por `MACUXI_AGENTE`:** é a mais forte, mas pede 16 ambientes mantidos à mão. Fica para o Alexandre (e o gerente, se ele quiser).
- **Sufixo de um hífen:** colide com o assunto. Fica só como aviso no CI, para os branches de hoje (ex.: este).
- **Vermelho para PR com mais de um commit:** puniria a correção pedida na revisão, que é a exceção prevista. Fica aviso.

## Consequências
- **Minutos do Actions:**
  - cada PR pronto custa um CI: ~28 min com código afetado e ~2 só com documentação (ADR 0044);
  - o push ao `main` do squash reaproveita a árvore verde se o PR estava em dia com o `main`, e aí sai por ~2 min;
  - um lote com 4 donos sai por ~4 × 28 ≈ 112 min, contra ~47 do ensaio único de antes. **Mais caro por lote.** Compensam o rascunho até o fim, o commit único e o merge em sequência sem `update-branch` desnecessário;
  - com o limite de cobrança estourado, **nada entra no `main` até ele subir** (pedido 5).
- **Sessões:** o número de sessões simultâneas e o uso do plano limitam o paralelismo. Proposta: as mesmas 7 vagas (gerente + 6 frentes). A tarefa agendada que acorda sem novidade encerra logo.
- **Segredos:**
  - `MACUXI_RECADOS_TOKEN` e o login do `gh` só nas variáveis do ambiente da nuvem, nunca no repositório;
  - a guarda nova não lê `.env*`;
  - os hooks leem o ambiente do processo do Claude Code, que o agente não altera.
- **Estado local:** o container é efêmero. Cache de identificação e fotos do `guarda-bash` ficam no `tmpdir` e se refazem sozinhos. Nada do time depende de arquivo fora do repositório e do repositório de recados.
- **Reverter:**
  - tirar os 3 passos do `ci.yml` e os 3 scripts de `scripts/ci/`;
  - a regra volta a ser a do doc 07 de antes;
  - não há estado guardado.

## Próximos passos (pedidos ao Alexandre: `.claude/**`, `scripts/coord*.mjs` e configurações do GitHub)
1. **Hook ignora `MACUXI_GUARDA=off` no CI e na nuvem.**
   - Em `scripts/coord-lib.mjs`, exportar:
     ```js
     /** MACUXI_GUARDA=off só desliga o guardião no PC (uso manual). No CI e na nuvem é ignorado, com aviso (ADR 0045). */
     export function guardaDesligada(env = process.env, avisar = (m) => process.stderr.write(m)) {
       if (String(env.MACUXI_GUARDA || '').trim().toLowerCase() !== 'off') return false;
       const sim = (k) => ['true', '1'].includes(String(env[k] || '').trim().toLowerCase());
       if (sim('CI') || sim('GITHUB_ACTIONS') || sim('CLAUDE_CODE_REMOTE')) {
         avisar('[guardião Macuxi] ATENÇÃO: MACUXI_GUARDA=off IGNORADO no CI e na nuvem (ADR 0045). O guardião continua ligado.\n');
         return false;
       }
       return true;
     }
     ```
   - Nos 4 hooks (`guarda-donos.mjs`, `guarda-bash.mjs`, `guarda-mcp.mjs`, `guarda-merge-mcp.mjs`), trocar `if ((process.env.MACUXI_GUARDA || '').toLowerCase() === 'off') process.exit(0);` por `if (guardaDesligada()) process.exit(0);`.
   - **Testes que precisam mudar junto**, senão ficam vermelhos no CI, onde `CI=true` é herdado:
     - os casos "MACUXI_GUARDA=off desliga" em `guarda-bash.test.mjs` (l. 426), `guarda-gh-api.test.mjs` (l. 193), `guarda-mcp.test.mjs` (l. 253), `guarda-merge-mcp.test.mjs` (l. 351) e `guarda-merge.test.mjs` (l. 359);
     - nesses testes, o ambiente base do filho passa a apagar `CI`, `GITHUB_ACTIONS` e `CLAUDE_CODE_REMOTE`;
     - entra um caso novo por hook: off + `CLAUDE_CODE_REMOTE=true` (e off + `CI=true`) continua barrando (saída 2), com "IGNORADO" no stderr.
   - Opcional: na saída 0, o hook pode também escrever `{"systemMessage": "..."}` no stdout para o aviso aparecer na conversa. O stderr com saída 0 só aparece no modo detalhado.
   - O mesmo vale para `MACUXI_GH_SIMULADO`: ignorar no CI e na nuvem, com os testes dos hooks apagando `CI`/`CLAUDE_CODE_REMOTE` do filho.
2. **Hook reconhece o sufixo `--<agente>` do branch.**
   - Em `agenteDoBranch` (`scripts/coord-lib.mjs`), trocar a linha `if (/^nuvem\//i.test(b)) return { agente: null, nuvem: true };` por:
     ```js
     if (/^nuvem\//i.test(b)) {
       const i = b.lastIndexOf('--');
       const nome = i > 'nuvem/'.length - 1 ? b.slice(i + 2).toLowerCase() : '';
       if (nome && AGENTES.includes(nome)) return { agente: nome, nuvem: true, declarado: true };
       return { agente: null, nuvem: true };
     }
     ```
   - `AGENTES` não tem `alexandre`, então `--alexandre` cai no trailer e no restrito, como hoje.
   - Efeitos:
     - em `identificarAgente`, a sessão vira o agente do sufixo antes do trailer, e o commit vazio deixa de ser preciso;
     - no `verificar --base`, o agente do PR vem do sufixo, e o passo novo do CI garante trailer = sufixo.
   - Casos novos em `guarda-agente.test.mjs` e `coord-verificar.test.mjs`:
     - `nuvem/x--modulo-core`, sem commit, é modulo-core;
     - `nuvem/x--alexandre` é o restrito;
     - `nuvem/x--fulano` é o restrito;
     - `nuvem/x-testes`, com um hífen, continua pelo trailer.
3. **Hook barra troca de identidade pelo branch** (`guarda-bash.mjs`, PreToolUse):
   - para quem não é alexandre, bloquear `git checkout -b|-B`, `git switch -c|-C`, `git branch -m|-M` e `git worktree add -b` que criem ou renomeiem um branch cujo agente declarado (`agenteDoBranch`) seja outro que não o da sessão;
   - incluir `<agente>/T-nnnn` e `agente/T-nnnn-<agente>`;
   - casos em `guarda-bash.test.mjs`.
4. **Proteção do `main` no GitHub** (Settings → Branches):
   - exigir PR antes do merge e o check obrigatório `ci-ok`;
   - bloquear force push e exclusão;
   - só squash nas opções de merge do repositório;
   - o bypass fica só com o Alexandre, se o plano permitir;
   - isso fecha "push no main só por merge" e encerra os lotes `verificacao/*`.
5. **Minutos do Actions:**
   - subir o limite de cobrança ou esperar o ciclo virar;
   - sem isso, a migração anda até o PR em rascunho e para.
6. **Ambiente da nuvem:**
   - um ambiente "time" com `MACUXI_RECADOS_TOKEN` e o `gh` logado, sem `MACUXI_AGENTE` e sem `MACUXI_GUARDA`;
   - um ambiente "alexandre" com `MACUXI_AGENTE=alexandre`;
   - a tarefa agendada do gerente a cada 15–20 min, no ambiente "time", com `MACUXI_AGENTE=gerente-projetos` se ele quiser o gerente identificado também fora do `"agent"` do `settings.json`. O merge na nuvem já exige isso: doc 07, "Quem faz o merge".
7. **Limpezas sem pressa:**
   - `additionalDirectories` (`.claude/settings.json`) e `somente_leitura` (`.coord/donos.json`) com o caminho da Fase M: manter, porque são inofensivos, ou trocar pelo caminho da cópia no repositório;
   - apagar `scripts/sincronizar-recados.ps1` (do engenheiro-software; vai num PR próprio depois do aceite).

# ADR 0035 — Recados online num repositório próprio (macuxifdv-recados), com junções no PC

- **Status**: **proposta** em 2026-11-08. Vale com o ok do dono do produto aos diffs de governança e ao corte.
- **Data**: 2026-11-08
- **Tarefa**: T-0139 ([desenho](../desenho/T-0139.md) · [passo a passo](../desenho/T-0139-passo-a-passo.md) · [diff de governança](../desenho/T-0139-governanca.diff) · [arquivos do repositório novo](../desenho/T-0139-repo-recados/))
- **Autor**: engenheiro-software
- **Origem**: decisão do dono do produto no chat de 08/11/2026, por volta das 13h25 (R-20261108-132842-gerente-projetos)
- **Base**: doc 07 (protocolo de recados, regra de rodada, merge de governança), guardião v4 a v6 (T-0005, T-0044, T-0050), T-0049 (brechas de governança no CI)

## Contexto

Os recados (`.coord/recados/<destino>/R-*.md`) e as marcas de lidos (`.coord/lidos/<agente>.txt`) moram no repositório de código. Saem do PC no commit da rodada do gerente, que é feito ao fechar tarefa ou, no máximo, a cada 2 h. Por isso, o dono do produto só lê e escreve recado longe do PC por fora (Cowork). Ele decidiu:

- os recados passam a ser online, num repositório privado próprio;
- recados chegam do celular por um formulário;
- o Telegram avisa quando chega recado para ele.

Restrições:
- os 7 agentes locais e os scripts (`coord.mjs`, guardião) continuam com os mesmos caminhos;
- recado não se perde nem se apaga;
- nenhum segredo vai para arquivo;
- não há Docker no PC.

## Decisão

### 1. Repositório separado
- **`aloirr/macuxifdv-recados`**, privado, criado pelo dono do produto.
- A estrutura é a de hoje sem o `.coord/`: `recados/<destino>/R-*.md`, `recados/anexos/` e `lidos/<agente>.txt`.
- O formato do arquivo é o do `coord.mjs enviar`, sem mudança.
- Recados ficam fora do repositório de código. Assim:
  - a conversa não depende da rodada de commits;
  - o histórico do código não cresce com os recados (hoje são 3,5 mil arquivos);
  - as Actions do repositório de recados não ganham acesso ao código.

### 2. Junções no PC
- `C:\macuxifdv\.coord\recados` → `C:\macuxifdv-recados\recados` e `C:\macuxifdv\.coord\lidos` → `C:\macuxifdv-recados\lidos`, com `mklink /J`.
  - Junção não exige administrador nem modo de desenvolvedor, ao contrário do link simbólico.
- Nenhum script muda de caminho. **Conferido no código:**
  - o guardião (`guarda-donos.mjs`, `guarda-bash-lib.mjs`) e o `coord.mjs` montam o caminho por `path.resolve`/`relative` sobre a `RAIZ` léxica;
  - nenhum deles usa `realpath`.
  - Portanto, quem escreve por `.coord/recados/...` continua dentro da raiz, e valem as regras de sempre: recado imutável, remetente no nome, nunca `de: alexandre` de agente.
- **Brecha nova, fechada no diff de governança:** o caminho de verdade (`C:\macuxifdv-recados\recados\...`) fica fora da raiz, e o guardião deixava passar tudo fora da raiz. Com o diff:
  - `juncoesDeRecados` (coord-lib) lê o `realpath` das duas pastas;
  - `relativoPorJuncao` converte o caminho do clone de volta em `.coord/recados/...` e `.coord/lidos/...`, com as mesmas regras;
  - o resto do clone (`.git`, `.github`, `README`) fica bloqueado para os agentes;
  - o `git` que grava no clone (commit, pull, push, reset, rebase, config...) também fica bloqueado: é só do script de sincronização;
  - o `git clean -x` no repositório de código fica bloqueado, porque apagaria os ignorados, e as junções são ignoradas;
  - a foto do PostToolUse soma o `git status` do clone, com os caminhos de `.coord/`. Sem isso, um recado alterado por comando opaco sumiria do radar, porque as pastas ficam ignoradas no repositório de código.
- Testes: `.claude/hooks/guarda-juncao.test.mjs`, com junção de verdade no Windows e link simbólico no CI.

### 3. `lidos/*.txt merge=union`
- O `.gitattributes` do repositório novo tem `* text=auto eol=lf` e `lidos/*.txt text eol=lf merge=union`.
- No rebase, duas marcações simultâneas do mesmo arquivo juntam as linhas, sem conflito.
- A ordem das linhas pode mudar. O `coord.mjs` lê os lidos como conjunto, então a ordem não importa.

### 4. Sincronização a cada 2 min (`scripts/sincronizar-recados.ps1`)
- Roda em PowerShell 5.1, sem dependência.
- **Quando roda:**
  - pelo Agendador de Tarefas a cada 2 min, só com o usuário logado (`scripts/recados/agendar-sincronizacao.ps1`, uma instância por vez, limite de 2 min);
  - nos hooks `SessionStart` (espera até 40 s, para a caixa abrir atualizada) e `Stop` (em segundo plano), pelo `.claude/hooks/sincronizar-recados.mjs`.
- **Fluxo:**
  1. trava de execução única (mutex por clone);
  2. limpeza de rebase interrompido e de `index.lock` com mais de 10 min;
  3. commit do que mudou no PC (`recados: sync <host> <hora>`), só se houver mudança;
  4. `git pull --rebase --autostash`;
  5. commit do que chegou durante o pull;
  6. push, com até 3 tentativas se o GitHub recusar.
- O commit vem **antes** do pull, e não depois, como no pedido original. O resultado é o mesmo (pull --rebase, add, commit e push), e o autostash fica quase sem nada para guardar: o que o PC tem já virou commit e entra no rebase.
- **Nunca apaga:**
  - só entram recados novos e lidos alterados;
  - recado apagado no PC volta do git;
  - recado alterado no PC não sobe (é imutável) e fica no log;
  - conflito no rebase: `git rebase --abort`, código 2 e log.
- **Não trava:**
  - timeout por comando (40 s) e prazo total (100 s);
  - `GIT_TERMINAL_PROMPT=0` e `GCM_INTERACTIVE=never`.
- **Não toca segredo:**
  - a credencial é a do Git Credential Manager;
  - o log fica em `%LOCALAPPDATA%\Macuxi\recados-sync.log`, fora do repositório, sem URL com credencial e sem conteúdo de recado.

### 5. Actions no repositório de recados (`docs/desenho/T-0139-repo-recados/`)
- **`issue-recado.yml`**: transforma o formulário "Recado" num arquivo `R-AAAAMMDD-HHMMSS[-n]-alexandre.md`.
  - Usa o fuso de Boa Vista e grava um arquivo por destino, como o `coord.mjs`.
  - Faz commit e push, com 5 tentativas e rebase, e fecha a issue com o link.
  - **Só aceita issue aberta pela conta `domontecristo`.**
  - O texto da issue nunca é interpolado no shell: o Node lê o arquivo do evento, e as saídas vão por variável de ambiente.
  - Permissões: `contents: write` e `issues: write`, só nesse job. No topo, `permissions: {}`.
- **`aviso-telegram.yml`**: no push ao `main` que adiciona arquivo em `recados/alexandre/`, manda o título, o remetente, o tipo, as primeiras 8 linhas e o link. Permissão `contents: read`.
- **`status-horario.yml`**: cron de hora em hora, no minuto 7.
  - Resume os recados novos em `recados/todos/` e `recados/alexandre/` desde o último envio.
  - Sem novidade, não envia.
  - O marcador (SHA do último resumo) fica no cache do Actions, sem commit. Se o cache expirar, o resumo olha a última hora.
  - Permissão: `contents: read` (o cache usa o token do runner).
- **Secrets**: `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`. Ficam só nas variáveis do passo, os scripts os mascaram com `::add-mask::` antes de qualquer saída, e o erro do Telegram mostra só o código HTTP.
- Testes: `node --test .github/scripts/recados-lib.test.mjs`. No repositório de código, os testes também conferem o arquivo gerado contra o `coord.mjs caixa`/`ler` de verdade e os destinos contra a coord-lib.

### 6. Repositório de código depois do corte
- **Marca:** o corte põe `/.coord/recados` e `/.coord/lidos` no `.gitignore` (sem barra no fim, porque a junção pode aparecer ao git como link) e faz `git rm -r --cached` das duas pastas. O commit é do gerente-projetos, com `Agente: alexandre`.
- **`verificar` (diff de governança):** decide o estado pela marca no `.gitignore` da base e do topo (`estadoDosRecados`):
  - **sem marca**: a regra de sempre;
  - **corte** (a marca entra no commit): a saída (D) das duas pastas só é aceita do alexandre;
  - **fora** (a marca já está na base): qualquer arquivo novo nessas pastas é violação. Isso cobre, por exemplo, uma sessão da nuvem com `git add -f`.
  - Os testes estão em `coord-verificar.test.mjs`.
- **Brechas de governança (`brechas-governanca.mjs recados`):** depois do corte, o diff de `.coord/recados` fica vazio, e o passo passa sem mudança. A proteção contra a autorização de merge forjada continua por dois caminhos:
  - o estado "fora" do `verificar` recusa recado no repositório de código;
  - o guardião local barra recado `de: alexandre` de agente, inclusive pelo caminho do clone.
- **Sessões da nuvem** não alcançam o repositório de recados. O que elas mandariam como recado vai no corpo do PR, numa seção "Recados para o time", e o gerente transcreve com o próprio nome, citando o PR. O doc 07 precisa registrar isso.

### 7. Histórico
- O repositório novo começa com **um commit de migração**, que cita o commit de origem (`recados: migracao de macuxifdv@<sha>`). Não foi usado `git subtree split` nem `filter-repo`.
- Justificativa:
  1. recados são imutáveis e os lidos só crescem, então a história de cada arquivo é só "foi criado em tal commit";
  2. essa história continua no repositório de código para sempre, porque nunca reescrevemos histórico (`git log -- .coord/recados`);
  3. `subtree split` com dois prefixos (recados e lidos) e 3,5 mil arquivos leva muitos minutos no Windows sob carga, e o `filter-repo` exige Python e uma ferramenta a mais. Tudo isso entraria na janela em que os 7 agentes ficam parados;
  4. a cópia confere arquivo por arquivo, por hash, antes de mover qualquer pasta.

### 8. Resposta pelo Telegram (`telegram-recado.yml`, extensão de 08/11 16h50)
Pedido do dono do produto: "quero poder devolver um recado pelo telegram para o projeto" (R-20261108-165317-gerente-projetos). O desenho do gerente fica **confirmado**, com os ajustes marcados como *ajuste*.

- **Leitura:** cron `2-59/5 * * * *` (a cada 5 min, o mínimo do GitHub) e `workflow_dispatch`. Lê o `getUpdates` do bot, uma página de até 100 mensagens, com `allowed_updates: ["message"]`.
  - *Ajuste:* o cron começa no minuto 2, e não no 0. O GitHub atrasa mais os agendamentos da hora cheia.
- **Quem passa:** só mensagem com `chat.id` igual ao `TELEGRAM_CHAT_ID` e que não seja de bot. As demais são descartadas sem resposta. O log mostra só quantas foram, sem texto nem id.
- **Como a mensagem vira recado** (`R-AAAAMMDD-HHMMSS[-n]-alexandre.md`, pelo mesmo gerador do formulário: `horaLocal`, `idLivre`, `montarRecado` e `caminhosDoRecado`):

  | Mensagem | Destino | Tipo | `responde_a` |
  |---|---|---|---|
  | resposta a um aviso de recado do bot | o remetente do recado | `resposta` | o id do aviso |
  | resposta à confirmação do bot (*ajuste*) | o mesmo destino do recado confirmado | `resposta` | o id do recado dele |
  | solta, ou resposta a outra mensagem do bot (resumo, ajuda, erro) | `gerente-projetos` | `aviso` | — |
  | `/para <agente>[,<agente>...] <texto>` | os agentes indicados, ou `todos` (*ajuste*) | `aviso` (ou `resposta`, se também for resposta) | o do aviso, se for resposta |

  - `/para` é validado contra a lista de agentes da coord-lib, mais `todos`. Agente inválido, `/para` sem texto ou comando desconhecido geram resposta de erro no Telegram, e nada é gravado. `/start` e `/ajuda` mostram como usar.
  - Só texto, ou a legenda de uma foto. Áudio, figurinha e foto sem legenda geram resposta de erro.
  - **Assunto:** `Re: <título do aviso>` na resposta. Nos outros casos, a primeira linha da mensagem, com até 100 caracteres. O corpo é a mensagem inteira, mais a linha "_Enviado pelo Telegram em <hora>_".
  - **Tarefa:** a do aviso, na resposta. Nos outros casos, nenhuma.
  - *Ajuste:* o id e o `criado_em` vêm da **hora da mensagem**, e não da execução. Assim, reprocessar o mesmo lote repete os mesmos ids.
- **Aviso com id legível:** o `aviso-telegram` passa a trazer, no cabeçalho, a linha `id: R-...` e, no fim, "Responda a esta mensagem para devolver a <remetente>".
  - A linha do id fica no cabeçalho para nunca ser cortada pelo limite de caracteres.
  - O destino da resposta sai do próprio id, porque o `coord.mjs` grava o remetente no nome. Ele precisa ser um agente.
  - O bot confere que a mensagem respondida é dele, pelo id do bot (a parte do token antes do `:`).
- **Offset idempotente, sem perder mensagem.** O último `update_id` gravado fica em `estado/telegram-ultimo-update.txt`, **no mesmo commit dos recados**.
  - O `getUpdates` usa `offset = último + 1`. Esse offset confirma ao Telegram só o que já está no `main`. O lote desta execução só é confirmado na próxima, depois do push.
  - Push que falha: o workflow volta ao `main`, relê o lote e regrava os mesmos ids, até 5 tentativas. Se todas falharem, nada foi confirmado, e o lote volta na próxima execução.
  - `update_id` menor ou igual ao último gravado é descartado, mesmo que o Telegram o devolva de novo.
  - O arquivo de recado é gravado com `wx` e nunca sobrescreve outro. O id já usado, por exemplo pelo formulário no mesmo segundo, ganha `-n`.
  - O estado avança também com as mensagens descartadas, para que mensagens de outros chats não ocupem a página de 100.
  - *Ajuste:* o estado vai para o repositório, e não para o cache do Actions. O cache não é atômico com o push: um cache salvo depois de um push que falhou perderia mensagens, e um cache não salvo depois de um push feito duplicaria recados.
- **Confirmação:** depois do push, o bot responde à mensagem com "Recado R-... gravado para <destino>." e o assunto. As respostas de erro e de ajuda também saem só depois do push do estado.
  - Se a confirmação falhar, o recado já está gravado. A execução fica vermelha e o log mostra só o código HTTP.
- **Concorrência:** grupo próprio `telegram-recado`, sem cancelar o que está em andamento.
  - *Ajuste:* o grupo não é o `escrita-no-main` do formulário. No GitHub, um pendente novo cancela o pendente anterior do mesmo grupo, e o cron de 5 min cancelaria um recado do formulário que estivesse na fila.
  - A disputa de push com o formulário e com o PC fica com a nova tentativa.
  - Commits do `GITHUB_TOKEN` não disparam outros workflows, e esses recados nunca vão para a caixa do dono do produto.
- **Segredos e permissões:**
  - `permissions: {}` no topo e só `contents: write` no job;
  - os secrets ficam só nas variáveis dos dois passos que os usam e são mascarados com `::add-mask::` antes de qualquer saída;
  - o texto das mensagens não passa pelo shell nem pelo log: o Node lê a API e grava os arquivos;
  - a mensagem do commit tem só os ids;
  - os erros mostram só o código HTTP.
- **Testes** (`telegram-recado.test.mjs`, 11 testes): resposta, confirmação, solta, `/para` válido e inválido, chat de outra pessoa ignorado, mensagem que não é texto, offset idempotente contra um `getUpdates` de mentira que confirma como o de verdade (push que falhou, relido e já gravado) e o recado lido pelo `coord.mjs caixa`/`fio` de verdade.
- **Latência:** de 5 a 10 min até o `main` (cron de 5 min, mais o atraso do GitHub, que às vezes passa de 10 min), mais até 2 min do Agendador até o PC.
  - O Telegram guarda por **24 h** a mensagem que não foi lida. Se o workflow ficar parado mais que isso (Actions desligado, cota esgotada ou bot com webhook), as mensagens se perdem. O passo a passo pede para conferir o "Recado ... gravado".
- **Risco de autoria:** recado `de: alexandre` agora também vem do Telegram. Quem tomar a conta do Telegram dele pode mandar recado em nome dele, inclusive "autorizo o merge". É o mesmo risco do formulário com a conta `domontecristo`. Mitigação: verificação em duas etapas no Telegram (senha na nuvem). O token do bot não permite forjar mensagem do chat dele, mas permite ler e descartar mensagens: por isso ele fica só nos secrets.
- **Custo** (*ponto para decisão do dono do produto*). Cada execução conta **1 min** de Actions, arredondado para cima, mesmo quando não há mensagem. O repositório é privado e a conta está no plano gratuito, com 2.000 min/mês para todos os repositórios (ADR 0014 §7, que já passa disso só com o CI do código).

  | Cron | Execuções/mês | Minutos/mês |
  |---|---|---|
  | a cada 5 min, 24 h (padrão do arquivo) | ~8.640 | ~8.640 |
  | a cada 5 min, das 6h à meia-noite de Boa Vista | ~6.480 | ~6.480 |
  | a cada 10 min, 24 h | ~4.320 | ~4.320 |
  | a cada 15 min, das 6h à meia-noite | ~2.160 | ~2.160 |

  - Para comparar: o `status-horario` gasta ~720 min/mês.
  - O arquivo traz as alternativas comentadas, e a troca é de uma linha.
  - Sem servidor próprio, não há como evitar o custo por execução. Um webhook do Telegram exigiria um intermediário com segredo, como um Cloudflare Worker, o que o desenho excluiu. Um runner no PC só funcionaria com o PC ligado.
  - Se o limite de gasto da conta for US$ 0 e a cota acabar, **todas** as Actions da conta param, inclusive o CI do código. Por isso a decisão do intervalo é do dono do produto, antes de cadastrar o workflow.

## Alternativas consideradas
- **Telegram por webhook** em vez de `getUpdates` agendado: a latência seria de segundos e não haveria custo por execução. Mas o Telegram só chama uma URL com JSON, sem cabeçalho de autorização, e o `repository_dispatch` do GitHub exige token. Seria preciso um intermediário (Worker ou servidor) com o token do GitHub, que o desenho excluiu. Rejeitada por enquanto; volta à mesa se o custo do cron pesar.
- **Ler o Telegram no PC**, pelo script de sincronização a cada 2 min: a latência seria menor e não haveria custo de Actions. Mas o token do bot ficaria no PC, contra "token só nos secrets", e nada chegaria com o PC desligado. Rejeitada.
- **Offset no cache do Actions**: não é atômico com o push. Ver §8. Rejeitada.
- **Pastas no mesmo repositório, com push mais frequente**: misturaria o ritmo dos recados com o rito de commits por dono e com o CI do código. O push a cada 2 min no `main` dispararia CI a cada vez. Rejeitada.
- **Submódulo git em `.coord/`**: muda o caminho para os agentes e complica o pull do gerente (`submodule update`). As sessões da nuvem também não clonam submódulo privado. Rejeitada.
- **Link simbólico em vez de junção**: exige modo de desenvolvedor ou administrador no Windows. Rejeitada.
- **Banco ou serviço próprio (API de recados)**: dependência pesada, com segredo e servidor. O git já dá histórico, auditoria e trabalho offline. Rejeitada.
- **Marcador do resumo horário em arquivo no repositório**: um commit por hora com novidade e mais disputa de push com o PC. O cache basta. Rejeitada.

## Riscos e mitigação
| Risco | Mitigação |
|---|---|
| **Conflito** no pull --rebase | Lidos com `merge=union`. Recados têm nome único (id com segundo, sufixo `-n` e remetente) e nunca mudam. Se mesmo assim houver conflito: `rebase --abort`, código 2, log, e nada se perde (teste "conflito no rebase"). |
| **Perda de recado no corte** | Corte só com os agentes parados, conferido pelo processo `claude`. Cópia sem sobrescrever: nome igual com conteúdo diferente para tudo antes de mover. Conferência por hash. Pastas originais vão para backup fora do repositório. Recado ainda não commitado também migra. |
| **Perda de recado depois do corte** | A sincronização nunca faz commit de remoção e restaura recado apagado. O guardião barra apagar recado, inclusive pelo caminho do clone e por `git clean -x`. Sem force push: regra `deny` do settings e git do clone bloqueado para os agentes. |
| **Junção quebrada** (clone movido ou apagado) | O `coord.mjs` vê a caixa vazia (`existsSync` falso), sem erro silencioso de escrita. O `enviar` falha ao gravar. O corte de novo confere e acusa; a volta recria as pastas. O hook de sessão só roda com a junção certa. A remoção de junção é sempre `rmdir`, nunca `Remove-Item -Recurse`, que entraria no clone. |
| **Segredo** | Nenhum arquivo tem token. A credencial do git é a do GCM do Windows. Secrets só no GitHub, mascarados. O log local não tem URL com credencial. O repositório é privado, e o passo a passo pede 2FA nas contas `aloirr` e `domontecristo`. |
| **Autorização de merge pelo formulário** | O recado do formulário é `de: alexandre` legítimo, porque só a conta `domontecristo` passa. Quem tomar essa conta poderia autorizar merge, o mesmo risco de quem toma o PC. Por isso, 2FA obrigatório. |
| **CI do repositório de código que lia `.coord/recados`** | O `verificar --por-commit` do corte apagaria 3,5 mil recados sem a regra nova. Com a marca, o commit do corte com `Agente: alexandre` passa (testado). O `brechas-governanca recados` fica vazio e passa. O escopo do CI trata o commit do corte como completo, porque o `.gitignore` não é coordenação. **O diff de governança precisa estar no `main` antes do commit do corte**, senão o CI do `main` fica vermelho. |
| **PR da nuvem com recado em `.coord/recados`** depois do corte | O estado "fora" deixa o PR vermelho, com o motivo. A sessão põe o recado no corpo do PR. |
| **Critério de 3 min** | O pior caso do formulário até o PC é de 0,5 a 1 min de Action, mais até 2 min do Agendador, mais cerca de 30 s de sincronização com o PC carregado. Fica perto do limite. Se o teste passar de 3 min, o intervalo pode cair para 1 min (`-RepetitionInterval`), sem outra mudança. |
| **Janela piscando a cada 2 min** | A tarefa usa `conhost.exe --headless`. Se não rodar nessa versão do Windows, a opção `-Simples` usa o PowerShell oculto. |
| **Cron do GitHub atrasa** | O resumo é de hora em hora e tolera atraso. Os avisos que importam (caixa do dono do produto) vão pelo `aviso-telegram`, no push. |

## Plano de volta
`scripts/recados/volta.ps1`, com os agentes parados:
1. sincroniza uma última vez;
2. remove só as junções (`rmdir`);
3. copia recados e lidos do clone para `.coord/` (lidos unidos);
4. tira a marca do `.gitignore` e faz `git add`. O gerente faz o commit, com `Agente: alexandre`;
5. remove a tarefa do Agendador.

O clone e o repositório no GitHub ficam como arquivo. O dono do produto arquiva o repositório para parar as Actions. O diff de governança pode ficar: sem junção, tudo volta à regra de antes, e o estado "marca na base e não no topo" segue a regra de sempre. A volta é idempotente e tem `-Simular`, como o corte (teste "corte ... volta desfaz").

## Consequências
- Recados chegam ao PC em até cerca de 3 min a partir do celular, e ao Telegram em até cerca de 3 min a partir do PC.
- Pelo Telegram, a resposta chega ao PC em 5 a 10 min, às vezes mais (§8). Isso custa minutos de Actions, e o intervalo é decisão do dono do produto.
- O commit da rodada do gerente deixa de separar recados e lidos por autor. Os commits do repositório de recados são `recados: sync <host> <hora>`, sem trailer.
- **A autoria de cada recado continua no nome do arquivo e no `de:`**, conferida pelo guardião no momento da escrita. O CI do repositório de código deixa de conferir recados (não há recado lá). O repositório de recados não tem CI de donos: a garantia passa a ser só local, como já era para recado não commitado.
- Sessões da nuvem mandam recados pelo corpo do PR.
- O doc 07 (§ Protocolo de recados, commit de rodada por dono e recados da nuvem) e o `CLAUDE.md` são atualizados pelo gerente-projetos.
- Ordem de execução: [passo a passo](../desenho/T-0139-passo-a-passo.md) e [desenho](../desenho/T-0139.md).

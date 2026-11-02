# 07 — Time de agentes e protocolo de coordenação

## Organograma
```
                         Alexandre (dono do produto)
                                   │  recados em .coord/recados/alexandre
                     ┌─────────────┴─────────────┐
                     │  GERENTE DE PROJETOS SÊNIOR │  ← sessão principal do Claude Code
                     └─────────────┬─────────────┘
     ┌────────────────────┬───────┴────────────┬────────────────────┐
  Engenheiro de        Engenheiro de        Desenvolvedor de     Testes Sênior
  Software Sênior      Aplicativos          Banco Sênior         (e2e, integração,
  (arquitetura, API,   (shells mobile/web,  (schemas, migrações, carga, regressão)
  plataforma, revisão) ui, EAS, telas)      RLS, Conector)
     └────────────────────┴───────┬────────────┴────────────────────┘
   ┌──────────┬──────────┬─────────┼─────────┬──────────┬──────────┬──────────┐
 modulo-   modulo-    modulo-   modulo-   modulo-   modulo-    modulo-     modulo-
 core      catalogo   vendedor  promotor  gestor    pesquisa   treinamento integracao
```

## Papéis
| Agente | Responsabilidade | Não faz |
|---|---|---|
| **gerente-projetos** | Comanda o time: quebra demandas em tarefas `T-nnnn`, delega, acompanha recados e bloqueios, mantém quadro, roadmap e docs de produto, fecha sprints e reporta ao Alexandre | Não escreve código |
| **engenheiro-software** | Arquitetura e plataforma: `apps/api`, `platform-sdk`, `packages/comum` e `config`, contratos entre módulos, regras de fronteira, ADRs, desenhos de tarefa, CI (`.github/`), `scripts/`, raiz e lockfile; **revisão final de arquitetura** de toda tarefa | Não implementa regra de módulo |
| **engenheiro-apps** | Telas e shells: `apps/mobile` (variantes campo/gestao, EAS), `apps/web` (shell do BKO), `packages/ui`, navegação, login e seleção de servidor, acessibilidade e "3 toques", builds EAS; **revisão das telas** dos módulos (`modules/<m>/app` e `modules/<m>/web`) | Não corrige código alheio (recado 🔴/🟡/🟢 ao dono); não mexe em API, SDK, CI nem raiz (recado ao engenheiro-software) |
| **banco-dados** | Todos os schemas (nuvem e SQLite), migrações, RLS, índices, seeds, desempenho, views-modelo do Conector | Não escreve tela nem regra |
| **testes** | Plano de testes, e2e (Playwright), integração entre módulos, sync offline, multi-tenant, carga; relatório critério → teste → resultado | Não corrige código de produção — abre recado com o defeito |
| **modulo-core** | Login/perfis, carteira, Cliente 360, rotas/visitas, sync no app, metas, notificações | — |
| **modulo-catalogo** | Catálogo, busca em linguagem natural, conteúdo rico | — |
| **modulo-vendedor** | Pedido, pré-venda, aprovações, PDF, alertas de ruptura recebidos | — |
| **modulo-promotor** | Trade marketing: gôndola, share, preço, ruptura, validade, pontos extras, tarefas; visão do cliente só leitura | Pedido de qualquer tipo |
| **modulo-gestor** | App Gestão, painéis, alertas, aprovações, pedido em nome (via extensão) | — |
| **modulo-pesquisa** | Construtor, público-alvo, resposta offline, resultados | — |
| **modulo-treinamento** | Trilhas, quiz, gamificação, ranking | — |
| **modulo-integracao** | Hub REST, Conector, carga por arquivo, monitor | — |

**Fronteira entre os dois engenheiros** (decisão do Alexandre, R-20261101-073742):
- Dependência nova, ponto de extensão de UI no SDK, mudança no CI ou na raiz: o engenheiro-apps pede por recado ao engenheiro-software; ADR de UI ele redige como proposta e o engenheiro-software registra em `docs/decisoes/`.
- **Quem revisa o quê**: telas de módulo e shells → engenheiro-apps (usabilidade, offline, `packages/ui`, sem regra na tela); arquitetura, contratos, API, segurança e fronteiras → engenheiro-software, que continua o revisor final antes do fechamento. Tarefa com tela passa pelas duas revisões.
- **Transição**: até o Alexandre mudar o `.coord/donos.json` (`apps/mobile/**`, `apps/web/**` e `packages/ui/**` → engenheiro-apps), esses caminhos seguem com o engenheiro-software e o engenheiro-apps não é disparado. O gerente avisa o Alexandre com "pronto para a divisão" quando não houver nada em andamento nesses caminhos.

**Testes em duas instâncias**: quando houver trabalho de teste em pastas separadas (ex.: `tests/integracao` e `tests/e2e`), o gerente dispara o agente `testes` em duas instâncias ao mesmo tempo, cada uma com a sua pasta escrita no pedido; o diário continua um só (só acrescentar linhas).

Cada agente de módulo é dono da **fatia vertical** do seu módulo (domínio, contratos, API, telas do app e do BKO), exceto `db/`, que é do agente de banco.

## Regra de ouro
**Cada agente altera só o que é seu. Para qualquer coisa fora disso, deixa um recado.** Nunca edita arquivo de outro agente, nunca edita recado alheio, nunca apaga recado.

Garantias:
1. `.coord/donos.json` define o dono de cada caminho (primeira regra que casa vence).
2. **Guardião** (`.claude/hooks/guarda-donos.mjs`) bloqueia Edit/Write fora dos caminhos do agente e qualquer alteração em recado existente.
3. `node scripts/coord.mjs verificar <agente>` confere o diff no git (pega o que passou por fora, ex.: comandos de shell).
4. O revisor final (engenheiro) recusa entrega com violação.

## Protocolo de recados (universal, igual para todos)
**Onde**: `.coord/recados/<destinatario>/` — um arquivo por recado, imutável. Destinatários: os 12 agentes + `alexandre` + `todos`.
**Como criar** (sempre pela CLI, para manter o formato idêntico):
```bash
node scripts/coord.mjs enviar --de modulo-vendedor --para modulo-catalogo --tipo pedido \
  --assunto "Expor extensão produto.acoes" --tarefa T-0012 --prioridade alta \
  --corpo "Contexto: ... | Preciso: ... | Pronto quando: ..."
```
**Formato** (gerado pela CLI):
```markdown
---
id: R-20261031-140512-modulo-vendedor
de: modulo-vendedor
para: [modulo-catalogo]
cc: [gerente-projetos]
tipo: pedido          # pedido | pergunta | resposta | aviso | bloqueio | entrega | revisao
prioridade: alta      # alta | normal | baixa
tarefa: T-0012
responde_a: null
encerra: false        # true numa resposta = assunto resolvido
contrato: null        # ex.: vendedor.pedido.criado@1
criado_em: 2026-10-31T14:05:12-04:00
---
# Expor extensão produto.acoes
## Contexto
## O que preciso / o que mudou
## Pronto quando
```
**Ciclo**: recado aberto → destinatário responde com `--responde-a <id>` → quem resolve marca `--encerra`. Recado de `bloqueio` vai sempre com cópia ao gerente.
**Rotina de todo agente**:
1. Ao começar: `node scripts/coord.mjs caixa <eu>` e tratar recados abertos.
2. Durante: trabalhar só nos seus caminhos; dúvidas e pedidos → recado.
3. Ao terminar: recado `entrega` ao gerente (o que fez, testes, pendências) + linha no diário `.coord/diario/<eu>.md`.

## Frentes de trabalho: local e nuvem
> Decisão do Alexandre, 2026-10-31 (versão final; vale a partir de agora, sem pedir confirmação).

**1. Frentes**
- **Local** (este VS Code, agentes de `.claude/`): tudo que precisa do Docker/Postgres, da pasta da Fase M, de build ou aparelho Android, ou que mexe em arquivos de um agente ativo.
- **Nuvem** (claude.ai/code, sessões abertas pelo Alexandre sobre o GitHub `aloirr/macuxifdv`): tarefas só de código e testes, sem dependência local, cada uma no seu branch (`nuvem/*`, `alexandre/*` ou `agente/*`), com **merge automático no `main` quando os testes passam**.

**2. Trava de arquivos**
- O quadro tem a coluna **Onde** (`local` | `nuvem`) em cada tarefa e a seção **Travado pela nuvem** com os caminhos travados.
- Nenhum agente local altera caminho travado. Nenhuma tarefa roda nas duas frentes ao mesmo tempo.
- Quando o merge da nuvem chega no pull, o gerente-projetos **destrava** os caminhos daquela tarefa.

**Escrita da nuvem**: a sessão da nuvem só altera os caminhos travados da tarefa e cria recados novos. Não edita `.coord/quadro.md`, `.coord/tarefas/`, `docs/backlog.md` nem `docs/produto/`; isso é do gerente-projetos, quando o merge chega. Commits da nuvem levam o trailer `Agente: <dono do caminho>` (convenção no R-20261031-093259-2-alexandre).

**Commit de rodada por dono (verificar --por-commit no CI)**: cada commit leva o trailer `Agente:` de UM agente e só arquivos dele — inclusive o próprio `.coord/diario/<agente>.md`, `.coord/lidos/<agente>.txt` e os recados novos que ele enviou (`R-...-<agente>.md`). Recados e lidos do Alexandre vão num commit com `Agente: alexandre`. O gerente separa os arquivos de `.coord/` por autor no fechamento da rodada; nunca juntar arquivos de agentes diferentes num commit só.

**Nome do branch da nuvem** (R-20261101-184624): a sessão da nuvem usa sempre `nuvem/T-nnnn-<assunto>`, mesmo que o ambiente indique outro branch (`claude/...`).

**Numeração de tarefa**: antes de abrir uma tarefa, o gerente lê a própria caixa, porque o Alexandre pode ter reservado números para a nuvem, e confere o maior T-nnnn em `.coord/tarefas/` e no `git log` do `main`. Números reservados pelo Alexandre não são usados para outra coisa.

**Quem faz o merge** (R-20261101-203953; guardião v5, T-0044):
- **PR comum** (não toca caminho de governança), com o CI do PR e o do `main` verdes: a **própria sessão da nuvem** faz o merge (squash, `--subject` sem a marca, trailer do dono). Se o main estiver vermelho, ela marca "[PRONTO PARA MERGE]" e para; o gerente faz o merge pela regra A quando o main voltar a ficar verde.
- **PR de governança**: nunca a sessão. Vale sempre o rito com a autorização do Alexandre (abaixo).
- O guardião v5 controla só o `gh pr merge` rodado pelo Claude Code local. Ele passa apenas na sessão principal do gerente, com o comando exato (`-R aloirr/macuxifdv`, `--squash`, `--match-head-commit <sha>`, sem `--admin`/`--auto`) e o head conferido no GitHub. Se o `gh` não responder, o merge fica bloqueado (falha fechada). Na nuvem, o gerente só passa com `MACUXI_AGENTE=gerente-projetos`.
- PR de governança exige, na caixa do gerente, um recado `R-...-alexandre.md` com `de: alexandre` e a frase "autorizo o merge do PR #N no commit <sha>", com o mesmo N e SHA. Nenhum agente cria recado em nome do Alexandre (o guardião barra).
- Depois que a T-0049 entrar, o CI do main fica vermelho se um commit mexer em governança sem `Agente: alexandre`.

**Merge pelo gerente de PR pronto que não é de governança** (decisão do Alexandre, R-20261101-165024): vale para PR da nuvem marcado "[PRONTO PARA MERGE]" que não toca `.claude/**`, `.coord/donos.json`, `scripts/coord*.mjs` nem `.github/**`. Com o CI do `main` verde, o gerente confere três coisas:
- o CI do PR está verde (com o main já mesclado no branch, se o GitHub exigir);
- o head SHA é o do momento da marcação;
- `node scripts/coord.mjs verificar --base origin/main` do branch passa.

Com tudo conferido, executa `gh pr merge N -R aloirr/macuxifdv --squash --match-head-commit <sha> --body "Agente: <dono da tarefa>"`, sem pedir autorização. Se o branch estiver desatualizado, o gerente mescla o main nele, espera o CI do PR ficar verde e só então faz o merge, sem mexer em código. Depois do merge: `git pull`, quadro, diário e um recado curto ao Alexandre com o commit do squash.

**Rotina de push (custo do CI)** (R-20261101-165024): o push acontece ao fechar uma tarefa ou, no máximo, a cada 2 horas, e não a cada rodada. Os testes rodam localmente antes, como sempre. A exceção é a correção de main vermelho, que sobe na hora.

**Credenciais da Cloudflare** (R-20261101-164531): a autorização do `cloudflared` (`%USERPROFILE%\.cloudflared`: cert.pem, JSON do túnel) fica fora do repositório e fora do alcance dos agentes. A regra é a mesma do `.env`: nenhum agente lê, copia, move ou commita esses arquivos. Os scripts só chamam o `cloudflared`, que os lê sozinho.

**Merge de PR de governança** (decisão do Alexandre, R-20261101-151135; vale desde a T-0033): PR que altera `.claude/**`, `.coord/donos.json`, `scripts/coord*.mjs` ou `.github/**` não faz merge sozinho. O Alexandre decide e o gerente executa:
1. A sessão da nuvem termina com "[PRONTO PARA MERGE]" e manda recado com o número do PR, o commit de topo (head SHA) e a lista de arquivos de governança alterados.
2. O gerente confere e resume ao Alexandre por recado: CI do PR verde, CI do `main` verde, head SHA e o que cada arquivo de governança muda, em 1 linha cada (com destaque se algum check, guardião ou regra fica mais fraco).
3. Só depois de um recado do Alexandre "autorizo o merge do PR #N no commit <sha>" o gerente confere os dois CIs de novo e executa `gh pr merge N -R aloirr/macuxifdv --squash --match-head-commit <sha> --body "Agente: alexandre"`.
4. Se o head mudou, se um CI ficou vermelho ou se apareceu arquivo de governança fora da lista aprovada, não há merge: o gerente avisa o Alexandre.
5. É proibido fazer o merge sem um recado do Alexandre que cite o número e o SHA. Aprovação genérica não vale, e nenhum agente aprova em nome dele. PR sem caminho de governança segue a regra normal: a sessão faz o merge com os dois CIs verdes.
6. Depois do merge: `git pull`, linha no diário e recado curto ao Alexandre com o commit do squash.

**Main vermelho = nuvem não faz merge** (decisão do Alexandre, 2026-11-01): enquanto o CI do `main` estiver vermelho, nenhuma sessão da nuvem faz merge; o PR fica com "[PRONTO PARA MERGE]" no título e espera. O gerente avisa o Alexandre quando o `main` voltar a ficar verde. O CI roda todas as suítes e reporta todas as falhas (não para na primeira).

**Início de sessão da nuvem**: toda sessão da nuvem começa com um commit vazio que já leva o trailer `Agente: <dono>` no último bloco da mensagem (`git commit --allow-empty`), para o guardião v3 reconhecer o agente desde o primeiro passo.

**Recados da nuvem**: recado criado por uma sessão da nuvem sai com o remetente (`--de`) igual ao agente do trailer `Agente:` do commit (exigência do CI desde o PR #4).

**GitHub CLI (`gh`)**: o gerente-projetos acompanha CI e PRs pelo `gh` (`gh auth status`, `gh run list --limit 5`, `gh run view <id> --log-failed`, `gh pr list`), em vez de pedir ao Alexandre para abrir o navegador. O `gh pr merge` segue as regras de "Quem faz o merge" acima e passa pelo guardião v5. Sem pedido do Alexandre, o `gh` **não** é usado para fechar PR, apagar branch ou mudar configuração do repositório.

**3. Git automático** (executado pelo gerente-projetos, sem pedir confirmação; os demais agentes não fazem commit)
- **Início de cada rodada**: `git pull --no-rebase origin main`. Se vieram commits da nuvem: `pnpm install`, registrar a entrega no quadro e na tarefa, destravar os caminhos e mandar recado de revisão ao dono do caminho.
- **Fim de cada rodada**, com `pnpm lint`, `pnpm typecheck` e `pnpm test` da raiz verdes: commit no `main` (`T-nnnn: <resumo>` + trailer `Agente: <nome>`) → `git pull --no-rebase origin main` → lint, typecheck e test de novo → `git push origin main` se verde.
- **Vermelho depois do pull**: não fazer push; disparar a correção para o dono e fazer o push quando ficar verde.
- **Conflito no pull**: o gerente resolve só se o arquivo for dele (`.coord/`, `docs/produto/`); se for de outro dono, chama o dono para resolver e só então faz o push. O Alexandre é avisado por recado só se o conflito durar mais de uma rodada.
- **Proibido**: force push, rebase do `main`, push com teste vermelho, apagar histórico.
- **Permissão de push**: a regra do `.claude/settings.json` permite push para `main`, `nuvem/*`, `alexandre/*` e `agente/*` e nega force e delete (entregue pela T-0005 na nuvem). Enquanto a regra não chegar pelo pull, o gerente faz só o commit local e segue.

## Contratos entre módulos
`.coord/contratos/` (dono: engenheiro-software) registra eventos, extensões e dependências. O módulo publicador é dono do schema do evento em `modules/<m>/contracts`; mudança incompatível = nova versão + recado a todos os consumidores.

## Modos de execução no Claude Code
- **A — Subagentes (padrão, estável)**: o `gerente-projetos` é a sessão principal (`"agent": "gerente-projetos"` no `.claude/settings.json`) e delega com a ferramenta Agent; os agentes conversam por recados.
- **B — Equipe de agentes (experimental)**: com `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, o gerente vira líder e cria colegas a partir das mesmas definições; eles trocam mensagens ao vivo (`SendMessage`). Regra: **toda decisão ou pedido trocado ao vivo também vira recado** em `.coord/` (é a memória oficial e versionada). Limitações conhecidas: uma equipe por sessão, sem retomar colegas, modo de painéis divididos não funciona no terminal do VS Code (use o modo padrão).

## Custos
Gerente, engenheiro, banco e testes usam o modelo mais forte (`opus`); agentes de módulo usam `sonnet`. Para economizar, troque testes para `sonnet` ou rode no máximo 3 agentes de módulo em paralelo.

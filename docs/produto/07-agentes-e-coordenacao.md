# 07 — Time de agentes e protocolo de coordenação

## Organograma
```
                         Alexandre (dono do produto)
                                   │  recados em .coord/recados/alexandre
                     ┌─────────────┴─────────────┐
                     │  GERENTE DE PROJETOS SÊNIOR │  ← sessão principal do Claude Code
                     └─────────────┬─────────────┘
        ┌──────────────────────────┼──────────────────────────┐
  Engenheiro de Software     Desenvolvedor de Banco       Testes Sênior
  Sênior (arquitetura,       Sênior (schemas, migrações,  (e2e, integração,
  plataforma, revisão)       RLS, desempenho, Conector)   carga, regressão)
        └──────────────────────────┼──────────────────────────┘
   ┌──────────┬──────────┬─────────┼─────────┬──────────┬──────────┬──────────┐
 modulo-   modulo-    modulo-   modulo-   modulo-   modulo-    modulo-     modulo-
 core      catalogo   vendedor  promotor  gestor    pesquisa   treinamento integracao
```

## Papéis
| Agente | Responsabilidade | Não faz |
|---|---|---|
| **gerente-projetos** | Comanda o time: quebra demandas em tarefas `T-nnnn`, delega, acompanha recados e bloqueios, mantém quadro, roadmap e docs de produto, fecha sprints e reporta ao Alexandre | Não escreve código |
| **engenheiro-software** | Arquitetura, `platform-sdk`, shells (mobile/web/api), contratos entre módulos, regras de fronteira, ADRs, revisão de código final | Não implementa regra de módulo |
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

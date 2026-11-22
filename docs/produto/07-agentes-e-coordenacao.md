# 07 — Time de agentes e protocolo de coordenação

## Organograma
```
                         Alexandre (dono do produto)
                                   │  recados em .coord/recados/alexandre
                     ┌─────────────┴─────────────┐
                     │  GERENTE DE PROJETOS SÊNIOR │  ← sessão principal do Claude Code
                     └─────────────┬─────────────┘
     ┌──────────────────┬──────────────────┬┴─────────────────┬──────────────────┐
  Engenheiro de      Engenheiro de      Designer UX        Desenvolvedor de   Testes Sênior
  Software Sênior    Aplicativos        (packages/ui,      Banco Sênior       (e2e, integração,
  (arquitetura, API, (shells mobile/web,docs/design,       (schemas, migra-   carga, regressão)
  plataforma,        transições, APK,   visual, textos,    ções, RLS,
  revisão final)     revisão técnica)   3 toques)          Conector)
                                                                             │
                                                                  Corretor de Redundâncias
                                                                  (auditoria de redundâncias:
                                                                  texto, indicadores, layout,
                                                                  código, rotinas, testes, docs)
     └──────────────────┴──────────────────┬──────────────────┴──────────────────┘
   ┌──────────┬──────────┬─────────┼─────────┬──────────┬──────────┬──────────┐
 modulo-   modulo-    modulo-   modulo-   modulo-   modulo-    modulo-     modulo-
 core      catalogo   vendedor  promotor  gestor    pesquisa   treinamento integracao
```

## Papéis
| Agente | Responsabilidade | Não faz |
|---|---|---|
| **gerente-projetos** | Comanda o time: quebra demandas em tarefas `T-nnnn`, delega, acompanha recados e bloqueios, mantém quadro, roadmap e docs de produto, fecha sprints e reporta ao Alexandre | Não escreve código |
| **engenheiro-software** | Arquitetura e plataforma: `apps/api`, `platform-sdk`, `packages/comum` e `config`, contratos entre módulos, regras de fronteira, ADRs, desenhos de tarefa, CI (`.github/`), `scripts/`, raiz e lockfile; **revisão final de arquitetura** de toda tarefa | Não implementa regra de módulo |
| **engenheiro-apps** | Shells: `apps/mobile` (variantes campo/gestao), `apps/web` (shell do BKO), navegação, transições do shell, login e seleção de servidor, build Android (`android-build.yml`); **revisão técnica das telas** dos módulos (offline, navegação, desempenho, bundle) | Não mexe em `packages/ui` (é do designer-ux); não corrige código alheio (recado 🔴/🟡/🟢 ao dono); não mexe em API, SDK, CI nem raiz (recado ao engenheiro-software) |
| **designer-ux** | Visual e UX (R-20261103-161508): `packages/ui` (tokens, componentes base, movimento) e `docs/design/` (especificações e referências); **revisão de visual, hierarquia, textos e "3 toques"** das telas dos módulos antes do merge | Não escreve regra nem tela de módulo (recado ao dono); não mexe nos shells (recado ao engenheiro-apps) |
| **banco-dados** | Todos os schemas (nuvem e SQLite), migrações, RLS, índices, seeds, desempenho, views-modelo do Conector | Não escreve tela nem regra |
| **testes** | Plano de testes, e2e (Playwright), integração entre módulos, sync offline, multi-tenant, carga; relatório critério → teste → resultado. **Defeito funcional é dele**, inclusive valor exibido × regra: todo indicador e todo número de tela é conferido contra a fórmula da RN (ex.: RN-CORE-21/22/26) e o rótulo tem de bater com o valor ("Meta de hoje" mostra a meta do dia, nunca o realizado do mês). *(Dono do produto, 08/11/2026: o "META DE HOJE R$ 553" tinha de ter sido pego pelo testes.)* | Não corrige código de produção — abre recado com o defeito |
| **corretor-redundancias** | Revisor de **excessos, duplicidades e redundâncias** (T-0123; escopo ajustado pelo dono do produto em 08/11/2026): texto e rótulos repetidos, o mesmo indicador em várias representações, estado vazio duplicado, aviso repetido, layout com sobra, código copiado e exports mortos (jscpd, knip), rotinas, testes, docs e tarefas sobrepostos. **Toda tarefa passa por ele**, assim como passa pelo testes, antes do fechamento. Grava o relatório e o catálogo `RD-nnnn` em `docs/qualidade/redundancias/**`, abre recado ao dono com o antes → depois e retesta depois da correção | Não faz: corrigir código de outro agente (nem tela, schema, doc de produto ou quadro); **caçar defeito funcional** (valor errado, fórmula fora da RN, rótulo que contradiz o valor): isso é do **testes**. Se tropeçar num defeito, só encaminha ao testes, sem catalogar como RD |
| **design-de-marca** | Guardião da marca (T-0169; R-20261112-065523 e 065914). Valida toda mudança de **cor ou layout** em qualquer superfície (Campo, Gestão, BKO, portal, PDFs, e-mails e site) **antes do lote e do build**. Mantém o manual da marca em `docs/marca/**`, com o que o dono do produto aprovou. Propõe evolução com opções, recomendação e o porquê. Achados `MC-nnnn` | Não faz: alterar código nem tela de outro agente; aprovar marca, porque só o dono do produto aprova |
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
- **Toda tarefa passa pelo testes e pelo corretor-redundancias** antes do fechamento (dono do produto, 08/11/2026). O testes valida os critérios e caça defeitos, inclusive valor × regra em indicadores. O corretor-redundancias avalia só excessos, duplicidades e redundâncias.
- **Toda mudança de cor ou layout passa pelo design-de-marca** antes do lote e do build (dono do produto, R-20261112-065914).
- **Regra permanente do corretor** (dono do produto, R-20261110-062506 e R-20261110-062239, 10/11/2026):
  - **Toda** entrega que muda tela, texto, relatório ou regra, de qualquer agente (Campo, Gestão, BKO), passa pelo corretor **antes do lote e antes do build**, sem exceção e sem esperar pedido.
  - O parecer olha o **print do aparelho**, não só o código: informação repetida na tela ou entre telas, aviso ou caixa repetindo uma linha, texto além do problema e da ação, rótulo e número que não batem.
  - **Qualquer achado em aberto, de qualquer gravidade, segura a entrega**, como um teste vermelho. Isso substitui o "sem achado alto" de 08/11.
  - **Exceção** (dono do produto, R-20261111-190159, 11/11/2026): achado de gravidade baixa que esteja **só em comentário ou título de teste** não segura o lote e entra no lote seguinte. Achado em código de produção, tela, texto, PDF, relatório, regra ou doc continua segurando. Motivo: na v1.0.4, cada correção de achado baixo em teste gerou outro achado baixo em teste (RD-0132 a RD-0137).
  - Cada build leva o relatório do corretor junto com o roteiro do testes.
  - No fluxo de cada tarefa, o corretor fica ao lado do testes: implementação → testes + corretor → revisão do engenheiro → fechamento.
  - **Uma informação, um lugar** (dono do produto, R-20261110-093124, 10/11/2026): se uma seção da tela já mostra uma informação (o Histórico mostra a situação, os Totais mostram o %, os Alertas mostram o problema), essa informação não aparece em outro lugar da mesma tela. Nenhum aviso fica solto fora da área "Alertas" (RN-VEN-42). Vale para todas as telas e todas as entregas, inclusive as já liberadas.
  - **Só o que o usuário usa para agir** (dono do produto, R-20261110-192153, 10/11/2026): a pergunta para todo texto é "o usuário precisa disso para decidir ou agir agora?". Se não precisa, o texto sai, mesmo certo e sem repetição. Exemplos: o que o sistema faz por trás ("vai junto", "o app guarda…", "a equipe vê…"), explicação de funcionamento e texto de garantia.
  - **Imagem para aprovação** vai ao dono do produto pelos anexos do repositório de recados (`recados/anexos/`), junto com o recado e já com o parecer do corretor (R-20261110-085951).
- **Quem revisa o quê** (R-20261103-161508): visual, hierarquia, textos e "3 toques" → **designer-ux**; offline, navegação, desempenho e bundle → **engenheiro-apps**; arquitetura, contratos, API, segurança e fronteiras → **engenheiro-software**, que continua o revisor final antes do fechamento. Tarefa com tela passa pelas três revisões.
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

## Frentes de trabalho: time 100% na nuvem
> Decisão do Alexandre, chat de 14/11/2026: "Migre tudo para a nuvem." Vale desde o build Oficial v1.0.7. Substitui a divisão local × nuvem de 2026-10-31. Base técnica (guardião na nuvem e economia do Actions): **ADR do time na nuvem (proposto)**, do engenheiro-software.

**1. Uma frente só: a nuvem**
- **Todo o time roda em sessões do claude.ai/code** sobre o GitHub `aloirr/macuxifdv` (Linux, bash). O PC do Alexandre (VS Code, Windows, `C:\macuxifdv`) não roda mais agentes, commits nem pushes.
- Cada sessão trabalha num branch `nuvem/*`, `alexandre/*` ou `agente/*` e entrega **por PR**; o merge acontece depois do CI do PR verde (regra de "Quem faz o merge", abaixo).
- **Sem Docker** (decisão do Alexandre, R-20261105-053835): nenhum agente roda `docker`. Os testes de banco rodam na sessão, com Postgres local (seção 3, "Testes na sessão e CI do PR enxuto").
- **Horário de Manaus** (R-20261114-195100-alexandre): horários em texto para pessoas (recados, docs, relatórios) no fuso de Manaus (UTC−4); carimbos técnicos e banco em UTC.
- **Fase M** (`C:\Users\domon\dev\forca-vendas`, no PC do Alexandre): continua **só para consulta e cópia**, nunca alterada. Como a nuvem não alcança o PC, o que for preciso dela o Alexandre anexa à tarefa ou ao recado.
- **Aparelho Android**: o build sai pelo `android-build.yml` (seção 5); o teste no aparelho continua com o Alexandre.

**2. Trava de arquivos entre sessões**
- O quadro mantém a coluna **Onde** (agora a sessão: `nuvem/<branch>`) e a seção **Travado pela nuvem** com os caminhos de cada sessão aberta.
- Duas sessões nunca alteram o mesmo caminho ao mesmo tempo. Quando o PR de uma sessão entra no `main`, o gerente **destrava** os caminhos dela.

**Escrita da nuvem**: a sessão da nuvem só altera os caminhos travados da tarefa e cria recados novos. Não edita `.coord/quadro.md`, `.coord/tarefas/`, `docs/backlog.md` nem `docs/produto/`; isso é do gerente-projetos, quando o merge chega. Commits da nuvem levam o trailer `Agente: <dono do caminho>` (convenção no R-20261031-093259-2-alexandre).

**Commit e PR por dono (verificar --base no PR, --por-commit no `main`)**: cada commit leva o trailer `Agente:` de UM agente e só arquivos dele — inclusive o próprio `.coord/diario/<agente>.md`. Na nuvem, cada PR é de um dono só (seção 3); nunca juntar arquivos de agentes diferentes num commit nem num PR. Recados e lidos ficam no repositório de recados, fora dos commits de código.

**Nome do branch da nuvem** (R-20261101-184624): a sessão da nuvem usa sempre `nuvem/T-nnnn-<assunto>`, mesmo que o ambiente indique outro branch (`claude/...`).

**Numeração de tarefa**: antes de abrir uma tarefa, o gerente lê a própria caixa, porque o Alexandre pode ter reservado números para a nuvem, e confere o maior T-nnnn em `.coord/tarefas/` e no `git log` do `main`. Números reservados pelo Alexandre não são usados para outra coisa.

**Vaga de correção do teste de campo** (Alexandre, 2026-11-02, R-20261102-115114)
- Das vagas de sessão (hoje 7, todas na nuvem), **1 fica sempre reservada para correções do teste de campo**: bugs e ajustes em entrega já feita, reportados em recados `de: alexandre` com "Teste de campo" no contexto ou "Bug —" no título. As outras 2 seguem as sprints. Sem correção na fila, a vaga volta para a sprint até chegar a próxima.
- Correção do teste de campo passa na frente de qualquer tarefa nova na fila dessa vaga. Ela usa o agente dono do arquivo (engenheiro-apps, modulo-vendedor, modulo-gestor…). Se o módulo estiver travado pela nuvem, o pedido vai à sessão da nuvem pelo recado do dono, ou espera o merge, sem quebrar a trava.
- Cada correção entra no próximo build de preview. A entrega responde (`--responde-a`) ao recado do teste que ela fecha, para o Alexandre reconferir no aparelho.

**Quem faz o merge** (R-20261101-203953; guardião v5, T-0044):
- **PR comum** (não toca caminho de governança), com o CI do PR e o do `main` verdes: a **própria sessão da nuvem** faz o merge (squash, `--subject` sem a marca, trailer do dono). Se o main estiver vermelho, ela marca "[PRONTO PARA MERGE]" e para; o gerente faz o merge pela regra A quando o main voltar a ficar verde.
- **Na prática (Alexandre, 2026-11-02, R-20261102-110832)**: as sessões da nuvem **não** conseguem fazer o merge, porque as ferramentas do GitHub ficam com um subagente e o guardião v6 barra merge de subagente (comportamento correto). Por isso, a cada rodada o gerente varre os PRs prontos (`gh pr list -R aloirr/macuxifdv --search "PRONTO PARA MERGE in:title"`) e faz o merge pela regra A (update-branch, espera o CI verde, `--match-head-commit <head novo>`, `--subject` sem a marca, trailer do dono), sem esperar recado do Alexandre. PR que colide com outro (mesmo consumidor, mesmo arquivo) espera a sessão unificar.
- **PR de governança**: nunca a sessão. Vale sempre o rito com a autorização (abaixo).
- O guardião (v5, T-0044; ampliado no v6, T-0050) controla o `gh pr merge` rodado pelo Claude Code local e, desde o v6, também o merge pelo MCP do GitHub (só squash, com SHA, com os dois CIs verdes; governança nunca pela nuvem). O v6 acha o `gh` em `C:\Program Files\GitHub CLI` e aceita `--subject`. Ele passa apenas na sessão principal do gerente, com o comando exato (`-R aloirr/macuxifdv`, `--squash`, `--match-head-commit <sha>`, sem `--admin`/`--auto`) e o head conferido no GitHub. Se o `gh` não responder, o merge fica bloqueado (falha fechada). Na nuvem, o gerente só passa com `MACUXI_AGENTE=gerente-projetos`.
- PR de governança exige um recado com a frase "autorizo o merge do PR #N no commit <sha completo>", com o mesmo N e SHA, e o squash cita esse recado.
  - **Desde 21/11/2026 (R-20261121-214800-alexandre)** quem dá a frase é o Agente PO, em nome do Alexandre, num recado próprio que cita essa delegação. Antes, ele confere: o head é o SHA informado, o CI do PR está verde nesse SHA, o corretor está LIBERADO nesse SHA, o engenheiro não deu 🔴 e a marca validou, quando há cor ou layout. Faltando qualquer um, o caso vai ao Alexandre.
  - O deploy não muda: continua só com "aprovo deploy vX.Y.Z" do Alexandre.
- Depois que a T-0049 entrar, o CI do main fica vermelho se um commit mexer em governança sem `Agente: alexandre`.

**Lotes por PR, um por dono** (14/11/2026, time 100% na nuvem): cada dono abre **um PR por lote**, com um commit só e o trailer `Agente: <dono>`; as quatro condições abaixo continuam valendo, agora conferidas no PR antes do merge (CI do PR verde no head que vai entrar, `verificar --base origin/main` e `brechas-governanca` OK, revisões sem 🔴). O texto a seguir, dos lotes locais, fica como histórico.

**Lotes locais direto ao `main`, sem PR** (decisão do Alexandre, 04/11/2026, para os lotes do APK; **substituído** pelos lotes por PR acima desde 14/11/2026): o gerente monta um branch `verificacao/<tarefas>-lote` em cima do `main`, com um commit por dono e o trailer `Agente: <dono>`. Esse branch só sobe com as quatro condições:
1. CI completo (`workflow_dispatch`) verde **exatamente no commit que vai subir**;
2. push **fast-forward**, sem force e sem rebase de commit já enviado;
3. `node scripts/coord.mjs verificar --por-commit origin/main..<commit>` OK em todos os commits **e** `node scripts/ci/brechas-governanca.mjs trailer origin/main..<commit>` OK. Commit que toca caminho de governança leva `Agente: alexandre` no **último bloco** da mensagem, na mesma linha seguida do `Co-Authored-By`, sem linha em branco entre os dois. O 108e18a de 05/11 saiu com os dois em blocos separados e deixou o CI do `main` vermelho (R-20261105-124257);
4. revisão do engenheiro-software sem 🔴 e do designer-ux sem 🔴 nas telas.

Se alguma falhar, o lote não sobe e o gerente avisa o Alexandre. Os PRs da nuvem continuam pela regra A, e a governança, pelo rito de autorização acima. O gerente manda um status com os hashes a cada lote que sobe.

**Deploy de produção só com "aprovo deploy vX.Y.Z"** (dono do produto, R-20261111-213829, opção 2): nenhuma tag `v*` de produção e nenhum run do "producao — publicar" sem um recado do Alexandre com "aprovo deploy vX.Y.Z" para aquela versão exata. O gerente cita o ID desse recado na mensagem da tag. O GitHub Pro não tem "Required reviewers" em repositório privado, e os agentes usam a mesma conta (aloirr), por isso a trava é por recado. A opção 1 (conta própria dos agentes, com regra de tag em que só a aloirr cria `v*`) está anotada para antes do 1º cliente pagante e ainda não foi autorizada.

**Nenhum ensaio sem lint e typecheck limpos na sessão** (regra fixa do dono do produto, R-20261111-155339, nascida "no PC"; a v1.0.4 precisou de 5 ensaios, e 3 caíram por erros que dava para pegar antes do push):
- o dono de cada pacote tocado no lote roda na própria sessão da nuvem o lint e o typecheck do pacote, com o mesmo script do CI (`pnpm --filter <pacote> typecheck` e `lint`), e diz o resultado na entrega;
- quando `tests/` mudou, também o `typecheck:tests` (`tsc --noEmit -p tests/tsconfig.json`);
- quem muda um tipo público (contrato, `domain`) procura com grep, antes de entregar, os usos em `tests/` e nos outros pacotes;
- o gerente confere as entregas e só então dispara o ensaio no GitHub;
- o retrato do ensaio pega os caminhos de governança (`.github/**`, `.claude/**`, `scripts/coord*`, `.coord/donos.json`) do `main`; mudança neles só entra pelo rito.

**Merge pelo gerente de PR pronto que não é de governança** (decisão do Alexandre, R-20261101-165024): vale para PR da nuvem marcado "[PRONTO PARA MERGE]" que não toca `.claude/**`, `.coord/donos.json`, `scripts/coord*.mjs` nem `.github/**`. Com o CI do `main` verde, o gerente confere três coisas:
- o CI do PR está verde (com o main já mesclado no branch, se o GitHub exigir);
- o head SHA é o do momento da marcação;
- `node scripts/coord.mjs verificar --base origin/main` do branch passa.

Com tudo conferido, executa `gh pr merge N -R aloirr/macuxifdv --squash --match-head-commit <sha> --body "Agente: <dono da tarefa>"`, sem pedir autorização. Se o branch estiver desatualizado, o gerente mescla o main nele, espera o CI do PR ficar verde e só então faz o merge, sem mexer em código. Depois do merge: `git pull`, quadro, diário e um recado curto ao Alexandre com o commit do squash.

**Rotina de push (custo do CI)** (R-20261101-165024; ajustada para a nuvem em 14/11/2026): o push acontece ao fechar a entrega do PR, e não a cada rodada. Lint, typecheck e testes rodam na sessão antes, como sempre. A exceção é a correção de main vermelho, que sobe na hora.

**Economia do Actions** (14/11/2026; ADR do time na nuvem, proposto):
- **um commit por PR** e **um push só**: os ajustes antes do push entram com `git commit --amend` local, nunca em commits extras;
- **um rerun só**, e apenas para falha de infraestrutura (rede, runner, serviço externo fora). Falha de código, lint ou teste não ganha rerun: volta ao dono, que corrige e manda o novo push;
- o commit vazio de início de sessão (abaixo) não é enviado sozinho: a entrega entra nele por `git commit --amend`, e o PR sai com um commit só.

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

**GitHub CLI (`gh`)**: o gerente-projetos acompanha CI e PRs pelo `gh` (`gh auth status`, `gh run list --limit 5`, `gh run view <id> --log-failed`, `gh pr list`), em vez de pedir ao Alexandre para abrir o navegador. O `gh pr merge` segue as regras de "Quem faz o merge" acima e passa pelo guardião (v6 desde 02/11). Sem pedido do Alexandre, o `gh` **não** é usado para fechar PR, apagar branch ou mudar configuração do repositório.

**3. Git só por PR** (time 100% na nuvem, 14/11/2026; substitui o "git automático" com commit no `main` pelo gerente no fim da rodada)
- **Cada sessão** parte do `main` atual (`git fetch origin main` + branch novo), trabalha só nos caminhos do dono, roda lint, typecheck e testes dos pacotes tocados e faz **um commit** (`T-nnnn: <resumo>` + trailer `Agente: <dono>`) e **um push** para o próprio branch. Abre o PR `[PRONTO PARA MERGE] ...` com a entrega.
- **Um PR por dono e por lote**: nunca juntar arquivos de donos diferentes no mesmo PR. Recados e lidos ficam no repositório de recados, fora do PR.
- **Merge**: depois do CI do PR verde, com o `main` verde, pela regra de "Quem faz o merge" (acima). Ninguém faz commit nem push direto no `main`.
- **Gerente = sessão fixa com rondas agendadas** a cada 15–20 min: lê as caixas e cobra recados não lidos, varre os PRs `[PRONTO PARA MERGE]` e o CI, faz os merges pela regra A, atualiza quadro e diário, destrava caminhos e abre as próximas sessões para manter as 7 vagas ocupadas.
- **Vermelho no PR**: sem merge; o dono corrige no mesmo branch (um commit novo só se o PR já foi enviado; ver "Economia do Actions"). Rerun só para falha de infraestrutura, uma vez.
- **Conflito com o `main`**: o dono do branch mescla o `main` no próprio branch e resolve só arquivos dele; arquivo de outro dono → recado ao dono. O Alexandre é avisado por recado só se o conflito durar mais de uma ronda.
- **Testes na sessão e CI do PR enxuto** (Alexandre, R-20261115-213600; PR de governança #443): o dono sobe o Postgres local **sem Docker** (pacote do sistema, script único do banco-dados) e roda, antes do push, os `*.db.test.ts` dos pacotes afetados e os testes de `tests/` (comando único do testes); o resumo do resultado vai no corpo do PR. O CI do PR e do push ao `main` roda só escopo, governança, verificar (lint, fronteiras, typecheck) e o build do que mudou. A suíte completa com Postgres roda **uma vez por versão**, no job `suite` do `producao-liberar`, no SHA da versão; antes do disparo, ela roda também numa sessão, no mesmo SHA (R-20261120-130202); sem ela verde não há imagem nem issue de aprovação. O disparo manual é o CI com a entrada `sha` (Alexandre, R-20261120-073449; PR de governança #538). Se o CI do `main` ficar vermelho, nenhum merge sai até a correção. Build do Android só no fechamento da versão.
- **Ritmo da versão** (Alexandre, R-20261120-130202):
  1. PR sem o resumo dos testes da sessão no corpo (ver "Testes na sessão e CI do PR enxuto") não tem merge;
  2. o corretor-redundancias revisa numa rodada só, antes do push;
  3. job com mais de 2× o tempo normal é cancelado na hora e usa o rerun único;
  4. a previsão usa o tempo real de cada etapa mais 15% de folga e só muda por motivo novo, escrito.
- **Decisão nova no fechamento** (Alexandre, R-20261120-130552): vai ao Alexandre com o impacto em minutos e duas opções, antes de entrar.
- **pnpm sem binário nativo nas sessões da nuvem** (v1.0.19, PR #603): o "Exec format error" do turbo se corrige com `node scripts/ci/pnpm-nativo.mjs`, que o `postinstall` da raiz já chama.
- **Typecheck do CI com `--concurrency=2`** (R-20261120-155015, PR de governança #557): sem o limite, os `tsc` em paralelo estouram a memória do runner e travam.
- **Proibido**: force push, rebase do `main`, push direto ao `main`, merge com CI vermelho, apagar histórico.
- **Permissão de push**: a regra do `.claude/settings.json` permite push para `nuvem/*`, `alexandre/*` e `agente/*` (e `main`, que deixa de ser usado) e nega force e delete.
- **Governança** (`.claude/**`, `.coord/donos.json`, `scripts/coord*.mjs`, `.github/**`): PR próprio com `Agente: alexandre`, merge só pelo rito de autorização (acima).

**4. Esteira permanente** (dono do produto, R-20261107-164646, vale até ele mandar parar)
- Tudo o que o dono do produto pede, e tudo o que é necessário para entregar o que ele pediu, **entra na esteira e segue em execução**. Não se espera fase, piloto nem build.
- **Backlog só com autorização escrita dele**: num recado, ou numa mensagem no chat com a palavra "backlog". Item adiado sem essa autorização vira tarefa com dono e ordem.
- **Nenhum agente ocioso**: as **7 vagas** (dono do produto, 07/11 22h35; antes 8, 6 e 4) são **7 sessões da nuvem** sempre ocupadas, cada uma em caminhos exclusivos que não colidem com os das outras. Quando uma sessão entrega, o gerente abre a próxima na mesma ronda e manda ao dono do produto o prompt de abertura, se a sessão precisar ser aberta por ele.
- **Gerente em sessão fixa**: as rondas agendadas (15–20 min) substituem as rodadas do PC; em cada ronda o gerente confere caixas, PRs prontos, CI do `main` e vagas livres.
- **Prioridade**: T-0093 → T-0094 → build único Campo-Demo-v1.0.0 / Gestao-Demo-v1.0.0 → o resto. O que não colide roda em paralelo.
- **Chat vira recado**: tudo o que o dono do produto disser no chat com o gerente é gravado como recado `aviso` para `todos`, com o texto literal.

**Recados no repositório próprio** (dono do produto, 08/11/2026 ~22h e 09/11/2026; ADR 0035 e ADR 0039, T-0139 e T-0143)
- **Fonte única:** o repositório privado `aloirr/macuxifdv-recados`, com `recados/<destino>/R-*.md` e `lidos/<agente>.txt`.
- **Direto no GitHub (T-0143, desde 09/11 ~19h30):** o `coord.mjs` grava `enviar` e `lido` com um commit pela API do GitHub (`createCommitOnBranch` com `expectedHeadOid`; em conflito relê e tenta de novo) e lê `caixa`, `pendencias`, `ler` e `fio` do `main` na hora, com cópia local por commit. "Enviado" só aparece com o commit confirmado; sem rede, nada é gravado e o comando avisa. Token: `MACUXI_RECADOS_TOKEN` (fine-grained, só Contents do repositório de recados; nas variáveis do ambiente da nuvem) ou o do `gh` logado; nunca em arquivo ou log. A guarda de merge lê a autorização sempre do GitHub.
- **Acabou:** junção `.coord/recados`/`.coord/lidos`, clone `C:\macuxifdv-recados` (arquivado em `C:\macuxifdv-recados-arquivo-20261109`), Agendador e hook de sincronização. Volta: `MACUXI_RECADOS=local` + clone + junções (ADR 0039) ou `git revert` do f25bbe88.
- **Na nuvem (pendência, 14/11/2026):** as sessões do claude.ai/code barram a GraphQL do GitHub (HTTP 403, "use the REST API"), e o `coord.mjs` grava e lê os recados por GraphQL; até o `coord.mjs` ganhar a rota REST (governança: Alexandre, com o engenheiro-software e o ADR do time na nuvem), a sessão que não alcança os recados registra o que enviaria no PR e no diário.
- **Conferência:** cada agente roda `node scripts/coord.mjs caixa <agente>` no início de cada tarefa. O gerente confere as caixas em toda ronda (15–20 min; no PC era a cada 5 min) e cobra recado não lido.
- **Dono do produto:** escreve pelo formulário de issue "Recado" ou pela ponte; toda rodada de recados dele termina com um aviso ao gerente para ler. Telegram (aviso, resumo e resposta) no **backlog sem data** (R-20261109-125750).
- **Código:** recados e lidos ficam fora dos commits do repositório de código (`/.coord/recados` e `/.coord/lidos` no `.gitignore`).
- **Status diário:** recado do gerente ao dono do produto às 18h, com o percentual de cada dia do cronograma (doc 05) e o risco para a entrega.

**5. Nome e versão dos builds** (dono do produto, R-20261107-151653)
- **Nome do build**, nos recados e no WhatsApp:
  - preview/demo: `Campo-Demo-vX.Y.Z` e `Gestao-Demo-vX.Y.Z`;
  - produção: `Campo-Oficial-vX.Y.Z` e `Gestao-Oficial-vX.Y.Z`.
- **Versão semântica no app**:
  - `version` do app.config e `versionCode` do Android sempre crescendo, para instalar por cima;
  - a demo começa em v1.0.0, e cada preview novo sobe o patch;
  - funcionalidade nova relevante sobe o minor, com o motivo no recado;
  - a produção começa em Oficial-v1.0.0, com numeração própria;
  - Campo e Gestão sobem juntos quando saem no mesmo lote.
- **Versão visível**: a versão aparece em Perfil → linha da versão, igual ao nome do build.
- **Assunto do recado**: `BUILD PRONTO Campo-Demo-vX.Y.Z / Gestao-Demo-vX.Y.Z (<sha curto>)`.
- **Onde sai o build** (sem conta da Expo desde 15/11/2026, R-20261115-091000-alexandre): pelo workflow `android-build.yml`, disparado a partir do `main` depois do merge do lote. Passo a passo: `apps/mobile/docs/build-android.md`.
- **Deploy**: só pelos workflows de produção (`producao-publicar.yml` "producao — publicar" e, quando preciso, `producao-tenant.yml`, `producao-super-admin.yml` e `producao-ensaio-restauracao.yml`), com a tag `v*` e o recado "aprovo deploy vX.Y.Z" do Alexandre citado na mensagem da tag. A demo foi desligada em 14/11/2026 (ADR 0051).

## Contratos entre módulos
`.coord/contratos/` (dono: engenheiro-software) registra eventos, extensões e dependências. O módulo publicador é dono do schema do evento em `modules/<m>/contracts`; mudança incompatível = nova versão + recado a todos os consumidores.

## Modos de execução no Claude Code
- **A — Subagentes (padrão, estável)**: o `gerente-projetos` é a sessão principal (`"agent": "gerente-projetos"` no `.claude/settings.json`) e delega com a ferramenta Agent; os agentes conversam por recados.
- **B — Equipe de agentes (experimental)**: com `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, o gerente vira líder e cria colegas a partir das mesmas definições; eles trocam mensagens ao vivo (`SendMessage`). Regra: **toda decisão ou pedido trocado ao vivo também vira recado** em `.coord/` (é a memória oficial e versionada). Limitações conhecidas: uma equipe por sessão, sem retomar colegas, modo de painéis divididos não funciona no terminal do VS Code (use o modo padrão).

## Custos
Gerente, engenheiro, banco e testes usam o modelo mais forte (`opus`); agentes de módulo usam `sonnet`. Para economizar, troque testes para `sonnet` ou rode no máximo 3 agentes de módulo em paralelo.

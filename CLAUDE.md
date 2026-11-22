# Macuxi FDV — guia do repositório para o Claude Code

Plataforma SaaS de força de vendas **modular**: app Android **Macuxi Campo** (vendedor/promotor), app Android **Macuxi Gestão** (supervisor/gerente), **Backoffice Web** e **Hub de Integração** com o ERP, sobre PostgreSQL em nuvem.
Tudo em **português do Brasil** (respostas, recados, commits, docs). Código segue o padrão já existente.

## Documentos de referência
`docs/produto/` — 01 visão e escopo · 02 módulos e requisitos (RF) · 03 regras e permissões (RN) · 04 arquitetura e dados · 05 roadmap · 06 integração ERP · 07 agentes e coordenação. Decisões: `docs/decisoes/` (ADR). Status: `docs/status/`.

## Estrutura
```
apps/mobile (shell Expo: variantes campo|gestao) · apps/web (shell BKO) · apps/api (Fastify, monólito modular)
apps/conector (Conector on-premise)
modules/<core|catalogo|vendedor|promotor|gestor|pesquisa|treinamento|integracao>/{manifest.ts,domain,contracts,api,app,web,db}
packages/{platform-sdk,ui,config} · db/ (migrações, RLS, seeds, views do Conector) · tests/ · .coord/ (time de agentes)
```

## Comandos
`pnpm install` · `pnpm dev` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm --filter <pacote> test`
Repositório: `aloirr/macuxifdv` no GitHub. **Time 100% na nuvem** (dono do produto, chat de 14/11/2026, depois do build Oficial v1.0.7; ADR do time na nuvem, proposto): todo o time roda em sessões do claude.ai/code (Linux, bash), com PR e CI no GitHub; o PC (VS Code) não roda mais o time. A Fase M (mockup com Excel) fica no PC do dono do produto (`C:\Users\domon\dev\forca-vendas`) — só consulta e cópia, nunca alterar; o que for preciso dela o dono do produto anexa à tarefa.
**Sem Docker** (R-20261105-053835): nenhum agente roda `docker`. **Testes de banco na sessão** (R-20261115-213600-alexandre): as sessões da nuvem sobem Postgres local sem Docker e rodam os `*.db.test.ts` e `tests/` antes do push; o CI do PR e do push ao `main` fica só com governança, verificar e build, e a suíte completa roda uma vez por versão, no `producao-liberar`, no SHA da versão (R-20261120-073449-alexandre). Regra completa no doc 07, seção 3. A demo foi desligada em 14/11/2026 (ADR 0051).
**Horário de Manaus** (R-20261114-195100-alexandre): horários em texto para pessoas (recados, docs, relatórios) no fuso de Manaus (UTC−4); carimbos técnicos e banco em UTC.
Coordenação: `node scripts/coord.mjs` (caixa, enviar, pendencias, dono, verificar).

## Regras inegociáveis
1. **Fronteiras**: módulo importa só `packages/*`, `modules/core/contracts` e `modules/<outro>/contracts`; nunca lê tabela de outro schema.
2. Regra de negócio no `domain` do módulo, função pura, teste antes, citando `RN-...`. A API sempre revalida.
3. Tipos só de `contracts` (Zod). Eventos `<modulo>.<entidade>.<fato>@vN`; mudança incompatível = nova versão + ADR.
4. Dinheiro em centavos; datas UTC (exibição no fuso do tenant); UUID gerado no aparelho; escrita idempotente.
5. Toda tabela: `id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`; RLS ligado.
6. Offline-first no app; toda rota checa perfil, escopo de carteira e **licença do módulo**.
7. Promotor (trade marketing: gôndola, share, preço, ruptura, validade) nunca cria/edita/exclui pedido (UI e API).
8. Segredos só em `.env`; sem dado pessoal em log; commit, push e PR só pelo fluxo de PR abaixo (um PR por dono e por lote).

## Time de agentes
A sessão principal roda como **`gerente-projetos`** (definido em `.claude/settings.json`), que comanda: `engenheiro-software` (plataforma: API, SDK, contratos, CI, ADRs, revisão final), `engenheiro-apps` (shells mobile/web, transições do shell, build Android, revisão técnica das telas), `designer-ux` (`packages/ui`, `docs/design/`, visual, textos e revisão de UX das telas), `banco-dados`, `testes`, `corretor-redundancias` (excessos, duplicidades e redundâncias; toda tarefa passa por ele; defeito funcional é do `testes`), `design-de-marca` (guardião da marca, `docs/marca/`; T-0169) e os agentes `modulo-core`, `modulo-catalogo`, `modulo-vendedor`, `modulo-promotor`, `modulo-gestor`, `modulo-pesquisa`, `modulo-treinamento`, `modulo-integracao`.
**Cada agente altera só os próprios caminhos (`.coord/donos.json`) e fala com os outros por recados** (`.coord/recados/`, skill `protocolo-recados`). O guardião (`.claude/hooks/guarda-donos.mjs`) bloqueia o resto. Para trabalhar sem o guardião (uso manual): variável `MACUXI_GUARDA=off`.
Skills: `/status`, `/feature <RF ou descrição>`, `/entrega`.
**Esteira permanente** (R-20261107-164646, até o Alexandre mandar parar): tudo o que ele pede, e tudo o que é preciso para entregar, entra na esteira e segue em execução. **Backlog só com a autorização escrita dele**, num recado ou no chat com a palavra "backlog". **Nenhum agente ocioso**: as **7 vagas** (dono do produto, 07/11 22h35; antes 8, 6 e 4) são **7 sessões da nuvem** sempre ocupadas, cada uma em caminhos exclusivos que não colidem com os das outras. Prioridade: T-0093 → T-0094 → build único Campo-Demo-v1.0.0 / Gestao-Demo-v1.0.0 → o resto. Os detalhes estão no doc 07, seções 4 e 5; a 5 traz o nome e a versão dos builds.
**Recados no repositório próprio** (dono do produto, 08/11/2026 ~22h e 09/11/2026; ADR 0035 e ADR 0039, T-0139 e T-0143): o repositório `aloirr/macuxifdv-recados` é a fonte única dos recados. Todo recado vai para lá:
- **Direto no GitHub:** `node scripts/coord.mjs` grava (`enviar`, `lido`) e lê (`caixa`, `pendencias`, `ler`, `fio`) direto no repositório de recados, pela API do GitHub (token do `gh` ou `MACUXI_RECADOS_TOKEN`). Não há recado local, junção, clone nem Agendador. "Enviado" só aparece com o commit confirmado; sem rede, o recado não é gravado e o comando avisa.
- **Dono do produto:** escreve pelo formulário de issue ou pela ponte. O Telegram está no backlog (R-20261109-125750).
- **Leitura:** cada agente confere a própria caixa no início de cada tarefa; o gerente confere as caixas em toda ronda (sessão fixa, a cada 15–20 min; no PC era a cada 5 min) e cobra os recados não lidos.
- **Commits:** recados e lidos não entram mais nos commits do repositório de código.

**Chat do dono do produto vira recado** (pedido do Alexandre, 07/11/2026): tudo o que ele disser no chat com o gerente-projetos é gravado pelo gerente como recado `aviso` para `todos`, com o texto literal, a data e a hora, e o que foi feito a partir dele. Assim os agentes, as sessões da nuvem e o Projeto do Claude leem as mesmas decisões. Um recado por mensagem com decisão, ou um por bloco quando vierem seguidas.

## Nuvem, PR e git
Toda tarefa roda numa **sessão da nuvem** (claude.ai/code), num branch `nuvem/*`, `alexandre/*` ou `agente/*`. Não há mais frente local: a coluna **Onde** do quadro e o "Travado pela nuvem" passam a registrar a sessão e os caminhos de cada tarefa, e duas sessões nunca alteram o mesmo caminho. O **gerente-projetos é uma sessão fixa** com rondas agendadas a cada 15–20 min (caixas, PRs prontos, CI, quadro).
- **Só por PR**: nada vai direto ao `main` (acabou o "commit no `main` pelo gerente no fim da rodada"). **Um PR por dono e por lote**, com o trailer `Agente: <dono>` em todo commit e o título `[PRONTO PARA MERGE] ...` quando estiver pronto. O merge (squash) acontece **depois do CI do PR verde**, com o `main` verde, pela regra de "Quem faz o merge" do doc 07; PR de governança só com a frase de autorização (número e SHA), dada pelo Agente PO em nome do dono do produto (R-20261121-214800-alexandre).
- **Economia do Actions**: lint, typecheck e testes rodam na sessão antes do push; **um commit por PR** e um push só; **um rerun só**, e apenas para falha de infraestrutura (rede, runner, serviço fora). Falha de código volta ao dono para corrigir.
- **Build** do APK pelo workflow `android-build.yml`, sem conta da Expo (`apps/mobile/docs/build-android.md`); **deploy** pelos workflows de produção (`producao-publicar.yml` e afins), só com "aprovo deploy vX.Y.Z" do dono do produto.
- **Proibido**: force push, rebase do `main`, push direto ao `main`, merge com CI vermelho, apagar histórico. Detalhes: `docs/produto/07-agentes-e-coordenacao.md`, seções 3 a 5.

## Definição de pronto
- Lint, typecheck e testes verdes.
- **Nenhum ensaio sem lint e typecheck limpos na sessão** (a regra nasceu "no PC") em todos os pacotes tocados, com o mesmo script do CI, inclusive `typecheck:tests` quando `tests/` mudou (regra fixa do dono do produto, R-20261111-155339). O dono roda e diz na entrega; o gerente confere antes de disparar o ensaio. Os detalhes estão no doc 07.
- Critérios da tarefa demonstrados pelo testes, que também confere valor × regra em todo indicador.
- **Parecer do corretor-redundancias sem nenhum achado em aberto, de qualquer gravidade** (regra permanente do dono do produto, R-20261110-062506):
  - toda entrega que muda tela, texto, relatório ou regra, de qualquer agente (Campo, Gestão, BKO), passa por ele **antes do lote e antes do build**, como passa pelo testes;
  - o parecer olha o print do aparelho: repetição, caixa repetindo uma linha, texto além do problema e da ação, rótulo e número que não batem;
  - **uma informação, um lugar:** o que uma seção da tela já mostra não aparece em outro lugar da mesma tela, e nenhum aviso fica fora da área "Alertas" (R-20261110-093124, RN-VEN-42);
  - **só o que o usuário usa para agir:** texto que ele não usa para decidir ou agir agora também é excesso e sai, mesmo certo e sem repetição. Exemplos: o que o sistema faz por trás ("vai junto", "o app guarda…", "a equipe vê…"), explicação de funcionamento e texto de garantia (R-20261110-192153);
  - cada build leva o relatório do corretor junto com o roteiro do testes;
  - **exceção:** achado de gravidade baixa que esteja **só em comentário ou título de teste** não segura o lote e entra no lote seguinte (dono do produto, R-20261111-190159). Achado em código de produção, tela, texto, PDF, relatório, regra ou doc continua segurando.
- **Validação do design-de-marca** em toda mudança de cor ou layout, em qualquer superfície (Campo, Gestão, BKO, portal, PDFs, e-mails e site), antes do lote e do build. Só o dono do produto aprova a marca (R-20261112-065914).
- Revisão do engenheiro sem 🔴.
- `node scripts/coord.mjs verificar` sem violações.
- Quadro, backlog e docs atualizados.

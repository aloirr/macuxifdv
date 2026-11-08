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
Repositório: `C:\macuxifdv`. A Fase M (mockup com Excel) fica em `C:\Users\domon\dev\forca-vendas` — só consulta e cópia, nunca alterar. Ambiente Windows/PowerShell.
**Sem Docker no PC do dono do produto** (R-20261105-053835): nenhum agente roda `docker` nem depende do Postgres local (5432/5434). Testes de banco (`*.db.test.ts`, integração) e o stack isolado rodam no CI do GitHub (branch de verificação, workflow `stack-isolado.yml`); o resultado do CI é o critério. A demo roda na Magalu (ADR 0020); o plano B é recriar a base na VM pelo workflow `demo-recriar-base`.
Coordenação: `node scripts/coord.mjs` (caixa, enviar, pendencias, dono, verificar).

## Regras inegociáveis
1. **Fronteiras**: módulo importa só `packages/*`, `modules/core/contracts` e `modules/<outro>/contracts`; nunca lê tabela de outro schema.
2. Regra de negócio no `domain` do módulo, função pura, teste antes, citando `RN-...`. A API sempre revalida.
3. Tipos só de `contracts` (Zod). Eventos `<modulo>.<entidade>.<fato>@vN`; mudança incompatível = nova versão + ADR.
4. Dinheiro em centavos; datas UTC (exibição no fuso do tenant); UUID gerado no aparelho; escrita idempotente.
5. Toda tabela: `id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`; RLS ligado.
6. Offline-first no app; toda rota checa perfil, escopo de carteira e **licença do módulo**.
7. Promotor (trade marketing: gôndola, share, preço, ruptura, validade) nunca cria/edita/exclui pedido (UI e API).
8. Segredos só em `.env`; sem dado pessoal em log; commit/push só pelo gerente-projetos, pela regra de rodada abaixo.

## Time de agentes
A sessão principal roda como **`gerente-projetos`** (definido em `.claude/settings.json`), que comanda: `engenheiro-software` (plataforma: API, SDK, contratos, CI, ADRs, revisão final), `engenheiro-apps` (shells mobile/web, transições do shell, EAS, revisão técnica das telas), `designer-ux` (`packages/ui`, `docs/design/`, visual, textos e revisão de UX das telas), `banco-dados`, `testes` e os agentes `modulo-core`, `modulo-catalogo`, `modulo-vendedor`, `modulo-promotor`, `modulo-gestor`, `modulo-pesquisa`, `modulo-treinamento`, `modulo-integracao`.
**Cada agente altera só os próprios caminhos (`.coord/donos.json`) e fala com os outros por recados** (`.coord/recados/`, skill `protocolo-recados`). O guardião (`.claude/hooks/guarda-donos.mjs`) bloqueia o resto. Para trabalhar sem o guardião (uso manual): variável `MACUXI_GUARDA=off`.
Skills: `/status`, `/feature <RF ou descrição>`, `/entrega`.
**Esteira permanente** (R-20261107-164646, até o Alexandre mandar parar): tudo o que ele pede, e tudo o que é preciso para entregar, entra na esteira e segue em execução. **Backlog só com a autorização escrita dele**, num recado ou no chat com a palavra "backlog". **Nenhum agente ocioso**: as 4 vagas locais ficam sempre ocupadas e, sem trabalho local que não colida, o gerente abre frentes na nuvem em caminhos exclusivos. Prioridade: T-0093 → T-0094 → build único Campo-Demo-v1.0.0 / Gestao-Demo-v1.0.0 → o resto. Os detalhes estão no doc 07, seções 4 e 5; a 5 traz o nome e a versão dos builds.
**Chat do dono do produto vira recado** (pedido do Alexandre, 07/11/2026): tudo o que ele disser no chat com o gerente-projetos é gravado pelo gerente como recado `aviso` para `todos`, com o texto literal, a data e a hora, e o que foi feito a partir dele. Assim os agentes, as sessões da nuvem e o Projeto do Claude leem as mesmas decisões. Um recado por mensagem com decisão, ou um por bloco quando vierem seguidas.

## Frentes local × nuvem e git
Cada tarefa roda **local** (este VS Code) ou na **nuvem** (claude.ai/code, branch `nuvem/*`, `alexandre/*` ou `agente/*`, merge automático no `main` com testes verdes), nunca nas duas: veja a coluna **Onde** do quadro. Caminhos em **Travado pela nuvem** (`.coord/quadro.md`) não são alterados por agentes locais. Git só pelo gerente-projetos, sem pedir confirmação: **início da rodada** `git pull --no-rebase origin main` (+ `pnpm install` se veio commit da nuvem); **fim da rodada**, com lint/typecheck/test da raiz verdes, commit no `main` (`T-nnnn: <resumo>` + trailer `Agente: <nome>`) → pull → checks de novo → `git push origin main` só se verde. Vermelho ou conflito em arquivo de outro dono: o dono corrige antes do push. Proibido: force push, rebase do `main`, push vermelho, apagar histórico. Detalhes: `docs/produto/07-agentes-e-coordenacao.md`.

## Definição de pronto
Lint + typecheck + testes verdes · critérios da tarefa demonstrados · revisão do engenheiro sem 🔴 · `node scripts/coord.mjs verificar` sem violações · quadro, backlog e docs atualizados.

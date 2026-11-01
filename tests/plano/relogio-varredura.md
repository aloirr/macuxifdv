# Varredura de relógio nos testes (2026-11-01)

Pedido: R-20261101-160851-alexandre, item 4 (terceira vez que o `main` fica vermelho por hora fixa: db às 14h,
`db/testes/sprint1.test.ts` e `modules/vendedor/api/pedido.db.test.ts` às 16:00Z). Agente: `testes`.

## Como foi feita

1. **Estática**: 348 arquivos de teste (`*.test.ts`, `*.spec.ts`, `tests/**`, `apps/*/test/**`, `db/testes/**`,
   `db/seeds/fixtures/**`). Cruzamento de datas literais `20xx-…` com relógio real (`Date.now()`, `new Date()`,
   `now()`, `current_date`), leitura de todos os testes com Postgres (71 arquivos) e do código de produção que eles
   exercitam (`ctx.agora`, janelas `ate`/`desde`, `current_date` nas janelas do pull).
2. **Empírica (sem banco)**: as suítes Vitest de 17 pacotes + `tests/` rodaram com o relógio do Node deslocado
   (preload `tests/scripts/relogio-deslocado.cjs`, runner `tests/scripts/varrer-relogio.mjs`) para instantes
   críticos, comparando com a execução sem deslocamento. Postgres fica fora: o `now()` do banco não é deslocável
   por esse meio (ver "Prevenção", item 3).

Fuso das máquinas: o notebook do Alexandre roda em UTC−4 (Manaus); o CI roda em UTC (`TZ: UTC`); o Postgres de teste
roda em UTC (`db/docker-compose.yml`). A meia-noite de Manaus é 04:00Z: entre 00:00Z e 04:00Z a data UTC já é
"amanhã" para o tenant.

## Classes de risco

| Classe | O que é | Quando falha |
|---|---|---|
| R1 — duas linhas do tempo | `ctx.agora`/AGORA fixo grava colunas de domínio; o banco grava `created_at`/`updated_at` com `now()` real; o teste compara uma com a outra (janela `ate`, ordem) | a partir da hora em que o relógio real passa do AGORA (foi o caso 16:00Z) |
| R2 — virada do dia no fuso | "hoje" calculado com relógio real em um ponto e com outro instante (carga da fixture, UTC do banco) em outro; `now − N horas` que cruza a meia-noite de Manaus | 00:00Z–04:00Z (20:00–24:00 em Manaus) ou 04:00Z–07:00Z (00:00–03:00 em Manaus) |
| R3 — virada de mês/ano | chave ou período por mês calculado duas vezes | último dia do mês, perto da meia-noite UTC/Manaus |
| R4 — bomba datada | data fixa "no futuro" ou "fora da janela" que um dia vira passado/entra na janela | numa data marcada (2027-03-10, 2030, 2031…) |

## Achados por dono

Severidade: **alta** = já reprova em alguma hora do dia hoje; **média** = reprova em data marcada próxima ou em
execução que cruza a meia-noite; **baixa** = latente (reprova só se o teste ou o código mudar, ou daqui a anos).

### modulo-vendedor (1)

| # | Arquivo:linha | Classe | Risco | Correção sugerida | Sev. |
|---|---|---|---|---|---|
| V1 | `modules/vendedor/api/pedido.db.test.ts:32` (AGORA = 2026-11-01T15:00Z) e `:495` (janela `ate = Date.now() + 1 h`) | R1 | **Correção atual validada**: o pull agora usa o relógio real contra `updated_at = now()` e a janela de 90 dias (`p.created_at >= ate − 90 d`, `sync.ts:59`) também é real × real; nenhuma asserção cruza AGORA com `now()` (eventos ordenam por `ocorrido_em` = AGORA nos dois e desempatam por `created_at` real; o único filtro por data da lista é `from: '2999-01-01'`). **Risco residual**: o teste continua com duas linhas do tempo (recebido_em/ocorrido_em/decidido_em em 2026-11-01T15:00Z; created_at/updated_at no relógio real). Qualquer asserção nova que misture as duas (ex.: `recebido_em <= updated_at`, provedor de pull que use `ctx.agora()` como `ate`, janela de 90 dias contada do `ctx.agora`) volta a reprovar — no último caso a partir de 2027-01-30 (AGORA + 90 dias). | AGORA = relógio do banco lido no `beforeAll` (`select now()`), ou `new Date()` congelado no carregamento do arquivo; manter `ate = AGORA + 1 h`. Assim existe uma linha do tempo só. | baixa |

### modulo-core (6)

| # | Arquivo:linha | Classe | Risco | Correção sugerida | Sev. |
|---|---|---|---|---|---|
| C1 | `modules/core/api/visita.db.test.ts:28` (`hora(h) = now − h h`), `:197-198`, `:218-220` | R2 | Entre 04:00Z e 07:00Z (00:00–03:00 em Manaus) `hora(2)`/`hora(3)` caem no **dia anterior** do fuso: o cenário "outro cliente no mesmo dia" (RN-CORE-11, motivo `outro_cliente`, checkout no instante do novo check-in) vira "esquecida de ontem" (motivo `dia_virou`, checkout na virada do dia). As asserções de `resultado`/`fechada_por` passam nos dois casos, então o teste deixa de provar o que diz nessa janela; o caso das linhas 218-220 (checkout do usuário em `hora(2.5)` vencendo o automático) passa a exercitar outro caminho. | Relógio injetado: `ctx.agora = () => AGORA` com AGORA = meio-dia de Manaus de hoje (`instante(hojeNoFuso(fuso), '16:00')`) e `hora(h)` relativo a esse AGORA; a janela do pull continua `Date.now() + 60 s` (o `updated_at` é do banco). | média |
| C2 | `modules/core/api/visita.db.test.ts:24` (SEMANA 2030-03-04), `:337` (2030-06-03), `:401-418` (2030-03-05..07) | R4 | Contra a janela do pull `data >= current_date − 40` (`modules/core/api/sync.ts:107-125`): a partir de 2030-07-13 o teste "rota a mais de 30 dias à frente chega ao aparelho" reprova; a SEMANA entra na janela "normal" perto de 2030-03 e deixa de estar "fora das janelas do pull" como diz o comentário. | Datas relativas: `somarDias(hoje, 400)` ajustada para segunda-feira (helper no próprio teste ou no utilitário comum). | baixa |
| C3 | `modules/core/api/metas.db.test.ts:23` (PERIODO 2031-03), `:75-82` (2031-03-02/04) | R4 | Janela do pull `periodo >= mês atual − 1` / `data >= início do mês anterior` (`sync.ts:133-140`): em 2031-05 as linhas saem do pull e o `beforeAll` (que exige `metas.length > 0` do vendedor-1) muda de sentido. | Período relativo (`anoMes(hoje, +60)`). | baixa |
| C4 | `modules/core/api/metas.db.test.ts:149-151` (`agora = new Date()`, "mês atual da fixture") | R2/R3 | O período vem do relógio real; as metas/diários vêm da fixture carregada no global-setup. Se a execução cruza a virada de mês em Manaus (último dia, 04:00Z) ou se `MACUXI_AGORA` estiver definido, período ≠ mês da fixture. | Usar o instante da carga da fixture (depende de B3) para `agora` e `periodo`. | baixa |
| C5 | `modules/core/api/consumidores.db.test.ts:29` (agora 2030-03-01T12:00Z) | R1/R4 | Consumidor de push com relógio em 2030 contra `created_at`/`lida_em = now()` reais. Estável hoje; se o consumidor passar a filtrar por idade ou expiração em relação a `ctx.agora`, o resultado inverte em 2030-03-01. | AGORA relativo (`new Date()` congelado no arquivo). | baixa |
| C6 | **Produção** (fora de teste, aviso): `modules/core/web/lib/queries.ts:65` (`hojeIso` = data UTC), `modules/core/api/carteira.ts:11` e `rotas.ts:326` (vigência da carteira com `current_date` do banco, UTC), `modules/core/api/sync.ts:62-140` (janelas com `current_date` UTC) | R2 | Entre 20:00 e 24:00 de Manaus o "hoje" do BKO e da vigência é o dia seguinte: carteira com `fim = hoje` some às 20:00 de Manaus. Todo teste futuro que use `fim = hoje`/`inicio = hoje` reprova entre 00:00Z e 04:00Z. | "Hoje" no fuso do tenant (`hojeNoFuso`) passado como parâmetro em vez de `current_date`. | média |

Verificados sem risco: `carteira.db.test.ts` (janelas em dias com folga ≥ 10 dias), `notificacoes.db.test.ts`
(lidas em 2030 fixas, estáveis), `login-limite.db.test.ts`, `consultas.db.test.ts`, testes de `domain`/`app/lib`/`web/lib`
(relógio sempre injetado).

### banco-dados (4)

| # | Arquivo:linha | Classe | Risco | Correção sugerida | Sev. |
|---|---|---|---|---|---|
| B1 | `db/testes/seed-demo.test.ts:322` (`dia = '2027-03-10'`) × `:248` (`hojeCarga` = hoje real) | R4 | "Outro dia: só a rota do novo dia entra" espera +3 rotas; **em 2027-03-10 (Manaus)** o "outro dia" é o próprio dia da carga e entra +0 → reprova. | `const dia = somarDias(hojeCarga, 200)`. | média |
| B2 | `db/seeds/fixtures/dois-tenants.ts:773-900` (T-0032: instantes fixos em 2026-10-30; `expira` 2026-11-06 nas pendências decididas; `ultimo_sinal_em` 2026-10-30T12:00Z) | R1/R4 | `t0032.test.ts:345-351` normaliza para `now()` antes do expurgo (ok). Mas qualquer teste novo de integração (Hub, BKO de integração, T-0032+) que avalie "conector sem sinal há X min", "lote antigo", "pendência expirada" ou retenção sem normalizar depende da data real (o `ultimo_sinal_em` já tem 2 dias; o lote completo vira "> 12 meses" em 2027-10-30). | Instantes T-0032 relativos ao `agora` da carga (como o Sprint 1), mantendo 2099 só para o que deve ficar sempre válido. | média |
| B3 | `db/testes/global-setup.ts:54` + `db/testes/estado.ts` | R2 | A fixture é carregada com `agoraDosTestes()` (ou `MACUXI_AGORA`), mas esse instante **não chega aos testes**: módulos e `tests/` calculam "hoje" com o relógio real (`metas.db`, `visita.db`, `cliente360-offline`, `visitas-campo`). Divergem se a execução cruza 04:00Z ou com `MACUXI_AGORA` definido (o próprio `sprint1.test.ts` diz que "a suíte inteira aceita MACUXI_AGORA", mas só o db/ aceita). | Incluir `agora` (ISO da carga) no `EstadoBanco` (`project.provide`) e exportar `agoraDaFixture()`/`hojeDaFixture(fuso)` em `@macuxi/db/teste`. | média |
| B4 | `db/testes/sessao.test.ts:225` (`expira_em` 2026-11-30T12:00Z) | R4 | Hoje nada compara com `now()` (`sessaoPorHash` não filtra validade); a partir de 2026-11-30 a sessão do teste nasce vencida e qualquer passo novo de refresh reprova. | `new Date(Date.now() + 30 * 86_400_000)`. | baixa |

Verificados sem risco: `sprint1.test.ts` (já corrigido, R-20261101-014652), `t0032.test.ts` (expurgos relativos a
`now()`), `t0029.test.ts` (consulta em 2099), `migracoes.test.ts` (`hoje` fixo só em contagem),
`aparelho-sqlite.test.ts` (relógio injetado), `estatico.test.ts` (dados estáticos com `hoje` fixo), `worker.test.ts`.

### engenheiro-software (0 achados; prevenção)

`apps/api/test/*` usam relógio injetado (`sync.test.ts`, `consultas.banco`, `arquivos.banco`); o
`despachante.banco.test.ts` usa o relógio só para a espera em memória. `packages/*` com relógio sempre explícito nos
testes. `apps/mock-api` injeta NOW. Recebe o pedido de prevenção (abaixo).

### modulo-integracao (0 achados)

`apps/conector/test/*`: relógio falso (`RelogioFalso`, 2026-03-10T12:00Z). `reconciliacaoVencida` usa hora LOCAL do
processo (`apps/conector/src/reconciliacao.ts:7-19`, intencional: o Conector roda no fuso do cliente); o teste usa
`reconciliacaoHora: '00:00'` com 12:00Z, estável em qualquer fuso de UTC−11 a UTC+11. Atenção para testes futuros com
outra hora configurada: fixar `TZ` no teste ou injetar o fuso. `integracao.pg.test.ts`: datas fixas do passado e
`now()` depois (ordem sempre certa).

### testes (2, corrigidos nesta rodada)

| # | Arquivo:linha | Classe | Risco | Correção feita | Sev. |
|---|---|---|---|---|---|
| T1 | `tests/integracao/api/visitas-campo.test.ts:518` | R3 | chave da foto `…/core/<AAAA-MM do relógio>/…` calculada DEPOIS do envio: envio às 23:59:59Z do último dia do mês e asserção no mês seguinte → reprova | mês medido antes e depois do sync; aceita qualquer dos dois | média |
| T2 | `tests/integracao/api/cliente360-offline.test.ts:36,56` | R2 | "hoje" do relógio real × títulos "vencendo hoje" da fixture: execução que cruza 04:00Z ou `MACUXI_AGORA` | "hoje" lido da fixture (data da rota de hoje do vendedor-1) | baixa |

Verificados: `notificacoes.test.ts:240-243` (lida_em fixa no passado, estável), `demo-matriz`/`pedido-fatia`
(relógio real × base demo carregada no mesmo minuto; só a virada de dia durante a execução, aceito), `carga`.

## Validação do pedido.db.test.ts (item 4 do pedido)

Ver V1. A correção resolve o vermelho de 16:00Z: `ate` passou a usar `Date.now() + 1 h` contra `updated_at = now()`,
e nada mais no arquivo compara o AGORA fixo com o relógio do banco. Fica o risco **baixo** de reintroduzir o defeito
ao acrescentar asserção que misture as duas linhas do tempo; recado ao modulo-vendedor com a sugestão de uma linha do
tempo só.

## Prevenção (proposta; implementação do engenheiro-software)

1. **Utilitário de relógio de teste** (o engenheiro decide onde mora; sugestão `@macuxi/platform-sdk/testing` ou
   `@macuxi/db/teste` para o que precisa de banco):
   - `relogioDeTeste(base?)` → `{ agora(): Date, avancar(ms), iso() }`, base = `MACUXI_AGORA` ou o relógio real
     **congelado uma vez** no carregamento (uma linha do tempo por arquivo);
   - `meioDiaNoFuso(fuso, data?)` → instante seguro (12:00 local) para cenários "mesmo dia";
   - `relativo(base, { dias, horas, minutos })`, `somarDias`, `proximaSegunda(data)`;
   - `relogioDoBanco(cliente)` → `select now()` (para comparar com colunas gravadas por `now()`);
   - `janelaPull(cliente | 'real')` → `{ desde: null, ate: <now do banco + 1 min> }`;
   - `agoraDaFixture()`/`hojeDaFixture(fuso)` (depende de B3).
2. **Regra de lint** (`packages/config/eslint.mjs`, `no-restricted-syntax`), só em `*.db.test.ts`, `*.banco.test.ts`,
   `*.pg.test.ts`, `db/testes/**`, `tests/integracao/**`, `apps/api/test/**` (testes que tocam banco ou relógio
   real; `domain` puro fica de fora):
   - `NewExpression[callee.name='Date'] > Literal[value=/^20\d\d-/]` e `Date.parse('20…')` — "instante fixo em
     teste com banco: use relogioDeTeste()/relogioDoBanco()";
   - `CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString']` sobre
     `new Date()` sem argumento — "data UTC do relógio: use hojeNoFuso/hojeDaFixture";
   - exceções pontuais com `// eslint-disable-next-line no-restricted-syntax -- <motivo>` (ex.: instante histórico
     que nunca é comparado com o relógio).
3. **Job "relógio deslocado"** (CI, noturno ou manual): `node tests/scripts/varrer-relogio.mjs` (sem banco, 5
   instantes críticos) e, para o banco, a suíte com `MACUXI_AGORA` em 03:59Z e 04:01Z **mais** o Postgres com
   `faketime` (libfaketime no container) — este último é opcional; o essencial é a regra "nenhum teste compara
   instante fixo com `now()` do banco".
4. **Regra escrita** (doc 07 / CLAUDE.md, gerente): "teste com banco usa UMA linha do tempo: relógio do banco ou
   relógio injetado congelado; data literal só em `domain` puro ou em dado que nunca é comparado com o relógio".

### Demais donos (0 achados)

- **engenheiro-apps** (`apps/mobile/src/lib`, `apps/web/lib`, `packages/ui`): relógio sempre injetado; passou em todos
  os instantes deslocados.
- **modulo-catalogo**: `precos.db.test.ts` usa AGORA fixo de forma coerente (vigências relativas ao AGORA, `ate`
  2099, tabelas próprias do teste; não usa os preços da fixture). Domain sem relógio real.
- **modulo-gestor, modulo-pesquisa, modulo-promotor, modulo-treinamento**: só `domain`/`contracts` com relógio
  injetado; sem testes de banco.
- **alexandre** (`scripts/coord*.test.mjs`, `.claude/hooks/*.test.mjs`): datas só em texto de diário; o hook usa
  instantes relativos (`antes.inicio − 60 s`).

## Resultado da execução com relógio deslocado

Sem banco (os testes de Postgres pulam; o `now()` do banco não se desloca). Linha de base sem deslocamento:
3.799 testes, 3 falhas só em `apps/mock-api` (timeout por máquina carregada; não é relógio, `mock-api` injeta NOW).

| Alvo | Instante | Pacotes | Falhas novas |
|---|---|---|---|
| 23:59 em Manaus (dia seguinte em UTC) | 2026-11-02T03:59:30Z | 17 + `tests/` (3.788 testes) | 0 |
| futuro | 2031-07-15T15:00:00Z | 17 + `tests/` (3.788 testes) | 0 |
| madrugada em Manaus (01:30) | 2026-11-03T05:30:00Z | 17 + `tests/` (3.824 testes) | 0 |
| fim de mês (30/11 23:59 em Manaus) | 2026-12-01T03:59:30Z | core, vendedor, gestor, comum, web, mobile + `tests/` (1.555 testes) | 0 |
| virada do ano em UTC | 2027-01-01T00:30:00Z | core, vendedor, gestor, comum, web, mobile + `tests/` (1.555 testes) | 0 |

Conclusão: os testes SEM banco já são imunes à hora (relógio injetado em `domain`, `app/lib`, `web/lib`,
`packages/*`, Conector). Todo o risco está nos testes COM Postgres que misturam instante fixo, relógio do Node e
`now()`/`current_date` do banco — exatamente as três quebras do `main` e os achados acima. Por isso a prevenção
foca neles (regra de lint por caminho + utilitário com "relógio do banco").

Reproduzir: `node tests/scripts/varrer-relogio.mjs` (todos os alvos) ou
`node tests/scripts/varrer-relogio.mjs --alvo 2026-12-01T03:59:30Z --pacote modules/core`.

## Recados enviados

| Dono | Recado | Achados |
|---|---|---|
| modulo-vendedor | R-20261101-180011-testes | V1 (validação do pedido.db.test.ts + risco residual) |
| modulo-core | R-20261101-180012-testes | C1–C6 |
| banco-dados | R-20261101-180014-testes | B1–B4 |
| engenheiro-software | R-20261101-180016-testes | prevenção (utilitário, lint, job); resposta R-20261101-180628: `@macuxi/platform-sdk/testing` + parte de banco em `@macuxi/db/teste`, regra como warn, job no CI agendado da T-0033 — aguarda tarefa do gerente |

Correções do `testes` (T1, T2) verificadas com Postgres: `visitas-campo.test.ts` 13/13 e `cliente360-offline.test.ts`
8/8; lint e typecheck de `tests/` verdes.

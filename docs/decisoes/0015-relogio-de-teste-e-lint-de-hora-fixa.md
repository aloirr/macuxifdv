# ADR 0015 — Relógio de teste comum e lint de hora fixa

- **Status**: proposta (2026-11-01, PR da T-0043; vira aceita com o merge)
- **Data**: 2026-11-01
- **Tarefa**: T-0043 (pedido do Alexandre R-20261101-160851, item 4: "quero isso fechado de vez")
- **Autor**: engenheiro-software
- **Base**: varredura do `testes` (R-20261101-180016, R-20261101-182056; `tests/plano/relogio-varredura.md`), T-0042 (C6 e os 13
  achados), casos já corrigidos em `db/testes/sprint1.test.ts` e `modules/vendedor/api/pedido.db.test.ts`

## Contexto
O `main` ficou vermelho três vezes pelo mesmo motivo: um teste com **duas linhas do tempo** — um instante fixo
(`const AGORA = new Date('2026-11-01T15:00:00Z')`) e o relógio real (`Date.now()`, `new Date()`, `now()`/`current_date` do
Postgres). Passa num horário e reprova em outro (db às 14h, `sprint1.test.ts`, `pedido.db.test.ts` às 16:00Z). A variante
"hoje em UTC" (`new Date().toISOString().slice(0, 10)`) erra entre 20:00 e 24:00 de Manaus. Cada correção foi local; faltava um
utilitário comum e algo que avise antes do vermelho.

## Decisão
1. **Relógio em `@macuxi/comum/relogio`** (puro: sem Node, `pg` ou vitest; serve a teste de domain, API, banco e app):
   - `criarRelogio({ agora?, fuso? })` → relógio **congelado** e avançável: `agora()`, `ms()`, `iso()`, `avancar(ms | { dias,
     horas, minutos, segundos })`, `definir(instante)`, `relativo(duração)`, `hoje()`, `dia(n)`, `instante({ dias, hora })`.
     Base: `agora` dado → `MACUXI_AGORA` (mesma variável e semântica do `agoraDosTestes` de `@macuxi/db`) → relógio real lido uma
     vez. Fuso padrão `America/Manaus` (`DEFAULT_TZ` de `@macuxi/comum/fuso`).
   - Datas relativas no fuso do tenant: `instanteNoFuso(data, 'HH:MM', fuso)`, `meioDiaNoFuso`, `diaCivil(base, n, fuso)`,
     `somarDiasCivis`, `relativo`, `duracaoEmMs`.
   - `relogioDoBanco(cliente)` (`select now()`; tipo estrutural `ClienteComQuery`, sem importar `pg`) e `relogioReal()`.
   - **Onde mora**: a resposta R-20261101-180628 propunha `@macuxi/platform-sdk/testing`. Ficou em `@macuxi/comum` porque o
     fuso já mora lá, todos os módulos e shells já dependem dele, e o `db/` e o `tests/` podem usá-lo sem puxar o SDK. A forma
     `{ agora(): Date }` é a de `ctx.agora`: injete `agora: () => relogio.agora()` no contexto da rota.
2. **Regra `macuxi/hora-fixa-em-teste`** (`packages/config/regras/hora-fixa.mjs`, plugin local no `eslint.mjs`), só em
   arquivos de teste (`*.test.*`, `*.spec.*`, `__tests__/`, `test/`, `testes/`, `tests/`):
   - com instante fixo **e** relógio real no mesmo arquivo: acusa cada `Date.now()`/`new Date()` (`relogioReal`), o primeiro
     `now()` do SQL com a contagem (`sqlRelogio`) e cada constante tipo AGORA/HOJE com valor fixo (`agoraFixo`);
   - sempre: "hoje" em UTC a partir do relógio real (`dataUtc`);
   - `vi.useFakeTimers`/`vi.setSystemTime` no arquivo: `Date.now()`/`new Date()` passam a ser o relógio do teste;
   - **exceção explícita**: `// hora-fixa-ok: <motivo>` na linha ou na de cima (sem motivo = `semMotivo`).
   - Arquivo só com instantes fixos (domain puro) ou só com relógio real não é acusado.
3. **Entra como AVISO** (`warn`): o lint segue verde. Proposta: **vira `error` em 2026-11-16** (segunda-feira), depois de os
   donos tratarem os avisos (corrigir com o relógio ou justificar com `hora-fixa-ok`). A troca é uma linha no `eslint.mjs`.
4. **Padrão para teste com banco** (uma linha do tempo):
   ```ts
   import { criarRelogio, relogioDoBanco } from '@macuxi/comum/relogio';
   // (a) linha do tempo do BANCO — o teste compara com colunas gravadas por now()/default now()
   const relogio = await relogioDoBanco(cliente);          // dentro de transação, now() é fixo (início dela)
   const janela = { desde: null, ate: relogio.relativo({ minutos: 1 }) };
   // (b) linha do tempo do TESTE — o SQL não usa now(); o instante vai como parâmetro
   const r = criarRelogio();                                // MACUXI_AGORA ou o relógio real, congelado aqui
   await cliente.query('insert into core.visita (id, tenant_id, checkin_em) values ($1, $2, $3)',
     [id, tenant, r.instante({ dias: -1, hora: '23:59' })]); // ontem 23:59 de Manaus
   vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(r.agora()); // se o código lê new Date() por dentro
   ```
   Data literal só em domain puro ou em dado nunca comparado com o relógio.

## Alternativas consideradas
- **`no-restricted-syntax` puro** (proposta do `testes`): não enxerga a *mistura* no arquivo; acusaria todo instante literal
  (121 avisos na primeira medição, a maioria fixture inofensiva). A regra própria acusa a leitura do relógio real e a constante
  AGORA só quando há mistura: 51 avisos em 20 arquivos.
- **`@macuxi/platform-sdk/testing`**: obrigaria `db/` e `tests/` a depender do SDK para um utilitário puro.
- **Congelar o relógio do Postgres** (libfaketime): pesado e fora do container padrão; fica opcional para o job agendado.
- **Erro desde já**: quebraria o lint de 20 arquivos de 9 donos na mesma rodada.

## Consequências
- Medição de 2026-11-01 (aviso): 51 em 20 arquivos — engenheiro-software 10 (`apps/api/test`), modulo-integracao 10
  (`apps/conector/test`), banco-dados 15 (`db/testes`), modulo-core 7, modulo-vendedor 3, testes 6 (`tests/`, 2 deles `dataUtc`).
  Cada dono recebeu recado com arquivo:linha e a correção sugerida.
- Teste novo com banco nasce com `criarRelogio`/`relogioDoBanco`; a revisão do engenheiro cobra a regra.
- **Fora desta ADR**: o job de CI com relógio deslocado (`tests/scripts/varrer-relogio.mjs`: 23:59 e 01:30 de Manaus, fim de
  mês, virada do ano, `MACUXI_AGORA` em 03:59Z/04:01Z) fica para depois, no CI agendado (T-0033), por pedido do gerente.

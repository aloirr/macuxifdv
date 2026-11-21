# v1.0.19 — Monitor da Integração ERP, uma linha por entidade — matriz do testes

Regras: RF-INT-04 (monitor), RN-INT-15 (status e ações do lote), RN-INT-16 (senha de quem autoriza), RN-CORE-03 (licença).
Código (modulo-integracao, branch `nuvem/v1019-monitor-entidade`): `web/lib/entidades.ts`, `web/lib/reprocessar-lotes.ts`, `web/components/entidades-panel.tsx`,
`historico-dialog.tsx`, `autorizar-reprocessamento.tsx`, `api/bko-monitor.ts` (`MonitorResumo.conectores`, default `[]`).
Testes: `tests/e2e/bko/integracao-simples.spec.ts` (API simulada) e `tests/integracao/demo/ciclo-erp.test.ts` (Postgres).
Dados em UTC; exibição em America/Manaus (UTC−4). A linha usa o lote **mais recente** da entidade para Última carga e Linhas integradas.

| Id | Cenário | Esperado (calculado pela regra) | Teste | Resultado |
|---|---|---|---|---|
| E-01 | Cabeçalho | `erp-matriz · v1.4.2 · última carga recebida 15/11 às 14:39` (lote mais recente 18:39:50Z) | e2e | ✅ |
| E-02 | Colunas e ordem | `Entidade`, `Última carga`, `Situação`, `Linhas integradas`, ações; uma linha por entidade; com falha primeiro, depois a carga mais recente | e2e | ✅ |
| E-03 | Última carga | lote mais recente falhou: `15/11 às 11:10 · falhou 11:10`; com avisos: `15/11 às 13:00`; mais de um lote: `15/11 às 14:20 · 2 lotes` | e2e | ✅ |
| E-04 | Virada de dia e de mês | 03:50Z de 15/11 → `14/11 às 23:50`; 03:30Z de 01/11 → `31/10 às 23:30` | e2e | ✅ |
| E-05 | Falha no dia seguinte ao recebimento | recebido 03:58Z e falhou 04:03Z de 15/11 → `14/11 às 23:58 · falhou 15/11 00:03` (spec do designer: `formatDataHoraCurta` quando a falha é em outro dia) | e2e (linha do Títulos) | ✅ |
| E-06 | Chip | `Com falha` quando há lote reprocessável (falhou ou com avisos), o mesmo critério do botão; senão `Em dia` | e2e + `entidades.test.ts` | ✅ |
| E-07 | Linhas integradas pt-BR | `1.180 de 1.240`; lote que falhou `0 de 800`; `3.500 de 3.500`; `12.000 de 12.000`; em andamento e **cancelado** vazios (cancelado não aplicou nada: não `0 de 40`) | e2e | ✅ |
| E-08 | Reprocessar na linha | só com falha reprocessável; 1 lote = 1 POST | e2e | ✅ |
| E-09 | Histórico (n) | `Histórico (3)`; Recebido `15/11 11:10`, Falhou `11:10`, Situação, Linhas; `Reprocessar os 2 lotes` do mais antigo ao mais recente e fecha o diálogo; Cancelar só em andamento; Ver erros só com falha ou erro | e2e | ✅ |
| E-10 | Ver erros | gaveta `?lote=` com `falhou em 15/11/2026 11:10` e os erros por linha; o Histórico some enquanto a gaveta está aberta | e2e | ✅ |
| E-11 | RN-INT-16, popup | 5 senhas erradas limpam o campo; a 6ª dá 429; a senha nunca vai na URL; nenhum lote reprocessado | e2e | ✅ |
| E-12 | RN-INT-16, n lotes | uma autorização; os 2 POSTs levam o `autorizador_id` | e2e | ✅ |
| E-13 | Lote com o conteúdo apagado (409) | o mais antigo dá 409 `conteudo_expirado`; o mais recente vai; aviso `1 de 2 lotes reprocessados. Falhou o lote de 15/11 às 09:00: ‹mensagem›` | e2e | ✅ |
| E-14 | Filtros e lista de lotes | `integracao.lotes`, os filtros Entidade e Status, Duração e Conclusão saíram | e2e | ✅ |
| E-15 | Multi-tenant (Postgres) | em A, `conectores` = só o Conector de A, com a versão do último sinal; em B, só o Conector de B | `ciclo-erp.test.ts` | ✅ |
| E-16 | Perfil e licença (API) | supervisor 403; sem licença 403 `MODULO_INATIVO`; os cards e o De-para somem | `apps/api/test/integracao-hub.banco.test.ts` + e2e | ✅ |
| E-17 | Todos com erro do próprio lote | 409 `conteudo_expirado` e 409 `lote_nao_pode_reprocessar` (pelo Histórico): `Nenhum lote reprocessado. Falhou o lote de 15/11 às 09:00: … Falhou o lote de 15/11 às 11:10: …`; nunca `0 de 2` | e2e | ✅ |
| E-18 | Erro que não é do lote | 503 `servico_indisponivel` no 1º lote para a fila: 1 POST só, `Nenhum lote reprocessado. Falhou o lote de 15/11 às 09:00: ‹mensagem›`, sem popup de senha | e2e | ✅ |
| E-19 | RN-INT-16, limite no meio | com a senha, o 1º lote vai e o 2º leva 429: o popup fica com o erro e a senha limpa; a 2ª autorização vai **só** ao lote restante (o 1º não é refeito) e fecha com `Reprocessamento iniciado.` | e2e | ✅ |
| E-20 | RN-INT-16, 409 no popup | o lote expirado não para os outros; o popup fecha com `1 de 2 lotes reprocessados. Falhou o lote de 15/11 às 09:00: ‹mensagem›` | e2e | ✅ |
| E-21 | Cancelado no Histórico | Situação `Cancelado`, Linhas vazia, sem Cancelar, Ver erros nem Reprocessar; a linha fica `Em dia` (não é reprocessável) | e2e | ✅ |
| E-22 | Coluna Última carga | 300px a 1366×768; o texto mais longo (`14/11 às 23:58 · falhou 15/11 00:03`) cabe numa linha | e2e | ✅ |

## Defeitos
Nenhum em aberto (reteste de 21/11/2026).
- **D-V1019-01** — fechado como **não defeito** (decisão do gerente-projetos): a linha segue a spec do designer, `falhou 15/11 00:03`
  (`formatDataHoraCurta`) quando a falha cai em outro dia. A expectativa do e2e foi ajustada (E-05).
- **D-V1019-02** — **corrigido** em `web/lib/reprocessar-lotes.ts`: erro do próprio lote (`conteudo_expirado`, `lote_nao_pode_reprocessar`,
  `LOTE_NAO_ENCONTRADO`) segue com os demais; autorização, senha, limite e serviço fora param; o popup fica só com os restantes.
  Coberto por E-13, E-17 a E-20 (e2e) e `reprocessar-lotes.test.ts` (unitário do módulo).

## Execução (reteste de 21/11/2026, Postgres 16 local na sessão)
- `pnpm --filter @macuxi/integracao test` (worktree do módulo, com os `*.db.test.ts`): 84 arquivos, 1.033 passados, 0 pulados, 0 falhos.
- `tests/integracao` (Postgres): 86 arquivos, 1.217 passados, 15 pulados, 6 todo, 0 falhos.
- e2e `integracao-simples.spec.ts` (Chromium headless, 1366×768): 17 passados, 1 falho fora do escopo (portal `config.`, abaixo).
- `lint:tests` e `typecheck:tests` limpos.

## Manual
Não há câmera, GPS nem PDF. No BKO real (homologação):
1. Entidade com 2 lotes reprocessáveis e o conteúdo do mais antigo expirado: clique em Reprocessar e confira o aviso
   `1 de 2 lotes reprocessados. Falhou o lote de ‹dd/mm às hh:mm›: …` e o mais recente em andamento depois de Atualizar.
2. Com um perfil sem `lote.reprocessar` (popup de senha), repita o passo 1 e confira que o popup fecha com o mesmo aviso.
3. Cancele um lote em andamento no Histórico e confira a linha `Cancelado` com Linhas vazia.

## Fora do escopo do lote
- O e2e do portal `config.` (`RN-INT-15: portal config. …`) falha em `base-produto.resultado`. Ele não depende do monitor; o diff não toca no portal.
- `ciclo-erp.test.ts` lê `MonitorResumo.conectores`: no `main` sem o PR do modulo-integracao, o `typecheck:tests` falha. O merge sai junto ou depois dele.

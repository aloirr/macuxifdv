# v1.0.31 — Zerar dados (matriz de cenários do testes)

ADR 0068 · RN-PLA-12 · desenho `docs/desenho/empresa-zerar.md` (§3 a §6, §11) · migração 0100 (banco-dados).

Automático, banco real (junção do lote): `tests/integracao/api/zerar-dados-v1031.test.ts` (API real + portal + worker do zerar +
Hub + despachante, dois-tenants). A regra tabela a tabela fica no `db/testes/empresa-zerar.db.test.ts` (banco-dados); as rotas com
fonte falsa, nos testes da `apps/api` (engenheiro-software); a tela, no `apps/web/e2e/portal-zerar.spec.ts` (engenheiro-apps).

| # | Cenário | Esperado | Teste |
|---|---|---|---|
| 1 | Anônimo, token do BKO e admin do cliente no portal: prévia, pedido e leitura do zerar | 401, 401, 403 `PERFIL_SEM_ACESSO` | Z-01 |
| 2 | `GET /v1/integracao/monitor/detalhes` | anônimo 401; BKO e admin do cliente 403; super-admin 200, sem dado de linha | Z-01 |
| 3 | Super-admin reprocessa lote pelo portal | 200 `recebido`, auditoria `via: super_admin`, despachante conclui | Z-02 |
| 4 | Lote do Hub em processamento | prévia com `bloqueio`; pedido 409 `ZERAR_HUB_PROCESSANDO`; nada pedido | Z-03 |
| 5 | Zerar `cliente`: prévia × executado | contagem do concluído = tabelas da prévia; total e `entidades_afetadas` iguais | Z-04 |
| 6 | Cascata por entidade | saem cliente, endereço, título e nota; produto fica; outro tenant intacto | Z-04 |
| 7 | O que fica | usuários, perfis, credenciais, conectores, plano, licenças e parâmetros iguais (sem `updated_at`) | Z-04, Z-08 |
| 8 | Cópia antes de a linha sair | gatilho espião: toda linha que sai (soft e físico) já está na `limpeza_copia`, na mesma transação | Z-04 |
| 9 | Idempotência | mesmo id = mesmo zerar; outro id com um em andamento = 409 `ZERAR_EM_ANDAMENTO`; o worker executa uma vez | Z-04 |
| 10 | O ERP pode reenviar | cursor nulo, lote e `registro_atual` fora da entidade pedida E de toda entidade da cascata (endereço, título, nota); o lote de produto fica | Z-04, Z-08 |
| 11 | `restaurar_limpeza` | contagens, `registro_atual` e cursor de volta; `desfeito_em`; a mesma carga sai `inalterada` | Z-05 |
| 12 | Reenvio depois do zerar | a mesma carga DELTA (mesma chave) de cliente, endereço, título e nota = lote novo, sem `repetido`, `novas`, linhas recriadas | Z-06, Z-08 |
| 13 | Erro no meio | `falhou` `ZERAR_FALHOU`; nada sai; nenhuma cópia do lote | Z-07 |
| 14 | Empresa inteira | prévia = executado; ficam os administradores; todos os cursores nulos; Hub vazio; reenvio recria; outro tenant intacto | Z-08 |

## Reteste (23/11/2026, noite de Manaus)

Junção local, sem commit: `origin/main` f2556d681 + 1ea0ec192 (0098 e 0099 da v1.0.29/30, sessão C) + 2d9578b81 (banco-dados: 0100 e
cascata no Hub) + d31bca66b (engenheiro-software) + 2f0466859 (engenheiro-apps, já com o 31faad3d7 do modulo-integracao) + este branch.
Postgres 16 local (`db/scripts/pg-local.sh`), Node 24.

| Critério | Teste | Resultado |
|---|---|---|
| 1. Menções 0099 → 0100 (migração do zerar) | `conformidade.test.ts` (cabeçalho e listas), `zerar-dados-v1031.test.ts`, este doc | ✅ |
| 2. Zerar `cliente` e reenviar DELTA com a mesma chave de título, nota e endereço: lote novo, não `repetido`, linhas recriadas | Z-04 (cursor e lote da cascata fora) e Z-06 | ✅ (vermelho com a 0099 antiga b35de99e5: cursor de `cliente_endereco` ficava) |
| 3. Junção com o banco: `tests/` inteiro, `*.db.test.ts` de `db/` e dos módulos, `apps/api` empresa-zerar, e2e | ver abaixo | ✅ com 1 defeito fora do zerar (D-1) |
| 4. Este doc com os critérios e os SHAs | — | ✅ |

Suítes: `tests/` 166 arquivos, 2525 testes verdes (22 pulados, 9 todo); `db/` 119 de 120 (D-1); módulos 77 arquivos `*.db.test.ts`,
816 testes verdes; `apps/api` empresa-zerar (portal, worker e `banco`) 19 verdes; `typecheck:tests` e `lint:tests` limpos.
e2e (Chromium headless da sessão): BKO `tests/e2e/bko/integracao-simples.spec.ts` 19 verdes e portal `apps/web/e2e` 16 verdes, na
junção acima e de novo com o engenheiro-apps em e4fc95fb6 (traz o c32abc632 do modulo-integracao, Situação em 89 px).

**D-1 (banco-dados, `db/testes/resumo-outbox-vivos.db.test.ts:140` e `:154`)**: o teste da 0099 usa `migrarUp(c)` sem `ate` e, com a
0100 em cima, aplica as duas (`["0099_plataforma_resumo_outbox_vivos", "0100_plataforma_zerar_empresa"]` ≠ só a 0099). Precisa de
`{ ate: '0099' }` nas duas chamadas. Não é do zerar; segura a suíte `db/` da junção.

## Manual (aparelho real)
1. Portal `config.` › empresa › ⋯ › Zerar dados: conferir a prévia, digitar o código e a senha; depois do concluído, abrir o Campo
   de um vendedor administrador e confirmar que a base é baixada de novo (sem clientes do ERP).
2. Aba Integração › Monitor › Cliente › ⋯ › Zerar dados: conferir que o resultado lista "Rode `conector carga-completa <e>` para: …"
   com as entidades afetadas; rodar o Conector na máquina do cliente e conferir as linhas de volta no BKO.
3. Restaurar pelo workflow `producao-limpar-cadastros.yml` (modo restaurar) com o lote mostrado no portal, antes do reenvio.

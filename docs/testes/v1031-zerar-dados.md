# v1.0.31 — Zerar dados (matriz de cenários do testes)

ADR 0068 · RN-PLA-12 · desenho `docs/desenho/empresa-zerar.md` (§3 a §6, §11) · migração 0100 (banco-dados).

Automático, banco real (junção do lote): `tests/integracao/api/zerar-dados-v1031.test.ts` (API real + portal + worker do zerar +
Hub + despachante, dois-tenants). A regra tabela a tabela fica no `db/testes/empresa-zerar.db.test.ts` (banco-dados); as rotas com
fonte falsa, nos testes da `apps/api` (engenheiro-software); a tela, no `apps/web/e2e/portal-zerar.spec.ts` (engenheiro-apps).

| # | Cenário | Esperado | Teste |
|---|---|---|---|
| 1 | Anônimo, token do BKO e admin do cliente no portal: pedido e leitura da prévia (`POST …/zerar/previa`, `GET …/zerar/previa/:previa_id`), pedido e leitura do zerar | 401, 401, 403 `PERFIL_SEM_ACESSO`; prévia inexistente ou de outra empresa 404 `ZERAR_PREVIA_NAO_ENCONTRADA` | Z-01 |
| 2 | `GET /v1/integracao/monitor/detalhes` | anônimo 401; BKO e admin do cliente 403; super-admin 200, sem dado de linha | Z-01 |
| 3 | Super-admin reprocessa lote pelo portal | 200 `recebido`, auditoria `via: super_admin`, despachante conclui | Z-02 |
| 4 | Lote do Hub em processamento | prévia com `bloqueio`; pedido 409 `ZERAR_HUB_PROCESSANDO`; nada pedido | Z-03 |
| 5 | Zerar `cliente`: prévia (assíncrona: 202 → worker `cicloPrevia` → `pronta`) × executado | mesmas (tabela, linhas) com contagem; `total` = `linhas_apagadas`; `entidades_afetadas` iguais; mesmo id = mesma prévia | Z-04 |
| 6 | Cascata por entidade | saem cliente, endereço, título e nota; produto fica; outro tenant intacto | Z-04 |
| 7 | O que fica | usuários, perfis, credenciais, conectores, plano, licenças e parâmetros iguais (sem `updated_at`) | Z-04, Z-08 |
| 8 | Cópia antes de a linha sair | gatilho espião: toda linha que sai (soft e físico) já está na `limpeza_copia`, na mesma transação | Z-04 |
| 9 | Idempotência | mesmo id = mesmo zerar; outro id com um em andamento = 409 `ZERAR_EM_ANDAMENTO`; o worker executa uma vez | Z-04 |
| 10 | O ERP pode reenviar | cursor nulo, lote e `registro_atual` fora da entidade pedida E de toda entidade da cascata (endereço, título, nota); o lote de produto fica | Z-04, Z-08 |
| 11 | `restaurar_limpeza` | contagens, `registro_atual` e cursor de volta; `desfeito_em`; a mesma carga sai `inalterada` | Z-05 |
| 12 | Reenvio depois do zerar | a mesma carga DELTA (mesma chave) de cliente, endereço, título e nota = lote novo, sem `repetido`, `novas`, linhas recriadas | Z-06, Z-08 |
| 13 | Erro no meio | `falhou` `ZERAR_FALHOU`; nada sai; nenhuma cópia do lote | Z-07 |
| 14 | Empresa inteira | prévia = executado; ficam os administradores (os não administradores saem); todos os cursores nulos; Hub vazio; reenvio recria; outro tenant intacto | Z-08 |
| 15 | Valor × regra do total da prévia | `total` = soma das linhas fora de `core.filial`, `plataforma.sync_pacote` e `plataforma.tenant` (mudam, não saem) | Z-08 |
| 16 | Teto de 3 tentativas | prévia e zerar pegados 3 vezes sem fechar: na 4ª, `falhou` `ZERAR_FALHOU` (frase da prévia: "Não foi possível contar os dados. Tente de novo."); auditoria `tenant.zerar_falhou`; nada sai | Z-09 |
| 17 | Trava do Hub só da empresa | com a prévia e com o zerar de A abertos numa transação do worker, o Hub de B recebe e conclui um lote; depois o zerar de A conclui | Z-10 |

## Reteste final (23/11/2026, noite de Manaus) — prévia assíncrona

Mudou na revisão final do engenheiro-software (🔴2 e 🟡): `sa_previa_zerar` saiu; entraram `sa_pedir_previa_zerar(p_sid, p_tenant,
p_id, p_entidades)` e `sa_ler_previa_zerar(p_sid, p_tenant, p_id)` (portal, 42 `sa_*`), `pegar_previa_zerar()` e
`executar_previa_zerar(p_previa)` (worker, 6 funções do zerar); rotas `POST …/zerar/previa` (202) e `GET …/zerar/previa/:previa_id`;
trava do Hub só da empresa; teto de 3 tentativas; total da prévia sem filial, pacote de sync e tenant.

Junção local (commits só na árvore descartável, nada publicado): `origin/main` f2556d681 + 1ea0ec192 (sessão C, 0098 e 0099) +
36d958549 (banco-dados; conflito em `db/testes/estatico.test.ts` e `docs/banco/README.md` resolvido somando as duas versões) +
6ccd07e32 (engenheiro-software) + c32abc632 (modulo-integracao) + 5e46817be (engenheiro-apps) + este branch; no rascunho,
`migrarUp(c, { ate: VERSAO })` em `db/testes/resumo-outbox-vivos.db.test.ts:140` e `:154` (D-1). Postgres 16 local
(`db/scripts/pg-local.sh`, sem Docker), Node 24.

| Critério | Teste | Resultado |
|---|---|---|
| 1. Conformidade: portal 42 `sa_*` (sem `sa_previa_zerar`, com as 2 novas) e worker com as 6 do zerar, assinaturas do banco | `tests/integracao/banco/conformidade.test.ts` (DEFINER_REVISADAS_PORTAL e _WORKER) | ✅ |
| 2. Fluxo novo: pedir prévia → worker → pronta = executado | `zerar-dados-v1031.test.ts` Z-04 e Z-08 | ✅ |
| 3. A prévia (e o zerar) de A não trava o Hub de B | Z-10 | ✅ |
| 4. 3 tentativas → `falhou` `ZERAR_FALHOU` (prévia e zerar) | Z-09 | ✅ |
| 5. Só super-admin nas rotas novas | Z-01 | ✅ |
| 6. Mantém administradores, perfis, credenciais, conectores, plano, licenças e parâmetros | Z-04 e Z-08 | ✅ |
| 7. O ERP reenvia, inclusive a cascata | Z-04, Z-06 e Z-08 | ✅ |
| 8. Só super-admin (rotas antigas e monitor/detalhes) | Z-01 | ✅ |
| 9. Cópia antes de a linha sair | Z-04 (espião) e Z-07 | ✅ |

Suítes na junção: `tests/` 166 arquivos (1 pulado), 2527 testes verdes (22 pulados, 9 todo); `db/` 119 arquivos, 2181 verdes (1
pulado; com o D-1 aplicado no rascunho); módulos 77 arquivos `*.db.test.ts`, 816 verdes; `apps/api` 86 arquivos, 886 verdes
(inclusive os `*.banco.test.ts` e `empresa-zerar.banco.test.ts`); `scripts/producao/teste/limpar-cadastros.teste.sh` (5433, admin
sem superusuário) TUDO OK; e2e BKO `tests/e2e/bko/integracao-simples.spec.ts` 19 verdes e portal `apps/web/e2e` 16 verdes
(Chromium 1243 de `/opt/pw-browsers`); `typecheck:tests` e `lint:tests` limpos.

**D-1 (banco-dados, `db/testes/resumo-outbox-vivos.db.test.ts:140` e `:154`)** continua aberto no branch da sessão C: sem
`{ ate: VERSAO }`, o `migrarUp` aplica a 0099 e a 0100 e o teste da 0099 reprova na junção.

## Manual (aparelho real)
1. Portal `config.` › empresa › ⋯ › Zerar dados: conferir a prévia, digitar o código e a senha; depois do concluído, abrir o Campo
   de um vendedor administrador e confirmar que a base é baixada de novo (sem clientes do ERP).
2. Aba Integração › Monitor › Cliente › ⋯ › Zerar dados: conferir que o resultado lista "Rode `conector carga-completa <e>` para: …"
   com as entidades afetadas; rodar o Conector na máquina do cliente e conferir as linhas de volta no BKO.
3. Restaurar pelo workflow `producao-limpar-cadastros.yml` (modo restaurar) com o lote mostrado no portal, antes do reenvio.

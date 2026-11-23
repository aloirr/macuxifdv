# v1.0.31 — Zerar dados (matriz de cenários do testes)

ADR 0068 · RN-PLA-12 · desenho `docs/desenho/empresa-zerar.md` (§3 a §6, §11) · migração 0099 (banco-dados).

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
| 10 | O ERP pode reenviar | cursor da entidade nulo; `registro_atual` sem o hash das linhas que saíram | Z-04, Z-08 |
| 11 | `restaurar_limpeza` | contagens, `registro_atual` e cursor de volta; `desfeito_em`; a mesma carga sai `inalterada` | Z-05 |
| 12 | Reenvio depois do zerar | a mesma carga (mesma chave) = lote novo, `novas`, linhas recriadas; entidades da cascata voltam pela carga completa | Z-06, Z-08 |
| 13 | Erro no meio | `falhou` `ZERAR_FALHOU`; nada sai; nenhuma cópia do lote | Z-07 |
| 14 | Empresa inteira | prévia = executado; ficam os administradores; todos os cursores nulos; Hub vazio; reenvio recria; outro tenant intacto | Z-08 |

## Manual (aparelho real)
1. Portal `config.` › empresa › ⋯ › Zerar dados: conferir a prévia, digitar o código e a senha; depois do concluído, abrir o Campo
   de um vendedor administrador e confirmar que a base é baixada de novo (sem clientes do ERP).
2. Aba Integração › Monitor › Cliente › ⋯ › Zerar dados: conferir que o resultado lista "Rode `conector carga-completa <e>` para: …"
   com as entidades afetadas; rodar o Conector na máquina do cliente e conferir as linhas de volta no BKO.
3. Restaurar pelo workflow `producao-limpar-cadastros.yml` (modo restaurar) com o lote mostrado no portal, antes do reenvio.

# Backlog

> Dono: gerente-projetos. Itens fora do escopo da sprint atual.

## Sprint 1 (abertas no quadro)
- [T-0007](../.coord/tarefas/T-0007.md) — Produto no dono definitivo (ADR-0005)
- [T-0008](../.coord/tarefas/T-0008.md) — Adaptador SQLite no aparelho
- [T-0009](../.coord/tarefas/T-0009.md) — Integração: domínio e contratos do Hub (em revisão)
- [T-0010](../.coord/tarefas/T-0010.md) — Promotor: domínio de trade marketing (em revisão)

## Futuro
- **RN-CORE-01 — exceção que acrescenta módulo**: hoje a exceção do usuário só remove (decisão de 2026-10-30).
- **RN-CORE-12 em função de domínio**: a regra está só na folha de checkout (B2 do core); falta a função pura com teste em `modules/core/domain`.
- **`canApprove` duplicado**: o vendedor/web tem cópia local até a permissão vir do platform-sdk (débito do desenho da T-0001).
- **Integração depois da T-0009**: schema `integracao` (banco-dados), rotas `/integracao/v1` e OpenAPI (RF-INT-01), Conector (RF-INT-02), carga por arquivo (RF-INT-03) e monitor no BKO (RF-INT-04).
- **Promotor — próximos passos após a T-0010**: schema `promotor` e migrações (banco-dados), API das coletas com RN-PRO-01/02 revalidadas, telas do app (Loja) e BKO de trade; payloads Zod dos eventos `promotor.*@1`; trocar `produto_id` pelo contrato de produto do Core quando a T-0007 publicar.
- **`packages/platform-sdk/src/ambiente.ts` ausente na main**: quebra o typecheck da raiz e os testes que importam o platform-sdk (ex.: `modules/promotor/manifest.test.ts`, `domain/rn-pro-01.test.ts`). Dono: engenheiro-software.
- **Índice da carteira do vendedor incluindo excluídos** (T-0002, EXPLAIN do sync): criar junto com a rota de sync (T-0004).
- **db sem dependência declarada do platform-sdk** (T-0002): `db/package.json` deve declarar `@macuxi/platform-sdk: workspace:*` (hoje resolve só pelo nodeLinker hoisted); o pnpm-lock é do engenheiro.
- **🟢 6 e 7 da revisão da T-0002**: entram na próxima migração da plataforma.
- **Demo web da Fase M (S0-008)**: confirmada só pela premissa "pasta inalterada"; falta o roteiro manual M-01 com o Alexandre.
- **ADR 0003, linhas 66-67**: ainda citam a ponte do vendedor; o engenheiro edita quando a T-0008 (nuvem) destravar a ADR.
- **Cancelamento por integração — para ERPs que aceitam** (sem data): evento `vendedor.pedido.cancelado@1` consumido pelo Hub e cancelamento devolvido ao ERP (opção (a) da decisão de 2026-10-31; no Essencial vale a (b)).
- **Schema `vendedor` (pedido, pedido_item…)**: o vendedor pediu `vendedor.pedido` ao banco-dados para a rota de cancelamento (T-0009); entra com o pedido ponta a ponta (Sprints 4–5), não na Sprint 0.
- **Campo "canal" no cliente do Core**: necessário para o público-alvo da Pesquisa (RN-PES-05); hoje fica fora.
- **Persistir visita com motivo de cliente fechado e foto da fachada** (RN-CORE-14): tabelas core.visita/visita_etapa e armazenamento de foto entram com rotas e visitas reais (Sprint 1).
- **Pesquisa: colunas suspeita, motivos_suspeita, largura_px e altura_px** (RN-PES-04/06): pedir ao banco-dados junto com a API da pesquisa.
- **Aparelho bloqueado por tenant e erro 23503 no criarSessao** (T-0003): decidir se o bloqueio de aparelho vale para todos os usuários do tenant; tratar aparelho de outro tenant como erro de cliente. Sugestão do banco-dados ao core.
- **Job de limpeza de sessões expiradas** (core.sessao).
- **Telas que ainda chamam rotas da Fase M** (/me, /customers): ficam vazias com a API real; migrar para as rotas novas na Sprint 1.
- **Antes do primeiro deploy (obrigatório)**: refresh do BKO em cookie httpOnly (hoje localStorage) e trustProxy no Fastify.
- **Treinamento — 🟡 da revisão final**: unificar `PedidoFaturadoLido` (domain/desafio.ts × contracts/pedido-lido.ts) e os 3 🟢 (xp.ts:109, fuso em dois lugares, arredondamento por evento).
- **Tabela de lançamento de XP** (banco-dados): `referencia_id` com ≥ 128 caracteres e chave única do lançamento; a API processa o XP de um vendedor por vez (tenant + usuário).
- **O-4**: p95 da carga S0-110 em 1–2 s na máquina local (meta 300 ms) — linha de base para a Sprint 9.



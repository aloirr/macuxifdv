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
- **Conector v2**: atualização automática (v1 = pacote assinado + aviso de versão no monitor).
- **Conector: adaptadores Firebird** (depois do Oracle) e **MySQL** (sob demanda).
- **Testes do Conector intermitentes sob carga** (T-0013 → correção na T-0023, nuvem): até o merge, a raiz pode falhar no @macuxi/conector; o gerente roda de novo antes do push.
- **Migração para zod ≥ 4.6.6** (Sprint 2): o alerta afeta o push sem login; mitigado na API (teto de elementos com 413, máximo de 50 erros na resposta, login antes da validação).
- **Feriados do tenant no calendário de dias úteis** (packages/comum): cadastro de feriados por tenant + nacionais, usado pelo prazo de aprovação do Gestor (RN-GES-03) — engenheiro, se o calendário ainda não tiver feriados.
- **Modo demonstração (mock-api) sem carteira, rota e visita do Core** (decisão do engenheiro na onda 3): a demo do app novo deixou de mostrar essas telas; a demo da Fase M continua na pasta original. Revisar antes da demonstração com o gestor externo.
- **API do Catálogo (Sprint 3)**: variacaoEscopo no sync (engenheiro), incremento atômico da cota de IA e timeout real do provedor em api/ia/ com AbortSignal.timeout (T-0021 🟡3/🟢6).
- **Realizado de venda e positivação reais** (T-0020): consumidor de vendedor.pedido.* alimentando core.indicador_diario, quando o Vendedor publicar os eventos de pedido (Sprints 4–5).
- **SDK (🟡 da revisão final da Sprint 1)**: poda local das entidades com janela; push enviado depois do commit (aposConfirmar) — Sprint 2.
- **Job de desempenho no CI** (Sprint 9): rodar à parte MACUXI_PERF=1 (busca do SQLite, meta 300 ms) e MACUXI_CARGA_MEDIR=1 (S0-110); no pnpm test normal esses tempos só são impressos ou têm limite folgado.
- **BKO do core na API nova (Sprint 2)**: Clientes com farol da carteira, Metas por equipe e Plano de RV — hoje 'em construção' (T-0030); precisam de rotas v1 novas no core.

## Pendências da T-0029 (Sprint 2)
- ✅ (T-0035) Fronteira S0-014 no Vendedor: o fuso deixa de ser lido de `plataforma.tenant` (engenheiro expõe `ctx.fuso()` no platform-sdk; vendedor troca `fusoDoTenant`) e `pedido.db.test.ts` sem SQL em `core.*`; o testes retira as exceções temporárias.
- ✅ (T-0035) `GET /alcadas` sem acesso do promotor (hoje via `pedido.ver`), com teste 403 (modulo-vendedor).
- ✅ (T-0034) `apps/web/next-env.d.ts` no .gitignore e typecheck do web com `next typegen` (engenheiro; O-4).
- Integração: consumir `integracao.pedido.retorno_erp@1` e publicar `faturado@1` no Vendedor (fora do escopo da demo).
- **OpenAPI do Hub /integracao/v1** (RF-INT-01): fora da T-0032; gerar a partir dos contratos Zod.
- **Abas que faltam nos apps** (T-0034: o shell está pronto, faltam as telas dos módulos):
  - Catálogo no Campo: o `moduloApp` do Catálogo não tem `paginas` (modulo-catalogo; candidata à nuvem).
  - Loja do promotor: o `moduloApp` do Promotor exporta `{}`; precisa do schema promotor, da API das coletas e das telas (modulo-promotor + banco-dados).
  - Equipe e Aprovações no Gestão: o `moduloApp` do Gestor exporta `{}`, e o Gestor não está licenciado na demo (modulo-gestor; licença na demo é decisão do Alexandre).
  - Sugestão de `ordem` do engenheiro-apps: Equipe 10, Aprovações 20, Pedidos e Loja 40, Catálogo 60. A barra mostra no máximo 5 abas; as demais vão para "Mais".
- **Revisão das telas da T-0029** (engenheiro-apps, R-20261101-155135): 16 🟡 e 12 🟢 ao modulo-vendedor, para a próxima passada dele.
- **Catálogo — cota de IA atômica** (T-0041): incremento condicional por tenant, usuário e dia no fuso do tenant (banco-dados); campo `ia_timeout_ms` em `ParametrosCatalogo` (engenheiro-software).
- **Lint `macuxi/hora-fixa-em-teste` vira ERRO em 2026-11-16** (T-0043, R-20261101-200740). Até lá, cada dono corrige os avisos dele: banco 15, engenheiro 10, integração 10, core 7, testes 6, vendedor 3. Tarefa de virar a chave no dia 16: engenheiro-software.
- **Job de CI com relógio deslocado** (23:59/01:30 de Manaus, fim de mês, virada de ano; `tests/scripts/relogio-deslocado.cjs`): local, governança (.github), depois da T-0049.
- **Riscos do guardião v5** (PR #31): proteger o merge feito pelo MCP do GitHub (hook ou proteção do `main`); o CI barrar recado de autorização vindo de PR da nuvem (fica na T-0049 b).
- **Guardião v5 e o PATH do gh**: o hook falha fechado se o `gh` não estiver no PATH do processo (C:\Program Files\GitHub CLI). Procurar o gh no caminho padrão ou documentar o PATH.
- **Guardião v7** (sem pressa): `gh api` de leitura com `$VAR` ou "merge" no --jq ainda é barrado; as ferramentas MCP que gravam direto no GitHub (push_files etc.) não passam por guardião (o CI da T-0049 detecta governança sem assinatura).
- **Antes do piloto real** (fora de 06/11): teste de carga com 20 mil SKUs, onboarding de tenant e o resto da Sprint 9 que não couber.
- **Guarda de ordem nos consumidores do ERP** (T-0066 🟡1, antes do 1º tenant real): versão antiga reentregue pela outbox não pode sobrescrever a nova (comparar alterado_em); banco-dados + modulo-core + modulo-catalogo.
- **ERP não reativa o que o admin desligou** (T-0066 🟢4/5): vendedor e tabela de preço desativados no BKO não voltam sozinhos com a próxima carga; rota do ERP aplica as paradas presentes e só notifica se as de hoje mudaram (🟢3).
- **Cortes da T-0061** (aceitos pelo Alexandre em 2026-11-02, R-20261102-204330): transportadora vinda do ERP (fica só o cadastro no BKO), preço próprio da CX na tabela (fica UN × fator), chip "campanha" na árvore do catálogo.
- **Depois da demo de 03/11** (Alexandre, 03/11 manhã): passo `pnpm timers` no `.github/workflows/ci.yml` (governança; a varredura já está limpa); `licencas.test` refeito sobre o main atual; espelho Drizzle do Promotor e do item do pedido; `gravarDemoMedidas` no `db/seeds/demo/demo.ts`; `core.medidas@1` declarado no Hub (`usaConsultas` da Integração; re-revisão T-0032 🟡); nota em `docs/desenho/T-0061.md` e contrato marcado como implementado; queda 57P01 do teste de carga; coordenação da T-0056; PR do medidas-api.
- Depois da demo: subir-demo.ps1 espera a API por 180 s em vez de 90 s (com a máquina carregada a API levou ~2 min e o script desistiu; engenheiro-software, R-20261103-065034)

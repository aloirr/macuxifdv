# Diário — modulo-catalogo

2026-10-31 — T-0001 — Fase C: esqueleto do módulo catalogo (manifest validado, pastas, teste do manifesto)
2026-10-31 — T-0001 — reincluído @macuxi/core em modules/catalogo/package.json; validações verdes
2026-10-31 — T-0021 — domínio do Catálogo: normalização/sinônimos, interpretação sem LLM, ranking híbrido, preço e estoque visíveis, limite de IA e cache, pergunte ao catálogo; contracts de vitrine/busca; manifesto com acoes; 206 testes; regras.md
2026-10-31 — T-0021 — revisão do dono: fuso vira argumento, timer fora do domínio, linhas de preço em contracts; regras.md alinhado ao doc 03
2026-11-01 — T-0029 — Catálogo onda 2: manifesto (cliente_tabela_preco, ofereceConsultas), pull de tabela_preco/tabela_preco_item (tenant) e cliente_tabela_preco (carteira), consulta catalogo.precos_cliente@1 na API e no aparelho (RN-CAT-05/06, P-4), testes com Postgres e adaptador de teste
2026-11-02 — T-0052 — 1ª etapa na nuvem (PR #45): domain/API/app/BKO do Catálogo, 32 consultas de relevância na base demo, índice FTS5 declarado; aba liga na 2ª etapa; 0013, e2e e produto.acoes pedidos por recado.
2026-11-02 — T-0052/T-0066 — aba Catálogo e atalho ligados (2ª etapa); consumidores de preço e estoque do ERP no Catálogo (aguarda produto_external_ids no Core)
2026-11-02 — T-0061 — árvore do catálogo (RF-CAT-04): domain/arvore + chips, sync catalogo_no/produto_no, consumidores catalogo_no e produto (nó), tela com trilha/níveis/chips offline, ?pedido=1 só tabela do cliente
2026-11-02 — T-0064 — Catálogo: chip Campanha escondido; trilha/chips já eram os comuns de @macuxi/ui
2026-11-03 — fix-relogio — apresentacao.test.ts com relógio fixo e teste da virada do dia (00h00–00h05 Manaus)
2026-11-03 — T-0071 — Catálogo: sugestoes_pedido@1 (domain, aparelho, API), produto_relacao (contrato, manifesto, provedor de pull), embalagens[] em precos_cliente@1 e correção do preco_cents (só unidade base)
2026-11-03 — T-0071 — contratos do Catálogo: removidas cópias duplicadas (entidades.ts, sync.ts); aviso ao vendedor sobre sugestoes_pedido@1/embalagens[]
2026-11-04 — T-0071 — estoque_saldo e deposito no pull do Catálogo (P4), teste sync-estoque.db.test.ts
2026-11-05 — T-0024 — contracts/eventos.ts (schemas strict + definições de catalogo.produto.visualizado@1 e busca.realizada@1) e consumidores do ERP lendo integracao.{produto,preco,estoque,catalogo_no}.atualizado@1 do contracts do dono (eventoTolerante); fixtures do db test no formato do Hub
2026-11-05 — T-0052 — B3 (repositório Postgres e pull ligados à 0013), B4 (pré-seleção FTS5 por termo: 2.154 produtos de 3,8–14 s para 36–66 ms), B1 (SKU compacto), B2 (mesma semântica em qualquer tamanho); testes e docs atualizados
2026-11-05 — T-0052 — revisão final: destaque grava campanha+destaque, conflito de sinônimo inclui inativos (409 também na corrida), repositorio-postgres.db.test.ts, texto da pré-seleção corrigido
2026-11-05 — T-0052 — 🟢5 (prefixo no FTS5), 🟢7 (busca_log melhor esforço), 🟢8 (selling_points sem quebra de linha); busca com versaoLinhas/linhasPorCampo; limpeza do busca_log no db.test pelo admin; 🟢6 fica para depois (ranking.ts/indice.ts no lote M)
2026-11-05 — T-0052 — db.test do lote M2: expectativa de salvarConteudo alinhada a 'description' (contrato da API); busca sem varredura (5 mil) aguarda recado do SDK (null × [])
2026-11-05 — T-0052 — busca offline com buscarComDesfecho: acima de LIMIAR_SEM_VARREDURA=5000 produtos, consulta sem acerto (todas buscou:true) devolve vazio sem varrer; 7 testes novos em local.test.ts; texto do vazio pedido ao designer-ux
2026-11-05 — T-0052 — vazio da busca com EstadoVazio: 4 casos em app/lib/vazio-busca.ts (puro, testado), título cortado em 30, ações Limpar filtros/Limpar a busca
2026-11-05 — T-0052 — 🟢6: codigoCompacto único (domain/ranking.ts) usado também em app/indice.ts (compacto removido), com teste; busca offline T-0052 sem mudança
2026-11-05 — T-0052 — caixa limpa: 6 recados encerrados, tabela_preco_nome em precos_cliente@1 (aditivo), X da busca volta na hora; buscarComDesfecho fica para o lote N
2026-11-05 — T-0061/T-0052 — precos.db.test: tabela_preco_nome na expectativa + contraprova sem o campo (fix do CI do lote O)
2026-11-05 — T-0052 — BotoesAcao: vitrine sem laranja (outline), ficha com principal de 52 px (ALTURA.principal); resposta ao R-20261105-183411

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
2026-11-05 — T-0084/T-0085 — fatias A e B: expandirAplicacao, trechoServeEm, ranking com aplicação e referência cruzada, contracts aditivos, consultas textos_produto/busca_produtos, FTS v3 (indice.ts), pull produto_referencia, PUT cadastro-catalogo, consumidor do ERP, ficha, "Serve em"/"Equivale a" e seção Catálogo do BKO; pendências: marcas do Promotor no servidor, SDK na consulta do aparelho, lista por linha e exportação (travadas)
2026-11-05 — T-0085 — fatia B: B1 corrigido, referencias opcional no PUT cadastro-catalogo (ausente mantém, [] apaga), BKO omite sem marcas, testes na API e no BKO
2026-11-05 — T-0085 — fatia B: 2 🔴 de UX do BKO (editores com abertura independente; oferece_junto da ficha no mapa de ids), com testes
2026-11-06 — T-0085 — fatia C servidor: GET /v1/catalogo/exportacao ({produtos,marcas,truncado}, teto 20 mil), domain montarExportacao, testes de rota (perfil, licença, tenant)
2026-11-06 — T-0085 — marcas pelo promotor.concorrentes@1 (API, exportação, PUT, consumidor do ERP), oferece junto por código, aplicação memorizada no aparelho (aguarda SDK); marca_nome da 0034 pendente
2026-11-06 — T-0085 — marca_nome (retrato 0034): gravado no PUT e no consumidor do ERP, no pull e lido no aparelho/enriquecer via nomeMarcaDaReferencia; caso de banco do consumidor de referências; regras.md
2026-11-06 — T-0085 — CI 42177538694: causa dos 3 db.test RN-CAT-09 é o ProdutoBase do Hub sem os campos (strip); pedido ao modulo-integracao
2026-11-06 — T-0084 — C9 responde no aparelho com o produto do Core (produtosLocais sem ler o concorrente do Promotor), aplicação (C8) memorizada por versaoLinhas com linhasPorCampo; teste 'pastilha uno 2012/2015'
2026-11-06 — T-0085 — exportação: marca_nome aditivo nas referências (regra nomeMarcaDaReferencia), teste de rota com e sem Promotor (A1 do testes)
2026-11-06 — T-0084 — A4: ano da consulta só casa no mesmo trecho (;) da aplicação (ranking), 4 testes RN-CAT-12, anoAtual da C9 via ctx.agora()
2026-11-06 — T-0084 — critério 5: C9 com pré-seleção da aba, ranking com memória por produto/trecho, aplicação só dos candidatos, AND primeiro, versaoDocumentos (virada do ano); tmp-micro removido; p95 de 300 ms não confirmado neste PC (carga), fica para CI/aparelho
2026-11-06 — T-0084 — critério 5: prefixo da aplicação (/\d/), memória do ranking 800 LRU por produto+ano (< 20 MB, teste), 20 mil só com MACUXI_DESEMPENHO=1, ano no fuso do tenant no ranking, atalho sem mudar o ranking
2026-11-06 — T-0084/T-0089 — T-0084 🟡 (sem appendFileSync, comAplicacao em memória, comentário do ranking); T-0089 K1-K3: domain/escalonada, faixas[] em precos_cliente@1 (API e aparelho), tabela_escalonada no sync, consumidor do ERP, rotas e BKO Tabelas de preço; embalagens deixou de ser preenchido; db.test no CI pendente
2026-11-06 — T-0089 — colisão da faixa do ERP idempotente (substitui/adota, sem loop), PUT não reabre faixa do ERP, produto conferido, CSV protegido, db test da consulta com faixas
2026-11-06 — T-0089 — CI verificacao/lote-t0089: precos.db.test sem fuso() no contexto e precos-escalonada.db.test com limpeza que não cobria os ids 31+ das faixas (FK); só testes corrigidos
2026-11-06 — T-0088 — motivo 'indexando': varredura sem erro, aviso 'Organizando o catálogo no aparelho…' só na aba, C9 sem aviso; testes dos dois caminhos
2026-11-07 — T-0088 — aviso 'Organizando o catálogo' corrigido (avisoDaBusca junta com sem sinal/falha), texto com consequência, Banner anunciar e ícone clock
2026-11-07 — T-0088 — ícone do aviso: relógio só no organizando, erro alert, offline wifiOff (iconeDoAviso no domain, com teste)
2026-11-07 — T-0085 — atalho 'Ver por linha' (LinhaAtalho) na aba Catálogo + lib/atalho-por-linha.ts e teste; textos 'Por linha'/'Sistemas' já estavam na tela do #95
2026-11-07 — T-0092 — TS2769 em api/ia/provedor-http.ts:51 corrigido (tipo do init do fetch); typecheck/lint/test verdes
2026-11-07 — T-0085 — lista por linha com 20 mil produtos: raiz só conta (sem ordenar/carregar itens), chave de ordenação única, memória por nível, teste de desempenho; raiz de cerca de 1,4 s (0,2-0,5 s no código antigo) para 0,06-0,12 s
2026-11-07 — T-0085 — lista por linha: 'Mostrar mais' (+100), LRU de 40 nós no cache, teste de acento, porNome removido
2026-11-07 — T-0085 — Mostrar mais: milhar, ocupado/toque duplo, anúncio e foco no último lote; título do teste do LRU
2026-11-07 — T-0096/T-0097/T-0103 — teste de desempenho com entidades do shell; foto principal toca o conteúdo (definirFotoPrincipal); evento catalogo.referencia.marca_desconhecida@1 (contrato, domain, consumidor)
2026-11-08 — T-0097 — (a) resolvedor da miniatura exportado e file:// aceito (lib/miniatura-resolvedor.ts + teste)
2026-11-08 — T-0113 — parte 1: domain/marcas-cadastro + contracts/marcas (consulta, entidade, evento, rotas); API/BKO aguardam migração do banco-dados
2026-11-08 — T-0113 K — marcas concorrentes no Catálogo: rotas /v1/catalogo/marcas (GET, POST, PUT; marca.gerenciar), consulta catalogo.marcas@1, evento catalogo.marca_concorrente.alterada@1, entidade de sync marca_concorrente (+ lápide da referência de marca inativa), marca_nome regravado na mesma transação, fim do @macuxi/promotor no Catálogo, página BKO /catalogo/marcas; testes de rota, de banco (CI) e da página
2026-11-08 — T-0113 — 🟡 1 da revisão final: gravarMarca devolve boolean e a rota responde 409 ID_EM_USO para id de marca apagada ou de outro tenant (42501 mapeado), sem gravar nem publicar; testes de rota e de banco
2026-11-08 — T-0119 — busca da API com 20 mil: retrato do catálogo por tenant (60 s) + índice invertido de pré-seleção (domain/indice-busca) + preço/estoque só dos candidatos; teste de equivalência (30 consultas) e db.test de volume (EXPLAIN, cache, p95 < 300 ms); sem migração nova

# Diário — modulo-vendedor

2026-10-31 — T-0001 — Fase B: esqueleto modules/vendedor, domain order (32) e contracts de pedido (5) = 37 testes verdes; manifesto sem promotor + acoesPedido (T-0006).
2026-10-31 — T-0001 — Fase B2: manifesto com acoes (RN-PRO-01 testado), moduloWeb (Pedidos, Alçadas) e moduloApp (Pedidos, Pedido, Novo pedido) sobre o motor de sync; 68 testes (29 da Fase M + 2 do manifesto); depende do engenheiro ligar definirAmbienteVendedor no shell.
2026-10-31 — T-0001 — slots cliente.abas/cliente.acoes (mix, últimos pedidos, novo pedido) e total_cents na fila; 73 testes
2026-10-31 — T-0001 — A3 item 4: vendedor usa o ambiente do SDK; ponte @deprecated mantida até o shell sair
2026-10-31 — T-0009/T-0001 — cancelar após envio ao ERP (domain+telas), ponte ambiente.ts removida
2026-10-31 — T-0009 — rota de cancelamento na API ligada a verificarCancelamento (422 após envio), com testes
2026-10-31 — T-0009/T-0011 — OrderStatus com status do ERP (invoiced_partial/invoiced), PedidoFaturadoEvento + montarEventoFaturado, manifesto publica vendedor.pedido.faturado@1; 104 testes
2026-10-31 — T-0015 — rotas GET de pedido com carteira e 404, pedido.ver no manifesto, tela somente leitura; falta SDK liberar promotor
2026-10-31 — T-0015 — pedido.ver com promotor (O-3); lista filtra carteira antes do limit
2026-10-31 — T-0018 — Vendedor: contracts/sync.ts (PedidoSync/PedidoItemSync), provedores de pull pedido/pedido_item (escopo usuarios+carteira, janela 90d), registro no app, teste com Postgres (api/sync.db.test.ts); 123 testes verdes
2026-10-31 — T-0018 — D-4: etapas da Fase M do Vendedor toleram 4xx (pulam sem erro na API real); teste etapas.test.ts
2026-10-31 — T-0018 — D-4: toleraSemRota só pula 404/501/SYNC_NAO_IMPLEMENTADO; 401/403/423 propagam
2026-11-01 — T-0029 — onda 1: contracts (PedidoPush, aprovar/rejeitar, eventos *@1 incl. aprovado, pull pedido_evento/condições), domain/aprovacao (revalidação, status inicial, quem decide, aprovado@1) e domain/pdf-pedido; testes antes citando RN
2026-11-01 — T-0029 — onda 2: receber do pedido (idempotente, preço/cadastro por consulta, alçada, carteira, promotor 403), aprovar/rejeitar/cancelar/lista/detalhe/alçadas, pull de evento e condições, telas Campo/Gestão/BKO sobre o pull, PDF e P-2; 236 testes (28 com Postgres)
2026-11-01 — T-0035 — /alcadas sem promotor (perfis + teste 403), fuso via ctx.fuso(), pedido.db.test sem core.*, janela do pull com relógio real
2026-11-01 — T-0042/T-0034 — relógio único no pedido.db.test.ts (+virada do dia), regra 7 nas páginas de pedido, 16 🟡 de tela (domain/totais e quantidade, libs com teste); vendedor 253/253
2026-11-02 — T-0054 — retorno do ERP no pedido (status RN-INT-08/RN-VEN-30, faturado@1 RN-TRE-08, devolução RN-VEN-37 proposta), faturado no app (Campo/Gestão offline) e no BKO; consumidores atrás de FATURAMENTO_LIGADO até a migração (pedida ao banco-dados); vendedor 308/308 (46 com Postgres)
2026-11-02 — T-0059 — detalhe do pedido no BKO: leitura tolerante (documento nulo), aviso em português, ErrorBlock com fallback, tooltips nos PDFs
2026-11-02 — T-0059 — lint: removido import OrderDetail não usado em web/lib/queries.ts (exceção autorizada pelo gerente)
2026-11-02 — T-0061 — novo pedido de distribuidora: domain de preço (UN/CX, desconto/acréscimo item e pedido, efetivo × alçada, frete CIF/FOB, endereço), app em 3 abas com rodapé, API (receber, aprovado@1, detalhe, sync, transportadoras no BKO), PDFs com Medida/frete/endereço, página Transportadoras; vendedor 470/470 com Postgres; sem escrita de parâmetro (S0-014): recado ao modulo-core
2026-11-02 — T-0061 — RN-VEN-10: alçada pelo efetivo nominal exato (descontoEfetivoAlcadaPct, sem folga), API e app na mesma função; PDF interno do app com desconto/acréscimo do item
2026-11-02 — T-0064 — PDFs (limite de 20 s com erro amigável, CNPJ formatado, nome da tabela e da distribuidora, coluna Medida, frete CIF/FOB), vendedor no card de aprovação do BKO, lista do Campo por mês com mudança de status e seletor de mês, pedido_numero em status_alterado@1 e aprovacao_solicitada@1; timers do Vendedor já limpos na T-0054
2026-11-03 — T-0061 — O-3: opção promotor_ve_pedidos (padrão ligada) — podeLerPedidos no domain, ponto único promotorVePedidos(ctx) na API; lista, detalhe e pull de pedido/item/evento do promotor testados ligada e desligada; escrita segue 403
2026-11-03 — T-0061 — promotor_ve_pedidos: API consulta core.promotor_ve_pedidos@1 a cada requisição (lista/detalhe/pull 403 se desligada); testes unit + db 5434
2026-11-03 — T-0065 — vendedor.pedidos_da_meta@1 publicada (contrato, domain, API, manifest ofereceConsultas); testes unit + db 5434
2026-11-03 — T-0061 — corrige main vermelho: pull do promotor sem tx.consultar usa padrão ligada (teste explícito); manifest coerente; testes 5434 e typecheck verdes
2026-11-03 — T-0061 — opcao-promotor sem padrão 'ligada sem tx.consultar' (erro de montagem); ctx falsos com tx.consultar; pull com opção desligada/ligada testado
2026-11-03 — T-0071 — fatia 2: preço v2 (R$ por unidade, rateio maior resto, pctExibicao), orçamento (validade civil, ações, reconferir, cópia completa, opcoesDoSalvar), sugestões e contratos aditivos; caso §3.2 verde; API/SQL na próxima rodada
2026-11-03 — T-0071 — fatia 5 (API): pré-venda SQL ligada, pull com tipo/validade/janela e 0020, receber com R$ (item e pedido) e RN-VEN-13 de cadastro, PUT/cancelar de orçamento, lista por tipo, conversão com RN-VEN-18, PDF Orçamento; verificação final em andamento
2026-11-03 — T-0071 — fatia 5 (API) verificada: typecheck e lint verdes; vitest dos arquivos tocados (79 testes, 5434) verdes
2026-11-04 — T-0071 — 🟡 cópia só do modo ajuste_em (Transformar/Duplicar passam no receber), manifest com catalogo.sugestoes_pedido@1, embalagens[] no app; fatia 6 (estrutura): 3 abas Itens·Detalhes·Resumo com os componentes do ui, folha do Salvar (opcoesDoSalvar), diálogo Descartar, filtro Pedidos|Orçamentos, textos em lib/textos-pedido (lint, tsc e 154 testes verdes)
2026-11-04 — T-0071 — fatia 6 fechada no app Campo: ajuste em R$ (item e pedido; preço v2 no app, 398,30 → 379,79), tela do orçamento (selo de validade civil, Transformar com reconferência offline, Editar, Duplicar, PDF, cancelar), chip/equivalente/trilha no item e sugestões Combina/Leve mais (catalogo.sugestoes_pedido@1); suíte do vendedor 668/668, lint e tsc verdes
2026-11-04 — T-0071 — revisão de UX da fatia 6: 3 vermelhos (Resumo somente leitura, orçamento confirmado como orçamento, folha do Transformar sempre aberta com a alçada) e amarelos 4 a 16 + 17 a 22 e 24; textos-pedido-ux.test.ts; suíte do Vendedor 688 verdes (5434); fica: item 23 e 3 amarelos do PUT do orçamento (R-20261104-042158)
2026-11-04 — T-0071 — PUT do orçamento idempotente, hash_envio gravado, auditoria com antes real, 3 🟢 da revisão e AvisoRodape no lugar do AvisoRapido
2026-11-04 — T-0071 — UX: detalhe sem pedido com 'Tentar de novo', nota 'Recebido.' removida, avisos sem ponto, na raiz da tela e mostrados no destino após salvar edição
2026-11-04 — T-0071 — CI do PR #86: O-3 corrigido (ponto único {somenteLeitura ? null : (...)} no detalhe do pedido); O5 contradiz a regra RN-VEN-33 (recado ao testes)
2026-11-04 — T-0076 — cards Orçamentos e A faturar no inicio.cards (item pedidos-resumo, ordem 20), domain resumo-inicio, filtro ?filtro= em Pedidos; rodapé do Cliente 360 já só tem [Novo pedido] do Vendedor
2026-11-04 — T-0076/T-0077 — A faturar ajustado (enviado ao ERP/integrado contam, na fila não); domain busca-periodo (+periodoForaDaJanela), SeletorDePeriodo e tela Pedidos com busca, Dia|Mês|Ano e uma linha de situações; export em contracts e recado ao modulo-gestor
2026-11-04 — T-0077 — item 5: seletor de vendedor na OrdersScreen (Gestão), domain filtro-vendedor com teste
2026-11-04 — T-0076 — cards do Início: rótulo com t.rotulo e gap 12 (revisão do designer-ux)
2026-11-04 — T-0077 — R1 (busca sempre em Todos) e amarelos Y1-Y10 na tela Pedidos; Y11 e G1-G3 ficam para depois do APK
2026-11-04 — T-0076 — V1: filtro vindo do card Orçamentos usa orcamentoEmAberto (mesma regra do card); teste lista = contagem do card
2026-11-04 — T-0077 — D1: período por mudança de status usa o último pedido_evento (ultimaMudancaDeStatus), Order.status_changed_at
2026-11-04 — T-0079/T-0077/backlog — aoTrocarGeracao do Vendedor (limpa cópia do servidor, guarda rascunhos e exibições da fila), listagem de pedidos por período com por_status e consulta ao servidor fora dos 90 dias, acabamento de Pedidos (Y11, G1-G3, chip no lugar, Hoje texto, bordas)
2026-11-04 — T-0077 — V1 por_status via pedido_evento (+caso de banco) e V2 poda de exibições órfãs com planoBaseRecriada
2026-11-04 — T-0077 — Y12 a Y14 do designer-ux: resumo some sem resposta fora dos 90 dias, Hoje com Pressionavel do kit, texto do erro impessoal
2026-11-05 — T-0079 — lote A: tirado eslint-disable inexistente em orders-screen.tsx; listagem-periodo.test.ts atualizado para a regra por pedido_evento
2026-11-05 — T-0024 — credito/historico no aprovacao_solicitada@1, conferirEventosPublicados, consumo de integracao.* pelo contracts do dono com leitura tolerante
2026-11-05 — T-0077 — V3 (PedidosPage.parse) e V4 (aviso de 1.000 mais recentes) em orders-screen.tsx
2026-11-05 — T-0077/T-0079 — recados de revisão encerrados (D1, V1, UX já no main; removida baseFoiRecriada)
2026-11-05 — T-0071 — conferência da fatia 6: nenhum código novo necessário no Vendedor (vitest 675/675 fora dos db.test, eslint e tsc json/app verdes); restam integração do orçamento e APK
2026-11-05 — T-0071 — correções do testes: RN-VEN-13 (bloqueado na API e no aparelho), RN-VEN-20 (saldo local na reconferência), rótulo 'Vencido'; preço mínimo (RN-VEN-11) aguarda campos do Core (reforço enviado)
2026-11-05 — T-0071 — V1 a V9 da revisão (teclado Android edge-to-edge, valor pendente, busca antes da trilha, chip de medida por linha, equivalente verde, detalhe do orçamento = tela 5, Vencido na lista, replace após salvar, FlatList em Pedidos): vitest 693 verdes, eslint e tsc (json, web, app) limpos; aguarda conferência no APK
2026-11-05 — T-0071 — RN-VEN-11 ligado em calcularDocumento (preco_venda_cents/desconto_maximo_pct do cadastro_resumo; envio, PUT orçamento e Transformar); gestão: acoesNaTela zera Editar, paraAprovar ignora orçamento; testes
2026-11-05 — T-0071/T-0077 — W1-W4 (digitação, voltar no foco, rolagem do teclado, R$ com ponto), Y1 (aplicação 2 linhas), textoDoVazio extraída
2026-11-05 — T-0071 — RN-VEN-11: precoMinimoBaseCents arredonda para cima (igual ao Core), testes 1890→1607 e 1891→1608
2026-11-05 — T-0071 — V1: valor pendente do campo de quantidade em foco (0 tira o item, número grava) aplicado em Salvar, Avançar, aba e +/−; W1 mantida; testes e checks verdes
2026-11-05 — T-0071/T-0077/T-0079 — triagem de 28 pedidos antigos: 20 encerrados (já no main), 1 feito (PDF imprime 'CNPJ/CPF não informado', teste), 8 abertos com resposta e backlog (slots criar_em_nome e produto.acoes, hook/rodapé nas telas de Pedidos e detalhe, reteste do PDF, número duplicado da demo, V1/V2 da revisão do lote J)
2026-11-05 — T-0071 — revisão do PDF: regex do teste /CNPJ\s*(<|·)/ corrigida e rótulo CPF/CNPJ pelo tamanho do documento, com teste
2026-11-05 — T-0071/T-0052 — Adicionar ao pedido (produto.acoes) com rascunho puro testado e Pedidos (lista e detalhe) no useAtualizacaoAutomatica com rodapé, sem sync.running no refreshing
2026-11-05 — T-0071/T-0052 — produto pendente em memória (sem setParams), aviso de rodapé com Desfazer, sem releitura dobrada, seletor mostra o item; reconferência pedida
2026-11-05 — T-0071/T-0052 — Adicionar ao pedido volta ao editor de origem (edição e ficha, via origem em memória e pendente com editId); Desfazer cobre id@medida; seletor fixa cliente; testes puros
2026-11-05 — T-0055 (backlog R-20261105-164314) — pedido em nome do vendedor (RF-GES-05, RN-VEN-35/10): PedidoPush.vendedor_id, API revalida equipe/área/alçada do gestor/promotor, autor = token, slot pedido.criar_em_nome registrado na Gestão (contracts/extensoes.ts), novo pedido na Gestão com alçada do gestor; testes domain, rota simulada, app e .db (CI); sem coluna nova (autor_id já existe)
2026-11-05 — T-0084 (fatia A, RN-VEN-19) — domain `retratoAplicacao` + parâmetros (testes primeiro), caixa por item no Novo pedido (offline), API grava/corta de novo `pedido_item.aplicacao`, `application` no detalhe/pull/PDFs/BKO e `aplicacao` no `aprovado@1`; pendente: seletor pela `busca_produtos@1` (lote 2 do engenheiro) e revisão do designer-ux.
2026-11-06 — T-0084 — seletor do Novo pedido pela busca do Catálogo (catalogo.busca_produtos@1, Serve em, reserva local), aplicação só dos itens visíveis (cache), voltar 'Ficha' no pedido em nome e PDF com vendedor dono + 'feito por' (domain busca-seletor, pedido-em-nome, pdf-pedido)
2026-11-06 — T-0084 — A3: reserva local da busca do seletor só em ConsultaIndisponivel; outro erro aparece na tela e vai ao log sem dado pessoal; teste dos dois caminhos
2026-11-06 — T-0089/T-0090 — +/− com hitSlop, passo sobre a última quantidade, recarregar sem sobrescrever rascunho; Pedidos: cache da data civil (1309 ms -> <100 ms/500) e useMemo; falta validar no aparelho
2026-11-06 — T-0089/T-0090 — R1 do + (geração de rascunhos, rascunhosAposLeitura), alvo 44x48 dp, 2º toque com foco, troca de medida por ultimo.current
2026-11-06 — T-0090 — Pedidos no modelo A: BotaoFiltro com selo, EtiquetaFiltro, FolhaPeriodo (atalhos + Dia/Mês/Ano) e vendedor na folha (Gestão); domain filtro-periodo (+tipo semana); aviso dos 90 dias só fora da janela, com consulta ao servidor; seletor antigo removido; testes de domain e da folha
2026-11-06 — T-0090 — tela Pedidos: junção servidor+aparelho no período parcial (fila não some), aviso de erro, 'Buscando o restante', etiqueta do vendedor sem período
2026-11-06 — T-0089 — domain preco-item e pagamento (RN-VEN-15/23/24/25/13/12), contratos e API de formas e prazos, retrato no pedido e aprovado@1, BKO de formas, app: Itens em 3 linhas, pagamento no topo, Detalhes com crédito e Leve mais (escondido até o Catálogo publicar faixas); consumidor do Hub pronto, sem registro
2026-11-06 — T-0089 — 4 🟡 do designer-ux: largura UN|CX pelo kit, NO PEDIDO com a busca, prazo médio no cabeçalho, pendências antes do Avançar
2026-11-06 — T-0089 — P5: preço mínimo só trava desconto (itemRespeitaPrecoMinimo) com teste; Leve mais conferido com faixas[]
2026-11-06 — T-0089 — rótulo de navegação 'Formas de pagamento e prazos' alinhado entre web/index.ts e manifesto (shells voltam a montar)
2026-11-07 — T-0090 — 5 🟡 da revisão de UX: resumo da busca com vendedor e etiqueta, chips A faturar/Em aberto voltam a Todos ao escolher período, Banner de aviso no sem sinal/erro, vazio sem sinal explicado, 'Remover filtro <nome>'.
2026-11-07 — T-0090 — Banners de Pedidos: anunciar nos dois avisos e icon=alert no de erro; entrega também cobre os 5 amarelos anteriores; lint/typecheck/test 0
2026-11-07 — T-0089 — pendências do Resumo (PendenciasDoPedido) acima de Cancelar/Salvar, via prop pendencias em AbaResumo
2026-11-07 — T-0114 — vendedor.pedido.cancelado@1 (contrato, teste, publicação na transação do cancelamento, manifesto) e recado ao modulo-integracao
2026-11-08 — T-0114 — RN-VEN-31 (exceção): verificarCancelamento/orderActions com erpAceitaCancelamento; API consulta integracao.cancelamento_erp@1 (opcional), pedido enviado fica com cancelamento solicitado (status intacto + motivo_cancelamento) e evento cancelado com enviado_ao_erp=true; sem telas
2026-11-08 — T-0114 — D-1: diagnóstico e pedido ao engenheiro-software (licença 'tenant' em escrita, ADR 0025); correção do Vendedor aguarda a liberação
2026-11-08 — T-0129 — Frente F: fim da troca silenciosa Boleto→Pix/À vista (padrão só em rascunho novo), forma não aceita desabilitada com motivo, título vencido + prazo a prazo vai ao supervisor no Resumo; testes do domain e do app.
2026-11-08 — T-0127 — Frente D: domain pendenciasDePreenchimento (RN-CORE-36/RN-VEN-16), bloco Falta para salvar no Resumo, bolinha só na aba com pendência, sem Corrigir frete, Salvar desabilitado; crédito do cliente carregado ao abrir o pedido (Resumo mostra supervisor sem passar por Detalhes).
2026-11-08 — T-0114/T-0128 — D-1: cancelar usa { licenca: 'tenant' } (teste da rota); motivo da forma indisponível agora dentro da ListaSuspensa; RN-VEN-38: domain sair-do-pedido, folha Sair do pedido (Voltar do cabeçalho, Voltar do Android, Cancelar), retomada no Início; falta o hook do shell (barra inferior e gesto)
2026-11-08 — T-0135/T-0134 + 🔴 T-0127 — J: validade do orçamento por dataDaValidade (historicoDoOrcamento passa a usar a data civil, não o instante 'ate'); I: preço congelado (precoDoItemNaEdicao/precosCongelados no domain, calcularPedido com congelados, API reaplica o preço salvo na edição e no Transformar, reconferência só estoque/mínimo); T-0127: erro= tirado de Forma/Prazo, leitura TalkBack da aba e do Salvar, textos das pendências do cálculo/pagamento, 'Serve em:' do seletor.
2026-11-08 — T-0136 — Frente K: Novo pedido em 4 abas (Venda · Itens (n) · Entrega · Resumo); domain alertasDaVenda, pendências por aba (Venda/Itens/Entrega), textos-venda, AbaVenda/AbaEntrega/FimDaAbaItens; toque a mais só na K (devolvido pela L).

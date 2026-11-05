# Diário — modulo-core

2026-10-31 — T-0001 — Fase B: esqueleto modules/core, domain e contracts copiados da Fase M, 45 testes verdes
2026-10-31 — T-0001 (B2) — telas web (Clientes, Rotas, Metas, Plano de RV) e app (Rota, Clientes, Metas, ficha) migradas da Fase M; moduloWeb/moduloApp, slots em contracts/extensoes.ts, estado no armazenamento do módulo; 77 testes migrados (core 122); pendências com o engenheiro (ctx.http, ligar nos shells)
2026-10-31 — T-0003 (Fase 1) — domain de licenças/matriz/escopo/fila de módulo desativado e contrato /v1/me/modulos + MODULO_INATIVO; testIDs em docs; alias do Vitest trocado por ui/mobile/puro; core 175 testes
2026-10-31 — T-0003 — moduloEstaAtivo e clienteNoEscopo delegam ao platform-sdk (fonte única); testes verdes
2026-10-31 — T-0003 — Fase 2 do core: API (login/refresh/logout, JWT, bloqueio, carteira, licenças admin, pull cliente/carteira/produto), telas Meus módulos/login/licenças BKO, regra de produto ADR 0005; 237 testes; pendente 0004 (banco) e ErroHttpModulo/ctx.dependencias/ligação no shell (engenheiro)
2026-10-31 — T-0003 — timeout de 30 s nos 2 testes de login com argon2id em autenticacao.test.ts (sem mudar padrão de produção)
2026-10-31 — T-0003 — RN-CORE-14: cliente fechado no checkout (domain/checkout.ts, ContextoCheckout.clienteFechado, foto da fachada no app)
2026-10-31 — T-0003 — ErroHttpModulo 401/423/503, definirCapturaFoto exportada, aparelho de outro tenant = 403, exports de login no web
2026-10-31 — T-0017/T-0018/T-0019/T-0020 (onda 1) — contratos Zod (sync, visita, rota, carteira, cliente360, notificacao, meta, eventos) e domínio puro com testes (checkin, checkout por resultado, cliente360, clientes/escopo, agenda, metas); 328 testes verdes
2026-10-31 — T-0017 — onda 2: 4 amarelos da revisão, 7 provedores com escopo, usuariosVisiveis, rotas clientes/carteira/hierarquia, Cliente 360 e lista offline no app, RN-CORE-15 (423 DISPOSITIVO_BLOQUEADO, tela Aparelhos, limpeza no app); core 409 testes, api 84, fronteiras ok
2026-10-31 — T-0018 (+ páginas BKO da T-0017) — push visita/visita_checkout com RN-CORE-10..14 e idempotência, pull de motivo/rota/rota_parada/visita, rotas/visitas/motivos/coordenadas na API, app só com linhas do aparelho (rota, check-in com justificativa, checkout com foto pela fila de arquivos), BKO: editor de rotas sobre /v1/core, Visitas, Coordenadas, Motivos, Carteira e Cliente 360; 🟢 5–9 fechados
2026-10-31 — T-0017/T-0018/T-0019 (onda 4) — O-5: 423 imediato por requisição (did no JWT); raio do check-in vindo de plataforma.parametro no app (pull parametro); T-0019 notificações completas (API, sync, app, BKO, push atrás de MACUXI_PUSH_ATIVO). T-0020 fase 1 não feita.
2026-10-31 — T-0020 (fase 1) — metas e indicadores: sync meta/indicador_diario, rotas /metas e /indicadores, core.meta.definida@1, painel offline no app e página Indicadores no BKO; 500 testes no core verdes
2026-10-31 — T-0019/T-0022 — lida_em por destinatário no BKO (GET notificacoes/enviadas + tabela em Recados), push como consumidor de core.notificacao.criada@1 (consumidores.ts, timeout 10s), testes com Postgres; D-3 aguarda recado do engenheiro
2026-10-31 — T-0018 — D-3: sobreposição com aceitos (motor.sobreposicao) no app, corrida do fazerCheckin corrigida, teste RN-CORE-11
2026-10-31 — T-0018 — D-5: cargas do Core só toleram 404/501; 401/403/423 propagam (RN-CORE-15)
2026-10-31 — T-0018 — revisão final: janela de rota sem limite superior, for update/lock no push de visita, fuso do ambiente, metas puladas na demo para não vendedor
2026-11-01 — T-0026 — limite de login só conta falhas (10/5 min por IP real + empresa + e-mail, 429 pelo Core), teto geral 300/5 min; trustProxy pelo engenheiro; testes memória + Postgres; doc auth-e-licencas
2026-11-01 — T-0018 — S1-043c: causa é horizonte de 2 s do pull no teste (não duplicação); recado ao testes; vitest do core em série (corrida entre visita.db e carteira.db); core 526 verde
2026-11-01 — T-0030 — Rotas sem /v1/me; Clientes/Metas/Plano de RV viram 'em breve'; core.cadastro_resumo@1 implementada
2026-11-01 — T-0026 — login: botão de olho na senha e mensagens separadas (sem conexão, servidor inválido, credencial)
2026-11-01 — T-0029 — app do Core registra pull de produto (entidades-produto.ts)
2026-11-01 — T-0042 — C6: 'hoje' no fuso do tenant (carteira, rotas, sync, metas, BKO) + hoje-fuso.db.test; C1-C5 sem data fixa/relógio único nos db tests
2026-11-02 — T-0060 (parcial) — carteira opcional no core.cliente.atualizado@1 + domain cadastroCompleto/observacaoComCadastro (RN-CORE-16/17), testes verdes
2026-11-02 — T-0060/T-0061 — contratos do cadastro mínimo, core.cadastro_cliente@1, provedores produto_unidade/cliente_endereco, domain reexportando o contrato
2026-11-02 — T-0060/T-0042/T-0065(B)/T-0062 — consumidor integracao.cliente.atualizado@1 (cadastro_incompleto no core.cliente e no evento), unidade/endereço declarados no app, etiqueta e Observações nas telas (app e BKO), carteira sem plataforma.tenant, domain da apuração por tipo da meta e do preço/margem do produto, refetch do BKO em 5 min
2026-11-02 — T-0066 — consumidores do ERP no Core: vendedor, cliente completo (carteira/contatos/financeiro), produto, título e rota; testes × Postgres; nota pendente da tabela do banco-dados
2026-11-02 — T-0065 (A.3) — push de pedido (aprovado/rejeitado/para aprovar/integrado/faturado) via consumidores do Core, data.entidades no push, timers do BKO em sync_auto_min + botão Atualizar
2026-11-02 — T-0065/T-0062 — push (entidades por tipo, silencioso, meta e rota do dia, numero no titulo), situacao parcial/fechado nas metas (API/app/BKO), produto custo/preco no BKO (rotas produtos + pagina + parametro)
2026-11-02 — T-0066 — produto_external_ids em core.cadastro_resumo@1; timer do relógio do atendimento marcado como exceção (RN-CORE-23)
2026-11-02 — T-0065 — notificarSistema: envio_id uuid determinístico (evento+usuário); core 690/690
2026-11-02 — T-0063 — medidas do produto (RN-CORE-19): domain medida.ts, core.medidas@1, rotas /v1/core/medidas e produtos/:id/medidas, aba Medidas no BKO, sync medida/embalagem, consumidor ERP com embalagem; Core 740 testes verdes (Postgres real)
2026-11-02 — T-0063 — correções da revisão: 🟡3 embalagem x produto_unidade (EMBALAGEM_DIVERGE_ERP no BKO; ERP prevalece no consumidor), 🟡5 teto 2..9999 (domain, Zod de saída, consumidor descarta com log), POST concorrente idempotente (on conflict id); docs/modulos/core/medidas.md
2026-11-02 — T-0061 — endereços de entrega e unidades de venda: consumidores produto_unidade/cliente_endereco (uma padrão/um principal vivos), Cliente 360 (API, app offline, BKO) com endereços e padrão, unidades UN/CX no cadastro de produtos (API+BKO), funções públicas em contracts/enderecos.ts; core 761 testes
2026-11-02 — T-0065 — token de push só do usuário da sessão, logout/DELETE apaga, inativo/bloqueado não recebe (testes PG)
2026-11-02 — T-0042 — urgente: upsertDispositivo não troca dono nem zera token de aparelho bloqueado (RN-CORE-15), where bloqueado_em is null; sessao.test, autenticacao, notificacoes.db, consumidores.db verdes
2026-11-03 — T-0063 — Core devolvido ao origin/main (exceto db/nuvem.ts, do banco-dados); BKO de medidas segue no patch t0063-core.patch para PR separado; testes do Core contra a 0018: 64 arquivos / 692 testes verdes
2026-11-03 — T-0063 — PR do BKO de medidas montado em wt-bko (nuvem/T-0063-medidas-bko, empilhado no #54): core.medidas@1, rotas /medidas, aba Medidas, produto só com medida ativa, embalagem x fator ERP, sync; patch aplicado sem conflito; testes do Core 754 verdes.
2026-11-03 — T-0061 — opção promotor_ve_pedidos (padrão ligado, plataforma.parametro): domain, consulta core.promotor_ve_pedidos@1, rotas admin GET/PUT com auditoria, pull offline, Cliente 360 do app sem pedidos para promotor, painel no BKO; doc promotor-ve-pedidos.md
2026-11-03 — T-0065/T-0063 — 23503 de *_medida_fk vira ReferenciaAusenteErp('medida') nos consumidores de produto_unidade e produto (comMedidaAusente); T-0065 B: painelDoUsuario apura o realizado pelo tipo da meta (apuracao.ts) atrás da porta FontePedidosDaMeta; pedido ao modulo-vendedor (vendedor.pedidos_da_meta@1) e ao banco-dados (core.meta.tipo)
2026-11-03 — T-0066/T-0065 — consumidor integracao.nota.atualizado@1 (core.nota_erp + historico_compra), tipo da meta (contrato, PUT, pull, apuração) e porta FontePedidosDaMeta ligada à consulta vendedor.pedidos_da_meta@1
2026-11-03 — T-0065 — correção: Core sem import de @macuxi/vendedor (espelho mínimo local da consulta vendedor.pedidos_da_meta@1 em api/metas.ts); fronteiras e grafo-turbo ok
2026-11-03 — T-0058 — core.usuarios_resumo@1 (contrato, consulta paginada por cursor sob RLS, manifest, testes contrato e x Postgres 5434)
2026-11-03 — T-0065 B — Core religa vendedor.pedidos_da_meta@1 por usaConsultasOpcionais (ADR 0019); metas.ts sem ramo de erro
2026-11-04 — T-0063 — POST de medidas idempotente na corrida (mesmo id, sigla já gravada); 13/20 verdes no 5434, 7 com queda de conexão do banco; respostas ao Gestor e ao banco sobre o PR #84
2026-11-04 — T-0076 — Início: campos aditivos no core.inicio@1 (saudacao, recados_hoje, meta_hoje, sem_realizado, sincronizacao, equipe_nome, cliente_nome), useNotificacoes exportado; Cliente 360: Última compra única, rodapé só com a ação de destaque, área segura
2026-11-04 — T-0076 — Cliente 360: grade única na ordem da referência, topo sem folga dobrada, 'hoje' minúsculo
2026-11-04 — T-0076 — C1: leitor tolerante (strip recursivo) para core.inicio@1 e login no app do Core; testes de campo extra/obrigatório
2026-11-04 — T-0077 — D2: API do Core revalida promotor_ve_pedidos no Cliente 360 (historico vazio) e no pull de historico_compra (removido); domain perfilRecebeHistoricoDeCompra; teste de banco para o CI
2026-11-04 — T-0077 — D2: fixture do promotor-historico.db.test usa mês livre do c1 (historico_compra_mes_uk)
2026-11-04 — T-0077 — D2: teste de banco inseria em mês já ocupado pelo seed (c1 tem 12 meses); agora usa hoje−12m; D2-a toca updated_at ao ligar e desligar; D2-b linha oculta sem valores; teste incremental
2026-11-04 — T-0073 passo 7 — parâmetros do Início no BKO (GET/PUT parametros/inicio, domain inicio-parametros, painel em Metas e RV, auditoria RN-AUD-01); 🟢 tenant_id explícito em promotor-pedidos.ts
2026-11-04 — T-0073 — passo 7: 7 🟡 do designer-ux no painel Parâmetros do Início (erro no campo, contador, min, salvo success, ajuda dos dias, aria-label, frase em branco)
2026-11-04 — T-0073 — positivação acumulada do mês no fallback do core.inicio@1 (core.positivacao_do_mes), positivadosDoDia + gravarPositivadosDoDia; 🟡 do passo 7 (ErroRegraNegocio RN-CORE-26, erros {campo,mensagem} e painel por chave); parametros-inicio.db.test e indicador-diario.db.test para o CI; 🟢 parametrosInicioDasLinhas no app aguarda destravar
2026-11-04 — T-0039 — checkout validado na API (domain checkout-servidor, contrato etapas-checkout, verificador por consulta, rejeição no push); testes de banco no CI
2026-11-05 — T-0039 — checkout aceita motivo desativado após o checkout offline (RN-CORE-12), domain+api, testes
2026-11-05 — T-0079 — CI A2: pull de parametro inclui as 3 chaves do Início (sync.ts); teste de checkout separado em motivo desativado antes/depois
2026-11-05 — T-0024 — schema core.rota.dia_planejado@1, consumo tolerante de vendedor.pedido.* e integracao.* (helper eventoErp), paradoMinDasLinhas nos contracts
2026-11-05 — T-0073 — Positivação por evento: vendedor.pedido.status_alterado@1 (consumidor existente do Core) recalcula core.indicador_diario via vendedor.pedidos_da_meta@1; domain positivadosPorDia, api/consumidores-positivacao.ts, testes unit e db
2026-11-05 — T-0024 — eventoErp removido; consumidores-erp*.ts usam eventoTolerante(EVENTO_ERP_*) direto do contracts da integração
2026-11-05 — T-0080 — positivação pelas notas do ERP (RN-CORE-27): domain, consumidores e Início; db.test aguarda 0025
2026-11-05 — T-0024 (lote C) — eventoErpTolerante: consumidores do ERP (exceto nota) ignoram payload fora do contrato com aviso em vez de lançar ZodError
2026-11-05 — T-0080 — consumidor de nota usa eventoErpTolerante; registro fora do contrato ignorado com aviso
2026-11-05 — T-0080 — 🔴 revisão lote C: eventoErpTolerante removido, 8 consumidores com eventoTolerante, 3 testes viraram consumidores-erp-contrato.test.ts, trim no vendedor
2026-11-05 — T-0039 — domain puro da tolerância no checkout (checkout-tolerancia.ts + contracts/etapas-pendencia.ts), 14 testes; ligação na API pendente
2026-11-05 — R-20261105-024844 — removida guarda morta e comentário em consumidores-erp-nota.ts (sem mudança de comportamento)
2026-11-05 — T-0039 — textoAlertaPendencia devolve {titulo, corpo} por destinatário conforme docs/design/checkout-pendencia.md
2026-11-05 — T-0080 — D-T0080a: fonte das notas ERP do Início vale pela licença do tenant (integracaoNoTenant), teste da rota sem integracao no perfil
2026-11-05 — T-0039 — checkout-tolerancia.ts importa constante, faixa e tipo de contracts/etapas-pendencia (sem mudar comportamento)
2026-11-05 — T-0039 — BKO da pendência de etapa (filtro, selo, diálogo com dispensa, CSV, prazo do alerta)
2026-11-05 — T-0039 — tolerância do checkout ligada na API: consulta da Pesquisa, avaliarCheckoutTolerante, pendência/contagem, baixa por pesquisa.resposta.registrada@1, alertarPendenciasVencidas (sem agendador ainda), dispensa manual, parâmetro do prazo, etapas_pendentes no pull
2026-11-05 — T-0039 — BKO: prazo da etapa pendente na rota própria checkout-pendencia; diálogo de etapas com erro da API em Notice, autoFocus e contador n/300
2026-11-05 — T-0039 — revisão da API: ordem de trava visita->etapa (deadlock), tarefa periódica alerta_pendencia_checkout (ADR 0022), 3 🟢

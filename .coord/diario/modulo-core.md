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
2026-11-05 — T-0082 — domain plano-rv (RN-CORE-29/30) com 16 testes e contratos Zod do plano; rotas/tela aguardam migração 0028
2026-11-05 — T-0081 — Farol de clientes (RN-CORE-28): domain farol, contratos, GET /v1/core/farol e parametros/farol, tela BKO no lugar de FarolEmBreve; testes locais verdes, db só CI
2026-11-05 — T-0081 — 10 amarelos de UX do Farol no BKO aplicados (filtro vendedor/equipe, vazio, legenda, KPIs clicáveis, atalho de parâmetros, mês máx, CSV, alvos 44px); testes/eslint/tsc verdes
2026-11-05 — T-0083/T-0039 — reexport normalizarEmail/validarSenhaInicial em core/api (RN-CORE-31); marcador de pendência do checkout depende de coluna subtipo (pedida ao banco-dados)
2026-11-05 — T-0082 — Plano de RV: rotas /v1/core/plano-rv (GET/PUT/DELETE, plano_rv.ver/editar) e /v1/core/rv (cálculo na hora pelo domain), domain acrescido (dias úteis do tenant, meses fechados, vigência que não reescreve mês fechado), página BKO Plano de RV (editor, simulador, RV por vendedor, CSV), testes de rota com banco simulado e plano-rv.db.test.ts (CI); app fica para depois (#94)
2026-11-05 — T-0082/T-0081 — UX do Plano de RV (4 vermelhos e maioria dos amarelos), gatilho do mês aberto pela projeção, CSV do Farol e do Plano de RV protegido contra fórmula
2026-11-05 — T-0082/T-0039 — Plano de RV: foco volta ao botão que abriu (efeito pós-commit, fallback Novo plano) e 🟡 baratos; notificação ganha subtipo etapa_pendente_checkout (contrato + pull) e é removida (deleted_at) na baixa/dispensa da pendência; hash barato nos testes de autenticação
2026-11-05 — T-0081/T-0082 — lote de revisão: Farol F1 (+ só com hasNextPage), F2-F5; Plano de RV P1 (bloqueio e DELETE 404 idempotente), P2 (equipe/pessoa como no Farol), prettier e foco; web 138 testes, eslint, tsc e prettier verdes
2026-11-05 — T-0081/T-0082 — defeitos do testes: Farol e RV pela licença do tenant (RN-CORE-27), PUT plano-rv de outro tenant = 404; testes unitários novos
2026-11-05 — T-0026/T-0080 — autenticacao.test.ts não reproduz a falha (6 execuções verdes; suíte do Core 1098 verdes); Início passa a decidir a positivação pelas notas do ERP também pela licença do Vendedor no tenant (vendedorNoTenant, como o Farol), com teste RN-CORE-27
2026-11-05 — T-0082 — R1: GET /v1/core/rv volta a fontePorConsulta(tx); teste de igualdade entre perfis em skip até a opção licenca:'tenant'
2026-11-05 — T-0081 — corrigido import de ROTULO_COR_PLURAL no farol-page + teste do rótulo plural; tsc (3 tsconfigs), vitest web e eslint verdes
2026-11-05 — T-0082/T-0080 — fontePorConsulta com { licenca: 'tenant' } (ADR 0025); teste da mesma RV volta a it; novo teste da fonte
2026-11-05 — T-0071/T-0073 — core.cadastro_resumo@1 ganha produtos[].preco_venda_cents e desconto_maximo_pct efetivo (RN-VEN-11); bloqueado do cliente confirmado na consulta e no pull (RN-VEN-13); testes de contrato e consulta
2026-11-05 — T-0071/T-0073 — consultas-bloqueado.test.ts(47) com ?. (TS2532); comentário do plano-rv.ts atualizado (RV usa licença do tenant); tsc dos 3 tsconfigs limpo
2026-11-05 — T-0081/T-0082 — 🟢/🟡 abertos das revisões: Farol (mês futuro 422, aviso do mês passado, SQL por faixa e push, teste do desligado), Plano de RV (409 no 23505, plano_id por pessoa, confirmação do 1º plano no passado, confirmação ao sair com o editor sujo), licencaDoTenant compartilhado Início/Farol, teste da licença da RV mais forte
2026-11-05 — T-0039/T-0072 — app Campo: chip 'Etapa pendente' na Rota e aviso na ficha (Visit.etapas_pendentes opcional no contrato), tentarCheckin trata falha de gravação (🟡 #94), faixa Em atendimento com sobreEscuro, 🟡 de UX baratos (vazio da Rota/Metas, 1 feita, inbox/camera, ajuda do Registrar check-in); falta Ver fila, variante Gestão e selo do BKO §3.3
2026-11-05 — T-0082 — Minha RV no app Campo (etapa core-rv, montarMinhaRv, cartão em Metas; rv.ver aberto a vendedor/promotor)
2026-11-05 — T-0082/T-0039 — Minha RV (textos do gatilho do BKO, Sincronizar, projetado, chip) e etapa pendente (mais recente com pendência, 'Elas vão') e evitarTeclado no check-in
2026-11-05 — T-0082/T-0072 — cartao-minha-rv usa colors.dangerOnDark; folha do checkout com rolavel; cores à mão do app do Core trocadas por colors.surface/ink
2026-11-05 — T-0082 — Minha RV: Sincronizar sem sinal mostra o aviso padrão (avisoAoSincronizarRv) e não chama o motor; texto do gatilho sem meta mantido no app
2026-11-05 — T-0082 — lote N 🟡: cópia da RV validada com RvLocalSchema (validarCopiaRv; inválida = sem cálculo) + teste
2026-11-06 — T-0087 — fatia P (Core): super-admin de plataforma (domain TOTP/bloqueio/convite, rotas plataforma/auth/*, autenticarSuperAdmin, auditoria sa_auditar) com testes; repositório SQL alinhado à 0035; desenho curto da Equipe por CSV em docs/modulos/core/equipe-csv.md (implementação na tarde)
2026-11-06 — T-0087 — super-admin: node:crypto fora do domain (primitivas injetadas, wrappers na api), ctx.cabecalhos nas rotas públicas
2026-11-06 — T-0087 — super-admin: 423 para qualquer senha durante o bloqueio (sem oráculo) e decidirFalhaSuperAdmin alinhada à 0035; testes novos
2026-11-06 — T-0087 (fatia E) — Equipe por CSV com convite de 1º acesso: domain (15 testes), contratos, rotas equipe/* e auth/convite/aceitar, db.test para o CI, desenho atualizado; pedidos ao engenheiro-apps (telas) e engenheiro-software (revisão)
2026-11-06 — T-0087 — fatia E: 🔴 aceite de convite (senha definida/revogação/desativar), telefone, troca de superior move equipe, testes de banco e doc
2026-11-06 — T-0087 (fatia E) — caminhoDoConvite gera /convite#<token> (fragmento); teste e equipe-csv.md ajustados
2026-11-06 — T-0089 — core.financeiro_cliente@1 (API e aparelho), prazo médio e formas no cliente (pull, resumo, consumidor, BKO), domain RN-VEN-12/13/25 com teste
2026-11-06 — T-0089 — regras de pedido removidas de domain/pagamento-cliente.ts; rota GET /v1/core/formas-pagamento (vendedor.formas_pagamento@1) ligada no Cliente 360 do BKO
2026-11-06 — T-0091 — 8 rotas plataforma/auth/* com conexao 'portal'; handlers só usam sa_*; 2 testes novos
2026-11-07 — T-0093 (fatia C) — RN-CORE-32 no domain (senha.ts) com validarSenhaInicial sobre ela; login do portal só com e-mail e senha (auth/login, auth/empresa, renovar, sair), autenticarPortal, bloqueio por chave HMAC do e-mail; TOTP/convite/primeiro acesso removidos; contratos e docs/modulos/core/super-admin.md
2026-11-07 — T-0093 C / T-0105 — suíte @macuxi/core verde (1228 ok); senhas fracas de outros donos avisadas; 5 avisos hora-fixa zerados (autenticacao.test.ts, notificacoes.db.test.ts)
2026-11-07 — T-0093/T-0095 — Core lê razao_social na lista de empresas (sa_listar_tenants); guarda de ordem (domain/erp-ordem.ts) e vendedor desligado no BKO ligados nos consumidores de vendedor, cliente e produto; depende das colunas pedidas ao banco-dados (R-20261107-175135)
2026-11-07 — T-0094 (fatia C) — ciclo de senha: domain/acesso-senha.ts (72 h, avaliarSenhaDoLogin, validarSenhaNova, podeRedefinirSenha, gerarSenhaTemporaria, podeAcessarBko pelo SDK, usuario.ver sem supervisor); login com app/SENHA_A_TROCAR/410/PERFIL_FORA_DO_APP e 2 conferências; senha/trocar e senha/esqueci (202 igual, limites IP/chave, 15 min); sv no token; Usuários no BKO (criar com senha por e-mail, Redefinir/Enviar acesso, etiquetas); Equipe por CSV sem convite (503 sem e-mail); portal ignora conta com trocar_senha; superficie bko; TelaCrieSuaSenha/TelaEsqueciSenha; e-mail por ctx.email opcional (falso nos testes)
2026-11-07 — T-0094 (fatia C) — fechamento: regex inválida nos testes de usuarios.test.ts corrigida (typecheck), estado dos admins nos fakes, teste de acesso ao BKO alinhado às chaves acesso.* do SDK (supervisor só na Gestão); 🟡 3-5 da T-0095 já no consumidor de vendedor (aviso uma vez por versão, adoção e on conflict com decidirReativacaoDoErp, inativação sem ocorrido_em)
2026-11-08 — T-0111/T-0094 — gerarSenhaTemporaria exportada; perfis de acesso (domain, contratos, rotas, página BKO, multiperfil no usuário e no login); testes de permissão e multi-tenant
2026-11-08 — T-0111 — barra fixa de Perfis de acesso com md:left-[220px] (🔴 do designer-ux)
2026-11-08 — T-0111 — 🔴 redefinição de senha decide por TODOS os perfis do alvo (refsDoUsuario + pode senha.redefinir); editar/desativar usam estado real do tenant e perfis reais (avaliarAlteracaoDeUsuario com estado); 403 PERFIL_FORA_DO_APP e apps do e-mail pelos perfis reais; testes de domain e API (multiperfil, próprio, outro tenant). 9 🟡 de UX ficam para a rodada seguinte.
2026-11-08 — T-0111/T-0094 — lote 2: PUT com perfil legado vira perfis:[perfil] (valida e grava o mesmo estado), botão de senha pelos perfis reais, 3 🟢; 9 🟡 de UX de Perfis (pedidos em interruptores, histórico em palavras no fuso do tenant, módulos na 4ª posição com nome, sem 'Só o que é dele', erro por linha/nome com foco, 404 só no 404, aria-current, Cliente 360, alvos 44px); prévia do usuário sem título de módulos; laranja cru trocado por accentInk/onAccent (senha, Perfis, Recados, Farol, Cliente 360, Carteira, Coordenadas, Rotas)
2026-11-08 — T-0119/T-0094/T-0102/T-0124 — cadastro_resumo@1 com marca/categoria/ean; TelaLogin.emailInicial; slot cliente.avisos na ficha (aditivo); RD-0001 conferido (domain certo, correção é do shell)
2026-11-08 — T-0124 — dias úteis unificados (RN-CORE-26): indicadoresDoPeriodo usa diasUteisRestantes do calendário do tenant (seg–sáb padrão) em Metas, BKO Indicadores e Início; teste no domain; consumidor do vendedor desligado com link null (R-20261108-165615).
2026-11-08 — URGENTE lote 01 — aviso de vendedor desligado: envio_id da notificação agora inclui a versão do registro (alterado_em); corrige consumidores-erp.db.test.ts:242
2026-11-08 — T-0124/T-0111/T-0094 (v1.0.1) — dias úteis pela função única de @macuxi/comum (meta-do-dia, plano-rv); consulta core.calendario_metas@1; meta_hoje com faltam_mes/por_dia_util/dias_uteis_por_dia, recados_hoje.total, campos do Início obrigatórios e sincronizacao retirada (RD-0002/09/12/13); contracts/ciclo-senha.ts único (RD-0019/20/21/22); constantes de perfil repetido/nome (RD-0017), trava do SDK (RD-0015), NIVEIS_ESCOPO/mesmosAlvos (RD-0018), rótulos do SDK (RD-0014 parte Core), ajuda do cancelar (RD-0029); resposta ao vendedor sobre a fila (R-20261108-174304).
2026-11-08 — T-0140 — aplicado o diff do branch da nuvem (linkNavegavel com telaExiste, notificações, OpenVisitBar clienteAtual); relato 5: paridade app × API (144 casos) e sobreposição D-3 sem defeito de regra; recusa do servidor agora fica 10 s na tela com 'O checkout não foi concluído'.
2026-11-08 — T-0124 — necessidadeDiaria movida para contracts (necessidade-diaria.ts); regra da senha movida de domain para contracts/senha-regra.ts (contratos não importam domain); comentário de CalendarioMetasSchema corrigido (RN-CORE-26).
2026-11-09 — T-0120/T-0115 — core.cadastro_resumo@1 aceita cliente_external_ids; canal do cliente (domain canal-cliente, pull, consumidor do ERP, cadastro_resumo.clientes[].canal); comentário de meta-do-dia alinhado; recados T-0140 encerrados
2026-11-09 — T-0122 (R-20261108-220117) — tenantParaExibicao lê nome/fuso de plataforma.tenant_da_sessao() via comTenant (0052); assinatura ganha tenantId; typecheck e testes de login verdes
2026-11-09 — T-0121 — N2: push do Expo via ctx.aposConfirmar em consumidores.ts; naJanela (janelas-sync.ts) nas entidades com janela; testes unitários; resposta ao banco-dados (tenant_da_sessao) encerrada
2026-11-09 — URGENTE CI lote 02 — causa do 500 no checkout achada fora do Core (publico.canais ausente em Pesquisa, publico.ts:58); pedido ao modulo-pesquisa; nenhum arquivo alterado
2026-11-09 — RD-0035/0013/0019/0020/0017/0014 — necessidadeDiaria do contrato em meta-do-dia, VisaoInicio sem recado/notificacoes, acaoDoErroDaTroca única, ehEmail do comum, ERRO_SEM_PERFIL único, rotuloDoPerfil no Plano de RV
2026-11-09 — T-0140 (lote 03) — RD-0020/0032/0042: ehEmail único no erp-mapeamento, linkInternoNavegavel do SDK na central de notificações, somarDiasCivis do @macuxi/comum em agenda e cliente360-local; RD-0019 já entregue (acaoDoErroDaTroca nos contracts)
2026-11-09 — T-0140 — RN-CORE-32: textoDoErroDaSenha (contracts/ciclo-senha.ts) usada no app; RD-0042 (rotas.ts), RD-0032 (teste), RD-0044 (protegerFormula) fechados; RD-0046 (uuid) fica para combinar o novoId com engenheiro-apps
2026-11-09 — T-0117/T-0140 — cookieSessao nas 4 rotas de auth + schemas web sem refresh_token; datas impossíveis em rotas/visitas recusadas no contrato (ehDataCivil); RD-0046: UUID do aparelho vem de motor.ambiente.novoId() (dispositivo.ts sem uuid)
2026-11-09 — T-0140 — RD-0046 fim: gpsAgora e dispositivo.ts removidos; check-in/checkout leem c.motor.ambiente.posicaoAgora() (null = sem GPS, mesma regra); mock do teste ajustado
2026-11-10 — T-0146 — ficha do cliente sem repetição: limite/vencidos só no Financeiro (app e BKO), teste novo
2026-11-10 — T-0151 — ProdutoSync com preco_venda_cents e desconto_maximo_pct efetivo (contrato, pull e toque ao mudar o padrão); vendedor avisado
2026-11-10 — T-0146 — RN-CORE-40: compra média/mês ÷ 12, sem compras em 12 meses, ficha só na janela de 12 meses; RD-0065/0066 aplicados (app e BKO)
2026-11-10 — T-0149 — core.filiais@1, filial no cadastro/cliente/sync/ERP, domain RN-CORE-39, BKO Filiais e linha na ficha; T-0147 — domain RN-CORE-38, tipos no BKO, resumo e pull de fotos, ficha (push de foto e captura pendentes do SDK/shell)
2026-11-10 — T-0152 — RD-0065 (linha de bloqueio só com motivo, 'Motivo do bloqueio: X') e RD-0075 (selo Cadastro incompleto sai da ficha) no app e no BKO; teste novo; reteste pedido
2026-11-10 — T-0147 — 🔴 de UX da ficha (botões em pé, contraste, rótulos), Foto do PDV ligada ao visualizador, UF da filial ^[A-Z]{2}$; push de foto para v1.0.4
2026-11-10 — T-0149 — D-1 RN-CORE-38: só a fachada com arquivo_id para vendedor/promotor (domain, pull, resumo); testes e recados enviados
2026-11-10 — urgente — cliente.tsx: fragmento <> em AcoesContato/BlocoFotosPdv (bundle quebrado)
2026-11-10 — T-0147 — RD-0080 (fachadaDoPdv fonte única) e RD-0081 (subtítulo do BKO) corrigidos; reteste pedido
2026-11-10 — ajuste do rótulo Foto do PDV na ficha (cliente360.tsx), reteste pedido ao designer-ux e corretor
2026-11-10 — T-lote-v1.0.3 — removido import morto mesNaJanela12 de domain/cliente360.test.ts (lint do core sem erros)
2026-11-10 — RN-CORE-38: texto único 'vendedor vê só a fachada' no BKO e cadeado em todo tipo não-fachada na ficha (fotoPdvTrancada)
2026-11-10 — RN-CORE-38: texto único 'vendedor vê só a fachada' no BKO e cadeado em todo tipo não-fachada na ficha (fotoPdvTrancada)
2026-11-10 — T-0147 — envio da foto do PDV: push cliente_foto (receber no sync, cliente_foto 'ambos'), domain (montarFotoPdvPush, apagarArquivoLocalAoEnviar, fotosComPendentes), enviarFotoPdv pela fila de itens e de arquivos, definirCapturaFotoPdv (escolher/camera/galeria) e botão Adicionar na ficha; tem/falta na hora
2026-11-10 — T-0147 — RD-0105: cadeado só em tipo não-fachada com foto; 'Na fila' na ficha para foto enviada ainda não aceita; testes e reteste pedido
2026-11-10 — T-0159 — filial com CNPJ e endereço: contrato core.filiais@1/sync (aditivo), validarFilial (DV do CNPJ, obrigatórios), rotas, consumidor do ERP, BKO e testes; recados ao vendedor e à integração
2026-11-10 — T-0147/RD-0109 — comentários das fotos do PDV alinhados a 'Na fila'/cadeado por fotoPdvTrancada; filtro de pendentes em const única; tsc (3 configs) e eslint do core conferidos
2026-11-11 — T-0159 — RD-0114/0115/0116/0117/0122: LIMITES_FILIAL, CAMPOS_OBRIGATORIOS_FILIAL e CAMPOS_FISCAIS_FILIAL no contrato; faltasNoCadastroDaFilial no domain (validarFilial, API incompleta, web); selo Incompleta no BKO Filiais
2026-11-12 — T-0166 — RD-0180 a RD-0183: caixa de check-in bloqueado sai (toast no toque), faixa de etapa pendente só sem fila, Obrigatória/Falta concluir só após tentar concluir, frases do fora do raio, Sincronize e RN-CORE-17 saem; testes ajustados
2026-11-12 — T-0172 — RN-CORE-40: etapas nomeadas da entrada (domain/entrada-sync.ts, contracts/entrada-sync.ts): nome, número, total, percentual por perfil e módulos efetivos, parada para o Diagnóstico; 10 testes; recados ao engenheiro-apps e ao engenheiro-software
2026-11-13 — T-0168 — RN-VEN-11a: LimiteDescontoSchema/LIMITE_DESCONTO_PADRAO, usuario (sync) e cadastro_resumo@1 aditivo, POST/PUT usuarios com 422 e auditoria, aba Parâmetros no BKO
2026-11-13 — T-0171 — RN-CORE-41: tag única (Bloqueado > Devendo > Pré-Cadastro > Em dia) e só a última visita (domain/lista-clientes.ts, entidade cliente_ultima_visita), filtro "Devendo"
2026-11-13 — T-0171 — regex ultima_visita_data, lista de Clientes (RN-CORE-47), etapas da entrada (RN-CORE-48), export progressoDaEntrada
2026-11-13 — T-0170 — Início do Campo no Core: painel, Metas do mês, Produtividade, sino, Sincronizar (telas/inicio)
2026-11-14 — T-0170/v1.0.6 — MC-0010 (Início e Performance), MC-0012, MC-0014 (STATUS_FILL), retirada do inicio.recado_do_dia_padrao (D2) e costura #149 (itens 1, 2, 3, 4 e 6); branch nuvem/v106-modulo-core
2026-11-14 — RD-0250 — ROTULO_INDICADOR_META no contracts, core usando o mapa; Faturamento só com meta de faturamento
2026-11-14 — ficha-cliente-performance — aba Performance (RN-CORE-50), botão Pesquisa e Checkout só em atendimento (RN-CORE-51)
2026-11-14 — BKO Acesso — Usuários (tabela, gaveta, módulos) e Perfis de acesso (lista, Novo perfil por módulo); branch nuvem/acesso-bko-modulo-core

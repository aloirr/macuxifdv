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

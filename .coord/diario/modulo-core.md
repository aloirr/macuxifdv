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

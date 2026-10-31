# ADR 0006 — API modular: rotas declarativas no platform-sdk, `createApp` e horizonte seguro do pull

- **Status**: aceita
- **Data**: 2026-10-31
- **Tarefa**: T-0004 (desenho: [docs/desenho/T-0004.md](../desenho/T-0004.md) §3–5)
- **Autor**: engenheiro-software

## Contexto
O doc 04 prevê `apps/api` como um Fastify que "carrega os plugins dos módulos ativos", com licença, perfil e escopo de carteira
checados em toda rota (regra 6) e erro 403 `MODULO_INATIVO` para módulo desativado (RN-CORE-02). Se cada módulo escrevesse um
plugin Fastify livre, cada um teria de lembrar as quatro checagens (e o RN-PRO-01), e o módulo passaria a depender do framework.
Além disso, a revisão da T-0002 deixou aberto o cursor do pull: `updated_at` = `now()` do início da transação, e uma transação
longa confirma linhas "atrás" de um cursor já entregue.

## Decisão
1. **Rotas declarativas** em `@macuxi/platform-sdk` (`definirModuloApi`, `RotaModulo`, `ContextoRota`, `ProvedorSync`,
   `ErroRegraNegocio`): o módulo declara método, caminho, `acao` (obrigatória na escrita) ou `perfis`, **escopo de carteira
   obrigatório**, schemas Zod e `executar(ctx)`. O módulo não importa Fastify nem `pg` (`ClienteBanco` é estrutural).
2. **`createApp` aplica a mesma sequência em toda rota**: 401 → efetivos calculados agora → 403 `MODULO_INATIVO` → RN-PRO-01
   → ação/perfis 403 `PERFIL_SEM_ACESSO` → Zod 400 → carteira 403 `FORA_DA_CARTEIRA` → `executar`. Regra de negócio = 422 com o
   código da RN. Portas com padrão que falha fechado (sem autenticação do Core ninguém entra; sem carteira só escopo tenant).
3. **Banco só por `ctx.comTenant`** com o tenant do token e papel `macuxi_app`; a API não sobe com outro papel. Eventos são
   gravados na outbox **na mesma transação** (`tx.publicar`).
4. **Core é o único com rotas públicas** (login/refresh, limite de tentativas obrigatório) e com os serviços `autenticar` e
   `carteira`; `/v1/me/modulos` e `/v1/sync/*` são da plataforma.
5. **Horizonte seguro do pull**: `least(now() − 2 s, início da transação aberta mais antiga)`; o módulo só devolve linhas abaixo
   dele e a plataforma corta de novo. Transação longa atrasa o pull, nunca faz perder linha.

## Alternativas consideradas
- **Plugin Fastify livre por módulo**: mais flexível, mas cada módulo reimplementa (e pode esquecer) licença, perfil, carteira e
  RN-PRO-01; acopla os módulos ao Fastify. Fica possível como escape futuro (nova ADR) para casos como upload em streaming.
- **Checagens num `preHandler` global por prefixo de URL**: não sabe a ação nem o cliente da rota; vira tabela paralela ao manifesto.
- **Cursor por `xid`/`xmin`**: exato, mas `xmin` é 32 bits, sofre *freeze* e não tem ordem estável entre linhas; **margem fixa**:
  perde linha quando a transação passa da margem; **`clock_timestamp()` no gatilho**: reduz, não elimina, a janela.

## Consequências
- Módulos ganham rotas sem tocar `apps/api`: basta exportar `moduloApi` (uma linha em `apps/api/src/modulos.ts` só para módulo novo).
- O Core (T-0003 Fase 2) entrega `servicos.autenticar` (JWT), `servicos.carteira` (RN-CORE-04) e `rotasPublicas` de login.
- Toda escrita que gera evento usa `ctx.comTenant((db, tx) => …)` e `tx.publicar`.
- O provedor de pull filtra `updated_at < pedido.ate` e formata `updated_at` com microssegundos.
- O limite de tentativas é em memória (uma instância); com escala horizontal, troca por contador compartilhado (mesma interface).

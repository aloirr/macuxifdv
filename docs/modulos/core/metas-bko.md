# BKO de metas (T-0068) — desenho

Tela "Metas e RV" (`web/index.ts`, página `metas`, hoje `MetasEmBreve`) passa a ser `MetasPage`. Plano de RV segue "em breve".

## O que já existe (reusar)
- `GET /v1/core/metas?periodo&usuario_id` (`api/metas.ts`, `meta.ver`, escopo por `usuariosVisiveis`): lista `{usuario_id, indicador, valor, tipo}`.
- `PUT /v1/core/metas/:usuarioId/:periodo` (`meta.editar`, corpo `PutMetaSchema {indicador, valor, tipo?}`): upsert em `core.meta`, valida RN-CORE-20 (cobertura ≤ 10000) e RN-CORE-21 (faturamento só em `venda_cents`), publica `core.meta.definida@1`, audita `meta.editar`. Hoje checa só `visiveis` (escopo de LEITURA).
- `GET /v1/core/indicadores?periodo&usuario_id` → `calcularIndicadores(db, visiveis, agora, fuso, q, fontePorConsulta(tx))`: realizado e `atingimento_pct` (pontos-base) via domínio `painelDoUsuario` + `vendedor.pedidos_da_meta@1`, a mesma apuração do app. Traz `situacao` parcial/fechado (RN-CORE-21).
- `GET /v1/core/equipes` e `GET /v1/core/usuarios` (`usuario.ver`: supervisor, gerente, admin), com filtro `equipe_id`.
- Domínio: `hierarquia.ts` (`subordinadosDe`, `montarHierarquia`), `escopoDeUsuarios`; helpers web `lib/indicadores.ts` (`centavosDoTexto`, CSV), `lib/usuarios.ts`, `lib/queries.ts`; contratos `contracts/meta.ts`, `contracts/usuarios.ts`.
- Pull do app já inclui `core.meta` (com `tipo`): meta nova chega sem mudança no sync.

## Lacunas / decisões
- Manifest: `meta.editar` = supervisor, gerente, analista, admin (decisão do doc 03, T-0068); assistente só lê. `meta.ver` já inclui analista.
- Escopo de EDIÇÃO: supervisor = ele + equipe que responde; gerente = + equipes abaixo; analista e admin = tenant. Hoje `usuariosVisiveis` dá tenant ao analista, então a edição NÃO pode usar só `visiveis`: nova função de domínio.
- Meta de equipe NÃO tem coluna: `core.meta` é por `usuario_id` (`meta_uk`). "Meta por equipe" = aplicar o mesmo valor a todos os vendedores/promotores ativos da equipe (lote), gravando uma linha por usuário. Sem migração.
- Mês e `periodo` AAAA-MM no fuso do tenant (`dataLocal(agora, fuso)`); valores em centavos (`venda_cents`); `positivacao`/`visitas` são contagens; `cobertura_pct` em pontos-base.

## Domínio (teste antes, `it('RN-CORE-20: ...')`)
`domain/metas-edicao.ts`: `podeEditarMetaDe({perfil, alvoId, editorId, equipe, equipesAbaixo}) -> {ok} | {ok:false, codigo:'META_FORA_DA_EQUIPE'|'META_SEM_PERMISSAO', mensagem}`; reusa `escopoDeUsuarios` ignorando o atalho do analista. Regras: supervisor só equipe; gerente equipes abaixo; analista e admin todos; assistente, vendedor e promotor nunca. Mais `expandirEquipe` (alvos válidos: ativos, perfil vendedor/promotor) e `copiarMetas(anterior, destino)` (opcional).

## API (plugin `/v1/core`)
- `GET /metas/painel?periodo&equipe_id&usuario_id`: junta metas + indicadores em linhas `{usuario_id, usuario_nome, equipe_id, indicador, tipo, meta, realizado, atingimento_pct}` + `situacao`, `editavel` por linha (domínio). Chama `calcularIndicadores`.
- `PUT /metas/:usuarioId/:periodo`: passa a validar `podeEditarMetaDe` (403 fora da equipe), mantém o restante.
- `PUT /metas/equipe/:equipeId/:periodo` (lote, `MetaEquipeSchema = PutMetaSchema`): uma transação, uma auditoria `meta.editar_equipe` com lista de usuários, um `core.meta.definida@1` por usuário.
- Opcional: `POST /metas/copiar {de, para, equipe_id?}` (não sobrescreve metas existentes).
- Contratos novos em `contracts/meta.ts`: `PainelMetasBkoSchema`, `MetaEquipeParamsSchema`, `CopiarMetasSchema`.

## Web (`web/components/metas/`, `web/lib/metas.ts`)
`MetasPage`: filtros na URL (`mes`, `equipe`), tabela densa (vendedor, indicador, tipo, meta, realizado, %), badge parcial/fechado, edição em linha e modal "Meta da equipe", CSV, botões só para quem tem `meta.editar`. Funções puras testadas em `lib/metas.ts` (linhas, formatação em R$, CSV).

## Plano de implementação
1) manifest (`meta.editar`) + domínio e testes; 2) contratos; 3) API (painel, guarda de edição, lote, auditoria) + testes db; 4) web lib + página + registro em `index.ts`; 5) docs/banco sem mudança; 6) lint/typecheck/test, entrega.

## Premissas
Sem migração; "equipe" = `core.equipe` do usuário; linhas sem meta aparecem com meta 0 e atingimento nulo; recado ao `banco-dados` só se surgir meta persistida por equipe.

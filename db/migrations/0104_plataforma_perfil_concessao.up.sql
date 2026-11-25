-- 0104_plataforma_perfil_concessao (up) — v1.0.35, etapa E2 do plano docs/banco/plano-migracao-perfis-sem-base.md (§2), ADR 0073
-- (aceita em 24/11/2026, R-20261124-191902-alexandre; ordem R-20261125-033510-alexandre). RN-CORE-04, RN-CORE-33, RN-CORE-35,
-- RN-PRO-01. Dicionário: docs/banco/plataforma.md ("0104 a 0106 — perfis sem perfil base") e docs/banco/rls.md.
-- Migração ADITIVA: 4 tabelas novas, a cópia v1 dos 7 modelos e as travas por cargo. Nada que existe muda de comportamento
-- (perfil, perfil_permissao, usuario_perfil e core.usuario.perfil seguem como estão; a API de hoje não lê as tabelas novas).
--
-- 1. plataforma.modelo_permissao — os 7 modelos de perfil (ADR 0073 §2.3): cópia CONGELADA do SDK
--    (matrizDeFabrica com os 8 manifestos, packages/platform-sdk/src/permissoes-perfil.ts no main de 25/11/2026, que a E1 renomeia
--    para modelosDePerfil). Versão 1 = 406 linhas (vendedor 29, promotor 33, supervisor 50, gerente 64, analista 97,
--    assistente 22, admin 111). SEM tenant_id (catálogo da plataforma, como plataforma.plano; exceção em db/src/excecoes.ts e
--    db/scripts/conferir-rls.sql). Id determinístico plataforma.uuid_de_chave('plataforma.modelo_permissao:<versao>:<modelo>:<chave>').
--    O teste db/testes/perfis-sem-base-equivalencia-sdk.db.test.ts compara estas linhas com o SDK. A requisição nunca lê esta
--    tabela: ela serve à migração, à semeadura e ao "copiar de um modelo". Versões seguintes entram por migração nova.
-- 2. plataforma.perfil_concessao — o que está marcado no perfil (ADR 0073 §2.1). Só a concessão vira linha; desmarcar = soft
--    delete. Única viva por (tenant, perfil, chave). dados.escopo leva nível de escopo obrigatório. Travas por CARGO no gatilho
--    perfil_concessao_travas (imediato, 23514, hint = a RN; cópia de ADR 0073 §2.5 itens 1, 2, 3 e 5): RN-PRO-01 (escrita de
--    pedido no cargo promotor), RN-CORE-33 (acesso.bko nos cargos vendedor, promotor e supervisor; acesso.portal fora do cargo
--    administrativo), apps (acesso.campo fora de vendedor e promotor; acesso.gestao fora de supervisor e gerente; RN-CORE-33 revista) e
--    RN-CORE-04 (dados.escopo acima do teto do cargo, plataforma.teto_escopo_do_cargo). O que depende do conjunto (portal só com a
--    gestão completa, perfil ativo com algum acesso.*, último admin) fica no domain e na API do Core nesta versão; no banco, a
--    migração confere (0105).
-- 3. plataforma.catalogo_aplicado — versão do catálogo aplicada ao tenant e a CHAVE DA TRANSIÇÃO: leitura 'legado' (ou sem
--    linha) = o tenant segue no modelo de hoje (fábrica + sobreposições); 'concessao' = migrado (perfil_concessao vale).
--    Única viva por (tenant, versao). plataforma.leitura_de_perfis(tenant) devolve 'legado' ou 'concessao'.
-- 4. plataforma.perfil_migracao_conflito — o que a migração achou num tenant (plano §4.4): tipo, efeito ('para_tenant' segura o
--    tenant em 'legado'; 'ajustado' = a migração acertou o perfil sem usuários, decisão 3 da ADR 0073 §2.0; 'aviso' = vai na
--    lista do tenant, decisão 5), perfil (id e código), chave, antes e depois. Sem dado pessoal (ids e códigos). O macuxi_app
--    só lê.
-- RLS: as 3 tabelas de tenant com isolamento_tenant (macuxi_app; nos achados só há o grant de SELECT), manutencao (0031) e
-- leitura (0078; SELECT por coluna sem a coluna `chave`, que o padrão da 0078 trata como sensível pelo nome). FKs para o perfil:
-- a concessão sai junto com o perfil apagado fisicamente (on delete cascade; o macuxi_app não apaga perfil); o achado fica, sem
-- o perfil_id (on delete set null (perfil_id)), com o código. modelo_permissao: SELECT do macuxi_app nas linhas vivas, com
-- contexto de tenant (política isolamento_tenant, só select) e manutencao. Worker e portal: nada. Nenhuma das 4 entra no sync (TABELAS_FORA_DO_SYNC): sem o
-- índice (tenant_id, updated_at, id).
-- Volume: ~400 a 1.500 concessões por tenant (7 a 20 perfis); teto de projeto ~1,5 milhão de linhas.
--
-- Caminho de volta: 0104_plataforma_perfil_concessao.down.sql (apaga as 4 tabelas e as funções desta migração). O migrador desce
-- antes a 0106 e a 0105.

-- 0. Teto do escopo de dados e trava de uma chave, pelo cargo (ADR 0073 §2.4 e §2.5) ------------------------------------------
create function plataforma.teto_escopo_do_cargo(p_cargo text) returns text
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$
    select case p_cargo
             when 'vendedor' then 'carteira'
             when 'promotor' then 'carteira'
             when 'supervisor' then 'equipe'
             when 'gerente' then 'equipes_abaixo'
             when 'administrativo' then 'tenant'
           end
  $$;
revoke all on function plataforma.teto_escopo_do_cargo(text) from public;
grant execute on function plataforma.teto_escopo_do_cargo(text) to macuxi_app;

-- Só o que não depende do conjunto (itens 1, 2, 3 e 5 do §2.5). Devolve a RN ou null. O regex de escrita de pedido é o da 0041
-- (ehAcaoDeEscritaDePedido do SDK).
create function plataforma.trava_da_chave_do_cargo(p_cargo text, p_chave text, p_nivel text) returns text
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$
    select case
             when p_cargo = 'promotor' and p_chave ~ '^pedido(_[a-z0-9_]+)?\.' and split_part(p_chave, '.', 2) <> 'ver' then 'RN-PRO-01'
             when p_chave = 'acesso.bko' and p_cargo in ('vendedor', 'promotor', 'supervisor') then 'RN-CORE-33'
             when p_chave = 'acesso.portal' and p_cargo <> 'administrativo' then 'RN-CORE-33'
             when p_chave = 'acesso.campo' and p_cargo not in ('vendedor', 'promotor') then 'RN-CORE-33'
             when p_chave = 'acesso.gestao' and p_cargo not in ('supervisor', 'gerente') then 'RN-CORE-33'
             when p_chave = 'dados.escopo'
                  and array_position(array['proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant'], p_nivel)
                    > array_position(array['proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant'], plataforma.teto_escopo_do_cargo(p_cargo))
               then 'RN-CORE-04'
           end
  $$;
revoke all on function plataforma.trava_da_chave_do_cargo(text, text, text) from public;
grant execute on function plataforma.trava_da_chave_do_cargo(text, text, text) to macuxi_app;

-- 1. plataforma.modelo_permissao -----------------------------------------------------------------------------------------
create table plataforma.modelo_permissao (
  id          uuid primary key,
  versao      integer not null,
  modelo      text not null,
  cargo       text not null,
  chave       text not null,
  nivel       text,
  alvos       text[],
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  external_id text,
  constraint modelo_permissao_versao_valida check (versao >= 1),
  constraint modelo_permissao_modelo_valido
    check (modelo in ('vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin')),
  constraint modelo_permissao_cargo_valido check (cargo in ('vendedor', 'promotor', 'supervisor', 'gerente', 'administrativo')),
  constraint modelo_permissao_chave_formato check (chave ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  constraint modelo_permissao_nivel_valido
    check (nivel is null or nivel in ('proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant', 'ate_alcada', 'acima_alcada')),
  constraint modelo_permissao_nivel_escopo
    check (chave <> 'dados.escopo' or coalesce(nivel in ('proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant'), false)),
  constraint modelo_permissao_alvos_formato check (alvos is null or (
    cardinality(alvos) between 1 and 50 and array_position(alvos, null) is null
    and array_to_string(alvos, ',') ~ '^(\*|[a-z][a-z0-9_]{1,39})(,(\*|[a-z][a-z0-9_]{1,39}))*$')),
  constraint modelo_permissao_uk unique (versao, modelo, chave)
);
create trigger modelo_permissao_updated_at before update on plataforma.modelo_permissao
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.modelo_permissao enable row level security;
alter table plataforma.modelo_permissao force row level security;
-- o app lê as linhas vivas só no contexto de um tenant (sem contexto = 0 linhas, falha fechada como nas tabelas de tenant)
create policy isolamento_tenant on plataforma.modelo_permissao for select to macuxi_app
  using (deleted_at is null and exists (select 1 from plataforma.tenant t where t.id = plataforma.tenant_atual()));
create policy manutencao on plataforma.modelo_permissao for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.modelo_permissao from public;
grant select on plataforma.modelo_permissao to macuxi_app;

-- Versão 1 (modelo, cargo, chave, nível, alvos), na ordem de PERFIS e da chave. Gerada do SDK; nunca editar (migração aplicada).
insert into plataforma.modelo_permissao (id, versao, modelo, cargo, chave, nivel, alvos)
select plataforma.uuid_de_chave('plataforma.modelo_permissao:1:' || v.modelo || ':' || v.chave), 1, v.modelo, v.cargo, v.chave,
       v.nivel, v.alvos::text[]
  from (values
  ('vendedor', 'vendedor', 'acesso.campo', null, null),
  ('vendedor', 'vendedor', 'app.atualizar', null, null),
  ('vendedor', 'vendedor', 'cliente.pre_cadastrar', null, null),
  ('vendedor', 'vendedor', 'cliente_foto.enviar', null, null),
  ('vendedor', 'vendedor', 'cliente_foto.ver', null, null),
  ('vendedor', 'vendedor', 'dados.escopo', 'carteira', null),
  ('vendedor', 'vendedor', 'dispositivo.registrar_push', null, null),
  ('vendedor', 'vendedor', 'documento.ver', null, null),
  ('vendedor', 'vendedor', 'filial.ver', null, null),
  ('vendedor', 'vendedor', 'inicio.ver', null, null),
  ('vendedor', 'vendedor', 'licao.concluir', null, null),
  ('vendedor', 'vendedor', 'meta.ver', null, null),
  ('vendedor', 'vendedor', 'notificacao.ler', null, null),
  ('vendedor', 'vendedor', 'pedido.cancelar', null, null),
  ('vendedor', 'vendedor', 'pedido.criar', null, null),
  ('vendedor', 'vendedor', 'pedido.editar', null, null),
  ('vendedor', 'vendedor', 'pedido.excluir', null, null),
  ('vendedor', 'vendedor', 'pedido.ver', null, null),
  ('vendedor', 'vendedor', 'pesquisa.responder', null, null),
  ('vendedor', 'vendedor', 'produto.consultar', null, null),
  ('vendedor', 'vendedor', 'produto.perguntar', null, null),
  ('vendedor', 'vendedor', 'produto.ver_preco_estoque', null, null),
  ('vendedor', 'vendedor', 'quiz.responder', null, null),
  ('vendedor', 'vendedor', 'ranking.ver', null, null),
  ('vendedor', 'vendedor', 'rv.ver', null, null),
  ('vendedor', 'vendedor', 'tarefa.concluir', null, null),
  ('vendedor', 'vendedor', 'trilha.baixar_offline', null, null),
  ('vendedor', 'vendedor', 'usuario_avatar.trocar', null, null),
  ('vendedor', 'vendedor', 'visita.checkin_fora_de_rota', null, null),
  ('promotor', 'promotor', 'acesso.campo', null, null),
  ('promotor', 'promotor', 'app.atualizar', null, null),
  ('promotor', 'promotor', 'checklist_loja.responder', null, null),
  ('promotor', 'promotor', 'cliente_foto.enviar', null, null),
  ('promotor', 'promotor', 'cliente_foto.ver', null, null),
  ('promotor', 'promotor', 'coleta.registrar', null, null),
  ('promotor', 'promotor', 'concorrencia.registrar', null, null),
  ('promotor', 'promotor', 'dados.escopo', 'carteira', null),
  ('promotor', 'promotor', 'dispositivo.registrar_push', null, null),
  ('promotor', 'promotor', 'documento.ver', null, null),
  ('promotor', 'promotor', 'filial.ver', null, null),
  ('promotor', 'promotor', 'gondola.registrar', null, null),
  ('promotor', 'promotor', 'inicio.ver', null, null),
  ('promotor', 'promotor', 'licao.concluir', null, null),
  ('promotor', 'promotor', 'meta.ver', null, null),
  ('promotor', 'promotor', 'notificacao.ler', null, null),
  ('promotor', 'promotor', 'pedido.ver', null, null),
  ('promotor', 'promotor', 'pesquisa.responder', null, null),
  ('promotor', 'promotor', 'ponto_extra.registrar', null, null),
  ('promotor', 'promotor', 'preco.registrar', null, null),
  ('promotor', 'promotor', 'produto.consultar', null, null),
  ('promotor', 'promotor', 'produto.perguntar', null, null),
  ('promotor', 'promotor', 'quiz.responder', null, null),
  ('promotor', 'promotor', 'ranking.ver', null, null),
  ('promotor', 'promotor', 'ruptura.registrar', null, null),
  ('promotor', 'promotor', 'rv.ver', null, null),
  ('promotor', 'promotor', 'share.registrar', null, null),
  ('promotor', 'promotor', 'tarefa.concluir', null, null),
  ('promotor', 'promotor', 'tarefa_trade.concluir', null, null),
  ('promotor', 'promotor', 'trilha.baixar_offline', null, null),
  ('promotor', 'promotor', 'usuario_avatar.trocar', null, null),
  ('promotor', 'promotor', 'validade.registrar', null, null),
  ('promotor', 'promotor', 'visita.checkin_fora_de_rota', null, null),
  ('supervisor', 'supervisor', 'acesso.gestao', null, null),
  ('supervisor', 'supervisor', 'adesao.ver', null, null),
  ('supervisor', 'supervisor', 'alerta_equipe.dispensar', null, null),
  ('supervisor', 'supervisor', 'alerta_equipe.ver', null, null),
  ('supervisor', 'supervisor', 'app.atualizar', null, null),
  ('supervisor', 'supervisor', 'ausencia.cadastrar', null, null),
  ('supervisor', 'supervisor', 'cliente.pre_cadastrar', null, null),
  ('supervisor', 'supervisor', 'cliente_foto.enviar', null, null),
  ('supervisor', 'supervisor', 'cliente_foto.ver', null, null),
  ('supervisor', 'supervisor', 'dados.escopo', 'equipe', null),
  ('supervisor', 'supervisor', 'dispositivo.registrar_push', null, null),
  ('supervisor', 'supervisor', 'documento.ver', null, null),
  ('supervisor', 'supervisor', 'farol.ver', null, null),
  ('supervisor', 'supervisor', 'fila_aprovacao.decidir', null, null),
  ('supervisor', 'supervisor', 'fila_aprovacao.ver', null, null),
  ('supervisor', 'supervisor', 'filial.ver', null, null),
  ('supervisor', 'supervisor', 'inicio.ver', null, null),
  ('supervisor', 'supervisor', 'licao.concluir', null, null),
  ('supervisor', 'supervisor', 'meta.editar', null, null),
  ('supervisor', 'supervisor', 'meta.ver', null, null),
  ('supervisor', 'supervisor', 'notas.ver', null, null),
  ('supervisor', 'supervisor', 'notificacao.enviar', null, null),
  ('supervisor', 'supervisor', 'notificacao.ler', null, null),
  ('supervisor', 'supervisor', 'notificacao.recado_do_dia', null, null),
  ('supervisor', 'supervisor', 'painel_equipe.ver', null, null),
  ('supervisor', 'supervisor', 'pedido.aprovar', null, null),
  ('supervisor', 'supervisor', 'pedido.cancelar', null, null),
  ('supervisor', 'supervisor', 'pedido.criar', null, null),
  ('supervisor', 'supervisor', 'pedido.criar_em_nome', null, null),
  ('supervisor', 'supervisor', 'pedido.editar', null, null),
  ('supervisor', 'supervisor', 'pedido.excluir', null, null),
  ('supervisor', 'supervisor', 'pedido.ver', null, null),
  ('supervisor', 'supervisor', 'pesquisa.responder', null, null),
  ('supervisor', 'supervisor', 'plano_rv.ver', null, null),
  ('supervisor', 'supervisor', 'produto.consultar', null, null),
  ('supervisor', 'supervisor', 'produto.perguntar', null, null),
  ('supervisor', 'supervisor', 'produto.ver_preco_estoque', null, null),
  ('supervisor', 'supervisor', 'quiz.responder', null, null),
  ('supervisor', 'supervisor', 'ranking.ver', null, null),
  ('supervisor', 'supervisor', 'ranking_equipe.ver', null, null),
  ('supervisor', 'supervisor', 'resultado.exportar', null, null),
  ('supervisor', 'supervisor', 'resultado.ver', null, null),
  ('supervisor', 'supervisor', 'rv.ver', null, null),
  ('supervisor', 'supervisor', 'trajeto.ver_equipe', null, null),
  ('supervisor', 'supervisor', 'transportadora.ver', null, null),
  ('supervisor', 'supervisor', 'trilha.baixar_offline', null, null),
  ('supervisor', 'supervisor', 'usuario_avatar.trocar', null, null),
  ('supervisor', 'supervisor', 'visita.checkin_fora_de_rota', null, null),
  ('supervisor', 'supervisor', 'visita.dispensar_etapa', null, null),
  ('supervisor', 'supervisor', 'visita.registrar_gestao', null, null),
  ('gerente', 'gerente', 'acesso.bko', null, null),
  ('gerente', 'gerente', 'acesso.gestao', null, null),
  ('gerente', 'gerente', 'adesao.ver', null, null),
  ('gerente', 'gerente', 'alcada.gerenciar', null, null),
  ('gerente', 'gerente', 'alerta_equipe.dispensar', null, null),
  ('gerente', 'gerente', 'alerta_equipe.ver', null, null),
  ('gerente', 'gerente', 'app.atualizar', null, null),
  ('gerente', 'gerente', 'ausencia.cadastrar', null, null),
  ('gerente', 'gerente', 'cliente.pre_cadastrar', null, null),
  ('gerente', 'gerente', 'cliente_foto.enviar', null, null),
  ('gerente', 'gerente', 'cliente_foto.ver', null, null),
  ('gerente', 'gerente', 'dados.escopo', 'equipes_abaixo', null),
  ('gerente', 'gerente', 'dispositivo.registrar_push', null, null),
  ('gerente', 'gerente', 'documento.ver', null, null),
  ('gerente', 'gerente', 'farol.ver', null, null),
  ('gerente', 'gerente', 'fila_aprovacao.decidir', null, null),
  ('gerente', 'gerente', 'fila_aprovacao.ver', null, null),
  ('gerente', 'gerente', 'filial.ver', null, null),
  ('gerente', 'gerente', 'forma_pagamento.gerenciar', null, null),
  ('gerente', 'gerente', 'forma_pagamento.ver', null, null),
  ('gerente', 'gerente', 'inicio.ver', null, null),
  ('gerente', 'gerente', 'inicio_bko.ver', null, null),
  ('gerente', 'gerente', 'licao.concluir', null, null),
  ('gerente', 'gerente', 'meta.editar', null, null),
  ('gerente', 'gerente', 'meta.fechar_periodo', null, null),
  ('gerente', 'gerente', 'meta.ver', null, null),
  ('gerente', 'gerente', 'meta_produtividade.editar', null, null),
  ('gerente', 'gerente', 'notas.ver', null, null),
  ('gerente', 'gerente', 'notificacao.enviar', null, null),
  ('gerente', 'gerente', 'notificacao.ler', null, null),
  ('gerente', 'gerente', 'notificacao.recado_do_dia', null, null),
  ('gerente', 'gerente', 'painel_equipe.ver', null, null),
  ('gerente', 'gerente', 'pedido.aprovar', null, null),
  ('gerente', 'gerente', 'pedido.cancelar', null, null),
  ('gerente', 'gerente', 'pedido.criar', null, null),
  ('gerente', 'gerente', 'pedido.criar_em_nome', null, null),
  ('gerente', 'gerente', 'pedido.editar', null, null),
  ('gerente', 'gerente', 'pedido.excluir', null, null),
  ('gerente', 'gerente', 'pedido.ver', null, null),
  ('gerente', 'gerente', 'pesquisa.responder', null, null),
  ('gerente', 'gerente', 'plano_rv.ver', null, null),
  ('gerente', 'gerente', 'produto.consultar', null, null),
  ('gerente', 'gerente', 'produto.editar_preco', null, null),
  ('gerente', 'gerente', 'produto.perguntar', null, null),
  ('gerente', 'gerente', 'produto.ver_preco_estoque', null, null),
  ('gerente', 'gerente', 'quiz.responder', null, null),
  ('gerente', 'gerente', 'ranking.ver', null, null),
  ('gerente', 'gerente', 'ranking_equipe.ver', null, null),
  ('gerente', 'gerente', 'resultado.exportar', null, null),
  ('gerente', 'gerente', 'resultado.ver', null, null),
  ('gerente', 'gerente', 'rota.editar', null, null),
  ('gerente', 'gerente', 'rv.ver', null, null),
  ('gerente', 'gerente', 'tarefa.acompanhar', null, null),
  ('gerente', 'gerente', 'tarefa.cancelar', null, null),
  ('gerente', 'gerente', 'tarefa.criar', null, null),
  ('gerente', 'gerente', 'tarefa.editar', null, null),
  ('gerente', 'gerente', 'trajeto.ver_equipe', null, null),
  ('gerente', 'gerente', 'transportadora.gerenciar', null, null),
  ('gerente', 'gerente', 'transportadora.ver', null, null),
  ('gerente', 'gerente', 'trilha.baixar_offline', null, null),
  ('gerente', 'gerente', 'usuario.ver', null, null),
  ('gerente', 'gerente', 'usuario_avatar.trocar', null, null),
  ('gerente', 'gerente', 'visita.checkin_fora_de_rota', null, null),
  ('gerente', 'gerente', 'visita.registrar_gestao', null, null),
  ('analista', 'administrativo', 'acesso.bko', null, null),
  ('analista', 'administrativo', 'adesao.ver', null, null),
  ('analista', 'administrativo', 'alcada.gerenciar', null, null),
  ('analista', 'administrativo', 'alerta_regra.gerenciar', null, null),
  ('analista', 'administrativo', 'busca.ver_sem_resultado', null, null),
  ('analista', 'administrativo', 'carteira.editar', null, null),
  ('analista', 'administrativo', 'categoria_gondola.gerenciar', null, null),
  ('analista', 'administrativo', 'checklist_modelo.gerenciar', null, null),
  ('analista', 'administrativo', 'cliente.aprovar_coordenada', null, null),
  ('analista', 'administrativo', 'cliente.filial_editar', null, null),
  ('analista', 'administrativo', 'cliente.pagamento_editar', null, null),
  ('analista', 'administrativo', 'cliente.pre_cadastrar', null, null),
  ('analista', 'administrativo', 'cliente.pre_cadastro_corrigir', null, null),
  ('analista', 'administrativo', 'cliente.pre_cadastro_recusados', null, null),
  ('analista', 'administrativo', 'cliente_foto.enviar', null, null),
  ('analista', 'administrativo', 'cliente_foto.ver', null, null),
  ('analista', 'administrativo', 'concorrente.gerenciar', null, null),
  ('analista', 'administrativo', 'dados.escopo', 'tenant', null),
  ('analista', 'administrativo', 'desafio.gerenciar', null, null),
  ('analista', 'administrativo', 'destaque.gerenciar', null, null),
  ('analista', 'administrativo', 'dispositivo.bloquear', null, null),
  ('analista', 'administrativo', 'dispositivo.registrar_push', null, null),
  ('analista', 'administrativo', 'documento.ver', null, null),
  ('analista', 'administrativo', 'farol.ver', null, null),
  ('analista', 'administrativo', 'filial.editar', null, null),
  ('analista', 'administrativo', 'filial.ver', null, null),
  ('analista', 'administrativo', 'forma_pagamento.gerenciar', null, null),
  ('analista', 'administrativo', 'forma_pagamento.ver', null, null),
  ('analista', 'administrativo', 'foto_referencia.gerenciar', null, null),
  ('analista', 'administrativo', 'frase_dia.editar', null, null),
  ('analista', 'administrativo', 'inativacao.decidir', null, null),
  ('analista', 'administrativo', 'inicio_bko.ver', null, null),
  ('analista', 'administrativo', 'lote.cancelar', null, null),
  ('analista', 'administrativo', 'lote.reprocessar', null, null),
  ('analista', 'administrativo', 'mapeamento.editar', null, null),
  ('analista', 'administrativo', 'marca.gerenciar', null, null),
  ('analista', 'administrativo', 'medalha.gerenciar', null, null),
  ('analista', 'administrativo', 'medida.gerenciar', null, null),
  ('analista', 'administrativo', 'meta.editar', null, null),
  ('analista', 'administrativo', 'meta.fechar_periodo', null, null),
  ('analista', 'administrativo', 'meta.ver', null, null),
  ('analista', 'administrativo', 'meta_produtividade.editar', null, null),
  ('analista', 'administrativo', 'meta_share.gerenciar', null, null),
  ('analista', 'administrativo', 'mix_obrigatorio.gerenciar', null, null),
  ('analista', 'administrativo', 'monitor.ver', null, null),
  ('analista', 'administrativo', 'motivo.editar', null, null),
  ('analista', 'administrativo', 'notas.ver', null, null),
  ('analista', 'administrativo', 'notificacao.enviar', null, null),
  ('analista', 'administrativo', 'notificacao.ler', null, null),
  ('analista', 'administrativo', 'painel_tenant.ver', null, null),
  ('analista', 'administrativo', 'parametro.alertas_produtividade', null, null),
  ('analista', 'administrativo', 'parametro.campos_obrigatorios', null, null),
  ('analista', 'administrativo', 'parametro.catalogo', null, null),
  ('analista', 'administrativo', 'parametro.curva_abc', null, null),
  ('analista', 'administrativo', 'parametro.farol', null, null),
  ('analista', 'administrativo', 'parametro.inicio', null, null),
  ('analista', 'administrativo', 'pedido.aprovar', null, null),
  ('analista', 'administrativo', 'pedido.cancelar', null, null),
  ('analista', 'administrativo', 'pedido.criar', null, null),
  ('analista', 'administrativo', 'pedido.editar', null, null),
  ('analista', 'administrativo', 'pedido.excluir', null, null),
  ('analista', 'administrativo', 'pedido.ver', null, null),
  ('analista', 'administrativo', 'plano_rv.editar', null, null),
  ('analista', 'administrativo', 'plano_rv.ver', null, null),
  ('analista', 'administrativo', 'ponto_extra_negociado.gerenciar', null, null),
  ('analista', 'administrativo', 'produto.consultar', null, null),
  ('analista', 'administrativo', 'produto.editar_preco', null, null),
  ('analista', 'administrativo', 'produto.enriquecer', null, null),
  ('analista', 'administrativo', 'produto.parametros', null, null),
  ('analista', 'administrativo', 'produto.perguntar', null, null),
  ('analista', 'administrativo', 'produto.ver_preco_estoque', null, null),
  ('analista', 'administrativo', 'questionario.arquivar', null, null),
  ('analista', 'administrativo', 'questionario.criar', null, null),
  ('analista', 'administrativo', 'questionario.editar', null, null),
  ('analista', 'administrativo', 'questionario.publicar', null, null),
  ('analista', 'administrativo', 'quiz.gerenciar', null, null),
  ('analista', 'administrativo', 'ranking.ver', null, null),
  ('analista', 'administrativo', 'resultado.exportar', null, null),
  ('analista', 'administrativo', 'resultado.ver', null, null),
  ('analista', 'administrativo', 'rota.editar', null, null),
  ('analista', 'administrativo', 'rv.ver', null, null),
  ('analista', 'administrativo', 'sinonimo.gerenciar', null, null),
  ('analista', 'administrativo', 'tabela_preco.gerenciar', null, null),
  ('analista', 'administrativo', 'tarefa.acompanhar', null, null),
  ('analista', 'administrativo', 'tarefa.cancelar', null, null),
  ('analista', 'administrativo', 'tarefa.criar', null, null),
  ('analista', 'administrativo', 'tarefa.editar', null, null),
  ('analista', 'administrativo', 'tarefa_trade.gerenciar', null, null),
  ('analista', 'administrativo', 'transportadora.gerenciar', null, null),
  ('analista', 'administrativo', 'transportadora.ver', null, null),
  ('analista', 'administrativo', 'trilha.criar', null, null),
  ('analista', 'administrativo', 'trilha.editar', null, null),
  ('analista', 'administrativo', 'trilha.publicar', null, null),
  ('analista', 'administrativo', 'usuario.desbloquear', null, null),
  ('analista', 'administrativo', 'usuario.filial_editar', null, null),
  ('analista', 'administrativo', 'usuario_avatar.trocar', null, null),
  ('analista', 'administrativo', 'visita.checkin_fora_de_rota', null, null),
  ('assistente', 'administrativo', 'acesso.bko', null, null),
  ('assistente', 'administrativo', 'cliente_foto.ver', null, null),
  ('assistente', 'administrativo', 'dados.escopo', 'tenant', null),
  ('assistente', 'administrativo', 'dispositivo.registrar_push', null, null),
  ('assistente', 'administrativo', 'documento.ver', null, null),
  ('assistente', 'administrativo', 'farol.ver', null, null),
  ('assistente', 'administrativo', 'filial.ver', null, null),
  ('assistente', 'administrativo', 'inicio_bko.ver', null, null),
  ('assistente', 'administrativo', 'meta.ver', null, null),
  ('assistente', 'administrativo', 'notificacao.ler', null, null),
  ('assistente', 'administrativo', 'pedido.cancelar', null, null),
  ('assistente', 'administrativo', 'pedido.criar', null, null),
  ('assistente', 'administrativo', 'pedido.editar', null, null),
  ('assistente', 'administrativo', 'pedido.excluir', null, null),
  ('assistente', 'administrativo', 'pedido.ver', null, null),
  ('assistente', 'administrativo', 'produto.consultar', null, null),
  ('assistente', 'administrativo', 'produto.perguntar', null, null),
  ('assistente', 'administrativo', 'produto.ver_preco_estoque', null, null),
  ('assistente', 'administrativo', 'tarefa.acompanhar', null, null),
  ('assistente', 'administrativo', 'transportadora.ver', null, null),
  ('assistente', 'administrativo', 'usuario_avatar.trocar', null, null),
  ('assistente', 'administrativo', 'visita.checkin_fora_de_rota', null, null),
  ('admin', 'administrativo', 'acesso.bko', null, null),
  ('admin', 'administrativo', 'acesso.portal', null, null),
  ('admin', 'administrativo', 'adesao.ver', null, null),
  ('admin', 'administrativo', 'alcada.gerenciar', null, null),
  ('admin', 'administrativo', 'alerta_regra.gerenciar', null, null),
  ('admin', 'administrativo', 'app.baixar', null, null),
  ('admin', 'administrativo', 'ausencia.cadastrar', null, null),
  ('admin', 'administrativo', 'busca.ver_sem_resultado', null, null),
  ('admin', 'administrativo', 'carteira.editar', null, null),
  ('admin', 'administrativo', 'categoria_gondola.gerenciar', null, null),
  ('admin', 'administrativo', 'checklist_modelo.gerenciar', null, null),
  ('admin', 'administrativo', 'cliente.aprovar_coordenada', null, null),
  ('admin', 'administrativo', 'cliente.filial_editar', null, null),
  ('admin', 'administrativo', 'cliente.pagamento_editar', null, null),
  ('admin', 'administrativo', 'cliente.pre_cadastrar', null, null),
  ('admin', 'administrativo', 'cliente.pre_cadastro_corrigir', null, null),
  ('admin', 'administrativo', 'cliente.pre_cadastro_recusados', null, null),
  ('admin', 'administrativo', 'cliente_foto.enviar', null, null),
  ('admin', 'administrativo', 'cliente_foto.ver', null, null),
  ('admin', 'administrativo', 'concorrente.gerenciar', null, null),
  ('admin', 'administrativo', 'conector.gerenciar', null, null),
  ('admin', 'administrativo', 'dados.escopo', 'tenant', null),
  ('admin', 'administrativo', 'desafio.gerenciar', null, null),
  ('admin', 'administrativo', 'destaque.gerenciar', null, null),
  ('admin', 'administrativo', 'dispositivo.bloquear', null, null),
  ('admin', 'administrativo', 'dispositivo.registrar_push', null, null),
  ('admin', 'administrativo', 'documento.permissoes', null, null),
  ('admin', 'administrativo', 'documento.ver', null, null),
  ('admin', 'administrativo', 'farol.ver', null, null),
  ('admin', 'administrativo', 'filial.editar', null, null),
  ('admin', 'administrativo', 'filial.ver', null, null),
  ('admin', 'administrativo', 'forma_pagamento.gerenciar', null, null),
  ('admin', 'administrativo', 'forma_pagamento.ver', null, null),
  ('admin', 'administrativo', 'foto_referencia.gerenciar', null, null),
  ('admin', 'administrativo', 'foto_tipo.editar', null, null),
  ('admin', 'administrativo', 'frase_dia.editar', null, null),
  ('admin', 'administrativo', 'inativacao.decidir', null, null),
  ('admin', 'administrativo', 'inicio_bko.ver', null, null),
  ('admin', 'administrativo', 'lote.cancelar', null, null),
  ('admin', 'administrativo', 'lote.reprocessar', null, null),
  ('admin', 'administrativo', 'mapeamento.editar', null, null),
  ('admin', 'administrativo', 'marca.gerenciar', null, null),
  ('admin', 'administrativo', 'medalha.gerenciar', null, null),
  ('admin', 'administrativo', 'medida.gerenciar', null, null),
  ('admin', 'administrativo', 'meta.editar', null, null),
  ('admin', 'administrativo', 'meta.fechar_periodo', null, null),
  ('admin', 'administrativo', 'meta.ver', null, null),
  ('admin', 'administrativo', 'meta_produtividade.editar', null, null),
  ('admin', 'administrativo', 'meta_share.gerenciar', null, null),
  ('admin', 'administrativo', 'mix_obrigatorio.gerenciar', null, null),
  ('admin', 'administrativo', 'modulo.gerir_licencas', null, null),
  ('admin', 'administrativo', 'monitor.ver', null, null),
  ('admin', 'administrativo', 'motivo.editar', null, null),
  ('admin', 'administrativo', 'notas.ver', null, null),
  ('admin', 'administrativo', 'notificacao.enviar', null, null),
  ('admin', 'administrativo', 'notificacao.ler', null, null),
  ('admin', 'administrativo', 'painel_tenant.ver', null, null),
  ('admin', 'administrativo', 'parametro.alertas_produtividade', null, null),
  ('admin', 'administrativo', 'parametro.campos_obrigatorios', null, null),
  ('admin', 'administrativo', 'parametro.campos_obrigatorios_editar', null, null),
  ('admin', 'administrativo', 'parametro.catalogo', null, null),
  ('admin', 'administrativo', 'parametro.checkout_pendencia', null, null),
  ('admin', 'administrativo', 'parametro.curva_abc', null, null),
  ('admin', 'administrativo', 'parametro.farol', null, null),
  ('admin', 'administrativo', 'parametro.inicio', null, null),
  ('admin', 'administrativo', 'parametro.promotor_ve_pedidos', null, null),
  ('admin', 'administrativo', 'pedido.ver', null, null),
  ('admin', 'administrativo', 'perfil.gerir', null, null),
  ('admin', 'administrativo', 'plano_rv.editar', null, null),
  ('admin', 'administrativo', 'plano_rv.ver', null, null),
  ('admin', 'administrativo', 'ponto_extra_negociado.gerenciar', null, null),
  ('admin', 'administrativo', 'produto.consultar', null, null),
  ('admin', 'administrativo', 'produto.editar_preco', null, null),
  ('admin', 'administrativo', 'produto.enriquecer', null, null),
  ('admin', 'administrativo', 'produto.parametros', null, null),
  ('admin', 'administrativo', 'produto.perguntar', null, null),
  ('admin', 'administrativo', 'produto.ver_preco_estoque', null, null),
  ('admin', 'administrativo', 'questionario.arquivar', null, null),
  ('admin', 'administrativo', 'questionario.criar', null, null),
  ('admin', 'administrativo', 'questionario.editar', null, null),
  ('admin', 'administrativo', 'questionario.publicar', null, null),
  ('admin', 'administrativo', 'quiz.gerenciar', null, null),
  ('admin', 'administrativo', 'ranking.ver', null, null),
  ('admin', 'administrativo', 'rastreamento.configurar', null, null),
  ('admin', 'administrativo', 'resultado.exportar', null, null),
  ('admin', 'administrativo', 'resultado.ver', null, null),
  ('admin', 'administrativo', 'rota.editar', null, null),
  ('admin', 'administrativo', 'rv.ver', null, null),
  ('admin', 'administrativo', 'senha.redefinir', null, '{"*"}'),
  ('admin', 'administrativo', 'sinonimo.gerenciar', null, null),
  ('admin', 'administrativo', 'tabela_preco.gerenciar', null, null),
  ('admin', 'administrativo', 'tarefa.acompanhar', null, null),
  ('admin', 'administrativo', 'tarefa.cancelar', null, null),
  ('admin', 'administrativo', 'tarefa.criar', null, null),
  ('admin', 'administrativo', 'tarefa.editar', null, null),
  ('admin', 'administrativo', 'tarefa_trade.gerenciar', null, null),
  ('admin', 'administrativo', 'transportadora.gerenciar', null, null),
  ('admin', 'administrativo', 'transportadora.ver', null, null),
  ('admin', 'administrativo', 'trilha.criar', null, null),
  ('admin', 'administrativo', 'trilha.editar', null, null),
  ('admin', 'administrativo', 'trilha.publicar', null, null),
  ('admin', 'administrativo', 'usuario.criar', null, null),
  ('admin', 'administrativo', 'usuario.desativar', null, null),
  ('admin', 'administrativo', 'usuario.desbloquear', null, null),
  ('admin', 'administrativo', 'usuario.editar', null, null),
  ('admin', 'administrativo', 'usuario.filial_editar', null, null),
  ('admin', 'administrativo', 'usuario.ver', null, null),
  ('admin', 'administrativo', 'usuario_avatar.trocar', null, null),
  ('admin', 'administrativo', 'usuario_avatar.trocar_outro', null, null),
  ('admin', 'administrativo', 'visita.checkin_fora_de_rota', null, null),
  ('admin', 'administrativo', 'visita.dispensar_etapa', null, null)
  ) as v (modelo, cargo, chave, nivel, alvos)
on conflict (id) do nothing;

-- 2. plataforma.perfil_concessao -----------------------------------------------------------------------------------------
create table plataforma.perfil_concessao (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references plataforma.tenant (id),
  perfil_id   uuid not null,
  chave       text not null,
  nivel       text,
  alvos       text[],
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  external_id text,
  constraint perfil_concessao_perfil_fk foreign key (tenant_id, perfil_id) references plataforma.perfil (tenant_id, id) on delete cascade,
  constraint perfil_concessao_chave_formato check (chave ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  constraint perfil_concessao_nivel_valido
    check (nivel is null or nivel in ('proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant', 'ate_alcada', 'acima_alcada')),
  constraint perfil_concessao_nivel_escopo
    check (chave <> 'dados.escopo' or coalesce(nivel in ('proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant'), false)),
  constraint perfil_concessao_alvos_formato check (alvos is null or (
    cardinality(alvos) between 1 and 50 and array_position(alvos, null) is null
    and array_to_string(alvos, ',') ~ '^(\*|[a-z][a-z0-9_]{1,39})(,(\*|[a-z][a-z0-9_]{1,39}))*$'))
);
create unique index perfil_concessao_uk on plataforma.perfil_concessao (tenant_id, perfil_id, chave) where deleted_at is null;
create index perfil_concessao_leitura_ix on plataforma.perfil_concessao (tenant_id, perfil_id) include (chave, nivel, alvos)
  where deleted_at is null;
create trigger perfil_concessao_updated_at before update on plataforma.perfil_concessao
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.perfil_concessao enable row level security;
alter table plataforma.perfil_concessao force row level security;
create policy isolamento_tenant on plataforma.perfil_concessao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on plataforma.perfil_concessao for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.perfil_concessao from public;
grant select, insert, update on plataforma.perfil_concessao to macuxi_app;
grant select (id, tenant_id, perfil_id, nivel, alvos, created_at, updated_at, deleted_at, external_id) on plataforma.perfil_concessao to macuxi_leitura;
create policy leitura on plataforma.perfil_concessao for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- Travas por cargo (imediatas). Perfil que o chamador não enxerga (outro tenant): segue para a RLS/FK, que recusam.
create function plataforma.perfil_concessao_travas() returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_cargo text;
  v_regra text;
begin
  if new.deleted_at is not null then
    return new;
  end if;
  select p.cargo into v_cargo from plataforma.perfil p where p.tenant_id = new.tenant_id and p.id = new.perfil_id;
  if v_cargo is null then
    return new;
  end if;
  v_regra := plataforma.trava_da_chave_do_cargo(v_cargo, new.chave, new.nivel);
  if v_regra is not null then
    raise exception 'a permissão % não vale para o cargo % (%)', new.chave, v_cargo, v_regra using errcode = '23514',
      constraint = 'perfil_concessao_trava_do_cargo', hint = v_regra;
  end if;
  return new;
end
$$;
revoke all on function plataforma.perfil_concessao_travas() from public;
create trigger perfil_concessao_travas before insert or update on plataforma.perfil_concessao
  for each row execute function plataforma.perfil_concessao_travas();

-- 3. plataforma.catalogo_aplicado ----------------------------------------------------------------------------------------
create table plataforma.catalogo_aplicado (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references plataforma.tenant (id),
  versao      integer not null,
  aplicado_em timestamptz not null default now(),
  leitura     text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  external_id text,
  constraint catalogo_aplicado_versao_valida check (versao >= 1),
  constraint catalogo_aplicado_leitura_valida check (leitura in ('legado', 'concessao'))
);
create unique index catalogo_aplicado_uk on plataforma.catalogo_aplicado (tenant_id, versao) where deleted_at is null;
create trigger catalogo_aplicado_updated_at before update on plataforma.catalogo_aplicado
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.catalogo_aplicado enable row level security;
alter table plataforma.catalogo_aplicado force row level security;
create policy isolamento_tenant on plataforma.catalogo_aplicado for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on plataforma.catalogo_aplicado for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.catalogo_aplicado from public;
grant select, insert, update on plataforma.catalogo_aplicado to macuxi_app;
grant select on plataforma.catalogo_aplicado to macuxi_leitura;
create policy leitura on plataforma.catalogo_aplicado for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- Leitura do tenant na transição: 'concessao' só com a linha viva; sem linha = 'legado'. Usada pelos gatilhos de espelho
-- (0106) e, na fase de código, pelas funções de caminho duplo.
create function plataforma.leitura_de_perfis(p_tenant uuid) returns text
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select coalesce((select 'concessao' from plataforma.catalogo_aplicado c
                      where c.tenant_id = p_tenant and c.deleted_at is null and c.leitura = 'concessao' limit 1), 'legado')
  $$;
revoke all on function plataforma.leitura_de_perfis(uuid) from public;
grant execute on function plataforma.leitura_de_perfis(uuid) to macuxi_app;

-- 4. plataforma.perfil_migracao_conflito ---------------------------------------------------------------------------------
create table plataforma.perfil_migracao_conflito (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references plataforma.tenant (id),
  perfil_id     uuid,
  perfil_codigo text,
  usuario_id    uuid,
  tipo          text not null,
  efeito        text not null,
  chave         text,
  antes         jsonb,
  depois        jsonb,
  resolvido_em  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  external_id   text,
  constraint perfil_migracao_conflito_perfil_fk foreign key (tenant_id, perfil_id) references plataforma.perfil (tenant_id, id)
    on delete set null (perfil_id),
  constraint perfil_migracao_conflito_tipo_valido check (tipo in ('CARGO_DIFERENTE_DA_BASE', 'TRAVA_NOVA_CORTA', 'PERFIL_SEM_ACESSO',
    'ADMIN_MUDA', 'TENANT_SEM_ADMIN', 'REVOGACAO_SEM_EFEITO', 'CONCESSAO_SEM_EFEITO', 'NOME_DIVERGENTE')),
  constraint perfil_migracao_conflito_efeito_valido check (efeito in ('para_tenant', 'ajustado', 'aviso')),
  constraint perfil_migracao_conflito_chave_formato check (chave is null or chave ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);
create index perfil_migracao_conflito_aberto_ix on plataforma.perfil_migracao_conflito (tenant_id, efeito, tipo)
  where resolvido_em is null and deleted_at is null;
create trigger perfil_migracao_conflito_updated_at before update on plataforma.perfil_migracao_conflito
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.perfil_migracao_conflito enable row level security;
alter table plataforma.perfil_migracao_conflito force row level security;
create policy isolamento_tenant on plataforma.perfil_migracao_conflito for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on plataforma.perfil_migracao_conflito for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.perfil_migracao_conflito from public;
grant select on plataforma.perfil_migracao_conflito to macuxi_app;
grant select (id, tenant_id, perfil_id, perfil_codigo, usuario_id, tipo, efeito, antes, depois, resolvido_em, created_at, updated_at, deleted_at, external_id) on plataforma.perfil_migracao_conflito to macuxi_leitura;
create policy leitura on plataforma.perfil_migracao_conflito for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- 0041_plataforma_perfis_de_acesso (up) — T-0111 (motor de permissões por perfil) e T-0112 (multiperfil). ADR 0033;
-- registro .coord/contratos/permissoes.md; pedido R-20261107-195859-engenheiro-software; RN-CORE-01, RN-CORE-04, RN-CORE-33,
-- RN-CORE-35, RN-PRO-01. Dicionário: docs/banco/plataforma.md ("0041 — perfis de acesso") e docs/banco/rls.md.
-- Migração em cima da 0040 (T-0094), no mesmo lote da 0039 e da 0040. NÃO recria nenhuma função da 0039/0040: o
-- provisionamento (provisionar_tenant e sa_provisionar_tenant) ganha os perfis pelos gatilhos abaixo, sem mudar de texto.
--
-- Modelo (ADR 0033 §2 e §3): o padrão de fábrica de cada perfil base mora no SDK (chaves da plataforma + `perfis` das ações dos
-- manifestos); o banco guarda os PERFIS do tenant, SÓ o que o tenant mudou em relação à fábrica e os perfis de cada usuário.
--
-- 1. plataforma.perfil — perfil de acesso do tenant. Colunas comuns + codigo, nome, descricao, base, fabrica, ativo.
--      codigo   ^[a-z][a-z0-9_]{1,39}$ (= CODIGO_PERFIL_RE do SDK); ÚNICO por tenant ENTRE TODOS, apagados inclusive
--               (perfil_codigo_uk): é a chave da FK de perfil_modulo, dos alvos de senha.redefinir e da auditoria — um código
--               apagado não volta a nomear outro perfil. IMUTÁVEL (gatilho perfil_imutavel), como base e fabrica.
--      base     um dos 7 PERFIS do SDK; imutável (o personalizado nasce de uma base que não muda, RN-CORE-35).
--      fabrica  os 7 de fábrica (codigo = base, perfil_fabrica_codigo) nunca ficam inativos nem apagados
--               (perfil_fabrica_ativo); são semeados em todo tenant (existente: aqui; novo: gatilho tenant_semear_perfis)
--               com ids determinísticos plataforma.uuid_de_chave('<tenant>:plataforma.perfil:<base>') (idPerfilFabrica em
--               db/src/ids.ts) e nome = ROTULO_PERFIL do SDK.
-- 2. plataforma.perfil_permissao — sobreposição do tenant numa chave (TABELA VAZIA = PADRÃO DE FÁBRICA; restaurar o padrão =
--    apagar as linhas). Colunas comuns + perfil_id (FK composta), chave (<entidade>.<verbo>), concedida, nivel
--    (NIVEIS_ESCOPO ∪ NIVEIS_ALCADA; em dados.escopo só os de escopo), alvos text[] (códigos de perfil ou '*').
--    Revogação (concedida = false) não leva nível nem alvos. Única por (tenant, perfil, chave) entre as vivas.
--    Travas no banco (gatilho perfil_permissao_travas, 23514, cópia de travaDaChave/aplicarTravasDoPerfil do SDK):
--    RN-CORE-33 (acesso.bko concedido a base vendedor/promotor/supervisor; acesso.portal a base que não é admin),
--    RN-PRO-01 (escrita de pedido concedida a base promotor) e RN-CORE-04 (dados.escopo acima do da base).
--    A migração NÃO grava nenhuma linha aqui.
-- 3. plataforma.usuario_perfil — multiperfil (RN-CORE-01). Colunas comuns + usuario_id (FK composta para core.usuario, ON
--    DELETE CASCADE: o vínculo é do usuário) e perfil_id (FK composta). Único (tenant, usuário, perfil) entre os vivos.
--    Semeadura: um vínculo por core.usuario (ativos, inativos e apagados) com o perfil de fábrica de core.usuario.perfil, id
--    plataforma.uuid_de_chave('<tenant>:plataforma.usuario_perfil:<usuario>:<perfil_id>') (idUsuarioPerfil).
-- 4. core.usuario.perfil continua (perfil PRINCIPAL, vai no token). Garantias:
--    - gatilho usuario_perfil_principal (AFTER INSERT/UPDATE OF perfil, deleted_at em core.usuario, imediato): se o usuário
--      não tem um perfil vivo e ativo da base core.usuario.perfil, liga o de fábrica dessa base (id determinístico). Na TROCA
--      de perfil de quem tem SÓ o vínculo de fábrica do perfil anterior (o caso de hoje, perfil único), o vínculo anterior é
--      apagado (soft delete) e o novo entra: o Core atual, que só grava core.usuario.perfil, continua certo. Com 2+ perfis ou
--      perfil personalizado, só acrescenta (quem grava os vínculos é o Core, ADR 0033).
--    - conferência no COMMIT (gatilhos de restrição adiáveis): todo usuário não apagado tem ao menos um perfil vivo e ativo
--      (usuario_sem_perfil, RN-CORE-01), nenhum vínculo vivo com perfil inativo/apagado (usuario_perfil_indisponivel) e um perfil
--      vivo cuja base = core.usuario.perfil (usuario_perfil_principal, RN-CORE-35).
-- 5. plataforma.perfil_modulo.perfil passa a ser o CÓDIGO do perfil do tenant: sai o CHECK perfil_modulo_perfil_valido, entra a
--    FK perfil_modulo_perfil_fk (tenant_id, perfil) -> plataforma.perfil (tenant_id, codigo). As linhas atuais já são códigos
--    de fábrica.
-- 6. Último admin (RN-CORE-35, ADR 0033 §5; gêmea de ehAdminComGestao do SDK): plataforma.usuario_admin_com_gestao(tenant,
--    usuário) e plataforma.tenant_tem_admin_com_gestao(tenant). No COMMIT, toda mudança que mexe na condição de admin
--    (desativar/apagar usuário com perfil de base admin; tirar/apagar vínculo com perfil de base admin; ligar perfil de base
--    vendedor/promotor/supervisor a quem tem perfil de base admin; desativar/apagar perfil de base admin; sobreposição de
--    acesso.bko, perfil.gerir ou usuario.criar|editar|desativar num tenant com admin) exige que sobre ao menos um usuário
--    ativo com perfil de base admin, acesso.bko e a gestão do acesso (tenant_ultimo_admin, 23514). Tenant que nunca teve admin
--    (provisionado com sem_admin) não é afetado por quem não mexe em admin. A AUTOGESTÃO (o ator não tira a gestão de si)
--    depende do ator e fica no domain do Core (validarAcessoDoTenant), como o resto do RN-CORE-35.
-- 7. plataforma.perfis_do_usuario(p_usuario uuid): os perfis vivos e ativos do usuário NO TENANT DO CONTEXTO (fora de contexto =
--    0 linhas), com as sobreposições (jsonb) e os módulos padrão (perfil_modulo) de cada um. A API lê a cada requisição, na
--    transação das licenças (apps/api/src/licencas.ts), e resolve com resolverPerfil/combinarPerfis do SDK.
-- RLS (como perfil_modulo): macuxi_app lê e escreve no próprio tenant (perfil sem DELETE: perfil sai por soft delete);
-- manutencao (0031); worker e portal: nada. Fora do sync (o aparelho recebe as chaves efetivas por GET /v1/me/modulos).
-- Funções: todas SECURITY INVOKER (nada que ignore RLS), search_path fixo, sem EXECUTE para PUBLIC.
-- Volume: 7 + poucos perfis por tenant; dezenas de sobreposições; 1 a 3 vínculos por usuário.
--
-- Caminho de volta: 0041_plataforma_perfis_de_acesso.down.sql (APAGA perfis personalizados, sobreposições e o multiperfil — o
-- perfil volta a ser só core.usuario.perfil; linhas de perfil_modulo de perfis personalizados são apagadas antes de o CHECK
-- dos 7 perfis voltar). Desfaça junto o código do Core e da API que lê/grava as tabelas novas.

-- 1. plataforma.perfil ----------------------------------------------------------------------------------------------------
create table plataforma.perfil (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references plataforma.tenant (id),
  codigo      text not null,
  nome        text not null,
  descricao   text,
  base        text not null,
  fabrica     boolean not null default false,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  external_id text,
  constraint perfil_codigo_formato check (codigo ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint perfil_base_valida
    check (base in ('admin', 'analista', 'assistente', 'supervisor', 'gerente', 'vendedor', 'promotor')),
  constraint perfil_fabrica_codigo check (not fabrica or codigo = base),
  constraint perfil_fabrica_ativo check (not fabrica or (ativo and deleted_at is null)),
  constraint perfil_nome_valido check (btrim(nome) <> '' and char_length(nome) <= 80),
  constraint perfil_descricao_tamanho check (descricao is null or char_length(descricao) <= 500),
  constraint perfil_codigo_uk unique (tenant_id, codigo),
  constraint perfil_tenant_id_uk unique (tenant_id, id)
);
create trigger perfil_updated_at before update on plataforma.perfil
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.perfil enable row level security;
alter table plataforma.perfil force row level security;
create policy isolamento_tenant on plataforma.perfil for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on plataforma.perfil for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.perfil from public;
grant select, insert, update on plataforma.perfil to macuxi_app;

-- 2. plataforma.perfil_permissao ------------------------------------------------------------------------------------------
create table plataforma.perfil_permissao (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references plataforma.tenant (id),
  perfil_id   uuid not null,
  chave       text not null,
  concedida   boolean not null,
  nivel       text,
  alvos       text[],
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  external_id text,
  constraint perfil_permissao_perfil_fk foreign key (tenant_id, perfil_id) references plataforma.perfil (tenant_id, id),
  constraint perfil_permissao_chave_formato check (chave ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  constraint perfil_permissao_nivel_valido
    check (nivel is null or nivel in ('proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant', 'ate_alcada', 'acima_alcada')),
  constraint perfil_permissao_nivel_escopo
    check (chave <> 'dados.escopo' or nivel is null or nivel in ('proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant')),
  constraint perfil_permissao_alvos_formato check (alvos is null or (
    cardinality(alvos) between 1 and 50 and array_position(alvos, null) is null
    and array_to_string(alvos, ',') ~ '^(\*|[a-z][a-z0-9_]{1,39})(,(\*|[a-z][a-z0-9_]{1,39}))*$')),
  constraint perfil_permissao_revogada_sem_valor check (concedida or (nivel is null and alvos is null))
);
create unique index perfil_permissao_uk on plataforma.perfil_permissao (tenant_id, perfil_id, chave) where deleted_at is null;
create trigger perfil_permissao_updated_at before update on plataforma.perfil_permissao
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.perfil_permissao enable row level security;
alter table plataforma.perfil_permissao force row level security;
create policy isolamento_tenant on plataforma.perfil_permissao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on plataforma.perfil_permissao for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.perfil_permissao from public;
grant select, insert, update, delete on plataforma.perfil_permissao to macuxi_app;

-- 3. plataforma.usuario_perfil --------------------------------------------------------------------------------------------
create table plataforma.usuario_perfil (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references plataforma.tenant (id),
  usuario_id  uuid not null,
  perfil_id   uuid not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  external_id text,
  constraint usuario_perfil_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id) on delete cascade,
  constraint usuario_perfil_perfil_fk foreign key (tenant_id, perfil_id) references plataforma.perfil (tenant_id, id)
);
create unique index usuario_perfil_uk on plataforma.usuario_perfil (tenant_id, usuario_id, perfil_id) where deleted_at is null;
create index usuario_perfil_usuario_ix on plataforma.usuario_perfil (tenant_id, usuario_id);
create index usuario_perfil_perfil_ix on plataforma.usuario_perfil (tenant_id, perfil_id) where deleted_at is null;
create trigger usuario_perfil_updated_at before update on plataforma.usuario_perfil
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.usuario_perfil enable row level security;
alter table plataforma.usuario_perfil force row level security;
create policy isolamento_tenant on plataforma.usuario_perfil for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on plataforma.usuario_perfil for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.usuario_perfil from public;
grant select, insert, update, delete on plataforma.usuario_perfil to macuxi_app;

-- 4. Semeadura dos 7 perfis de fábrica (tenant existente e novo) --------------------------------------------------------------
-- nome = ROTULO_PERFIL de packages/platform-sdk/src/perfis.ts (o estatico.test.ts confere). Roda como quem chama (RLS vale):
-- no gatilho do tenant, quem insere o tenant (executor/admin; o macuxi_app não insere tenant); no gatilho do usuário, o
-- macuxi_app no contexto do próprio tenant.
create function plataforma.semear_perfis_fabrica(p_tenant uuid) returns void
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_tenant is null then
    raise exception 'semear_perfis_fabrica: p_tenant obrigatório' using errcode = '22004';
  end if;
  insert into plataforma.perfil (id, tenant_id, codigo, nome, base, fabrica, ativo)
  select plataforma.uuid_de_chave(p_tenant::text || ':plataforma.perfil:' || f.base), p_tenant, f.base, f.nome, f.base, true, true
    from (values
      ('vendedor', 'Vendedor'), ('promotor', 'Promotor'), ('supervisor', 'Supervisor'), ('gerente', 'Gerente'),
      ('analista', 'Analista'), ('assistente', 'Assistente de BKO'), ('admin', 'Admin')
    ) as f (base, nome)
  on conflict do nothing;
end
$$;
revoke all on function plataforma.semear_perfis_fabrica(uuid) from public;
grant execute on function plataforma.semear_perfis_fabrica(uuid) to macuxi_app;

create function plataforma.semear_tenant_perfis() returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  perform plataforma.semear_perfis_fabrica(new.id);
  return null;
end
$$;
revoke all on function plataforma.semear_tenant_perfis() from public;
create trigger tenant_semear_perfis after insert on plataforma.tenant
  for each row execute function plataforma.semear_tenant_perfis();

-- 5. Perfil principal (core.usuario.perfil) sempre entre os perfis do usuário ------------------------------------------------
create function plataforma.garantir_perfil_principal() returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_perfil uuid;
  v_vivos uuid[];
begin
  if new.deleted_at is not null then
    return null;
  end if;
  if exists (select 1 from plataforma.usuario_perfil up
               join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
              where up.tenant_id = new.tenant_id and up.usuario_id = new.id and up.deleted_at is null
                and p.base = new.perfil and p.ativo and p.deleted_at is null) then
    return null;
  end if;
  select p.id into v_perfil from plataforma.perfil p where p.tenant_id = new.tenant_id and p.codigo = new.perfil and p.fabrica;
  if v_perfil is null then
    perform plataforma.semear_perfis_fabrica(new.tenant_id);
    select p.id into v_perfil from plataforma.perfil p where p.tenant_id = new.tenant_id and p.codigo = new.perfil and p.fabrica;
  end if;
  if v_perfil is null then
    raise exception 'usuário sem o perfil de fábrica da base no tenant (contexto do tenant ausente?)' using errcode = '23514',
      constraint = 'usuario_perfil_principal', hint = 'RN-CORE-35';
  end if;
  -- troca de perfil de quem tem só o vínculo de fábrica do perfil anterior (perfil único, o Core de hoje): substitui
  if tg_op = 'UPDATE' and old.perfil is distinct from new.perfil then
    select array_agg(up.id) into v_vivos
      from plataforma.usuario_perfil up
     where up.tenant_id = new.tenant_id and up.usuario_id = new.id and up.deleted_at is null;
    if cardinality(v_vivos) = 1 and exists (select 1 from plataforma.usuario_perfil up
                                               join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
                                              where up.tenant_id = new.tenant_id and up.id = v_vivos[1]
                                                and p.fabrica and p.codigo = old.perfil) then
      update plataforma.usuario_perfil up set deleted_at = now() where up.tenant_id = new.tenant_id and up.id = v_vivos[1];
    end if;
  end if;
  insert into plataforma.usuario_perfil (id, tenant_id, usuario_id, perfil_id)
  values (plataforma.uuid_de_chave(new.tenant_id::text || ':plataforma.usuario_perfil:' || new.id::text || ':' || v_perfil::text),
          new.tenant_id, new.id, v_perfil)
  on conflict (id) do update set deleted_at = null;
  return null;
end
$$;
revoke all on function plataforma.garantir_perfil_principal() from public;
create trigger usuario_perfil_principal after insert or update of perfil, deleted_at on core.usuario
  for each row execute function plataforma.garantir_perfil_principal();

-- 6. Imutáveis do perfil e travas das sobreposições (imediatos) --------------------------------------------------------------
create function plataforma.perfil_imutavel() returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  -- tenant_id fica com a RLS e as FKs compostas (a troca de tenant dá 42501 na política)
  if new.codigo is distinct from old.codigo or new.base is distinct from old.base or new.fabrica is distinct from old.fabrica then
    raise exception 'o código, o perfil base e a marca de fábrica do perfil não mudam depois de criados' using errcode = '23514',
      constraint = 'perfil_imutavel', hint = 'RN-CORE-35';
  end if;
  return new;
end
$$;
revoke all on function plataforma.perfil_imutavel() from public;
create trigger perfil_imutavel before update on plataforma.perfil
  for each row execute function plataforma.perfil_imutavel();

-- Cópia de travaDaChave e do corte do escopo (aplicarTravasDoPerfil) de packages/platform-sdk/src/permissoes-perfil.ts; o
-- estatico.test.ts confere as listas. Perfil que o chamador não enxerga (outro tenant): segue para a RLS/FK, que recusam.
create function plataforma.perfil_permissao_travas() returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_base text;
  v_max text;
  c_escopo constant text[] := array['proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant'];
begin
  if not new.concedida or new.deleted_at is not null then
    return new;
  end if;
  select p.base into v_base from plataforma.perfil p where p.tenant_id = new.tenant_id and p.id = new.perfil_id;
  if v_base is null then
    return new;
  end if;
  if new.chave = 'acesso.bko' and v_base in ('vendedor', 'promotor', 'supervisor') then
    raise exception 'perfil de base % nunca entra no BKO', v_base using errcode = '23514',
      constraint = 'perfil_permissao_trava_bko', hint = 'RN-CORE-33';
  end if;
  if new.chave = 'acesso.portal' and v_base <> 'admin' then
    raise exception 'o portal é só do perfil de base admin' using errcode = '23514',
      constraint = 'perfil_permissao_trava_portal', hint = 'RN-CORE-33';
  end if;
  if v_base = 'promotor' and new.chave ~ '^pedido(_[a-z0-9_]+)?\.' and split_part(new.chave, '.', 2) <> 'ver' then
    raise exception 'perfil de base promotor nunca cria, edita, cancela ou exclui pedido' using errcode = '23514',
      constraint = 'perfil_permissao_trava_pedido', hint = 'RN-PRO-01';
  end if;
  if new.chave = 'dados.escopo' and new.nivel is not null then
    v_max := case v_base when 'vendedor' then 'carteira' when 'promotor' then 'carteira' when 'supervisor' then 'equipe'
                         when 'gerente' then 'equipes_abaixo' else 'tenant' end;
    if array_position(c_escopo, new.nivel) > array_position(c_escopo, v_max) then
      raise exception 'o escopo de dados não passa o do perfil base %', v_base using errcode = '23514',
        constraint = 'perfil_permissao_escopo_da_base', hint = 'RN-CORE-04';
    end if;
  end if;
  return new;
end
$$;
revoke all on function plataforma.perfil_permissao_travas() from public;
create trigger perfil_permissao_travas before insert or update on plataforma.perfil_permissao
  for each row execute function plataforma.perfil_permissao_travas();

-- 7. Último admin (RN-CORE-35; gêmea de ehAdminComGestao do SDK) --------------------------------------------------------------
-- Usuário ativo e não apagado, com perfil vivo e ativo de base admin, nenhum perfil de base vendedor/promotor/supervisor (fecha
-- o BKO pela regra mais restritiva) e, pela UNIÃO dos perfis, acesso.bko e a gestão do acesso. Valor de cada chave por perfil =
-- a sobreposição viva, se houver; senão a fábrica do SDK (acesso.bko: gerente, analista, assistente e admin; a gestão: admin).
create function plataforma.usuario_admin_com_gestao(p_tenant uuid, p_usuario uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    with perfis as (
      select p.id, p.base
        from core.usuario u
        join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
        join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id and p.ativo and p.deleted_at is null
       where u.tenant_id = p_tenant and u.id = p_usuario and u.ativo and u.deleted_at is null
    )
    select exists (select 1 from perfis f where f.base = 'admin')
       and not exists (select 1 from perfis f where f.base in ('vendedor', 'promotor', 'supervisor'))
       and not exists (
         select 1
           from unnest(array['acesso.bko', 'perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar']) as k (chave)
          where not exists (
            select 1 from perfis f
             where coalesce(
                     (select pp.concedida from plataforma.perfil_permissao pp
                       where pp.tenant_id = p_tenant and pp.perfil_id = f.id and pp.chave = k.chave and pp.deleted_at is null),
                     case when k.chave = 'acesso.bko' then f.base in ('gerente', 'analista', 'assistente', 'admin')
                          else f.base = 'admin' end)))
  $$;
revoke all on function plataforma.usuario_admin_com_gestao(uuid, uuid) from public;
grant execute on function plataforma.usuario_admin_com_gestao(uuid, uuid) to macuxi_app;

create function plataforma.tenant_tem_admin_com_gestao(p_tenant uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select exists (
      select 1
        from plataforma.usuario_perfil up
        join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
       where up.tenant_id = p_tenant and up.deleted_at is null and p.base = 'admin' and p.ativo and p.deleted_at is null
         and plataforma.usuario_admin_com_gestao(p_tenant, up.usuario_id))
  $$;
revoke all on function plataforma.tenant_tem_admin_com_gestao(uuid) from public;
grant execute on function plataforma.tenant_tem_admin_com_gestao(uuid) to macuxi_app;

-- 8. Conferências no COMMIT (gatilhos de restrição adiáveis) -----------------------------------------------------------------
-- Releem o estado ATUAL (vários comandos na mesma transação = uma conferência coerente no fim). Tenant que o chamador não
-- enxerga (apagado pela plataforma.excluir_tenant, ou fora do contexto do macuxi_app): nada a conferir.
create function plataforma.conferir_perfis_do_usuario(p_tenant uuid, p_usuario uuid) returns void
  language plpgsql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_perfil text;
begin
  select u.perfil into v_perfil from core.usuario u where u.tenant_id = p_tenant and u.id = p_usuario and u.deleted_at is null;
  if not found then
    return;
  end if;
  if exists (select 1 from plataforma.usuario_perfil up
               join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
              where up.tenant_id = p_tenant and up.usuario_id = p_usuario and up.deleted_at is null
                and (not p.ativo or p.deleted_at is not null)) then
    raise exception 'usuário com perfil inexistente ou desativado' using errcode = '23514',
      constraint = 'usuario_perfil_indisponivel', hint = 'RN-CORE-01';
  end if;
  if not exists (select 1 from plataforma.usuario_perfil up
                  where up.tenant_id = p_tenant and up.usuario_id = p_usuario and up.deleted_at is null) then
    raise exception 'todo usuário precisa de pelo menos um perfil' using errcode = '23514',
      constraint = 'usuario_sem_perfil', hint = 'RN-CORE-01';
  end if;
  if not exists (select 1 from plataforma.usuario_perfil up
                   join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
                  where up.tenant_id = p_tenant and up.usuario_id = p_usuario and up.deleted_at is null and p.base = v_perfil) then
    raise exception 'o perfil principal do usuário (core.usuario.perfil) precisa estar entre os perfis dele' using errcode = '23514',
      constraint = 'usuario_perfil_principal', hint = 'RN-CORE-35';
  end if;
end
$$;
revoke all on function plataforma.conferir_perfis_do_usuario(uuid, uuid) from public;
grant execute on function plataforma.conferir_perfis_do_usuario(uuid, uuid) to macuxi_app;

create function plataforma.conferir_ultimo_admin(p_tenant uuid) returns void
  language plpgsql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if not plataforma.tenant_tem_admin_com_gestao(p_tenant) then
    raise exception 'a empresa ficaria sem nenhum admin ativo com a gestão de usuários e perfis' using errcode = '23514',
      constraint = 'tenant_ultimo_admin', hint = 'RN-CORE-35';
  end if;
end
$$;
revoke all on function plataforma.conferir_ultimo_admin(uuid) from public;
grant execute on function plataforma.conferir_ultimo_admin(uuid) to macuxi_app;

create function plataforma.usuario_conferir_acesso() returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if not exists (select 1 from plataforma.tenant t where t.id = new.tenant_id) then
    return null;
  end if;
  perform plataforma.conferir_perfis_do_usuario(new.tenant_id, new.id);
  -- desativou ou apagou quem tem perfil de base admin
  if tg_op = 'UPDATE' and old.ativo and old.deleted_at is null
     and exists (select 1 from plataforma.usuario_perfil up
                   join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
                  where up.tenant_id = new.tenant_id and up.usuario_id = new.id and up.deleted_at is null and p.base = 'admin') then
    perform plataforma.conferir_ultimo_admin(new.tenant_id);
  end if;
  return null;
end
$$;
revoke all on function plataforma.usuario_conferir_acesso() from public;
create constraint trigger usuario_conferir_acesso after insert or update of perfil, ativo, deleted_at on core.usuario
  deferrable initially deferred
  for each row execute function plataforma.usuario_conferir_acesso();

create function plataforma.usuario_perfil_conferir() returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tenant uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  v_base_antes text;
  v_base_depois text;
begin
  if not exists (select 1 from plataforma.tenant t where t.id = v_tenant) then
    return null;
  end if;
  if tg_op <> 'DELETE' then
    perform plataforma.conferir_perfis_do_usuario(new.tenant_id, new.usuario_id);
    select p.base into v_base_depois from plataforma.perfil p where p.tenant_id = new.tenant_id and p.id = new.perfil_id;
  end if;
  if tg_op <> 'INSERT' then
    if tg_op = 'DELETE' or old.usuario_id is distinct from new.usuario_id then
      perform plataforma.conferir_perfis_do_usuario(old.tenant_id, old.usuario_id);
    end if;
    if old.deleted_at is null then
      select p.base into v_base_antes from plataforma.perfil p where p.tenant_id = old.tenant_id and p.id = old.perfil_id;
    end if;
  end if;
  -- saiu um vínculo vivo com perfil de base admin; ou quem tem perfil de base admin ganhou um que fecha o BKO (RN-CORE-33)
  if v_base_antes = 'admin'
     or (tg_op <> 'DELETE' and new.deleted_at is null and v_base_depois in ('vendedor', 'promotor', 'supervisor')
         and exists (select 1 from plataforma.usuario_perfil up
                       join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
                      where up.tenant_id = new.tenant_id and up.usuario_id = new.usuario_id and up.deleted_at is null
                        and p.base = 'admin')) then
    perform plataforma.conferir_ultimo_admin(v_tenant);
  end if;
  return null;
end
$$;
revoke all on function plataforma.usuario_perfil_conferir() from public;
create constraint trigger usuario_perfil_conferir after insert or update or delete on plataforma.usuario_perfil
  deferrable initially deferred
  for each row execute function plataforma.usuario_perfil_conferir();

create function plataforma.perfil_conferir() returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_atual record;
begin
  if not exists (select 1 from plataforma.tenant t where t.id = old.tenant_id) then
    return null;
  end if;
  select p.ativo, p.deleted_at into v_atual from plataforma.perfil p where p.tenant_id = old.tenant_id and p.id = old.id;
  -- os 7 de fábrica ficam (o CHECK perfil_fabrica_ativo cobre a desativação; aqui, a exclusão física fora da excluir_tenant)
  if old.fabrica and not exists (select 1 from plataforma.perfil p
                                   where p.tenant_id = old.tenant_id and p.codigo = old.codigo and p.fabrica) then
    raise exception 'o perfil de fábrica % não pode ser apagado', old.codigo using errcode = '23514',
      constraint = 'perfil_fabrica_presente', hint = 'RN-CORE-35';
  end if;
  -- perfil desativado ou apagado não pode ficar com usuário (os vínculos saem antes)
  if (v_atual is null or not v_atual.ativo or v_atual.deleted_at is not null)
     and exists (select 1 from plataforma.usuario_perfil up
                   join core.usuario u on u.tenant_id = up.tenant_id and u.id = up.usuario_id and u.deleted_at is null
                  where up.tenant_id = old.tenant_id and up.perfil_id = old.id and up.deleted_at is null) then
    raise exception 'perfil em uso por usuário não pode ser desativado nem apagado' using errcode = '23514',
      constraint = 'perfil_em_uso', hint = 'RN-CORE-01';
  end if;
  if old.base = 'admin' and old.ativo and old.deleted_at is null then
    perform plataforma.conferir_ultimo_admin(old.tenant_id);
  end if;
  return null;
end
$$;
revoke all on function plataforma.perfil_conferir() from public;
create constraint trigger perfil_conferir after update of ativo, deleted_at or delete on plataforma.perfil
  deferrable initially deferred
  for each row execute function plataforma.perfil_conferir();

create function plataforma.perfil_permissao_conferir() returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tenant uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  c_chaves constant text[] := array['acesso.bko', 'perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar'];
begin
  if not exists (select 1 from plataforma.tenant t where t.id = v_tenant) then
    return null;
  end if;
  if ((tg_op <> 'DELETE' and new.chave = any (c_chaves)) or (tg_op <> 'INSERT' and old.chave = any (c_chaves)))
     -- tenant com algum usuário ativo de perfil de base admin (sem nenhum, a mudança não tirou o último)
     and exists (select 1 from plataforma.usuario_perfil up
                   join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
                   join core.usuario u on u.tenant_id = up.tenant_id and u.id = up.usuario_id
                  where up.tenant_id = v_tenant and up.deleted_at is null and p.base = 'admin' and p.ativo and p.deleted_at is null
                    and u.ativo and u.deleted_at is null) then
    perform plataforma.conferir_ultimo_admin(v_tenant);
  end if;
  return null;
end
$$;
revoke all on function plataforma.perfil_permissao_conferir() from public;
create constraint trigger perfil_permissao_conferir after insert or update or delete on plataforma.perfil_permissao
  deferrable initially deferred
  for each row execute function plataforma.perfil_permissao_conferir();

-- 9. Leitura da API a cada requisição ------------------------------------------------------------------------------------------
create function plataforma.perfis_do_usuario(p_usuario uuid)
  returns table (perfil_id uuid, codigo text, base text, nome text, fabrica boolean, sobreposicoes jsonb, modulos text[])
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select p.id, p.codigo, p.base, p.nome, p.fabrica,
           coalesce((select jsonb_agg(jsonb_build_object('chave', pp.chave, 'concedida', pp.concedida, 'nivel', pp.nivel,
                                                         'alvos', to_jsonb(pp.alvos)) order by pp.chave)
                       from plataforma.perfil_permissao pp
                      where pp.tenant_id = p.tenant_id and pp.perfil_id = p.id and pp.deleted_at is null), '[]'::jsonb),
           coalesce((select array_agg(pm.modulo order by pm.modulo)
                       from plataforma.perfil_modulo pm
                      where pm.tenant_id = p.tenant_id and pm.perfil = p.codigo and pm.deleted_at is null), '{}'::text[])
      from plataforma.usuario_perfil up
      join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
     where up.tenant_id = plataforma.tenant_atual() and up.usuario_id = p_usuario and up.deleted_at is null
       and p.ativo and p.deleted_at is null
     order by p.fabrica desc, p.codigo
  $$;
revoke all on function plataforma.perfis_do_usuario(uuid) from public;
grant execute on function plataforma.perfis_do_usuario(uuid) to macuxi_app;

-- 10. Semeadura dos tenants e usuários existentes ------------------------------------------------------------------------------
do $$
declare
  v_t uuid;
begin
  for v_t in select t.id from plataforma.tenant t order by t.id loop
    perform plataforma.semear_perfis_fabrica(v_t);
  end loop;
end
$$;

insert into plataforma.usuario_perfil (id, tenant_id, usuario_id, perfil_id, deleted_at)
select plataforma.uuid_de_chave(u.tenant_id::text || ':plataforma.usuario_perfil:' || u.id::text || ':' || p.id::text),
       u.tenant_id, u.id, p.id, null
  from core.usuario u
  join plataforma.perfil p on p.tenant_id = u.tenant_id and p.codigo = u.perfil and p.fabrica
on conflict do nothing;

-- 11. perfil_modulo por código de perfil do tenant ---------------------------------------------------------------------------
alter table plataforma.perfil_modulo drop constraint perfil_modulo_perfil_valido;
alter table plataforma.perfil_modulo add constraint perfil_modulo_perfil_fk
  foreign key (tenant_id, perfil) references plataforma.perfil (tenant_id, codigo);

-- 12. Conferência: os 7 de fábrica em todo tenant e nenhum usuário sem perfil ------------------------------------------------
do $$
declare
  v_n integer;
begin
  select count(*) into v_n
    from plataforma.tenant t
   where (select count(*) from plataforma.perfil p where p.tenant_id = t.id and p.fabrica and p.ativo and p.deleted_at is null) <> 7;
  if v_n > 0 then
    raise exception '0041: % tenant(s) sem os 7 perfis de fábrica', v_n using errcode = '23514';
  end if;
  select count(*) into v_n
    from core.usuario u
   where not exists (select 1 from plataforma.usuario_perfil up
                       join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
                      where up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
                        and p.base = u.perfil and p.ativo and p.deleted_at is null);
  if v_n > 0 then
    raise exception '0041: % usuário(s) sem perfil (RN-CORE-01)', v_n using errcode = '23514';
  end if;
end
$$;

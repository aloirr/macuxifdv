-- 0036_core_usuario_convite (up) — T-0087 fatia E (Equipe por CSV com convite de 1º acesso; RN-CORE-31; desenho
-- docs/modulos/core/equipe-csv.md e docs/desenho/T-0087.md §5.3; pedido R-20261106-034446-modulo-core). Dicionário:
-- docs/banco/core.md ("0036 — convite de 1º acesso") e docs/banco/lgpd.md.
-- Migração ADITIVA: 1 tabela nova, 1 coluna nula nova em core.usuario e a plataforma.anonimizar_usuario (0024) com 2 passos a
-- mais (mesma assinatura, mesmo retorno, mais 1 item). Nenhuma coluna existente muda, nenhum dado existente é reescrito.
--
-- core.usuario_convite: convite de 1º acesso, de USO ÚNICO, entregue por LINK (sem e-mail na plataforma). O token
--   (`<tenant_id>.<segredo>`, segredo de 32 bytes em base64url, como o refresh da 0004) aparece uma vez na resposta da API ao
--   admin/super-admin; o banco guarda SÓ o SHA-256 hex do segredo (token_hash, CHECK de formato, ÚNICO GLOBAL). O tenant vem no
--   próprio token, então a API localiza o convite DENTRO do contexto do tenant, sob RLS: NENHUMA função SECURITY DEFINER nova.
--   Consumo atômico pela API: `select … for update` + `update … set usado_em` na mesma transação (uso único).
--   Prazo (7 dias, RN-CORE-31) e renovação são da API: o banco não amarra expira_em nem usado_em ao created_at (o relógio da
--   API e o simulado dos testes podem divergir do now() do banco). Renovar = revogar o pendente e inserir outro, NESSA ordem:
--   no máximo 1 convite PENDENTE (não usado, não revogado, não apagado) por usuário (único parcial usuario_convite_pendente_uk).
--   Usado e revogado se excluem (usuario_convite_usado_ou_revogado).
--   criado_por_id + criado_por_tipo: quem gerou ('usuario' = core.usuario do tenant, admin no BKO; 'super_admin' = operador da
--   plataforma, plataforma.super_admin da 0035, fora dos tenants). SEM FK, como o ator_id da 0035 em plataforma.auditoria
--   (a coluna aponta para tabelas diferentes conforme o tipo). Os dois nulos = carga/seed; um sem o outro = 23514.
--   Fora do sync (TABELAS_FORA_DO_SYNC, como core.sessao): nunca vai ao aparelho.
--   RLS: enable + force + isolamento_tenant (macuxi_app) + manutencao (0031). macuxi_app: select, insert, update (SEM delete:
--   convite não se apaga, se revoga). macuxi_worker: sem acesso.
--   Volume: centenas por tenant (1 por pessoa da equipe + renovações). Consultas: por token_hash no aceite (rota pública, pouco
--   frequente: usuario_convite_token_uk); pendentes do tenant e por usuário na lista e na renovação
--   (usuario_convite_pendente_uk, usuario_convite_usuario_ix).
-- core.usuario.telefone (text, null): telefone do CSV da Equipe (dado pessoal; a API valida o formato no domain do Core). CHECK
--   só de tamanho: null, ou não vazio e até 30 caracteres. Sem índice. Fora do pull do usuário (o Core seleciona as colunas).
-- plataforma.anonimizar_usuario (LGPD, 0024): também apaga o telefone e REVOGA os convites pendentes do titular (o link deixa
--   de valer). Devolve o item novo 'core.usuario_convite' (quantos revogou), entre 'core.dispositivo' e 'core.visita'.
--
-- Caminho de volta: 0036_core_usuario_convite.down.sql (APAGA a tabela com os convites — os links pendentes deixam de valer e
-- o admin gera outros depois de reaplicar — e a coluna telefone com os telefones; a anonimizar_usuario volta ao corpo da 0024).

-- =============================================================================================
-- core.usuario.telefone
-- =============================================================================================
alter table core.usuario add column telefone text;
alter table core.usuario add constraint usuario_telefone_preenchido
  check (telefone is null or (btrim(telefone) <> '' and char_length(telefone) <= 30));

-- =============================================================================================
-- core.usuario_convite — convite de 1º acesso (RN-CORE-31)
-- =============================================================================================
create table core.usuario_convite (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  usuario_id       uuid not null,
  token_hash       text not null,
  expira_em        timestamptz not null,
  usado_em         timestamptz,
  revogado_em      timestamptz,
  criado_por_id    uuid,
  criado_por_tipo  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint usuario_convite_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint usuario_convite_token_hash_sha256 check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint usuario_convite_usado_ou_revogado check (usado_em is null or revogado_em is null),
  constraint usuario_convite_criado_por_tipo_valido check (criado_por_tipo is null or criado_por_tipo in ('usuario', 'super_admin')),
  constraint usuario_convite_criado_por_par check ((criado_por_id is null) = (criado_por_tipo is null))
);
create unique index usuario_convite_token_uk on core.usuario_convite (token_hash);
create unique index usuario_convite_pendente_uk on core.usuario_convite (tenant_id, usuario_id)
  where usado_em is null and revogado_em is null and deleted_at is null;
create index usuario_convite_usuario_ix on core.usuario_convite (tenant_id, usuario_id);
create trigger usuario_convite_updated_at before update on core.usuario_convite
  for each row execute function plataforma.definir_updated_at();
alter table core.usuario_convite enable row level security;
alter table core.usuario_convite force row level security;
create policy isolamento_tenant on core.usuario_convite for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.usuario_convite for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.usuario_convite to macuxi_app;

-- =============================================================================================
-- plataforma.anonimizar_usuario — telefone e convites pendentes (LGPD; corpo da 0024 + 2 passos)
-- =============================================================================================
create or replace function plataforma.anonimizar_usuario(p_tenant uuid, p_usuario uuid)
  returns table (item text, quantidade bigint)
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_ext text;
  v_n bigint;
begin
  if p_tenant is null or p_usuario is null then
    raise exception 'anonimizar_usuario: p_tenant e p_usuario obrigatórios' using errcode = '22004';
  end if;
  select u.external_id into v_ext from core.usuario u where u.tenant_id = p_tenant and u.id = p_usuario for update;
  if not found then
    raise exception 'anonimizar_usuario: usuário não encontrado no tenant' using errcode = 'P0002';
  end if;

  update core.usuario u
     set nome = 'Usuário anonimizado', nome_curto = null, telefone = null,
         email = 'anonimizado-' || u.id::text || '@anonimizado.invalid',
         senha_hash = null, external_id = null, ativo = false,
         bloqueado_em = coalesce(u.bloqueado_em, now()), deleted_at = coalesce(u.deleted_at, now())
   where u.tenant_id = p_tenant and u.id = p_usuario;
  item := 'core.usuario'; quantidade := 1; return next;

  update core.sessao s set revogado_em = coalesce(s.revogado_em, now())
   where s.tenant_id = p_tenant and s.usuario_id = p_usuario;
  get diagnostics v_n = row_count;
  item := 'core.sessao'; quantidade := v_n; return next;

  update core.dispositivo d set nome = null, bloqueado_em = coalesce(d.bloqueado_em, now())
   where d.tenant_id = p_tenant and d.usuario_id = p_usuario;
  get diagnostics v_n = row_count;
  item := 'core.dispositivo'; quantidade := v_n; return next;

  update core.usuario_convite c set revogado_em = now()
   where c.tenant_id = p_tenant and c.usuario_id = p_usuario and c.usado_em is null and c.revogado_em is null;
  get diagnostics v_n = row_count;
  item := 'core.usuario_convite'; quantidade := v_n; return next;

  update core.visita v set checkin_lat = null, checkin_lng = null, checkout_lat = null, checkout_lng = null
   where v.tenant_id = p_tenant and v.usuario_id = p_usuario
     and (v.checkin_lat is not null or v.checkout_lat is not null);
  get diagnostics v_n = row_count;
  item := 'core.visita'; quantidade := v_n; return next;

  update plataforma.auditoria a set antes = null, depois = null
   where a.tenant_id = p_tenant and a.entidade_id = p_usuario and (a.antes is not null or a.depois is not null);
  get diagnostics v_n = row_count;
  item := 'plataforma.auditoria'; quantidade := v_n; return next;

  update plataforma.evento e set payload = '{}'::jsonb
   where e.tenant_id = p_tenant and e.agregado_id = p_usuario and e.publicado_em is not null and e.payload <> '{}'::jsonb;
  get diagnostics v_n = row_count;
  item := 'plataforma.evento'; quantidade := v_n; return next;

  v_n := 0;
  if v_ext is not null then
    update integracao.registro_atual r set payload = null
     where r.tenant_id = p_tenant and r.entidade = 'vendedor' and r.external_id = v_ext and r.payload is not null;
    get diagnostics v_n = row_count;
  end if;
  item := 'integracao.registro_atual'; quantidade := v_n; return next;

  insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id)
  values (p_tenant, null, 'core', 'lgpd.anonimizar', 'usuario', p_usuario);
end
$$;

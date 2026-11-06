-- 0036_core_usuario_convite (down) — T-0087 fatia E
-- Desfaz a 0036: a plataforma.anonimizar_usuario volta ao corpo da 0024 (sem telefone nem convites; mesma assinatura, grants
-- intactos), APAGA core.usuario_convite com os convites (links pendentes deixam de valer; o admin gera outros pela renovação
-- depois de reaplicar a 0036) e APAGA core.usuario.telefone com os telefones (voltam na próxima importação da Equipe).
-- A função volta ANTES de apagar a tabela e a coluna (o corpo novo cita as duas). Idempotente (if exists em tudo).
-- Pré-condição: 0037+ desfeitas.

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
     set nome = 'Usuário anonimizado', nome_curto = null,
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

drop table if exists core.usuario_convite;

alter table core.usuario drop constraint if exists usuario_telefone_preenchido;
alter table core.usuario drop column if exists telefone;

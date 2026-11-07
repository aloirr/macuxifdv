-- 0035_plataforma_super_admin (down) — T-0087 fatia P (ADR 0029)
-- Desfaz a 0035. APAGA as 4 tabelas do super-admin (super_admin, super_admin_desafio, super_admin_sessao e
-- auditoria_plataforma, COM a auditoria da plataforma: exporte antes se precisar guardar), as 20 funções sa_* (o portal
-- config. passa a responder 503/500: falha fechada), a função interna sa_registrar_auditoria, o gatilho append-only e
-- devolve a plataforma.provisionar_tenant da 0029 (sem sem_admin, parametros e ator_id; o comando tenant:criar segue igual).
-- Tenants, licenças, perfis e parâmetros já gravados pelo portal FICAM (são dados do tenant).
-- O drop table não dispara o gatilho de delete (append-only vale para linhas, não para a remoção da tabela).
-- Idempotente (if exists). Pré-condição: 0036+ desfeitas.

drop function if exists plataforma.sa_provisionar_tenant(uuid, jsonb);
drop function if exists plataforma.sa_tenant_ativo(uuid, uuid);
drop function if exists plataforma.sa_listar_tenants(uuid);
drop function if exists plataforma.sa_auditar(jsonb);
drop function if exists plataforma.sa_revogar(uuid);
drop function if exists plataforma.sa_sessao_valida(uuid);
drop function if exists plataforma.sa_abrir_sessao(text);
drop function if exists plataforma.sa_ver_desafio(text);
drop function if exists plataforma.sa_abrir_desafio(uuid, text);
drop function if exists plataforma.sa_regerar_recuperacao(uuid, text[]);
drop function if exists plataforma.sa_usar_recuperacao(uuid, text);
drop function if exists plataforma.sa_marcar_passo(uuid, bigint);
drop function if exists plataforma.sa_confirmar_totp(uuid, bigint, text[]);
drop function if exists plataforma.sa_gravar_totp_pendente(uuid, text);
drop function if exists plataforma.sa_registrar_sucesso(uuid);
drop function if exists plataforma.sa_registrar_falha(uuid);
drop function if exists plataforma.sa_por_id(uuid);
drop function if exists plataforma.sa_para_login(text);
drop function if exists plataforma.sa_criar_primeiro(text, text, text);
drop function if exists plataforma.sa_existe();
drop function if exists plataforma.sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb);
drop table if exists plataforma.auditoria_plataforma;
drop function if exists plataforma.auditoria_plataforma_recusar();
drop table if exists plataforma.super_admin_sessao;
drop table if exists plataforma.super_admin_desafio;
drop table if exists plataforma.super_admin;

-- provisionar_tenant: volta exatamente à da 0029 (cópia do corpo da 0029_plataforma_provisionar_tenant.up.sql)
drop function if exists plataforma.provisionar_tenant(jsonb);
create function plataforma.provisionar_tenant(p jsonb)
  returns jsonb
  language plpgsql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  c_perfis constant text[] := array['admin', 'analista', 'assistente', 'supervisor', 'gerente', 'vendedor', 'promotor'];
  v_contexto text := current_setting('app.tenant_id', true);
  v_codigo text;
  v_nome text;
  v_documento text;
  v_fuso text;
  v_plano text;
  v_redefinir boolean;
  v_admin jsonb;
  v_email text;
  v_admin_nome text;
  v_hash text;
  v_m jsonb;
  v_modulo text;
  v_licencas integer;
  v_perfil text;
  v_vistos text[] := '{}';
  v_tenant uuid;
  v_criado boolean := false;
  v_existente record;
  v_diferentes text[] := '{}';
  v_modulos_antes text[] := '{}';
  v_adicionados text[] := '{}';
  v_avisos text[] := '{}';
  v_usuario record;
  v_admin_res text;
  v_resultado text;
  v_n integer;
begin
  -- a entrada leva o hash da senha: nada de log de comando nesta transação (só superusuário muda esses parâmetros)
  if current_setting('is_superuser') = 'on' then
    perform set_config('log_min_duration_statement', '-1', true), set_config('log_statement', 'none', true);
  end if;

  -- validação básica (o comando já validou tudo; mensagens sem dado pessoal) ----------------------------------------
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'provisionar_tenant: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  v_codigo := p ->> 'codigo';
  if v_codigo is null or v_codigo !~ '^[a-z0-9][a-z0-9-]{1,39}$' then
    raise exception 'provisionar_tenant: codigo inválido (minúsculas, dígitos e hífen, 2 a 40)' using errcode = '22023';
  end if;
  v_nome := nullif(btrim(p ->> 'nome'), '');
  if v_nome is null then
    raise exception 'provisionar_tenant: nome do tenant obrigatório' using errcode = '22023';
  end if;
  v_documento := nullif(btrim(p ->> 'documento'), '');
  v_fuso := coalesce(nullif(btrim(p ->> 'fuso'), ''), 'America/Sao_Paulo');
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_fuso) then
    raise exception 'provisionar_tenant: fuso desconhecido: %', v_fuso using errcode = '22023';
  end if;
  v_plano := coalesce(nullif(btrim(p ->> 'plano'), ''), 'piloto');
  if coalesce(jsonb_typeof(p -> 'redefinir_senha'), 'null') not in ('boolean', 'null') then
    raise exception 'provisionar_tenant: redefinir_senha deve ser booleano' using errcode = '22023';
  end if;
  v_redefinir := coalesce((p ->> 'redefinir_senha')::boolean, false);

  if coalesce(jsonb_typeof(p -> 'modulos'), 'null') <> 'array' then
    raise exception 'provisionar_tenant: modulos deve ser uma lista não vazia' using errcode = '22023';
  end if;
  if jsonb_array_length(p -> 'modulos') = 0 then
    raise exception 'provisionar_tenant: modulos deve ser uma lista não vazia' using errcode = '22023';
  end if;
  for v_m in select x.value from jsonb_array_elements(p -> 'modulos') x loop
    if jsonb_typeof(v_m) <> 'object' then
      raise exception 'provisionar_tenant: cada módulo deve ser um objeto' using errcode = '22023';
    end if;
    v_modulo := v_m ->> 'modulo';
    if v_modulo is null or v_modulo !~ '^[a-z][a-z0-9-]*$' then
      raise exception 'provisionar_tenant: nome de módulo inválido' using errcode = '22023';
    end if;
    if v_modulo = any (v_vistos) then
      raise exception 'provisionar_tenant: módulo repetido: %', v_modulo using errcode = '22023';
    end if;
    v_vistos := v_vistos || v_modulo;
    if coalesce(jsonb_typeof(v_m -> 'licencas'), 'null') <> 'null'
       and (jsonb_typeof(v_m -> 'licencas') <> 'number' or (v_m ->> 'licencas') !~ '^[0-9]{1,9}$') then
      raise exception 'provisionar_tenant: licencas de % deve ser inteiro >= 0', v_modulo using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_m -> 'perfis'), 'null') not in ('array', 'null') then
      raise exception 'provisionar_tenant: perfis de % deve ser uma lista', v_modulo using errcode = '22023';
    end if;
    for v_perfil in select y.value from jsonb_array_elements_text(coalesce(v_m -> 'perfis', '[]'::jsonb)) y loop
      if not (v_perfil = any (c_perfis)) then
        raise exception 'provisionar_tenant: perfil desconhecido em %: %', v_modulo, v_perfil using errcode = '22023';
      end if;
      if v_modulo = 'vendedor' and v_perfil = 'promotor' then
        raise exception 'provisionar_tenant: o perfil promotor nunca recebe o módulo vendedor (RN-PRO-01)' using errcode = '22023';
      end if;
    end loop;
  end loop;
  if not ('core' = any (v_vistos)) then
    raise exception 'provisionar_tenant: o módulo core é obrigatório (RN-CORE-31)' using errcode = '22023';
  end if;

  v_admin := p -> 'admin';
  if coalesce(jsonb_typeof(v_admin), 'null') <> 'object' then
    raise exception 'provisionar_tenant: admin obrigatório' using errcode = '22023';
  end if;
  v_email := btrim(v_admin ->> 'email');
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'provisionar_tenant: e-mail do admin inválido' using errcode = '22023';
  end if;
  v_admin_nome := nullif(btrim(v_admin ->> 'nome'), '');
  if v_admin_nome is null then
    raise exception 'provisionar_tenant: nome do admin obrigatório' using errcode = '22023';
  end if;
  v_hash := v_admin ->> 'senha_hash';
  if v_hash is null or v_hash !~ '^\$argon2id\$v=[0-9]+\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$' then
    raise exception 'provisionar_tenant: senha_hash do admin deve ser argon2id (formato PHC)' using errcode = '22023';
  end if;

  -- 1. tenant --------------------------------------------------------------------------------------------------------
  insert into plataforma.tenant (codigo, nome, documento, fuso, plano)
  values (v_codigo, v_nome, v_documento, v_fuso, v_plano)
  on conflict ((lower(codigo))) do nothing
  returning id into v_tenant;
  if v_tenant is not null then
    v_criado := true;
  else
    select t.id, t.nome, t.documento, t.fuso, t.plano, t.status, t.deleted_at into v_existente
      from plataforma.tenant t
     where lower(t.codigo) = lower(v_codigo)
       for update;
    if v_existente.deleted_at is not null or v_existente.status = 'encerrado' then
      raise exception 'provisionar_tenant: o tenant % está encerrado ou excluído: nada muda', v_codigo using errcode = '55000';
    end if;
    v_tenant := v_existente.id;
    if v_existente.nome is distinct from v_nome then v_diferentes := v_diferentes || 'nome'::text; end if;
    if v_existente.documento is distinct from v_documento then v_diferentes := v_diferentes || 'documento'::text; end if;
    if v_existente.fuso is distinct from v_fuso then v_diferentes := v_diferentes || 'fuso'::text; end if;
    if v_existente.plano is distinct from v_plano then v_diferentes := v_diferentes || 'plano'::text; end if;
    if cardinality(v_diferentes) > 0 then
      v_avisos := v_avisos || format('tenant existente: %s não mudam', array_to_string(v_diferentes, ', '));
    end if;
    if v_existente.status = 'suspenso' then
      v_avisos := v_avisos || 'tenant suspenso: o status não muda'::text;
    end if;
  end if;
  perform set_config('app.tenant_id', v_tenant::text, true);

  select coalesce(array_agg(tm.modulo order by tm.modulo), '{}') into v_modulos_antes
    from plataforma.tenant_modulo tm
   where tm.tenant_id = v_tenant and tm.deleted_at is null;

  -- 2 e 3. módulos e perfis --------------------------------------------------------------------------------------------
  for v_m in select x.value from jsonb_array_elements(p -> 'modulos') x order by x.value ->> 'modulo' loop
    v_modulo := v_m ->> 'modulo';
    v_licencas := case when jsonb_typeof(v_m -> 'licencas') = 'number' then (v_m ->> 'licencas')::integer end;
    insert into plataforma.tenant_modulo (tenant_id, modulo, ativo, licencas, ativado_em)
    values (v_tenant, v_modulo, true, v_licencas, now())
    on conflict (tenant_id, modulo) where deleted_at is null do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then
      v_adicionados := v_adicionados || v_modulo;
      insert into plataforma.perfil_modulo (tenant_id, perfil, modulo)
      select distinct v_tenant, y.value, v_modulo
        from jsonb_array_elements_text(coalesce(v_m -> 'perfis', '[]'::jsonb)) y
      on conflict (tenant_id, perfil, modulo) where deleted_at is null do nothing;
    elsif exists (select 1 from plataforma.tenant_modulo tm
                   where tm.tenant_id = v_tenant and tm.modulo = v_modulo and tm.deleted_at is null and not tm.ativo) then
      v_avisos := v_avisos || format('módulo %s existe desativado: não é religado (BKO de licenças)', v_modulo);
    end if;
  end loop;

  -- 4. admin inicial ---------------------------------------------------------------------------------------------------
  select u.id, u.perfil, u.ativo, u.bloqueado_em, u.senha_hash into v_usuario
    from core.usuario u
   where u.tenant_id = v_tenant and lower(u.email) = lower(v_email) and u.deleted_at is null
     for update;
  if not found then
    insert into core.usuario (tenant_id, nome, email, perfil, ativo, senha_hash)
    values (v_tenant, v_admin_nome, v_email, 'admin', true, v_hash);
    v_admin_res := 'criado';
  else
    if v_redefinir and v_usuario.senha_hash is distinct from v_hash then
      update core.usuario u set senha_hash = v_hash where u.tenant_id = v_tenant and u.id = v_usuario.id;
      v_admin_res := 'senha_redefinida';
    else
      v_admin_res := 'existente';
    end if;
    if v_usuario.perfil <> 'admin' then
      v_avisos := v_avisos || format('o usuário do e-mail informado tem perfil %s: o perfil não muda', v_usuario.perfil);
    end if;
    if not v_usuario.ativo or v_usuario.bloqueado_em is not null then
      v_avisos := v_avisos || 'o usuário do e-mail informado está inativo ou bloqueado: nada muda além da senha pedida'::text;
    end if;
  end if;

  -- 5. resultado e auditoria (só quando algo mudou) ----------------------------------------------------------------
  v_resultado := case
    when v_criado then 'criado'
    when cardinality(v_adicionados) > 0 or v_admin_res <> 'existente' then 'atualizado'
    else 'sem_mudanca'
  end;
  if v_resultado <> 'sem_mudanca' then
    insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois)
    values (v_tenant, null, 'core', 'tenant.provisionar', 'tenant', v_tenant,
            case when v_criado then null else jsonb_build_object('modulos', to_jsonb(v_modulos_antes)) end,
            jsonb_build_object('resultado', v_resultado, 'modulos_adicionados', to_jsonb(v_adicionados), 'admin', v_admin_res));
  end if;

  perform set_config('app.tenant_id', coalesce(v_contexto, ''), true);
  return jsonb_build_object(
    'tenant_id', v_tenant,
    'resultado', v_resultado,
    'modulos_adicionados', to_jsonb(v_adicionados),
    'admin', v_admin_res,
    'avisos', to_jsonb(v_avisos)
  );
end
$$;
revoke all on function plataforma.provisionar_tenant(jsonb) from public;

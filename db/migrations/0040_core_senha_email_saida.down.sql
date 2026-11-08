-- 0040_core_senha_email_saida (down) — desfaz a 0040 (T-0094 fatia B, ADR 0032). Volta exatamente ao catálogo da 0039.
-- ATENÇÃO: APAGA a outbox de e-mail (plataforma.email_saida) com os e-mails ainda não enviados, as colunas do estado da
-- senha de core.usuario (trocar_senha, validade, senha temporária paralela e sessao_versao) e a sessao_versao da sessão do
-- portal. Quem estava com senha temporária fica com ela como definitiva; o "Esqueci a senha" pendente se perde. Os
-- convites revogados pela 0040 continuam revogados. Desfaça junto o Core desta tarefa (ele lê as colunas e a outbox).
-- Ordem: as funções voltam ao texto anterior ANTES de as colunas saírem (nenhum corpo fica apontando para coluna apagada).

-- 1. As 4 sa_* do portal com o texto da 0039 (drop + create; EXECUTE só ao macuxi_portal, como na 0039) --------------------
drop function if exists plataforma.sa_contas_para_login(text);
create function plataforma.sa_contas_para_login(p_email text)
  returns table (tipo text, conta_id uuid, tenant_id uuid, tenant_codigo text, tenant_nome text, senha_hash text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(p_email));
  v_n integer := 0;
begin
  -- e-mail vazio ou fora do formato: 0 linhas, sem erro (a resposta não pode diferir da de um e-mail que não existe)
  if v_email is null or v_email = '' or char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    v_email := null;
  end if;
  if v_email is not null then
    return query
      select c.tipo, c.conta_id, c.tenant_id, c.tenant_codigo, c.tenant_nome, c.senha_hash
        from (
          select 'super_admin'::text as tipo, s.id as conta_id, null::uuid as tenant_id, null::text as tenant_codigo,
                 null::text as tenant_nome, s.senha_hash, 0 as ordem, ''::text as nome_ordem, s.id as id_ordem
            from plataforma.super_admin s
           where lower(s.email) = v_email and s.deleted_at is null and s.ativo
          union all
          select 'admin_cliente'::text, u.id, t.id, t.codigo, t.nome, u.senha_hash, 1, t.nome, t.id
            from core.usuario u
            join plataforma.tenant t on t.id = u.tenant_id
           where lower(u.email) = v_email and u.perfil = 'admin' and u.deleted_at is null and u.ativo and u.bloqueado_em is null
             and u.senha_hash is not null and t.status = 'ativo' and t.deleted_at is null
        ) as c
       order by c.ordem, c.nome_ordem, c.id_ordem
       limit 20;
    get diagnostics v_n = row_count;
  end if;
  perform plataforma.sa_registrar_auditoria(null, null, null, null, null, 'sa.login.consulta', jsonb_build_object('contas', v_n));
end
$$;
revoke all on function plataforma.sa_contas_para_login(text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_contas_para_login(text) to macuxi_portal;

drop function if exists plataforma.sa_abrir_sessao_portal(jsonb);
create function plataforma.sa_abrir_sessao_portal(p jsonb)
  returns table (sessao_id uuid, expira_em timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_tipo text;
  v_sa uuid;
  v_sid uuid;
  v_expira timestamptz := now() + interval '8 hours';
  v_e jsonb;
  v_n integer;
  v_t uuid;
  v_u uuid;
  v_vistos uuid[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sa_abrir_sessao_portal: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  v_tipo := p ->> 'tipo';
  if v_tipo = 'super_admin' then
    if p ? 'empresas' or coalesce(jsonb_typeof(p -> 'super_admin_id'), 'null') <> 'string' or (p ->> 'super_admin_id') !~ c_uuid then
      raise exception 'sa_abrir_sessao_portal: super_admin exige super_admin_id (UUID) e não aceita empresas' using errcode = '22023';
    end if;
    v_sa := (p ->> 'super_admin_id')::uuid;
    if not exists (select 1 from plataforma.super_admin s where s.id = v_sa and s.deleted_at is null and s.ativo) then
      return;
    end if;
    insert into plataforma.portal_sessao (tipo, super_admin_id, criada_em, ultimo_uso_em, expira_em)
    values ('super_admin', v_sa, now(), now(), v_expira)
    returning id into v_sid;
    perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, v_sid, null, 'sa.sessao.aberta', '{}'::jsonb);
  elsif v_tipo = 'admin_cliente' then
    if p ? 'super_admin_id' or coalesce(jsonb_typeof(p -> 'empresas'), 'null') <> 'array' then
      raise exception 'sa_abrir_sessao_portal: admin_cliente exige a lista empresas e não aceita super_admin_id' using errcode = '22023';
    end if;
    v_n := jsonb_array_length(p -> 'empresas');
    if v_n not between 1 and 20 then
      raise exception 'sa_abrir_sessao_portal: de 1 a 20 empresas' using errcode = '22023';
    end if;
    for v_e in select x.value from jsonb_array_elements(p -> 'empresas') x loop
      if jsonb_typeof(v_e) <> 'object' or coalesce(jsonb_typeof(v_e -> 'tenant_id'), 'null') <> 'string'
         or coalesce(jsonb_typeof(v_e -> 'usuario_id'), 'null') <> 'string'
         or (v_e ->> 'tenant_id') !~ c_uuid or (v_e ->> 'usuario_id') !~ c_uuid then
        raise exception 'sa_abrir_sessao_portal: cada empresa é { tenant_id, usuario_id } (UUID)' using errcode = '22023';
      end if;
      v_t := (v_e ->> 'tenant_id')::uuid;
      v_u := (v_e ->> 'usuario_id')::uuid;
      if v_t = any (v_vistos) then
        raise exception 'sa_abrir_sessao_portal: empresa repetida' using errcode = '22023';
      end if;
      v_vistos := v_vistos || v_t;
      -- reconfere no banco (entre a busca e a sessão o admin pode ter sido desativado): uma que não vale = sem sessão
      if not exists (select 1 from core.usuario u join plataforma.tenant t on t.id = u.tenant_id
                      where u.tenant_id = v_t and u.id = v_u and u.perfil = 'admin' and u.ativo and u.bloqueado_em is null
                        and u.senha_hash is not null and u.deleted_at is null and t.status = 'ativo' and t.deleted_at is null) then
        return;
      end if;
    end loop;
    insert into plataforma.portal_sessao (tipo, criada_em, ultimo_uso_em, expira_em)
    values ('admin_cliente', now(), now(), v_expira)
    returning id into v_sid;
    insert into plataforma.portal_sessao_empresa (sessao_id, tenant_alvo_id, usuario_id)
    select v_sid, (x.value ->> 'tenant_id')::uuid, (x.value ->> 'usuario_id')::uuid
      from jsonb_array_elements(p -> 'empresas') x;
    if v_n = 1 then
      update plataforma.portal_sessao x set tenant_atual_id = v_t, usuario_atual_id = v_u where x.id = v_sid;
    end if;
    perform plataforma.sa_registrar_auditoria('admin_cliente', null, case when v_n = 1 then v_u end, v_sid,
      case when v_n = 1 then v_t end, 'sa.sessao.aberta', jsonb_build_object('empresas', v_n));
  else
    raise exception 'sa_abrir_sessao_portal: tipo deve ser super_admin ou admin_cliente' using errcode = '22023';
  end if;
  sessao_id := v_sid;
  expira_em := v_expira;
  return next;
end
$$;
revoke all on function plataforma.sa_abrir_sessao_portal(jsonb) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_abrir_sessao_portal(jsonb) to macuxi_portal;

drop function if exists plataforma.sa_escolher_empresa(uuid, uuid);
create function plataforma.sa_escolher_empresa(p_sid uuid, p_tenant uuid)
  returns table (tenant_id uuid, usuario_id uuid, codigo text, nome text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_u uuid;
  v_codigo text;
  v_nome text;
begin
  select e.usuario_id into v_u
    from plataforma.portal_sessao x
    join plataforma.portal_sessao_empresa e on e.sessao_id = x.id
   where x.id = p_sid and x.tipo = 'admin_cliente' and x.revogada_em is null and x.deleted_at is null and x.expira_em > now()
     and e.tenant_alvo_id = p_tenant and e.deleted_at is null
     for update of x;
  if v_u is null then
    return;
  end if;
  select t.codigo, t.nome into v_codigo, v_nome
    from core.usuario u
    join plataforma.tenant t on t.id = u.tenant_id
   where u.tenant_id = p_tenant and u.id = v_u and u.perfil = 'admin' and u.ativo and u.bloqueado_em is null
     and u.senha_hash is not null and u.deleted_at is null and t.status = 'ativo' and t.deleted_at is null;
  if not found then
    return;
  end if;
  update plataforma.portal_sessao x
     set tenant_atual_id = p_tenant, usuario_atual_id = v_u, ultimo_uso_em = now()
   where x.id = p_sid;
  perform plataforma.sa_registrar_auditoria('admin_cliente', null, v_u, p_sid, p_tenant, 'sa.empresa.escolher', '{}'::jsonb);
  tenant_id := p_tenant;
  usuario_id := v_u;
  codigo := v_codigo;
  nome := v_nome;
  return next;
end
$$;
revoke all on function plataforma.sa_escolher_empresa(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_escolher_empresa(uuid, uuid) to macuxi_portal;

drop function if exists plataforma.sa_sessao_valida(uuid);
create function plataforma.sa_sessao_valida(p_sid uuid)
  returns table (tipo text, super_admin_id uuid, tenant_id uuid, usuario_id uuid, expira_em timestamptz)
  language sql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    update plataforma.portal_sessao x
       set ultimo_uso_em = now()
     where x.id = p_sid and x.revogada_em is null and x.deleted_at is null and x.expira_em > now()
       and (
         (x.tipo = 'super_admin'
          and exists (select 1 from plataforma.super_admin s where s.id = x.super_admin_id and s.deleted_at is null and s.ativo))
         or (x.tipo = 'admin_cliente' and x.tenant_atual_id is null)
         or (x.tipo = 'admin_cliente'
             and exists (select 1 from core.usuario u join plataforma.tenant t on t.id = u.tenant_id
                          where u.tenant_id = x.tenant_atual_id and u.id = x.usuario_atual_id and u.perfil = 'admin' and u.ativo
                            and u.bloqueado_em is null and u.senha_hash is not null and u.deleted_at is null
                            and t.status = 'ativo' and t.deleted_at is null))
       )
    returning x.tipo, x.super_admin_id, x.tenant_atual_id, x.usuario_atual_id, x.expira_em
  $$;
revoke all on function plataforma.sa_sessao_valida(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_sessao_valida(uuid) to macuxi_portal;

-- 2. provisionar_tenant com o texto da 0035 -------------------------------------------------------------------------------
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
  v_sem_admin boolean;
  v_ator uuid;
  v_admin jsonb;
  v_email text;
  v_admin_nome text;
  v_hash text;
  v_m jsonb;
  v_modulo text;
  v_licencas integer;
  v_perfil text;
  v_vistos text[] := '{}';
  v_param jsonb;
  v_params_vistos text[] := '{}';
  v_params_gravados text[] := '{}';
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
  v_depois jsonb;
  v_n integer;
begin
  -- a entrada pode levar o hash da senha: nada de log de comando nesta transação (só superusuário muda esses parâmetros)
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
  if coalesce(jsonb_typeof(p -> 'sem_admin'), 'null') not in ('boolean', 'null') then
    raise exception 'provisionar_tenant: sem_admin deve ser booleano' using errcode = '22023';
  end if;
  v_sem_admin := coalesce((p ->> 'sem_admin')::boolean, false);
  if coalesce(jsonb_typeof(p -> 'ator_id'), 'null') <> 'null' then
    if jsonb_typeof(p -> 'ator_id') <> 'string'
       or (p ->> 'ator_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'provisionar_tenant: ator_id deve ser UUID' using errcode = '22023';
    end if;
    v_ator := (p ->> 'ator_id')::uuid;
  end if;

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

  -- parâmetros iniciais (0035): [{ modulo, chave, valor }], sem repetição de (modulo, chave)
  if coalesce(jsonb_typeof(p -> 'parametros'), 'null') not in ('array', 'null') then
    raise exception 'provisionar_tenant: parametros deve ser uma lista' using errcode = '22023';
  end if;
  for v_param in select x.value from jsonb_array_elements(coalesce(p -> 'parametros', '[]'::jsonb)) x loop
    if jsonb_typeof(v_param) <> 'object' then
      raise exception 'provisionar_tenant: cada parâmetro deve ser um objeto' using errcode = '22023';
    end if;
    if coalesce(v_param ->> 'modulo', '') !~ '^[a-z][a-z0-9-]*$' then
      raise exception 'provisionar_tenant: módulo do parâmetro inválido' using errcode = '22023';
    end if;
    if coalesce(v_param ->> 'chave', '') !~ '^[a-z][a-z0-9_.]{0,99}$' then
      raise exception 'provisionar_tenant: chave do parâmetro inválida' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_param -> 'valor'), 'null') = 'null' then
      raise exception 'provisionar_tenant: valor do parâmetro %.% obrigatório', v_param ->> 'modulo', v_param ->> 'chave' using errcode = '22023';
    end if;
    if not ((v_param ->> 'modulo') = any (v_vistos))
       and not exists (select 1 from plataforma.tenant t join plataforma.tenant_modulo tm on tm.tenant_id = t.id
                        where lower(t.codigo) = lower(v_codigo) and tm.modulo = v_param ->> 'modulo' and tm.deleted_at is null) then
      raise exception 'provisionar_tenant: parâmetro de módulo fora do tenant: %', v_param ->> 'modulo' using errcode = '22023';
    end if;
    if ((v_param ->> 'modulo') || ':' || (v_param ->> 'chave')) = any (v_params_vistos) then
      raise exception 'provisionar_tenant: parâmetro repetido: %.%', v_param ->> 'modulo', v_param ->> 'chave' using errcode = '22023';
    end if;
    v_params_vistos := v_params_vistos || ((v_param ->> 'modulo') || ':' || (v_param ->> 'chave'));
  end loop;

  v_admin := p -> 'admin';
  if v_sem_admin then
    if coalesce(jsonb_typeof(v_admin), 'null') <> 'null' or v_redefinir then
      raise exception 'provisionar_tenant: sem_admin não aceita admin nem redefinir_senha' using errcode = '22023';
    end if;
  else
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

  -- 3b. parâmetros iniciais (0035): parâmetro já gravado não muda ----------------------------------------------------
  for v_param in select x.value from jsonb_array_elements(coalesce(p -> 'parametros', '[]'::jsonb)) x
                  order by x.value ->> 'modulo', x.value ->> 'chave' loop
    insert into plataforma.parametro (tenant_id, modulo, chave, valor)
    values (v_tenant, v_param ->> 'modulo', v_param ->> 'chave', v_param -> 'valor')
    on conflict (tenant_id, modulo, chave) where deleted_at is null do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then
      v_params_gravados := v_params_gravados || (v_param ->> 'chave');
    end if;
  end loop;

  -- 4. admin inicial (pulado com sem_admin) --------------------------------------------------------------------------
  if v_sem_admin then
    v_admin_res := 'sem_admin';
  else
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
  end if;

  -- 5. resultado e auditoria (só quando algo mudou) ----------------------------------------------------------------
  v_resultado := case
    when v_criado then 'criado'
    when cardinality(v_adicionados) > 0 or cardinality(v_params_gravados) > 0 or v_admin_res in ('criado', 'senha_redefinida')
      then 'atualizado'
    else 'sem_mudanca'
  end;
  if v_resultado <> 'sem_mudanca' then
    v_depois := jsonb_build_object('resultado', v_resultado, 'modulos_adicionados', to_jsonb(v_adicionados), 'admin', v_admin_res);
    if cardinality(v_params_gravados) > 0 then
      v_depois := v_depois || jsonb_build_object('parametros_gravados', to_jsonb(v_params_gravados));
    end if;
    insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois)
    values (v_tenant, v_ator, 'core', 'tenant.provisionar', 'tenant', v_tenant,
            case when v_criado then null else jsonb_build_object('modulos', to_jsonb(v_modulos_antes)) end,
            v_depois);
  end if;

  perform set_config('app.tenant_id', coalesce(v_contexto, ''), true);
  return jsonb_build_object(
    'tenant_id', v_tenant,
    'resultado', v_resultado,
    'modulos_adicionados', to_jsonb(v_adicionados),
    'parametros_gravados', to_jsonb(v_params_gravados),
    'admin', v_admin_res,
    'avisos', to_jsonb(v_avisos)
  );
end
$$;
revoke all on function plataforma.provisionar_tenant(jsonb) from public;

-- 3. anonimizar_usuario com o texto da 0036 ---------------------------------------------------------------------------------
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

-- 4. Tabela e colunas ------------------------------------------------------------------------------------------------------
drop table if exists plataforma.email_saida;
alter table plataforma.portal_sessao_empresa drop constraint if exists portal_sessao_empresa_versao_faixa;
alter table plataforma.portal_sessao_empresa drop column if exists sessao_versao;
alter table core.usuario drop constraint if exists usuario_sessao_versao_faixa;
alter table core.usuario drop constraint if exists usuario_senha_temporaria_argon2id;
alter table core.usuario drop constraint if exists usuario_senha_temporaria_completa;
alter table core.usuario drop constraint if exists usuario_senha_expira_so_trocar;
alter table core.usuario drop column if exists sessao_versao;
alter table core.usuario drop column if exists senha_temporaria_criada_em;
alter table core.usuario drop column if exists senha_temporaria_expira_em;
alter table core.usuario drop column if exists senha_temporaria_hash;
alter table core.usuario drop column if exists senha_expira_em;
alter table core.usuario drop column if exists trocar_senha;

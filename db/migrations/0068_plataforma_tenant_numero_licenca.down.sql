-- 0068_plataforma_tenant_numero_licenca (down) — desfaz a 0068 e volta ao catálogo da 0067: provisionar_tenant com o texto da
-- 0040 (codigo obrigatório, idempotente pelo código, sem 'codigo' no retorno), sa_provisionar_tenant com o da 0039, o CHECK
-- tenant_codigo_formato da 0001 e sem uf_valida, sortear_codigo_licenca e atribuir_codigo_licenca. Volte antes a API/CLI que
-- provisiona sem codigo (senão 22023). Idempotente. Pré-condição: 0069+ desfeitas.
-- Tenant com código da licença (UF + 4 dígitos, maiúsculas) não passa no CHECK da 0001: o down FALHA (55000) antes de mudar
-- qualquer coisa e diz quantos são. Nada é trocado sozinho: devolva antes o código antigo de cada um (o 'antes' da auditoria
-- 'tenant.codigo_licenca'; tenant que nasceu com o código da licença precisa de um código no formato antigo) e rode de novo.

do $$
declare
  v_n integer;
begin
  select count(*) into v_n from plataforma.tenant t where t.codigo !~ '^[a-z0-9][a-z0-9-]{1,39}$';
  if v_n > 0 then
    raise exception '0068 down: % tenant(s) com código da licença (UF + 4 dígitos) não cabem no CHECK da 0001', v_n
      using errcode = '55000',
            hint = 'Devolva o código antigo de cada um (o antes da auditoria tenant.codigo_licenca) e rode o down de novo.';
  end if;
end
$$;

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
      -- 0040 (P5): o admin inicial troca a senha master no 1º uso (no BKO); a master não vence (senha_expira_em nula)
      insert into core.usuario (tenant_id, nome, email, perfil, ativo, senha_hash, trocar_senha)
      values (v_tenant, v_admin_nome, v_email, 'admin', true, v_hash, true);
      v_admin_res := 'criado';
    else
      if v_redefinir and v_usuario.senha_hash is distinct from v_hash then
        -- 0040: senha redefinida = senha master de novo (troca no 1º uso, sem validade); some a temporária paralela; a
        -- sessao_versao sobe (tokens e sessão do portal caem) e os refresh do usuário são revogados
        update core.usuario u
           set senha_hash = v_hash, trocar_senha = true, senha_expira_em = null, senha_temporaria_hash = null,
               senha_temporaria_expira_em = null, senha_temporaria_criada_em = null, sessao_versao = u.sessao_versao + 1
         where u.tenant_id = v_tenant and u.id = v_usuario.id;
        update core.sessao s set revogado_em = now()
         where s.tenant_id = v_tenant and s.usuario_id = v_usuario.id and s.revogado_em is null;
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

create or replace function plataforma.sa_provisionar_tenant(p_sid uuid, p jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_entrada jsonb;
  v_r jsonb;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_provisionar_tenant: só com sessão de super-admin' using errcode = '28000';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sa_provisionar_tenant: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  -- o portal nunca troca senha de usuário existente (RN-CORE-31) e não escolhe sem_admin: ele vem do admin informado
  if p ? 'redefinir_senha' or p ? 'sem_admin' then
    raise exception 'sa_provisionar_tenant: o portal não aceita redefinir_senha nem sem_admin' using errcode = '22023';
  end if;
  -- admin inicial (RN-CORE-34): { email, nome, senha_hash argon2id }, validado pela provisionar_tenant. Empresa NOVA sem admin
  -- = 22023 com hint RN-CORE-34 (a API traduz em 422); empresa existente sem admin = sem_admin (só módulos e parâmetros). Código
  -- fora do formato segue para a provisionar_tenant, que dá o 22023 dela.
  if coalesce(jsonb_typeof(p -> 'admin'), 'null') = 'null' then
    if jsonb_typeof(p -> 'codigo') = 'string' and (p ->> 'codigo') ~ '^[a-z0-9][a-z0-9-]{1,39}$'
       and not exists (select 1 from plataforma.tenant t where lower(t.codigo) = lower(p ->> 'codigo') and t.deleted_at is null) then
      raise exception 'sa_provisionar_tenant: empresa nova exige o admin inicial' using errcode = '22023', hint = 'RN-CORE-34';
    end if;
    v_entrada := (p - 'ator_id' - 'admin') || jsonb_build_object('sem_admin', true, 'ator_id', v_sa);
  else
    v_entrada := (p - 'ator_id') || jsonb_build_object('ator_id', v_sa);
  end if;
  v_r := plataforma.provisionar_tenant(v_entrada);
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, (v_r ->> 'tenant_id')::uuid, 'sa.tenant.provisionar',
    jsonb_build_object('resultado', v_r -> 'resultado', 'modulos_adicionados', v_r -> 'modulos_adicionados',
                       'parametros_gravados', v_r -> 'parametros_gravados', 'admin', v_r -> 'admin'));
  return v_r;
end
$$;

alter table plataforma.tenant drop constraint tenant_codigo_formato;
alter table plataforma.tenant add constraint tenant_codigo_formato check (codigo ~ '^[a-z0-9][a-z0-9-]{1,39}$');

drop function if exists plataforma.atribuir_codigo_licenca(uuid, text);
drop function if exists plataforma.sortear_codigo_licenca(text);
drop function if exists plataforma.uf_valida(text);

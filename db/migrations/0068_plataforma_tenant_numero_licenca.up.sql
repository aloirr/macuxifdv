-- 0068_plataforma_tenant_numero_licenca (up) — o código da empresa é o número da licença no formato UF + 4 dígitos
-- aleatórios (pedidos do dono do produto R-20261114-130500, R-20261114-131200 e R-20261114-131500: "o codigo da licenca e
-- assim: UF0001 ONDE UF É A UF DO CLIENTE. o numero é aleatorio. nao precisa seguir uma sequencia numerica."). Migração em
-- cima da 0067. Dicionário: docs/banco/plataforma.md ("0068 — código da licença"). Teste: db/testes/tenant-numero-licenca.db.test.ts
-- (estático na sessão; banco e up/down no CI).
--
-- 1. CHECK tenant_codigo_formato: aceita os códigos de antes ('^[a-z0-9][a-z0-9-]{1,39}$': thathyany, demo, teste-macuxi...)
--    OU o código da licença ('^(UF)[0-9]{4}$', só as 27 UFs, em MAIÚSCULAS, ex.: AM4821). Nenhum código existente muda.
--    O índice único tenant_codigo_uk (lower(codigo), 0001) segue: único na plataforma, sem diferenciar maiúsculas.
-- 2. plataforma.uf_valida(text): a sigla é de uma das 27 UFs (aceita minúscula e espaços nas pontas). Immutable.
-- 3. plataforma.sortear_codigo_licenca(p_uf text): UF em maiúsculas + 4 dígitos aleatórios (0000..9999) que nenhum tenant usa
--    (comparação por lower(codigo), o índice único). Trava consultiva por UF (pg_advisory_xact_lock): dois sorteios da mesma
--    UF em paralelo não tiram o mesmo número. Até 20 sorteios; sem sorte, sorteia entre os números livres da UF; UF esgotada
--    (os 10.000 em uso) = 54000 com mensagem em português. UF inválida = 22023.
-- 4. plataforma.provisionar_tenant(jsonb): mesma assinatura. Novidades na entrada e no retorno:
--    - id (opcional, UUID gerado pelo chamador, regra 4 do CLAUDE.md) = id do tenant e CHAVE DE IDEMPOTÊNCIA. Com id de um
--      tenant existente, a chamada é sobre ele (mesmo tenant, mesmo código, nenhum sorteio); com id novo, o tenant nasce com
--      esse id. Trava consultiva por id antes da busca: chamadas simultâneas com o mesmo id não sorteiam dois códigos.
--    - uf (texto, sigla de uma das 27 UFs; minúscula aceita): obrigatória sem codigo; inválida = 22023 sempre.
--    - codigo ausente, nulo ou "" = código da licença sorteado para a UF (tenant novo). Sem codigo, id e uf são obrigatórios
--      (22023). Tenant existente pelo id com código de outra forma (legado ou de outra UF): o código não muda (aviso).
--    - codigo informado: comportamento de antes (minúsculas, idempotente pelo código). Com id e codigo de tenants diferentes
--      = 23505.
--    - retorno ganha 'codigo' (text, o código do tenant: o sorteado, o informado ou o já existente).
-- 5. plataforma.sa_provisionar_tenant (portal): sem codigo e sem admin, é empresa nova (22023, hint RN-CORE-34) quando o id
--    não é de um tenant vivo — como já era com código novo. A uf segue na entrada para a provisionar_tenant. Resto igual à
--    0039 (create or replace: EXECUTE só ao macuxi_portal continua).
-- 6. plataforma.atribuir_codigo_licenca(p_tenant_id uuid, p_uf text) returns jsonb: dá o código da licença a um tenant que
--    já existe (ex.: thathyany, quando o dono do produto informar a UF). Já com código da mesma UF = devolve o mesmo
--    (idempotente). Retorno { tenant_id, codigo_anterior, codigo, resultado: 'atribuido' | 'sem_mudanca' }; auditoria
--    'tenant.codigo_licenca' com o antes e o depois. Tenant inexistente = P0002; encerrado ou excluído = 55000.
-- Funções 2, 3, 4 e 6: SECURITY INVOKER, sem EXECUTE para PUBLIC nem para os papéis da aplicação (rodam como o dono, no
-- deploy, como a provisionar_tenant; a 3 também dentro da sa_provisionar_tenant, SECURITY DEFINER do dono).
--
-- Caminho de volta: 0068_plataforma_tenant_numero_licenca.down.sql (provisionar_tenant com o texto da 0040,
-- sa_provisionar_tenant com o da 0039, CHECK da 0001 e apaga as funções 2, 3 e 6). O down FALHA (55000) se algum tenant já
-- tiver código da licença (o CHECK da 0001 não aceita maiúsculas): devolva antes o código antigo (o 'antes' da auditoria
-- 'tenant.codigo_licenca'). Volte antes a API/CLI que provisiona sem codigo (senão 22023).

-- 1. CHECK do código: os de antes ou o código da licença ----------------------------------------------------------------------
alter table plataforma.tenant drop constraint tenant_codigo_formato;
alter table plataforma.tenant add constraint tenant_codigo_formato
  check (codigo ~ '^[a-z0-9][a-z0-9-]{1,39}$'
         or codigo ~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)[0-9]{4}$') not valid;
alter table plataforma.tenant validate constraint tenant_codigo_formato;

-- 2. UF válida ------------------------------------------------------------------------------------------------------------------
create function plataforma.uf_valida(p_uf text)
  returns boolean
  language sql immutable security invoker
  set search_path = pg_catalog, pg_temp
  as $$
    select coalesce(upper(btrim(p_uf)) = any (array['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
      'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']), false)
  $$;
revoke all on function plataforma.uf_valida(text) from public;

-- 3. sorteio do código da licença -------------------------------------------------------------------------------------------
create function plataforma.sortear_codigo_licenca(p_uf text)
  returns text
  language plpgsql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  c_tentativas constant integer := 20;
  v_uf text;
  v_codigo text;
begin
  if not plataforma.uf_valida(p_uf) then
    raise exception 'sortear_codigo_licenca: uf inválida (sigla de uma das 27 UFs, ex.: AM)' using errcode = '22023';
  end if;
  v_uf := upper(btrim(p_uf));
  -- sorteios da mesma UF em fila: o 2º vê o código do 1º (até o fim da transação)
  perform pg_advisory_xact_lock(hashtextextended('plataforma.codigo_licenca:' || v_uf, 0));
  for i in 1 .. c_tentativas loop
    v_codigo := v_uf || lpad(floor(random() * 10000)::integer::text, 4, '0');
    if not exists (select 1 from plataforma.tenant t where lower(t.codigo) = lower(v_codigo)) then
      return v_codigo;
    end if;
  end loop;
  -- sem sorte nos sorteios (UF quase cheia): um dos números livres, sorteado
  select v_uf || lpad(n::text, 4, '0') into v_codigo
    from generate_series(0, 9999) n
   where not exists (select 1 from plataforma.tenant t where lower(t.codigo) = lower(v_uf || lpad(n::text, 4, '0')))
   order by random()
   limit 1;
  if v_codigo is null then
    raise exception 'sortear_codigo_licenca: não há código livre para a UF % (os 10.000 números, de %0000 a %9999, estão em uso)',
      v_uf, v_uf, v_uf using errcode = '54000';
  end if;
  return v_codigo;
end
$$;
revoke all on function plataforma.sortear_codigo_licenca(text) from public;

-- 4. provisionar_tenant: codigo opcional (código da licença sorteado pela uf) e id do chamador como chave de idempotência ------
drop function if exists plataforma.provisionar_tenant(jsonb);
create function plataforma.provisionar_tenant(p jsonb)
  returns jsonb
  language plpgsql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  c_perfis constant text[] := array['admin', 'analista', 'assistente', 'supervisor', 'gerente', 'vendedor', 'promotor'];
  v_contexto text := current_setting('app.tenant_id', true);
  v_id uuid;
  v_codigo text;
  v_codigo_do_id text;
  v_uf text;
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
  -- 0068: id = UUID do tenant gerado pelo chamador (chave de idempotência); codigo ausente, nulo ou vazio = código da licença
  -- sorteado para a uf do cliente
  if coalesce(jsonb_typeof(p -> 'id'), 'null') <> 'null' then
    if jsonb_typeof(p -> 'id') <> 'string'
       or (p ->> 'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'provisionar_tenant: id deve ser UUID' using errcode = '22023';
    end if;
    v_id := (p ->> 'id')::uuid;
  end if;
  if coalesce(jsonb_typeof(p -> 'codigo'), 'null') not in ('string', 'null') then
    raise exception 'provisionar_tenant: codigo inválido (minúsculas, dígitos e hífen, 2 a 40)' using errcode = '22023';
  end if;
  v_codigo := nullif(p ->> 'codigo', '');
  if v_codigo is not null and v_codigo !~ '^[a-z0-9][a-z0-9-]{1,39}$' then
    raise exception 'provisionar_tenant: codigo inválido (minúsculas, dígitos e hífen, 2 a 40)' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p -> 'uf'), 'null') not in ('string', 'null') then
    raise exception 'provisionar_tenant: uf inválida (sigla de uma das 27 UFs, ex.: AM)' using errcode = '22023';
  end if;
  v_uf := upper(nullif(btrim(p ->> 'uf'), ''));
  if v_uf is not null and not plataforma.uf_valida(v_uf) then
    raise exception 'provisionar_tenant: uf inválida (sigla de uma das 27 UFs, ex.: AM)' using errcode = '22023';
  end if;
  if v_codigo is null and (v_id is null or v_uf is null) then
    raise exception 'provisionar_tenant: sem codigo, o id do tenant (UUID do chamador) e a uf do cliente são obrigatórios'
      using errcode = '22023';
  end if;
  if v_id is not null then
    -- chamadas com o mesmo id em fila: a 2ª vê o tenant da 1ª e não sorteia outro código
    perform pg_advisory_xact_lock(hashtextextended('plataforma.provisionar_tenant:' || v_id::text, 0));
    select t.codigo into v_codigo_do_id from plataforma.tenant t where t.id = v_id;
    if found then
      if v_codigo is not null and lower(v_codigo) <> lower(v_codigo_do_id) then
        raise exception 'provisionar_tenant: o id informado é de um tenant com outro codigo' using errcode = '23505';
      end if;
      if v_codigo is null and v_codigo_do_id !~ ('^' || v_uf || '[0-9]{4}$') then
        v_avisos := v_avisos || format('tenant existente: o código %s não muda (troca: atribuir_codigo_licenca)', v_codigo_do_id);
      end if;
      v_codigo := v_codigo_do_id;
    elsif v_codigo is not null and exists (select 1 from plataforma.tenant t where lower(t.codigo) = lower(v_codigo)) then
      raise exception 'provisionar_tenant: o codigo informado é de um tenant com outro id' using errcode = '23505';
    end if;
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
  -- 0068: tenant novo sem codigo = código da licença sorteado para a uf (UF + 4 dígitos, livre na plataforma)
  if v_codigo is null then
    v_codigo := plataforma.sortear_codigo_licenca(v_uf);
  end if;
  insert into plataforma.tenant (id, codigo, nome, documento, fuso, plano)
  values (coalesce(v_id, gen_random_uuid()), v_codigo, v_nome, v_documento, v_fuso, v_plano)
  on conflict do nothing
  returning id into v_tenant;
  if v_tenant is not null then
    v_criado := true;
  else
    select t.id, t.codigo, t.nome, t.documento, t.fuso, t.plano, t.status, t.deleted_at into v_existente
      from plataforma.tenant t
     where (v_id is not null and t.id = v_id) or (v_id is null and lower(t.codigo) = lower(v_codigo))
       for update;
    if not found or lower(v_existente.codigo) <> lower(v_codigo) then
      raise exception 'provisionar_tenant: id e codigo apontam para tenants diferentes' using errcode = '23505';
    end if;
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
    'codigo', v_codigo,
    'resultado', v_resultado,
    'modulos_adicionados', to_jsonb(v_adicionados),
    'parametros_gravados', to_jsonb(v_params_gravados),
    'admin', v_admin_res,
    'avisos', to_jsonb(v_avisos)
  );
end
$$;
revoke all on function plataforma.provisionar_tenant(jsonb) from public;

-- 5. sa_provisionar_tenant: empresa nova sem codigo também exige o admin inicial (RN-CORE-34) ---------------------------------
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
    -- 0068: sem codigo (ausente, nulo ou vazio) = código da licença; é empresa nova se o id não é de um tenant vivo
    if (jsonb_typeof(p -> 'codigo') = 'string' and (p ->> 'codigo') ~ '^[a-z0-9][a-z0-9-]{1,39}$'
        and not exists (select 1 from plataforma.tenant t where lower(t.codigo) = lower(p ->> 'codigo') and t.deleted_at is null))
       or (coalesce(p ->> 'codigo', '') = ''
           and not exists (select 1 from plataforma.tenant t where t.id::text = lower(p ->> 'id') and t.deleted_at is null)) then
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

-- 6. atribuir_codigo_licenca: código da licença para um tenant que já existe (ex.: thathyany, com a UF do cliente) ------------
create function plataforma.atribuir_codigo_licenca(p_tenant_id uuid, p_uf text)
  returns jsonb
  language plpgsql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_contexto text := current_setting('app.tenant_id', true);
  v_uf text;
  v_tenant record;
  v_anterior text;
  v_codigo text;
begin
  if p_tenant_id is null then
    raise exception 'atribuir_codigo_licenca: o tenant é obrigatório' using errcode = '22023';
  end if;
  if not plataforma.uf_valida(p_uf) then
    raise exception 'atribuir_codigo_licenca: uf inválida (sigla de uma das 27 UFs, ex.: AM)' using errcode = '22023';
  end if;
  v_uf := upper(btrim(p_uf));
  select t.codigo, t.status, t.deleted_at into v_tenant from plataforma.tenant t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'atribuir_codigo_licenca: tenant não encontrado' using errcode = 'P0002';
  end if;
  if v_tenant.deleted_at is not null or v_tenant.status = 'encerrado' then
    raise exception 'atribuir_codigo_licenca: o tenant está encerrado ou excluído: nada muda' using errcode = '55000';
  end if;
  perform set_config('app.tenant_id', p_tenant_id::text, true);

  if v_tenant.codigo ~ ('^' || v_uf || '[0-9]{4}$') then
    -- já tem o código da licença desta UF: o mesmo, e o anterior é o da última atribuição (se houve)
    select a.antes ->> 'codigo' into v_anterior
      from plataforma.auditoria a
     where a.tenant_id = p_tenant_id and a.acao = 'tenant.codigo_licenca' and a.depois ->> 'codigo' = v_tenant.codigo
     order by a.ocorrido_em desc, a.id desc
     limit 1;
    perform set_config('app.tenant_id', coalesce(v_contexto, ''), true);
    return jsonb_build_object('tenant_id', p_tenant_id, 'codigo_anterior', coalesce(v_anterior, v_tenant.codigo),
                              'codigo', v_tenant.codigo, 'resultado', 'sem_mudanca');
  end if;

  v_codigo := plataforma.sortear_codigo_licenca(v_uf);
  update plataforma.tenant t set codigo = v_codigo where t.id = p_tenant_id;
  insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois)
  values (p_tenant_id, null, 'core', 'tenant.codigo_licenca', 'tenant', p_tenant_id,
          jsonb_build_object('codigo', v_tenant.codigo), jsonb_build_object('codigo', v_codigo));
  perform set_config('app.tenant_id', coalesce(v_contexto, ''), true);
  return jsonb_build_object('tenant_id', p_tenant_id, 'codigo_anterior', v_tenant.codigo, 'codigo', v_codigo,
                            'resultado', 'atribuido');
end
$$;
revoke all on function plataforma.atribuir_codigo_licenca(uuid, text) from public;

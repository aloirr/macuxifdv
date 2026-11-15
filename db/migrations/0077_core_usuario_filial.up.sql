-- 0077_core_usuario_filial (up) — T-0176 (RN-CORE-39): filial de CADASTRO e filiais de VENDA do usuário. Decisões do dono do
-- produto R-20261115-093000 (substitui "vendedor = 1 filial") e R-20261115-094500 (todo usuário tem filial de cadastro,
-- inclusive admin e analista; sem ela fica bloqueado; a de cadastro faz parte das de venda; backfill abaixo). Proposta do
-- modulo-core: docs/modulos/core/filial-cadastro-venda.md. Depende da 0056 (core.filial); número 0077 porque a 0070–0076 são
-- de outros lotes. Dicionário: docs/banco/core.md ("0077"). Teste: db/testes/usuario-filial.db.test.ts (estático sempre;
-- banco e up/down no CI).
--
-- core.usuario.filial_cadastro_id uuid NULO (nulo = usuário bloqueado; o bloqueio é do domain/API do Core, não do banco):
--   FK composta usuario_filial_cadastro_fk (tenant_id, filial_cadastro_id) -> core.filial (filial de outro tenant = 23503).
--   Índice usuario_filial_cadastro_ix (tenant_id, filial_cadastro_id) vivo: "usuários da filial" e a trava de inativar filial.
--   RLS e grants de core.usuario não mudam (a coluna herda os da tabela).
-- core.usuario_filial (dono: Core): FILIAIS DE VENDA do usuário, uma linha viva por (usuário, filial) — único parcial
--   usuario_filial_uk (tenant_id, usuario_id, filial_id) vivo, que também atende "filiais de venda do usuário". FKs compostas
--   para core.usuario e core.filial. Índice usuario_filial_filial_ix (tenant_id, filial_id) vivo: "usuários que vendem pela
--   filial". Índice de sync (tenant_id, updated_at, id). Remover = soft delete (deleted_at); o macuxi_app não tem DELETE.
--   Quantas filiais de venda cada usuário tem (mínimo 1) é do domain/API do Core (422), não do banco.
--   Volume: 1 a poucas linhas por usuário; centenas por tenant.
-- INVARIANTE "a filial de cadastro está entre as de venda" (R-20261115-094500, item 2): filial_cadastro_id preenchida num
--   usuário vivo exige linha viva em core.usuario_filial com essa filial. Gatilhos de restrição ADIADOS usuario_filial_inclui_cadastro
--   (no COMMIT; a ordem das gravações na transação não importa), um em cada tabela:
--     core.usuario         insert ou update de filial_cadastro_id, deleted_at (trocar o cadastro; restaurar o usuário);
--     core.usuario_filial  update de usuario_id, filial_id, deleted_at ou delete de linha viva (tirar a venda do cadastro).
--   Erro: 23514, constraint usuario_filial_inclui_cadastro, detail 'usuario_id=<uuid>', hint 'RN-CORE-39' (a API mapeia
--   para 422). Para o erro sair no comando e não no COMMIT: `set constraints core.usuario_filial_inclui_cadastro immediate`.
--   Concorrência: a conferência trava a linha do usuário (for no key update); quem troca o cadastro e quem apaga a venda do
--   mesmo usuário ficam em fila, e o segundo confere vendo o primeiro.
--   core.filial_cadastro_conferir() é SECURITY DEFINER (como a core.promotor_conferir da 0069): gatilho adiado dispara no
--   COMMIT com o papel da sessão, e o COMMIT de uma sa_* do macuxi_portal não tem acesso a core. Roda como o dono, só o
--   tenant e o usuário da linha; nenhum EXECUTE a ninguém.
-- BACKFILL (R-20261115-094500, item 5), nesta ordem:
--   1. "quem já tem filial vinculada": NÃO SE APLICA — antes da 0077 não há vínculo usuário–filial em tabela nenhuma
--      (core.usuario, core.equipe e plataforma.* não têm filial; core.usuario_filial nasce aqui, vazia).
--   2. empresa com UMA filial viva: todo usuário vivo (ativo ou não) recebe essa filial como cadastro e como venda.
--   3. quem sobra (empresa com 2+ filiais vivas) fica com filial_cadastro_id nulo, sem venda: bloqueado até o BKO ou a carga.
--   O updated_at dos usuários do passo 2 sobe (gatilho usuario_updated_at): o sync puxa a filial nova.
--
-- ADMIN INICIAL (R-20261115-094500): plataforma.provisionar_tenant (create or replace, a partir do texto da 0068) dá ao admin
--   que ela CRIA a filial padrão do tenant como cadastro e como venda; sem isso ele nasceria bloqueado. Admin existente não muda.
--   Vale para o CLI (tenant:criar), as seeds e o portal (a sa_provisionar_tenant chama a provisionar_tenant e fica como na 0068).
-- PORTAL (RN-CORE-39): plataforma.sa_sessao_valida devolve também sem_filial (admin do cliente sem filial de cadastro; false
--   para o super-admin). Retorno novo = drop + create, com os grants da 0046 (só o macuxi_portal executa).
-- RLS: core.usuario_filial com enable + force + isolamento_tenant (macuxi_app) + manutencao (0031). macuxi_app: select, insert,
-- update. macuxi_worker e macuxi_portal: nada.
-- Caminho de volta: 0077_core_usuario_filial.down.sql — volta a sa_sessao_valida ao texto da 0046 e a provisionar_tenant ao
-- texto da 0068, apaga os 2 gatilhos,
-- a função, a tabela, o índice, a FK e a coluna (as filiais de cadastro e de venda se perdem; reaplicar a 0077 refaz o
-- backfill). Volte antes o código do Core que lê/grava.

-- =============================================================================================
-- core.usuario.filial_cadastro_id — filial de cadastro (RN-CORE-39)
-- =============================================================================================
alter table core.usuario add column filial_cadastro_id uuid;
alter table core.usuario add constraint usuario_filial_cadastro_fk
  foreign key (tenant_id, filial_cadastro_id) references core.filial (tenant_id, id);
create index usuario_filial_cadastro_ix on core.usuario (tenant_id, filial_cadastro_id) where deleted_at is null;

-- =============================================================================================
-- core.usuario_filial — filiais de venda do usuário (RN-CORE-39)
-- =============================================================================================
create table core.usuario_filial (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  usuario_id   uuid not null,
  filial_id    uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint usuario_filial_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint usuario_filial_filial_fk foreign key (tenant_id, filial_id) references core.filial (tenant_id, id)
);
create unique index usuario_filial_uk on core.usuario_filial (tenant_id, usuario_id, filial_id) where deleted_at is null;
create index usuario_filial_filial_ix on core.usuario_filial (tenant_id, filial_id) where deleted_at is null;
create index usuario_filial_sync_ix on core.usuario_filial (tenant_id, updated_at, id);
create unique index usuario_filial_external_uk on core.usuario_filial (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger usuario_filial_updated_at before update on core.usuario_filial
  for each row execute function plataforma.definir_updated_at();
alter table core.usuario_filial enable row level security;
alter table core.usuario_filial force row level security;
create policy isolamento_tenant on core.usuario_filial for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.usuario_filial for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.usuario_filial to macuxi_app;

-- =============================================================================================
-- Invariante: a filial de cadastro está entre as de venda (R-20261115-094500 item 2, RN-CORE-39)
-- =============================================================================================
-- Uma função de gatilho para as 2 tabelas, conferida no COMMIT. SECURITY DEFINER (ver o cabeçalho). Usuário apagado, sem
-- cadastro ou inexistente (exclusão do tenant em curso) = nada a conferir.
create function core.filial_cadastro_conferir() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, core, pg_temp
  as $$
declare
  v_tenant uuid;
  v_usuario uuid;
  v_cadastro uuid;
begin
  if tg_table_name = 'usuario' then
    v_tenant := new.tenant_id;
    v_usuario := new.id;
  else
    v_tenant := old.tenant_id;
    v_usuario := old.usuario_id;
  end if;
  select u.filial_cadastro_id into v_cadastro
    from core.usuario u
   where u.tenant_id = v_tenant and u.id = v_usuario and u.deleted_at is null
     for no key update;
  if v_cadastro is null then
    return null;
  end if;
  if not exists (select 1 from core.usuario_filial uf
                  where uf.tenant_id = v_tenant and uf.usuario_id = v_usuario and uf.filial_id = v_cadastro
                    and uf.deleted_at is null) then
    raise exception 'filial de cadastro fora das filiais de venda: a filial de cadastro também é de venda'
      using errcode = '23514', constraint = 'usuario_filial_inclui_cadastro', detail = 'usuario_id=' || v_usuario::text,
            hint = 'RN-CORE-39';
  end if;
  return null;
end
$$;
revoke all on function core.filial_cadastro_conferir() from public;

create constraint trigger usuario_filial_inclui_cadastro after insert or update of filial_cadastro_id, deleted_at on core.usuario
  deferrable initially deferred
  for each row when (new.filial_cadastro_id is not null and new.deleted_at is null)
  execute function core.filial_cadastro_conferir();
create constraint trigger usuario_filial_inclui_cadastro after update of usuario_id, filial_id, deleted_at or delete on core.usuario_filial
  deferrable initially deferred
  for each row when (old.deleted_at is null)
  execute function core.filial_cadastro_conferir();

-- =============================================================================================
-- Backfill (R-20261115-094500, item 5; passo 1 não se aplica, ver o cabeçalho)
-- =============================================================================================
-- Passo 2: empresa com UMA filial viva — todo usuário vivo recebe a filial como venda e como cadastro.
with filial_unica as (
  select f.tenant_id, min(f.id::text)::uuid as filial_id
    from core.filial f
   where f.deleted_at is null
   group by f.tenant_id
  having count(*) = 1
)
insert into core.usuario_filial (tenant_id, usuario_id, filial_id)
select u.tenant_id, u.id, fu.filial_id
  from core.usuario u
  join filial_unica fu on fu.tenant_id = u.tenant_id
 where u.deleted_at is null;

update core.usuario u
   set filial_cadastro_id = uf.filial_id
  from core.usuario_filial uf
 where uf.tenant_id = u.tenant_id and uf.usuario_id = u.id and uf.deleted_at is null and u.deleted_at is null;

-- =============================================================================================
-- provisionar_tenant: admin inicial com a filial padrão como cadastro e venda (RN-CORE-39, R-20261115-094500)
-- =============================================================================================
-- Texto da 0068 (a versão mais recente) com o bloco 0077 no "admin criado". É o lugar ÚNICO da regra: o CLI e as seeds chamam
-- a provisionar_tenant direto, e a sa_provisionar_tenant (portal, SECURITY DEFINER) chama esta, por isso não muda. A filial de
-- cadastro vai no insert do usuário e a de venda logo depois: usuario_filial_inclui_cadastro (adiado) confere no COMMIT, como
-- o dono (core.filial_cadastro_conferir é DEFINER), também no COMMIT do macuxi_portal. Assinatura, SECURITY INVOKER,
-- search_path e ACL (revoke all from public) não mudam (create or replace).
create or replace function plataforma.provisionar_tenant(p jsonb)
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
  v_filial uuid;
  v_admin_id uuid;
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
      -- 0077 (RN-CORE-39, R-20261115-094500): o admin criado aqui recebe a filial padrão do tenant (semeada pelo gatilho da
      -- 0056 ao inserir o tenant) como cadastro e como venda; sem ela nasceria bloqueado. Admin existente não muda.
      v_filial := core.filial_padrao_id(v_tenant);
      if v_filial is null then
        raise exception 'provisionar_tenant: o tenant não tem filial padrão viva para o admin inicial' using errcode = '55000',
          hint = 'RN-CORE-39';
      end if;
      insert into core.usuario (tenant_id, nome, email, perfil, ativo, senha_hash, trocar_senha, filial_cadastro_id)
      values (v_tenant, v_admin_nome, v_email, 'admin', true, v_hash, true, v_filial)
      returning id into v_admin_id;
      insert into core.usuario_filial (tenant_id, usuario_id, filial_id) values (v_tenant, v_admin_id, v_filial);
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

-- =============================================================================================
-- plataforma.sa_sessao_valida — sem_filial (RN-CORE-39 no portal)
-- =============================================================================================
-- O retorno ganha sem_filial = (core.usuario.filial_cadastro_id is null) do usuário da sessão do admin do cliente; false para o
-- super-admin e para a sessão que ainda não escolheu empresa. O macuxi_portal não lê core.usuario: vem da SECURITY DEFINER.
-- Retorno novo = drop + create (texto da 0046 + a coluna); grants iguais aos da 0046. As sa_* que chamam esta leem colunas
-- pelo nome (select v.tipo ...), nada muda nelas.
drop function if exists plataforma.sa_sessao_valida(uuid);
create function plataforma.sa_sessao_valida(p_sid uuid)
  returns table (tipo text, super_admin_id uuid, tenant_id uuid, usuario_id uuid, expira_em timestamptz, sem_filial boolean)
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
                            and t.status = 'ativo' and t.deleted_at is null
                            -- 0046: cai na hora se a conta da empresa atual deixou de ser só admin com acesso.portal
                            and plataforma.usuario_entra_no_portal(u.tenant_id, u.id)))
       )
       -- 0040: admin do cliente cai na hora se a senha de QUALQUER conta conferida no login mudou (sessao_versao) ou ficou
       -- a trocar (RN-CORE-34): a sessão inteira nasceu do conhecimento daquela senha
       and (x.tipo <> 'admin_cliente'
            or not exists (select 1 from plataforma.portal_sessao_empresa e
                             join core.usuario u on u.tenant_id = e.tenant_alvo_id and u.id = e.usuario_id
                            where e.sessao_id = x.id and e.deleted_at is null
                              and (u.sessao_versao <> e.sessao_versao or u.trocar_senha)))
    returning x.tipo, x.super_admin_id, x.tenant_atual_id, x.usuario_atual_id, x.expira_em,
      -- 0077 (RN-CORE-39): admin do cliente sem filial de cadastro; super-admin e sessão sem empresa escolhida = false
      case when x.tipo = 'admin_cliente' and x.usuario_atual_id is not null
           then coalesce((select u.filial_cadastro_id is null from core.usuario u
                           where u.tenant_id = x.tenant_atual_id and u.id = x.usuario_atual_id), false)
           else false end
  $$;
revoke all on function plataforma.sa_sessao_valida(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_sessao_valida(uuid) to macuxi_portal;

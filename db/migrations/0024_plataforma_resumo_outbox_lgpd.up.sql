-- 0024_plataforma_resumo_outbox_lgpd (up) — T-0078 (robustez essencial; pedido R-20261104-232912-engenheiro-software;
-- checklist docs/seguranca/checklist.md itens O2, G2). Dicionário: docs/banco/plataforma.md; roteiro: docs/banco/lgpd.md.
-- Migração ADITIVA: só funções novas; nenhuma tabela, coluna, política ou grant de tabela muda.
--
-- 1. plataforma.resumo_outbox(p_nomes text[], p_max_tentativas integer)
--      returns table (pendentes integer, parados integer, mais_antigo_s double precision)
--    Só AGREGADOS da outbox de TODOS os tenants, para o /v1/saude (rota pública da API): eventos não publicados com nome em
--    p_nomes; pendentes = tentativas < p_max_tentativas; parados = tentativas >= p_max_tentativas; mais_antigo_s = segundos
--    desde o ocorrido_em mais antigo entre os PENDENTES (null quando não há). Nenhum id, tenant, payload ou erro sai.
--    p_nomes nulo ou vazio = 0, 0, null. SECURITY DEFINER (o macuxi_app não vê a outbox dos outros tenants pela RLS),
--    search_path fixo com pg_temp por último (regra da 0012), EXECUTE só ao macuxi_app (o worker já conta direto, com a
--    política despacho_outbox da 0003). Índice usado: evento_pendente_ix (ocorrido_em) where publicado_em is null (0001).
--
-- 2. LGPD, exclusão sob pedido (roteiro docs/banco/lgpd.md). Três funções de ADMINISTRAÇÃO, SECURITY INVOKER, sem EXECUTE
--    para public, macuxi_app ou macuxi_worker: só o dono do banco (migrador/superusuário) roda, à mão, com o pedido do
--    titular registrado. Todas filtram o tenant explicitamente (o dono ignora RLS) e gravam uma linha em plataforma.auditoria
--    (acao 'lgpd.anonimizar', sem dado pessoal). Os ids ficam: pedidos, títulos, notas e históricos continuam ligados
--    ao registro anonimizado (obrigação legal/fiscal, LGPD art. 16, I); o updated_at anda e o deleted_at é preenchido, então
--    o pull leva a remoção ao aparelho.
--    plataforma.anonimizar_usuario(p_tenant, p_usuario): core.usuario (nome, nome_curto, e-mail único fictício
--      anonimizado-<id>@anonimizado.invalid, senha_hash, external_id; inativo, bloqueado e excluído), core.sessao (revoga
--      todas), core.dispositivo (sem nome; bloqueado: RN-CORE-15 apaga os dados locais), core.visita (coordenadas de
--      check-in/checkout do usuário), plataforma.auditoria (antes/depois da entidade), plataforma.evento (payload dos
--      eventos JÁ PUBLICADOS do agregado) e integracao.registro_atual (payload da entidade 'vendedor' do ERP).
--    plataforma.anonimizar_cliente(p_tenant, p_cliente): core.cliente (razão social, fantasia, documento, IE, telefone,
--      e-mail, endereço, coordenadas, observação, external_id; cidade, UF e segmento ficam para os números), todos os
--      core.cliente_contato e core.cliente_endereco dele, core.visita (coordenadas no cliente), auditoria e evento dos três,
--      integracao.registro_atual (entidade 'cliente').
--    plataforma.anonimizar_contato(p_tenant, p_contato): só um contato (pessoa) de um cliente pessoa jurídica.
--    Cada uma devolve (item, quantidade) do que mudou. Titular inexistente no tenant = erro P0002 (nada muda).
--
-- 3. plataforma.excluir_tenant(p_tenant uuid, p_codigo text) returns table (tabela text, quantidade bigint): APAGA todas as
--    linhas do tenant em TODA tabela com tenant_id (descoberta pelo catálogo: tabela nova fica coberta) e por fim a linha de
--    plataforma.tenant. Travas: p_codigo tem de ser o código do tenant (confirmação) e o tenant tem de estar com status
--    'encerrado' (passo anterior do roteiro). Usa session_replication_role = replica SÓ na transação (as FKs e gatilhos
--    não disparam; por isso apaga tudo do tenant de uma vez): exige superusuário. SECURITY INVOKER, sem EXECUTE para os
--    papéis da aplicação. Os objetos do bucket (fotos, plataforma.arquivo.chave) e os backups ficam fora: roteiro.
--
-- Caminho de volta: 0024_plataforma_resumo_outbox_lgpd.down.sql (APAGA as cinco funções; o /v1/saude volta a responder
-- outbox nula, a API já tolera 42883; o que já foi anonimizado ou excluído NÃO volta, só pelo backup).

create function plataforma.resumo_outbox(p_nomes text[], p_max_tentativas integer)
  returns table (pendentes integer, parados integer, mais_antigo_s double precision)
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select (count(*) filter (where e.tentativas < p_max_tentativas))::integer,
           (count(*) filter (where e.tentativas >= p_max_tentativas))::integer,
           extract(epoch from now() - min(e.ocorrido_em) filter (where e.tentativas < p_max_tentativas))::double precision
      from plataforma.evento e
     where e.publicado_em is null
       and e.nome = any (coalesce(p_nomes, '{}'::text[]))
  $$;
revoke all on function plataforma.resumo_outbox(text[], integer) from public;
grant execute on function plataforma.resumo_outbox(text[], integer) to macuxi_app;

-- ---------------------------------------------------------------------------------------------
create function plataforma.anonimizar_usuario(p_tenant uuid, p_usuario uuid)
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
revoke all on function plataforma.anonimizar_usuario(uuid, uuid) from public;

-- ---------------------------------------------------------------------------------------------
create function plataforma.anonimizar_cliente(p_tenant uuid, p_cliente uuid)
  returns table (item text, quantidade bigint)
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_ext text;
  v_ids uuid[];
  v_n bigint;
begin
  if p_tenant is null or p_cliente is null then
    raise exception 'anonimizar_cliente: p_tenant e p_cliente obrigatórios' using errcode = '22004';
  end if;
  select c.external_id into v_ext from core.cliente c where c.tenant_id = p_tenant and c.id = p_cliente for update;
  if not found then
    raise exception 'anonimizar_cliente: cliente não encontrado no tenant' using errcode = 'P0002';
  end if;
  select array[p_cliente]
         || coalesce((select array_agg(k.id) from core.cliente_contato k where k.tenant_id = p_tenant and k.cliente_id = p_cliente), '{}')
         || coalesce((select array_agg(x.id) from core.cliente_endereco x where x.tenant_id = p_tenant and x.cliente_id = p_cliente), '{}')
    into v_ids;

  update core.cliente c
     set razao_social = 'Cliente anonimizado', nome_fantasia = null, documento = null, inscricao_estadual = null,
         telefone = null, email = null, logradouro = null, numero = null, bairro = null, cep = null,
         latitude = null, longitude = null, observacao = null, external_id = null, ativo = false,
         deleted_at = coalesce(c.deleted_at, now())
   where c.tenant_id = p_tenant and c.id = p_cliente;
  item := 'core.cliente'; quantidade := 1; return next;

  update core.cliente_contato k
     set nome = 'Contato anonimizado', cargo = null, telefone = null, whatsapp = null, email = null, external_id = null,
         deleted_at = coalesce(k.deleted_at, now())
   where k.tenant_id = p_tenant and k.cliente_id = p_cliente;
  get diagnostics v_n = row_count;
  item := 'core.cliente_contato'; quantidade := v_n; return next;

  update core.cliente_endereco x
     set descricao = null, logradouro = 'Anonimizado', numero = null, complemento = null, bairro = null, cep = null,
         latitude = null, longitude = null, external_id = null, ativo = false, deleted_at = coalesce(x.deleted_at, now())
   where x.tenant_id = p_tenant and x.cliente_id = p_cliente;
  get diagnostics v_n = row_count;
  item := 'core.cliente_endereco'; quantidade := v_n; return next;

  update core.visita v set checkin_lat = null, checkin_lng = null, checkout_lat = null, checkout_lng = null
   where v.tenant_id = p_tenant and v.cliente_id = p_cliente
     and (v.checkin_lat is not null or v.checkout_lat is not null);
  get diagnostics v_n = row_count;
  item := 'core.visita'; quantidade := v_n; return next;

  update plataforma.auditoria a set antes = null, depois = null
   where a.tenant_id = p_tenant and a.entidade_id = any (v_ids) and (a.antes is not null or a.depois is not null);
  get diagnostics v_n = row_count;
  item := 'plataforma.auditoria'; quantidade := v_n; return next;

  update plataforma.evento e set payload = '{}'::jsonb
   where e.tenant_id = p_tenant and e.agregado_id = any (v_ids) and e.publicado_em is not null and e.payload <> '{}'::jsonb;
  get diagnostics v_n = row_count;
  item := 'plataforma.evento'; quantidade := v_n; return next;

  v_n := 0;
  if v_ext is not null then
    update integracao.registro_atual r set payload = null
     where r.tenant_id = p_tenant and r.entidade = 'cliente' and r.external_id = v_ext and r.payload is not null;
    get diagnostics v_n = row_count;
  end if;
  item := 'integracao.registro_atual'; quantidade := v_n; return next;

  insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id)
  values (p_tenant, null, 'core', 'lgpd.anonimizar', 'cliente', p_cliente);
end
$$;
revoke all on function plataforma.anonimizar_cliente(uuid, uuid) from public;

-- ---------------------------------------------------------------------------------------------
create function plataforma.anonimizar_contato(p_tenant uuid, p_contato uuid)
  returns table (item text, quantidade bigint)
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_n bigint;
begin
  if p_tenant is null or p_contato is null then
    raise exception 'anonimizar_contato: p_tenant e p_contato obrigatórios' using errcode = '22004';
  end if;
  update core.cliente_contato k
     set nome = 'Contato anonimizado', cargo = null, telefone = null, whatsapp = null, email = null, external_id = null,
         deleted_at = coalesce(k.deleted_at, now())
   where k.tenant_id = p_tenant and k.id = p_contato;
  if not found then
    raise exception 'anonimizar_contato: contato não encontrado no tenant' using errcode = 'P0002';
  end if;
  item := 'core.cliente_contato'; quantidade := 1; return next;

  update plataforma.auditoria a set antes = null, depois = null
   where a.tenant_id = p_tenant and a.entidade_id = p_contato and (a.antes is not null or a.depois is not null);
  get diagnostics v_n = row_count;
  item := 'plataforma.auditoria'; quantidade := v_n; return next;

  update plataforma.evento e set payload = '{}'::jsonb
   where e.tenant_id = p_tenant and e.agregado_id = p_contato and e.publicado_em is not null and e.payload <> '{}'::jsonb;
  get diagnostics v_n = row_count;
  item := 'plataforma.evento'; quantidade := v_n; return next;

  insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id)
  values (p_tenant, null, 'core', 'lgpd.anonimizar', 'cliente_contato', p_contato);
end
$$;
revoke all on function plataforma.anonimizar_contato(uuid, uuid) from public;

-- ---------------------------------------------------------------------------------------------
create function plataforma.excluir_tenant(p_tenant uuid, p_codigo text)
  returns table (tabela text, quantidade bigint)
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_codigo text;
  v_status text;
  v_replicacao text := current_setting('session_replication_role');
  v_t record;
  v_n bigint;
begin
  if p_tenant is null then
    raise exception 'excluir_tenant: p_tenant obrigatório' using errcode = '22004';
  end if;
  select t.codigo, t.status into v_codigo, v_status from plataforma.tenant t where t.id = p_tenant for update;
  if not found then
    raise exception 'excluir_tenant: tenant não encontrado' using errcode = 'P0002';
  end if;
  if p_codigo is distinct from v_codigo then
    raise exception 'excluir_tenant: código de confirmação não confere com o do tenant' using errcode = '22023';
  end if;
  if v_status <> 'encerrado' then
    raise exception 'excluir_tenant: o tenant precisa estar com status encerrado (está %)', v_status using errcode = '55000';
  end if;

  perform set_config('session_replication_role', 'replica', true);
  for v_t in
    select ns.nspname as esquema, c.relname as nome
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
     where c.relkind in ('r', 'p') and not c.relispartition
       and ns.nspname not in ('pg_catalog', 'information_schema') and ns.nspname not like 'pg\_%'
     order by 1, 2
  loop
    execute format('delete from %I.%I where tenant_id = $1', v_t.esquema, v_t.nome) using p_tenant;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      tabela := v_t.esquema || '.' || v_t.nome; quantidade := v_n; return next;
    end if;
  end loop;
  delete from plataforma.tenant t where t.id = p_tenant;
  tabela := 'plataforma.tenant'; quantidade := 1; return next;
  perform set_config('session_replication_role', v_replicacao, true);
end
$$;
revoke all on function plataforma.excluir_tenant(uuid, text) from public;

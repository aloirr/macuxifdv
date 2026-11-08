-- 0040_core_senha_email_saida (up) — T-0094 fatia B (ADR 0032; desenho docs/desenho/T-0094.md §2, §7, §8.1, §9.1, §10 e §13;
-- pedido R-20261107-175952-engenheiro-software; RN-CORE-32, RN-CORE-33, RN-CORE-34, RN-AUD-01). Dicionário: docs/banco/core.md
-- ("0040 — estado da senha e versão da sessão"), docs/banco/plataforma.md ("Outbox de e-mail") e docs/banco/lgpd.md.
-- Migração ADITIVA em cima da 0039 (T-0093). Entra no main no MESMO commit do Core (fatia C): o Core do portal lê as colunas
-- novas da sa_contas_para_login e o Drizzle do Core passa a ter as colunas novas de core.usuario.
--
-- 1. core.usuario ganha o estado da senha (padrões que não reescrevem linha: false e 0; usuários existentes ficam com a senha
--    definitiva, RN-CORE-32: senha já gravada continua valendo):
--      trocar_senha boolean not null default false   a senha atual é temporária: usada, leva à troca obrigatória
--      senha_expira_em timestamptz                    validade da senha atual quando temporária (72 h); nula = não vence
--                                                     (definitiva ou a master do admin inicial, P5). CHECK: só com trocar_senha
--      senha_temporaria_hash text                     a do "Esqueci a senha", PARALELA à atual (P6); argon2id como o senha_hash
--      senha_temporaria_expira_em timestamptz         validade dela (72 h)
--      senha_temporaria_criada_em timestamptz         teto de 15 min entre pedidos. CHECK: as três temporárias juntas
--      sessao_versao integer not null default 0       sobe a cada troca/redefinição/desativação; o token e a sessão do portal
--                                                     só valem com a versão atual. CHECK >= 0
--    Fora do sync (o Core seleciona as colunas do pull). Nenhum índice novo (lidas pela chave do usuário).
-- 2. plataforma.email_saida: outbox de e-mail (ADR 0032 §6, no lugar do pg-boss), gravada pela API NA MESMA TRANSAÇÃO da
--    senha (macuxi_app no contexto do tenant). Só o texto CIFRADO vai em carga (AES-256-GCM: destinatário e dados do modelo);
--    fora dela ficam tenant_id, usuario_id, modelo, chave_idempotencia e o controle do despacho. Carga só no pendente (CHECK):
--    o despachante zera ao enviar e na falha final. Enviado e falhou se excluem. chave_idempotencia única por tenant
--    (on conflict do nothing = não reenvia), sem '@' nem espaço (nunca o e-mail). ultimo_erro só código curto (sem texto do
--    servidor SMTP, que pode repetir o e-mail).
--    RLS forçado: macuxi_app só select e insert no próprio tenant (isolamento_tenant; sem update nem delete); macuxi_worker
--    lê todos os tenants (despacho_email, como a despacho_outbox da 0003) e atualiza só as colunas do despacho e só linha
--    PENDENTE (despacho_email_marcar), sem delete; manutencao (0031). macuxi_portal: nada. Fora do sync.
--    Volume: 1 linha por senha inicial/redefinida/"Esqueci" (dezenas por tenant por mês); sem expurgo ainda (as enviadas
--    ficam sem carga). Consultas: lote pendente por proxima_tentativa_em (email_saida_pendente_ix, parcial), por usuário
--    na anonimização (email_saida_usuario_ix) e a idempotência (email_saida_chave_uk).
-- 3. Portal (0039): portal_sessao_empresa ganha sessao_versao (a da conta no login). sa_contas_para_login devolve também
--    trocar_senha, senha_expira_em e sessao_versao (nunca o hash temporário: a senha do "Esqueci" não vale no portal);
--    sa_abrir_sessao_portal recusa conta com trocar_senha, aceita sessao_versao opcional por empresa (diferente da atual =
--    sem sessão) e grava a versão; sa_escolher_empresa recusa versão diferente ou trocar_senha; sa_sessao_valida cai se a
--    versão de qualquer conta conferida mudou ou se ela ficou com trocar_senha. Assinaturas (argumentos) IGUAIS às da 0039;
--    muda só o retorno da sa_contas_para_login (3 colunas no fim). As 4 são recriadas (drop + create) com EXECUTE só ao
--    macuxi_portal; a conferência do fim (12 sa_* do portal, nenhuma do app/worker/PUBLIC) é a da 0039.
-- 4. plataforma.provisionar_tenant (0035; a sa_provisionar_tenant da 0039 chama esta): admin inicial com trocar_senha e sem
--    validade (P5); redefinir_senha (só o deploy) volta a pedir a troca, limpa a temporária, sobe a sessao_versao e revoga os
--    refresh do admin. Mesma assinatura e retorno.
-- 5. plataforma.anonimizar_usuario (LGPD; 0036): limpa também trocar_senha/validade e as senha_temporaria_*, sobe a
--    sessao_versao e tira a carga dos e-mails pendentes do titular (falhou_em, ultimo_erro 'anonimizado'). Devolve o item
--    novo 'plataforma.email_saida' logo depois de 'core.usuario_convite'.
-- 6. O convite de 1º acesso sai do Core (T-0094 §9): os convites PENDENTES de core.usuario_convite são revogados (a tabela
--    fica como histórico).
--
-- Caminho de volta: 0040_core_senha_email_saida.down.sql (recria as 4 sa_* com o texto da 0039, a provisionar_tenant com o da
-- 0035 e a anonimizar_usuario com o da 0036; APAGA a outbox de e-mail com os pendentes, as colunas de core.usuario — senhas
-- temporárias e "trocar senha" se perdem: quem tinha senha temporária entra com ela como definitiva — e a sessao_versao da
-- sessão do portal). Os convites revogados aqui continuam revogados (o Core sem convite não os usa; o admin gera outros
-- depois de desfazer o Core). Desfaça junto o Core desta tarefa.

-- 1. core.usuario: estado da senha e versão da sessão -------------------------------------------------------------------
alter table core.usuario add column trocar_senha boolean not null default false;
alter table core.usuario add column senha_expira_em timestamptz;
alter table core.usuario add column senha_temporaria_hash text;
alter table core.usuario add column senha_temporaria_expira_em timestamptz;
alter table core.usuario add column senha_temporaria_criada_em timestamptz;
alter table core.usuario add column sessao_versao integer not null default 0;
alter table core.usuario add constraint usuario_senha_expira_so_trocar check (senha_expira_em is null or trocar_senha);
alter table core.usuario add constraint usuario_senha_temporaria_completa check (
  (senha_temporaria_hash is null) = (senha_temporaria_expira_em is null)
  and (senha_temporaria_hash is null) = (senha_temporaria_criada_em is null));
alter table core.usuario add constraint usuario_senha_temporaria_argon2id
  check (senha_temporaria_hash is null or senha_temporaria_hash like '$argon2id$%');
alter table core.usuario add constraint usuario_sessao_versao_faixa check (sessao_versao >= 0);

-- 2. plataforma.email_saida: outbox de e-mail -----------------------------------------------------------------------------
create table plataforma.email_saida (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references plataforma.tenant (id),
  usuario_id            uuid not null,
  modelo                text not null,
  chave_idempotencia    text not null,
  carga                 bytea,
  tentativas            integer not null default 0,
  proxima_tentativa_em  timestamptz not null default now(),
  expira_em             timestamptz not null default now() + interval '72 hours',
  enviado_em            timestamptz,
  falhou_em             timestamptz,
  ultimo_erro           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  external_id           text,
  constraint email_saida_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint email_saida_modelo_valido check (modelo in ('acesso_inicial', 'nova_senha')),
  constraint email_saida_chave_formato check (chave_idempotencia ~ '^[A-Za-z0-9_.:+-]{1,200}$'),
  constraint email_saida_tentativas_faixa check (tentativas >= 0),
  constraint email_saida_enviado_ou_falhou check (enviado_em is null or falhou_em is null),
  constraint email_saida_carga_so_pendente check ((enviado_em is null and falhou_em is null) = (carga is not null)),
  constraint email_saida_carga_tamanho check (carga is null or octet_length(carga) between 1 and 16384),
  constraint email_saida_ultimo_erro_codigo check (ultimo_erro is null or ultimo_erro ~ '^[A-Za-z0-9_.:-]{1,60}$')
);
create unique index email_saida_chave_uk on plataforma.email_saida (tenant_id, chave_idempotencia);
create index email_saida_pendente_ix on plataforma.email_saida (proxima_tentativa_em) where enviado_em is null and falhou_em is null;
create index email_saida_usuario_ix on plataforma.email_saida (tenant_id, usuario_id);
create trigger email_saida_updated_at before update on plataforma.email_saida
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.email_saida enable row level security;
alter table plataforma.email_saida force row level security;
create policy isolamento_tenant on plataforma.email_saida for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on plataforma.email_saida for all to macuxi_manutencao using (true) with check (true);
-- despachante (ADR 0032 §6, como a despacho_outbox da 0003): lê todos os tenants; marca só linha pendente
create policy despacho_email on plataforma.email_saida for select to macuxi_worker
  using (true);
create policy despacho_email_marcar on plataforma.email_saida for update to macuxi_worker
  using (enviado_em is null and falhou_em is null) with check (true);
revoke all on plataforma.email_saida from public;
grant select, insert on plataforma.email_saida to macuxi_app;
grant select on plataforma.email_saida to macuxi_worker;
grant update (carga, tentativas, proxima_tentativa_em, enviado_em, falhou_em, ultimo_erro) on plataforma.email_saida to macuxi_worker;

-- 3. Portal: versão da conta na sessão e as 4 sa_* que a leem -------------------------------------------------------------
alter table plataforma.portal_sessao_empresa add column sessao_versao integer not null default 0;
alter table plataforma.portal_sessao_empresa
  add constraint portal_sessao_empresa_versao_faixa check (sessao_versao >= 0);

drop function if exists plataforma.sa_contas_para_login(text);
create function plataforma.sa_contas_para_login(p_email text)
  returns table (tipo text, conta_id uuid, tenant_id uuid, tenant_codigo text, tenant_nome text, senha_hash text,
                 trocar_senha boolean, senha_expira_em timestamptz, sessao_versao integer)
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
      select c.tipo, c.conta_id, c.tenant_id, c.tenant_codigo, c.tenant_nome, c.senha_hash, c.trocar_senha, c.senha_expira_em,
             c.sessao_versao
        from (
          select 'super_admin'::text as tipo, s.id as conta_id, null::uuid as tenant_id, null::text as tenant_codigo,
                 null::text as tenant_nome, s.senha_hash, false as trocar_senha, null::timestamptz as senha_expira_em,
                 null::integer as sessao_versao, 0 as ordem, ''::text as nome_ordem, s.id as id_ordem
            from plataforma.super_admin s
           where lower(s.email) = v_email and s.deleted_at is null and s.ativo
          union all
          select 'admin_cliente'::text, u.id, t.id, t.codigo, t.nome, u.senha_hash, u.trocar_senha, u.senha_expira_em, u.sessao_versao,
                 1, t.nome, t.id
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
  v_usuarios uuid[] := '{}';
  v_versoes integer[] := '{}';
  v_versao integer;
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
      -- 0040: sessao_versao opcional (a que a sa_contas_para_login devolveu): inteiro >= 0
      if coalesce(jsonb_typeof(v_e -> 'sessao_versao'), 'null') <> 'null'
         and (jsonb_typeof(v_e -> 'sessao_versao') <> 'number' or (v_e ->> 'sessao_versao') !~ '^[0-9]{1,9}$') then
        raise exception 'sa_abrir_sessao_portal: sessao_versao deve ser inteiro >= 0' using errcode = '22023';
      end if;
      v_t := (v_e ->> 'tenant_id')::uuid;
      v_u := (v_e ->> 'usuario_id')::uuid;
      if v_t = any (v_vistos) then
        raise exception 'sa_abrir_sessao_portal: empresa repetida' using errcode = '22023';
      end if;
      v_vistos := v_vistos || v_t;
      -- reconfere no banco (entre a busca e a sessão o admin pode ter sido desativado): uma que não vale = sem sessão.
      -- 0040: conta com senha a trocar (RN-CORE-34) não entra; com a sessao_versao informada, a senha não pode ter mudado
      -- desde a conferência (versão diferente = sem sessão). A versão gravada é a de agora.
      select u.sessao_versao into v_versao
        from core.usuario u join plataforma.tenant t on t.id = u.tenant_id
       where u.tenant_id = v_t and u.id = v_u and u.perfil = 'admin' and u.ativo and u.bloqueado_em is null
         and u.senha_hash is not null and not u.trocar_senha and u.deleted_at is null and t.status = 'ativo' and t.deleted_at is null;
      if not found then
        return;
      end if;
      if coalesce(jsonb_typeof(v_e -> 'sessao_versao'), 'null') <> 'null' and (v_e ->> 'sessao_versao')::integer <> v_versao then
        return;
      end if;
      v_usuarios := v_usuarios || v_u;
      v_versoes := v_versoes || v_versao;
    end loop;
    insert into plataforma.portal_sessao (tipo, criada_em, ultimo_uso_em, expira_em)
    values ('admin_cliente', now(), now(), v_expira)
    returning id into v_sid;
    insert into plataforma.portal_sessao_empresa (sessao_id, tenant_alvo_id, usuario_id, sessao_versao)
    select v_sid, x.t, x.u, x.v
      from unnest(v_vistos, v_usuarios, v_versoes) as x (t, u, v);
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
  v_versao integer;
  v_codigo text;
  v_nome text;
begin
  select e.usuario_id, e.sessao_versao into v_u, v_versao
    from plataforma.portal_sessao x
    join plataforma.portal_sessao_empresa e on e.sessao_id = x.id
   where x.id = p_sid and x.tipo = 'admin_cliente' and x.revogada_em is null and x.deleted_at is null and x.expira_em > now()
     and e.tenant_alvo_id = p_tenant and e.deleted_at is null
     -- 0040: a sessão já caiu se a senha de alguma conta conferida mudou ou ficou a trocar (a mesma regra da sa_sessao_valida)
     and not exists (select 1 from plataforma.portal_sessao_empresa o
                       join core.usuario w on w.tenant_id = o.tenant_alvo_id and w.id = o.usuario_id
                      where o.sessao_id = x.id and o.deleted_at is null and (w.sessao_versao <> o.sessao_versao or w.trocar_senha))
     for update of x;
  if v_u is null then
    return;
  end if;
  select t.codigo, t.nome into v_codigo, v_nome
    from core.usuario u
    join plataforma.tenant t on t.id = u.tenant_id
   where u.tenant_id = p_tenant and u.id = v_u and u.perfil = 'admin' and u.ativo and u.bloqueado_em is null
     and u.senha_hash is not null and u.deleted_at is null and t.status = 'ativo' and t.deleted_at is null
     -- 0040: senha trocada/redefinida depois do login (versão nova) ou senha a trocar = a empresa não abre
     and not u.trocar_senha and u.sessao_versao = v_versao;
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
       -- 0040: admin do cliente cai na hora se a senha de QUALQUER conta conferida no login mudou (sessao_versao) ou ficou
       -- a trocar (RN-CORE-34): a sessão inteira nasceu do conhecimento daquela senha
       and (x.tipo <> 'admin_cliente'
            or not exists (select 1 from plataforma.portal_sessao_empresa e
                             join core.usuario u on u.tenant_id = e.tenant_alvo_id and u.id = e.usuario_id
                            where e.sessao_id = x.id and e.deleted_at is null
                              and (u.sessao_versao <> e.sessao_versao or u.trocar_senha)))
    returning x.tipo, x.super_admin_id, x.tenant_atual_id, x.usuario_atual_id, x.expira_em
  $$;
revoke all on function plataforma.sa_sessao_valida(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_sessao_valida(uuid) to macuxi_portal;

-- 4. provisionar_tenant: admin inicial com trocar_senha (P5) ----------------------------------------------------------------
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

-- 5. anonimizar_usuario: senha temporária, versão da sessão e carga dos e-mails pendentes --------------------------------
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
         senha_hash = null, trocar_senha = false, senha_expira_em = null, senha_temporaria_hash = null,
         senha_temporaria_expira_em = null, senha_temporaria_criada_em = null, sessao_versao = u.sessao_versao + 1,
         external_id = null, ativo = false,
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

  -- 0040: e-mails ainda na fila perdem a carga cifrada (destinatário e senha) e não saem mais
  update plataforma.email_saida e set carga = null, falhou_em = now(), ultimo_erro = 'anonimizado'
   where e.tenant_id = p_tenant and e.usuario_id = p_usuario and e.enviado_em is null and e.falhou_em is null;
  get diagnostics v_n = row_count;
  item := 'plataforma.email_saida'; quantidade := v_n; return next;

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

-- 6. Convites de 1º acesso pendentes: revogados (o convite sai do Core; a tabela fica de histórico) -------------------------
update core.usuario_convite c set revogado_em = now()
 where c.usado_em is null and c.revogado_em is null and c.deleted_at is null;

-- Conferência pelo catálogo (a da 0039): nenhuma plataforma.sa_* nem a criar_super_admin executável pelo macuxi_app, pelo
-- macuxi_worker ou por PUBLIC; exatamente as 12 sa_* públicas executáveis pelo macuxi_portal; a interna e a criar_super_admin,
-- por ninguém. E o macuxi_portal sem nenhum privilégio na outbox de e-mail.
do $$
declare
  v_f text;
  v_n int;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and (p.proname like 'sa\_%' or p.proname = 'criar_super_admin')
     and (has_function_privilege('macuxi_app', p.oid, 'execute') or has_function_privilege('macuxi_worker', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if v_f is not null then
    raise exception '0040: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname in ('sa_registrar_auditoria', 'criar_super_admin')
     and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_f is not null then
    raise exception '0040: função interna ou de deploy executável pelo macuxi_portal: %', v_f using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 12 then
    raise exception '0040: esperadas 12 funções sa_* executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
  if has_table_privilege('macuxi_portal', 'plataforma.email_saida', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception '0040: o macuxi_portal não pode ter privilégio na plataforma.email_saida' using errcode = '42501';
  end if;
end
$$;

-- 0035_plataforma_super_admin (up) — T-0087 fatia P (portal config.macuxifdv.com.br; ADR 0029; desenho docs/desenho/T-0087.md
-- §2 e §6; pedidos R-20261106-002308 e R-20261106-004109-engenheiro-software). Dicionário: docs/banco/plataforma.md
-- ("Super-admin de plataforma"); RLS: docs/banco/rls.md ("Tabelas só por função").
-- Migração ADITIVA: 4 tabelas novas, 1 gatilho de append-only, 21 funções novas e a plataforma.provisionar_tenant (0029)
-- com 3 chaves novas opcionais na entrada (compatível: o comando `pnpm tenant:criar` da T-0083 segue igual).
--
-- Super-admin = identidade de PLATAFORMA, fora dos tenants (ADR 0029 §1). As 4 tabelas NÃO têm tenant_id (exceção à regra 5
-- do CLAUDE.md, registrada na ADR 0029 e em db/src/excecoes.ts, TABELAS_SEM_TENANT_ID e TABELAS_SO_POR_FUNCAO):
--   plataforma.super_admin           o operador da Macuxi (e-mail, nome, hash argon2id, TOTP cifrado, hashes de recuperação,
--                                    falhas/bloqueio). Único por lower(email) entre os vivos.
--   plataforma.super_admin_desafio   2ª etapa do login: só o SHA-256 do desafio, prazo de 5 min (CHECK), uso único.
--   plataforma.super_admin_sessao    sessão curta: teto de 8 h (CHECK), revogável, conferida a CADA requisição.
--   plataforma.auditoria_plataforma  APPEND-ONLY (gatilho recusa update, delete e truncate para todos, inclusive o dono):
--                                    toda requisição do super-admin (API) e os fatos de login/TOTP/sessão (Core e banco).
--                                    O tenant da ação fica em tenant_alvo_id (nulo fora de tenant), SEM FK e com outro nome
--                                    que não tenant_id DE PROPÓSITO: a plataforma.excluir_tenant (0024/0032) apaga toda
--                                    tabela com coluna tenant_id, e a auditoria da plataforma tem de sobreviver à exclusão
--                                    (pedido item 6). A coluna tenant_id também tornaria a tabela "de tenant" para os testes
--                                    de vazamento e de conformidade, o que ela não é.
--
-- Isolamento (ADR 0029 §1): RLS ligado e FORÇADO nas 4 tabelas, SEM política para macuxi_app ou macuxi_worker e SEM grant
-- de tabela a eles (42501 direto; com um grant indevido no futuro, 0 linhas pela RLS). Só a política manutencao (0031,
-- B1 do DBaaS): o dono das funções (migrador; no DBaaS, sem superusuário nem BYPASSRLS) a herda e as funções SECURITY
-- DEFINER enxergam as linhas. Todo acesso da aplicação é pelas funções abaixo: SECURITY DEFINER, search_path fixo com
-- pg_temp por último (regra da 0012), revoke all from public, EXECUTE só ao macuxi_app (nunca ao macuxi_worker: 42501).
-- Plano B do DBaaS: nenhum ALTER ROLE, nenhum atributo de papel, nenhum papel novo; só grants de EXECUTE.
--
-- Funções (assinaturas = contrato com o modulo-core e a API; docs/banco/plataforma.md tem a tabela completa):
--   sa_existe()                                         já houve super-admin? (qualquer linha, mesmo apagada: 410 para sempre)
--   sa_criar_primeiro(p_email, p_nome, p_senha_hash)    trava consultiva; cria só com ZERO linhas; senão devolve nulo
--   sa_para_login(p_email) / sa_por_id(p_id)            linha viva p/ conferir senha e TOTP (sem os hashes de recuperação)
--   sa_registrar_falha(p_id) / sa_registrar_sucesso(p_id)   5 falhas seguidas = bloqueado_ate +15 min (zera o contador)
--   sa_gravar_totp_pendente(p_id, p_cifrado)            só antes do TOTP confirmado (redefinir = comando de administração)
--   sa_confirmar_totp(p_id, p_passo, p_recuperacao_hashes)  pendente vira o segredo + passo usado + hashes, numa só vez
--   sa_marcar_passo(p_id, p_passo)                      só avança (o mesmo passo de novo = falso: sem reuso)
--   sa_usar_recuperacao(p_id, p_hash) / sa_regerar_recuperacao(p_id, p_hashes)   devolvem quantos restam
--   sa_abrir_desafio(p_id, p_desafio_hash) / sa_ver_desafio(p_desafio_hash)      2ª etapa (5 min, etapa calculada aqui)
--   sa_abrir_sessao(p_desafio_hash)                     CONSOME o desafio; exige TOTP confirmado, ativo e sem bloqueio
--   sa_sessao_valida(p_sid) / sa_revogar(p_sid)         viva = não revogada, expira_em > now(), ativo e TOTP confirmado
--   sa_auditar(p jsonb)                                 1 linha na auditoria_plataforma (rota sem query; IP só prefixo)
--   sa_listar_tenants(p_sid) / sa_tenant_ativo(p_sid, p_tenant) / sa_provisionar_tenant(p_sid, p jsonb)  conferem a sessão
-- Internas (sem EXECUTE para ninguém além do dono): sa_registrar_auditoria (fatos gravados pelo próprio banco: primeiro
-- acesso, TOTP confirmado, bloqueio, sessão aberta/revogada, recuperação usada/regerada, tenant provisionado) e o gatilho
-- auditoria_plataforma_recusar.
-- Limite registrado (para a ADR 0029): a conferência da senha e do TOTP é no Node (a chave do TOTP fica fora do banco);
-- quem tiver a credencial do macuxi_app consegue abrir desafio e sessão pelas funções. Tudo fica na auditoria gravada pelo
-- banco (sa.sessao.aberta), que o app não apaga. A barreira contra isso é a credencial do macuxi_app (só na VM).
--
-- plataforma.provisionar_tenant(p jsonb) — mesma assinatura, SECURITY INVOKER como na 0029, 3 chaves novas opcionais:
--   sem_admin (boolean, padrão false): true = não cria nem confere admin (o admin do cliente vem na Equipe, com convite);
--     com sem_admin, 'admin' presente ou redefinir_senha = true é 22023. Sem sem_admin, admin continua obrigatório (T-0083).
--   parametros ([{ modulo, chave, valor }], padrão []): linhas de plataforma.parametro gravadas com on conflict do nothing
--     (parâmetro já gravado não muda); o módulo tem de estar entre os do tenant (senão 22023). Devolve parametros_gravados
--     (as chaves inseridas nesta chamada, em ordem). Chaves do Vendedor que o portal manda (linhasDosParametrosIniciais do
--     platform-sdk): alcada.vendedor_pct, alcada.supervisor_pct, alcada.gerente_pct, validade_orcamento_dias,
--     aplicacao_no_orcamento_padrao.
--   ator_id (uuid): vai para plataforma.auditoria.usuario_id (sem FK). Só a sa_provisionar_tenant preenche (com o id do
--     super-admin da sessão, sobrescrevendo o que vier); o comando da T-0083 não manda (ator nulo, como antes).
--   Saída ganha parametros_gravados (lista, vazia no comando) e admin = 'sem_admin' quando pedido; 2x a mesma entrada =
--   mesmas linhas (idempotente). A auditoria do tenant ganha 'parametros_gravados' no depois só quando houve parâmetro.
--
-- Volume: 1 a 3 super-admins, algumas sessões e desafios por dia, auditoria de milhares de linhas por dia de implantação.
-- Índices: único por lower(email); desafio por hash; sessões vivas por super-admin; auditoria por instante, por super-admin
-- e por tenant alvo. Sem expurgo nesta migração (retenção da auditoria: indefinida, como a plataforma.auditoria).
-- Caminho de volta: 0035_plataforma_super_admin.down.sql (APAGA as 4 tabelas, com a auditoria da plataforma, e as funções;
-- devolve a provisionar_tenant da 0029; tenants e parâmetros já criados pelo portal ficam).

-- 1. Tabelas ---------------------------------------------------------------------------------------------------------------
create table plataforma.super_admin (
  id                     uuid primary key default gen_random_uuid(),
  email                  text not null,
  nome                   text not null,
  senha_hash             text not null,
  totp_segredo_cifrado   text,
  totp_pendente_cifrado  text,
  totp_confirmado_em     timestamptz,
  totp_ultimo_passo      bigint,
  recuperacao_hashes     text[] not null default '{}',
  falhas                 integer not null default 0,
  bloqueado_ate          timestamptz,
  ativo                  boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  external_id            text,
  constraint super_admin_email_formato check (email = btrim(email) and char_length(email) <= 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint super_admin_nome_preenchido check (btrim(nome) <> '' and char_length(nome) <= 200),
  constraint super_admin_senha_argon2id check (senha_hash like '$argon2id$%'),
  constraint super_admin_totp_cifrado_formato check (
    (totp_segredo_cifrado is null or totp_segredo_cifrado ~ '^v1\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+$')
    and (totp_pendente_cifrado is null or totp_pendente_cifrado ~ '^v1\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+$')),
  constraint super_admin_totp_confirmado check ((totp_confirmado_em is null) = (totp_segredo_cifrado is null)),
  constraint super_admin_totp_passo check (totp_ultimo_passo is null or totp_ultimo_passo >= 0),
  constraint super_admin_recuperacao_limite check (cardinality(recuperacao_hashes) <= 20),
  constraint super_admin_falhas_positivas check (falhas >= 0)
);
create unique index super_admin_email_uk on plataforma.super_admin (lower(email)) where deleted_at is null;
create trigger super_admin_updated_at before update on plataforma.super_admin
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.super_admin enable row level security;
alter table plataforma.super_admin force row level security;
create policy manutencao on plataforma.super_admin for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.super_admin from public, macuxi_app, macuxi_worker;

create table plataforma.super_admin_desafio (
  id              uuid primary key default gen_random_uuid(),
  super_admin_id  uuid not null references plataforma.super_admin (id),
  desafio_hash    text not null,
  etapa           text not null,
  expira_em       timestamptz not null,
  consumido_em    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint super_admin_desafio_hash_formato check (desafio_hash ~ '^[0-9a-f]{64}$'),
  constraint super_admin_desafio_etapa_valida check (etapa in ('segundo_fator', 'cadastrar_totp')),
  constraint super_admin_desafio_prazo check (expira_em > created_at and expira_em <= created_at + interval '5 minutes')
);
create unique index super_admin_desafio_hash_uk on plataforma.super_admin_desafio (desafio_hash);
create index super_admin_desafio_aberto_ix on plataforma.super_admin_desafio (super_admin_id) where consumido_em is null;
create trigger super_admin_desafio_updated_at before update on plataforma.super_admin_desafio
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.super_admin_desafio enable row level security;
alter table plataforma.super_admin_desafio force row level security;
create policy manutencao on plataforma.super_admin_desafio for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.super_admin_desafio from public, macuxi_app, macuxi_worker;

create table plataforma.super_admin_sessao (
  id              uuid primary key default gen_random_uuid(),
  super_admin_id  uuid not null references plataforma.super_admin (id),
  criada_em       timestamptz not null default now(),
  ultimo_uso_em   timestamptz not null default now(),
  expira_em       timestamptz not null,
  revogada_em     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint super_admin_sessao_teto check (expira_em > criada_em and expira_em <= criada_em + interval '8 hours'),
  constraint super_admin_sessao_uso check (ultimo_uso_em >= criada_em)
);
create index super_admin_sessao_viva_ix on plataforma.super_admin_sessao (super_admin_id) where revogada_em is null;
create trigger super_admin_sessao_updated_at before update on plataforma.super_admin_sessao
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.super_admin_sessao enable row level security;
alter table plataforma.super_admin_sessao force row level security;
create policy manutencao on plataforma.super_admin_sessao for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.super_admin_sessao from public, macuxi_app, macuxi_worker;

create table plataforma.auditoria_plataforma (
  id              uuid primary key default gen_random_uuid(),
  super_admin_id  uuid references plataforma.super_admin (id),
  sessao_id       uuid,
  tenant_alvo_id  uuid,
  acao            text not null,
  metodo          text,
  rota            text,
  status          integer,
  request_id      text,
  ip_prefixo      text,
  detalhes        jsonb not null default '{}'::jsonb,
  ocorrido_em     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint auditoria_plataforma_acao_formato check (acao ~ '^[a-z][a-z0-9_.]{0,79}$'),
  constraint auditoria_plataforma_metodo_formato check (metodo is null or metodo ~ '^[A-Z]{3,10}$'),
  constraint auditoria_plataforma_rota_modelo check (rota is null or (char_length(rota) <= 300 and position('?' in rota) = 0)),
  constraint auditoria_plataforma_status_http check (status is null or status between 100 and 599),
  constraint auditoria_plataforma_request_id_curto check (request_id is null or char_length(request_id) <= 100),
  constraint auditoria_plataforma_ip_prefixo_formato check (ip_prefixo is null
    or ip_prefixo ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.0/24$' or ip_prefixo ~ '^[0-9a-f:]{1,40}::/48$'),
  constraint auditoria_plataforma_detalhes_objeto check (jsonb_typeof(detalhes) = 'object' and octet_length(detalhes::text) <= 4096)
);
create index auditoria_plataforma_ocorrido_ix on plataforma.auditoria_plataforma (ocorrido_em, id);
create index auditoria_plataforma_super_admin_ix on plataforma.auditoria_plataforma (super_admin_id, ocorrido_em);
create index auditoria_plataforma_tenant_alvo_ix on plataforma.auditoria_plataforma (tenant_alvo_id, ocorrido_em)
  where tenant_alvo_id is not null;
alter table plataforma.auditoria_plataforma enable row level security;
alter table plataforma.auditoria_plataforma force row level security;
create policy manutencao on plataforma.auditoria_plataforma for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.auditoria_plataforma from public, macuxi_app, macuxi_worker;

-- append-only para todos (o app e o worker já não têm grant; o gatilho vale também para o dono e para o superusuário)
create function plataforma.auditoria_plataforma_recusar()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
begin
  raise exception 'plataforma.auditoria_plataforma é append-only: % recusado', tg_op using errcode = '42501';
end
$$;
revoke all on function plataforma.auditoria_plataforma_recusar() from public;
create trigger auditoria_plataforma_append_only before update or delete on plataforma.auditoria_plataforma
  for each row execute function plataforma.auditoria_plataforma_recusar();
create trigger auditoria_plataforma_sem_truncate before truncate on plataforma.auditoria_plataforma
  for each statement execute function plataforma.auditoria_plataforma_recusar();

-- 2. Auditoria interna (só o dono executa; chamada de dentro das SECURITY DEFINER) -----------------------------------------
create function plataforma.sa_registrar_auditoria(p_super_admin uuid, p_sessao uuid, p_tenant uuid, p_acao text, p_detalhes jsonb)
  returns void
  language sql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    insert into plataforma.auditoria_plataforma (super_admin_id, sessao_id, tenant_alvo_id, acao, detalhes)
    values (p_super_admin, p_sessao, p_tenant, p_acao, coalesce(p_detalhes, '{}'::jsonb) || '{"origem": "banco"}'::jsonb)
  $$;
revoke all on function plataforma.sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb) from public;

-- 3. Primeiro acesso e leitura para o login ------------------------------------------------------------------------------
create function plataforma.sa_existe()
  returns boolean
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select exists (select 1 from plataforma.super_admin s)
  $$;

create function plataforma.sa_criar_primeiro(p_email text, p_nome text, p_senha_hash text)
  returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_email text := btrim(p_email);
  v_nome text := nullif(btrim(p_nome), '');
  v_id uuid;
begin
  -- mensagens sem dado pessoal (nem e-mail nem hash)
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'sa_criar_primeiro: e-mail inválido' using errcode = '22023';
  end if;
  if v_nome is null or char_length(v_nome) > 200 then
    raise exception 'sa_criar_primeiro: nome obrigatório (até 200 caracteres)' using errcode = '22023';
  end if;
  if p_senha_hash is null
     or p_senha_hash !~ '^\$argon2id\$v=[0-9]+\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$' then
    raise exception 'sa_criar_primeiro: senha_hash deve ser argon2id (formato PHC)' using errcode = '22023';
  end if;
  -- duas chamadas ao mesmo tempo: a segunda espera a primeira terminar e, em READ COMMITTED, vê a linha criada
  perform pg_advisory_xact_lock(hashtext('plataforma.sa_criar_primeiro'));
  if exists (select 1 from plataforma.super_admin s) then
    return null;
  end if;
  insert into plataforma.super_admin (email, nome, senha_hash) values (v_email, v_nome, p_senha_hash) returning id into v_id;
  perform plataforma.sa_registrar_auditoria(v_id, null, null, 'sa.primeiro_acesso', '{}'::jsonb);
  return v_id;
end
$$;

create function plataforma.sa_para_login(p_email text)
  returns table (id uuid, email text, nome text, senha_hash text, ativo boolean, falhas integer, bloqueado_ate timestamptz,
                 totp_confirmado_em timestamptz, totp_segredo_cifrado text, totp_pendente_cifrado text, totp_ultimo_passo bigint,
                 recuperacao_restantes integer)
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select s.id, s.email, s.nome, s.senha_hash, s.ativo, s.falhas, s.bloqueado_ate, s.totp_confirmado_em, s.totp_segredo_cifrado,
           s.totp_pendente_cifrado, s.totp_ultimo_passo, cardinality(s.recuperacao_hashes)
      from plataforma.super_admin s
     where lower(s.email) = lower(btrim(p_email)) and s.deleted_at is null
  $$;

create function plataforma.sa_por_id(p_id uuid)
  returns table (id uuid, email text, nome text, senha_hash text, ativo boolean, falhas integer, bloqueado_ate timestamptz,
                 totp_confirmado_em timestamptz, totp_segredo_cifrado text, totp_pendente_cifrado text, totp_ultimo_passo bigint,
                 recuperacao_restantes integer)
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select s.id, s.email, s.nome, s.senha_hash, s.ativo, s.falhas, s.bloqueado_ate, s.totp_confirmado_em, s.totp_segredo_cifrado,
           s.totp_pendente_cifrado, s.totp_ultimo_passo, cardinality(s.recuperacao_hashes)
      from plataforma.super_admin s
     where s.id = p_id and s.deleted_at is null
  $$;

-- 4. Falhas e bloqueio ---------------------------------------------------------------------------------------------------
create function plataforma.sa_registrar_falha(p_id uuid)
  returns table (falhas integer, bloqueado_ate timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_falhas integer;
  v_ate timestamptz;
begin
  -- bloqueado: nada muda (devolve o estado). Bloqueio vencido é limpo na próxima falha. 5ª falha seguida: +15 min e zera.
  update plataforma.super_admin s
     set falhas = case when s.falhas + 1 >= 5 then 0 else s.falhas + 1 end,
         bloqueado_ate = case when s.falhas + 1 >= 5 then now() + interval '15 minutes' end
   where s.id = p_id and s.deleted_at is null and (s.bloqueado_ate is null or s.bloqueado_ate <= now())
  returning s.falhas, s.bloqueado_ate into v_falhas, v_ate;
  if found then
    if v_ate is not null then
      perform plataforma.sa_registrar_auditoria(p_id, null, null, 'sa.bloqueio', '{"minutos": 15}'::jsonb);
    end if;
  else
    select s.falhas, s.bloqueado_ate into v_falhas, v_ate from plataforma.super_admin s where s.id = p_id and s.deleted_at is null;
    if not found then
      return;
    end if;
  end if;
  falhas := v_falhas;
  bloqueado_ate := v_ate;
  return next;
end
$$;

create function plataforma.sa_registrar_sucesso(p_id uuid)
  returns void
  language sql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    update plataforma.super_admin s
       set falhas = 0, bloqueado_ate = null
     where s.id = p_id and s.deleted_at is null and (s.bloqueado_ate is null or s.bloqueado_ate <= now())
       and (s.falhas <> 0 or s.bloqueado_ate is not null)
  $$;

-- 5. TOTP e códigos de recuperação ---------------------------------------------------------------------------------------
create function plataforma.sa_gravar_totp_pendente(p_id uuid, p_cifrado text)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_cifrado is null or p_cifrado !~ '^v1\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+$' then
    raise exception 'sa_gravar_totp_pendente: segredo cifrado fora do formato v1.<iv>.<tag>.<cifra>' using errcode = '22023';
  end if;
  update plataforma.super_admin s
     set totp_pendente_cifrado = p_cifrado
   where s.id = p_id and s.deleted_at is null and s.ativo and s.totp_confirmado_em is null;
  return found;
end
$$;

create function plataforma.sa_confirmar_totp(p_id uuid, p_passo bigint, p_recuperacao_hashes text[])
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_passo is null or p_passo < 0 then
    raise exception 'sa_confirmar_totp: passo inválido' using errcode = '22023';
  end if;
  if p_recuperacao_hashes is null or coalesce(array_ndims(p_recuperacao_hashes), 0) <> 1
     or cardinality(p_recuperacao_hashes) not between 1 and 20
     or exists (select 1 from unnest(p_recuperacao_hashes) h where h is null or h !~ '^[0-9a-f]{64}$')
     or (select count(distinct h) from unnest(p_recuperacao_hashes) h) <> cardinality(p_recuperacao_hashes) then
    raise exception 'sa_confirmar_totp: hashes de recuperação devem ser 1 a 20 SHA-256 hex distintos' using errcode = '22023';
  end if;
  update plataforma.super_admin s
     set totp_segredo_cifrado = s.totp_pendente_cifrado, totp_pendente_cifrado = null, totp_confirmado_em = now(),
         totp_ultimo_passo = p_passo, recuperacao_hashes = p_recuperacao_hashes
   where s.id = p_id and s.deleted_at is null and s.ativo and s.totp_confirmado_em is null and s.totp_pendente_cifrado is not null;
  if not found then
    return false;
  end if;
  perform plataforma.sa_registrar_auditoria(p_id, null, null, 'sa.totp.confirmado',
    jsonb_build_object('recuperacao', cardinality(p_recuperacao_hashes)));
  return true;
end
$$;

create function plataforma.sa_marcar_passo(p_id uuid, p_passo bigint)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_passo is null or p_passo < 0 then
    return false;
  end if;
  update plataforma.super_admin s
     set totp_ultimo_passo = p_passo
   where s.id = p_id and s.deleted_at is null and s.totp_confirmado_em is not null
     and (s.totp_ultimo_passo is null or p_passo > s.totp_ultimo_passo);
  return found;
end
$$;

create function plataforma.sa_usar_recuperacao(p_id uuid, p_hash text)
  returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_restantes integer;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  update plataforma.super_admin s
     set recuperacao_hashes = array_remove(s.recuperacao_hashes, p_hash)
   where s.id = p_id and s.deleted_at is null and s.totp_confirmado_em is not null and p_hash = any (s.recuperacao_hashes)
  returning cardinality(s.recuperacao_hashes) into v_restantes;
  if not found then
    return null;
  end if;
  perform plataforma.sa_registrar_auditoria(p_id, null, null, 'sa.recuperacao.usada', jsonb_build_object('restantes', v_restantes));
  return v_restantes;
end
$$;

create function plataforma.sa_regerar_recuperacao(p_id uuid, p_hashes text[])
  returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_hashes is null or coalesce(array_ndims(p_hashes), 0) <> 1 or cardinality(p_hashes) not between 1 and 20
     or exists (select 1 from unnest(p_hashes) h where h is null or h !~ '^[0-9a-f]{64}$')
     or (select count(distinct h) from unnest(p_hashes) h) <> cardinality(p_hashes) then
    raise exception 'sa_regerar_recuperacao: hashes de recuperação devem ser 1 a 20 SHA-256 hex distintos' using errcode = '22023';
  end if;
  update plataforma.super_admin s
     set recuperacao_hashes = p_hashes
   where s.id = p_id and s.deleted_at is null and s.ativo and s.totp_confirmado_em is not null;
  if not found then
    return null;
  end if;
  perform plataforma.sa_registrar_auditoria(p_id, null, null, 'sa.recuperacao.regerada', jsonb_build_object('quantidade', cardinality(p_hashes)));
  return cardinality(p_hashes);
end
$$;

-- 6. Desafio da 2ª etapa e sessão ----------------------------------------------------------------------------------------
create function plataforma.sa_abrir_desafio(p_id uuid, p_desafio_hash text)
  returns table (etapa text, expira_em timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_confirmado timestamptz;
  v_etapa text;
  v_expira timestamptz := now() + interval '5 minutes';
begin
  if p_desafio_hash is null or p_desafio_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'sa_abrir_desafio: desafio deve ser SHA-256 hex' using errcode = '22023';
  end if;
  select s.totp_confirmado_em into v_confirmado
    from plataforma.super_admin s
   where s.id = p_id and s.deleted_at is null and s.ativo and (s.bloqueado_ate is null or s.bloqueado_ate <= now())
     for update;
  if not found then
    return;
  end if;
  v_etapa := case when v_confirmado is null then 'cadastrar_totp' else 'segundo_fator' end;
  -- um desafio aberto por vez: os anteriores do mesmo super-admin deixam de valer
  update plataforma.super_admin_desafio d set consumido_em = now() where d.super_admin_id = p_id and d.consumido_em is null;
  insert into plataforma.super_admin_desafio (super_admin_id, desafio_hash, etapa, expira_em)
  values (p_id, p_desafio_hash, v_etapa, v_expira);
  etapa := v_etapa;
  expira_em := v_expira;
  return next;
end
$$;

create function plataforma.sa_ver_desafio(p_desafio_hash text)
  returns table (super_admin_id uuid, etapa text, expira_em timestamptz)
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select d.super_admin_id, d.etapa, d.expira_em
      from plataforma.super_admin_desafio d
      join plataforma.super_admin s on s.id = d.super_admin_id
     where d.desafio_hash = p_desafio_hash and d.consumido_em is null and d.expira_em > now() and d.deleted_at is null
       and s.deleted_at is null and s.ativo and (s.bloqueado_ate is null or s.bloqueado_ate <= now())
  $$;

create function plataforma.sa_abrir_sessao(p_desafio_hash text)
  returns table (sessao_id uuid, super_admin_id uuid, expira_em timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_sa uuid;
  v_sid uuid;
  v_expira timestamptz := now() + interval '8 hours';
begin
  -- uso único: o desafio é consumido aqui, mesmo que a sessão seja recusada abaixo
  update plataforma.super_admin_desafio d
     set consumido_em = now()
   where d.desafio_hash = p_desafio_hash and d.consumido_em is null and d.expira_em > now() and d.deleted_at is null
  returning d.super_admin_id into v_sa;
  if v_sa is null then
    return;
  end if;
  if not exists (select 1 from plataforma.super_admin s
                  where s.id = v_sa and s.deleted_at is null and s.ativo and s.totp_confirmado_em is not null
                    and (s.bloqueado_ate is null or s.bloqueado_ate <= now())) then
    return;
  end if;
  insert into plataforma.super_admin_sessao (super_admin_id, criada_em, ultimo_uso_em, expira_em)
  values (v_sa, now(), now(), v_expira)
  returning id into v_sid;
  perform plataforma.sa_registrar_auditoria(v_sa, v_sid, null, 'sa.sessao.aberta', '{}'::jsonb);
  sessao_id := v_sid;
  super_admin_id := v_sa;
  expira_em := v_expira;
  return next;
end
$$;

create function plataforma.sa_sessao_valida(p_sid uuid)
  returns table (super_admin_id uuid, expira_em timestamptz)
  language sql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    update plataforma.super_admin_sessao x
       set ultimo_uso_em = now()
      from plataforma.super_admin s
     where x.id = p_sid and s.id = x.super_admin_id and x.revogada_em is null and x.deleted_at is null and x.expira_em > now()
       and s.deleted_at is null and s.ativo and s.totp_confirmado_em is not null
    returning x.super_admin_id, x.expira_em
  $$;

create function plataforma.sa_revogar(p_sid uuid)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_sa uuid;
begin
  update plataforma.super_admin_sessao x set revogada_em = now()
   where x.id = p_sid and x.revogada_em is null
  returning x.super_admin_id into v_sa;
  if v_sa is null then
    return false;
  end if;
  perform plataforma.sa_registrar_auditoria(v_sa, p_sid, null, 'sa.sessao.revogada', '{}'::jsonb);
  return true;
end
$$;

-- 7. Auditoria gravada pela API e pelo Core ------------------------------------------------------------------------------
create function plataforma.sa_auditar(p jsonb)
  returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_acao text;
  v_metodo text;
  v_rota text;
  v_status integer;
  v_ip text;
  v_detalhes jsonb;
  v_id uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sa_auditar: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  v_acao := p ->> 'acao';
  if v_acao is null or v_acao !~ '^[a-z][a-z0-9_.]{0,79}$' then
    raise exception 'sa_auditar: acao inválida (minúsculas, dígitos, ponto e sublinhado; até 80)' using errcode = '22023';
  end if;
  v_metodo := upper(nullif(btrim(p ->> 'metodo'), ''));
  if v_metodo is not null and v_metodo !~ '^[A-Z]{3,10}$' then
    raise exception 'sa_auditar: metodo inválido' using errcode = '22023';
  end if;
  -- rota é o MODELO; se vier com query, a query cai (nunca vai valor de filtro para a auditoria)
  v_rota := left(nullif(split_part(p ->> 'rota', '?', 1), ''), 300);
  v_status := case when jsonb_typeof(p -> 'status') = 'number' and (p ->> 'status') ~ '^[1-5][0-9]{2}$' then (p ->> 'status')::integer end;
  -- só o prefixo (/24 ou /48); outro formato não é gravado
  v_ip := p ->> 'ip_prefixo';
  if v_ip is not null and v_ip !~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.0/24$' and v_ip !~ '^[0-9a-f:]{1,40}::/48$' then
    v_ip := null;
  end if;
  v_detalhes := coalesce(p -> 'detalhes', '{}'::jsonb);
  if jsonb_typeof(v_detalhes) <> 'object' or octet_length(v_detalhes::text) > 4096 then
    raise exception 'sa_auditar: detalhes deve ser um objeto JSON de até 4 KB' using errcode = '22023';
  end if;
  insert into plataforma.auditoria_plataforma
    (super_admin_id, sessao_id, tenant_alvo_id, acao, metodo, rota, status, request_id, ip_prefixo, detalhes)
  values (nullif(p ->> 'super_admin_id', '')::uuid, nullif(p ->> 'sessao_id', '')::uuid, nullif(p ->> 'tenant_id', '')::uuid,
          v_acao, v_metodo, v_rota, v_status, left(nullif(p ->> 'request_id', ''), 100), v_ip, v_detalhes)
  returning id into v_id;
  return v_id;
end
$$;

-- 8. Tenants pelo portal (sessão viva conferida em cada chamada) ---------------------------------------------------------
create function plataforma.sa_listar_tenants(p_sid uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if not exists (select 1 from plataforma.sa_sessao_valida(p_sid)) then
    raise exception 'sa_listar_tenants: sessão do super-admin inválida' using errcode = '28000';
  end if;
  -- módulos: só os vivos e ativos, e só os do contrato (MODULOS de packages/platform-sdk/src/nomes.ts; teste estático)
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'codigo', t.codigo, 'razao_social', t.nome, 'cnpj', t.documento, 'fuso', t.fuso, 'status', t.status,
             'criada_em', to_char(t.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'modulos', coalesce((
               select jsonb_agg(jsonb_build_object('modulo', tm.modulo, 'licencas', tm.licencas) order by tm.modulo)
                 from plataforma.tenant_modulo tm
                where tm.tenant_id = t.id and tm.deleted_at is null and tm.ativo
                  and tm.modulo = any (array['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'])
             ), '[]'::jsonb)
           ) order by t.nome, t.id)
      from plataforma.tenant t
     where t.deleted_at is null
  ), '[]'::jsonb));
end
$$;

create function plataforma.sa_tenant_ativo(p_sid uuid, p_tenant uuid)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if not exists (select 1 from plataforma.sa_sessao_valida(p_sid)) then
    return false;
  end if;
  return exists (select 1 from plataforma.tenant t where t.id = p_tenant and t.status = 'ativo' and t.deleted_at is null);
end
$$;

-- 9. provisionar_tenant (0029) com sem_admin, parametros e ator_id -------------------------------------------------------
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

create function plataforma.sa_provisionar_tenant(p_sid uuid, p jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_sa uuid;
  v_r jsonb;
begin
  select v.super_admin_id into v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_sa is null then
    raise exception 'sa_provisionar_tenant: sessão do super-admin inválida' using errcode = '28000';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sa_provisionar_tenant: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  -- o portal nunca cria admin nem mexe em senha (o admin do cliente vem na Equipe, com convite)
  if p ? 'admin' or p ? 'redefinir_senha' then
    raise exception 'sa_provisionar_tenant: o portal não aceita admin nem redefinir_senha' using errcode = '22023';
  end if;
  v_r := plataforma.provisionar_tenant((p - 'ator_id') || jsonb_build_object('sem_admin', true, 'ator_id', v_sa));
  perform plataforma.sa_registrar_auditoria(v_sa, p_sid, (v_r ->> 'tenant_id')::uuid, 'sa.tenant.provisionar',
    jsonb_build_object('resultado', v_r -> 'resultado', 'modulos_adicionados', v_r -> 'modulos_adicionados',
                       'parametros_gravados', v_r -> 'parametros_gravados'));
  return v_r;
end
$$;

-- 10. EXECUTE: só o macuxi_app (nunca PUBLIC nem o macuxi_worker) ---------------------------------------------------------
revoke all on function plataforma.sa_existe() from public;
grant execute on function plataforma.sa_existe() to macuxi_app;
revoke all on function plataforma.sa_criar_primeiro(text, text, text) from public;
grant execute on function plataforma.sa_criar_primeiro(text, text, text) to macuxi_app;
revoke all on function plataforma.sa_para_login(text) from public;
grant execute on function plataforma.sa_para_login(text) to macuxi_app;
revoke all on function plataforma.sa_por_id(uuid) from public;
grant execute on function plataforma.sa_por_id(uuid) to macuxi_app;
revoke all on function plataforma.sa_registrar_falha(uuid) from public;
grant execute on function plataforma.sa_registrar_falha(uuid) to macuxi_app;
revoke all on function plataforma.sa_registrar_sucesso(uuid) from public;
grant execute on function plataforma.sa_registrar_sucesso(uuid) to macuxi_app;
revoke all on function plataforma.sa_gravar_totp_pendente(uuid, text) from public;
grant execute on function plataforma.sa_gravar_totp_pendente(uuid, text) to macuxi_app;
revoke all on function plataforma.sa_confirmar_totp(uuid, bigint, text[]) from public;
grant execute on function plataforma.sa_confirmar_totp(uuid, bigint, text[]) to macuxi_app;
revoke all on function plataforma.sa_marcar_passo(uuid, bigint) from public;
grant execute on function plataforma.sa_marcar_passo(uuid, bigint) to macuxi_app;
revoke all on function plataforma.sa_usar_recuperacao(uuid, text) from public;
grant execute on function plataforma.sa_usar_recuperacao(uuid, text) to macuxi_app;
revoke all on function plataforma.sa_regerar_recuperacao(uuid, text[]) from public;
grant execute on function plataforma.sa_regerar_recuperacao(uuid, text[]) to macuxi_app;
revoke all on function plataforma.sa_abrir_desafio(uuid, text) from public;
grant execute on function plataforma.sa_abrir_desafio(uuid, text) to macuxi_app;
revoke all on function plataforma.sa_ver_desafio(text) from public;
grant execute on function plataforma.sa_ver_desafio(text) to macuxi_app;
revoke all on function plataforma.sa_abrir_sessao(text) from public;
grant execute on function plataforma.sa_abrir_sessao(text) to macuxi_app;
revoke all on function plataforma.sa_sessao_valida(uuid) from public;
grant execute on function plataforma.sa_sessao_valida(uuid) to macuxi_app;
revoke all on function plataforma.sa_revogar(uuid) from public;
grant execute on function plataforma.sa_revogar(uuid) to macuxi_app;
revoke all on function plataforma.sa_auditar(jsonb) from public;
grant execute on function plataforma.sa_auditar(jsonb) to macuxi_app;
revoke all on function plataforma.sa_listar_tenants(uuid) from public;
grant execute on function plataforma.sa_listar_tenants(uuid) to macuxi_app;
revoke all on function plataforma.sa_tenant_ativo(uuid, uuid) from public;
grant execute on function plataforma.sa_tenant_ativo(uuid, uuid) to macuxi_app;
revoke all on function plataforma.sa_provisionar_tenant(uuid, jsonb) from public;
grant execute on function plataforma.sa_provisionar_tenant(uuid, jsonb) to macuxi_app;

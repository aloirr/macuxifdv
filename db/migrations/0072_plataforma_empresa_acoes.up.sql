-- 0072_plataforma_empresa_acoes (up) — Inativar, Backup e Excluir a empresa pelo portal (ADR 0052; desenho
-- docs/desenho/empresa-acoes.md §4 e §7; pedido do dono do produto R-20261114-195600-alexandre; regras aprovadas em
-- R-20261114-202000-alexandre: inativa = status suspenso com data e motivo; excluir só inativa com backup concluído depois
-- da inativação, em até 7 dias; backup guardado 90 dias depois da exclusão; código da licença nunca reaproveitado).
-- Contrato: packages/platform-sdk/src/empresa-acoes.ts (RN-PLA-07..11). Dicionário: docs/banco/plataforma.md ("Ações da
-- empresa (0072)") e docs/banco/rls.md. Teste: db/testes/empresa-acoes.db.test.ts (estático na sessão; banco e up/down no CI).
-- Migração em cima da 0071. Papéis da ADR 0024 (sem superusuário): as funções SECURITY DEFINER têm o migrador como dono e
-- enxergam os tenants pela política manutencao (0031); a API só executa as sa_* (macuxi_portal) e o worker só as dele
-- (macuxi_worker). Nenhum papel da aplicação ganha grant de tabela.
--
-- 1. plataforma.tenant ganha inativada_em (timestamptz) e motivo_inativacao (lista MOTIVOS_INATIVACAO do SDK; sem texto
--    livre; OPCIONAL e nulo, ADR 0052 §1.1: a tela não pede motivo e a API inativa sem ele). CHECK tenant_inativacao_coerente:
--    ativo <=> sem data (suspenso e encerrado sempre com a data); motivo só fora de ativo, e pode ser nulo.
--    Gatilho tenant_inativacao_preencher (BEFORE): status ativo limpa data e motivo; status fora de ativo sem data ganha now()
--    (quem ainda faz "update status = 'suspenso'" direto não quebra). O gatilho não inventa motivo. As linhas fora de ativo
--    de antes ganham só a data (do updated_at); o motivo fica nulo.
-- 2. Tabelas que SOBREVIVEM à exclusão da empresa (exceção da regra 5, como a auditoria_plataforma): empresa_id SEM FK e sem
--    tenant_id, então a plataforma.excluir_tenant não as toca. RLS ligado e FORÇADO, só a política manutencao, nenhum grant
--    (app, worker e portal: 42501); leitura e escrita só pelas funções abaixo.
--    - plataforma.backup_empresa: um job de backup por linha (id do portal = chave de idempotência), em_andamento -> pronto |
--      falhou (-> apagado na retenção); um em andamento por empresa (backup_empresa_um_em_andamento_uk). consistente = pedido
--      com a empresa inativa e ela inativa até o fim (RN-PLA-08). bloqueado_ate = concessão do worker (10 min, renovada a
--      cada página e parte).
--    - plataforma.backup_empresa_parte: parte confirmada (tabela, linhas, bytes, sha256), única por (backup, tabela): o
--      worker retoma da última confirmada.
--    - plataforma.exclusao_empresa: o job da exclusão (id do portal), etapa banco -> arquivos -> fim; uma em andamento por
--      empresa; contagem por tabela (jsonb) do que a excluir_tenant apagou.
--    - plataforma.empresa_excluida: registro da empresa excluída (id antigo, código, CNPJ, razão social, excluida_em, backup,
--      exclusão, super-admin). Código único (lower) entre as excluídas.
-- 3. Código da licença nunca reaproveitado (RN-PLA-10): gatilho tenant_codigo_nao_reaproveitado (BEFORE INSERT/UPDATE OF
--    codigo em plataforma.tenant) recusa com 23505 o código de uma empresa excluída com OUTRO id (a restauração volta com o
--    mesmo id e o mesmo código). Vale para provisionar_tenant, sa_provisionar_tenant, atribuir_codigo_licenca e qualquer
--    insert. plataforma.sortear_codigo_licenca (create or replace, mesma assinatura e ACL da 0068) não sorteia código de
--    empresa excluída.
-- 4. Despachante e e-mail pulam a empresa inativa (RN-PLA-07): plataforma.tenant_esta_ativo(uuid) (SECURITY DEFINER, só o
--    macuxi_worker executa) e as políticas do worker passam a usá-la: despacho_outbox (plataforma.evento) só vê evento de
--    tenant ativo ou plataforma.tenant.* (a exceção do ADR); despacho_email (plataforma.email_saida) só vê e-mail de tenant
--    ativo. As consultas do despachante e do worker de e-mail não mudam: as linhas da empresa inativa ficam esperando e voltam
--    ao reativar. O agendador já para (tenants_ativos, 0027).
-- 5. Funções do portal (SECURITY DEFINER; EXECUTE só ao macuxi_portal; sessão inválida = 28000, admin do cliente = 42501;
--    erros com o código do contrato no hint): sa_inativar_tenant, sa_reativar_tenant, sa_pedir_backup, sa_listar_backups,
--    sa_pedir_exclusao, sa_ler_exclusao, sa_reautenticar e sa_acoes_das_empresas (o bloco `acoes` da lista; a
--    sa_listar_tenants não muda). O portal passa a executar 25 sa_*.
-- 6. Funções do worker (SECURITY DEFINER; EXECUTE só ao macuxi_worker; o tenant sai sempre da linha do job, nunca de
--    argumento): pegar_backup, tabelas_do_backup, exportar_backup_pagina, registrar_parte_backup, fechar_backup,
--    backups_vencidos, marcar_backup_apagado, pegar_exclusao, executar_exclusao e fechar_exclusao (mais a tenant_esta_ativo).
-- 7. Internas (SECURITY INVOKER, sem EXECUTE para ninguém além do dono): instante_iso, backup_empresa_json,
--    exclusao_empresa_json, exclusao_bloqueada (a conferirExclusao do SDK no banco) e ordem_do_backup (tabelas com tenant_id
--    em ordem de FK, mães antes das filhas, com a chave primária e as colunas adiadas da restauração: FK anulável que quebra
--    ciclo e autorreferência anulável), mais as 2 funções de gatilho.
--
-- Caminho de volta: 0072_plataforma_empresa_acoes.down.sql (políticas do worker com using (true), sortear_codigo_licenca com o
-- texto da 0068, apaga funções, gatilhos, as 4 tabelas e as 2 colunas). PERDE os registros de backup, exclusão e empresa
-- excluída (os arquivos no bucket ficam): exporte antes "select * from plataforma.empresa_excluida" se houver exclusão feita.
-- Desligue antes MACUXI_EMPRESA_ACOES na API e o worker de backup (as rotas e o worker chamam funções que somem).

-- 1. Inativação na plataforma.tenant ---------------------------------------------------------------------------------------------
alter table plataforma.tenant add column inativada_em timestamptz;
alter table plataforma.tenant add column motivo_inativacao text;
update plataforma.tenant set inativada_em = updated_at where status <> 'ativo';
alter table plataforma.tenant add constraint tenant_motivo_inativacao_valido
  check (motivo_inativacao is null
         or motivo_inativacao in ('inadimplencia', 'pedido_do_cliente', 'fim_do_contrato', 'implantacao_cancelada', 'outro'));
alter table plataforma.tenant add constraint tenant_inativacao_coerente
  check ((status = 'ativo') = (inativada_em is null) and (status <> 'ativo' or motivo_inativacao is null));

create function plataforma.tenant_inativacao_preencher()
  returns trigger
  language plpgsql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if new.status = 'ativo' then
    new.inativada_em := null;
    new.motivo_inativacao := null;
  elsif new.inativada_em is null then
    new.inativada_em := now();
  end if;
  return new;
end
$$;
revoke all on function plataforma.tenant_inativacao_preencher() from public;
create trigger tenant_inativacao_preencher before insert or update of status, inativada_em, motivo_inativacao on plataforma.tenant
  for each row execute function plataforma.tenant_inativacao_preencher();

-- 2. Tabelas que sobrevivem à exclusão ----------------------------------------------------------------------------------------
create table plataforma.backup_empresa (
  id              uuid primary key,
  empresa_id      uuid not null,
  codigo          text not null,
  situacao        text not null default 'em_andamento',
  consistente     boolean not null default false,
  pedido_em       timestamptz not null default now(),
  iniciado_em     timestamptz,
  concluido_em    timestamptz,
  expira_em       timestamptz,
  progresso_pct   integer not null default 0,
  tamanho_bytes   bigint,
  tabelas         integer,
  linhas          bigint,
  arquivos        integer,
  erro_codigo     text,
  bloqueado_ate   timestamptz,
  super_admin_id  uuid,
  sessao_id       uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint backup_empresa_situacao_valida check (situacao in ('em_andamento', 'pronto', 'falhou', 'apagado')),
  constraint backup_empresa_progresso_faixa check (progresso_pct between 0 and 100),
  constraint backup_empresa_contagens_positivas check ((tamanho_bytes is null or tamanho_bytes >= 0) and (tabelas is null or tabelas >= 0)
    and (linhas is null or linhas >= 0) and (arquivos is null or arquivos >= 0)),
  constraint backup_empresa_erro_formato check (erro_codigo is null or erro_codigo ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  constraint backup_empresa_erro_so_na_falha check ((situacao = 'falhou') = (erro_codigo is not null)),
  constraint backup_empresa_pronto_completo check (situacao <> 'pronto'
    or (concluido_em is not null and tamanho_bytes is not null and progresso_pct = 100)),
  constraint backup_empresa_andamento_sem_fim check (situacao <> 'em_andamento' or concluido_em is null)
);
create unique index backup_empresa_um_em_andamento_uk on plataforma.backup_empresa (empresa_id) where situacao = 'em_andamento';
create index backup_empresa_empresa_ix on plataforma.backup_empresa (empresa_id, pedido_em desc, id);
create index backup_empresa_fila_ix on plataforma.backup_empresa (pedido_em, id) where situacao = 'em_andamento';
create index backup_empresa_expira_ix on plataforma.backup_empresa (expira_em) where situacao in ('pronto', 'falhou');
create trigger backup_empresa_updated_at before update on plataforma.backup_empresa
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.backup_empresa enable row level security;
alter table plataforma.backup_empresa force row level security;
create policy manutencao on plataforma.backup_empresa for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.backup_empresa from public, macuxi_app, macuxi_worker;

create table plataforma.backup_empresa_parte (
  id              uuid primary key default gen_random_uuid(),
  backup_id       uuid not null references plataforma.backup_empresa (id) on delete cascade,
  tabela          text not null,
  ordem           integer not null,
  linhas          bigint not null,
  bytes           bigint not null,
  sha256          text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint backup_empresa_parte_tabela_formato check (tabela ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$'),
  constraint backup_empresa_parte_contagens_positivas check (ordem >= 1 and linhas >= 0 and bytes >= 0),
  constraint backup_empresa_parte_sha256_formato check (sha256 ~ '^[0-9a-f]{64}$')
);
create unique index backup_empresa_parte_tabela_uk on plataforma.backup_empresa_parte (backup_id, tabela);
create trigger backup_empresa_parte_updated_at before update on plataforma.backup_empresa_parte
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.backup_empresa_parte enable row level security;
alter table plataforma.backup_empresa_parte force row level security;
create policy manutencao on plataforma.backup_empresa_parte for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.backup_empresa_parte from public, macuxi_app, macuxi_worker;

create table plataforma.exclusao_empresa (
  id                 uuid primary key,
  empresa_id         uuid not null,
  codigo             text not null,
  backup_id          uuid not null references plataforma.backup_empresa (id),
  situacao           text not null default 'em_andamento',
  etapa              text not null default 'banco',
  pedida_em          timestamptz not null default now(),
  concluida_em       timestamptz,
  linhas_apagadas    bigint,
  arquivos_apagados  bigint,
  contagem           jsonb,
  erro_codigo        text,
  bloqueado_ate      timestamptz,
  super_admin_id     uuid,
  sessao_id          uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  external_id        text,
  constraint exclusao_empresa_situacao_valida check (situacao in ('em_andamento', 'concluida', 'falhou')),
  constraint exclusao_empresa_etapa_valida check (etapa in ('banco', 'arquivos', 'fim')),
  constraint exclusao_empresa_erro_formato check (erro_codigo is null or erro_codigo ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  constraint exclusao_empresa_erro_so_na_falha check ((situacao = 'falhou') = (erro_codigo is not null)),
  constraint exclusao_empresa_concluida_completa check (situacao <> 'concluida' or (concluida_em is not null and etapa = 'fim')),
  constraint exclusao_empresa_contagens_positivas check ((linhas_apagadas is null or linhas_apagadas >= 0)
    and (arquivos_apagados is null or arquivos_apagados >= 0)),
  constraint exclusao_empresa_contagem_objeto check (contagem is null or jsonb_typeof(contagem) = 'object')
);
create unique index exclusao_empresa_em_andamento_uk on plataforma.exclusao_empresa (empresa_id) where situacao = 'em_andamento';
create index exclusao_empresa_empresa_ix on plataforma.exclusao_empresa (empresa_id, pedida_em desc, id);
create index exclusao_empresa_fila_ix on plataforma.exclusao_empresa (pedida_em, id) where situacao = 'em_andamento';
create index exclusao_empresa_backup_ix on plataforma.exclusao_empresa (backup_id);
create trigger exclusao_empresa_updated_at before update on plataforma.exclusao_empresa
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.exclusao_empresa enable row level security;
alter table plataforma.exclusao_empresa force row level security;
create policy manutencao on plataforma.exclusao_empresa for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.exclusao_empresa from public, macuxi_app, macuxi_worker;

create table plataforma.empresa_excluida (
  id              uuid primary key,
  codigo          text not null,
  documento       text,
  razao_social    text not null,
  excluida_em     timestamptz not null default now(),
  backup_id       uuid not null references plataforma.backup_empresa (id),
  exclusao_id     uuid not null references plataforma.exclusao_empresa (id),
  super_admin_id  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text
);
create unique index empresa_excluida_codigo_uk on plataforma.empresa_excluida (lower(codigo));
create index empresa_excluida_backup_ix on plataforma.empresa_excluida (backup_id);
create index empresa_excluida_exclusao_ix on plataforma.empresa_excluida (exclusao_id);
create trigger empresa_excluida_updated_at before update on plataforma.empresa_excluida
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.empresa_excluida enable row level security;
alter table plataforma.empresa_excluida force row level security;
create policy manutencao on plataforma.empresa_excluida for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.empresa_excluida from public, macuxi_app, macuxi_worker;

-- 3. Código da licença nunca reaproveitado (RN-PLA-10) --------------------------------------------------------------------------
create function plataforma.tenant_codigo_nao_reaproveitado()
  returns trigger
  language plpgsql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if exists (select 1 from plataforma.empresa_excluida x where lower(x.codigo) = lower(new.codigo) and x.id <> new.id) then
    raise exception 'tenant: o código % é de uma empresa excluída e não é reaproveitado (RN-PLA-10)', new.codigo
      using errcode = '23505';
  end if;
  return new;
end
$$;
revoke all on function plataforma.tenant_codigo_nao_reaproveitado() from public;
create trigger tenant_codigo_nao_reaproveitado before insert or update of codigo on plataforma.tenant
  for each row execute function plataforma.tenant_codigo_nao_reaproveitado();

create or replace function plataforma.sortear_codigo_licenca(p_uf text)
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
    -- 0072 (RN-PLA-10): nem de tenant vivo nem de empresa excluída
    if not exists (select 1 from plataforma.tenant t where lower(t.codigo) = lower(v_codigo))
       and not exists (select 1 from plataforma.empresa_excluida x where lower(x.codigo) = lower(v_codigo)) then
      return v_codigo;
    end if;
  end loop;
  -- sem sorte nos sorteios (UF quase cheia): um dos números livres, sorteado
  select v_uf || lpad(n::text, 4, '0') into v_codigo
    from generate_series(0, 9999) n
   where not exists (select 1 from plataforma.tenant t where lower(t.codigo) = lower(v_uf || lpad(n::text, 4, '0')))
     and not exists (select 1 from plataforma.empresa_excluida x where lower(x.codigo) = lower(v_uf || lpad(n::text, 4, '0')))
   order by random()
   limit 1;
  if v_codigo is null then
    raise exception 'sortear_codigo_licenca: não há código livre para a UF % (os 10.000 números, de %0000 a %9999, estão em uso)',
      v_uf, v_uf, v_uf using errcode = '54000';
  end if;
  return v_codigo;
end
$$;

-- 4. Despachante e e-mail pulam a empresa inativa (RN-PLA-07) ------------------------------------------------------------------
create function plataforma.tenant_esta_ativo(p_tenant uuid)
  returns boolean
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select exists (select 1 from plataforma.tenant t where t.id = p_tenant and t.status = 'ativo' and t.deleted_at is null)
  $$;
revoke all on function plataforma.tenant_esta_ativo(uuid) from public;
grant execute on function plataforma.tenant_esta_ativo(uuid) to macuxi_worker;

alter policy despacho_outbox on plataforma.evento
  using (nome like 'plataforma.tenant.%' or plataforma.tenant_esta_ativo(tenant_id));
alter policy despacho_email on plataforma.email_saida
  using (plataforma.tenant_esta_ativo(tenant_id));

-- 7. Internas (antes das sa_* e do worker, que as chamam) -----------------------------------------------------------------------
create function plataforma.instante_iso(p timestamptz)
  returns text
  language sql stable security invoker
  set search_path = pg_catalog, pg_temp
  as $$
    select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  $$;
revoke all on function plataforma.instante_iso(timestamptz) from public;

-- BackupEmpresaSchema do SDK (tenant_id = empresa_id)
create function plataforma.backup_empresa_json(b plataforma.backup_empresa)
  returns jsonb
  language sql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select jsonb_build_object(
      'id', b.id, 'tenant_id', b.empresa_id, 'situacao', b.situacao, 'consistente', b.consistente,
      'pedido_em', plataforma.instante_iso(b.pedido_em), 'iniciado_em', plataforma.instante_iso(b.iniciado_em),
      'concluido_em', plataforma.instante_iso(b.concluido_em), 'expira_em', plataforma.instante_iso(b.expira_em),
      'progresso_pct', b.progresso_pct, 'tamanho_bytes', b.tamanho_bytes, 'tabelas', b.tabelas, 'linhas', b.linhas,
      'arquivos', b.arquivos, 'erro_codigo', b.erro_codigo)
  $$;
revoke all on function plataforma.backup_empresa_json(plataforma.backup_empresa) from public;

-- ExclusaoEmpresaSchema do SDK (tenant_id = empresa_id)
create function plataforma.exclusao_empresa_json(x plataforma.exclusao_empresa)
  returns jsonb
  language sql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select jsonb_build_object(
      'id', x.id, 'tenant_id', x.empresa_id, 'codigo', x.codigo, 'backup_id', x.backup_id, 'situacao', x.situacao,
      'etapa', x.etapa, 'pedida_em', plataforma.instante_iso(x.pedida_em), 'concluida_em', plataforma.instante_iso(x.concluida_em),
      'linhas_apagadas', x.linhas_apagadas, 'arquivos_apagados', x.arquivos_apagados, 'erro_codigo', x.erro_codigo)
  $$;
revoke all on function plataforma.exclusao_empresa_json(plataforma.exclusao_empresa) from public;

-- RN-PLA-09: a conferirExclusao do SDK, na mesma ordem (null = liberada). p_exclusao = a exclusão que está sendo executada
-- (não conta como "outra em andamento").
create function plataforma.exclusao_bloqueada(p_tenant uuid, p_backup uuid, p_exclusao uuid)
  returns text
  language plpgsql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_t record;
  v_b record;
begin
  select t.status, t.inativada_em into v_t from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null;
  if not found then
    return 'EMPRESA_NAO_ENCONTRADA';
  end if;
  if v_t.status = 'encerrado'
     or exists (select 1 from plataforma.exclusao_empresa x
                 where x.empresa_id = p_tenant and x.situacao = 'em_andamento' and x.id is distinct from p_exclusao) then
    return 'EXCLUSAO_EM_ANDAMENTO';
  end if;
  if v_t.status <> 'suspenso' or v_t.inativada_em is null then
    return 'EXCLUSAO_EMPRESA_ATIVA';
  end if;
  select b.situacao, b.consistente, b.iniciado_em, b.concluido_em into v_b
    from plataforma.backup_empresa b
   where b.id = p_backup and b.empresa_id = p_tenant;
  if not found or v_b.situacao <> 'pronto' or v_b.concluido_em is null then
    return 'EXCLUSAO_SEM_BACKUP';
  end if;
  if not v_b.consistente or v_b.iniciado_em is null or v_b.iniciado_em < v_t.inativada_em then
    return 'EXCLUSAO_BACKUP_ANTES_DA_INATIVACAO';
  end if;
  if now() - v_b.concluido_em > interval '7 days' then
    return 'EXCLUSAO_BACKUP_VENCIDO';
  end if;
  return null;
end
$$;
revoke all on function plataforma.exclusao_bloqueada(uuid, uuid, uuid) from public;

-- Tabelas do backup, em ordem de restauração: plataforma.tenant (ordem 1) e toda tabela com tenant_id (o mesmo catálogo da
-- excluir_tenant, 0032), mães antes das filhas. Ciclo (hoje core.usuario <-> core.equipe): a FK anulável de nome menor sai
-- do grafo e as colunas dela vão para "adiar" da filha (a restauração grava nulo e completa no fim). Autorreferência anulável
-- também vai para "adiar". chave = colunas da chave primária (keyset da exportação), na ordem do índice.
create function plataforma.ordem_do_backup()
  returns table (ordem integer, tabela text, chave text[], adiar text[])
  language plpgsql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_tabelas oid[];
  v_restantes oid[];
  v_prontas oid[];
  v_filha oid[];
  v_mae oid[];
  v_fk text[];
  v_cols jsonb[];
  v_ativa boolean[];
  v_adiar jsonb := '{}'::jsonb;
  v_rel oid;
  v_i integer;
  v_n integer := 1;
begin
  ordem := 1; tabela := 'plataforma.tenant'; chave := array['id']; adiar := '{}'::text[];
  return next;

  select coalesce(array_agg(c.oid order by ns.nspname, c.relname), '{}') into v_tabelas
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
   where c.relkind in ('r', 'p') and not c.relispartition
     and ns.nspname not in ('pg_catalog', 'information_schema') and ns.nspname not like 'pg\_%';

  -- FKs entre as tabelas; v_cols = colunas da FK menos tenant_id, só se todas aceitam nulo (senão null)
  select coalesce(array_agg(k.conrelid order by k.conname, k.oid), '{}'),
         coalesce(array_agg(k.confrelid order by k.conname, k.oid), '{}'),
         coalesce(array_agg(k.conname::text order by k.conname, k.oid), '{}'),
         coalesce(array_agg(k.cols order by k.conname, k.oid), '{}'),
         coalesce(array_agg(true order by k.conname, k.oid), '{}')
    into v_filha, v_mae, v_fk, v_cols, v_ativa
    from (
      select con.oid, con.conname, con.conrelid, con.confrelid,
             (select case when count(*) > 0 and bool_and(not at.attnotnull)
                          then jsonb_agg(at.attname::text order by at.attnum) end
                from unnest(con.conkey) as kk(n)
                join pg_attribute at on at.attrelid = con.conrelid and at.attnum = kk.n
               where at.attname <> 'tenant_id') as cols
        from pg_constraint con
       where con.contype = 'f' and con.conparentid = 0
         and con.conrelid = any (v_tabelas) and con.confrelid = any (v_tabelas)
    ) k;

  -- autorreferência anulável: adiada; depois sai do grafo (uma tabela não espera por ela mesma)
  for v_i in select i from generate_subscripts(v_fk, 1) as i loop
    if v_filha[v_i] = v_mae[v_i] then
      if v_cols[v_i] is not null then
        v_adiar := jsonb_set(v_adiar, array[v_filha[v_i]::text],
                             coalesce(v_adiar -> (v_filha[v_i]::text), '[]'::jsonb) || v_cols[v_i]);
      end if;
      v_ativa[v_i] := false;
    end if;
  end loop;

  v_restantes := v_tabelas;
  while cardinality(v_restantes) > 0 loop
    -- prontas: nenhuma mãe ativa ainda por gravar
    select array_agg(t.rel order by ns.nspname, c.relname) into v_prontas
      from unnest(v_restantes) as t(rel)
      join pg_class c on c.oid = t.rel
      join pg_namespace ns on ns.oid = c.relnamespace
     where not exists (
       select 1 from generate_subscripts(v_filha, 1) as i
        where v_ativa[i] and v_filha[i] = t.rel and v_mae[i] = any (v_restantes));

    if v_prontas is not null then
      foreach v_rel in array v_prontas loop
        v_n := v_n + 1;
        ordem := v_n;
        select ns.nspname || '.' || c.relname into tabela
          from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where c.oid = v_rel;
        select array_agg(a.attname::text order by k.n) into chave
          from pg_index x
          cross join lateral unnest(x.indkey::int2[]) with ordinality as k(attnum, n)
          join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum
         where x.indrelid = v_rel and x.indisprimary;
        select coalesce(array_agg(distinct e.v order by e.v), '{}'::text[]) into adiar
          from jsonb_array_elements_text(coalesce(v_adiar -> (v_rel::text), '[]'::jsonb)) as e(v);
        return next;
      end loop;
      v_restantes := array(select t.rel from unnest(v_restantes) as t(rel) where t.rel <> all (v_prontas));
      continue;
    end if;

    -- ciclo: a FK anulável de nome menor entre as restantes sai do grafo; as colunas dela são adiadas na filha
    v_i := null;
    select i into v_i
      from generate_subscripts(v_fk, 1) as i
     where v_ativa[i] and v_cols[i] is not null
       and v_filha[i] = any (v_restantes) and v_mae[i] = any (v_restantes)
     order by v_fk[i], i
     limit 1;
    if v_i is null then
      raise exception 'ordem_do_backup: ciclo de FK sem coluna anulável entre %',
        (select string_agg(t.rel::regclass::text, ', ' order by t.rel::regclass::text) from unnest(v_restantes) as t(rel))
        using errcode = '55000';
    end if;
    v_adiar := jsonb_set(v_adiar, array[v_filha[v_i]::text],
                         coalesce(v_adiar -> (v_filha[v_i]::text), '[]'::jsonb) || v_cols[v_i]);
    v_ativa[v_i] := false;
  end loop;
end
$$;
revoke all on function plataforma.ordem_do_backup() from public;

-- 5. Funções do portal (só super-admin) ------------------------------------------------------------------------------------------
-- RN-PLA-07: inativar. Idempotente (já inativa = sem_mudanca, sem evento). Empresa em exclusão = 55000 EXCLUSAO_EM_ANDAMENTO.
-- p_motivo opcional (ADR 0052 §1.1): nulo inativa sem motivo; quando vem, precisa estar na lista MOTIVOS_INATIVACAO.
create function plataforma.sa_inativar_tenant(p_sid uuid, p_tenant uuid, p_motivo text)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_t record;
  v_agora timestamptz := now();
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_inativar_tenant: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_inativar_tenant: só o super-admin' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'sa_inativar_tenant: tenant obrigatório' using errcode = '22023';
  end if;
  if p_motivo is not null and p_motivo not in ('inadimplencia', 'pedido_do_cliente', 'fim_do_contrato', 'implantacao_cancelada', 'outro') then
    raise exception 'sa_inativar_tenant: motivo fora da lista' using errcode = '22023';
  end if;
  select t.status, t.inativada_em, t.motivo_inativacao into v_t
    from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null for update;
  if not found then
    raise exception 'sa_inativar_tenant: empresa não encontrada' using errcode = 'P0002', hint = 'EMPRESA_NAO_ENCONTRADA';
  end if;
  if v_t.status = 'encerrado'
     or exists (select 1 from plataforma.exclusao_empresa x where x.empresa_id = p_tenant and x.situacao = 'em_andamento') then
    raise exception 'sa_inativar_tenant: há exclusão em andamento' using errcode = '55000', hint = 'EXCLUSAO_EM_ANDAMENTO';
  end if;
  if v_t.status = 'suspenso' then
    return jsonb_build_object('tenant_id', p_tenant, 'status', 'suspenso', 'inativada_em', plataforma.instante_iso(v_t.inativada_em),
                              'motivo', v_t.motivo_inativacao, 'resultado', 'sem_mudanca');
  end if;
  update plataforma.tenant set status = 'suspenso', inativada_em = v_agora, motivo_inativacao = p_motivo where id = p_tenant;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'tenant.inativado',
    jsonb_build_object('motivo', p_motivo, 'antes', v_t.status, 'depois', 'suspenso'));
  insert into plataforma.evento (tenant_id, nome, modulo, agregado_id, payload, ocorrido_em)
  values (p_tenant, 'plataforma.tenant.inativado@1', 'plataforma', p_tenant,
          jsonb_build_object('tenant_id', p_tenant, 'motivo', p_motivo, 'inativada_em', plataforma.instante_iso(v_agora)), v_agora);
  return jsonb_build_object('tenant_id', p_tenant, 'status', 'suspenso', 'inativada_em', plataforma.instante_iso(v_agora),
                            'motivo', p_motivo, 'resultado', 'alterado');
end
$$;
revoke all on function plataforma.sa_inativar_tenant(uuid, uuid, text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_inativar_tenant(uuid, uuid, text) to macuxi_portal;

-- RN-PLA-07: reativar. Idempotente. O backup em andamento deixa de ser consistente (RN-PLA-08).
create function plataforma.sa_reativar_tenant(p_sid uuid, p_tenant uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_t record;
  v_agora timestamptz := now();
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_reativar_tenant: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_reativar_tenant: só o super-admin' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'sa_reativar_tenant: tenant obrigatório' using errcode = '22023';
  end if;
  select t.status, t.inativada_em, t.motivo_inativacao into v_t
    from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null for update;
  if not found then
    raise exception 'sa_reativar_tenant: empresa não encontrada' using errcode = 'P0002', hint = 'EMPRESA_NAO_ENCONTRADA';
  end if;
  if v_t.status = 'encerrado'
     or exists (select 1 from plataforma.exclusao_empresa x where x.empresa_id = p_tenant and x.situacao = 'em_andamento') then
    raise exception 'sa_reativar_tenant: há exclusão em andamento' using errcode = '55000', hint = 'EXCLUSAO_EM_ANDAMENTO';
  end if;
  if v_t.status = 'ativo' then
    return jsonb_build_object('tenant_id', p_tenant, 'status', 'ativo', 'inativada_em', null, 'motivo', null,
                              'resultado', 'sem_mudanca');
  end if;
  update plataforma.tenant set status = 'ativo' where id = p_tenant;
  update plataforma.backup_empresa set consistente = false
   where empresa_id = p_tenant and situacao = 'em_andamento' and consistente;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'tenant.reativado',
    jsonb_build_object('motivo', v_t.motivo_inativacao, 'antes', v_t.status, 'depois', 'ativo'));
  insert into plataforma.evento (tenant_id, nome, modulo, agregado_id, payload, ocorrido_em)
  values (p_tenant, 'plataforma.tenant.reativado@1', 'plataforma', p_tenant,
          jsonb_build_object('tenant_id', p_tenant, 'reativada_em', plataforma.instante_iso(v_agora),
                             'inativa_desde', plataforma.instante_iso(v_t.inativada_em)), v_agora);
  return jsonb_build_object('tenant_id', p_tenant, 'status', 'ativo', 'inativada_em', null, 'motivo', null,
                            'resultado', 'alterado');
end
$$;
revoke all on function plataforma.sa_reativar_tenant(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_reativar_tenant(uuid, uuid) to macuxi_portal;

-- RN-PLA-08: pede o backup (id do portal; o mesmo id devolve o mesmo backup). Um em andamento por empresa.
create function plataforma.sa_pedir_backup(p_sid uuid, p_tenant uuid, p_id uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_t record;
  v_b plataforma.backup_empresa;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_pedir_backup: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_pedir_backup: só o super-admin' using errcode = '42501';
  end if;
  if p_tenant is null or p_id is null then
    raise exception 'sa_pedir_backup: tenant e id obrigatórios' using errcode = '22023';
  end if;
  -- pedidos da mesma empresa em fila (o 2º vê o 1º)
  perform pg_advisory_xact_lock(hashtextextended('plataforma.backup_empresa:' || p_tenant::text, 0));
  select b.* into v_b from plataforma.backup_empresa b where b.id = p_id;
  if found then
    if v_b.empresa_id <> p_tenant then
      raise exception 'sa_pedir_backup: o id é de um backup de outra empresa' using errcode = '23505';
    end if;
    return plataforma.backup_empresa_json(v_b);
  end if;
  select t.codigo, t.status into v_t from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null;
  if not found then
    raise exception 'sa_pedir_backup: empresa não encontrada' using errcode = 'P0002', hint = 'EMPRESA_NAO_ENCONTRADA';
  end if;
  if v_t.status = 'encerrado'
     or exists (select 1 from plataforma.exclusao_empresa x where x.empresa_id = p_tenant and x.situacao = 'em_andamento') then
    raise exception 'sa_pedir_backup: há exclusão em andamento' using errcode = '55000', hint = 'EXCLUSAO_EM_ANDAMENTO';
  end if;
  if exists (select 1 from plataforma.backup_empresa b where b.empresa_id = p_tenant and b.situacao = 'em_andamento') then
    raise exception 'sa_pedir_backup: já há um backup em andamento' using errcode = '55000', hint = 'BACKUP_EM_ANDAMENTO';
  end if;
  insert into plataforma.backup_empresa (id, empresa_id, codigo, consistente, super_admin_id, sessao_id)
  values (p_id, p_tenant, v_t.codigo, v_t.status = 'suspenso', v_sa, p_sid)
  returning * into v_b;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'tenant.backup_pedido',
    jsonb_build_object('backup_id', p_id, 'consistente', v_b.consistente));
  return plataforma.backup_empresa_json(v_b);
end
$$;
revoke all on function plataforma.sa_pedir_backup(uuid, uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_pedir_backup(uuid, uuid, uuid) to macuxi_portal;

-- Backups da empresa (também da excluída), do mais novo ao mais velho, até 20; p_backup = só aquele (lista vazia = 404 na API).
create function plataforma.sa_listar_backups(p_sid uuid, p_tenant uuid, p_backup uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_listar_backups: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_listar_backups: só o super-admin' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'sa_listar_backups: tenant obrigatório' using errcode = '22023';
  end if;
  if not exists (select 1 from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null)
     and not exists (select 1 from plataforma.empresa_excluida x where x.id = p_tenant) then
    raise exception 'sa_listar_backups: empresa não encontrada' using errcode = 'P0002', hint = 'EMPRESA_NAO_ENCONTRADA';
  end if;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(plataforma.backup_empresa_json(s.b) order by (s.b).pedido_em desc, (s.b).id desc)
      from (select x as b from plataforma.backup_empresa x
             where x.empresa_id = p_tenant and (p_backup is null or x.id = p_backup)
             order by x.pedido_em desc, x.id desc
             limit 20) as s
  ), '[]'::jsonb));
end
$$;
revoke all on function plataforma.sa_listar_backups(uuid, uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_listar_backups(uuid, uuid, uuid) to macuxi_portal;

-- RN-PLA-09: pede a exclusão (id do portal, idempotente). A API confere antes a senha (sa_reautenticar). Recusas da
-- conferirExclusao com o código no hint: 55000 EXCLUSAO_EM_ANDAMENTO (409); 22023 EXCLUSAO_EMPRESA_ATIVA, EXCLUSAO_SEM_BACKUP,
-- EXCLUSAO_BACKUP_ANTES_DA_INATIVACAO, EXCLUSAO_BACKUP_VENCIDO e EXCLUSAO_CODIGO_NAO_CONFERE (422).
create function plataforma.sa_pedir_exclusao(p_sid uuid, p_tenant uuid, p_id uuid, p_backup uuid, p_codigo text)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_t record;
  v_x plataforma.exclusao_empresa;
  v_bloqueio text;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_pedir_exclusao: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_pedir_exclusao: só o super-admin' using errcode = '42501';
  end if;
  if p_tenant is null or p_id is null or p_backup is null or p_codigo is null then
    raise exception 'sa_pedir_exclusao: tenant, id, backup e código obrigatórios' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('plataforma.exclusao_empresa:' || p_tenant::text, 0));
  select x.* into v_x from plataforma.exclusao_empresa x where x.id = p_id;
  if found then
    if v_x.empresa_id <> p_tenant then
      raise exception 'sa_pedir_exclusao: o id é de uma exclusão de outra empresa' using errcode = '23505';
    end if;
    return plataforma.exclusao_empresa_json(v_x);
  end if;
  select t.codigo into v_t from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null for update;
  if not found then
    raise exception 'sa_pedir_exclusao: empresa não encontrada' using errcode = 'P0002', hint = 'EMPRESA_NAO_ENCONTRADA';
  end if;
  v_bloqueio := plataforma.exclusao_bloqueada(p_tenant, p_backup, null);
  if v_bloqueio = 'EXCLUSAO_EM_ANDAMENTO' then
    raise exception 'sa_pedir_exclusao: há exclusão em andamento' using errcode = '55000', hint = v_bloqueio;
  end if;
  if v_bloqueio is not null then
    raise exception 'sa_pedir_exclusao: exclusão recusada (RN-PLA-09)' using errcode = '22023', hint = v_bloqueio;
  end if;
  if btrim(p_codigo) = '' or lower(btrim(p_codigo)) <> lower(btrim(v_t.codigo)) then
    raise exception 'sa_pedir_exclusao: o código digitado não é o da empresa' using errcode = '22023',
      hint = 'EXCLUSAO_CODIGO_NAO_CONFERE';
  end if;
  insert into plataforma.exclusao_empresa (id, empresa_id, codigo, backup_id, super_admin_id, sessao_id)
  values (p_id, p_tenant, v_t.codigo, p_backup, v_sa, p_sid)
  returning * into v_x;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'tenant.exclusao_pedida',
    jsonb_build_object('exclusao_id', p_id, 'backup_id', p_backup));
  return plataforma.exclusao_empresa_json(v_x);
end
$$;
revoke all on function plataforma.sa_pedir_exclusao(uuid, uuid, uuid, uuid, text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_pedir_exclusao(uuid, uuid, uuid, uuid, text) to macuxi_portal;

-- A exclusão mais recente da empresa (também depois de concluída: o registro sobrevive). null = nenhuma (404 na API).
create function plataforma.sa_ler_exclusao(p_sid uuid, p_tenant uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_ler_exclusao: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_ler_exclusao: só o super-admin' using errcode = '42501';
  end if;
  return (select plataforma.exclusao_empresa_json(x)
            from plataforma.exclusao_empresa x
           where x.empresa_id = p_tenant
           order by x.pedida_em desc, x.id desc
           limit 1);
end
$$;
revoke all on function plataforma.sa_ler_exclusao(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_ler_exclusao(uuid, uuid) to macuxi_portal;

-- Confirmação forte da exclusão: o hash da senha do super-admin DA SESSÃO (a API confere com o argon2 e, se errar, conta em
-- sa_tentativa_falha pela chave do e-mail; 403 REAUTENTICACAO_FALHOU). 0 linhas = conta inativa (403). Nunca vai a log.
create function plataforma.sa_reautenticar(p_sid uuid)
  returns table (super_admin_id uuid, email text, senha_hash text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_tipo text;
  v_sa uuid;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_reautenticar: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_reautenticar: só o super-admin' using errcode = '42501';
  end if;
  return query
    select s.id, s.email, s.senha_hash
      from plataforma.super_admin s
     where s.id = v_sa and s.deleted_at is null and s.ativo;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, null, 'sa.reautenticar', '{}'::jsonb);
end
$$;
revoke all on function plataforma.sa_reautenticar(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_reautenticar(uuid) to macuxi_portal;

-- O bloco `acoes` (AcoesDaEmpresaSchema) de cada empresa viva, para a API juntar no item da sa_listar_tenants pelo tenant_id.
-- exclusao_bloqueada = exclusao_bloqueada() com o backup pronto mais recente (null = liberada).
create function plataforma.sa_acoes_das_empresas(p_sid uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_acoes_das_empresas: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_acoes_das_empresas: só o super-admin' using errcode = '42501';
  end if;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(jsonb_build_object(
             'tenant_id', t.id,
             'inativada_em', plataforma.instante_iso(t.inativada_em),
             'motivo_inativacao', t.motivo_inativacao,
             'ultimo_backup', (select plataforma.backup_empresa_json(b) from plataforma.backup_empresa b
                                where b.empresa_id = t.id order by b.pedido_em desc, b.id desc limit 1),
             'exclusao', (select plataforma.exclusao_empresa_json(x) from plataforma.exclusao_empresa x
                           where x.empresa_id = t.id order by x.pedida_em desc, x.id desc limit 1),
             'exclusao_bloqueada', plataforma.exclusao_bloqueada(t.id,
               (select b.id from plataforma.backup_empresa b
                 where b.empresa_id = t.id and b.situacao = 'pronto' order by b.concluido_em desc, b.id desc limit 1), null)
           ) order by t.nome, t.id)
      from plataforma.tenant t
     where t.deleted_at is null
  ), '[]'::jsonb));
end
$$;
revoke all on function plataforma.sa_acoes_das_empresas(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_acoes_das_empresas(uuid) to macuxi_portal;

-- 6. Funções do worker -----------------------------------------------------------------------------------------------------------
-- Pega o próximo backup em andamento sem concessão viva (10 min; for update skip locked). Marca iniciado_em na 1ª vez.
-- Devolve o BackupEmpresa + codigo (do manifesto) + partes (tabelas já confirmadas, para retomar). null = fila vazia.
create function plataforma.pegar_backup()
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_b plataforma.backup_empresa;
begin
  select b.* into v_b
    from plataforma.backup_empresa b
   where b.situacao = 'em_andamento' and (b.bloqueado_ate is null or b.bloqueado_ate < now())
   order by b.pedido_em, b.id
   limit 1
   for update skip locked;
  if not found then
    return null;
  end if;
  update plataforma.backup_empresa
     set iniciado_em = coalesce(iniciado_em, now()), bloqueado_ate = now() + interval '10 minutes'
   where id = v_b.id
  returning * into v_b;
  return plataforma.backup_empresa_json(v_b) || jsonb_build_object(
    'codigo', v_b.codigo,
    'partes', coalesce((select jsonb_agg(p.tabela order by p.ordem) from plataforma.backup_empresa_parte p where p.backup_id = v_b.id),
                       '[]'::jsonb));
end
$$;
revoke all on function plataforma.pegar_backup() from public;
grant execute on function plataforma.pegar_backup() to macuxi_worker;

-- A lista de tabelas do backup (ordem_do_backup), só para um backup em andamento (55000 fora disso; P0002 se não existe).
create function plataforma.tabelas_do_backup(p_backup uuid)
  returns table (ordem integer, tabela text, chave text[], adiar text[])
  language plpgsql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_situacao text;
begin
  select b.situacao into v_situacao from plataforma.backup_empresa b where b.id = p_backup;
  if not found then
    raise exception 'tabelas_do_backup: backup não encontrado' using errcode = 'P0002';
  end if;
  if v_situacao <> 'em_andamento' then
    raise exception 'tabelas_do_backup: o backup não está em andamento' using errcode = '55000';
  end if;
  return query select o.ordem, o.tabela, o.chave, o.adiar from plataforma.ordem_do_backup() o order by o.ordem;
end
$$;
revoke all on function plataforma.tabelas_do_backup(uuid) from public;
grant execute on function plataforma.tabelas_do_backup(uuid) to macuxi_worker;

-- Uma página da tabela (keyset pela chave primária), só do tenant da LINHA DO BACKUP. p_depois = a chave da última linha da
-- página anterior (jsonb array na ordem de `chave`; null = do começo). p_limite 1..5000. Devolve (chave, linha = to_jsonb da
-- linha inteira). Renova a concessão.
create function plataforma.exportar_backup_pagina(p_backup uuid, p_tabela text, p_depois jsonb, p_limite integer)
  returns table (chave jsonb, linha jsonb)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_b record;
  v_chave text[];
  v_rel regclass;
  v_tipos text[];
  v_cols text;
  v_onde text;
  v_maior text;
begin
  if p_limite is null or p_limite < 1 or p_limite > 5000 then
    raise exception 'exportar_backup_pagina: p_limite entre 1 e 5000' using errcode = '22023';
  end if;
  select b.empresa_id, b.situacao into v_b from plataforma.backup_empresa b where b.id = p_backup;
  if not found then
    raise exception 'exportar_backup_pagina: backup não encontrado' using errcode = 'P0002';
  end if;
  if v_b.situacao <> 'em_andamento' then
    raise exception 'exportar_backup_pagina: o backup não está em andamento' using errcode = '55000';
  end if;
  select o.chave into v_chave from plataforma.ordem_do_backup() o where o.tabela = p_tabela;
  if not found then
    raise exception 'exportar_backup_pagina: tabela fora do backup' using errcode = '22023';
  end if;
  if v_chave is null or cardinality(v_chave) = 0 then
    raise exception 'exportar_backup_pagina: tabela sem chave primária: %', p_tabela using errcode = '55000';
  end if;
  v_rel := p_tabela::regclass;
  select array_agg(format_type(a.atttypid, a.atttypmod) order by u.n) into v_tipos
    from unnest(v_chave) with ordinality as u(col, n)
    join pg_attribute a on a.attrelid = v_rel and a.attname = u.col and not a.attisdropped;
  select string_agg(format('t.%I', u.col), ', ' order by u.n) into v_cols
    from unnest(v_chave) with ordinality as u(col, n);
  v_onde := case when p_tabela = 'plataforma.tenant' then 't.id = $1' else 't.tenant_id = $1' end;
  if p_depois is not null and jsonb_typeof(p_depois) <> 'null' then
    if jsonb_typeof(p_depois) <> 'array' or jsonb_array_length(p_depois) <> cardinality(v_chave) then
      raise exception 'exportar_backup_pagina: p_depois deve ser a chave da última linha (lista)' using errcode = '22023';
    end if;
    select string_agg(format('($2 ->> %s)::%s', g.n - 1, v_tipos[g.n]), ', ' order by g.n) into v_maior
      from generate_series(1, cardinality(v_tipos)) as g(n);
    v_onde := v_onde || format(' and (%s) > (%s)', v_cols, v_maior);
  end if;
  update plataforma.backup_empresa set bloqueado_ate = now() + interval '10 minutes' where id = p_backup;
  return query execute format('select jsonb_build_array(%s), to_jsonb(t) from %s as t where %s order by %s limit $3',
                              v_cols, v_rel, v_onde, v_cols)
    using v_b.empresa_id, p_depois, p_limite;
end
$$;
revoke all on function plataforma.exportar_backup_pagina(uuid, text, jsonb, integer) from public;
grant execute on function plataforma.exportar_backup_pagina(uuid, text, jsonb, integer) to macuxi_worker;

-- Confirma a parte gravada no bucket (idempotente por backup e tabela) e atualiza o progresso (até 90%; os arquivos e o
-- manifesto fecham os 100%). Renova a concessão. Devolve o BackupEmpresa.
create function plataforma.registrar_parte_backup(p_backup uuid, p_tabela text, p_linhas bigint, p_bytes bigint, p_sha256 text)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_b plataforma.backup_empresa;
  v_ordem integer;
  v_total integer;
  v_feitas integer;
begin
  if p_linhas is null or p_linhas < 0 or p_bytes is null or p_bytes < 0 or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'registrar_parte_backup: linhas, bytes (>= 0) e sha256 (hex) obrigatórios' using errcode = '22023';
  end if;
  select b.* into v_b from plataforma.backup_empresa b where b.id = p_backup for update;
  if not found then
    raise exception 'registrar_parte_backup: backup não encontrado' using errcode = 'P0002';
  end if;
  if v_b.situacao <> 'em_andamento' then
    raise exception 'registrar_parte_backup: o backup não está em andamento' using errcode = '55000';
  end if;
  select o.ordem into v_ordem from plataforma.ordem_do_backup() o where o.tabela = p_tabela;
  if not found then
    raise exception 'registrar_parte_backup: tabela fora do backup' using errcode = '22023';
  end if;
  insert into plataforma.backup_empresa_parte (backup_id, tabela, ordem, linhas, bytes, sha256)
  values (p_backup, p_tabela, v_ordem, p_linhas, p_bytes, p_sha256)
  on conflict (backup_id, tabela) do update
    set ordem = excluded.ordem, linhas = excluded.linhas, bytes = excluded.bytes, sha256 = excluded.sha256;
  select count(*) into v_total from plataforma.ordem_do_backup();
  select count(*) into v_feitas from plataforma.backup_empresa_parte p where p.backup_id = p_backup;
  update plataforma.backup_empresa
     set progresso_pct = least(90, (90 * v_feitas) / greatest(v_total, 1)), bloqueado_ate = now() + interval '10 minutes'
   where id = p_backup
  returning * into v_b;
  return plataforma.backup_empresa_json(v_b);
end
$$;
revoke all on function plataforma.registrar_parte_backup(uuid, text, bigint, bigint, text) from public;
grant execute on function plataforma.registrar_parte_backup(uuid, text, bigint, bigint, text) to macuxi_worker;

-- Fecha o backup. p_resultado: { "situacao": "pronto", "tamanho_bytes": n, "arquivos": n } (todas as partes confirmadas,
-- senão 55000 hint BACKUP_INCOMPLETO) ou { "situacao": "falhou", "erro_codigo": "S3_FALHOU" }. consistente só fica true se a
-- empresa seguiu inativa desde antes do início (RN-PLA-08). Expira em 30 dias (RN-PLA-11). Evento backup_concluido@1 ou
-- backup_falhou@1 na outbox do tenant (se ele existe). Repetir o mesmo fechamento devolve o backup (idempotente).
create function plataforma.fechar_backup(p_backup uuid, p_resultado jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_b plataforma.backup_empresa;
  v_t record;
  v_existe boolean;
  v_situacao text;
  v_erro text;
  v_tamanho bigint;
  v_arquivos integer;
  v_total integer;
  v_partes integer;
  v_linhas bigint;
  v_consistente boolean;
  v_agora timestamptz := now();
begin
  if p_resultado is null or jsonb_typeof(p_resultado) <> 'object' then
    raise exception 'fechar_backup: resultado deve ser um objeto JSON' using errcode = '22023';
  end if;
  v_situacao := p_resultado ->> 'situacao';
  if v_situacao = 'pronto' then
    if jsonb_typeof(p_resultado -> 'tamanho_bytes') is distinct from 'number' or (p_resultado ->> 'tamanho_bytes') !~ '^[0-9]{1,18}$'
       or jsonb_typeof(p_resultado -> 'arquivos') is distinct from 'number' or (p_resultado ->> 'arquivos') !~ '^[0-9]{1,9}$' then
      raise exception 'fechar_backup: tamanho_bytes e arquivos inteiros >= 0' using errcode = '22023';
    end if;
    v_tamanho := (p_resultado ->> 'tamanho_bytes')::bigint;
    v_arquivos := (p_resultado ->> 'arquivos')::integer;
  elsif v_situacao = 'falhou' then
    v_erro := p_resultado ->> 'erro_codigo';
    if v_erro is null or v_erro !~ '^[A-Z][A-Z0-9_]{1,59}$' then
      raise exception 'fechar_backup: erro_codigo fora do formato (ex.: S3_FALHOU)' using errcode = '22023';
    end if;
  else
    raise exception 'fechar_backup: situacao deve ser pronto ou falhou' using errcode = '22023';
  end if;

  select b.* into v_b from plataforma.backup_empresa b where b.id = p_backup for update;
  if not found then
    raise exception 'fechar_backup: backup não encontrado' using errcode = 'P0002';
  end if;
  if v_b.situacao <> 'em_andamento' then
    if v_b.situacao = v_situacao then
      return plataforma.backup_empresa_json(v_b);
    end if;
    raise exception 'fechar_backup: o backup não está em andamento' using errcode = '55000';
  end if;
  select t.status, t.inativada_em into v_t from plataforma.tenant t where t.id = v_b.empresa_id and t.deleted_at is null;
  v_existe := found;

  if v_situacao = 'pronto' then
    select count(*) into v_total from plataforma.ordem_do_backup();
    select count(*), coalesce(sum(p.linhas), 0) into v_partes, v_linhas
      from plataforma.backup_empresa_parte p where p.backup_id = p_backup;
    if v_partes < v_total then
      raise exception 'fechar_backup: faltam partes (% de %)', v_partes, v_total using errcode = '55000', hint = 'BACKUP_INCOMPLETO';
    end if;
    v_consistente := v_b.consistente and v_existe and v_t.status = 'suspenso' and v_t.inativada_em is not null
                     and v_b.iniciado_em is not null and v_t.inativada_em <= v_b.iniciado_em;
    update plataforma.backup_empresa
       set situacao = 'pronto', consistente = coalesce(v_consistente, false), concluido_em = v_agora,
           expira_em = v_agora + interval '30 days', progresso_pct = 100, tamanho_bytes = v_tamanho, arquivos = v_arquivos,
           tabelas = v_partes, linhas = v_linhas, bloqueado_ate = null
     where id = p_backup
    returning * into v_b;
    if v_existe then
      insert into plataforma.evento (tenant_id, nome, modulo, agregado_id, payload, ocorrido_em)
      values (v_b.empresa_id, 'plataforma.tenant.backup_concluido@1', 'plataforma', v_b.id,
              jsonb_build_object('tenant_id', v_b.empresa_id, 'backup_id', v_b.id, 'consistente', v_b.consistente,
                                 'tamanho_bytes', v_b.tamanho_bytes, 'linhas', v_b.linhas, 'arquivos', v_b.arquivos,
                                 'concluido_em', plataforma.instante_iso(v_agora)), v_agora);
    end if;
    perform plataforma.sa_registrar_auditoria(null, null, null, null, v_b.empresa_id, 'tenant.backup_concluido',
      jsonb_build_object('backup_id', v_b.id, 'consistente', v_b.consistente, 'tabelas', v_b.tabelas, 'linhas', v_b.linhas));
  else
    update plataforma.backup_empresa
       set situacao = 'falhou', erro_codigo = v_erro, expira_em = v_agora + interval '30 days', bloqueado_ate = null
     where id = p_backup
    returning * into v_b;
    if v_existe then
      insert into plataforma.evento (tenant_id, nome, modulo, agregado_id, payload, ocorrido_em)
      values (v_b.empresa_id, 'plataforma.tenant.backup_falhou@1', 'plataforma', v_b.id,
              jsonb_build_object('tenant_id', v_b.empresa_id, 'backup_id', v_b.id, 'erro_codigo', v_erro,
                                 'falhou_em', plataforma.instante_iso(v_agora)), v_agora);
    end if;
    perform plataforma.sa_registrar_auditoria(null, null, null, null, v_b.empresa_id, 'tenant.backup_falhou',
      jsonb_build_object('backup_id', v_b.id, 'erro_codigo', v_erro));
  end if;
  return plataforma.backup_empresa_json(v_b);
end
$$;
revoke all on function plataforma.fechar_backup(uuid, jsonb) from public;
grant execute on function plataforma.fechar_backup(uuid, jsonb) to macuxi_worker;

-- RN-PLA-11: backups vencidos que o worker apaga do bucket (depois chama marcar_backup_apagado): falhou e vencido; pronto e
-- vencido quando há outro pronto mais novo da mesma empresa ou a empresa foi excluída (o da exclusão vence 90 dias depois dela).
create function plataforma.backups_vencidos(p_limite integer)
  returns table (backup_id uuid, tenant_id uuid)
  language plpgsql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 500 then
    raise exception 'backups_vencidos: p_limite entre 1 e 500' using errcode = '22023';
  end if;
  return query
    select b.id, b.empresa_id
      from plataforma.backup_empresa b
     where b.situacao in ('pronto', 'falhou') and b.expira_em < now()
       and (b.situacao = 'falhou'
            or exists (select 1 from plataforma.empresa_excluida e where e.id = b.empresa_id)
            or exists (select 1 from plataforma.backup_empresa n
                        where n.empresa_id = b.empresa_id and n.situacao = 'pronto'
                          and (n.concluido_em, n.id) > (b.concluido_em, b.id)))
       and not exists (select 1 from plataforma.exclusao_empresa x where x.backup_id = b.id and x.situacao = 'em_andamento')
     order by b.expira_em, b.id
     limit p_limite;
end
$$;
revoke all on function plataforma.backups_vencidos(integer) from public;
grant execute on function plataforma.backups_vencidos(integer) to macuxi_worker;

-- Depois de apagar os objetos do bucket: situacao apagado (o registro fica). Idempotente; 55000 se não estiver vencido.
create function plataforma.marcar_backup_apagado(p_backup uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_b plataforma.backup_empresa;
begin
  select b.* into v_b from plataforma.backup_empresa b where b.id = p_backup for update;
  if not found then
    raise exception 'marcar_backup_apagado: backup não encontrado' using errcode = 'P0002';
  end if;
  if v_b.situacao = 'apagado' then
    return plataforma.backup_empresa_json(v_b);
  end if;
  -- a mesma regra da backups_vencidos, para este backup
  if v_b.expira_em is null or v_b.expira_em >= now()
     or not (v_b.situacao = 'falhou'
             or exists (select 1 from plataforma.empresa_excluida e where e.id = v_b.empresa_id)
             or exists (select 1 from plataforma.backup_empresa n
                         where n.empresa_id = v_b.empresa_id and n.situacao = 'pronto'
                           and (n.concluido_em, n.id) > (v_b.concluido_em, v_b.id)))
     or exists (select 1 from plataforma.exclusao_empresa x where x.backup_id = v_b.id and x.situacao = 'em_andamento') then
    raise exception 'marcar_backup_apagado: o backup não está vencido' using errcode = '55000';
  end if;
  update plataforma.backup_empresa set situacao = 'apagado', erro_codigo = null, bloqueado_ate = null
   where id = p_backup
  returning * into v_b;
  perform plataforma.sa_registrar_auditoria(null, null, null, null, v_b.empresa_id, 'tenant.backup_apagado',
    jsonb_build_object('backup_id', v_b.id));
  return plataforma.backup_empresa_json(v_b);
end
$$;
revoke all on function plataforma.marcar_backup_apagado(uuid) from public;
grant execute on function plataforma.marcar_backup_apagado(uuid) to macuxi_worker;

-- Pega a próxima exclusão em andamento sem concessão viva (10 min). Devolve a ExclusaoEmpresa (etapa banco ou arquivos).
create function plataforma.pegar_exclusao()
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_x plataforma.exclusao_empresa;
begin
  select x.* into v_x
    from plataforma.exclusao_empresa x
   where x.situacao = 'em_andamento' and (x.bloqueado_ate is null or x.bloqueado_ate < now())
   order by x.pedida_em, x.id
   limit 1
   for update skip locked;
  if not found then
    return null;
  end if;
  update plataforma.exclusao_empresa set bloqueado_ate = now() + interval '10 minutes' where id = v_x.id
  returning * into v_x;
  return plataforma.exclusao_empresa_json(v_x);
end
$$;
revoke all on function plataforma.pegar_exclusao() from public;
grant execute on function plataforma.pegar_exclusao() to macuxi_worker;

-- Etapa banco, na transação do worker: confere de novo (RN-PLA-09), passa o tenant a encerrado, excluir_tenant (0032, ordem de
-- FK), registro empresa_excluida, backup guardado 90 dias, auditoria tenant.excluido (detalhes = payload de
-- plataforma.tenant.excluido@1) e etapa -> arquivos. Conferência que não passa: a exclusão vira falhou com o código e a empresa
-- fica intacta (sem erro). Erro no meio: a transação desfaz tudo (o worker chama fechar_exclusao com falhou numa nova).
-- Etapa já passada: devolve a exclusão (idempotente).
create function plataforma.executar_exclusao(p_exclusao uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_x plataforma.exclusao_empresa;
  v_t record;
  v_bloqueio text;
  v_r record;
  v_total bigint := 0;
  v_contagem jsonb := '{}'::jsonb;
  v_agora timestamptz := now();
begin
  select x.* into v_x from plataforma.exclusao_empresa x where x.id = p_exclusao for update;
  if not found then
    raise exception 'executar_exclusao: exclusão não encontrada' using errcode = 'P0002';
  end if;
  if v_x.situacao <> 'em_andamento' or v_x.etapa <> 'banco' then
    return plataforma.exclusao_empresa_json(v_x);
  end if;
  select t.codigo, t.nome, t.documento into v_t from plataforma.tenant t where t.id = v_x.empresa_id for update;
  v_bloqueio := plataforma.exclusao_bloqueada(v_x.empresa_id, v_x.backup_id, v_x.id);
  if v_bloqueio is not null then
    update plataforma.exclusao_empresa set situacao = 'falhou', erro_codigo = v_bloqueio, bloqueado_ate = null
     where id = p_exclusao
    returning * into v_x;
    perform plataforma.sa_registrar_auditoria('super_admin', v_x.super_admin_id, null, v_x.sessao_id, v_x.empresa_id,
      'tenant.exclusao_falhou', jsonb_build_object('exclusao_id', v_x.id, 'erro_codigo', v_bloqueio));
    return plataforma.exclusao_empresa_json(v_x);
  end if;

  update plataforma.tenant set status = 'encerrado' where id = v_x.empresa_id;
  for v_r in select e.tabela, e.quantidade from plataforma.excluir_tenant(v_x.empresa_id, v_t.codigo) e loop
    v_total := v_total + v_r.quantidade;
    v_contagem := v_contagem || jsonb_build_object(v_r.tabela, v_r.quantidade);
  end loop;
  -- outro backup que ainda rodava não tem mais o que ler
  update plataforma.backup_empresa
     set situacao = 'falhou', erro_codigo = 'EMPRESA_EXCLUIDA', expira_em = v_agora + interval '30 days', bloqueado_ate = null
   where empresa_id = v_x.empresa_id and situacao = 'em_andamento';
  update plataforma.backup_empresa set expira_em = v_agora + interval '90 days' where id = v_x.backup_id;
  insert into plataforma.empresa_excluida (id, codigo, documento, razao_social, excluida_em, backup_id, exclusao_id, super_admin_id)
  values (v_x.empresa_id, v_t.codigo, v_t.documento, v_t.nome, v_agora, v_x.backup_id, v_x.id, v_x.super_admin_id);
  update plataforma.exclusao_empresa
     set etapa = 'arquivos', linhas_apagadas = v_total, contagem = v_contagem, bloqueado_ate = v_agora + interval '10 minutes'
   where id = p_exclusao
  returning * into v_x;
  perform plataforma.sa_registrar_auditoria('super_admin', v_x.super_admin_id, null, v_x.sessao_id, v_x.empresa_id,
    'tenant.excluido', jsonb_build_object('tenant_id', v_x.empresa_id, 'codigo', v_x.codigo, 'backup_id', v_x.backup_id,
                                          'linhas_apagadas', v_total, 'excluido_em', plataforma.instante_iso(v_agora)));
  return plataforma.exclusao_empresa_json(v_x);
end
$$;
revoke all on function plataforma.executar_exclusao(uuid) from public;
grant execute on function plataforma.executar_exclusao(uuid) to macuxi_worker;

-- Fecha a exclusão. { "situacao": "concluida", "arquivos_apagados": n } só na etapa arquivos (-> fim; backup guardado 90 dias
-- a contar daqui). { "situacao": "falhou", "erro_codigo": "X" } só na etapa banco (a empresa está intacta); na etapa arquivos
-- o worker tenta de novo (55000). Repetir o mesmo fechamento devolve a exclusão (idempotente).
create function plataforma.fechar_exclusao(p_exclusao uuid, p_resultado jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_x plataforma.exclusao_empresa;
  v_situacao text;
  v_erro text;
  v_arquivos bigint;
  v_agora timestamptz := now();
begin
  if p_resultado is null or jsonb_typeof(p_resultado) <> 'object' then
    raise exception 'fechar_exclusao: resultado deve ser um objeto JSON' using errcode = '22023';
  end if;
  v_situacao := p_resultado ->> 'situacao';
  if v_situacao = 'concluida' then
    if jsonb_typeof(p_resultado -> 'arquivos_apagados') is distinct from 'number'
       or (p_resultado ->> 'arquivos_apagados') !~ '^[0-9]{1,18}$' then
      raise exception 'fechar_exclusao: arquivos_apagados inteiro >= 0' using errcode = '22023';
    end if;
    v_arquivos := (p_resultado ->> 'arquivos_apagados')::bigint;
  elsif v_situacao = 'falhou' then
    v_erro := p_resultado ->> 'erro_codigo';
    if v_erro is null or v_erro !~ '^[A-Z][A-Z0-9_]{1,59}$' then
      raise exception 'fechar_exclusao: erro_codigo fora do formato' using errcode = '22023';
    end if;
  else
    raise exception 'fechar_exclusao: situacao deve ser concluida ou falhou' using errcode = '22023';
  end if;

  select x.* into v_x from plataforma.exclusao_empresa x where x.id = p_exclusao for update;
  if not found then
    raise exception 'fechar_exclusao: exclusão não encontrada' using errcode = 'P0002';
  end if;
  if v_x.situacao <> 'em_andamento' then
    if v_x.situacao = v_situacao then
      return plataforma.exclusao_empresa_json(v_x);
    end if;
    raise exception 'fechar_exclusao: a exclusão não está em andamento' using errcode = '55000';
  end if;
  if v_situacao = 'concluida' then
    if v_x.etapa <> 'arquivos' then
      raise exception 'fechar_exclusao: a etapa banco ainda não rodou' using errcode = '55000';
    end if;
    update plataforma.exclusao_empresa
       set situacao = 'concluida', etapa = 'fim', concluida_em = v_agora, arquivos_apagados = v_arquivos, bloqueado_ate = null
     where id = p_exclusao
    returning * into v_x;
    update plataforma.backup_empresa set expira_em = v_agora + interval '90 days' where id = v_x.backup_id;
    perform plataforma.sa_registrar_auditoria('super_admin', v_x.super_admin_id, null, v_x.sessao_id, v_x.empresa_id,
      'tenant.exclusao_concluida', jsonb_build_object('exclusao_id', v_x.id, 'arquivos_apagados', v_arquivos));
  else
    if v_x.etapa <> 'banco' then
      raise exception 'fechar_exclusao: o banco já foi apagado; tente de novo os arquivos' using errcode = '55000';
    end if;
    update plataforma.exclusao_empresa set situacao = 'falhou', erro_codigo = v_erro, bloqueado_ate = null
     where id = p_exclusao
    returning * into v_x;
    perform plataforma.sa_registrar_auditoria('super_admin', v_x.super_admin_id, null, v_x.sessao_id, v_x.empresa_id,
      'tenant.exclusao_falhou', jsonb_build_object('exclusao_id', v_x.id, 'erro_codigo', v_erro));
  end if;
  return plataforma.exclusao_empresa_json(v_x);
end
$$;
revoke all on function plataforma.fechar_exclusao(uuid, jsonb) from public;
grant execute on function plataforma.fechar_exclusao(uuid, jsonb) to macuxi_worker;

-- Conferência pelo catálogo (aborta com 42501 e nada muda): 25 sa_* só do portal; as do worker só do worker; internas de ninguém
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
    raise exception '0072: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 25 then
    raise exception '0072: esperadas 25 funções sa_* executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma'
     and p.proname in ('tenant_esta_ativo', 'pegar_backup', 'tabelas_do_backup', 'exportar_backup_pagina', 'registrar_parte_backup',
                       'fechar_backup', 'backups_vencidos', 'marcar_backup_apagado', 'pegar_exclusao', 'executar_exclusao',
                       'fechar_exclusao', 'instante_iso', 'backup_empresa_json', 'exclusao_empresa_json', 'exclusao_bloqueada',
                       'ordem_do_backup', 'tenant_inativacao_preencher', 'tenant_codigo_nao_reaproveitado')
     and (has_function_privilege('macuxi_app', p.oid, 'execute') or has_function_privilege('macuxi_portal', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE')
          or (p.proname in ('instante_iso', 'backup_empresa_json', 'exclusao_empresa_json', 'exclusao_bloqueada', 'ordem_do_backup',
                            'tenant_inativacao_preencher', 'tenant_codigo_nao_reaproveitado')
              and has_function_privilege('macuxi_worker', p.oid, 'execute')));
  if v_f is not null then
    raise exception '0072: função do worker ou interna executável por papel errado: %', v_f using errcode = '42501';
  end if;
end
$$;

-- 0098_core_integracao_pre_cadastro_revisao (up) — v1.0.29, ADR 0069 (reenvio do pré-cadastro recusado no mesmo cliente, com
-- histórico de revisões; decisões do dono do produto R-20261123-141413 e R-20261123-142306; RN-CORE-16, RN-CORE-78, RN-CORE-79 e
-- RN-INT-22 revistas). Em cima da 0097; o número segue a ordem de merge (provisório até o gerente confirmar). Dicionários:
-- docs/banco/core.md e docs/banco/integracao.md ("0098"). Teste: db/testes/cliente-pre-cadastro-revisao.db.test.ts (estático
-- sempre; banco e up/down com o Postgres local). Conferência antes do deploy: db/scripts/conferencia-0098.sql (ADR 0069 item 6).
--
-- 1. core.cliente (dono: Core):
--      revisao_cadastro integer  NOVA: revisão do pré-cadastro (1 no primeiro recebimento, +1 a cada reenvio); nula nos clientes do
--                                ERP. CHECK cliente_revisao_cadastro_valida (>= 1). Carga: 1 em todo pré-cadastro (origem_cadastro
--                                <> 'erp', vivo ou apagado). SELECT do macuxi_leitura.
--      erros_recusa jsonb        NOVA: erros por campo da última recusa do ERP ([{campo, codigo, mensagem}], até 50), só com status
--                                'recusado' (cliente_erros_recusa_lista, cliente_erros_recusa_status). Mesma regra de sigilo do
--                                motivo_recusa: nunca em log nem na auditoria; SEM grant ao macuxi_leitura.
--    Pull: a carga de revisao_cadastro anda o updated_at dos pré-cadastros (gatilho cliente_updated_at; dezenas por tenant), para o
--    aparelho receber a revisão no próximo pull.
--
-- 2. core.cliente_pre_cadastro_tentativa (nova; dono: Core; fora do sync, db/src/excecoes.ts): uma linha por revisão do
--    pré-cadastro (número, hash sha256 do canônico, origem campo|bko, quem corrigiu e com que perfil, quando chegou, nomes dos campos
--    alterados, resultado aguardando|aceito|recusado, quando o ERP respondeu, motivo e erros por campo). cliente_id_original = o id do
--    recusado substituído pelo APK v1.0.28 (alias Y -> X, ADR 0069 item 4; índice próprio). Única por (tenant_id, cliente_id,
--    revisao). Lista do BKO pelo índice parcial dos recusados (respondido_em desc, cliente_id).
--    RLS isolamento_tenant (macuxi_app: select, insert, update; sem DELETE), manutencao e leitura (macuxi_leitura: SELECT por
--    coluna SEM hash, motivo e erros — dado pessoal de baixa entropia no canônico e texto livre do ERP; a saída desse papel vai para
--    o log do Actions).
--    Carga inicial: uma tentativa revisao = 1 por pré-cadastro vivo (origem = origem_cadastro, enviado_em = created_at, resultado
--    pelo status, respondido_em = aprovado_em ou updated_at de antes desta migração, motivo = motivo_recusa, hash nulo). As
--    substituições da v1.0.28 (linhas apagadas) ficam como estão; o elo delas segue na auditoria (cliente.recusado_substituido).
--
-- 3. integracao.cliente_fila_erp (dono: Integração): revisao integer not null default 1 (>= 1; a revisão nova reabre a mesma linha),
--    hash text (sha256 hex; nulo nas linhas de antes desta migração) e erros jsonb (erros por campo da rejeição, até 50, só com
--    estado 'rejeitado'). SELECT do macuxi_leitura só da revisao. Índice do poll sem mudança.
--
-- 4. Parâmetro unificado (ADR 0069 item 6; plataforma.parametro, módulo core). Por tenant: E = lista efetiva da RN-CORE-16
--    (cliente.campos_obrigatorios: os códigos conhecidos do array; nenhum = o padrão; razão social e documento sempre; ordem
--    canônica — o camposExigidos do domain) e P = cliente.pre_cadastro.obrigatorios válido (array sem repetição dos configuráveis;
--    inválido = vazio, como obrigatoriosPreCadastroDasLinhas) com endereco expandido em logradouro, numero, bairro, cidade, uf e cep.
--      - tenant com a chave do pré-cadastro viva: cliente.campos_obrigatorios = E ∪ P na ordem canônica;
--      - todo tenant: o espelho legado cliente.pre_cadastro.obrigatorios = projeção de (E ∪ P) nos configuráveis antigos (endereco
--        se qualquer campo de endereço for exigido), para o APK v1.0.28 receber no pull (projecaoLegadaObrigatorios).
--    Upsert pelo parametro_uk (vivo), só quando o valor muda. Nada é apagado.
--
-- 5. Código FDV do cliente (ADR 0069 item 10 e D.7; molde da 0080, RN-CORE-59; dono: Core). O cliente tem dois códigos: o Código
--    ERP (core.cliente.external_id, nulo no pré-cadastro até o retorno 'vinculado') e o Código FDV, gerado pelo banco quando o
--    SERVIDOR recebe o pré-cadastro (o aparelho não numera offline; o pull leva o código).
--      core.cliente.codigo_fdv text  NOVA: 00001… por tenant (5 dígitos ou mais, sem prefixo; 100000 depois de 99999), só de leitura
--                                    e nunca reaproveitado. Nula nos clientes do ERP (sem carga para eles) e nos pré-cadastros
--                                    apagados antes desta migração. CHECKs cliente_codigo_fdv_formato (o mesmo da 0080) e
--                                    cliente_codigo_fdv_origem (codigo_fdv is null or origem_cadastro <> 'erp'). Único entre os
--                                    vivos: cliente_codigo_fdv_uk (tenant_id, codigo_fdv) where deleted_at is null and codigo_fdv
--                                    is not null (cobre a busca pelo código). SELECT do macuxi_leitura.
--    core.cliente_codigo_fdv_contador (fora do sync, db/src/excecoes.ts): uma linha por tenant (id = uuid_de_chave
--    '<tenant>:core.cliente_codigo_fdv_contador'; único cliente_codigo_fdv_contador_tenant_uk), ultimo_sequencial bigint >= 0 = o
--    maior número emitido. Numeração própria (não divide com a do usuário). Nunca diminui (gatilho e constraint
--    cliente_codigo_fdv_contador_nao_diminui, 23514); piso no insert (gatilho cliente_codigo_fdv_contador_piso: nasce no mínimo no
--    maior Código FDV de cliente já gravado no tenant, vivo ou apagado). macuxi_app e macuxi_leitura só LEEM (RLS por tenant);
--    quem grava é a função do gatilho (SECURITY DEFINER). Backup (0072, ordem_do_backup): só FK para plataforma.tenant, 1ª leva,
--    antes de core.cliente; a restauração dá certo em qualquer ordem com os gatilhos ligados (como na 0080).
--    core.cliente_codigo_fdv() — função dos 2 gatilhos de core.cliente, SECURITY DEFINER, search_path fixo, sem EXECUTE a ninguém:
--      - cliente_codigo_fdv_emitir (BEFORE INSERT): só com origem_cadastro <> 'erp' e o código nulo -> próximo número do contador
--        do tenant (update + 1 returning; sem a linha, insert no piso e o mesmo update: inserts concorrentes do mesmo tenant
--        numeram em fila, sem repetir). Código informado (backup, carga técnica, substituição do APK v1.0.28: o id novo X herda o
--        código do recusado Y, apagado antes) fica, e o contador que existe sobe para greatest(atual, n). Insert que cai no ON
--        CONFLICT consome o número: buraco aceito, nunca repete.
--      - cliente_codigo_fdv_somente_leitura (BEFORE UPDATE): mudar codigo_fdv = 23514, CONSTRAINT
--        cliente_codigo_fdv_somente_leitura, coluna codigo_fdv, hint RN-CORE-59 -> o Core mapeia para 422 CODIGO_FDV_SOMENTE_LEITURA.
--        Só o pré-cadastro apagado sem código que volta a vivo ganha número num update.
--    Carga: os pré-cadastros VIVOS (origem_cadastro <> 'erp'), por tenant, em ordem de created_at, id, recebem 00001…; o contador
--    termina no maior emitido (tenant sem pré-cadastro vivo fica sem linha até o 1º). O updated_at anda: o pull leva o código.
--
-- Volume: core.cliente (milhares a dezenas de milhares por tenant; pré-cadastros são dezenas); tentativas = pré-cadastros x
-- revisões (dezenas a centenas por tenant); parâmetros: 2 linhas por tenant.
--
-- Caminho de volta: 0098_core_integracao_pre_cadastro_revisao.down.sql (APAGA a tabela de tentativas e as colunas novas: o
-- histórico, as revisões, os hashes e os erros por campo se perdem; os parâmetros ficam como a 0098 deixou). APAGA também o Código
-- FDV dos clientes e o contador: reaplicar a 0098 renumera os pré-cadastros vivos por created_at, id (exporte antes "select
-- tenant_id, id, codigo_fdv from core.cliente where codigo_fdv is not null" se precisar). Volte antes o código do Core e do Hub que
-- lê as colunas ou a tabela (senão 42703/42P01).

-- 1. core.cliente
alter table core.cliente add column revisao_cadastro integer;
alter table core.cliente add constraint cliente_revisao_cadastro_valida
  check (revisao_cadastro is null or revisao_cadastro >= 1);
alter table core.cliente add column erros_recusa jsonb;
alter table core.cliente add constraint cliente_erros_recusa_lista
  check (erros_recusa is null or case when jsonb_typeof(erros_recusa) = 'array' then jsonb_array_length(erros_recusa) <= 50 else false end);
alter table core.cliente add constraint cliente_erros_recusa_status
  check (erros_recusa is null or status_cadastro = 'recusado');
grant select (revisao_cadastro) on core.cliente to macuxi_leitura;

-- 2. core.cliente_pre_cadastro_tentativa
create table core.cliente_pre_cadastro_tentativa (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references plataforma.tenant (id),
  cliente_id            uuid not null,
  revisao               integer not null,
  hash                  text,
  origem                text not null,
  corrigido_por         uuid,
  corrigido_por_perfil  text,
  cliente_id_original   uuid,
  campos_alterados      text[] not null default '{}',
  enviado_em            timestamptz not null,
  resultado             text not null default 'aguardando',
  respondido_em         timestamptz,
  motivo                text,
  erros                 jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  external_id           text,
  constraint cliente_pre_cadastro_tentativa_tenant_id_uk unique (tenant_id, id),
  constraint cliente_pre_cadastro_tentativa_revisao_uk unique (tenant_id, cliente_id, revisao),
  constraint cliente_pre_cadastro_tentativa_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),
  constraint cliente_pre_cadastro_tentativa_original_fk foreign key (tenant_id, cliente_id_original) references core.cliente (tenant_id, id),
  constraint cliente_pre_cadastro_tentativa_corrigido_por_fk foreign key (tenant_id, corrigido_por) references core.usuario (tenant_id, id),
  constraint cliente_pre_cadastro_tentativa_revisao_valida check (revisao >= 1),
  constraint cliente_pre_cadastro_tentativa_hash_formato check (hash is null or hash ~ '^[0-9a-f]{64}$'),
  constraint cliente_pre_cadastro_tentativa_origem_valida check (origem in ('campo', 'bko')),
  constraint cliente_pre_cadastro_tentativa_corrigido_par check ((corrigido_por is null) = (corrigido_por_perfil is null)),
  constraint cliente_pre_cadastro_tentativa_perfil_tamanho check (corrigido_por_perfil is null or (btrim(corrigido_por_perfil) <> '' and char_length(corrigido_por_perfil) <= 60)),
  constraint cliente_pre_cadastro_tentativa_original_distinto check (cliente_id_original is null or cliente_id_original <> cliente_id),
  constraint cliente_pre_cadastro_tentativa_campos_max check (cardinality(campos_alterados) <= 20),
  constraint cliente_pre_cadastro_tentativa_resultado_valido check (resultado in ('aguardando', 'aceito', 'recusado')),
  constraint cliente_pre_cadastro_tentativa_respondido_coerente check ((resultado = 'aguardando') = (respondido_em is null)),
  constraint cliente_pre_cadastro_tentativa_motivo_tamanho check (motivo is null or char_length(motivo) <= 500),
  constraint cliente_pre_cadastro_tentativa_erros_lista
    check (erros is null or case when jsonb_typeof(erros) = 'array' then jsonb_array_length(erros) <= 50 else false end),
  constraint cliente_pre_cadastro_tentativa_recusa_coerente check (resultado = 'recusado' or (motivo is null and erros is null))
);
-- alias do recusado substituído pelo APK v1.0.28 (Y -> X): o retorno do ERP e as rotas do BKO resolvem pelo id antigo
create index cliente_pre_cadastro_tentativa_original_ix on core.cliente_pre_cadastro_tentativa (tenant_id, cliente_id_original)
  where cliente_id_original is not null;
-- lista dos recusados no BKO: recusa mais recente primeiro, cliente_id desempata
create index cliente_pre_cadastro_tentativa_recusados_ix on core.cliente_pre_cadastro_tentativa (tenant_id, respondido_em desc, cliente_id)
  where resultado = 'recusado' and deleted_at is null;
create trigger cliente_pre_cadastro_tentativa_updated_at before update on core.cliente_pre_cadastro_tentativa
  for each row execute function plataforma.definir_updated_at();
alter table core.cliente_pre_cadastro_tentativa enable row level security;
alter table core.cliente_pre_cadastro_tentativa force row level security;
create policy isolamento_tenant on core.cliente_pre_cadastro_tentativa for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.cliente_pre_cadastro_tentativa for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.cliente_pre_cadastro_tentativa to macuxi_app;
grant select (id, tenant_id, cliente_id, revisao, origem, corrigido_por, corrigido_por_perfil, cliente_id_original, campos_alterados, enviado_em, resultado, respondido_em, created_at, updated_at, deleted_at, external_id) on core.cliente_pre_cadastro_tentativa to macuxi_leitura;
create policy leitura on core.cliente_pre_cadastro_tentativa for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- carga inicial (antes da revisão, para respondido_em usar o updated_at de antes desta migração)
insert into core.cliente_pre_cadastro_tentativa (tenant_id, cliente_id, revisao, origem, enviado_em, resultado, respondido_em, motivo)
select c.tenant_id, c.id, 1, c.origem_cadastro, c.created_at,
       case c.status_cadastro when 'pendente' then 'aguardando' when 'aprovado' then 'aceito' else 'recusado' end,
       case c.status_cadastro when 'pendente' then null when 'aprovado' then coalesce(c.aprovado_em, c.updated_at) else c.updated_at end,
       case when c.status_cadastro = 'recusado' then c.motivo_recusa end
  from core.cliente c
 where c.origem_cadastro <> 'erp' and c.deleted_at is null;

-- revisão 1 em todo pré-cadastro (o gatilho cliente_updated_at anda a data: o aparelho recebe a revisão no próximo pull)
update core.cliente set revisao_cadastro = 1 where origem_cadastro <> 'erp' and revisao_cadastro is null;

-- 3. integracao.cliente_fila_erp
alter table integracao.cliente_fila_erp add column revisao integer not null default 1;
alter table integracao.cliente_fila_erp add constraint cliente_fila_erp_revisao_valida check (revisao >= 1);
alter table integracao.cliente_fila_erp add column hash text;
alter table integracao.cliente_fila_erp add constraint cliente_fila_erp_hash_formato check (hash is null or hash ~ '^[0-9a-f]{64}$');
alter table integracao.cliente_fila_erp add column erros jsonb;
alter table integracao.cliente_fila_erp add constraint cliente_fila_erp_erros_lista
  check (erros is null or case when jsonb_typeof(erros) = 'array' then jsonb_array_length(erros) <= 50 else false end);
alter table integracao.cliente_fila_erp add constraint cliente_fila_erp_erros_estado check (erros is null or estado = 'rejeitado');
grant select (revisao) on integracao.cliente_fila_erp to macuxi_leitura;

-- 4. parâmetro unificado (RN-CORE-16 + RN-CORE-79) e o espelho legado do APK v1.0.28
with canonico (campo, ordem) as (
  values ('razao_social', 1), ('documento', 2), ('inscricao_estadual', 3), ('logradouro', 4), ('numero', 5), ('bairro', 6),
         ('cidade', 7), ('uf', 8), ('cep', 9), ('nome_fantasia', 10), ('telefone', 11), ('email', 12), ('complemento', 13),
         ('geolocalizacao', 14)
),
padrao (campo) as (
  values ('razao_social'), ('documento'), ('inscricao_estadual'), ('logradouro'), ('numero'), ('bairro'), ('cidade'), ('uf'), ('cep')
),
configuraveis (campo, ordem) as (
  values ('nome_fantasia', 1), ('inscricao_estadual', 2), ('telefone', 3), ('email', 4), ('endereco', 5)
),
endereco (campo) as (
  values ('logradouro'), ('numero'), ('bairro'), ('cidade'), ('uf'), ('cep')
),
chave_e as (
  select p.tenant_id, p.valor from plataforma.parametro p
   where p.modulo = 'core' and p.chave = 'cliente.campos_obrigatorios' and p.deleted_at is null
),
chave_p as (
  select p.tenant_id, p.valor from plataforma.parametro p
   where p.modulo = 'core' and p.chave = 'cliente.pre_cadastro.obrigatorios' and p.deleted_at is null
),
-- códigos conhecidos da chave da RN-CORE-16 (os desconhecidos são ignorados; nenhum = padrão)
lista_e as (
  select e.tenant_id, x.campo
    from chave_e e
   cross join lateral jsonb_array_elements(case when jsonb_typeof(e.valor) = 'array' then e.valor else '[]'::jsonb end) el
   cross join lateral (select el #>> '{}' as campo where jsonb_typeof(el) = 'string') x
   where x.campo in (select campo from canonico)
),
-- chave do pré-cadastro válida (array de configuráveis sem repetição); inválida = vazia
p_valida as (
  select p.tenant_id, p.valor
    from chave_p p
   where jsonb_typeof(p.valor) = 'array'
     and jsonb_array_length(p.valor) <= 5
     and not exists (
       select 1 from jsonb_array_elements(p.valor) el
        where jsonb_typeof(el) <> 'string' or (el #>> '{}') not in (select campo from configuraveis))
     and (select count(distinct el #>> '{}') from jsonb_array_elements(p.valor) el) = jsonb_array_length(p.valor)
),
lista_p as (
  select p.tenant_id, el #>> '{}' as campo from p_valida p cross join lateral jsonb_array_elements(p.valor) el
),
uniao as (
  -- E: a lista da chave (ou o padrão) mais os fixos
  select t.id as tenant_id, l.campo from plataforma.tenant t join lista_e l on l.tenant_id = t.id
  union
  select t.id, d.campo from plataforma.tenant t cross join padrao d
   where not exists (select 1 from lista_e l where l.tenant_id = t.id)
  union
  select t.id, f.campo from plataforma.tenant t cross join (values ('razao_social'), ('documento')) f (campo)
  union
  -- P expandida (endereco = o grupo)
  select l.tenant_id, l.campo from lista_p l where l.campo <> 'endereco'
  union
  select l.tenant_id, en.campo from lista_p l cross join endereco en where l.campo = 'endereco'
),
unificado as (
  select u.tenant_id, jsonb_agg(u.campo order by c.ordem) as valor
    from uniao u join canonico c on c.campo = u.campo
   group by u.tenant_id
),
espelho as (
  select t.id as tenant_id,
         coalesce((
           select jsonb_agg(k.campo order by k.ordem)
             from configuraveis k
            where (k.campo <> 'endereco' and exists (select 1 from uniao u where u.tenant_id = t.id and u.campo = k.campo))
               or (k.campo = 'endereco' and exists (select 1 from uniao u join endereco en on en.campo = u.campo where u.tenant_id = t.id))
         ), '[]'::jsonb) as valor
    from plataforma.tenant t
),
novos (tenant_id, chave, valor) as (
  select u.tenant_id, 'cliente.campos_obrigatorios', u.valor from unificado u where exists (select 1 from chave_p p where p.tenant_id = u.tenant_id)
  union all
  select e.tenant_id, 'cliente.pre_cadastro.obrigatorios', e.valor from espelho e
)
insert into plataforma.parametro (tenant_id, modulo, chave, valor)
select n.tenant_id, 'core', n.chave, n.valor from novos n
on conflict (tenant_id, modulo, chave) where deleted_at is null
  do update set valor = excluded.valor where plataforma.parametro.valor is distinct from excluded.valor;

-- 5. Código FDV do cliente (ADR 0069 item 10; molde da 0080, RN-CORE-59)
alter table core.cliente add column codigo_fdv text;
alter table core.cliente add constraint cliente_codigo_fdv_formato
  check (codigo_fdv is null or codigo_fdv ~ '^(0000[1-9]|000[1-9][0-9]|00[1-9][0-9]{2}|0[1-9][0-9]{3}|[1-9][0-9]{4,})$');
alter table core.cliente add constraint cliente_codigo_fdv_origem
  check (codigo_fdv is null or origem_cadastro <> 'erp');
create unique index cliente_codigo_fdv_uk on core.cliente (tenant_id, codigo_fdv)
  where deleted_at is null and codigo_fdv is not null;
grant select (codigo_fdv) on core.cliente to macuxi_leitura;

create table core.cliente_codigo_fdv_contador (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references plataforma.tenant (id),
  ultimo_sequencial  bigint not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  external_id        text,
  constraint cliente_codigo_fdv_contador_tenant_uk unique (tenant_id),
  constraint cliente_codigo_fdv_contador_nao_negativo check (ultimo_sequencial >= 0)
);
create trigger cliente_codigo_fdv_contador_updated_at before update on core.cliente_codigo_fdv_contador
  for each row execute function plataforma.definir_updated_at();

create function core.cliente_codigo_fdv_contador_nao_diminui() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
begin
  if new.ultimo_sequencial < old.ultimo_sequencial or new.tenant_id is distinct from old.tenant_id then
    raise exception 'o contador do Código FDV do cliente nunca diminui nem muda de empresa (números emitidos não voltam)'
      using errcode = '23514', constraint = 'cliente_codigo_fdv_contador_nao_diminui', schema = tg_table_schema,
            table = tg_table_name, column = 'ultimo_sequencial', hint = 'RN-CORE-59';
  end if;
  return new;
end
$$;
revoke all on function core.cliente_codigo_fdv_contador_nao_diminui() from public;
create trigger cliente_codigo_fdv_contador_nao_diminui before update on core.cliente_codigo_fdv_contador
  for each row execute function core.cliente_codigo_fdv_contador_nao_diminui();

-- piso (restauração em qualquer ordem): a linha nova nasce no mínimo no maior Código FDV de cliente já gravado no tenant (vivo ou
-- apagado; máximo numérico, não de texto)
create function core.cliente_codigo_fdv_contador_piso() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
begin
  new.ultimo_sequencial := greatest(new.ultimo_sequencial,
    (select max(c.codigo_fdv::bigint) from core.cliente c
      where c.tenant_id = new.tenant_id and c.codigo_fdv ~ '^[0-9]{5,18}$'));
  return new;
end
$$;
revoke all on function core.cliente_codigo_fdv_contador_piso() from public;
create trigger cliente_codigo_fdv_contador_piso before insert on core.cliente_codigo_fdv_contador
  for each row execute function core.cliente_codigo_fdv_contador_piso();

alter table core.cliente_codigo_fdv_contador enable row level security;
alter table core.cliente_codigo_fdv_contador force row level security;
create policy isolamento_tenant on core.cliente_codigo_fdv_contador for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.cliente_codigo_fdv_contador for all to macuxi_manutencao using (true) with check (true);
grant select on core.cliente_codigo_fdv_contador to macuxi_app;
grant select on core.cliente_codigo_fdv_contador to macuxi_leitura;
create policy leitura on core.cliente_codigo_fdv_contador for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- carga dos pré-cadastros vivos (antes dos gatilhos de core.cliente: o somente_leitura recusaria o update)
with ordem as (
  select c.id,
         row_number() over (partition by c.tenant_id order by c.created_at, c.id) as n
    from core.cliente c
   where c.origem_cadastro <> 'erp' and c.deleted_at is null
)
update core.cliente c
   set codigo_fdv = lpad(o.n::text, greatest(5, length(o.n::text)), '0')
  from ordem o
 where o.id = c.id;

insert into core.cliente_codigo_fdv_contador (id, tenant_id, ultimo_sequencial)
select plataforma.uuid_de_chave(c.tenant_id::text || ':core.cliente_codigo_fdv_contador'), c.tenant_id, count(*)
  from core.cliente c
 where c.codigo_fdv is not null
 group by c.tenant_id;

create function core.cliente_codigo_fdv() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, core, plataforma, pg_temp
  as $$
declare
  v_n bigint;
begin
  if tg_op = 'UPDATE' then
    if new.codigo_fdv is distinct from old.codigo_fdv then
      raise exception 'o Código FDV do cliente é gerado pelo banco e não muda depois de gravado'
        using errcode = '23514', constraint = 'cliente_codigo_fdv_somente_leitura', schema = tg_table_schema,
              table = tg_table_name, column = 'codigo_fdv', hint = 'RN-CORE-59';
    end if;
    -- só o pré-cadastro apagado sem código (antes da 0098) que volta a vivo recebe número aqui
    if new.codigo_fdv is not null or new.deleted_at is not null or old.deleted_at is null or new.origem_cadastro = 'erp' then
      return new;
    end if;
  elsif new.codigo_fdv is not null then
    -- informado no insert (backup, carga técnica, substituição do APK v1.0.28): fica, e o contador que já existe nunca fica atrás
    -- dele. Sem a linha do contador, nada: o contador restaurado depois (ou o 1º insert sem código) nasce no piso
    if new.tenant_id is not null and new.codigo_fdv ~ '^[0-9]{5,18}$' then
      update core.cliente_codigo_fdv_contador c set ultimo_sequencial = new.codigo_fdv::bigint
       where c.tenant_id = new.tenant_id and c.ultimo_sequencial < new.codigo_fdv::bigint;
    end if;
    return new;
  elsif new.origem_cadastro is not distinct from 'erp' then
    return new; -- cliente do ERP: sem Código FDV
  end if;
  if new.tenant_id is null then
    return new; -- o NOT NULL de core.cliente.tenant_id recusa
  end if;
  update core.cliente_codigo_fdv_contador c set ultimo_sequencial = c.ultimo_sequencial + 1
   where c.tenant_id = new.tenant_id
  returning c.ultimo_sequencial into v_n;
  if v_n is null then
    -- 1º do tenant (ou contador ainda não restaurado): cria a linha no piso e soma 1; o concorrente espera no índice único, cai
    -- no do nothing e soma 1 depois do commit do primeiro
    insert into core.cliente_codigo_fdv_contador (id, tenant_id, ultimo_sequencial)
    values (plataforma.uuid_de_chave(new.tenant_id::text || ':core.cliente_codigo_fdv_contador'), new.tenant_id, 0)
    on conflict (tenant_id) do nothing;
    update core.cliente_codigo_fdv_contador c set ultimo_sequencial = c.ultimo_sequencial + 1
     where c.tenant_id = new.tenant_id
    returning c.ultimo_sequencial into v_n;
  end if;
  new.codigo_fdv := lpad(v_n::text, greatest(5, length(v_n::text)), '0');
  return new;
end
$$;
revoke all on function core.cliente_codigo_fdv() from public;

create trigger cliente_codigo_fdv_emitir before insert on core.cliente
  for each row execute function core.cliente_codigo_fdv();
create trigger cliente_codigo_fdv_somente_leitura before update on core.cliente
  for each row execute function core.cliente_codigo_fdv();

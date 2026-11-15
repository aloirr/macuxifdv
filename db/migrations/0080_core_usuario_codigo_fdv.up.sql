-- 0080_core_usuario_codigo_fdv (up) — T-0175, RN-CORE-59 (Código FDV do usuário). Especificação do modulo-core:
-- docs/modulos/core/usuarios.md ("Código FDV") e modules/core/domain/codigo-fdv.ts (formatarCodigoFdv, proximoSequencialFdv).
-- Migração em cima da 0079 (número reservado pela ponte: 0077 filial, 0079 fotos). Dicionário: docs/banco/core.md ("0080").
-- Teste: db/testes/usuario-codigo-fdv.db.test.ts (estático no PC; banco, concorrência e up/down no CI).
--
-- O vendedor e o promotor têm dois códigos: o Código ERP (core.usuario.external_id, RN-CORE-57/58) e o Código FDV, próprio do
-- Macuxi, gerado pelo banco em sequência por empresa: FDV-0001, FDV-0002… (mínimo de 4 dígitos; passa de FDV-9999 para
-- FDV-10000). Só de leitura e nunca reaproveitado.
--
-- 1. core.usuario.codigo_fdv text (nulo só no usuário apagado antes desta migração). CHECK usuario_codigo_fdv_formato: só o
--    formato canônico do domain (FDV- + 4 dígitos ou mais, sem zero a mais à esquerda, sequencial >= 1). Único vivo por tenant:
--    usuario_codigo_fdv_uk (tenant_id, codigo_fdv) where deleted_at is null and codigo_fdv is not null. O apagado (inclusive o
--    provisório desativado no vínculo do ERP) mantém o código, fica fora da unicidade dos vivos e o número dele continua contado.
-- 2. core.usuario_codigo_fdv_contador (dono: Core; fora do sync, só o banco usa): uma linha por tenant (id = uuid_de_chave
--    '<tenant>:core.usuario_codigo_fdv_contador'; único usuario_codigo_fdv_contador_tenant_uk), ultimo_sequencial bigint >= 0 =
--    o maior número já emitido no tenant. Nunca diminui: gatilho usuario_codigo_fdv_contador_nao_diminui (23514, constraint de
--    mesmo nome). macuxi_app só LÊ (select, RLS por tenant); quem escreve é a função do gatilho (SECURITY DEFINER, abaixo).
-- 3. core.usuario_codigo_fdv() — função dos 2 gatilhos de core.usuario, SECURITY DEFINER (roda como o dono, que é quem grava o
--    contador; o macuxi_app não tem insert/update nele), search_path fixo, sem EXECUTE a ninguém (só o gatilho chama):
--    - usuario_codigo_fdv_emitir (BEFORE INSERT): codigo_fdv nulo -> upsert atômico no contador do new.tenant_id
--      (insert ... on conflict (tenant_id) do update set ultimo_sequencial = ultimo_sequencial + 1 returning; cria a linha quando
--      falta; a linha fica travada até o fim da transação: inserts concorrentes do mesmo tenant numeram em fila, sem repetir) e
--      grava 'FDV-' || lpad(n, greatest(4, dígitos de n), '0'). codigo_fdv informado (restauração de backup, carga técnica) ->
--      fica o informado, o contador sobe para greatest(atual, n) e o formato e a unicidade valem (CHECK e índice). A API do Core
--      recusa o campo no corpo (422 CODIGO_FDV_SOMENTE_LEITURA, RN-CORE-59).
--    - usuario_codigo_fdv_somente_leitura (BEFORE UPDATE): mudar codigo_fdv (inclusive de nulo para um valor ou para nulo) =
--      erro SQLSTATE 23514 (check_violation), CONSTRAINT usuario_codigo_fdv_somente_leitura, coluna codigo_fdv, hint RN-CORE-59
--      — o Core mapeia para 422 CODIGO_FDV_SOMENTE_LEITURA. Usuário apagado antes da 0080 (sem código) que volta a vivo
--      (deleted_at nulo) ganha o próximo número no mesmo update.
--    Número consumido e não usado (rollback, insert que caiu no ON CONFLICT do upsert) não volta: buraco aceito; nunca repete.
-- 4. Backfill: os usuários VIVOS (deleted_at nulo), por tenant, em ordem de created_at, id, recebem FDV-0001…; o contador de cada
--    tenant termina no maior número emitido (tenant sem usuário vivo fica sem linha: nasce no 1º insert). Apagados ficam nulos. O
--    updated_at dos vivos anda (gatilho usuario_updated_at): o aparelho puxa o usuário de novo com o código (UsuarioSync).
--
-- RLS: a tabela nova com enable + force + isolamento_tenant (macuxi_app) + manutencao (0031); grant só select ao macuxi_app;
-- macuxi_worker e macuxi_portal: nada (o portal cria o admin pela sa_provisionar_tenant, SECURITY DEFINER: o gatilho roda como
-- o dono). core.usuario segue com as políticas de sempre.
-- Volume: 1 linha de contador por tenant; o índice único cobre a busca pelo código (q da lista do BKO, por tenant).
--
-- Caminho de volta: 0080_core_usuario_codigo_fdv.down.sql — apaga os 3 gatilhos, as 2 funções, o contador, o índice, o CHECK e
-- a coluna. PERDE os códigos emitidos: reaplicar a 0080 renumera os vivos por created_at, id (o apagado e o número que só ele
-- tinha somem). Exporte antes "select tenant_id, id, codigo_fdv from core.usuario" se precisar. Volte antes o Core que lê o
-- código (COLUNA_CODIGO_FDV_PRONTA = false em modules/core/api/codigo-fdv.ts), senão 42703.

-- 1. Coluna, formato e unicidade -----------------------------------------------------------------------------------------------
alter table core.usuario add column codigo_fdv text;
alter table core.usuario add constraint usuario_codigo_fdv_formato
  check (codigo_fdv is null or codigo_fdv ~ '^FDV-(000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3,})$');
create unique index usuario_codigo_fdv_uk on core.usuario (tenant_id, codigo_fdv)
  where deleted_at is null and codigo_fdv is not null;

-- 2. Contador por tenant --------------------------------------------------------------------------------------------------------
create table core.usuario_codigo_fdv_contador (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references plataforma.tenant (id),
  ultimo_sequencial  bigint not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  external_id        text,
  constraint usuario_codigo_fdv_contador_tenant_uk unique (tenant_id),
  constraint usuario_codigo_fdv_contador_nao_negativo check (ultimo_sequencial >= 0)
);
create trigger usuario_codigo_fdv_contador_updated_at before update on core.usuario_codigo_fdv_contador
  for each row execute function plataforma.definir_updated_at();

create function core.usuario_codigo_fdv_contador_nao_diminui() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
begin
  if new.ultimo_sequencial < old.ultimo_sequencial or new.tenant_id is distinct from old.tenant_id then
    raise exception 'o contador do Código FDV nunca diminui nem muda de empresa (números emitidos não voltam)'
      using errcode = '23514', constraint = 'usuario_codigo_fdv_contador_nao_diminui', schema = tg_table_schema,
            table = tg_table_name, column = 'ultimo_sequencial', hint = 'RN-CORE-59';
  end if;
  return new;
end
$$;
revoke all on function core.usuario_codigo_fdv_contador_nao_diminui() from public;
create trigger usuario_codigo_fdv_contador_nao_diminui before update on core.usuario_codigo_fdv_contador
  for each row execute function core.usuario_codigo_fdv_contador_nao_diminui();

alter table core.usuario_codigo_fdv_contador enable row level security;
alter table core.usuario_codigo_fdv_contador force row level security;
create policy isolamento_tenant on core.usuario_codigo_fdv_contador for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.usuario_codigo_fdv_contador for all to macuxi_manutencao using (true) with check (true);
grant select on core.usuario_codigo_fdv_contador to macuxi_app;

-- 4. Backfill (antes dos gatilhos de core.usuario: o somente_leitura recusaria o update) ---------------------------------------
with ordem as (
  select u.id,
         row_number() over (partition by u.tenant_id order by u.created_at, u.id) as n
    from core.usuario u
   where u.deleted_at is null
)
update core.usuario u
   set codigo_fdv = 'FDV-' || lpad(o.n::text, greatest(4, length(o.n::text)), '0')
  from ordem o
 where o.id = u.id;

insert into core.usuario_codigo_fdv_contador (id, tenant_id, ultimo_sequencial)
select plataforma.uuid_de_chave(u.tenant_id::text || ':core.usuario_codigo_fdv_contador'), u.tenant_id, count(*)
  from core.usuario u
 where u.codigo_fdv is not null
 group by u.tenant_id;

-- 3. Gatilhos de core.usuario ---------------------------------------------------------------------------------------------------
create function core.usuario_codigo_fdv() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, core, plataforma, pg_temp
  as $$
declare
  v_n bigint;
begin
  if tg_op = 'UPDATE' then
    if new.codigo_fdv is distinct from old.codigo_fdv then
      raise exception 'o Código FDV é gerado pelo banco e não muda depois de gravado'
        using errcode = '23514', constraint = 'usuario_codigo_fdv_somente_leitura', schema = tg_table_schema,
              table = tg_table_name, column = 'codigo_fdv', hint = 'RN-CORE-59';
    end if;
    -- só o usuário apagado antes da 0080 (sem código) que volta a vivo recebe número aqui
    if new.codigo_fdv is not null or new.deleted_at is not null then
      return new;
    end if;
  elsif new.codigo_fdv is not null then
    -- informado no insert (restauração, carga técnica): fica, e o contador nunca fica atrás dele
    if new.tenant_id is not null and new.codigo_fdv ~ '^FDV-[0-9]{4,18}$' then
      v_n := substr(new.codigo_fdv, 5)::bigint;
      insert into core.usuario_codigo_fdv_contador as c (id, tenant_id, ultimo_sequencial)
      values (plataforma.uuid_de_chave(new.tenant_id::text || ':core.usuario_codigo_fdv_contador'), new.tenant_id, v_n)
      on conflict (tenant_id) do update set ultimo_sequencial = greatest(c.ultimo_sequencial, excluded.ultimo_sequencial);
    end if;
    return new;
  end if;
  if new.tenant_id is null then
    return new; -- o NOT NULL de core.usuario.tenant_id recusa
  end if;
  insert into core.usuario_codigo_fdv_contador as c (id, tenant_id, ultimo_sequencial)
  values (plataforma.uuid_de_chave(new.tenant_id::text || ':core.usuario_codigo_fdv_contador'), new.tenant_id, 1)
  on conflict (tenant_id) do update set ultimo_sequencial = c.ultimo_sequencial + 1
  returning c.ultimo_sequencial into v_n;
  new.codigo_fdv := 'FDV-' || lpad(v_n::text, greatest(4, length(v_n::text)), '0');
  return new;
end
$$;
revoke all on function core.usuario_codigo_fdv() from public;

create trigger usuario_codigo_fdv_emitir before insert on core.usuario
  for each row execute function core.usuario_codigo_fdv();
create trigger usuario_codigo_fdv_somente_leitura before update on core.usuario
  for each row execute function core.usuario_codigo_fdv();

-- 0080_core_usuario_codigo_fdv (up) — T-0175, RN-CORE-59 (Código FDV do usuário). Especificação do modulo-core:
-- docs/modulos/core/usuarios.md ("Código FDV") e modules/core/domain/codigo-fdv.ts (formatarCodigoFdv, proximoSequencialFdv).
-- Migração em cima da 0079 (número reservado pela ponte: 0077 filial, 0079 fotos). Dicionário: docs/banco/core.md ("0080").
-- Teste: db/testes/usuario-codigo-fdv.db.test.ts (estático no PC; banco, concorrência e up/down no CI).
--
-- Todo usuário (todos os perfis) tem dois códigos: o Código ERP (core.usuario.external_id, RN-CORE-57/58) e o Código FDV, próprio do
-- Macuxi, gerado pelo banco em sequência por empresa, só número com 5 dígitos e sem prefixo: 00001, 00002… (passa de 99999
-- para 100000; R-20261115-110000). Para todos os perfis, gerado ao criar o usuário, só de leitura e nunca reaproveitado.
--
-- 1. core.usuario.codigo_fdv text (nulo só no usuário apagado antes desta migração). CHECK usuario_codigo_fdv_formato: só
--    o que o gatilho gera: 5 dígitos de 00001 a 99999, ou 6 ou mais sem zero à esquerda (100000…); recusa 00000, 000001 e
--    0100000 (regex sem lookahead, a mesma do validarCodigoFdv do Core). Único vivo por tenant:
--    usuario_codigo_fdv_uk (tenant_id, codigo_fdv) where deleted_at is null and codigo_fdv is not null. O apagado (inclusive o
--    provisório desativado no vínculo do ERP) mantém o código, fica fora da unicidade dos vivos e o número dele continua contado.
-- 2. core.usuario_codigo_fdv_contador (dono: Core; fora do sync, só o banco usa): uma linha por tenant (id = uuid_de_chave
--    '<tenant>:core.usuario_codigo_fdv_contador'; único usuario_codigo_fdv_contador_tenant_uk), ultimo_sequencial bigint >= 0 =
--    o maior número já emitido no tenant. Nunca diminui: gatilho usuario_codigo_fdv_contador_nao_diminui (23514, constraint de
--    mesmo nome). Piso: gatilho usuario_codigo_fdv_contador_piso (BEFORE INSERT; quem insere é o dono): a linha nova nasce no
--    mínimo no maior Código FDV já gravado no tenant (vivo ou apagado). macuxi_app só LÊ (select, RLS por tenant); quem
--    escreve é a função do gatilho (SECURITY DEFINER, abaixo).
--    Backup da empresa (0072, ordem_do_backup): o contador só tem FK para plataforma.tenant e sai na 1ª leva, antes de
--    core.usuario (que espera core.equipe, ciclo quebrado, e core.filial pela 0077). A restauração dá certo em qualquer ordem, sem desligar estes gatilhos:
--    contador antes -> cada usuário com código sobe o contador para greatest(atual, n); usuários antes -> o usuário com código
--    não cria a linha, e o insert do contador do backup (insert, não update: o "nunca diminui" não entra) passa pelo piso.
-- 3. core.usuario_codigo_fdv() — função dos 2 gatilhos de core.usuario, SECURITY DEFINER (roda como o dono, que é quem grava o
--    contador; o macuxi_app não tem insert/update nele), search_path fixo, sem EXECUTE a ninguém (só o gatilho chama):
--    - usuario_codigo_fdv_emitir (BEFORE INSERT): codigo_fdv nulo -> update ultimo_sequencial + 1 returning no contador do
--      new.tenant_id; sem a linha, insert no piso (on conflict (tenant_id) do nothing) e o mesmo update (a linha fica travada
--      até o fim da transação: inserts concorrentes do mesmo tenant numeram em fila, sem repetir) e grava
--      lpad(n, greatest(5, dígitos de n), '0') (o greatest evita o corte do lpad acima de 99999). codigo_fdv informado (restauração de backup, carga técnica) -> fica
--      o informado, o contador que existe sobe para greatest(atual, n) (sem linha, nada: o piso cuida quando ela nascer) e o
--      formato e a unicidade valem (CHECK e índice). A API do Core recusa o campo no corpo (422 CODIGO_FDV_SOMENTE_LEITURA, RN-CORE-59).
--    - usuario_codigo_fdv_somente_leitura (BEFORE UPDATE): mudar codigo_fdv (inclusive de nulo para um valor ou para nulo) =
--      erro SQLSTATE 23514 (check_violation), CONSTRAINT usuario_codigo_fdv_somente_leitura, coluna codigo_fdv, hint RN-CORE-59
--      — o Core mapeia para 422 CODIGO_FDV_SOMENTE_LEITURA. Usuário apagado antes da 0080 (sem código) que volta a vivo
--      (deleted_at nulo) ganha o próximo número no mesmo update.
--    Número consumido e não usado (insert de usuário que caiu no ON CONFLICT dele) não volta: buraco aceito; nunca repete.
-- 4. Backfill: os usuários VIVOS (deleted_at nulo), por tenant, em ordem de created_at, id, recebem 00001…; o contador de cada
--    tenant termina no maior número emitido (tenant sem usuário vivo fica sem linha: nasce no 1º insert). Apagados ficam nulos. O
--    updated_at dos vivos anda (gatilho usuario_updated_at): o aparelho puxa o usuário de novo com o código (UsuarioSync).
--
-- RLS: a tabela nova com enable + force + isolamento_tenant (macuxi_app) + manutencao (0031); grant só select ao macuxi_app;
-- consulta só leitura (0078, ADR 0055): select e política leitura no contador ao macuxi_leitura, e select na coluna nova
-- core.usuario.codigo_fdv (a 0078 deu SELECT por coluna em core.usuario, que tem coluna sensível; coluna nova fica sem grant);
-- macuxi_worker e macuxi_portal: nada (o portal cria o admin pela sa_provisionar_tenant, SECURITY DEFINER: o gatilho roda como
-- o dono). core.usuario segue com as políticas de sempre.
-- Volume: 1 linha de contador por tenant; o índice único cobre a busca pelo código (q da lista do BKO, por tenant).
--
-- Caminho de volta: 0080_core_usuario_codigo_fdv.down.sql — apaga os 4 gatilhos, as 3 funções, o contador, o índice, o CHECK e
-- a coluna. PERDE os códigos emitidos: reaplicar a 0080 renumera os vivos por created_at, id (o apagado e o número que só ele
-- tinha somem). Exporte antes "select tenant_id, id, codigo_fdv from core.usuario" se precisar. Volte antes o Core que lê o
-- código (COLUNA_CODIGO_FDV_PRONTA = false em modules/core/api/codigo-fdv.ts), senão 42703.

-- 1. Coluna, formato e unicidade -----------------------------------------------------------------------------------------------
alter table core.usuario add column codigo_fdv text;
alter table core.usuario add constraint usuario_codigo_fdv_formato
  check (codigo_fdv is null or codigo_fdv ~ '^(0000[1-9]|000[1-9][0-9]|00[1-9][0-9]{2}|0[1-9][0-9]{3}|[1-9][0-9]{4,})$');
create unique index usuario_codigo_fdv_uk on core.usuario (tenant_id, codigo_fdv)
  where deleted_at is null and codigo_fdv is not null;
grant select (codigo_fdv) on core.usuario to macuxi_leitura;

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

-- Piso (restauração de backup em qualquer ordem): a linha nova do contador nasce, no mínimo, no maior Código FDV já gravado no
-- tenant (vivo ou apagado; máximo numérico, não de texto). Restaurar o contador depois dos usuários é insert (não update): o
-- "nunca diminui" não entra e o valor do backup fica, ou sobe até o maior código restaurado.
create function core.usuario_codigo_fdv_contador_piso() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
begin
  new.ultimo_sequencial := greatest(new.ultimo_sequencial,
    (select max(u.codigo_fdv::bigint) from core.usuario u
      where u.tenant_id = new.tenant_id and u.codigo_fdv ~ '^[0-9]{5,18}$'));
  return new;
end
$$;
revoke all on function core.usuario_codigo_fdv_contador_piso() from public;
create trigger usuario_codigo_fdv_contador_piso before insert on core.usuario_codigo_fdv_contador
  for each row execute function core.usuario_codigo_fdv_contador_piso();

alter table core.usuario_codigo_fdv_contador enable row level security;
alter table core.usuario_codigo_fdv_contador force row level security;
create policy isolamento_tenant on core.usuario_codigo_fdv_contador for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.usuario_codigo_fdv_contador for all to macuxi_manutencao using (true) with check (true);
grant select on core.usuario_codigo_fdv_contador to macuxi_app;
grant select on core.usuario_codigo_fdv_contador to macuxi_leitura;
create policy leitura on core.usuario_codigo_fdv_contador for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- 4. Backfill (antes dos gatilhos de core.usuario: o somente_leitura recusaria o update) ---------------------------------------
with ordem as (
  select u.id,
         row_number() over (partition by u.tenant_id order by u.created_at, u.id) as n
    from core.usuario u
   where u.deleted_at is null
)
update core.usuario u
   set codigo_fdv = lpad(o.n::text, greatest(5, length(o.n::text)), '0')
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
    -- informado no insert (restauração, carga técnica): fica, e o contador que já existe nunca fica atrás dele. Sem linha do
    -- contador, nada a fazer aqui: o contador restaurado depois (ou o 1º insert sem código) nasce no piso (gatilho _piso)
    if new.tenant_id is not null and new.codigo_fdv ~ '^[0-9]{5,18}$' then
      update core.usuario_codigo_fdv_contador c set ultimo_sequencial = new.codigo_fdv::bigint
       where c.tenant_id = new.tenant_id and c.ultimo_sequencial < new.codigo_fdv::bigint;
    end if;
    return new;
  end if;
  if new.tenant_id is null then
    return new; -- o NOT NULL de core.usuario.tenant_id recusa
  end if;
  update core.usuario_codigo_fdv_contador c set ultimo_sequencial = c.ultimo_sequencial + 1
   where c.tenant_id = new.tenant_id
  returning c.ultimo_sequencial into v_n;
  if v_n is null then
    -- 1º do tenant (ou contador ainda não restaurado): cria a linha no piso (gatilho _piso) e soma 1; o concorrente espera
    -- no índice único, cai no do nothing e soma 1 depois do commit do primeiro
    insert into core.usuario_codigo_fdv_contador (id, tenant_id, ultimo_sequencial)
    values (plataforma.uuid_de_chave(new.tenant_id::text || ':core.usuario_codigo_fdv_contador'), new.tenant_id, 0)
    on conflict (tenant_id) do nothing;
    update core.usuario_codigo_fdv_contador c set ultimo_sequencial = c.ultimo_sequencial + 1
     where c.tenant_id = new.tenant_id
    returning c.ultimo_sequencial into v_n;
  end if;
  new.codigo_fdv := lpad(v_n::text, greatest(5, length(v_n::text)), '0');
  return new;
end
$$;
revoke all on function core.usuario_codigo_fdv() from public;

create trigger usuario_codigo_fdv_emitir before insert on core.usuario
  for each row execute function core.usuario_codigo_fdv();
create trigger usuario_codigo_fdv_somente_leitura before update on core.usuario
  for each row execute function core.usuario_codigo_fdv();

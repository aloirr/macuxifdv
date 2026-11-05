-- 0022_plataforma_geracao_base (up) — T-0079 (app percebe a base recriada; desenho aceito pelo engenheiro-software no
-- R-20261104-202218, diagnóstico R-20261104-195551 do "pedido fantasma 000011"). Dicionário: docs/banco/plataforma.md.
-- Migração ADITIVA e idempotente (if not exists / or replace): nenhuma coluna existente muda.
--
-- plataforma.tenant.geracao_base (uuid not null, padrão gen_random_uuid()): marcador da GERAÇÃO dos dados do tenant.
--   Regra: toda operação que APAGA ou VOLTA os dados do tenant gira a geração; o uso normal (API, worker, BKO) nunca.
--   Quem gira: o seed demo --recriar (apaga e regrava o tenant: a linha nova nasce com outro valor, e o seed ainda chama a
--   função abaixo), a restauração de backup (db/backup/restaurar-vm.sh, todos os tenants do banco restaurado) e o primeiro
--   seed de um servidor novo (linha nova = valor novo). Os tenants que já existem ganham um valor cada um nesta migração.
--   O aparelho guarda o valor junto dos cursores do sync (envelope do pull e /me, contrato do engenheiro-software); se
--   mudar, reenvia a fila, limpa a cópia local do tenant e puxa tudo de novo.
--   Leitura: o macuxi_app já tem só SELECT em plataforma.tenant pela política isolamento_tenant da 0001 (id = tenant do
--   contexto); nenhum grant novo. Escrita: nem o macuxi_app nem o macuxi_worker têm UPDATE em plataforma.tenant.
--
-- plataforma.girar_geracao_base(p_tenant uuid default null) returns integer: troca a geração do tenant informado (null =
--   TODOS os tenants do banco, para a restauração) e devolve quantos tenants girou. SECURITY INVOKER, sem EXECUTE para
--   public, macuxi_app ou macuxi_worker: só o dono do banco (migrador/superusuário do seed e do restaurar-vm.sh) roda.
--   O gatilho tenant_updated_at da 0001 também anda o updated_at do tenant.
--
-- Caminho de volta: 0022_plataforma_geracao_base.down.sql (APAGA a função e a coluna; aparelho com o marcador guardado
-- passa a receber o campo ausente e segue o comportamento de app antigo, sem limpar nada).

alter table plataforma.tenant add column if not exists geracao_base uuid not null default gen_random_uuid();

create or replace function plataforma.girar_geracao_base(p_tenant uuid default null)
  returns integer
  language sql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    with girados as (
      update plataforma.tenant
         set geracao_base = gen_random_uuid()
       where p_tenant is null or id = p_tenant
      returning 1
    )
    select count(*)::integer from girados
  $$;
revoke all on function plataforma.girar_geracao_base(uuid) from public;

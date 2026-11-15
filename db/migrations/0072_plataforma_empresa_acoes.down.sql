-- 0072_plataforma_empresa_acoes (down) — desfaz a 0072 e volta ao catálogo da 0071. Idempotente. Pré-condição: 0073+ desfeitas,
-- MACUXI_EMPRESA_ACOES desligado na API e o worker de backup/exclusão parado.
-- PERDE os registros de backup, de exclusão e de empresa excluída (os objetos em backups-empresas/ no bucket ficam; o código
-- da licença de uma empresa excluída volta a poder ser sorteado). Exporte antes "select * from plataforma.empresa_excluida".
-- A data e o motivo da inativação somem; o status (suspenso) fica.

-- 4. políticas do worker como na 0003 e na 0040 ----------------------------------------------------------------------------------
alter policy despacho_outbox on plataforma.evento using (true);
alter policy despacho_email on plataforma.email_saida using (true);

-- 5, 6 e 7. funções -------------------------------------------------------------------------------------------------------------
drop function if exists plataforma.fechar_exclusao(uuid, jsonb);
drop function if exists plataforma.executar_exclusao(uuid);
drop function if exists plataforma.pegar_exclusao();
drop function if exists plataforma.marcar_backup_apagado(uuid);
drop function if exists plataforma.backups_vencidos(integer);
drop function if exists plataforma.fechar_backup(uuid, jsonb);
drop function if exists plataforma.registrar_parte_backup(uuid, text, bigint, bigint, text);
drop function if exists plataforma.exportar_backup_pagina(uuid, text, jsonb, integer);
drop function if exists plataforma.tabelas_do_backup(uuid);
drop function if exists plataforma.pegar_backup();
drop function if exists plataforma.sa_acoes_das_empresas(uuid);
drop function if exists plataforma.sa_reautenticar(uuid);
drop function if exists plataforma.sa_ler_exclusao(uuid, uuid);
drop function if exists plataforma.sa_pedir_exclusao(uuid, uuid, uuid, uuid, text);
drop function if exists plataforma.sa_listar_backups(uuid, uuid, uuid);
drop function if exists plataforma.sa_pedir_backup(uuid, uuid, uuid);
drop function if exists plataforma.sa_reativar_tenant(uuid, uuid);
drop function if exists plataforma.sa_inativar_tenant(uuid, uuid, text);
drop function if exists plataforma.ordem_do_backup();
drop function if exists plataforma.exclusao_bloqueada(uuid, uuid, uuid);
drop function if exists plataforma.exclusao_empresa_json(plataforma.exclusao_empresa);
drop function if exists plataforma.backup_empresa_json(plataforma.backup_empresa);
drop function if exists plataforma.instante_iso(timestamptz);
drop function if exists plataforma.tenant_esta_ativo(uuid);

-- 3. código da licença: gatilho fora e sortear_codigo_licenca com o texto da 0068 (create or replace: a ACL fica) ---------------
drop trigger if exists tenant_codigo_nao_reaproveitado on plataforma.tenant;
drop function if exists plataforma.tenant_codigo_nao_reaproveitado();
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

-- 2. tabelas (filhas antes das mães) ---------------------------------------------------------------------------------------------
drop table if exists plataforma.empresa_excluida;
drop table if exists plataforma.exclusao_empresa;
drop table if exists plataforma.backup_empresa_parte;
drop table if exists plataforma.backup_empresa;

-- 1. inativação na plataforma.tenant --------------------------------------------------------------------------------------------
drop trigger if exists tenant_inativacao_preencher on plataforma.tenant;
drop function if exists plataforma.tenant_inativacao_preencher();
alter table plataforma.tenant drop constraint if exists tenant_inativacao_coerente;
alter table plataforma.tenant drop constraint if exists tenant_motivo_inativacao_valido;
alter table plataforma.tenant drop column if exists motivo_inativacao;
alter table plataforma.tenant drop column if exists inativada_em;

-- 0100_plataforma_zerar_empresa (down) — desfaz a 0100 e volta ao catálogo da 0099. Idempotente. Pré-condição: 0101+ desfeitas,
-- as rotas e o worker do zerar desligados na API (chamam funções que somem).
-- As cópias da plataforma.limpeza_copia voltam para a public.macuxi_limpeza_backup do #675 (empresa_id -> tenant_id): o
-- workflow producao-limpar-cadastros.yml de uma tag anterior restaura e descarta com elas. PERDE os registros de zerar do portal
-- (plataforma.zerar_empresa) e as prévias (plataforma.zerar_previa, que valem 1 hora); as cópias dos lotes do portal também
-- vão para a public e saem pelo descarte do workflow.

-- funções do portal, do worker, da regra e internas ------------------------------------------------------------------------------
drop function if exists plataforma.sa_ler_zerar(uuid, uuid);
drop function if exists plataforma.sa_pedir_zerar(uuid, uuid, uuid, text, text[]);
drop function if exists plataforma.sa_ler_previa_zerar(uuid, uuid, uuid);
drop function if exists plataforma.sa_pedir_previa_zerar(uuid, uuid, uuid, text[]);
drop function if exists plataforma.executar_previa_zerar(uuid);
drop function if exists plataforma.pegar_previa_zerar();
drop function if exists plataforma.expurgar_zerar(integer);
drop function if exists plataforma.fechar_zerar(uuid, text);
drop function if exists plataforma.executar_zerar(uuid);
drop function if exists plataforma.pegar_zerar();
drop function if exists plataforma.zerar_previa_json(plataforma.zerar_previa);
drop function if exists plataforma.zerar_empresa_json(plataforma.zerar_empresa);
drop function if exists plataforma.zerar_bloqueado(uuid, uuid, bigint);
drop function if exists plataforma.descartar_limpeza(uuid, text);
drop function if exists plataforma.restaurar_limpeza(uuid, text);
drop function if exists plataforma.limpar_cadastros(uuid, text, text[], boolean, boolean);

-- tabelas ------------------------------------------------------------------------------------------------------------------------
drop table if exists plataforma.zerar_previa;
drop table if exists plataforma.zerar_empresa;
do $$
begin
  if to_regclass('plataforma.limpeza_copia') is not null then
    create table if not exists public.macuxi_limpeza_backup (
      lote text not null,
      tenant_id uuid not null,
      tabela text not null,
      modo text not null check (modo in ('soft', 'fisico', 'filial', 'sync_pacote')),
      linha jsonb not null,
      copiado_em timestamptz not null default now()
    );
    revoke all on public.macuxi_limpeza_backup from public;
    create index if not exists macuxi_limpeza_backup_lote_ix on public.macuxi_limpeza_backup (lote, tabela);
    insert into public.macuxi_limpeza_backup (lote, tenant_id, tabela, modo, linha, copiado_em)
    select c.lote, c.empresa_id, c.tabela, c.modo, c.linha, c.copiado_em from plataforma.limpeza_copia c;
    -- sem cópia nenhuma, a public não precisa existir (o #675 a cria no primeiro apagar)
    if not exists (select 1 from public.macuxi_limpeza_backup) then
      drop table public.macuxi_limpeza_backup;
    end if;
  end if;
end
$$;
drop table if exists plataforma.limpeza_copia;

-- as do mapa por último (os checks da zerar_empresa e da zerar_previa usavam a entidades_limpeza_ordenadas)
drop function if exists plataforma.entidades_afetadas_limpeza(jsonb, text[]);
drop function if exists plataforma.entidades_limpeza_ordenadas(text[]);
drop function if exists plataforma.mapa_limpeza_entidades();

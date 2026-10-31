-- 0006_core_lote_a (down) — Sprint 1 (T-0017..T-0020)
-- Desfaz a 0006 na ordem inversa. APAGA rotas, paradas, visitas e etapas, títulos, histórico de compras, contatos,
-- financeiro, motivos (inclusive os de sistema), notificações, metas e indicadores diários; tira das tabelas
-- carteira e dispositivo as colunas de frequência e de push (perde esses valores) e apaga os parâmetros do Core
-- semeados pela 0006 (só os de id determinístico; parâmetro editado continua com o mesmo id e também sai).
-- Pré-condição: 0007+ desfeitas. Depois do down, tenant novo não recebe mais os padrões do Core.
drop trigger if exists tenant_semear_core on plataforma.tenant;
drop function if exists core.semear_tenant();

delete from plataforma.parametro p
 where p.modulo = 'core'
   and p.chave in ('checkin.raio_m', 'metas.base_apuracao')
   and p.id = plataforma.uuid_de_chave(p.tenant_id::text || ':plataforma.parametro:core:' || p.chave);
drop function if exists core.semear_padroes(uuid);

drop table if exists core.indicador_diario;
drop table if exists core.meta;
drop table if exists core.notificacao;
drop table if exists core.visita_etapa;
drop table if exists core.visita;
drop table if exists core.rota_parada;
drop table if exists core.rota;
drop table if exists core.motivo;
drop table if exists core.historico_compra;
drop table if exists core.titulo;
drop table if exists core.cliente_financeiro;
drop table if exists core.cliente_contato;

alter table core.dispositivo drop constraint if exists dispositivo_push_completo;
alter table core.dispositivo drop constraint if exists dispositivo_push_plataforma_valida;
alter table core.dispositivo drop column if exists push_atualizado_em;
alter table core.dispositivo drop column if exists push_plataforma;
alter table core.dispositivo drop column if exists push_token;

alter table core.carteira drop constraint if exists carteira_dia_semana_valido;
alter table core.carteira drop constraint if exists carteira_frequencia_valida;
alter table core.carteira drop column if exists dia_semana;
alter table core.carteira drop column if exists frequencia_semanas;

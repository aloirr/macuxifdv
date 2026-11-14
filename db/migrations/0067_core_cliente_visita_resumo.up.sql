-- 0067_core_cliente_visita_resumo (up) — Oficial (decisão do dono do produto, 14/11/2026 7h28): a aba Performance da ficha do
-- cliente mostra o total de visitas que o cliente já teve e quem visitou por último. Migração em cima da 0066.
-- Dicionário: docs/banco/core.md ("0067"). Teste: db/testes/cliente-visita-resumo.db.test.ts (estático no PC; banco e up/down
-- no CI).
--
-- Migração ADITIVA: 1 view e 2 índices em core.visita. Nenhuma tabela nem coluna nova; nada é apagado nem reescrito.
--
-- core.v_cliente_visita_resumo (dono: Core): uma linha por (tenant, cliente) que tem ao menos uma visita (viva ou apagada).
--   total_visitas = visitas CONCLUÍDAS do cliente: deleted_at nulo, checkout_em não nulo e resultado <> 'nao_finalizado' (o
--   fechamento automático da virada do dia, RN-CORE-11, não é check-out real; docs/desenho/performance-produtividade.md).
--   ultima_visita_em (UTC) = checkin_em da concluída mais recente (empate: maior id); ultima_visita_usuario_id e
--   ultima_visita_usuario_nome = quem fez essa visita (core.usuario.nome; anonimizado pela LGPD aparece anonimizado).
--   updated_at = o maior entre o updated_at de TODAS as visitas do cliente (inclusive apagadas e abertas: o apagamento chega ao
--   aparelho) e o do usuário da última visita (troca de nome/anonimização); é o cursor do sync.
--   Cliente cuja única visita foi apagada fica com total 0 e última nula; cliente sem visita nenhuma não tem linha (o app lê
--   como total 0).
--
-- RLS: security_invoker = true (pg15+): a view roda com o papel de quem consulta, então valem as políticas isolamento_tenant
-- (FORCE RLS) de core.visita e core.usuario — o tenant A nunca vê linha do B. macuxi_app: só select. macuxi_worker: sem acesso.
--
-- Índices: visita_cliente_resumo_ix (parcial nas concluídas, com usuario_id no include) atende a "última visita" e a contagem
-- por cliente; visita_cliente_sync_ix (tenant_id, cliente_id, updated_at) atende o max(updated_at) por cliente. Volume: o de
-- core.visita (~1 por cliente por semana); a view devolve no máximo 1 linha por cliente. Pull recomendado: filtrar por
-- cliente_id da carteira e updated_at > cursor (docs/banco/core.md, "0067").
--
-- Caminho de volta: 0067_core_cliente_visita_resumo.down.sql (só apaga a view e os 2 índices; nenhum dado se perde). Volte
-- antes o Core que lê a view (senão 42P01).

create index visita_cliente_resumo_ix on core.visita (tenant_id, cliente_id, checkin_em desc, id desc)
  include (usuario_id)
  where deleted_at is null and checkout_em is not null and resultado <> 'nao_finalizado';
create index visita_cliente_sync_ix on core.visita (tenant_id, cliente_id, updated_at);

create view core.v_cliente_visita_resumo with (security_invoker = true) as
with por_cliente as (
  select v.tenant_id, v.cliente_id,
         (count(*) filter (where v.deleted_at is null and v.checkout_em is not null and v.resultado <> 'nao_finalizado'))::integer as total_visitas,
         max(v.updated_at) as visitas_updated_at
    from core.visita v
   group by v.tenant_id, v.cliente_id
),
ultima as (
  select distinct on (v.tenant_id, v.cliente_id) v.tenant_id, v.cliente_id, v.checkin_em, v.usuario_id
    from core.visita v
   where v.deleted_at is null and v.checkout_em is not null and v.resultado <> 'nao_finalizado'
   order by v.tenant_id, v.cliente_id, v.checkin_em desc, v.id desc
)
select p.cliente_id, p.tenant_id, p.total_visitas,
       l.checkin_em as ultima_visita_em,
       l.usuario_id as ultima_visita_usuario_id,
       u.nome as ultima_visita_usuario_nome,
       greatest(p.visitas_updated_at, u.updated_at) as updated_at
  from por_cliente p
  left join ultima l on l.tenant_id = p.tenant_id and l.cliente_id = p.cliente_id
  left join core.usuario u on u.tenant_id = l.tenant_id and u.id = l.usuario_id;
comment on view core.v_cliente_visita_resumo is
  'Resumo de visitas por cliente (aba Performance da ficha): total de visitas concluídas (checkout real, viva, resultado <> nao_finalizado), última visita (UTC) e quem a fez; updated_at = cursor do sync (inclui visitas apagadas e o usuário da última). security_invoker: RLS de core.visita e core.usuario.';
grant select on core.v_cliente_visita_resumo to macuxi_app;

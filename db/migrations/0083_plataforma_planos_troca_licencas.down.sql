-- 0083_plataforma_planos_troca_licencas (down) — desfaz a 0083 (ADR 0047) e volta exatamente ao catálogo e às ACLs da 0082.
-- APAGA o histórico das trocas de plano. As assinaturas ficam como a última troca deixou (plano, ciclo e adicionais), e os
-- módulos que as trocas ligaram no tenant_modulo continuam ligados. Os 4 planos do seed (ids 00830000-...-00000000000N) saem
-- só se nenhuma assinatura os usa; os usados ficam no catálogo (a FK da assinatura os segura) e o up seguinte não os duplica.
-- Pré-condições: a API com MACUXI_PLANOS desligado (as rotas dos planos chamam as sa_* que somem) e o Core sem a trava do
-- cadastro de usuários (chama plataforma.licencas_do_tenant()). Para guardar o histórico, exporte antes:
--   select t.codigo, h.created_at, pa.codigo as de, pn.codigo as para, h.ciclo_anterior, h.ciclo, h.adicionais
--     from plataforma.assinatura_historico h join plataforma.tenant t on t.id = h.tenant_id
--     join plataforma.plano pa on pa.id = h.plano_anterior_id join plataforma.plano pn on pn.id = h.plano_id;

drop function if exists plataforma.sa_trocar_plano(uuid, uuid, jsonb);
drop function if exists plataforma.sa_assinatura_da_empresa(uuid, uuid);
drop function if exists plataforma.sa_listar_planos(uuid);
drop function if exists plataforma.licencas_do_tenant();
drop function if exists plataforma.licencas_em_uso(uuid);
drop function if exists plataforma.contratadas_do_plano(plataforma.plano, jsonb);
drop function if exists plataforma.plano_json(plataforma.plano);

drop trigger if exists assinatura_so_trava on plataforma.assinatura;
drop function if exists plataforma.assinatura_so_trava();
revoke update (updated_at) on plataforma.assinatura from macuxi_app;

drop policy if exists isolamento_tenant on plataforma.plano;
revoke select on plataforma.plano from macuxi_app;

-- a tabela leva junto índices, gatilho, políticas e grants (antes dos planos: FK para eles)
drop table if exists plataforma.assinatura_historico;

delete from plataforma.plano pl
 where pl.id in ('00830000-0000-4000-8000-000000000001', '00830000-0000-4000-8000-000000000002',
                 '00830000-0000-4000-8000-000000000003', '00830000-0000-4000-8000-000000000004')
   and not exists (select 1 from plataforma.assinatura a where a.plano_id = pl.id);

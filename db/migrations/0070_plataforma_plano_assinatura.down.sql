-- 0070_plataforma_plano_assinatura (down) — desfaz a 0070 (ADR 0047) e volta exatamente ao catálogo e às ACLs da 0069.
-- APAGA as assinaturas e o catálogo de planos gravados (o legado plataforma.tenant_modulo.plano/licencas fica como está).
-- Pré-condições: a 0071 já desfeita (a sa_listar_tenants dela lê estas tabelas) e a API com MACUXI_PLANOS desligado (as rotas
-- dos planos chamam a sa_gravar_assinatura, que some). Se precisar guardar o que foi contratado, exporte antes:
--   select t.codigo, p.codigo as plano, a.ciclo, a.adicionais, a.teste_ate, a.paga, a.created_at
--     from plataforma.assinatura a join plataforma.tenant t on t.id = a.tenant_id join plataforma.plano p on p.id = a.plano_id;

drop function if exists plataforma.sa_gravar_assinatura(uuid, uuid, jsonb);
-- as tabelas levam junto índices, gatilhos, políticas e grants (assinatura antes: FK para o plano)
drop table if exists plataforma.assinatura;
drop table if exists plataforma.plano;

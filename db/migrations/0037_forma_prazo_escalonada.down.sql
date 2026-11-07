-- 0037_forma_prazo_escalonada (down) — T-0089
-- Desfaz a 0037: tira o gatilho tenant_semear_pagamento e as funções de semeadura (tenant novo deixa de nascer com a forma
-- "À vista"); APAGA as colunas do pagamento de vendedor.pedido (forma, prazo e o retrato: o pedido do modelo novo fica só
-- com a condição antiga, nula nele), as tabelas vendedor.prazo_pagamento e vendedor.forma_pagamento (com as formas e os
-- prazos, inclusive os vindos do ERP: voltam na próxima carga completa do Hub depois de reaplicar), catalogo.tabela_escalonada
-- (com as faixas) e as colunas prazo_medio_max_dias e formas_pagamento de core.cliente; por fim as funções de CHECK.
-- Ordem: o pedido antes das tabelas (FKs), as tabelas antes das funções (CHECKs). Idempotente (if exists em tudo).
-- Pré-condição: 0038+ desfeitas.

drop trigger if exists tenant_semear_pagamento on plataforma.tenant;
drop function if exists vendedor.semear_tenant_pagamento();
drop function if exists vendedor.semear_pagamento(uuid);

alter table vendedor.pedido drop constraint if exists pedido_prazo_medio_coerente;
alter table vendedor.pedido drop constraint if exists pedido_prazo_parcelas_validas;
alter table vendedor.pedido drop constraint if exists pedido_pagamento_completo;
alter table vendedor.pedido drop constraint if exists pedido_prazo_pagamento_fk;
alter table vendedor.pedido drop constraint if exists pedido_forma_pagamento_fk;
alter table vendedor.pedido drop column if exists prazo_medio_dias;
alter table vendedor.pedido drop column if exists prazo_parcelas_dias;
alter table vendedor.pedido drop column if exists prazo_descricao;
alter table vendedor.pedido drop column if exists prazo_codigo;
alter table vendedor.pedido drop column if exists forma_pagamento_nome;
alter table vendedor.pedido drop column if exists forma_pagamento_codigo;
alter table vendedor.pedido drop column if exists prazo_pagamento_id;
alter table vendedor.pedido drop column if exists forma_pagamento_id;

drop table if exists vendedor.prazo_pagamento;
drop table if exists vendedor.forma_pagamento;
drop table if exists catalogo.tabela_escalonada;

alter table core.cliente drop constraint if exists cliente_formas_pagamento_validas;
alter table core.cliente drop constraint if exists cliente_prazo_medio_max_faixa;
alter table core.cliente drop column if exists formas_pagamento;
alter table core.cliente drop column if exists prazo_medio_max_dias;

drop function if exists core.codigos_forma_validos(text[]);
drop function if exists vendedor.prazo_medio_coerente(integer[], integer);
drop function if exists vendedor.parcelas_validas(integer[]);

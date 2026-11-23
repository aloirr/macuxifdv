-- Dados de exemplo das duas origens (kit antigo "thathyany-conector" e ERP novo "macuxierp") para o teste local da limpeza
-- (limpar-cadastros.teste.sh), em cima da fixture dois-tenants. Variável: tenant (uuid). Só dados inventados.
\set ON_ERROR_STOP on
\set QUIET on
select set_config('app.tenant_id', :'tenant', false) <> '' as ok \gset
do $$
declare
  v_t uuid := current_setting('app.tenant_id')::uuid;
  v_padrao uuid;
  v_usuario uuid;
  v_con record;
  v_cli uuid;
  v_prod uuid;
  v_tab uuid;
  v_dep uuid;
  v_forma uuid;
  v_lote uuid;
  v_sessao uuid;
  i int;
begin
  select id into v_padrao from core.filial where tenant_id = v_t and padrao and deleted_at is null;
  update core.filial set external_id = '7adf0a1a-2433-4a09-8edd-4bef759e1e24' where id = v_padrao;
  select id into v_usuario from core.usuario where tenant_id = v_t and deleted_at is null order by id limit 1;
  -- um vendedor que veio do ERP; sessão viva de um admin e de um vendedor
  update core.usuario set external_id = 'ERP-VEND-1'
   where id = (select id from core.usuario where tenant_id = v_t and perfil = 'vendedor' and deleted_at is null order by id limit 1);
  insert into core.sessao (tenant_id, usuario_id, familia_id, token_hash, expira_em)
  select v_t, u.id, gen_random_uuid(), encode(sha256(convert_to(u.id::text || u.perfil, 'UTF8')), 'hex'), now() + interval '30 days'
    from (select distinct on (perfil) id, perfil from core.usuario where tenant_id = v_t and perfil in ('admin', 'vendedor') and deleted_at is null order by perfil, id) u;
  insert into integracao.conector (tenant_id, identificador, nome, tipo, ativo, entidades, recebe_pedidos)
  values (v_t, 'thathyany-conector', 'Kit antigo', 'conector', false, array['cliente', 'produto', 'preco', 'estoque', 'filial', 'vendedor'], false),
         (v_t, 'macuxierp', 'ERP novo', 'nuvem', true, array['filial', 'vendedor', 'produto', 'preco', 'estoque'], false);
  for v_con in select id, identificador, case identificador when 'macuxierp' then 'ERP' else 'KIT' end as p
                 from integracao.conector where tenant_id = v_t and identificador in ('thathyany-conector', 'macuxierp') loop
    -- filial não padrão do ERP
    insert into core.filial (tenant_id, codigo, nome, external_id, padrao) values (v_t, v_con.p || '-F2', 'Filial ' || v_con.p, v_con.p || '-FIL-2', false);
    -- catálogo
    insert into catalogo.catalogo_no (tenant_id, nivel, nome, codigo, external_id) values (v_t, 1, 'Grupo ' || v_con.p, v_con.p || '-G1', v_con.p || '-NO-1');
    insert into catalogo.tabela_preco (tenant_id, codigo, nome, external_id) values (v_t, v_con.p || '-T1', 'Tabela ' || v_con.p, v_con.p || '-T1') returning id into v_tab;
    insert into catalogo.deposito (tenant_id, codigo, nome, external_id, filial_id) values (v_t, v_con.p || '-D1', 'Depósito ' || v_con.p, v_con.p || '-D1', v_padrao) returning id into v_dep;
    insert into vendedor.forma_pagamento (tenant_id, codigo, nome, external_id) values (v_t, v_con.p || 'F', 'Forma ' || v_con.p, v_con.p || '-FP') returning id into v_forma;
    insert into vendedor.prazo_pagamento (tenant_id, codigo, descricao, parcelas_dias, prazo_medio_dias, forma_pagamento_id, external_id)
    values (v_t, v_con.p || 'P', 'Prazo ' || v_con.p, array[30], 30, v_forma, v_con.p || '-PZ');
    for i in 1..3 loop
      insert into core.produto (tenant_id, sku, nome, external_id) values (v_t, v_con.p || '-SKU-' || i, 'Produto ' || i, v_con.p || '-PRD-' || i) returning id into v_prod;
      insert into core.produto_unidade (tenant_id, produto_id, unidade, external_id) values (v_t, v_prod, 'CX', v_con.p || '-UN-' || i);
      insert into catalogo.tabela_preco_item (tenant_id, tabela_preco_id, filial_id, produto_id, preco_cents, external_id)
      values (v_t, v_tab, v_padrao, v_prod, 1000 * i, v_con.p || '-PRC-' || i);
      insert into catalogo.estoque_saldo (tenant_id, deposito_id, produto_id, quantidade, external_id) values (v_t, v_dep, v_prod, 10 * i, v_con.p || '-EST-' || i);
      insert into core.cliente (tenant_id, filial_id, razao_social, external_id) values (v_t, v_padrao, 'Cliente ' || v_con.p || ' ' || i, v_con.p || '-CLI-' || i) returning id into v_cli;
      insert into core.cliente_endereco (tenant_id, cliente_id, logradouro, cidade, uf) values (v_t, v_cli, 'Rua ' || i, 'Manaus', 'AM');
      insert into core.carteira (tenant_id, cliente_id, usuario_id, papel) values (v_t, v_cli, v_usuario, 'vendedor');
      insert into core.titulo (tenant_id, cliente_id, documento, emissao, vencimento, valor_cents, saldo_cents, external_id)
      values (v_t, v_cli, 'DOC-' || i, date '2026-11-01', date '2026-12-01', 5000, 5000, v_con.p || '-TIT-' || i);
      insert into integracao.cliente_fila_erp (tenant_id, cliente_uuid, payload, conector_id, recebido_em) values (v_t, v_cli, '{}'::jsonb, v_con.id, now());
    end loop;
    -- Hub: sessão, lote completo, erros, registro_atual, cursor
    insert into integracao.sessao_carga (tenant_id, sessao_uuid, conector_id, entidade) values (v_t, gen_random_uuid(), v_con.id, 'produto') returning id into v_sessao;
    insert into integracao.lote (tenant_id, conector_id, entidade, modo, versao_contrato, sessao_id, chave_idempotencia, hash_conteudo, recebidas, status)
    values (v_t, v_con.id, 'produto', 'completo', '1', v_sessao, 'chave-' || lower(v_con.p) || '-produto-0001', repeat('a', 64), 3, 'concluido_com_erros') returning id into v_lote;
    insert into integracao.lote_linha_erro (tenant_id, lote_id, origem, indice, codigo, mensagem) values (v_t, v_lote, 'hub', 0, 'referencia_ausente', 'teste');
    insert into integracao.registro_atual (tenant_id, entidade, conector_id, external_id, hash, alterado_em)
    select v_t, 'produto', v_con.id, v_con.p || '-PRD-' || g, repeat('b', 64), now() from generate_series(1, 3) g;
    insert into integracao.cursor_entidade (tenant_id, conector_id, entidade) values (v_t, v_con.id, 'produto');
  end loop;
  -- cliente manual (sem external_id): fica
  insert into core.cliente (tenant_id, filial_id, razao_social) values (v_t, v_padrao, 'Cliente do app');
  -- outbox: 3 estoques parados do ERP, 1 do kit, 1 publicado (fica), 1 de pedido não publicado (sai pelo agregado_id)
  insert into plataforma.evento (tenant_id, nome, modulo, payload, tentativas, ultimo_erro)
  select v_t, 'integracao.estoque.atualizado@1', 'integracao', jsonb_build_object('external_id', 'ERP-EST-' || g), 10, 'catalogo: ReferenciaAusenteErp: x'
    from generate_series(1, 3) g;
  insert into plataforma.evento (tenant_id, nome, modulo, payload) values (v_t, 'integracao.cliente.atualizado@1', 'integracao', '{"external_id": "KIT-CLI-1"}');
  insert into plataforma.evento (tenant_id, nome, modulo, payload, publicado_em) values (v_t, 'integracao.produto.atualizado@1', 'integracao', '{}', now());
  insert into plataforma.evento (tenant_id, nome, modulo, payload, agregado_id)
  select v_t, 'vendedor.pedido.enviado@1', 'vendedor', '{}', p.id from vendedor.pedido p where p.tenant_id = v_t order by p.id limit 1;
  -- evento não publicado de um administrador (fica)
  insert into plataforma.evento (tenant_id, nome, modulo, payload, agregado_id)
  select v_t, 'core.usuario.perfil_alterado@1', 'core', '{}', u.id from core.usuario u where u.tenant_id = v_t and u.perfil = 'admin' order by u.id limit 1;
  -- foto ligada a um pedido (sai pelo entidade_id)
  insert into plataforma.arquivo (tenant_id, modulo, finalidade, entidade, entidade_id, enviado_por, tipo, situacao)
  select v_t, 'vendedor', 'foto', 'pedido', p.id, v_usuario, 'image/jpeg', 'aguardando' from vendedor.pedido p where p.tenant_id = v_t order by p.id limit 1;
end $$;

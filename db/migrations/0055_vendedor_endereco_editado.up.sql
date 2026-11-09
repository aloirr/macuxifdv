-- 0055_vendedor_endereco_editado (up) — RN-VEN-17 (T-0141 item C): endereço de entrega digitado só no pedido.
-- Desenho: docs/desenho/T-0141.md §6 (engenheiro-software). Dicionário: docs/banco/vendedor.md ("0055 — endereço editado").
-- Migração em cima da 0054. SEM COLUNA NOVA: o retrato vendedor.pedido.endereco_entrega (jsonb, 0013) já é "o endereço do
-- pedido"; ele ganha o campo `origem` ('erp' = escolhido de core.cliente_endereco; 'editado' = digitado pelo vendedor e que
-- NÃO muda o cadastro do cliente). Ausente = 'erp' (linhas anteriores à T-0141): sem migração de dados, nada é reescrito.
-- Só 3 CHECKs de defesa em vendedor.pedido (a regra é do domain do Vendedor, enderecoDoPedido; a API revalida):
--   pedido_endereco_entrega_origem   origem ausente/nula, 'erp' ou 'editado'
--   pedido_endereco_editado_sem_id   editado => coluna endereco_entrega_id nula e retrato sem id e sem external_id. O Conector
--                                    usa os campos de texto quando o external_id é nulo (desenho §5): um editado com o
--                                    external_id do ERP levaria a entrega ao endereço do cadastro sem avisar
--   pedido_endereco_editado_completo editado => logradouro, número, bairro e cidade preenchidos, UF com 2 letras maiúsculas e
--                                    CEP com 8 dígitos (EnderecoEditadoPedido; vai para a tag entrega da NF-e)
-- Os 3 valem também para o orçamento (mesma tabela). Políticas, grants, índices e sync não mudam (pull do retrato inteiro).
-- Validação das linhas existentes no ADD: nenhuma linha antiga tem origem (= 'erp'), então nenhuma é recusada.
-- Caminho de volta: 0055_vendedor_endereco_editado.down.sql (só remove os CHECKs; os retratos 'editado' ficam no jsonb e
-- continuam legíveis pela API, que trata origem ausente como 'erp').

alter table vendedor.pedido add constraint pedido_endereco_entrega_origem
  check (endereco_entrega is null or coalesce(endereco_entrega->>'origem', 'erp') in ('erp', 'editado'));
alter table vendedor.pedido add constraint pedido_endereco_editado_sem_id
  check (
    coalesce(endereco_entrega->>'origem', 'erp') <> 'editado'
    or (endereco_entrega_id is null and endereco_entrega->>'id' is null and endereco_entrega->>'external_id' is null)
  );
alter table vendedor.pedido add constraint pedido_endereco_editado_completo
  check (
    coalesce(endereco_entrega->>'origem', 'erp') <> 'editado'
    or (
      coalesce(btrim(endereco_entrega->>'logradouro'), '') <> ''
      and coalesce(btrim(endereco_entrega->>'numero'), '') <> ''
      and coalesce(btrim(endereco_entrega->>'bairro'), '') <> ''
      and coalesce(btrim(endereco_entrega->>'cidade'), '') <> ''
      and coalesce(endereco_entrega->>'uf', '') ~ '^[A-Z]{2}$'
      and coalesce(endereco_entrega->>'cep', '') ~ '^[0-9]{8}$'
    )
  );

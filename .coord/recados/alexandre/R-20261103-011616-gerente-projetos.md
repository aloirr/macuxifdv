---
id: R-20261103-011616-gerente-projetos
de: gerente-projetos
para: [alexandre]
cc: []
tipo: entrega
prioridade: normal
tarefa: T-0061
responde_a: null
encerra: false
contrato: null
criado_em: 2026-11-03T01:16:16+00:00
---
# [PRONTO PARA MERGE] T-0061 novo pedido em 3 abas — PR aloirr/macuxifdv#72

PR https://github.com/aloirr/macuxifdv/pull/72 (nuvem/T-0061-pedido-3-abas, contém o main a3812c1 com a T-0064 mesclada mantendo as duas mudanças). Feito: domain de preço (UN/CX, desconto XOR acréscimo item/pedido, alçada pelo efetivo exato sem frete, 30%→5%→sem aprovação, CIF/FOB com transportadora cadastrada XOR digitada, endereço); tela em 3 abas com rodapé, offline; API grava e devolve unit_label/freight/price_table_name; detalhe Campo/Gestão/BKO e PDFs; BKO de transportadoras; opção promotor_ve_pedidos (O-3) testada nos dois estados. Revisão: 1 vermelho (alçada) corrigido. Testes verdes exceto pgvector do @macuxi/db (ambiente local). Como testar: 1) novo pedido, item em CX; 2) 30% no item e 5% no pedido; 3) FOB com transportadora digitada; 4) escolher endereço e enviar; 5) abrir no BKO e gerar PDF. Cortado: transportadora do ERP, preço próprio da CX, chip campanha. Pendências: consulta do Core para promotor_ve_pedidos (até lá ligada), trava RN-VEN-11 (T-0062), price_table_name no BKO (Catálogo), edição do padrão de frete (Core).

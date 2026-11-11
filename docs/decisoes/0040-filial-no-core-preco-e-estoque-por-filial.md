# ADR 0040 — Filial no Core; depósito e item de tabela de preço por filial no Catálogo; aparelho só com as filiais da carteira

- **Status**: proposta em 2026-11-10 (vale com o desenho T-0149 aprovado pelo gerente)
- **Data**: 2026-11-10
- **Tarefa**: T-0149 ([desenho](../desenho/T-0149.md))
- **Autor**: engenheiro-software
- **Origem**: R-20261110-062236-alexandre ("a tabela de preço vale por filial, e o preço do pedido sai da filial do cliente"); RN-CORE-39.
- **Base**: ADR 0005 (preço e estoque são do Catálogo), ADR 0009 §4 (versão do escopo do pull), ADR 0012 (consultas), ADR 0016 (Hub v1 aditivo e `exigeConector`).

## Contexto
A empresa entrega de mais de uma unidade (filial), às vezes várias no mesmo estado. O estoque e o preço que o vendedor vê têm de
ser os da filial que atende o cliente, e o pedido tem de chegar ao ERP com essa filial. Hoje há `catalogo.deposito` (comentado como
"filial/depósito"), o preço é só por tabela e o pedido não tem filial.

## Decisão
1. **Dono**: a filial é cadastro do **Core** (`core.filial`), porque o cliente (Core) aponta para ela e todos os módulos a leem.
   Uma **filial padrão** por empresa, criada no nascimento do tenant. `core.cliente.filial_id` nunca é nula (gatilho põe a padrão).
2. **Estoque**: o **depósito pertence a uma filial** (`catalogo.deposito.filial_id`). Estoque da filial = soma dos depósitos dela.
   Não se cria "estoque por filial" separado: o ERP que só tem filial manda um depósito por filial.
3. **Preço**: a tabela continua comercial (Varejo, Atacado) e o cliente continua com uma tabela; o **item** ganha a filial
   (`catalogo.tabela_preco_item.filial_id`). A tabela do cliente sem item nenhum na filial dele usa os itens da filial padrão
   (fallback **por tabela**; por item seria vender a preço de outra filial sem ninguém ver, contra a RN-CAT-06).
4. **Leitura entre módulos**: consulta nova `core.filiais@1` (API e aparelho), que devolve a padrão, a filial efetiva de clientes,
   a tradução de `external_id` e as filiais da carteira. Nenhuma FK cruzada; nenhum evento novo do Core.
5. **Aparelho**: o pull de preço e estoque leva só as filiais da carteira + a padrão. A lista de filiais entra na
   `variacaoEscopo` dos provedores do Catálogo; mudou a lista, o aparelho repuxa (ADR 0009 §4). O SDK não muda.
6. **Pedido**: retrato da filial (`vendedor.pedido.filial` jsonb + `filial_id`) gravado pelo servidor no recebimento; o aparelho não
   escolhe filial.
7. **Hub**: entidade `filial` e campos `filial_external_id` **aditivos no v1**; `PedidoParaErp.filial?` aditivo; pedido de filial
   não padrão exige o Conector 1.4.0 (`exigeConector`), sem recusar nada.
8. **Versões**: nenhum contrato muda de versão. Ausente = filial padrão em todos os pontos, que é exatamente o comportamento de hoje
   de uma empresa de uma filial.

## Alternativas consideradas
- **Tabela de preço com filial** (`tabela_preco.filial_id`, uma "Varejo" por filial) e o cliente apontando para a tabela da filial
  dele: obriga o ERP e o BKO a manter um vínculo cliente × tabela por filial e não resolve o "cai na padrão" sem regra de código de
  tabela. Rejeitada.
- **Fallback por item** (produto sem preço na filial do cliente usa o da padrão): mais simples de consultar, mas vende a preço de
  outra filial em silêncio. Rejeitada (RN-CAT-06).
- **Filial no Catálogo** (`catalogo.filial`): o cliente (Core) teria de apontar para outro schema. Rejeitada (fronteira).
- **Novo escopo de sync `filial` no SDK**: resolveria a versão por filial com mais precisão, mas mexe no motor às vésperas da
  produção; a `variacaoEscopo` assíncrona já dá conta. Rejeitada agora.
- **Contratos @v2**: nada é incompatível; ausente = padrão. Rejeitada.

## Consequências
- banco-dados: migração (core, catálogo, vendedor), `provisionar_tenant`, SQLite, views do Conector, seed com 2 filiais.
- Catálogo, Core, Vendedor e Integração implementam o desenho T-0149 §4; o registro de contratos ganha `core.filiais@1` e
  `integracao.filial.atualizado@1`.
- Empresa de uma filial não percebe diferença (mesmo preço, mesmo estoque, mesmo volume no aparelho).
- Quem tem muitas filiais e carteira grande repuxa preço e estoque quando a lista de filiais muda (medir na T-0107).
- Conector 1.4.0 é pré-requisito para pedido de filial não padrão chegar ao ERP.

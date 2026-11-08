# Desempenho da busca da API com 20 mil produtos (T-0119, D-T0107b)

## Causa (medida na carga da T-0107)
`GET /v1/catalogo/busca` fazia, a cada pedido:
1. `repo.produtos()`: `select distinct` dos produtos com preço + consulta `core.cadastro_resumo@1` em lotes de 500 + 4 leituras de atributos, conteúdo, referências e miniaturas com 20 mil ids (155 consultas, ~0,7 s);
2. preço e estoque de **todos** os produtos ativos (`precos`, `saldos`: 40 mil linhas);
3. `itemDaVitrine` + `docDeBusca` de cada um dos 20 mil e `rankear` sobre todos (~4 s de CPU no Node, que também atrasava as outras rotas da instância).

As consultas de preço e estoque já usam índice (`tabela_preco_item_vigencia_uk`, `estoque_saldo_produto_ix`); o problema não era plano de consulta, e sim ler e ranquear o catálogo inteiro por busca. **Nenhuma migração nova foi necessária.**

## Correção
- **Retrato do catálogo por tenant** (`repositorio-postgres.ts`, `produtosEmCache`): vale 60 s, é descartado quando o próprio Catálogo grava (cadastro, destaque, conteúdo, marca) e é renovado por uma requisição só. Só entra o que **não** muda por usuário; preço e estoque nunca ficam no retrato. Mudança vinda do Core ou do ERP aparece em até 60 s.
- **Índice de pré-seleção** (`domain/indice-busca.ts`, função pura): índice invertido (termo → produtos) com os mesmos campos do ranking (nome, código, marca, categoria, atributos, aplicação com anos expandidos, referências cruzadas). `candidatosDaBusca` devolve um superconjunto exato dos produtos que podem pontuar (exato, prefixo, erro de digitação, sinônimos, código/EAN/referência) e o `maxVendas` do universo completo, para a nota não mudar. O `rankear` segue igual e roda só neles.
- **Preço e estoque só dos candidatos.** Sem texto nem código, com faixa de preço, filtro de estoque, "só vendáveis" ou nota semântica, a busca usa a lista inteira (esses casos dependem do cartão de cada produto). Abaixo de 2.000 produtos o índice não é usado.
- O vocabulário (marcas e categorias) também sai uma vez por retrato.

## Garantias de teste
- `domain/indice-busca.test.ts`: 30 consultas (typos, sinônimo, código, EAN, aplicação com ano, referência cruzada) dão **os mesmos itens, a mesma ordem, o mesmo total e as mesmas notas** com e sem pré-seleção.
- `api/busca-volume.db.test.ts` (só no CI, 20 mil produtos): EXPLAIN do preço e do estoque sem `Seq Scan`; o segundo pedido não faz consulta de produto; a gravação do Catálogo descarta o retrato; p95 do caminho da busca < 300 ms e igualdade com o ranking sobre a lista inteira.
- Meta fina por requisição HTTP: carga da T-0107 (`MACUXI_CARGA_MEDIR=1`).

## Limites conhecidos
- A primeira busca depois dos 60 s (ou de uma gravação) paga a leitura do catálogo e a construção do índice (algumas centenas de ms com 20 mil). Aceito; um pré-aquecimento em job é a evolução se o p99 pesar.
- O retrato fica na memória do processo (até 20 tenants); com várias instâncias cada uma tem o seu, todas expiram em 60 s.

# Desempenho da busca da API com 20 mil produtos (T-0119, D-T0107b)

## Causa (medida na carga da T-0107)
`GET /v1/catalogo/busca` fazia, a cada pedido:
1. `repo.produtos()`: `select distinct` dos produtos com preço + consulta `core.cadastro_resumo@1` em lotes de 500 + 4 leituras de atributos, conteúdo, referências e miniaturas com 20 mil ids (155 consultas, ~0,7 s);
2. preço e estoque de **todos** os produtos ativos (`precos`, `saldos`: 40 mil linhas);
3. `itemDaVitrine` + `docDeBusca` de cada um dos 20 mil e `rankear` sobre todos (~4 s de CPU no Node, que também atrasava as outras rotas da instância).

As consultas de preço e estoque já usam índice (`tabela_preco_item_vigencia_uk`, `estoque_saldo_produto_ix`); o problema não era plano de consulta, e sim ler e ranquear o catálogo inteiro por busca. **Nenhuma migração nova foi necessária.**

## Correção
- **Retrato do catálogo por tenant** (`repositorio-postgres.ts`, `produtosEmCache`): vale 60 s, é descartado quando o próprio Catálogo grava (cadastro, destaque, conteúdo, marca) e é renovado por uma requisição só. Só entra o que **não** muda por usuário; preço e estoque nunca ficam no retrato. Mudança vinda do Core ou do ERP aparece em até 60 s.
- **Renovação sem travar a API (v1.0.4)**: com o TTL vencido a requisição serve o retrato e o índice antigos e confere a versão barata do Catálogo (`max(updated_at)` de preço, atributo, conteúdo, referência e mídia, por índice `*_sync_ix`); só relê o catálogo se a versão mudou ou se passaram 10 min (o cadastro do Core não entra na versão). A releitura roda em segundo plano (`ctx.comTenant`, uma só por tenant) e a troca só acontece quando o índice novo está pronto; se o conteúdo lido for igual (assinatura), a lista e o índice antigos ficam. Gravação do Catálogo (`aposGravar`) continua descartando o retrato na hora.
- **Aquecimento do índice fora da requisição**: `prepararIndice` monta o índice na carga do retrato, em pedaços de ~8 ms que cedem o laço de eventos (`setImmediate`); a busca nunca monta índice. Ele guarda também os termos de cada produto (`TOKENS_DO_PRODUTO`), que o ranking reaproveita no lugar de normalizar o produto de novo a cada consulta; as chaves de marca/linha e a maior venda ficam prontas no índice. A tolerância a erro de digitação só olha termos de tamanho compatível (busca binária por tamanho) e o prefixo é uma faixa da ordem alfabética. O resultado do ranking não muda.
- **Índice de pré-seleção** (`domain/indice-busca.ts`, função pura): índice invertido (termo → produtos) com os mesmos campos do ranking (nome, código, marca, categoria, atributos, aplicação com anos expandidos, referências cruzadas). `candidatosDaBusca` devolve um superconjunto exato dos produtos que podem pontuar (exato, prefixo, erro de digitação, sinônimos, código/EAN/referência) e o `maxVendas` do universo completo, para a nota não mudar. O `rankear` segue igual e roda só neles.
- **Preço e estoque só dos candidatos.** Sem texto nem código, com faixa de preço, filtro de estoque, "só vendáveis" ou nota semântica, a busca usa a lista inteira (esses casos dependem do cartão de cada produto). Abaixo de 2.000 produtos o índice não é usado.
- O vocabulário (marcas e categorias) também sai uma vez por retrato.

## Teto de candidatos (D-T0107b, v1.0.1)
Medido no CI: p95 de 9,2 s. Com o catálogo de teste (10 peças × 8 marcas) cada consulta deixa de 2 mil a 7 mil candidatos (10 a 35%), e o ranking completo custa ~0,3 a 0,7 ms por candidato; além disso a varredura do vocabulário do índice (61 mil termos, 20 mil deles códigos "SKU-…") montava a matriz de edição para cada termo (0,7 a 3 s por consulta).
- **Varredura barata do vocabulário** (`indice-busca.ts`, `ranking.ts`): cada termo do índice tem uma máscara de 32 bits dos caracteres; se a palavra tem mais caracteres ausentes do termo do que a tolerância, o termo é descartado sem calcular nada. A distância de edição do ranking (`dentroDaDistancia`) usa só a faixa |i−j| ≤ tolerância e sai assim que a linha passa do limite (mesmo veredito da distância completa, com teste de 2.000 pares). Sozinha, a varredura foi de 0,7–3 s para 10–80 ms.
- **Teto `TETO_CANDIDATOS` = 300 antes do ranking completo** (`cortarCandidatos`): o índice guarda, por candidato, uma nota barata (melhor alternativa por grupo de sinônimos, nível exato 1 / prefixo 0,7 / digitação 0,5, aplicação a 0,5; o ano da consulta fora da aplicação e "só número" zeram) e se casou **só pela aplicação** (RN-CAT-12). O corte usa a mesma conta do ranking (`notaFinal`: estoque, mais vendido, campanha; exato primeiro; só-aplicação por último) e o mesmo desempate. Quem não pode entrar (nota-base abaixo da do último que cabe menos o maior boost) nem é medido. O estoque de **todos** os candidatos é lido numa consulta só (sem preço); o preço, só dos 300 que ficam.
- **Diferença aceita:** (1) com corte o `total` da busca para em 300 (sem corte para em 500, `LIMITE_RESULTADOS_BUSCA`); a tela pede para refinar. (2) A nota barata ignora o peso do campo (nome 1, marca 0,6, categoria 0,4, atributo 0,3), então um produto fora do corte pode ser trocado por outro de nota textual um pouco menor, e alguns dos 300 podem ficar com nota 0 no ranking completo (trecho da aplicação por ano). A primeira página de 20 itens bate com o ranking completo nos 30 casos do `indice-busca.test.ts` (com teto de 60) e nas consultas do teste de 20 mil.
- Medida local (máquina carregada, 20 mil, 10 consultas): índice + corte 60–350 ms e ranking dos 300 em 80–300 ms, contra 3–15 s antes; o p95 do CI (`busca-volume.db.test.ts`) é o critério.
- Medido no CI da v1.0.4 (retrato renovado em segundo plano, índice em pedaços): p95 de 244 ms com 20 mil produtos (teto 300 ms); o caso deixou de ser `it.fails`.

## Retrato × gravação (🟡 R-20261108-183906)
O retrato tem **geração por tenant**: cada descarte a incrementa; a carga anota a geração ao começar e só guarda o resultado se ela não mudou (e se ainda é a carga registrada). A rota descarta **antes** da gravação (repositório) e **depois** do commit (`aposGravar`, chamado quando `ctx.comTenant` termina, também em falha). Quem pediu a carga velha recebe o que leu, mas ela não vira retrato. Testes em `api/retrato-catalogo.test.ts` e `rotas.test.ts`.

## Garantias de teste
- `domain/indice-busca.test.ts`: 30 consultas (typos, sinônimo, código, EAN, aplicação com ano, referência cruzada) dão **os mesmos itens, a mesma ordem, o mesmo total e as mesmas notas** com e sem pré-seleção.
- `api/busca-volume.db.test.ts` (só no CI, 20 mil produtos): EXPLAIN do preço e do estoque sem `Seq Scan`; o segundo pedido não faz consulta de produto; a gravação do Catálogo descarta o retrato; p95 do caminho da busca (índice + teto + preço/estoque + ranking) < 300 ms e a mesma primeira página do ranking sobre a lista inteira.
- Meta fina por requisição HTTP: carga da T-0107 (`MACUXI_CARGA_MEDIR=1`).

- `domain/indice-busca.test.ts` (teto): primeira página igual com teto de 60 nas 30 consultas, estoque decide o empate, código exato nunca é cortado, `temEstoqueParaBusca` = estoque do documento do ranking.

## Limites conhecidos
- A primeira busca de um tenant (ou logo depois de uma gravação do Catálogo, que descarta o retrato) espera a leitura do catálogo e a montagem do índice em pedaços; as outras requisições seguem atendidas durante a montagem.
- O retrato fica na memória do processo (até 20 tenants); com várias instâncias cada uma tem o seu, todas expiram em 60 s.
- `catalogo.busca_produtos@1` na API (`consultas-texto.ts`) lê `produto_referencia` e acha pelo código do concorrente, mas **não é rota quente** (nada no servidor a chama) e ranqueia o catálogo inteiro a cada chamada, sem índice nem cache. Quem ligar no servidor precisa antes passar pelo índice e pelo retrato (R-20261108-182924). Não foi removida porque o manifesto a oferece e o SDK exige a implementação de toda consulta oferecida (ADR 0012).

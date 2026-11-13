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
- Medido no CI da v1.0.4 (retrato renovado em segundo plano, índice em pedaços): p95 de 244 ms com 20 mil produtos; no CI 43112502352 oscilou de 244 a 385 ms entre ensaios (variação da máquina). **Meta: p95 de 300 ms**; **teto do teste: 2000 ms**, guarda contra a volta do travamento (antes: 15 a 20 s); a meta é acompanhada pelo número impresso (`[T-0119] p95 ...`). O caso deixou de ser `it.fails`.

## Retrato × gravação (🟡 R-20261108-183906)
O retrato tem **geração por tenant**: cada descarte a incrementa; a carga anota a geração ao começar e só guarda o resultado se ela não mudou (e se ainda é a carga registrada). A rota descarta **antes** da gravação (repositório) e **depois** do commit (`aposGravar`, chamado quando `ctx.comTenant` termina, também em falha). Quem pediu a carga velha recebe o que leu, mas ela não vira retrato. Testes em `api/retrato-catalogo.test.ts` e `rotas.test.ts`.

## Garantias de teste
- `domain/indice-busca.test.ts`: 30 consultas (typos, sinônimo, código, EAN, aplicação com ano, referência cruzada) dão **os mesmos itens, a mesma ordem, o mesmo total e as mesmas notas** com e sem pré-seleção.
- `api/busca-volume.db.test.ts` (só no CI, 20 mil produtos): EXPLAIN do preço e do estoque sem `Seq Scan`; o segundo pedido não faz consulta de produto; a gravação do Catálogo descarta o retrato; p95 do caminho da busca (índice + teto + preço/estoque + ranking) abaixo do teto de regressão de 2000 ms e a mesma primeira página do ranking sobre a lista inteira.
- Meta fina por requisição HTTP: carga da T-0107 (`MACUXI_CARGA_MEDIR=1`).

- `domain/indice-busca.test.ts` (teto): primeira página igual com teto de 60 nas 30 consultas, estoque decide o empate, código exato nunca é cortado, `temEstoqueParaBusca` = estoque do documento do ranking.

## Limites conhecidos
- A primeira busca de um tenant (ou logo depois de uma gravação do Catálogo, que descarta o retrato) espera a leitura do catálogo e a montagem do índice em pedaços; as outras requisições seguem atendidas durante a montagem.
- O retrato fica na memória do processo (até 20 tenants); com várias instâncias cada uma tem o seu, todas expiram em 60 s.
- `catalogo.busca_produtos@1` na API (`consultas-texto.ts`) lê `produto_referencia` e acha pelo código do concorrente, mas **não é rota quente** (nada no servidor a chama) e ranqueia o catálogo inteiro a cada chamada, sem índice nem cache. Quem ligar no servidor precisa antes passar pelo índice e pelo retrato (R-20261108-182924). Não foi removida porque o manifesto a oferece e o SDK exige a implementação de toda consulta oferecida (ADR 0012).

# Auditoria da busca de produtos no aparelho (T-0167, v1.0.5)

Escopo: a consulta `catalogo.busca_produtos@1`, o índice FTS5 (`catalogo__busca`), o ranking, o cache e a reserva `searchProducts` do Vendedor. A busca da API (acima) é outra rota e não mudou.

## Como a busca funciona hoje
- **Campos do índice** (`app/indice.ts`, pesos do `bm25`): código (`sku` 10, `ean` 10, `codigos` 8, `referencias` 8), nome/descrição 1 (5), marca (3), categoria (2), aplicação/descrição 2 (2), atributos (1). Os quatro campos pedidos (código, descrição 1, descrição 2, marca) estão todos no índice e no ranking; testes em `app/busca-paginada-aparelho.test.ts`.
- **Caminho:** `produtosLocais` (catálogo montado uma vez por versão do sync) → `preselecionar` (FTS5: os termos juntos, ou termo a termo com sinônimos, prefixo de 4/3 letras para erro de digitação; no máximo 400 candidatos) → `comAplicacao` (lê a descrição 2 só dos candidatos, com memória de 800 por versão) → `rankear` do domain (o mesmo da vitrine). Catálogo até 500 produtos: sem FTS5, o ranking varre tudo.
- **Cache:** catálogo, vocabulário, sinônimos e aplicações lidas ficam em memória chaveados pela versão das linhas (`versaoLinhas`); o resultado da busca não é guardado, e agora não precisa: a tela guarda a lista ranqueada e pagina nela.

## Achados da auditoria
1. **Sem paginação:** a tela pedia `limite: 100` e mostrava 40; do 41º em diante o item nunca aparecia. Corrigido: a consulta devolve a lista inteira (até 400) e a tela mostra 20 por vez.
2. **5.000 `produto_ids` por busca** enviados só para dizer o que o cliente pode comprar, e o ranking varria esses 5 mil (≈0,3 a 1 ms por produto, ou seja 1,5 a 5 s no aparelho acima de 500 produtos). Corrigido: `cliente_id` na entrada; o filtro (preço vigente na tabela do cliente, RN-CAT-06) corre dentro da consulta, **depois** da pré-seleção e só sobre os candidatos (o preço é lido só deles).
3. **2ª consulta para a aplicação** (`textos_produto@1`) a cada busca. Corrigido: o item traz `aplicacao`, que a consulta já tinha lido para ranquear.
4. **Código exato sem garantia de 1º lugar:** o ranking já pontua bem o código, mas o EAN/SKU digitado inteiro podia ficar atrás de produto com nota maior (campanha, mais vendido). Corrigido: SKU, EAN ou código alternativo idêntico ao texto (sem acento, caixa, hífen e espaço) vem em 1º; é a única mudança de ordem, o resto do ranking é o mesmo (testes atuais intactos).
5. **Consulta de 1 e 2 letras** rodava o FTS5 e o ranking à toa. Corrigido: a regra `buscaPodeRodar` (3 caracteres, sem contar espaços) está no domain; a consulta devolve vazio sem ler o catálogo.
6. **Sem ajuda quando nada casa.** Corrigido: `sugestao` ("Você quis dizer…") com o termo mais próximo do vocabulário.
7. **Pendência (SDK):** o vocabulário da sugestão vem dos termos de nome, marca e categoria do catálogo em memória, não da tabela `catalogo__busca_vocab`: o contexto da consulta do SDK não expõe SQL nem o vocabulário do índice. Ver o recado ao engenheiro-software.

## Contrato (aditivo, `catalogo.busca_produtos@1` segue @1)
- Entrada: `cliente_id` (vendáveis do cliente, no lugar de `produto_ids`) e `lista_completa: true` (a lista ranqueada inteira, até o teto de 400; `limite` segue com máximo 200).
- Saída: `total` (casaram, até 400), `sugestao` (só quando nada casou) e, por item, `aplicacao`.
- Domain (`domain/busca-consulta.ts`, usados pelo app): `MINIMO_CARACTERES_BUSCA` (3), `TAMANHO_PAGINA_BUSCA` (20), `TETO_RANKING_BUSCA` (400), `buscaPodeRodar`, `paginaDaBusca(total, paginas)` ("Mostrando 20 de 87"), `codigoExatoNoTopo`, `sugerirTermo`.

## Medição (PC, SQLite/FTS5 real com 20 mil produtos)
O PC não é um Android: o benchmark (`app/desempenho-busca.test.ts`, `MACUXI_DESEMPENHO=1`) usa o motor SQLite do Node com o índice, a migração e o ranking reais do app. **A medição no aparelho de entrada fica para o teste do dono do produto.** Metas: p95 < 300 ms nos 20 primeiros e < 50 ms no "+ Mostrar mais".

**Rodada de 12/11/2026 (PC do desenvolvimento, 20 mil produtos, aplicação de ~500 caracteres, `MACUXI_APLICACAO=500`):**
- A máquina estava saturada por outros agentes (o `tsc` do pacote levou mais de 15 minutos; o controle do próprio teste, "ranking por produto", deu 2,9 ms contra a referência de 0,3 ms, cerca de 10 vezes mais lento; indexar 20 mil levou 633 s). **Estes números não valem como medida das metas**; servem como comparação relativa na mesma rodada.
- Mesma rodada, código da aba sem alteração (`buscarLocal`): p95 das medianas 19.007 ms. Consulta antiga `limite: 20` (C9): p95 13.902 ms, mediana 10.568 ms por consulta.
- **Consulta nova, lista completa de 400 (`lista_completa`), sem `produto_ids`:** p95 30.469 ms, mediana 13.658 ms. Custo relativo: cerca de +30% sobre a consulta de 20, porque o "Serve em" é calculado para até 400 itens e não para 20.
- **"+ Mostrar mais" (fatia da lista já ranqueada, sem consulta):** p95 28,8 ms mesmo na máquina saturada; o trabalho é um `slice` de 20 itens, então o orçamento de 50 ms se sustenta.
- Código exato: SKU `P100010` voltou em 1º. "Você quis dizer": a 1ª sugestão (monta o vocabulário de 20 mil produtos) levou 18.176 ms nesta máquina; a 2ª, com o vocabulário memorizado, 482 ms; devolveu "pastilha" para "pstlha".
- **Leitura:** a aba (código inalterado) ficou tão lenta quanto a consulta nova, então a lentidão absoluta é da máquina saturada, não da mudança; o que a rodada mostra é o custo relativo (+30% com a lista de 400) e que o "+ Mostrar mais" não consulta nada. **A meta de 300 ms nos 20 primeiros não ficou comprovada** e deve ser conferida numa rodada com a máquina livre e, de fato, no aparelho do dono do produto. Se a consulta de 400 estourar no aparelho, a saída é calcular o "Serve em" só da página aberta (hoje o contrato o devolve para todos os itens), com um campo/chamada nova; não foi feito aqui para não ampliar o contrato além do aprovado.
- Para repetir com a máquina livre: `MACUXI_DESEMPENHO=1 pnpm --filter @macuxi/catalogo exec vitest run app/desempenho-busca.test.ts` (opcionais `MACUXI_APLICACAO=2000`, `MACUXI_TIMEOUT_MS=1800000`). A linha `[desempenho T-0167]` traz os 20 primeiros, o "+ Mostrar mais" e a sugestão.

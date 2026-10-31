# Catálogo — regras (domain)

Implementação: `modules/catalogo/domain/` (funções puras, sem I/O; rodam no app offline, na web e na API). Cada arquivo tem um `*.test.ts` com os casos abaixo (`it('RN-CAT-xx: ...')` / `RF-CAT-xx`). Contratos Zod: `modules/catalogo/contracts/` (`busca.ts` novo; `index.ts` com `ProductPrice`, `Product`, etc. mantidos como estavam). A API sempre revalida.

Convenções: dinheiro em **centavos inteiros** (ADR 0002); instantes em **ISO 8601 UTC** (`...Z`); **dia = dia civil no fuso do tenant** (`America/Manaus` por padrão, `localDate` de `@macuxi/comum`); produto base (`ProductBase`: `erp_code`, `description`, `brand`, `line`, `unit`, `ean`) é do **Core** (ADR-0005): o Catálogo enriquece por `product_id`, não duplica. Palavras em **premissa** são decisões minhas onde o doc não decidiu: estão reunidas no fim para o Alexandre confirmar.

## Origem das regras
| ID | Texto (doc 02/03) | Onde está implementada |
|---|---|---|
| RF-CAT-01 | Busca em linguagem natural: filtros (categoria, marca, atributo, preço, estoque) + ranking híbrido texto + semântico | `consulta.ts` (regras sem LLM), `ia.ts` (porta de LLM + contingência), `ranking.ts` |
| RF-CAT-02 | Busca offline: tolerância a erro de digitação, sinônimos do tenant, código, EAN; aviso discreto | `texto.ts`, `ranking.ts`, `consulta.ts` (código/EAN), `ia.ts` (`AVISO_BUSCA_OFFLINE`) |
| RF-CAT-03 | Ficha: preço da tabela do cliente em contexto, estoque disponível com hora da atualização | `preco.ts`, `estoque.ts` |
| RF-CAT-05 | Pergunte ao catálogo: só dados cadastrados, cita a fonte; sem base → "não encontrei" | `pergunte.ts` |
| RF-CAT-07 | BKO: sinônimos, termos sem resultado | contrato `Sinonimo`; ações do manifesto |
| RN-CAT-01 | Busca só responde com produtos do tenant e respeita o escopo (preço da tabela do cliente) | `ia.ts` (`validarFiltrosLlm`), `limite-ia.ts` (chave de cache com tenant), `preco.ts`, `estoque.ts` |
| RN-CAT-02 | "Pergunte ao catálogo" só com conteúdo cadastrado e fonte; sem base → "não encontrei" | `pergunte.ts` |
| RN-CAT-03 | Limite de consultas de IA por usuário/dia [200] | `limite-ia.ts` |
| RN-VEN-01 / RN-VEN-02 | Preço base = tabela vigente do cliente; sem preço = não vendável; arredondamento em centavos, meia para cima | `preco.ts` |
| RN-VEN-20 | Disponível = saldo − reservas (reserva é do Vendedor) | `estoque.ts` mostra o saldo do ERP; reserva fica no Vendedor |
| Doc 03 §2 | Matriz de permissões (não tem linha do Catálogo; ver premissa P-1) | `manifest.ts` (`acoes`) |

## Parâmetros do tenant (`parametros.ts`, `resolverParametros(parcial)`)
O esquema e os padrões vêm de `ParametrosCatalogo` (contracts), para app, web e API usarem os mesmos valores; valor fora da faixa lança `RangeError` em português.

| Parâmetro | Padrão | Onde entra | Regra |
|---|---|---|---|
| `limite_consultas_ia_dia` | 200 (0 desliga a IA) | `registrarConsultaIa`, `consultasRestantes` | RN-CAT-03 (doc 03) |
| `fuso` | America/Manaus | `diaDoTenant` (virada do dia do limite) | doc 03 (Fuso horário) |
| `estoque_baixo_ate` | 10 | `faixaDeEstoque`, `estoqueVisivel` | RF-CAT-03 (premissa P-4) |
| `estoque_mostrar_quantidade` | sim | `estoqueVisivel` | RF-CAT-03 (premissa P-5) |
| `estoque_defasado_horas` | 24 | `estoqueVisivel` (`stale`) | RF-CAT-03 (premissa P-6) |
| `cache_ttl_s` | 600 (0 desliga) | `cacheValido`, `deveGuardarNoCache` | RF-CAT-01 (premissa P-8) |
| `cache_min_ocorrencias` | 2 | `deveGuardarNoCache` | RF-CAT-01 (premissa P-8) |
| `peso_semantico` | 0,4 | `combinarNotas` | RF-CAT-01 (premissa P-9) |
| `peso_estoque` / `peso_mais_vendido` / `peso_campanha` | 0,10 / 0,10 / 0,05 | `notaFinal` | RF-CAT-01 (premissa P-9) |
| `pergunte_max_fontes` / `pergunte_max_caracteres` | 6 / 6000 | `montarContextoPergunte` | RN-CAT-02 (premissa P-10) |

## 1. Normalização do texto de busca — RF-CAT-02 (`texto.ts`)
- `normalizarTexto`: minúsculas, sem acento, pontuação vira espaço. **Medidas numa forma única**, sempre na menor unidade inteira da grandeza: volume em `ml` (`l`, `lt`, `lts`, `litro(s)` ×1000), peso em `g` (`kg`, `quilo(s)` ×1000), comprimento em `cm` (`m`, `metro(s)` ×100) e `mm`, contagem em `un` (`und`, `unid`, `unidade(s)`); embalagens `caixa(s)` → `cx`, `pacote(s)` → `pct`.
- Exemplos: `2 L` = `2lt` = `2 litros` = `2000 ml` → `2000ml`; `500ml` = `0,5 l` = `0.5 litro` → `500ml`; `1 kg` → `1000g`; `1,5 quilos` → `1500g`; `12 unidades` → `12un`; `caixa 12` → `cx 12`; `12x500ml` → `12 x 500ml`.
- Número: vírgula é decimal; ponto é milhar só quando segue 1–3 dígitos (parte inteira ≠ 0) e tem 3 casas (`1.500 ml` → `1500ml`; `0.500 l` → `500ml`). Número sem unidade não muda (`pilha aa 4`).
- `tokensDeBusca`: tira stopwords (`de`, `do`, `com`, `para`, `até`…) e põe no **singular simples**: `-ões/-ães` → `-ão`, `-ais/-eis` (5+ letras) → `-al/-el`, `-res/-zes` → sem `es`, `-s` final cai (não em `-ss`, `-us`, `-is`); medidas e números não mudam. Ex.: `sabões` → `sabao`, `flores` → `flor`, `papéis` → `papel`, `detergentes` → `detergente`. A mesma função vale para o índice e para a consulta, então imperfeições do plural se anulam.
- `expandirSinonimos(consulta, sinonimos)`: devolve **grupos de alternativas** (dentro do grupo vale "ou", entre grupos vale "e"). Sinônimo do tenant vale **nos dois sentidos** (grupo `amaciante ↔ suavizante`), pode ter **mais de uma palavra** (`água sanitária ↔ cloro ↔ alvejante`; casa a frase mais longa primeiro) e sinônimo inativo é ignorado. Ordem determinística: a alternativa original primeiro, as outras em ordem alfabética. Ex.: `cloro 1 litro` → `[['cloro','agua sanitaria','alvejante'], ['1000ml']]`.

## 2. Interpretação da consulta sem LLM — RF-CAT-01, RF-CAT-02 (`consulta.ts`)
`interpretarConsulta(texto, vocabulario)` devolve `FiltrosInterpretados` (`text`, `brand`, `line`, `min_price_cents`, `max_price_cents`, `stock`, `code`, `measures`, `sort`). É a contingência da busca inteligente (limite, falha, offline) e a parte que o LLM não pode contradizer.
- **Código/EAN exato.** Palavra com **dígito verificador GTIN válido** (EAN-8/12/13/14) → `code {ean}` e sai do texto (`detergente 7891000100103` → ean + texto `detergente`). Consulta de **uma palavra só** com dígito, 3–30 caracteres `A-Z 0-9 . _ - /` (e 4+ dígitos se só números), que não seja medida → candidato a `code {sku}` em caixa alta (`det-5l` → `DET-5L`). Número com dígito verificador errado é só candidato a SKU. `2l`, `500ml`, `5`, `detergente` não são código. O texto normalizado continua em `text` para o caso de o código não existir (a API tenta o código exato; se não achar, busca por texto).
- **Marca** (vocabulário do tenant, `VocabularioTenant.marcas`): reconhecida sem acento e sem diferença de caixa, com ou sem a palavra "marca"/"fabricante" (`amaciante limpex`, `sabao ype 1kg`, `azeite marca Dona Maria`). Marca fora do vocabulário **não** vira filtro (RN-CAT-01). Devolve a grafia cadastrada; marca de várias palavras casa antes da de uma.
- **Categoria/linha** (`VocabularioTenant.linhas`): só com palavra de apoio (`categoria`, `linha`, `departamento`, `setor`): `linha detergentes neutro` → `line: Detergentes`, texto `neutro`. Sem a palavra, continua texto (premissa P-2).
- **Preço** (centavos): máximo — `até`, `por até`, `menos de`, `abaixo de`, `no máximo`, `inferior a`; mínimo — `a partir de`, `acima de`, `mais de`, `no mínimo`, `superior a`; faixa — `entre X e Y` e `de X a Y` (esta só se um dos valores for explícito `R$`/`reais`). Valores `R$ 10`, `10 reais`, `10,50`, `1.299,90`; `entre 10 e 5` vira 5–10. **Número seguido de unidade ou embalagem não é preço** (`até 5 litros`, `até 3 caixas`). Valor `R$` solto, sem palavra de apoio, não filtra mas sai do texto.
- **Estoque**: `com estoque`, `em estoque`, `tem/tenha estoque`, `disponível` → `com`; `sem estoque`, `esgotado`, `em falta` → `sem`.
- **Ordenação**: `mais barato`, `menor preço`, `mais em conta`, `barato` → `preco_asc`; `mais caro`, `maior preço` → `preco_desc`. `cliente atual` sai do texto (o cliente vem do contexto da requisição).
- **Medidas** canônicas ficam em `measures` e também no texto (reforçam o ranking). O que sobra é o `text` normalizado.
- Exemplos: `detergente neutro 5 litros com estoque` → texto `detergente neutro 5000ml`, `stock: com`, `measures: ['5000ml']`. `o mais barato da marca Limpex para o cliente atual` → `brand: Limpex`, `sort: preco_asc`, texto vazio. `sabão entre R$ 5 e R$ 10` → 500–1000 centavos, texto `sabao`.

### Porta de LLM e contingência (`ia.ts`)
- Portas (interfaces; implementação real em `modules/catalogo/api/ia/`, fakes nos testes): `PortaInterpretacaoLlm.interpretar`, `PortaRespostaLlm.responder`, `PortaEmbeddings.gerar`.
- `interpretarBusca`: **offline** → regras + aviso `A busca inteligente volta quando houver internet.`; **limite atingido/IA desligada** → regras + a mensagem do limite; **sem porta** → regras; **provedor falhou** ou **resposta inválida** → regras + `AVISO_BUSCA_FALHOU`, sem lançar erro; **ok** → regras mescladas com o LLM (`origem: llm`).
- `validarFiltrosLlm` (RN-CAT-01): Zod; marca/categoria que o tenant não tem **são descartadas** (volta a grafia cadastrada); EAN só com dígito verificador; texto passa pela mesma normalização.
- `mesclarFiltros`: o que a frase diz de forma explícita (regras: código, preço, estoque, marca) **vence** o LLM; o LLM completa o que faltou; faixa invertida pela mistura é desfeita.
- Ordem na API: **cache (não consome) → `registrarConsultaIa` → `interpretarBusca`**. `chamouProvedor` diz se a chamada foi feita.

## 3. Ranking híbrido — RF-CAT-01, RF-CAT-02 (`ranking.ts`)
- **Pontuação textual** (`pontuacaoTextual`, 0..1): para cada grupo de alternativas da consulta, o melhor acerto entre alternativas e campos; o total é a média dos grupos (cobrir todos os termos pontua mais que cobrir parte). Acerto = nível × peso do campo. **Nível**: palavra inteira 1,0; prefixo de 3+ letras 0,7; erro de digitação 0,5 (distância de edição com transposição ≤ 1 para palavras de 4–7 letras, ≤ 2 para 8+; palavra curta, medida e código **não** aceitam erro). **Peso do campo**: nome 1,0; código/EAN 1,0; marca 0,6; categoria 0,4; atributos/aplicações 0,3. Número solto não basta: `televisão 50` não acha `Saco 50 L`.
- **Combinação**: base = (1 − w) × texto + w × semântica (`w = peso_semantico`, padrão 0,4; nota semântica limitada a 0..1). Sem notas semânticas, a base é só o texto. Quando o mapa de notas tem alguma nota, quem não tem leva 0.
- **Boosts** (somam à base **só se base > 0**; nunca ressuscitam produto sem relevância): `+0,10` se tem estoque; `+0,10 × vendas ÷ maior venda dos candidatos`; `+0,05` se campanha/destaque. Nota final máxima ≈ 1,25.
- **Filtros estruturados** (`rankear`): marca e categoria (comparação sem acento/caixa/plural), faixa de preço (produto sem preço sai quando há filtro de preço), estoque. **Código exato**: se algum produto tem o SKU/EAN, só ele(s) volta(m), em primeiro lugar; se não existe e há texto, cai para a busca textual; se não existe e não há texto, a lista é vazia.
- **Desempate determinístico** (independe da ordem de entrada): código exato → nota final ↓ → nota textual ↓ → tem estoque → mais vendas → nome (sem acento, ordem de código) → `id`. Com `sort` de preço, o preço manda (sem preço por último) e o resto desempata na mesma ordem.
- Sem texto na consulta (só filtros), a base é 1 para todos e ordenam os boosts. Produto só entra no resultado se a nota final > 0.
- Teste de relevância: `relevancia.test.ts` (24 consultas de referência sobre um catálogo de 24 produtos, com o resultado esperado de cada uma). Ao achar caso ruim em produção (termos sem resultado, RF-CAT-07), acrescente aqui.

## 4. Preço visível — RF-CAT-03, RN-VEN-01, RN-VEN-02 (`preco.ts`)
`precoVisivel(produtoId, itensDeTabela, promocoes, { agora, tabela_condicao_id?, tabela_cliente_id? })` → `PrecoVisivel`.
- **Qual tabela**: 1) a da **condição de pagamento**, se tiver o item; 2) a do **cliente**; 3) a **padrão** do tenant (`price_table_id` nulo) **só quando não há cliente em contexto**. Cliente com tabela e item fora dela → **sem preço** (não cai na padrão): `sellable: false`, `reason: sem_preco` (RN-VEN-01). `source` diz `condicao | cliente | padrao`.
- **Vigência do item**: `valid_from` inclusivo, `valid_to` exclusivo, em UTC. Duas vigências ao mesmo tempo: vale a de **início mais recente**; empate, o **maior preço** (premissa P-3). Preço zero, negativo ou fracionado na tabela é ignorado.
- **Promoção vigente**: período `[valid_from, valid_to)` em UTC (a virada não depende do fuso do aparelho); `preco_fixo` (centavos) ou `desconto_pct` (até 2 casas, entre 0 e 100 exclusivos); promoção com `price_table_id` só vale para essa tabela, sem tabela vale para todas. Com várias vigentes vale a de **menor preço final** (não soma), empate pelo menor `id`. Promoção que não baixa o preço é ignorada. Sem preço na tabela, promoção não cria preço. `base_cents` guarda o preço da tabela (mostrar riscado) e `promotion_ends_at` o fim da promoção.
- **Arredondamento** (`descontoPct`): centavos inteiros, meia para cima, em aritmética inteira. R$ 9,99 com 10% = R$ 8,99 (899,1); R$ 0,05 com 10% = 5 centavos (4,5 sobe); R$ 10,00 com 12,5% = R$ 8,75.

## 5. Estoque visível — RF-CAT-03 (`estoque.ts`)
`estoqueVisivel(produtoId, saldos, { filiais, agora, parametros })` → `EstoqueVisivel`.
- **Por filial/depósito do usuário**: `filiais` = ids do vendedor; `null` = todas (analista, assistente, admin, RN-CORE-04). Vendedor **sem filial** vinculada vê `sem_estoque` (conservador). Saldo negativo do ERP conta 0; linhas repetidas da mesma filial somam; filiais ordenadas por nome e id.
- **Faixas**: ≤ 0 `sem_estoque`; de 1 até `estoque_baixo_ate` (10) `baixo`; acima `disponivel`. Há faixa total e uma por filial.
- **Sem número exato**: `estoque_mostrar_quantidade = false` → `quantity` nulo no total e em cada filial; só a faixa aparece.
- **Hora da atualização**: `updated_at` = a mais antiga entre as filiais visíveis; `stale = true` se passou de `estoque_defasado_horas` (24) ou se algum saldo não tem hora. O saldo é o do ERP; as **reservas** de pedido são descontadas pelo Vendedor (RN-VEN-20).

## 6. Limite de consultas de IA e cache — RN-CAT-03, RF-CAT-01 (`limite-ia.ts`)
- **Dia no fuso do tenant**: `diaDoTenant(agora, fuso)`. 31/10 03:59Z ainda é 30/10 em Manaus (UTC−4); 04:00Z já é 31/10. O contador zera na virada **local**.
- `registrarConsultaIa(uso, agora, parametros)`: permite até `limite_consultas_ia_dia` (a 200ª passa, a 201ª não) e devolve o novo estado e as restantes. Barrado → `motivo: limite_atingido` e mensagem *"Você atingiu o limite de buscas inteligentes de hoje. A busca simples continua disponível; o limite volta amanhã."*; limite 0 → `ia_desligada`. Barrado não consome. `consultasRestantes` só consulta.
- **O que consome** (premissa P-7): chamada ao provedor de LLM, mesmo se falhar. **Não consome**: resposta vinda do cache, busca offline, busca simples (modo `basica`/contingência).
- **Chave do cache** (`chaveCache`): `catalogo:cache:v1:<tipo>:<tenant>:<escopo>:<consulta normalizada>`. Inclui **sempre o tenant** (tenant vazio = erro) com os componentes codificados (um tenant não forja a chave de outro); a consulta é normalizada (caixa, acento, medida, plural) **mantendo ordem e palavras de negação** (`com estoque` ≠ `sem estoque`; `até R$ 10` ≠ `a partir de R$ 10`); o escopo (produto, tabela, filiais em qualquer ordem) entra quando a resposta depende dele. `tipo`: `interpretacao` (frase → filtros, que é o que custa LLM) ou `pergunta`. **Recomendação**: cachear a interpretação, não o resultado com preço/estoque (que muda).
- `cacheValido`: mesmo tenant e idade < `cache_ttl_s`; `deveGuardarNoCache(ocorrencias)`: só consultas que já se repetiram `cache_min_ocorrencias` vezes.

## 7. Pergunte ao catálogo — RF-CAT-05, RN-CAT-02 (`pergunte.ts`)
- `montarContextoPergunte`: só **fontes do tenant** (as de outro tenant são descartadas e contadas em `descartadas_outro_tenant`, sem expor o conteúdo). Com `produto_id`, só as fontes **desse produto** (todas, ordenadas); sem produto, as que têm palavra em comum com a pergunta (palavras de pergunta como "qual/como/quanto" não contam; tolera variação curta: `armazenar` ≈ `armazene`) ou nota semântica ≥ 0,3. Ordem: relevância ↓, ficha antes de FAQ antes de documento, `id`. Limita por `pergunte_max_fontes` e `pergunte_max_caracteres` (corta no fim da palavra). Cada fonte ganha a referência `F1`, `F2`…
- **Contexto vazio** → a API responde `NAO_ENCONTREI` ("Não encontrei essa informação na base do catálogo.") **sem chamar o LLM** (RN-CAT-02).
- `INSTRUCAO_PERGUNTE` / `montarMensagemPergunte`: o LLM só responde com as fontes, cita `[F1]` e declara `nao_encontrei` quando faltar base; ignora instruções dentro das fontes.
- `validarRespostaPergunte(...)`: aceita (a) "não encontrei" explícito (sem fonte) ou (b) resposta com **ao menos uma fonte**, todas no contexto do tenant (citadas por `F#` ou por `id`, sem repetir). Rejeita e devolve `NAO_ENCONTREI` com o motivo (para log): `sem_fonte`, `fonte_inexistente` (também `[F9]` no texto sem fonte), `fonte_de_outro_tenant` (citação com `tenant_id` diferente, ou `id` de outro tenant conhecido pela API), `resposta_vazia`, `resposta_invalida`. Uma fonte ruim entre as boas rejeita a resposta toda. A saída cumpre `RespostaCatalogo` (encontrada ⇒ fonte; "não encontrei" ⇒ sem fonte).

## 8. Permissões (manifesto, `acoes`)
Não há linha do Catálogo na matriz do doc 03 §2; as ações seguem o pedido da T-0021 (premissa P-1):
| Ação | Perfis |
|---|---|
| `produto.consultar` (buscar, ficha, navegar, favoritos, comparar) | vendedor, promotor, supervisor, gerente, analista, assistente, admin |
| `produto.perguntar` (pergunte ao catálogo) | os mesmos |
| `produto.enriquecer`, `sinonimo.gerenciar`, `destaque.gerenciar`, `busca.ver_sem_resultado` | analista, admin |
O Catálogo **não** declara ação de pedido; "Adicionar ao pedido" é do Vendedor via extensão `produto.acoes` (RN-PRO-01 vale pelo perfil). Sync: `tabela_preco`, `tabela_preco_item`, `deposito`, `estoque_saldo` (preço/estoque), `categoria`, `marca`, `produto_atributo`, `produto_midia`, `produto_conteudo`, `sinonimo` (conteúdo e busca); **`produto` não** (é do Core). Consome só `integracao.preco.atualizado@1` e `integracao.estoque.atualizado@1`.

## Premissas para o Alexandre confirmar
- **P-1 Matriz de permissões**: o doc 03 §2 não tem linha do Catálogo. Assumi consulta e "pergunte" para todos os perfis do módulo (inclui `admin`, que passou a constar em `perfis` do manifesto para cadastrar conteúdo no BKO) e conteúdo/sinônimos/destaques/termos sem resultado só para analista e admin. Sugestão: o gerente-projetos acrescentar a linha na matriz.
- **P-2 Categoria só com palavra de apoio** ("categoria", "linha"…): sem ela o termo fica no texto (evita filtrar errado sem LLM). Marca por vocabulário dispensa a palavra de apoio.
- **P-3 Preço**: cliente com tabela e item fora dela = sem preço (sem fallback para a padrão); duas vigências simultâneas = início mais recente, empate maior preço; a tabela da condição prevalece sobre a do cliente quando tem o item.
- **P-4 Faixa "baixo"** = até 10 unidades (parâmetro). **P-5** o número exato de estoque aparece por padrão (o RF-CAT-03 pede "estoque disponível"); o tenant pode esconder. **P-6** "estoque desatualizado" após 24 h.
- **P-7 Limite**: a chamada ao provedor conta mesmo se falhar; cache e busca simples não contam.
- **P-8 Cache**: 10 min; só consultas repetidas (2+); recomendação de cachear a interpretação, não o resultado.
- **P-9 Pesos do ranking** (semântico 0,4; estoque 0,10; mais vendido 0,10; campanha 0,05) são ponto de partida, ajustáveis por tenant e por medição.
- **P-10 Pergunte**: até 6 fontes / 6.000 caracteres por pergunta; com `produto_id` só o conteúdo desse produto (conteúdo geral sem produto só entra na pergunta sem produto).
- **P-11 Dados que o ranking precisa**: `vendas` recentes e `campanha`/destaque virão de cálculo/cadastro ainda sem tabela; o `banco-dados` precisa definir quando o schema `catalogo` for desenhado (não é desta tarefa: sem banco).

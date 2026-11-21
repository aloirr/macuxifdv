# Auditoria da busca do Catálogo × modelo do Catálogo BAP online (R-20261120-204347)

Auditoria só de leitura, feita em 20/11/2026, das 20h45 às 21h40 de Manaus, sobre o `main` em `c2522b4`. Ela continua a
`investigacao-busca-bap-palio.md`. Nenhum código de produção nem teste foi alterado.

**Como foi medido:** um roteiro fora do repositório chama `interpretarConsulta` → `buscarProdutos` com produtos de teste. A
mesma busca roda com e sem a pré-seleção do índice (`candidatosDaBusca`), e os resultados foram iguais em todos os casos. Os
testes da busca estão verdes na sessão: 9 arquivos e 223 testes (`domain/busca-dinamica`, `aplicacao-busca`, `ranking`,
`ranking-aplicacao`, `indice-busca`, `referencia-cruzada`, `texto`, `consulta` e `app/busca-produtos-aparelho`).

## Resumo para o Alexandre
1. **O app já segue a base do modelo.** É uma função só para a busca online, a do aparelho e o seletor do pedido
   (`rankear`, chamada por `buscarProdutos`). Ela usa E entre palavras e OU entre campos, acha código com espaço ou
   pontuação, referência com e sem marca e EAN, e põe o código exato em 1º. Nesses casos, o app passa nos testes do §9.
2. **Ele erra onde o modelo é mais cuidadoso:** palavra inteira ("gol" traz o Golf), modelo derivado, faixas de ano e apelidos
   de montadora (casos no §5).
3. **A lista vazia (R-20261120-194335) depende de duas correções antes.** Hoje "vw gol 2018" e "2018 gol vw" só acham o Gol
   porque o app mostra os mais próximos: ninguém casa "vw". Com a lista vazia, essas buscas ficam vazias, e "civic 2008" fica
   vazia quando a única peça é a do "Civic 2007 até 2011". Por isso os apelidos de montadora e as faixas de ano entram antes
   dela (etapas 1 e 2 do §4).
4. **"BAP amortecedor palio":** o diagnóstico está na `investigacao-busca-bap-palio.md`, §2. Com a lista vazia, o C2 e o C3
   ficam vazios (§5).
5. **Placa e filtro de veículo são os maiores ganhos para o balcão e os mais caros.** Eles dependem de decisão sua (§6).

## 1. Comparação item a item (§1 a §8 do modelo)
| Item | Como o app faz | Como o site faz | Ganho esperado | Esforço (+15%) |
|---|---|---|---|---|
| §1 Dados | SKU, EAN, código ERP, nome, marca, categoria, atributos, descrição (400 caracteres), aplicação em texto livre e até 3 referências (marca + código). Não tem veículo estruturado, ano, montadora nem a taxonomia sistema/família/posição/lado. | Tudo isso, mais veículo estruturado (`ve`), anos (`an`), montadora e taxonomia. | Alto para filtro de veículo (§4); nenhum para a busca de texto, que já lê a aplicação. | Depende do que o ERP da AM2808 envia. Não estimado aqui: vai ao `modulo-integracao`. |
| §2 Índice na carga | Os termos de cada produto saem na carga (`TOKENS_DO_PRODUTO`, T-0119). O FTS5 do aparelho indexa SKU, EAN, códigos, nome, marca, categoria, atributos, aplicação e referências. A aplicação é analisada na hora da busca, com memória de 800 entradas. | Todos os campos normalizados na carga, com apelidos de montadora, códigos extraídos das referências, faixas de ano e "é nome de veículo" tirado da própria base. | Alto nos apelidos ("vw gol"). Médio em "é veículo" (base das etapas 3 e 4). Baixo no resto: o FTS5 já faz o pré-filtro. | Apelidos: ~1h15 (etapa 1). "É veículo": entra na etapa 3. |
| §3.1 Palavras | Normaliza (minúsculas, sem acento). Toda pontuação vira espaço. Tira as palavras vazias (`de`, `para`, `pra`, `até`, `com`, `sem`…) e põe no **singular**. | Separa por espaço, vírgula e ponto e vírgula. Hífen entre letras vira espaço, e hífen com número fica. Tira só os conectivos. Não usa singular. | Médio: o singular faz "polo" casar "polos". | Entra na etapa 3. |
| §3.2 E/OU | Cada palavra (ou grupo de sinônimos) casa em qualquer campo. Fica quem casa com mais palavras. | Igual: todas as palavras precisam casar. | — (já igual) | 0 |
| §3.3 Vizinhas juntas | Junta 1 a 3 palavras com número e compara com o SKU e as referências ("CXD 13062", "TRW 16900255S"). Não junta no texto nem na aplicação ("space fox" não acha "SpaceFox"). | Junta até 6 palavras em código e em texto. Letra solta só vale junto ("L 200"). | Médio (nomes de veículo grudados). | Entra na etapa 4. |
| §3.4 Palavra inteira | Começo de palavra com 3+ letras em **todos** os campos, inclusive a aplicação ("gol" → Golf). Aceita erro de digitação de 1 ou 2 letras no nome, código, marca, categoria e atributos, mas não na aplicação. | Palavra inteira. Começo de palavra só no texto, com 4+ letras, nunca na aplicação nem em nome de veículo. Não aceita erro de digitação. | **Alto**: Golf no lugar do Gol é erro de balcão. | ~5h (etapa 3) |
| §3.5 Modelo derivado | Não tem: "fox" não acha CrossFox nem SpaceFox. | Casa o pedaço que existe sozinho na base (CROSS+FOX), com 3+ caracteres de cada lado. | Médio. | ~4h35 (etapa 4) |
| §3.6 Nota por campo | Peso por campo (nome 1, código 1, marca 0,6, aplicação 0,5 do parâmetro do tenant, categoria 0,4, atributos 0,3) × nível (exato 1, começo 0,7, digitação 0,5). Código exato é marcado à parte e vai ao topo. | Escala de 1000 a 5 por campo. | Baixo (ver §3). | Não trazer. |
| §3.7 Melhor caminho | Não tem. Cada palavra é um grupo (frases de sinônimo viram um grupo só). | Programação dinâmica escolhe a melhor cobertura. | Baixo: só muda quando um mesmo trecho pode ser lido como código ou como palavras. | Não trazer agora. |
| §3.8 Sem resultado completo | Mostra os que casam com mais palavras, **sem dizer** quais palavras faltaram (R-20261120-103142, v1.0.17). A decisão R-20261120-194335 (lista vazia) ainda não está no código. | Nunca lista vazia: mostra os mais próximos e avisa quais palavras não casaram. | Decisão do dono do produto (§6). | Lista vazia: ~2h40 (etapa 2, estimativa da investigação). Aviso das palavras: +~1h10. |
| §3.9 Código exato em 1º | Sim: SKU, EAN, código ERP, referência e n-grama de código vão ao topo. | Sim. | — (já igual) | 0 |
| §3.10 Ordem | Código exato → quem casa fora da aplicação → nota (com estoque, mais vendido e campanha) → estoque → vendas → nome. | Código exato → palavras casadas → nota → com foto → código. | — (ver §3) | Não trazer. |
| §3.11 Desempenho | FTS5 pré-seleciona até 400 candidatos quando há 2.000+ produtos. Memória com limite. | `includes` antes da regex, para ~4.400 produtos. | — (ver §3) | 0 |
| §4 Filtros e veículo | Chips de marca e categoria. Estoque e preço saem da frase. Não há filtro de veículo, cascata nem etiqueta "Compatível". | Sistema, família, linha e categoria com contagem. Veículo em cascata (marca, modelo, ano, motor, versão). "✓ Compatível" e "Leve também" só com o que serve. | **Alto** no balcão. | ~17h50 (etapa 6) |
| §5 Ano | 4 dígitos (19xx e 20xx). Lê faixa com "–", "-", "/" e " A ", e "em diante" com ">", "em diante" e "a partir de". Não lê "até"/"ATE", ">" entre anos, mês/ano, "→", "+", "../08", nem ano de 2 dígitos (parâmetro desligado). O fim da faixa aberta é ano atual + 1. Aceita 2035 e 1938 como ano. | Todos esses formatos, ano de 2 dígitos e ano válido entre 1950 e ano atual + 2. | **Alto**: "2007 até 2011" é o formato da própria BAP. | ~2h20 (etapa 1) |
| §6 Placa | Não tem. | Serviço próprio com a chave da API de placas, LGPD (sem URL, armazenamento local nem log), mensagens por erro e montadora/modelo traduzidos para o catálogo. | **Alto** no balcão, mas só online. | ~12h (etapa 7), mais o contrato com o provedor de placas |
| §7 Exibição | Nome como vem do cadastro. "Serve em" mostra o trecho da aplicação (em mudança na v1.0.18). Preço e estoque aparecem pelas RN-CAT-05/06/07. | Nome sem caixa alta, com as siglas mantidas. "2015+" e "2012–2016". Nunca mostra preço nem estoque. | Baixo (ver §3). | Não trazer agora. |
| §8 Manutenção | Uma função só para a busca online, a do aparelho e o seletor do pedido. Testes automáticos. "É veículo" não existe. | Uma função, "é veículo" tirado da base, normalização na carga e testes a cada mudança. | — (falta só o "é veículo", que vem na etapa 3) | 0 |

## 2. O que vale trazer
1. **Apelidos de montadora** (VW ↔ Volkswagen, GM ↔ Chevrolet ↔ Chevy, MB ↔ Mercedes-Benz). O mecanismo já existe: são os
   sinônimos do tenant, que valem em todos os campos e chegam ao aparelho. Basta uma lista padrão no domínio, somada aos
   sinônimos do tenant.
2. **Faixas de ano da BAP:** "até"/"ATE", ">" entre dois anos, mês/ano ("06/2008–06/2012"), "→" e "+", e o teto de ano atual
   + 2 para ano válido. Hoje "1998>2009" vira 1998–2027.
3. **Palavra inteira na aplicação,** com "é nome de veículo" tirado da própria base (regra de 5× mais aplicações que
   descrições). Começo de palavra só no texto, com 4+ letras, e na **última palavra enquanto o vendedor digita**. A busca do
   app roda a cada letra, e "amortecedor pal" precisa achar o Palio. O singular deixa de valer para nome de veículo.
4. **Modelo derivado e vizinhas juntas no texto** (CrossFox, SpaceFox, "space fox"), calculados na carga do índice.
5. **Filtro de veículo** (montadora, modelo e ano), lido da aplicação enquanto o ERP não manda o veículo estruturado, com a
   etiqueta "Compatível".
6. **Placa**, se você aprovar o serviço e o custo (§6).

## 3. O que não serve para o app
- **Escala de notas de 1000 a 5 (§3.6) e programação dinâmica (§3.7):** a ordem atual já põe o código exato em 1º e
  filtra por cobertura. Trocar a escala mexe em todos os testes de ordem sem ganho nos casos medidos.
- **Pré-filtro com `includes` (§3.11):** no aparelho, o FTS5 do SQLite faz esse papel com 20 mil produtos. A regex por
  produto custaria mais bateria.
- **Nunca mostrar preço nem estoque (§7):** no app de vendas, eles seguem as RN-CAT-05/06/07.
- **Ordem por "tem foto" (§3.10):** a foto não ajuda a vender a peça certa. Estoque e venda ajudam.
- **Placa offline:** a consulta de placa precisa de internet e da chave no servidor. Sem sinal, o campo de placa não aparece,
  e a busca por texto e o filtro de veículo continuam no aparelho.
- **Fonte de 16 px no campo (§9):** a regra do site evita o zoom do iPhone. O app é Android e usa 14 px no campo
  (`packages/ui`). O tamanho é do designer-ux; não muda a busca.
- **Lista de veículos com rolagem lateral:** a cascata cabe em 390 px numa folha que sobe da base da tela, um nível por
  vez.

## 4. Ordem de implantação
O esforço é o tempo de sessão, com testes e corretor, já com 15% de folga.

| Etapa | O que | Quem | Esforço | Por que nessa ordem |
|---|---|---|---|---|
| 1 | Apelidos de montadora no domínio e faixas de ano (§5) | modulo-catalogo, testes, corretor | ~3h35 (1h15 + 2h20) | Sem elas, a lista vazia esvazia "vw gol 2018" e as buscas por ano nas aplicações com "até" |
| 2 | Lista vazia (R-20261120-194335) ou "mais próximos com aviso" (decisão do §6) | modulo-catalogo, testes, corretor | ~2h40 (+~1h10 com o aviso) | Já decidida; depende da etapa 1 |
| 3 | Palavra inteira na aplicação, "é veículo" tirado da base e começo de palavra só na última palavra digitada | modulo-catalogo, testes, corretor | ~5h | Corrige "gol" → Golf e "polo" → "polos" |
| 4 | Modelo derivado e vizinhas juntas no texto | modulo-catalogo, testes, corretor | ~4h35 | Usa o "é veículo" da etapa 3 |
| 5 | Veículo estruturado e ano vindos do ERP | modulo-integracao, banco-dados | A levantar | Melhora a etapa 6 |
| 6 | Filtro de veículo em cascata e "Compatível" | engenheiro-software (contrato), modulo-catalogo, designer-ux, engenheiro-apps, testes, corretor | ~17h50 | Precisa do seu "sim" e do desenho da tela |
| 7 | Placa | engenheiro-software (serviço e chave), modulo-catalogo, designer-ux, testes, corretor | ~12h | Precisa do seu "sim", do provedor e da revisão de LGPD |

As etapas 1 a 4 somam **~15h50** (~17h00 com o aviso da etapa 2) e mexem só no domínio do Catálogo. A etapa 1 começa depois do lote da v1.0.18, que está em `modules/catalogo`
agora.

## 5. Casos do §9: app atual (medido) e proposto (esperado)
Produtos de teste: marca BAP, salvo indicação. A lista atual vem do roteiro; a proposta assume as etapas 1 a 4 e a lista vazia.

| Caso | Busca | App atual (resultado real) | Proposto (esperado) |
|---|---|---|---|
| Ordem | "gol 2018 volkswagen" | Amort. Gol G5 2014–2019 (casa as 3 palavras) | Igual |
| Ordem | "vw gol 2018" e "2018 gol vw" | Amort. Gol G5, mas casando só 2 de 3 palavras ("vw" não casa). **Com a lista vazia, fica vazia.** | Amort. Gol G5 (VW = Volkswagen) |
| Ordem | as 3 frases com "amortecedor gol 2007 kyb 441126" | Amort. Gol KYB 441126, nas 3 ordens | Igual |
| Código | "CXD 13062", "cxd13062", "CXD-13062" | O item do SKU CXD13062, em 1º, nas 3 | Igual |
| Referência | "TRW 16900255S" e "16900255S" | O pivô com a referência TRW, em 1º, nas 2 | Igual |
| EAN | "7891234567895" | O filtro com esse EAN | Igual |
| Palavra inteira | "gol" | Gol G5, Gol KYB **e Golf** | Gol G5 e Gol KYB |
| Palavra inteira | "polo" | Bucha Polo Classic **e Cabo de vela 4 polos** | Bucha Polo Classic |
| Começo de palavra | "homoc" | Junta homocinética | Igual |
| Derivado | "fox" | Coxim Fox e o item com "SPACE-FOX" no nome. **Sem CrossFox nem SpaceFox da aplicação.** | Fox, CrossFox e SpaceFox |
| Derivado | "space fox" | Só o item com "SPACE-FOX" no nome. **Sem o SpaceFox da aplicação.** | Os dois SpaceFox |
| Ano | "civic 2008" | Civic 2006> e Disco "Civic 07–11 · Fit 2003>". **Sem a Pastilha "Civic 2007 até 2011".** | Civic 2007 até 2011 e Civic 2006>, sem o Civic 1992–1995 |
| Ano | "civic 2015" | Civic 2006> e **o Disco do Civic 2007–2011**: o "·" não separa trechos, e o "Fit 2003>" vale para o Civic | Civic 2006> |
| Conectivo | "amortecedor para gol" = "amortecedor gol" | Mesma lista (com o Golf) | Mesma lista, sem o Golf |
| Sem resultado completo | "xyzqwk amortecedor" | Os 4 amortecedores (os mais próximos), sem aviso | **Lista vazia** (R-20261120-194335). No modelo: os amortecedores e o aviso "Não achamos 'xyzqwk'". |
| Placa | ABC1D23 | Não existe | Honda / Civic / 2008 / 1.8 / LXS, só peças compatíveis (etapa 7) |
| Celular 390 px | campo e listas | Não medido em aparelho nesta auditoria. | Cascata numa folha, sem rolar de lado (etapa 6) |
| Caso do Alexandre | "BAP amortecedor palio", C1 a C3 da investigação (§2.2) | Como na investigação (medido de novo, igual) | C1 igual; C2 e C3: lista vazia |

O filtro de marca funcionou: o Cofap nunca aparece na busca com "BAP". A palavra "BAP" vira filtro de marca, e não palavra que
pontua como no modelo. O resultado é o mesmo, porque o filtro também aceita a marca das referências cruzadas.

## 6. Decisões que o dono do produto precisa tomar
1. **Sem resultado completo:** manter a **lista vazia** (R-20261120-194335) ou seguir o modelo (mostrar os mais próximos e
   dizer quais palavras não casaram)? A recomendação é manter a lista vazia e só ligá-la depois da etapa 1. (Motivo no
   Resumo, item 3.)
2. **Apelidos de montadora:** lista padrão no código (vale para todo tenant) ou só sinônimos do tenant no BKO? A
   recomendação é a lista padrão, mais o que o tenant cadastrar.
3. **Começo de palavra:** só na última palavra enquanto o vendedor digita, como o §2 propõe?
4. **Ano de 2 dígitos** ("01/89 - 12/97", "(83-92)"): ligar o parâmetro `aplicacao_ano_2_digitos`, hoje desligado?
5. **Filtro de veículo (etapa 6, ~17h50) e placa (etapa 7, ~12h):** entram na esteira? A placa precisa de um provedor pago e
   da revisão de LGPD.
6. **Versão:** etapas 1 e 2 na v1.0.19, e as etapas 3 e 4 na versão seguinte?

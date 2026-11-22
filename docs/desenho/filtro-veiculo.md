# Desenho técnico: filtro de veículo em cascata e "Leve também" (etapa 6)

> 21/11/2026 19h50 (Manaus), revisto às 21h53 (D4, RD-2571 e RD-2573) e em 21/11/2026 22h29 (nível automático não filtra, RD-2573 feito,
> desempenho do índice) · engenheiro-software · v1.0.21, sessão S3.
> Fonte: spec aprovada `docs/design/filtro-veiculo/spec.md` (PR #588), auditoria `docs/modulos/catalogo/auditoria-busca-modelo-bap.md`
> §4 etapa 6, RN-CAT-12, 15, 16, 19, 20 e 21. Decisões do dono do produto (R-20261120-234013-alexandre): D1 chips com contagem na
> Filtrar · D2 botão Veículo entre a busca e o Filtrar · D3 "Leve também" no lugar de "Oferece junto" · D5 BKO depois ·
> **D4 decidido** (R-20261121-211000 e R-20261121-211200): a peça aparece ou não aparece; a regra é a RN-CAT-22 do doc 03.
> Fora do escopo: placa (etapa 7), veículo estruturado do ERP (etapa 5), BKO. **Sem ADR:** o contrato é só aditivo (§1.5).

## 0. Resumo
- A cascata sai das **aplicações em texto** já lidas pelas etapas 1 a 4: segmentos (o mesmo separador do "Serve em"),
  anos (`expandirAplicacao`, RN-CAT-12/16), apelidos de montadora (RN-CAT-15) e nomes de veículo da base (RN-CAT-19/20).
- Um **índice de veículos** puro no domain do Catálogo, montado na mesma carga que hoje calcula os nomes de veículo, no aparelho e
  no servidor (§2).
- Uma **regra pura** diz, por produto, se a peça entra na lista (RN-CAT-22, §3).
- **Aparelho primeiro:** a vitrine e a ficha filtram no aparelho; o seletor do pedido usa as consultas do Catálogo (ADR 0012), que
  rodam no aparelho e, com o mesmo domain, na API. **Nenhuma rota REST nova** nesta etapa (§4).
- O veículo **não vai para o pedido** (§5).

## 1. Contrato (`modules/catalogo/contracts`, arquivo novo `veiculo.ts`, exportado no `index.ts`)

### 1.1 Tipos base
| Tipo (Zod) | Forma | Observação |
|---|---|---|
| `NivelVeiculo` | `z.enum(['montadora', 'modelo', 'ano', 'motor', 'versao'])` | ordem fixa da cascata |
| `VeiculoEscolhido` | `{ montadora: string \| null, modelo: string, ano: int 1950..2100 \| null, motor: string \| null, versao: string \| null }` strict | strings = o `valor` devolvido pela cascata (nome de exibição); o domain compara por `chaveDeTermo`. `montadora` nula = modelo achado sem montadora (§2.2) |
| `VeiculoParcial` | os mesmos campos, todos opcionais e nuláveis, strict | o que já foi escolhido na folha |
| `RotulosVeiculo` | `{ curto: string, completo: string }` | `curto` = etiqueta (`Gol 2018 1.0 Trendline`); `completo` = leitor de tela e ficha (`Volkswagen Gol 2018 1.0`). Montados no domain, nunca na tela |
| `OpcaoVeiculo` | `{ valor: string, rotulo: string, apoio: string \| null }` | `apoio` = montadora na busca da folha e nos Recentes |
| `PassoTrilha` | `{ nivel: NivelVeiculo, valor: string, rotulo: string, automatico: boolean }` | `automatico` = preenchido sozinho (nível de uma opção só), vai em `ink2`. Ano, motor e versão automáticos **não contam como escolhidos** (§1.2) |

### 1.2 Consulta nova `catalogo.veiculos@1` (`consultas.ts`, `CONSULTA_VEICULOS`)
- **Entrada** strict: `{ escolha: VeiculoParcial = {}, busca?: string trim ≤ 60, produto_ids?: Id[] ≤ 5000, cliente_id?: Id }`.
  - **Escopo opcional do cliente** (decisão do gerente, 22/11): `produto_ids?` e `cliente_id?` com a **mesma semântica** de
    `catalogo.busca_produtos@1` (T-0167): `produto_ids` restringe aos produtos dados; `cliente_id` restringe aos vendáveis na
    tabela de preço do cliente, na filial dele (RN-CAT-06), filtrados dentro da consulta. Sem os dois = o catálogo inteiro
    (vitrine do Catálogo). A cascata, a `busca` da folha e o `disponivel` só contam as entradas do índice cujos produtos estão no
    escopo; assim, no Novo pedido, a cascata mostra só o que se pode vender ao cliente. Os Recentes não são filtrados pelo escopo.
- **Saída:**
  `{ disponivel: boolean, trilha: PassoTrilha[], nivel: NivelVeiculo | null, opcoes: OpcaoVeiculo[], ultimo: boolean,
  escolha: VeiculoParcial, rotulos: RotulosVeiculo | null, busca: OpcaoVeiculo[] | null, recentes: { veiculo: VeiculoEscolhido, rotulos: RotulosVeiculo }[] }`.
  - `disponivel` falso = o catálogo não tem veículo nas aplicações, ou ainda não está no aparelho: o botão Veículo não aparece (spec §2, §9, P3).
  - `nivel` nulo = não há mais nível a escolher (aplica e fecha). `ultimo` = tocar numa opção deste nível aplica e fecha (sem `Ver peças`).
  - **Nível preenchido sozinho** (decisão do gerente, R-20261121-211200): montadora e modelo de uma opção só entram na `escolha`,
    porque são o próprio carro; ano, motor e versão de uma opção só ficam **só na trilha**, com `automatico: true`, fora da `escolha`
    e da etiqueta, e **não filtram**. `rotulos` é o da `escolha` (nulo sem modelo).
  - `busca` só vem quando a entrada tem `busca` (modelos e montadoras pelo nome e pelos apelidos); `[]` = `Nenhum modelo com "<texto>".`
  - `recentes` (até 3) só no aparelho; a API devolve `[]` (§4.3).
- Sem preço e sem estoque: responde a todo perfil com o Catálogo efetivo (promotor incluído).

### 1.3 Consulta `catalogo.busca_produtos@1`, aditiva (mesma versão)
- **Entrada:** ganha `veiculo?: VeiculoEscolhido`. O `q` passa de obrigatório para `q: string trim ≤ 200 default ''`, com o `refine`
  "`q` com 1+ caractere **ou** `veiculo`". Toda entrada válida hoje continua válida (afrouxar entrada não quebra quem chama).
- **Saída:** sem campo novo por item: a peça entra ou não (RN-CAT-22). O `serve_em` de hoje (o trecho do texto buscado) não muda
  de sentido. Ordem: a de hoje.

### 1.4 Folha Filtrar com contagem (D1), em `busca.ts`
- `GrupoFiltro = z.enum(['sistema', 'familia', 'linha', 'categoria'])`.
- `ChipFiltro = { grupo: GrupoFiltro, id: string, nome: string, contagem: int ≥ 0, marcado: boolean }`.
- `GruposFiltro = z.array(z.object({ grupo: GrupoFiltro, rotulo: string, chips: z.array(ChipFiltro) }))` (só grupos com 2+ chips).
- **Decisão (gerente, 22/11):** Família e Linha entram nos chips da Filtrar, pelo texto literal da D1 ("sistema, família, linha e
  categoria"); o grupo que fica vazio (nenhum chip com contagem, salvo o marcado) some da folha.
- Hoje só a tela do Catálogo usa (sem rota nova); fica em `contracts` para a tela e a API futura terem o mesmo tipo.

### 1.5 Por que sem ADR
Tudo é campo opcional novo, consulta nova ou entrada afrouxada; nenhuma saída muda de forma nem de sentido, e consumidor antigo
ignora o que não conhece. Vale o registro em `.coord/contratos/modulos.md` (engenheiro-software, no lote da implementação):
`catalogo.veiculos@1` nova; `catalogo.busca_produtos@1` aditiva (T-filtro-veiculo). Manifestos: `catalogo.ofereceConsultas += 'catalogo.veiculos@1'`;
`vendedor.usaConsultas += 'catalogo.veiculos@1'`.

## 2. Índice de veículos (domain do Catálogo, arquivo novo `domain/veiculo-indice.ts`)

### 2.1 Montagem
`ConstrutorIndiceVeiculos` (incremental, como o `ConstrutorIndice` da T-0119: `acrescentar(produtoIdx, aplicacao)` e `concluir()`)
e o atalho `construirIndiceVeiculos(produtos, aplicacoes, { anoAtual, veiculos }) → IndiceVeiculos`. Por produto ativo:
1. **Segmentos:** a aplicação partida pelo mesmo `SEPARADOR_SEGMENTO` do `serve-em.ts` (passa a ser exportado, um lugar só).
2. **Montadora:** palavra(s) do segmento que casam a lista **`MONTADORAS`** (nova em `montadoras.ts`: nome de exibição de cada
   montadora; os apelidos continuam em `APELIDOS_MONTADORA`, RN-CAT-15, e casam a mesma entrada). Comparação por `chaveDeTermo`.
3. **Modelo:** a 1ª palavra do segmento que é nome de veículo da base (`NomesDeVeiculo`, RN-CAT-19), inclusive a derivada inteira
   (`CrossFox`, RN-CAT-20). Uma palavra só (premissa: "Palio Weekend" é Palio, e "Weekend" cai em versão).
4. **Anos:** `expandirAplicacao(segmento, { anoAtual })` → `anos` (vazio = trecho sem ano).
5. **Motor:** cilindrada `\d[.,]\d` ("1.0/1.6" vira duas opções; vírgula vira ponto). Vazio = qualquer motor.
6. **Versão:** os outros nomes de veículo do segmento depois do modelo (Highline, Trendline). Vazio = qualquer versão.
7. Guarda `{ produto, montadora | null, modelo, anos, motores, versoes, inicio, fim }` (posições no texto, para o negrito da ficha).
8. **Montadora do modelo sem montadora escrita:** a mais frequente do mesmo modelo na base. Modelo que nunca aparece com montadora
   fica fora da lista de montadoras e só é achado pela busca da folha (sem `apoio`).
9. Nomes de exibição: a grafia mais frequente na base (`Gol`, não `GOL`).

`IndiceVeiculos` = as entradas + mapas `montadora → modelos`, `(montadora, modelo) → entradas`, `produto → entradas` e o `anoAtual`.

### 2.2 Onde vive e quando é recalculado
| Lado | Onde é montado | Recalcula quando |
|---|---|---|
| Aparelho | em `montarProdutosLocais` (`app/lib/local.ts`), na mesma passada que já faz `definirVeiculos` com **todas** as aplicações (`todasAplicacoes`, inclusive no catálogo grande sob demanda); guardado por `definirIndiceVeiculos(produtos, indice)` / lido por `indiceVeiculosDe(produtos)` (WeakMap, como `veiculosDe`) | a lista de produtos é remontada (versão de `produto` ou `produto_conteudo` mudou, memória `lembrar` de hoje) **ou** o `anoAtual` (fuso do tenant) é outro (faixa aberta "2015+" vai até ano atual + 1) |
| Servidor | ao lado de `veiculosDaBase` (`api/consultas-texto.ts`), na mesma memória por tenant e pela mesma "versão da carga" (contagem + `max(updated_at)` de `catalogo.produto_busca`) | versão da carga ou `anoAtual` mudou |

Custo esperado: uma passada linear pelas aplicações, já feita hoje para RN-CAT-19.
Nenhuma coluna, tabela, migração ou índice FTS5 novo (sem pedido ao `banco-dados`).
**Desempenho (aparelho, como foi feito):** o índice é montado em `app/veiculos-consulta.ts`, logo depois da lista de produtos, em lotes
(`construirIndiceVeiculosEmLotes`, `LOTE_MONTAGEM_INDICE = 500`), cedendo o laço a cada 500 produtos, e não trava a tela. Enquanto não
fica pronto, `catalogo.veiculos@1` devolve `disponivel: false` (`indiceVeiculosPronto`) e o botão Veículo aparece quando a montagem
termina. Com 20 mil produtos leva cerca de 1 s no total; o critério "+20%" (§7, item 9) é atendido em não travar a tela, não em tempo total.
Memória: só ids e listas curtas por segmento; o texto da aplicação não fica guardado no índice.

## 3. Regra no domain (modulo-catalogo, `domain/veiculo-filtro.ts`, funções puras com teste citando RN-CAT-22)

### 3.1 Funções
| Função | Entrada | Saída |
|---|---|---|
| `segmentosDeVeiculo(aplicacao, { anoAtual, veiculos })` | texto + nomes de veículo | `SegmentoVeiculo[]` (passo 2.1; base do índice e dos testes) |
| `navegarCascata(indice, escolha, busca?)` | `IndiceVeiculos`, `VeiculoParcial`, texto | `{ trilha, nivel, opcoes, ultimo, escolha, rotulos, busca }` (forma da saída de `catalogo.veiculos@1`): pula nível sem opção, preenche sozinho o de uma opção (ano, motor e versão automáticos só na trilha, §1.2), ano decrescente, o resto em ordem alfabética |
| `rotulosDoVeiculo(v)` | `VeiculoParcial` | `RotulosVeiculo \| null` |
| `compatibilidadeDoProduto(indice, produtoId, veiculo)` | índice, produto, `VeiculoEscolhido` | `{ situacao: 'compativel' \| 'nao_serve' \| 'universal', … }` (a ficha usa o trecho para o negrito) |
| `filtrarPorVeiculo(itens, indice, veiculo)` | itens já na ordem de hoje | só os que servem, na mesma ordem |
| `leveTambemDoVeiculo(ofereceJunto, indice, veiculo \| null)` | ids do "Leve também" | sem veículo, a lista de hoje; com veículo, os que servem e os universais |
| `contarChipsFiltrar(produtos, classificacao, marcados)` | os produtos da lista de agora (veículo, busca, `Só com estoque` e os outros grupos), sistema/família/linha da árvore e categoria | `GruposFiltro`: chip com 0 sai salvo o marcado; grupo com 1 opção sai |

### 3.2 Regra
A fonte é a **RN-CAT-22** do doc 03 (`docs/produto/03-regras-e-permissoes.md`, seção do Catálogo); este desenho não a repete.

## 4. Mesma resposta no aparelho e online (P4)

### 4.1 Decisão
- **Vitrine e ficha do Catálogo:** filtram no aparelho, com `indiceVeiculosDe(produtosLocais)` + as funções do §3, como a busca de
  hoje (`buscarLocal`/`vitrineLocal`). O botão só aparece com o catálogo no aparelho (spec §9), então a vitrine nunca precisa da API para isso.
- **Seletor do Novo pedido:** pelas consultas `catalogo.veiculos@1` e `catalogo.busca_produtos@1` (com `veiculo`), as mesmas que ele
  já usa. A implementação do aparelho (`app/texto-consultas.ts` e a nova `app/veiculos-consulta.ts`) e a da API
  (`api/consultas-texto.ts`) chamam **as mesmas** funções do domain: `buscarComTotal` ganha `veiculo?` e `indiceVeiculos?` na
  `EntradaBuscaConsulta` e chama `filtrarPorVeiculo` no fim; os dois lados herdam o mesmo resultado.
- **Por que a API também:** o registro da consulta é o mesmo nos dois lados (ADR 0012) e, na carga online (ADR 0054,
  `portaDaCarga`), a chamada vai à API. Implementar lá custa só passar o índice do servidor (§2.2); sem isso a consulta
  quebraria o contrato na carga online.
- **Sem rota REST nova** (`/v1/catalogo/veiculos` ou parâmetro em `/v1/catalogo/produtos`): nenhuma tela online precisa hoje (o BKO
  fica fora, D5). Entra quando o BKO ou a placa (etapa 7) pedirem.

### 4.2 Teste de igualdade
Um teste do modulo-catalogo roda o mesmo catálogo de fixtures (os produtos da auditoria §5 com aplicações fictícias) pela
consulta do aparelho e pela da API e compara os itens e a ordem (como os testes de igualdade da busca de hoje).

### 4.3 Recentes
Até 3, na memória do módulo do Catálogo no aparelho (um lugar só para a vitrine e para o pedido): `lembrarVeiculo(v)` roda quando o
Catálogo aplica um veículo e quando a consulta do aparelho `busca_produtos@1` recebe `veiculo`. Somem ao fechar o app e na troca de
usuário. A API não tem recentes (devolve `[]`). Persistir no SQLite fica para depois (pede migração ao `banco-dados`; ver dúvidas).

## 5. O veículo não vai para o pedido (P5)
- Nenhum campo novo no contrato do pedido (`modules/vendedor/contracts`), no `receber`, no PDF, nos eventos nem no Hub/ERP.
- O veículo é estado da tela (vitrine) ou do rascunho em memória da aba Itens; não entra no `RascunhoPedido` persistido.
- O seletor manda o veículo só para `catalogo.busca_produtos@1`; a escolha do item segue pelo `produto_id` como hoje.
- Nenhum log com o veículo (não é dado pessoal, mas não é preciso).

## 6. O que reaproveita e quem faz o quê

### 6.1 Reaproveitado (nada duplicado)
`expandirAplicacao` (anos e faixas), `NomesDeVeiculo`/`ContadorVeiculos`/`definirVeiculos` (modelo e versão), `APELIDOS_MONTADORA`
(apelidos), `SEPARADOR_SEGMENTO` do `serve-em.ts` (passa a exportado), `chaveDeTermo`/`palavrasInteiras`
(comparação), `buscarComTotal`/`buscarLocal`/`vitrineLocal` (ordem de hoje), `montarArvore`/`trilhaDe`/`rotuloDoNivel` (grupos da Filtrar),
`anoCivilNoFuso` (ano atual), `portaDaCarga` (canal da consulta), `lembrar` de `lib/local.ts` (memória por versão das linhas).

### 6.2 Divisão de trabalho
| Dono | Entrega |
|---|---|
| **designer-ux** (`packages/ui`, spec §11) | ícone **`carro`** em `nomes-de-icone.ts` e `icon.tsx` · `BotaoFiltro` ganha `icone?: NomeIcone` (padrão o de hoje) e `rotulo` acessível por prop, `ativo?: boolean` (borda `ink` 1,5 sem selo) · **`FolhaCascata`** (só apresentação) e a **`GradeOpcoes`** de 4 colunas · **`FolhaVeiculo`** (§6.3) · `Chip` ganha `contagem?: number` (400 tabular, leitor `<nome>, <n> peças`) · `EtiquetaFiltro` com quebra de linha (sem rolagem lateral) |
| **modulo-catalogo** | `contracts/veiculo.ts` (§1.1 e §6.3), `CONSULTA_VEICULOS` e o aditivo de `busca_produtos@1` (§1.3), `GruposFiltro` (§1.4) · `domain/veiculo-indice.ts` (§2) e `domain/veiculo-filtro.ts` (§3) · `MONTADORAS` em `montadoras.ts` · `buscarComTotal` com `veiculo` · `app/veiculos-consulta.ts` (`consultaVeiculosAparelho`, com o escopo do cliente do §1.2 reusando o filtro de vendáveis da `busca_produtos@1`) e `consultaBuscaProdutosAparelho` com veículo · `api/consultas-texto.ts` (`consultaVeiculos` e o índice por tenant) · manifesto (`ofereceConsultas`) · telas: `catalogo.tsx` (botão Veículo, etiqueta, `FolhaVeiculo` do kit, estados do §9, placeholder `Peça ou código…`), `estoque-filial.tsx` (Filtrar com contagem e os 4 grupos), `produto.tsx` (`Compatível com …`, negrito do trecho, "Leve também" filtrado) · testes do domain e de igualdade aparelho × API |
| **modulo-vendedor** | aba Itens do Novo pedido (spec §8): botão Veículo ao lado de `Buscar produto` só com `disponivel`; `FolhaVeiculo` do kit alimentada por `CONSULTA_VEICULOS` com o mesmo escopo do cliente que manda em `CONSULTA_BUSCA_PRODUTOS` (`cliente_id` ou `produto_ids`, §1.2); `buscarProdutos` de `use-vendedor.ts` manda `veiculo` em `CONSULTA_BUSCA_PRODUTOS` (com e sem texto); a linha do produto não muda; na `ConsultaIndisponivel` (reserva local), sem botão Veículo · manifesto `usaConsultas += 'catalogo.veiculos@1'` · importa só `@macuxi/catalogo/contracts` e `@macuxi/ui` |
| **engenheiro-software** | este desenho · registro em `.coord/contratos/modulos.md` no lote · revisão final |
| **engenheiro-apps** | revisão técnica das telas (folha, desempenho da lista) |
| **testes / corretor-redundancias / design-de-marca** | critérios do §7 · parecer de excesso (um lugar só para o veículo) · validação de cor e layout |

**Por que o seletor do pedido não é um componente exportado pelo Catálogo:** a regra de fronteira (CLAUDE.md, regra 1, e o
dependency-cruiser) só deixa o Vendedor importar `modules/catalogo/contracts`; hoje a aba Itens já usa o Catálogo só por
`CONSULTA_*` e tipos. O que o Catálogo "exporta" para o pedido é **dado** (as duas consultas) e o **visual** vem do kit
(`FolhaVeiculo`, §6.3); a regra mora inteira no domain do Catálogo, então a ligação da folha nas duas telas é só fiação.

### 6.3 Uma folha Veículo só (RD-2573)
**Feito** (designer-ux, spec 54a60b83; modulo-catalogo, 59230bb2):
- **Kit** (`packages/ui/src/mobile/folha-veiculo.tsx`, designer-ux): `FolhaVeiculo<E, V>` com a fiação de hoje (rodada, `carregando` após 300 ms, abrir no último nível escolhido, voltar, busca, Recentes, `Ver peças`) e só tipos estruturais; não importa `modules/*`.
- **`catalogo/contracts/veiculo.ts`** (modulo-catalogo): os apoios puros `veiculoDaEscolha`, `parcialDoVeiculo`, `escolhaAntesDoPasso`, `escolherOpcao`, `escolhaDoResultadoDaBusca`, juntos em `NAVEGACAO_VEICULO`; `ROTULO_DO_NIVEL`, `nenhumModeloCom`, `TEXTOS_VEICULO`, `leituraDoBotaoVeiculo(rotulos)`, `leituraDaEtiquetaVeiculo(rotulos)` e `textoDaBuscaComVeiculo` (com veículo, busca abaixo do mínimo vira vazia). O Catálogo e o Vendedor passam `navegacao={NAVEGACAO_VEICULO}`, `textos={TEXTOS_VEICULO}` e o próprio `consultar`.
- **Apagam:** o Catálogo, `app/telas/veiculo.tsx` e as cópias em `app/lib/veiculo-tela.ts`; o Vendedor, `app/components/folha-veiculo-pedido.tsx` e as cópias em `app/lib/veiculo-pedido.ts`. Os testes dos apoios passam para `contracts/veiculo.test.ts`.

## 7. Critérios de aceite (verificáveis)
**modulo-catalogo (domain, testes citando RN-CAT-22):**
1. "VW Gol 2017–2019 1.0/1.6 Highline": entra em Gol, Gol 2018, Gol 2018 1.0 e Gol 2018 1.0 Highline; fica fora em Gol 2020, Gol 2018 1.8 e Gol 2018 Trendline.
2. "VW Gol" (sem ano): entra em Gol e fica fora em Gol 2018; aplicação vazia = universal, fora da lista e dentro do "Leve também".
3. Nível preenchido sozinho pela cascata: ano, motor e versão automáticos ficam só na trilha (`automatico`), fora da `escolha` e da etiqueta, e **não filtram** (R-20261121-211200); montadora e modelo automáticos ficam no veículo. Teste encadeado cascata → filtro.
4. "Civic 07–11 · Fit 2003>" com Civic 2015 = fora (o "·" separa trechos, RN-CAT-16).
5. Cascata: só opções que existem; Ford com só o EcoSport vai direto ao Ano (`automatico`); aplicação sem motor nem versão pula os níveis; ano em ordem decrescente; busca "vw"/"gol" acha Volkswagen e Gol (RN-CAT-15).
6. A lista com veículo mantém a ordem de hoje (ranking com texto; sem texto, a da vitrine, RN-CAT-21).
7. `contarChipsFiltrar`: contagem = produtos da lista atual; chip 0 sai salvo marcado; grupo de 1 opção sai; `Limpar` não tira o veículo.
8. Igualdade aparelho × API (§4.2) nos itens e na ordem.
9. Desempenho no aparelho com 20 mil produtos: a montagem do índice **não trava a tela** (o "+20%" vale para não travar, não para o tempo total; §2.2); lista com veículo p95 < 300 ms; troca de nível da cascata < 100 ms.
10. Tenant sem veículo nas aplicações: `disponivel = false`, sem botão; resultados e tempos da busca iguais aos de hoje.

**modulo-catalogo (telas) e modulo-vendedor (aba Itens):**
11. **Sem sinal (modo avião):** cascata, lista, contagem e ficha iguais aos com sinal.
12. Etiqueta `Gol 2018 1.0 ✕` tira o veículo e volta à lista anterior; `Limpar filtros` mantém o veículo; `Tirar o veículo` no vazio.
13. Pedido: com veículo e sem texto, a lista mostra as peças do veículo; tirar o veículo volta aos itens do pedido; nenhum alerta novo (RN-VEN-42).
14. **P5:** o pedido salvo, o PDF e o envio ao ERP são idênticos com e sem veículo (teste do `receber` e do PDF sem campo novo; `git diff` sem mudança em `modules/vendedor/contracts`, `modules/integracao`).
15. **Promotor:** vê o botão Veículo, a lista e a ficha com `Compatível com …` (sem preço quando a RN-CAT-05 esconde); **não** tem a aba Itens nem o seletor do pedido (regra 7, RN-PRO-01) e a API recusa pedido dele como hoje.
16. Fronteira: `pnpm fronteiras` verde; o Vendedor não importa nada de `modules/catalogo/{domain,app}`; a lista (Catálogo e pedido) não tem chip nem "Serve em" do veículo; uma `FolhaVeiculo` só (§6.3).

**designer-ux:** 17. `carro`, `BotaoFiltro icone`, `FolhaCascata`, `GradeOpcoes`, `FolhaVeiculo`, `Chip contagem` com testes do kit; nenhuma rolagem lateral em 360 e 390 dp; leitor de tela como a spec §4.2 e §12.

## 8. Premissas e dúvidas
- **P-a.** Modelo = uma palavra (o 1º nome de veículo do segmento); "Palio Weekend" entra como Palio, com "Weekend" na versão.
- **P-b.** Motor = só cilindrada (`1.0`, `1.6`); "16V", "Flex" e "TSI" ficam no texto, não viram nível.
- **P-c.** A lista `MONTADORAS` (nomes de exibição) é do domain, igual para todo tenant, como os apelidos da RN-CAT-15.
- **Dúvida 1 (spec × código):** a spec diz **Família**; a árvore chama o nível 2 de **Grupo** (`rotuloDoNivel`, RF-CAT-09). O desenho usa o
  rótulo da spec na Filtrar; o designer-ux confirma se a hierarquia também muda para "Família".
- **Dúvida 2, decidida (D4):** com veículo, o "Leve também" mostra as peças que passam no filtro e as universais (RN-CAT-22).
- **Dúvida 3, decidida (gerente, 22/11):** os Recentes ficam só na sessão (memória do app; somem ao fechar e na troca de usuário). Sem tabela local nova.
- **Dúvida 4, decidida (gerente, 22/11):** a `catalogo.veiculos@1` ganha o escopo opcional do cliente (§1.2); no Novo pedido, a
  cascata mostra só o que se pode vender ao cliente (RN-CAT-06).
- **Decisão (gerente, 22/11):** Família e Linha entram nos chips da Filtrar (D1 literal) e o grupo vazio some (§1.4).

### Limitação conhecida
- Um trecho com vários modelos ("Uno 2010 a 2013, Palio 2012") só reconhece o **primeiro** modelo (Uno); o Palio desse trecho não
  entra na cascata nem no filtro. Fica assim por decisão do gerente (22/11), coerente com a P-a (passo 3 do §2.1).

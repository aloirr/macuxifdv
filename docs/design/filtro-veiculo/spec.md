# Filtro de veículo: cascata, "✓ Compatível" e "Leve também" (etapa 6)

> 2026-11-21 · designer-ux · origem: auditoria `docs/modulos/catalogo/auditoria-busca-modelo-bap.md` §1 (linha §4), §2 item 5,
> §3 (lista sem rolagem lateral) e §4 etapa 6; pedido do gerente-projetos para a aprovação do dono do produto
> (R-20261120-230805-alexandre). D1, D2, D3 e D5 decididos (R-20261120-234013-alexandre); D4 decidido em 2026-11-21
> (R-20261121-211000-alexandre); motor e versão decididos (D6, R-20261121-211200-alexandre); nível preenchido sozinho (D7):
> decisão do gerente, aplicando R-20261121-211200 ('campo não escolhido não filtra'); §5 e §15. Só desenho: sem contrato de API e sem código.
> Simulação: `simulacao.html` (abre no celular; os estados do §9 ficam em `?estado=<id>`). Prints 390 × 844, escala 2.
> Produtos de teste: os da auditoria §5 (marca BAP, salvo indicação), com aplicações e veículos **fictícios** (premissa P1).
> Telas que mudam: `modules/catalogo/app/telas/catalogo.tsx`, `comum.tsx` e `produto.tsx` (modulo-catalogo); aba Itens do Novo
> pedido (modulo-vendedor). Peças do kit: `packages/ui` (designer-ux), §11.

| PNG | O que mostra |
|---|---|
| `01-vitrine.png` | Catálogo sem veículo: o botão Veículo entre a busca e o Filtrar |
| `02-folha-montadora.png` | folha Veículo, 1º nível: busca de modelo, Recentes e montadoras (refeito pelo D7: `Civic 2008`, sem o motor que a cascata preenche sozinha) |
| `03-folha-busca.png` | "gol" na busca da folha: o modelo direto, sem passar pela montadora |
| `04-folha-ano.png` | nível Ano em grade de 4 colunas, sem rolagem lateral |
| `05-folha-motor.png` | nível Motor, com a trilha `Volkswagen › Gol › 2018` |
| `06-folha-versao.png` | nível Versão, o último: tocar aplica e fecha |
| `07-vitrine-veiculo.png` | Gol 2018 1.0, a lista inteira (print alto): só as peças que passam no filtro (§5; refeito pelo D4) |
| `08-filtrar-contagem.png` | folha Filtrar com os chips e a contagem da lista filtrada do Gol 2018 1.0 (refeito pelo D4) |
| `09-ficha.png` | ficha inteira (print alto): "✓ Compatível com Gol 2018 1.0", a aplicação com o trecho em negrito e "Leve também" só com o filtro de óleo (refeito pelo D4: sem a bucha do Polo Classic e sem o kit batente, que não cita o motor) |
| `10-sem-resultado.png` | "traseiro" no Gol 2018 1.0: nada serve; ação `Tirar o veículo` |
| `11-sem-sinal.png` | a mesma lista sem sinal: só a barra de status muda (refeito pelo D4) |
| `12-carregando.png` | a lista enquanto o filtro roda |
| `13-pedido.png` | aba Itens do Novo pedido com o veículo: busca e botão Veículo como o §3 e as peças que passam no filtro (§8; sem o Desc./Acrésc. geral, que não muda) |
| `14-sem-resultado-filtro.png` | Gol 2018 1.0 com o chip `Elétrica` marcado: nada serve; ação `Limpar filtros`, que mantém o veículo |

## 1. O que o vendedor faz
No balcão ou na oficina, o cliente diz o carro ("Gol 2018 1.0"). O vendedor escolhe o veículo uma vez e passa a ver só as peças
que servem nele: a peça aparece ou não aparece, sem item "de conferir" (D4). A busca por texto continua igual e soma com o
veículo ("amortecedor" + Gol 2018 1.0).

## 2. Onde aparece
| Superfície | Sim/não | Por quê |
|---|---|---|
| Campo · Catálogo (vitrine e busca) | **sim** | é onde o vendedor procura a peça do carro do cliente |
| Campo · Novo pedido, aba Itens (seletor de produto) | **sim** | o mesmo veículo filtra o que entra no pedido, sem sair para o Catálogo |
| Campo · ficha do produto | **sim** (só o "✓ Compatível" e o "Leve também", §7) | a ficha confirma a peça e sugere o que levar junto |
| Gestão | igual ao Campo, sem desenho próprio | a tela do Catálogo é a mesma do módulo nos dois apps |
| BKO | **não** nesta etapa | o BKO não vende nem monta pedido (não há Novo pedido na web) e o escritório acha o produto pelo código para cadastrar. O que pode servir depois, se o dono do produto quiser: na seção Catálogo do cadastro, a lista dos veículos que a busca leu da aplicação, para o escritório corrigir o texto (decisão D5) |
| Promotor | igual ao Campo, sem preço quando a RN-CAT-05 esconde; sem o seletor do pedido (regra 7) | o promotor também consulta a peça do carro |

O botão Veículo só aparece quando o catálogo do aparelho tem veículo lido das aplicações. Tenant sem autopeças não vê nada
novo (premissa P3).

## 3. Botão Veículo e etiqueta (vitrine, seletor e Novo pedido)
- **Linha de cima:** `CampoBusca` + **botão Veículo** + `BotaoFiltro`, nessa ordem, 8 dp entre eles. A busca fica com 238 dp no
  aparelho de 390 e com 208 no de 360, e o texto cabe em 186 e 156 dp. Por isso, **só com o botão Veículo**, o placeholder vira
  `Peça ou código…` (o de hoje, `Código, marca, descrição…`, é cortado), e a dica do campo em foco vira
  `Também acha por marca, aplicação e referência cruzada.` (a marca sai do placeholder e entra na dica;
  `catalogo-campo-v2/spec.md` §5).
- **Botão Veículo:** quadro de 48 × 48 dp igual ao do `BotaoFiltro` (borda `line`, raio 11, fundo branco), ícone novo **`carro`**
  20 dp em `ink` (§11). Com veículo escolhido, borda `ink` 1,5 (como o `BotaoFiltro` com selo), sem selo: o veículo fica na
  etiqueta. Leitor de tela: `Veículo, botão` / `Veículo: Volkswagen Gol 2018 1.0, botão`.
- **Exceção ao filtro padrão** (`filtro-padrao-campo/spec.md` §0): vira a 3ª peça de filtro fora da folha Filtrar, ao lado da
  busca. No balcão o veículo é o primeiro filtro, e dentro da Filtrar ele custaria um toque a mais (decisão D2).
- **Etiqueta:** `EtiquetaFiltro` `Gol 2018 1.0 ✕`, a primeira da linha de etiquetas, sem a montadora (o modelo basta na tela; o
  leitor de tela diz `Remover veículo Volkswagen Gol 2018 1.0`). Com versão: `Gol 2018 1.0 Trendline ✕`. Só com o que o
  vendedor tocou (§5): `Civic 2008 ✕`, sem o 1.8 que veio sozinho. O ✕ tira o veículo, e
  a lista volta à de antes. Tocar no botão Veículo de novo abre a folha no último nível escolhido.
- **Linha de etiquetas sem rolagem lateral:** quebra em mais de uma linha quando não cabe (8 dp entre as linhas).
- O veículo fica escolhido enquanto a tela está aberta. No pedido, vale só para aquele pedido; não entra no pedido, no PDF nem
  no ERP (premissa P5).

## 4. Folha Veículo (cascata)
`Folha` do kit (`packages/ui/src/mobile/folha.tsx`), de baixo para cima, 280 ms, `rolavel`, título `Veículo`, ✕ de 48 dp
(`Fechar`). Ocupa até 90% da altura. **Nenhuma rolagem lateral em 390 dp:** cada nível é uma lista vertical ou uma grade que
quebra linha.

### 4.1 Ordem dentro da folha
1. **Trilha** (`Trilha compacta`, a partir do 2º nível): só o que já foi escolhido, `Volkswagen › Gol › 2018`; o nível atual fica
   no rótulo de baixo, não na trilha. Cada item volta àquele nível (alvo de 48 dp).
2. **Rótulo do nível** (`RotuloSecao`): `Montadora`, `Modelo`, `Ano`, `Motor`, `Versão`.
3. **Opções do nível** (§4.2).
4. **Rodapé** (a partir do nível Ano): `Ver peças` (principal, 52 dp, largura toda). Fecha e aplica o que já foi escolhido. Sem
   número no botão (Campo v1.0.17, item 14).

### 4.2 Níveis
| Nível | Peça | Opções |
|---|---|---|
| Montadora | `CampoBusca` `Modelo ou montadora` no topo; **Recentes** (até 3, os últimos veículos usados no aparelho; sem nenhum, a seção não aparece); a lista de montadoras | linhas de 48 dp da `FolhaCascata` (§11) num cartão branco com traço `lineSoft`, nome 16 `ink` e o chevron `ink3`; ordem alfabética |
| Modelo | lista | linhas de 48 dp, ordem alfabética |
| Ano | **grade de 4 colunas**, do mais novo ao mais velho | botões de 48 dp de altura (chip de escolha do kit: branco, borda `lineStrong`, raio 12, 16/600 tabular); com 390 dp, cada um tem 80 dp |
| Motor | lista | linhas de 48 dp (`1.0`, `1.6`) |
| Versão | lista | linhas de 48 dp |

- **Só aparecem as opções que existem nas aplicações** do catálogo do aparelho: nenhuma montadora, modelo ou ano sem peça.
- **Nível com uma opção só é preenchido sozinho** e aparece na trilha em `ink2`, sem toque (como na `ListaNiveis`, T-0142): a Ford
  só tem o EcoSport, e a folha vai direto para `Ford › EcoSport`, no Ano. O que filtra e o que fica só na trilha está no §5
  (D7). **Nível sem opção é pulado** (aplicação sem motor nem versão).
- **Tocar avança** para o próximo nível (movimento lateral de 240 ms; com "reduzir movimento", só troca). No **último nível
  que existe**, tocar aplica e fecha (sem o `Ver peças`).
- **Busca da folha:** acha modelo e montadora pelo nome e pelos apelidos (VW, GM, Chevy, MB; etapa 1 da auditoria). Cada
  resultado é uma linha `Gol` com `Volkswagen` em 14 `ink2` embaixo; tocar leva direto ao nível Ano. Montadora achada leva ao
  nível Modelo. Sem resultado: `Nenhum modelo com "xyz".` (14 `ink2`) no lugar da lista.
- **Recentes:** uma linha por veículo, `Gol 2018 1.0` (16 `ink`) com `Volkswagen` embaixo (14 `ink2`); tocar aplica e fecha.
- **Voltar do Android:** volta um nível; no 1º, fecha. Fechar pelo ✕ ou tocando fora não muda o veículo que já estava aplicado.
- **Leitor de tela:** título, ✕, trilha (`Volkswagen, Gol, 2018`), rótulo do nível (`Motor`, cabeçalho) e cada opção como botão
  (`1.0, botão`). Ao avançar, o foco vai para o rótulo do novo nível.

## 5. Lista com veículo (vitrine e seletor)
**Regra (D4, R-20261121-211000-alexandre, já no domínio do modulo-catalogo):** o filtro só restringe pelo que o vendedor
escolheu. A peça entra quando um trecho da aplicação cita o modelo escolhido e:
- **ano escolhido:** a faixa de ano do trecho inclui o ano. O trecho **sem ano não entra** (ex.: `VW Gol`, na Pastilha de freio
  dianteira Gol, some no Gol 2018);
- **ano não escolhido** (`Ver peças` no nível Ano): entram todas as peças do modelo, **inclusive as sem ano**;
- **motor e versão** (decidido, R-20261121-211200-alexandre: a mesma regra do ano; RN-CAT-22): **escolhido**, a peça precisa
  ter o dado no trecho e ele precisa bater; o trecho sem motor ou sem versão **não entra** (ex.: o kit batente e coifa,
  `VW Gol 2014–2019`, sem motor, some do Gol 2018 1.0, em que o vendedor tocou o 1.0 entre o 1.0 e o 1.6). **Não
  escolhido**, não filtra (`Gol 2017–2019 Highline` entra no Gol 2018);
- **nível preenchido sozinho** (§4.2; D7, decisão do gerente, §15): ano, motor ou versão que a cascata
  preencheu por ter uma opção só **não conta como escolhido e não filtra**. Ex.: com um ano só do Gol
  na base, "só Gol" mostra todas as peças do Gol, inclusive as sem ano; no Civic 2008 o motor 1.8 vem sozinho, e a lista é a do Civic 2008 (entra o disco `Civic 07–11`, sem motor). Montadora e modelo preenchidos sozinhos
  são o próprio veículo e seguem nele.

A peça aparece ou não aparece: **não há item "de conferir"**.
- **Cartão como hoje:** sem chip `Compatível` e sem a linha `Serve em` do veículo. A lista não mistura casos, e a etiqueta
  `Gol 2018 1.0 ✕` já diz para qual veículo ela vale (uma informação, um lugar). A aplicação inteira fica na ficha.
- O `Serve em` da **busca por texto** (RN-CAT-12, `catalogo-aplicacao.md` §1.1) continua como está: ele mostra onde a palavra
  buscada bateu, não o veículo.
- **Ordem:** a de hoje (§3.10 da auditoria).
- Universais (aplicação sem veículo nenhum, ex.: fluido de freio) não entram na lista com veículo; voltam ao tirar o veículo.

## 6. Folha Filtrar: chips com contagem
- Grupos, nesta ordem: **Sistema · Família · Linha · Categoria** (os nomes vêm do cadastro), e depois os de hoje (Filial, quando
  houver mais de uma). O rótulo do 2º grupo sai do `rotuloDoNivel` do Catálogo (`modules/catalogo/domain/hierarquia.ts`), hoje
  **`Grupo`**; o D1 escreve "família". Fica como dúvida aberta para o dono do produto (§15, dúvida aberta 1); a simulação ainda
  mostra `Família`. Cada grupo em chips de marcar (`Chip` do kit, 36 dp com folga de 6 em cima e embaixo, alvo de 48; quebram linha com 12 dp
  entre as linhas, para a folga caber; nada de rolagem lateral).
- **Contagem em cada chip:** `Suspensão 2`, o número em 400 tabular e o nome em 600. Conta as peças da **lista filtrada** de
  agora: as que passam no veículo pela regra do §5, a busca, o `Só com estoque` e os outros grupos. Leitor: `Suspensão, 2 peças`.
- **Chip com 0 sai**, salvo o que já está marcado. **Grupo com uma opção só sai** (no Gol 2018 1.0 a Linha fica toda "Leve" e
  não aparece).
- Rodapé como hoje: `Limpar` (neutro: desmarca os chips; **não** tira o veículo, que tem o ✕ próprio) e `Ver produtos`
  (principal, sem número).
- Chip marcado vira `EtiquetaFiltro` na tela (`Suspensão ✕`), depois da etiqueta do veículo.
- A contagem nos chips é o único número de quantidade da folha (D1, decidido: o item 14 da v1.0.17 tirou as contagens).

## 7. Ficha do produto
- **`✓ Compatível com Gol 2018 1.0`**: `ChipEstado` 28 dp `tom="sucesso"`, ícone `check`, na linha das etiquetas logo abaixo do
  título (`catalogo-aplicacao.md` §3.1, item 1). Só quando há veículo escolhido e a peça passa no filtro (regra do §5). Aqui o
  veículo vai escrito porque a ficha não mostra a etiqueta. Peça que não passa (aberta por outro caminho): sem chip.
- **Aplicação:** o texto de hoje, com o trecho do veículo escolhido em negrito `ink`, quando a peça passa no filtro.
- **Leve também** (hoje "Oferece junto", RN-CAT-11; troca do título decidida no D3): com veículo, só as peças que passam no
  filtro (regra do §5) e as universais; some o que tem aplicação e não passa. No Gol 2018 1.0, o amortecedor Gol G5 leva só o
  filtro de óleo: a bucha do Polo Classic e o kit batente (aplicação `VW Gol 2014–2019`, sem motor) saem. Sem nenhuma que
  passe, a seção não aparece. Sem veículo, a lista de hoje. Linha como hoje (nome, código, chevron; abre a ficha), sem chip
  por linha: a seção inteira já é do veículo.
- O principal da ficha continua um só (`Adicionar ao orçamento`).

## 8. Novo pedido, aba Itens (modulo-vendedor)
- Linha da busca como o §3; a linha do produto, a de hoje (§5). As etiquetas, abaixo da busca. Os Alertas continuam no
  topo (RN-VEN-42); o veículo **não gera alerta** nenhum.
- **Com veículo e sem texto:** a lista mostra as peças do veículo (no lugar dos itens do pedido); tirar o veículo volta aos itens
  do pedido (`pedido-v4.md` §5.3).
- Com veículo, entram as peças pela regra do §5, na ordem de hoje.
- O `+`, o lápis e o `Mostrar mais` não mudam. O principal da tela continua o `Avançar`.

## 9. Estados
| Estado (`?estado=`) | Vitrine e seletor | Folha Veículo |
|---|---|---|
| vazio, sem veículo (`vitrine`) | a lista de hoje; botão Veículo sem destaque | abre em Montadora, com Recentes se houver |
| catálogo sem veículo nas aplicações | sem botão Veículo | — |
| sem resultado (`sem-resultado`) | `EstadoVazio` (ícone `search`), título `Nada encontrado para "traseiro"` (sem texto buscado, só com o veículo e o `Só com estoque`: `Nenhum produto com esses filtros`), **sem apoio** (o veículo já está na etiqueta), ação `Tirar o veículo` (secundário 44). Com chip marcado na Filtrar (`sem-resultado-filtro`): o mesmo título, **sem apoio** e a ação `Limpar filtros` (secundário 44), que desmarca os chips e mantém o veículo; se ainda não houver peça, entra o caso acima, com `Tirar o veículo`. O apoio do caso 1 do `catalogo-busca-vazio.md` ("Tire o filtro para procurar em todo o catálogo") só vale sem veículo, porque com ele o `Limpar filtros` não abre o catálogo todo | busca sem modelo: `Nenhum modelo com "xyz".` |
| sem sinal (`sem-sinal`) | **igual**: a cascata, a lista filtrada, o "Compatível com" da ficha e os chips saem do catálogo do aparelho (busca FTS5 local). Nenhum texto novo; o aviso da busca, se houver, é o de hoje | igual |
| primeira carga sem sinal | `CatalogoCarregando` de hoje; o botão Veículo só aparece quando o catálogo estiver no aparelho | — |
| carregando (`carregando`) | a lista some e entra o `Loading` do kit no lugar dela, só se o filtro passar de 300 ms; sem texto | nível que passa de 300 ms: `Loading embutido` no lugar das opções |

## 10. Três toques
| Caminho | Toques até a lista do veículo |
|---|---|
| veículo recente | **2**: Veículo, o recente |
| modelo pela busca da folha | **3**: Veículo, `Gol` (depois de digitar), `Ver peças`; sem o ano, entram todas as peças do Gol, inclusive as sem ano (§5). Com o ano, 4 |
| cascata até o ano | 4: Veículo, Volkswagen, Gol, 2018 (com motor e versão de uma opção só, o ano já fecha, e eles não filtram, §5) |
| cascata completa | até 6: + motor + versão; cada nível depois do Ano é opcional (`Ver peças`) |
| busca por texto, sem a folha | 0 toques: `gol 2018` na busca da tela continua achando (etapas 1 a 4) |

## 11. Peças de `packages/ui` (designer-ux, na implementação)
| Peça | Onde | Novo? |
|---|---|---|
| `CampoBusca`, `BotaoFiltro`, `EtiquetaFiltro` | linha de cima e etiquetas | não |
| botão Veículo | o quadro do `BotaoFiltro` sem selo, com `rotulo` e ícone por prop (`BotaoFiltro` ganha `icone`) | ajuste |
| ícone `carro` | `nomes-de-icone.ts` e `icon.tsx`, traço 2 como os outros | **novo** |
| `Folha`, `Trilha compacta`, `RotuloSecao`, `CampoBusca`, `Botao nivel="principal"` | folha Veículo | não |
| `FolhaCascata` | folha de níveis com trilha, busca, recentes, linhas de opção de 48 dp (nome e apoio opcional, chevron quando há próximo nível) e grade; só apresentação: quem diz os níveis, as opções e o que se preenche sozinho é o domínio do Catálogo | **novo** |
| `GradeOpcoes` | a grade de 4 colunas do Ano | **novo** (dentro da `FolhaCascata`) |
| `Chip` com `contagem` | folha Filtrar | ajuste |
| `ChipEstado` `tom="sucesso"` `icone="check"` | ficha (`Compatível com …`) | não |
| `EstadoVazio`, `Loading`, `CatalogoCarregando` | estados | não |

Tokens: `colors.ink`, `ink2`, `ink3`, `line`, `lineStrong`, `accent`, `accentSoft`, `accentInk`, `success`, `successBg`,
`surface`, `ground`; `radius` (folha 22, botão 14/12, cartão 14); `layout.telaLateral` 20; `ALTURA.toque` 48,
`chipEstado` 28; movimento `avancar` 240 ms e `folha` 280 ms (`movimento.ts`). Nenhuma cor nova.

## 12. Textos (todos)
| Lugar | Texto |
|---|---|
| busca do Catálogo e do Novo pedido, só com o botão Veículo | placeholder `Peça ou código…` · dica `Também acha por marca, aplicação e referência cruzada.` |
| botão (leitor de tela) | `Veículo` · `Veículo: <montadora> <modelo> <ano> <motor> <versão>` |
| etiqueta | `<modelo> <ano> <motor> <versão>` · leitor `Remover veículo <montadora> <modelo> …` |
| folha | título `Veículo` · busca `Modelo ou montadora` · `Recentes` · `Montadora` · `Modelo` · `Ano` · `Motor` · `Versão` · `Ver peças` · `Nenhum modelo com "<texto>".` |
| ficha | `Compatível com <modelo> <ano> <motor> <versão>` · `Leve também` |
| sem resultado | `Nada encontrado para "<texto>"` · `Nenhum produto com esses filtros` · `Tirar o veículo` · `Limpar filtros` (com chip marcado) |
| folha Filtrar | `Sistema` · `Grupo` (o `rotuloDoNivel`; `Família` no D1, dúvida aberta 1) · `Linha` · `Categoria` · `<nome> <n>` · leitor `<nome>, <n> peças` |

Regras seguidas: uma informação, um lugar (§5); nenhum aviso fora dos Alertas
(RN-VEN-42: o veículo não gera aviso); nenhum texto sobre o que o sistema faz por trás (sem "lido da aplicação", "no aparelho",
"sem internet funciona").

## 13. Fora do escopo
Contrato de API e índice de veículos (engenheiro-software, modulo-catalogo), a regra do filtro no domínio
(modulo-catalogo, já feita pelo D4), o veículo estruturado do ERP (etapa 5, a levantar) e a **placa** (etapa 7).

## 14. Premissas
- **P1.** Os veículos, anos, motores e versões da simulação são **fictícios**: a etapa 5 (veículo estruturado do ERP) está "a
  levantar". Até lá, a cascata sai das aplicações em texto, lidas pelas etapas 1 a 4 da auditoria.
- **P2.** Se a peça passa no filtro (§5) é calculável pelo domínio a partir da aplicação; a regra é do modulo-catalogo.
- **P3.** O botão aparece pelo dado (há veículo nas aplicações), sem parâmetro novo do tenant.
- **P4.** A busca online e a do aparelho dão o mesmo resultado com veículo, como já dão sem ele (auditoria §8).
- **P5.** O veículo é só filtro: não é gravado no pedido.

## 15. Decisões do dono do produto
- **D1. Contagem nos chips da Filtrar** (decidido, R-20261120-234013-alexandre): contagem **só nos chips** da folha Filtrar,
  para o vendedor não marcar o que não tem peça; o botão continua `Ver produtos`, sem número (§6).
- **D2. Botão Veículo fora da Filtrar** (decidido, R-20261120-234013-alexandre): 3ª exceção do filtro padrão, ao lado da
  busca (§3).
- **D3. "Oferece junto" passa a se chamar "Leve também"** (decidido, R-20261120-234013-alexandre) na ficha, com ou sem
  veículo (§7).
- **D4. Itens sem o dado do que foi escolhido** (decidido, R-20261121-211000-alexandre): o filtro só restringe pelo que foi
  escolhido; a peça aparece ou não aparece (§5).
- **D5. BKO** (decidido, R-20261120-234013-alexandre): nada nesta etapa (§2).
- **D6. Motor e versão** (decidido, R-20261121-211200-alexandre; RN-CAT-22): a mesma regra do ano (§5).
- **D7. Nível preenchido sozinho** (decisão do gerente, aplicando R-20261121-211200 ('campo não escolhido não filtra'); RN-CAT-22): não conta
  como escolhido e não filtra (§5).

### Dúvida aberta (para o dono do produto)
1. **Rótulo do 2º grupo da Filtrar** (§6): o `rotuloDoNivel` do Catálogo diz `Grupo`; o D1 escreve "família". Qual vale na
   folha?

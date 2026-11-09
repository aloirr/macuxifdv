# Novo pedido v3: crédito em tabela, Entrega enxuta, endereço do pedido, Itens sem Catálogo, Rascunhos e "preço de" (T-0141)

> 2026-11-09 · designer-ux · tarefa T-0141. Pedidos do dono do produto: R-20261109-054659-alexandre (abas Venda e Entrega) e
> R-20261109-064818-alexandre (Novo pedido e orçamento), teste do Campo-Demo-v1.0.1 com o Atacadinho Cachoeirinha (C5007).
> Regras: **RF-VEN-11** · **RN-VEN-17** (endereço editável só no pedido) · **RN-VEN-18/32** (orçamento não expira; preço congelado
> 7 dias) · **RN-VEN-38** (nenhuma saída perde o pedido) · **RN-VEN-39** (Rascunhos, 24 h) · RN-VEN-12/13 (crédito) · RN-VEN-16.
> **Imagens para aprovação** (o dono do produto aprova pela imagem antes de implementar A, B, C e F):
> `docs/design/telas/T-0141-novo-pedido-v3-1.png` (Venda, Entrega, endereço) e `docs/design/telas/T-0141-novo-pedido-v3-2.png`
> (Itens, Rascunhos, orçamento). Fonte das imagens: os `.html` de mesmo nome (abrem no navegador).
> **Substitui** em `pedido-v2.md`: §1.2 (bloco Limite/Prazo médio), §1.3 (árvore do catálogo na aba Itens), §1.4 (frase do frete e
> "Trocar"), §2.3 ("Válido até" no cliente da RN-VEN-13), §4.1/§4.3/§5.1 (validade do orçamento e "Vencido"), §8 (textos). O resto
> de `pedido-v2.md` continua valendo. Telas: modulo-vendedor (`modules/vendedor/app`); navegação do Voltar: engenheiro-apps.
> **Aprovado pela imagem** (R-20261109-121700) com 2 ressalvas, já nas pranchas e nesta especificação: a barra inferior tem as
> **5 abas** do Campo (§0.1) e o formulário do endereço funciona **sem sinal**, à mão, com Cidade e UF obrigatórias (§C.3).

## 0. O que a revisão de UX cobra (pedido do dono do produto)
A revisão de UX **não aprova** tela fora desta especificação nem com aparência de rascunho. Na prática:
1. Valor que o vendedor consulta (dinheiro, prazo, contagem) fica em **tabela ou linha rótulo ··· valor**, nunca em frase corrida.
2. Valores em **Archivo negrito, tabular**, alinhados à direita; rótulos em IBM Plex, `ink2`.
3. Nada de frase explicativa que o vendedor já sabe (CIF/FOB). Frase só quando muda a decisão dele.
4. O print do aparelho tem de bater com a imagem aprovada: ordem, espaçamentos, tamanhos e textos.

### 0.1 Barra inferior: 5 abas (ressalva do dono do produto, R-20261109-121700)
- O Campo do vendedor mantém as **5 abas: Início · Rota · Clientes · Pedidos · Mais**, nessa ordem. **A Rota não sai** sem decisão
  do dono do produto. Metas, Catálogo e o resto ficam no "Mais".
- Quem monta é o shell (`abasDoShell` em `apps/mobile/src/lib/abas.ts`, 5 posições); o desenho é a `BarraAbas` do kit (64 dp +
  área segura, ícones `home`, `pin`, `users`, `clipboard`, `menu` em 22, rótulo 11; ativa com ícone `accent` e rótulo `accentInk`
  negrito). Nenhuma tela desta especificação mexe na barra.
- A barra aparece em todas as telas desta especificação, inclusive no Novo pedido (abaixo do `RodapeTotal`). Aba acesa = a dona
  da pilha (`abaAcesa`): nas pranchas, **Clientes** no Novo pedido (aberto pelo cliente) e **Pedidos** em Pedidos, Rascunhos e no
  detalhe do orçamento. As folhas (endereço, formulário, Preços de hoje) cobrem a barra, com o fundo escurecido.

## A. Aba Venda: bloco de crédito em tabela
```
CRÉDITO DO CLIENTE
┌──────────────────────────────────────────┐
│ Limite                     R$ 20.000,00  │
├──────────────────────────────────────────┤
│ Disponível                 R$ 17.900,00  │
├──────────────────────────────────────────┤
│ Prazo médio                     45 dias  │
└──────────────────────────────────────────┘
⟳ Atualizado hoje às 05:38
```
Ordem da aba Venda (não muda): Alertas (ou "Cliente liberado · sem título vencido") → Forma de pagamento e Prazo → **Crédito do
cliente** (esta tabela) → linha de atualização.

### A.1 Medidas e tokens
| Peça | Medida |
|---|---|
| Título | `RotuloSecao "Crédito do cliente"` (12/600, maiúsculas, `ink2`), 8 dp acima da tabela |
| Tabela | cartão branco (`surface`), borda `line` 1, raio 14 (`radius.lg`), sem sombra; 3 linhas com traço `lineSoft` entre elas |
| Linha | altura mínima **48 dp**, respiro 14 dp nas laterais; rótulo à esquerda, valor à direita, centrados na vertical |
| Rótulo | IBM Plex Sans 14, `ink2` (7,6:1): **Limite** · **Disponível** · **Prazo médio** |
| Valor | **Archivo 700, 17, tabular**, `ink`, alinhado à direita, uma linha (`numberOfLines={1}`, encolhe até 14 com `adjustsFontSizeToFit` se o valor for longo, ex.: R$ 1.250.000,00) |
| Atualização | 8 dp abaixo da tabela: ícone `sync` 13 (sem sinal: `wifiOff`) + `textoAtualizacao(...)`, 12 `ink2` |

- Dinheiro de centavos com `formatBRL`; prazo "45 dias" (1: "1 dia").
- **Disponível negativo** (pedidos acima do limite): valor em `danger` com o sinal "−" (U+2212), "−R$ 1.200,00"; a linha não muda de
  fundo. O alerta "Limite excedido" continua na caixa Alertas (RN-VEN-12), que é onde está a consequência.
- Fonte grande do sistema (130%): o rótulo quebra em 2 linhas antes de o valor encolher; a linha cresce, nada é cortado.
- TalkBack: o bloco lê "Crédito do cliente", depois cada linha "Limite: R$ 20.000,00" (uma linha = um foco, `accessible`).

### A.2 Estados
| Estado | Como fica |
|---|---|
| Lendo do aparelho (`credito === undefined`) | as 3 linhas com o rótulo e, no valor, uma barra cinza `lineSoft` de 72 × 12 dp (sem "R$ 0,00") |
| Sem dados de crédito do cliente | Limite e Disponível mostram "—" (`ink3`); abaixo da tabela, 12 `ink2`: "Sem dados de crédito deste cliente." Prazo médio continua se houver |
| Sem prazo médio | a linha Prazo médio mostra "—" (a tabela mantém as 3 linhas; a forma da tela não muda de um cliente para outro) |
| Consulta indisponível (`credito === null`, erro de leitura) | a tabela não aparece; no lugar, 12 `ink2`: "Crédito indisponível agora. Sincronize o aparelho." |
| Offline | igual, com os dados do aparelho; o ícone da atualização vira `wifiOff` e o texto continua ("Atualizado hoje às 05:38") |

### A.3 Componente do kit: `TabelaValores` (novo, `@macuxi/ui/mobile`, arquivo `valores.tsx`)
Tabela rótulo ··· valor genérica (serve ao crédito e a outros blocos de consulta). Sem texto fixo e sem cálculo.
```tsx
<RotuloSecao texto="Crédito do cliente" />
<TabelaValores
  testID="venda-credito"
  linhas={[
    { id: 'limite', rotulo: 'Limite', valor: formatBRL(c.limite_cents) },
    { id: 'disponivel', rotulo: 'Disponível', valor: formatBRL(c.disponivel_cents), tom: c.disponivel_cents < 0 ? 'erro' : undefined },
    { id: 'prazo', rotulo: 'Prazo médio', valor: textoDoPrazoMedio(dias) ?? '—' },
  ]}
  carregando={credito === undefined}
  rodape={{ icone: semSinal ? 'wifiOff' : 'sync', texto: textoAtualizacao(sincronizadoEm, agora, tz) }}
/>
```
`linhas[].valor === '—'` sai em `ink3`. O `CartaoCredito` (2 colunas, da T-0089) fica para o Gestão até o modulo-gestor migrar; a
aba Venda usa a `TabelaValores`. O `LinhaValor` "Limite · R$ x · disponível R$ y" **sai** da aba Venda.

## B. Aba Entrega: frete sem frase
```
FRETE
[    CIF    ][    FOB    ]
TRANSPORTADORA                      ← só FOB
(Rio Negro) (Transvale) (Outra)
```
- `Segmentado` CIF | FOB (48 dp) **sem nenhuma frase abaixo**: saem "Frete incluso no preço" e "Frete por conta do cliente"
  (`fraseDoFrete` deixa de ser usada na aba; o Resumo, o detalhe e o PDF seguem a RF-VEN-12).
- FOB: 12 dp abaixo, o rótulo `Transportadora` e as opções, como hoje. Sem transportadora, só a bolinha na aba (RN-CORE-36).
- TalkBack do Segmentado: "Frete: CIF, selecionado" (sem a frase).

## C. Endereço de entrega editável só no pedido (RN-VEN-17)

### C.1 Cartão do endereço (topo da aba Entrega)
```
ENDEREÇO DE ENTREGA                        Alterar
┌──────────────────────────────────────────┐
│ [Principal]                              │
│ Rua Pará, 137 · São Geraldo              │
│ Manaus/AM · 69053-000                    │
└──────────────────────────────────────────┘
```
- `RotuloSecao "Endereço de entrega"` com a ação à direita (`accentInk`, 14/600, alvo 48 dp):
  - cliente com **2 ou mais** endereços no ERP: **Alterar** → abre a folha C.2;
  - cliente com **1** endereço: **Editar** → abre direto o formulário C.3 (um toque a menos);
  - pedido **já com endereço editado**: sempre **Alterar** → folha C.2 (o do ERP e o editado), para voltar ao do cadastro sem
    redigitar (revisão T-0141, `docs/design/revisoes/T-0141.md`).
- Cartão branco, raio 14, respiro 14. Linha 1: `Selo` de origem (tamanho p): **Principal** (neutro), o nome do endereço do ERP
  (`descricao`, ex.: **Depósito**, neutro) ou **Editado neste pedido** (destaque: `accentInk` no `accentSoft`, 6,27:1).
  Linhas 2 e 3: endereço em 14 `ink` (rua, número, complemento · bairro / cidade/UF · CEP), sem cortar.
- Cliente sem endereço no aparelho: o cartão mostra "Endereço do cadastro do cliente" (como hoje) e a ação **Editar**.

### C.2 Folha "Endereço de entrega" (2 ou mais endereços)
`Folha` (280 ms de baixo), título **Endereço de entrega**, rodapé **Voltar**:
```
○ Principal
  Rua Pará, 137 · São Geraldo · Manaus/AM
● Depósito
  Av. Torquato Tapajós, 4010 · Flores · Manaus/AM
○ Editado neste pedido                ← só se houver
  Rua Pará, 140, fundos · São Geraldo · Manaus/AM
───────────────────────────────────────────
✎  Editar endereço deste pedido            ›
```
- Cada endereço é uma `OpcaoFolha` de escolha única (rádio, alvo ≥ 56 dp, nome 15/600 + endereço 13 `ink2` em até 2 linhas).
  Tocar escolhe e fecha a folha (sem botão de confirmar). Escolher um endereço do ERP **desfaz** a edição.
- Última linha, separada por traço: **Editar endereço deste pedido** (ícone `edit` e texto em `accentInk`, seta) → formulário C.3,
  já preenchido com o endereço escolhido no momento.

### C.3 Formulário "Endereço deste pedido"
`Folha` alta (ocupa até 92% da tela, rola com o teclado; `keyboardShouldPersistTaps="handled"`):
```
Endereço deste pedido                         ✕
Só neste pedido. O cadastro do cliente não muda.

CEP            [69053-000 ]
Rua            [Rua Pará                       ]
Número [140  ]  Complemento [fundos            ]
Bairro         [São Geraldo                    ]
Cidade [Manaus                    ]  UF [AM ˅]

[            Usar neste pedido            ]    ← principal, 52 dp
                  Voltar                        ← texto
```
| Campo | Teclado / formato | Obrigatório (mínimo) | Máximo |
|---|---|---|---|
| CEP | numérico, máscara 00000-000 | sim (8 números) | 8 números |
| Rua | texto, maiúscula inicial | sim (2 letras) | 60 |
| Número | texto (aceita "S/N", "1234-A", "KM 12") | sim (1) | 20 |
| Complemento | texto | não | 60 |
| Bairro | texto | sim (2 letras) | 60 |
| Cidade | texto | sim (2 letras) | 60 |
| UF | `ListaSuspensa` com as 27 UFs (`UFS_BRASIL` de `@macuxi/comum/endereco`) | sim | 2 |

Limites do contrato `EnderecoEditadoPedido` (`docs/desenho/T-0141.md` §2, `LIMITES_ENDERECO_PEDIDO`; aviso
R-20261109-100051-engenheiro-software): o endereço vai para a NF-e (campos até 60). O campo **para de aceitar letras no máximo**
(`maxLength` com os números do contrato, lidos do `LIMITES_ENDERECO_PEDIDO`, nunca repetidos na tela), então não há erro de
"longo demais". Abaixo do mínimo: 12 `danger` **Use pelo menos 2 letras** (Rua, Bairro, Cidade); vazio: **Obrigatório**.
- Campos de 48 dp, rótulo acima (12/600 `ink2`), borda `lineStrong`; foco com borda `accent` 2. Número e Complemento lado a lado
  (1/3 e 2/3); Cidade e UF (2/3 e 1/3). Com fonte grande, cada par vira um campo por linha.
- A frase do topo fica (13 `ink2`, uma linha): ela muda a decisão do vendedor, que poderia achar que está corrigindo o cadastro.
- **Usar neste pedido** (único principal da folha): valida ao tocar. Falta campo: borda `danger` e, abaixo do campo, 12 `danger`
  "Obrigatório" (CEP incompleto: "CEP com 8 números"); o foco vai ao primeiro campo com erro. Tudo certo: grava no rascunho do
  pedido, fecha a folha e o cartão C.1 mostra o selo **Editado neste pedido**.
- **Voltar** sem gravar. Se algo foi digitado: diálogo "Descartar a edição?" · [Continuar editando] [Descartar].
- **Sem sinal** (ressalva do dono do produto, R-20261109-121700): o formulário funciona igual, offline. **Não há consulta de
  CEP** (nem com sinal, nesta versão): o vendedor preenche os campos à mão. **Cidade e UF são obrigatórias** também offline
  (Cidade com 2 letras ou mais; UF escolhida na lista das 27): sem elas, "Usar neste pedido" mostra "Obrigatório" no campo e não
  grava. Os demais obrigatórios seguem a tabela acima (o CEP continua com 8 números, pelo contrato). Tudo certo: grava no rascunho
  do aparelho e segue com o pedido pela fila. A validação da tela é a mesma da API (`validarEnderecoEditado`), sem rede. Nenhum
  aviso de sinal nesta folha.
- Se o contrato mudar os limites, vale o contrato (a tela lê `LIMITES_ENDERECO_PEDIDO`).
- Recusa da API (`endereco_invalido`): **Endereço de entrega incompleto. Confira CEP, rua, número, bairro, cidade e UF.**

### C.4 Onde o endereço do pedido aparece
| Lugar | Como |
|---|---|
| Resumo, linha ENTREGA | "Rua Pará, 140, fundos · São Geraldo · Manaus/AM · CIF"; editado: 2ª linha 12 `accentInk` "Editado neste pedido" |
| Detalhe (Campo, Gestão, BKO) | seção **Entrega** depois do Total: endereço em 14 `ink` e o `Selo` "Editado neste pedido" quando for o caso |
| PDFs (pedido e orçamento) | "Endereço de entrega:" com o endereço do pedido, sem marca (para o cliente, é o endereço da entrega) |
| Devolução ao ERP | o endereço do pedido (modulo-integracao; contrato do engenheiro-software) |

## D. Aba Itens sem "Catálogo"
```
Total do pedido · 3 itens                 R$ 69,96
[🔍 Código, descrição ou veículo            ]
NO PEDIDO
...itens...
LEVE MAIS E PAGUE MENOS · COMBINA COM O PEDIDO
```
- **Sai a trilha "Catálogo ›"** (`Trilha compacta` com `irParaCatalogoDoPedido`) logo abaixo da busca. Item novo só pela
  `CampoBusca` da aba (RF-VEN-11). Nenhum toque nesta aba leva para fora do pedido.
- Sem item e sem busca: `EstadoVazio` ícone `search`, título **Nenhum item ainda**, apoio **Busque pelo código, descrição ou
  veículo.** (sem ação; a busca está logo acima).
- Busca sem resultado e busca com erro: como hoje (`textoBuscaSemResultado`, `MENSAGEM_ERRO_BUSCA`).

## F. Rascunhos (RN-VEN-38/39)

### F.1 Entrada: aba Pedidos, no topo
```
Pedidos                                   ⟳ 05:51
┌ accentSoft ──────────────────────────────┐
│ ✎  Rascunhos (2)                       › │
│    Somem 24 h após a última alteração     │
└──────────────────────────────────────────┘
[🔍 Buscar pedido              ] [⚙ Filtro]
(Todos 12) (Na fila 1) (Aprovado 5) ...
```
- `LinhaAtalho` (o mesmo atalho do kit: fundo `accentSoft`, raio 12, ícone `edit`, rótulo e apoio, seta `accentInk`), **entre o
  título e a busca**. Rótulo `rotuloComContador('Rascunhos', n)`; apoio **Somem 24 h após a última alteração**.
- Só aparece com **1 ou mais** rascunhos. Sem rascunho, a tela Pedidos fica como hoje.
- No **Gestão**, a mesma linha (os rascunhos do pedido em nome).
- Por que na aba Pedidos: é onde o vendedor procura um pedido; o Início já tem a retomada do RN-VEN-38 ("Pedido não terminado").
- Os rascunhos **saem da lista de Pedidos** (a tag "Salvo" deixa de aparecer na lista): ficam só em Rascunhos. Um pedido que some
  sozinho da lista principal pareceria perda de dado (premissa, §P).

### F.2 Tela Rascunhos
```
‹ Pedidos
Rascunhos
┌──────────────────────────────────────────┐
│ Atacadinho Cachoeirinha        R$ 69,96  │
│ cód. C5007 · 3 itens                   › │
│ Alterado hoje às 05:51                   │
├──────────────────────────────────────────┤
│ Mercadinho São Jorge           R$ 19,90  │
│ cód. C5002 · 1 item                    › │
│ Alterado ontem às 08:10  [Some em 2 h]   │
├──────────────────────────────────────────┤
│ Supermercado Rio Negro         R$ 0,00   │
│ Edição do orçamento 000012 · 0 itens   › │
│ Alterado hoje às 04:30                   │
└──────────────────────────────────────────┘
```
- Tela da pilha da aba Pedidos (avançar lateral 240 ms; Voltar volta a Pedidos). `BackLink "Pedidos"`, título `t.h1`
  **Rascunhos**.
- Uma lista num cartão branco (raio 14, traço `lineSoft` entre as linhas), **mais recente primeiro**. Cada linha (alvo inteiro,
  ≥ 72 dp, afunda 0,97):
  - linha 1: nome do cliente 15/600 `ink` (até 2 linhas) e o **total** à direita, Archivo 700 16 tabular;
  - linha 2: "cód. C5007 · 3 itens" 13 `ink2` (`textoDeItens`; 0 itens: "sem itens"); edição de um registro salvo:
    "Edição do orçamento 000012 · 3 itens" / "Edição do pedido 000013 · 3 itens";
  - linha 3: "Alterado hoje às 05:51" 12 `ink2` (hoje / ontem / dd/mm, fuso do tenant) e, **faltando menos de 3 h** para sumir,
    o `Selo` aviso **Some em 2 h** (menos de 1 h: **Some em 40 min**). Cor sempre com texto.
- **Tocar** abre o Novo pedido daquele rascunho **na aba em que o vendedor parou** (o rascunho de "Apenas salvar" abre no Resumo,
  com o bloco "Falta para salvar", como hoje). Os mesmos itens, forma, prazo, entrega e desconto.
- Sem ação de apagar na lista: Descartar fica dentro do pedido (Cancelar → Descartar, RN-VEN-38). O rascunho some sozinho em 24 h.
- TalkBack da linha: "Atacadinho Cachoeirinha, 3 itens, R$ 69,96, alterado hoje às 5 e 51. Some em 2 horas." + dica "Continuar
  o pedido".

### F.3 Estados de Rascunhos
| Estado | Como fica |
|---|---|
| Carregando | 3 linhas-esqueleto (`lineSoft`) |
| Vazio (o último sumiu com a tela aberta) | `EstadoVazio` título **Nenhum rascunho**, apoio **O pedido que você deixa sem enviar fica aqui por 24 h.**, ação **Voltar a Pedidos** |
| Erro de leitura | `EstadoVazio` título **Não foi possível abrir os rascunhos**, apoio **Puxe a tela para tentar de novo.** |
| Offline | igual (tudo mora no aparelho); sem aviso de sinal nesta tela |
| Cliente fora da carteira | a linha aparece em `ink3`, sem toque, com "Cliente fora da sua carteira" no lugar da linha 3; some em 24 h |

### F.4 Ao sair do pedido sem a pergunta (RN-VEN-38)
Quando uma saída grava o rascunho sem passar pela folha "Sair do pedido?" (Voltar do Android a partir de outra tela, troca de aba
da barra, app em segundo plano), a próxima tela mostra o `AvisoRodape` **Pedido guardado em Rascunhos** com a ação **Abrir**
(5 s, sem Desfazer). Pela folha (Apenas salvar), continua **Pedido salvo** (`pedido-v2.md` §2.3).
A folha "Pedido não terminado" do Início (reabertura depois de o sistema fechar o app) continua igual.

## G. Orçamento: "preço de dd/mm" no lugar da validade (RN-VEN-18/32)
- Etiqueta do orçamento (detalhe, lista Pedidos, Gestão e BKO): `Selo` roxo **Orçamento · preço de 09/11**, com a data em que os
  preços foram congelados (a emissão do orçamento; editar com novos preços muda a data), no fuso do tenant. Outro ano: "preço de
  09/11/25". Saem **"Orçamento · até 16/11"** e **"Orçamento · vencido"**. O selo é sempre roxo: o orçamento não vence.
- Detalhe do orçamento, ação principal **Transformar em pedido** em qualquer data. Com o preço congelado vencido (depois de D+7
  23:59 do fuso, decisão do domain do Vendedor), o principal ganha o apoio 12 `ink2` **Entra pelos preços de hoje**.
- Ao tocar com preço vencido e **total diferente**, sobe a folha **Preços de hoje** antes de transformar:
```
Preços de hoje
Orçamento (preço de 09/11)            R$ 69,96
Hoje                                  R$ 72,10
Diferença                            +R$ 2,14
MUDARAM
Café torrado 500 g · 2 UN   R$ 12,90 → R$ 13,97
Açúcar 1 kg · 6 UN          R$ 4,29 → R$ 4,49
[  Transformar com os preços de hoje  ]          ← principal
                Voltar
```
  - Totais em `TabelaValores` (Diferença: aumento `ink` com "+", queda `success` com "−"); itens que mudaram em `LinhaValor`
    ("nome · qtd medida" ··· "R$ antes → R$ hoje"), até 8 e "Ver os 12 itens".
  - Total igual: transforma direto, sem folha. Item que saiu da tabela de hoje: linha em `danger` "Sem preço hoje" e o principal
    vira **Transformar sem este item** (premissa, §P).
- Na aba Resumo do cliente da RN-VEN-13, sai o texto "Válido até 15/11" embaixo de Salvar como orçamento.
- Histórico do orçamento: sem a tag **Vencido** (RN-VEN-30).

## T. Textos finais (copiar exatamente)
| Onde | Texto |
|---|---|
| Venda | `Crédito do cliente` · `Limite` · `Disponível` · `Prazo médio` · `45 dias` · `Atualizado hoje às 05:38` · `Sem dados de crédito deste cliente.` · `Crédito indisponível agora. Sincronize o aparelho.` |
| Entrega | `Endereço de entrega` · `Alterar` · `Editar` · `Principal` · `Editado neste pedido` · `Frete` · `CIF` · `FOB` · `Transportadora` · `Observações` |
| Folha do endereço | `Endereço de entrega` · `Editar endereço deste pedido` · `Voltar` |
| Formulário | `Endereço deste pedido` · `Só neste pedido. O cadastro do cliente não muda.` · `CEP` · `Rua` · `Número` · `Complemento` · `Bairro` · `Cidade` · `UF` · `Usar neste pedido` · `Voltar` · `Obrigatório` · `CEP com 8 números` · `Use pelo menos 2 letras` · `Descartar a edição?` · `Continuar editando` · `Descartar` |
| Itens | `Nenhum item ainda` · `Busque pelo código, descrição ou veículo.` |
| Pedidos | `Rascunhos (2)` · `Somem 24 h após a última alteração` |
| Rascunhos | `Rascunhos` · `cód. C5007 · 3 itens` · `Edição do orçamento 000012` · `Alterado hoje às 05:51` · `Some em 2 h` · `Some em 40 min` · `Nenhum rascunho` · `O pedido que você deixa sem enviar fica aqui por 24 h.` · `Voltar a Pedidos` · `Cliente fora da sua carteira` |
| Saída | `Pedido guardado em Rascunhos` · `Abrir` |
| Orçamento | `Orçamento · preço de 09/11` · `Transformar em pedido` · `Entra pelos preços de hoje` · `Preços de hoje` · `Orçamento (preço de 09/11)` · `Hoje` · `Diferença` · `Mudaram` · `Transformar com os preços de hoje` · `Sem preço hoje` · `Transformar sem este item` · `Voltar` |

## K. Componentes do kit
| Peça | Componente | Situação |
|---|---|---|
| tabela do crédito, totais da folha "Preços de hoje" | **`TabelaValores`** (novo, `valores.tsx`) | designer-ux entrega no kit |
| selos Principal, Editado neste pedido, Some em 2 h, Orçamento · preço de | `Selo` (tons neutro, destaque, aviso, roxo) | já existe |
| entrada Rascunhos | `LinhaAtalho` (ícone `edit`) + `rotuloComContador` | já existe |
| folha do endereço, formulário | `Folha`, `ListaSuspensa` (UF), `Botao`; rádio desenhado no módulo (o `OpcaoFolha` não tem rádio) | já existe |
| ✕ das folhas (endereço, formulário, Preços de hoje) | `Folha` com `titulo` e `fechar={{ rotulo: 'Fechar' }}` (48 dp, fixo, fora da rolagem) | entregue na revisão T-0141 |
| "Editado neste pedido" na linha ENTREGA do Resumo | `LinhaResumo` com `marca` | entregue na revisão T-0141 |
| aviso de saída | `AvisoRodape` com ação | já existe |
| vazio de Itens e de Rascunhos | `EstadoVazio` | já existe |

## R. Critérios da revisão de UX (antes do merge)
1. Aba Venda: o crédito é a tabela do §A, com os 3 rótulos, valores em Archivo negrito à direita, traços entre as linhas e a
   atualização abaixo; nenhum "Limite R$ x · disponível R$ y" em frase.
2. Aba Entrega: sem frase abaixo do CIF/FOB; cartão do endereço com selo de origem e a ação Alterar/Editar; folha e formulário
   como C.2 e C.3; o selo "Editado neste pedido" no cartão, no Resumo e no detalhe.
3. Aba Itens: sem "Catálogo"; nenhum toque leva para fora do pedido.
4. Pedidos: linha Rascunhos só com rascunho; tela Rascunhos com cliente, total, nº de itens, hora e o selo "Some em" (< 3 h);
   tocar retoma na aba em que parou.
5. Orçamento: só "preço de dd/mm"; nenhum "até dd/mm", "vencido" ou "Válido até" no app, no BKO e no PDF.
6. Print do aparelho (360 dp e 412 dp) igual às imagens aprovadas; alvos ≥ 48 dp; contraste ≥ 4,5:1.
7. Barra inferior com as **5 abas** (Início · Rota · Clientes · Pedidos · Mais) e a aba acesa do §0.1.
8. Endereço sem sinal (modo avião): o formulário abre, aceita tudo à mão e não grava sem Cidade e UF.

**Revisão pelo código (2026-11-09):** `docs/design/revisoes/T-0141.md`. A e B 🟢; C, D, F e G voltam com 5 🔴 (edição salva fora das
24 h da RN-VEN-39, vazio de Itens, frase "Preço de dd/mm", ✕ e traços das folhas, CEP e foco do formulário), 8 🟡 e 9 🟢. O print do
aparelho (R6) segue pendente.

## P. Premissas (ajustáveis pelo dono do produto)
- Um rascunho por cliente para pedido novo (como hoje no aparelho) e um por registro em edição.
- Rascunhos saem da lista Pedidos e ficam só na tela Rascunhos.
- Sem apagar na lista de Rascunhos (Descartar fica dentro do pedido).
- Selo "Some em" só nas últimas 3 h.
- Endereço editado sem busca pelo CEP (offline primeiro; confirmado pelo dono do produto: à mão, Cidade e UF obrigatórias); os campos e limites são os do contrato (§C.3: 60/20/60/60/60, UF 27, CEP 8).
- Na folha "Preços de hoje", item sem preço hoje sai do pedido gerado ("Transformar sem este item"; com 2 ou mais, "Transformar
  sem estes itens"); o domain do Vendedor decide se a regra é essa.

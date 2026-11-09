# Catálogo pela hierarquia, do maior agrupamento para o menor (T-0142; app e BKO)

> 2026-11-09 · designer-ux · pedidos do dono do produto R-20261109-065241-alexandre e R-20261109-065415-alexandre (4 decisões
> confirmadas), teste do Campo-Demo-v1.0.1 (Mais › Catálogo, 09/11 06h49). Regra: **RF-CAT-09** (e RF-CAT-04, árvore do ERP).
> **Substitui** a versão da T-0085 fatia D (lista "Por linha" à parte e o atalho **"Ver por linha"**, `LinhaAtalho` na aba
> Catálogo): o atalho sai, e a tela "Por linha" deixa de ser uma vista separada; a página inicial do Catálogo passa a ser a própria
> hierarquia. Vale igual no **Campo** e no **Gestão**; o **BKO** usa a mesma hierarquia (§6).
> **Imagem para aprovação:** `docs/design/telas/T-0142-catalogo-hierarquia.png` (fonte: o `.html` de mesmo nome).
> Telas: modulo-catalogo (`modules/catalogo/app/telas/catalogo.tsx`, `arvore.tsx`, `lista-por-linha.tsx`; BKO
> `modules/catalogo/web/pages/catalogo-page.tsx`). A navegação pela hierarquia é **uma função pura do domain** do Catálogo, a mesma
> no app e no BKO; a tela só desenha o que ela devolve.

## 1. Regra da navegação (as 4 decisões, para o domain do Catálogo)
1. **Começa pelo nível mais alto que existir** e **pula os níveis vazios**. Sem hierarquia nenhuma no tenant, a página inicial é a
   lista de produtos com a busca (§4).
2. **Nível com um item só pula direto para o de baixo** (vale também na raiz: um único sistema abre já nos grupos dele). O nível
   pulado aparece na trilha, sem toque (§3.2).
3. **Contagem de produtos ativos** ao lado de cada nível: ativos e não excluídos do tenant, somando os níveis de baixo, sem filtro
   de estoque. A soma das linhas de um nível bate com o total do nível de cima (o testes confere valor × regra).
4. **BKO com a mesma hierarquia** (§6).

Mais dois casos que a função precisa cobrir, para nenhum produto sumir:
- produto ligado a um nível que também tem filhos: entra numa última linha **Outros produtos** daquele nível (com a contagem);
- produto sem nível, num tenant com hierarquia: última linha **Sem classificação** na raiz.

Cada tela mostra **um nível só** (os filhos do nível aberto). Níveis de profundidades diferentes nunca aparecem juntos (o caso
"Alimentos, Bebidas … Automotivo, Freios, Filtros" da demo é defeito de dado ou de regra; a causa fica com o modulo-catalogo).

## 2. App: página inicial (raiz)
```
Catálogo                                   ⟳ 06:49
Preços da tabela do cliente selecionado.
[🔍 Ex.: refrigerante 2 litros, café, CAF-500 ]

SISTEMAS                                PRODUTOS
┌──────────────────────────────────────────────┐
│ Alimentos                            16    › │
├──────────────────────────────────────────────┤
│ Bebidas                               5    › │
├──────────────────────────────────────────────┤
│ Limpeza e higiene                     7    › │
├──────────────────────────────────────────────┤
│ Automotivo                           12    › │
└──────────────────────────────────────────────┘
40 produtos ativos · atualizado hoje às 06:49
```
- Topo, título, subtítulo, `SyncStamp` e busca: **como estão** (a busca continua no topo).
- **Sem** `LinhaAtalho "Ver por linha"`, sem trilha na raiz, **sem lista de produtos** abaixo dos níveis e sem chips de linha
  (a hierarquia já é o filtro). Os chips "Com estoque" e de marca ficam só na lista de produtos (§4).
- Cabeçalho da lista (`RotuloSecao` com rótulo à direita): à esquerda o **nome do nível no plural** ("Sistemas", "Grupos",
  "Linhas"; o domain devolve, a partir dos nomes dos níveis do ERP; sem nome: "Categorias"); à direita **Produtos**.
- **Lista de níveis** (`ListaNiveis`, do kit; §7): um cartão branco, raio 14, traço `lineSoft` entre as linhas.
  Linha de **56 dp** no mínimo (alvo inteiro, afunda 0,97): nome 15/600 `ink` em até 2 linhas; contagem **Archivo 700 15
  tabular** `ink`, alinhada à direita; seta `chevron` 16 `ink3`. TalkBack: "Alimentos, 16 produtos, botão".
- Rodapé da lista, 12 `ink2`: "40 produtos ativos" e, como hoje, a linha de atualização do catálogo.

## 3. App: tocar num nível
### 3.1 Nível intermediário (ex.: Automotivo → grupos)
```
Catálogo                                   ⟳ 06:49
[🔍 ...                                         ]
Catálogo › Automotivo
GRUPOS                                  PRODUTOS
│ Freios                                 5    › │
│ Filtros                                4    › │
│ Suspensão                              3    › │
```
- Cada nível é uma **tela nova na pilha da aba** (avançar lateral 240 ms; com "reduzir movimento", troca sem deslizar). O
  **Voltar** (seta do topo, gesto ou botão do Android) **sobe um nível**; da raiz, sai como hoje. O nível vai no endereço da tela
  (`noId`), para o Voltar e a retomada funcionarem.
- O título da tela continua **Catálogo**; o lugar é dito pela **trilha** logo abaixo da busca.

### 3.2 Trilha
- `Trilha` do kit, 13: "Catálogo › Automotivo › Freios". Anteriores tocáveis (`accentInk` 600, alvo 44 dp), **o atual não é
  tocável** (`ink` 600). Nível **pulado** (um item só) aparece em `ink2`, sem toque: tocar nele levaria à mesma tela.
- Na raiz, sem trilha.

### 3.3 Último nível: produtos (ex.: Freios → Pastilhas e lonas)
```
Catálogo › Automotivo › Freios › Pastilhas
Pastilhas                                         ← h2, Archivo 17
(Com estoque) (Bosch) (Cobreq) (Fras-le)
12 produtos
[cartão do produto] …
```
- Título do nível em `t.secao` (Archivo 700, 17) e, abaixo, os chips **Com estoque** (quem vê estoque) e de **marca**, como hoje.
- "12 produtos" (12 `ink2`) e os cartões de produto **como estão** (`CartaoProduto`: foto, código, descrição até 2 linhas,
  aplicação até 2 linhas, preço e estoque no contexto do cliente; promotor sem preço e estoque, RN-CAT-05).
- Muitos itens: "120 produtos · mostrando 100" (como hoje).

## 4. Sem hierarquia no tenant
A página inicial é a lista de produtos com a busca, os chips e a contagem (como a tela de hoje sem árvore). Sem trilha e sem
cabeçalho de nível.

## 5. Busca e estados
- **Busca** (como está): com texto, os resultados substituem a lista de níveis, procurando **no catálogo inteiro** (não só no
  nível aberto). Cada resultado mostra o caminho em 12 `ink2` acima da descrição ("Automotivo › Freios › Pastilhas"). Limpar a
  busca volta ao nível em que a pessoa estava. Vazio da busca: o `vazioDaBusca` de hoje.

| Estado | Como fica |
|---|---|
| Carregando | 4 linhas-esqueleto no cartão de níveis (`lineSoft`), sem indicador girando |
| Sem sincronização (sem motor) | `Empty` "O catálogo aparece depois da primeira sincronização. Entre com o seu usuário e sincronize o aparelho." (como está) |
| Erro de leitura | `EstadoVazio` "Não foi possível abrir o catálogo agora." · "Puxe a tela para tentar de novo." |
| Vazio na raiz | `EstadoVazio` "Nenhum produto neste aparelho ainda" · "Puxe a tela para sincronizar o catálogo." |
| Vazio num nível | `EstadoVazio` "Nenhum produto neste nível" · "Volte um nível ou sincronize o aparelho." · ação **Voltar um nível** |
| Nível removido (depois de sincronizar) | `EstadoVazio` "Este nível não está mais no catálogo" · mesma ação |
| Sem sinal | `SyncStamp` "sem sinal"; nada some (tudo vem do aparelho, FTS5/SQLite) |
| Nível com 0 produtos ativos | **não aparece** na lista (o domain já pula) |

## 6. BKO: Catálogo pela mesma hierarquia
```
Catálogo                                          [Exportar PDF] [Exportar Excel]
[🔍 Buscar por código, descrição ou aplicação                    ]
Catálogo › Automotivo
┌──────────────────────────────────────────────────────────────┐
│ Grupo                                      Produtos ativos   │
├──────────────────────────────────────────────────────────────┤
│ Freios                                              5      › │
│ Filtros                                             4      › │
│ Suspensão                                           3      › │
└──────────────────────────────────────────────────────────────┘
```
- Mesma função do domain, mesmos casos do §1. Sem atalho à parte e **sem o filtro "Categoria"** (a hierarquia o substitui).
- Tabela de níveis (largura do conteúdo até 880 px): cabeçalho com o **nome do nível** ("Sistema", "Grupo", "Linha") e
  **Produtos ativos** (alinhado à direita, tabular); a **linha inteira é o link** (altura 48 px, foco visível de 2 px `accent`,
  `hover` no `ground`), seta à direita. Leitor de tela: "Freios, 5 produtos ativos, link".
- Trilha (breadcrumb `nav` com `aria-label="Caminho no catálogo"`, atual com `aria-current="page"`) acima da tabela.
- O nível vai na URL (`?no=<id>`): o Voltar do navegador sobe um nível e o endereço pode ser compartilhado.
- Último nível: a **tabela de produtos de hoje** (mesmas colunas e ações), com "12 produtos" acima.
- Busca: resultados na tabela de produtos com a coluna **Caminho** ("Automotivo › Freios › Pastilhas").
- Estados: carregando (linhas-esqueleto), vazio ("Nenhum produto neste nível"), erro (a `TelaDeErro`/aviso padrão do BKO).
- A exportação em PDF/Excel continua no topo e exporta o nível aberto (na raiz, o catálogo inteiro).

## 7. Componentes do kit
| Peça | Componente | Situação |
|---|---|---|
| lista de níveis (app) | **`ListaNiveis`** (`@macuxi/ui/mobile`, `navegacao.tsx`): `itens: { id, nome, contagem, pulado? }[]`, `rotulo`, `rotuloContagem`, `onEscolher` | designer-ux entrega no kit; substitui o `NiveisArvore` do módulo |
| trilha | `Trilha` (sem `atualTocavel`; item `desligado` para nível pulado) | já existe; a opção `desligado` entra com a `ListaNiveis` |
| atalho "Ver por linha" | `LinhaAtalho` | **sai do Catálogo** (o componente fica no kit para outros usos, ex.: Rascunhos da T-0141) |
| BKO | tabela do kit web (`tabela.ts`) + a `Trilha` web | já existe |

## 8. Textos finais
| Lugar | Texto |
|---|---|
| Cabeçalho da lista | `Sistemas` / `Grupos` / `Linhas` (nomes do ERP no plural; sem nome: `Categorias`) · `Produtos` |
| Linhas extras | `Outros produtos` · `Sem classificação` |
| Rodapé da raiz | `40 produtos ativos` |
| Trilha | `Catálogo › Automotivo › Freios` |
| Último nível | `12 produtos` · `Com estoque` |
| Estados | os do §5 |
| BKO | `Produtos ativos` · `Caminho` · `Caminho no catálogo` (leitor de tela) |

## 9. Conferir no APK (Campo e Gestão, 360 dp) e no BKO
- A aba Catálogo abre pela hierarquia, sem "Ver por linha"; um nível por tela; contagem à direita; Voltar sobe um nível.
- Um sistema só: abre já nos grupos, com o sistema na trilha sem toque. Sem hierarquia: lista de produtos com a busca.
- Offline: tudo igual. Promotor: sem preço e estoque e sem ação de pedido.
- BKO: mesma hierarquia e contagens, nível na URL, Voltar do navegador sobe um nível, sem o filtro "Categoria".

## 10. Premissas (ajustáveis pelo dono do produto)
- Os nomes dos níveis no cabeçalho vêm do ERP (no plural); sem nome, "Categorias".
- A busca procura no catálogo inteiro, não só no nível aberto.
- "Outros produtos" e "Sem classificação" no fim da lista, para nenhum produto ficar sem caminho.
- A exportação do BKO segue o nível aberto.

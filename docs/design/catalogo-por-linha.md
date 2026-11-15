# Catálogo pela hierarquia, do maior agrupamento para o menor (T-0142; app e BKO)

> **Tipografia substituída** pela fonte do sistema (R-20261115-110600, 15/11/2026): ver o [manual da marca §5](../marca/manual.md#5-tipografia).
> Famílias, pesos acima de 700 e tamanhos fora da escala citados abaixo ficam só como histórico.

> 2026-11-09 · designer-ux · pedidos do dono do produto R-20261109-065241-alexandre e R-20261109-065415-alexandre (4 decisões
> confirmadas), teste do Campo-Demo-v1.0.1 (Mais › Catálogo, 09/11 06h49). Regra: **RF-CAT-09** (e RF-CAT-04, árvore do ERP).
> **Substitui** a versão da T-0085 fatia D (lista "Por linha" à parte e o atalho **"Ver por linha"**, `LinhaAtalho` na aba
> Catálogo): o atalho e a tela "Por linha" **saíram** (a tela foi apagada pelo modulo-catalogo, decisão do gerente
> R-20261109-094901, premissa que o dono do produto confirma pela imagem); a página inicial do Catálogo é a própria hierarquia e há
> **uma só lista de produtos**, a do último nível (§3.3). Vale igual no **Campo** e no **Gestão**; o **BKO** usa a mesma hierarquia (§6).
> **Imagem:** `docs/design/telas/T-0142-catalogo-hierarquia.png` (fonte: o `.html` de mesmo nome). **Aprovada** pelo dono do
> produto (R-20261109-121701) com uma ressalva, já corrigida na imagem: a barra inferior tem as **5 abas** do Campo (§2.1).
> Telas: modulo-catalogo (`modules/catalogo/app/telas/catalogo.tsx`, cartão `CartaoProduto` em `telas/comum.tsx`; BKO
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

### 2.1 Barra inferior: 5 abas (ressalva do dono do produto, R-20261109-121701)
- O Campo do vendedor mantém as **5 abas: Início · Rota · Clientes · Pedidos · Mais**. **A Rota não sai** sem decisão do dono do
  produto. O Catálogo fica dentro do **Mais**, que fica aceso em todas as telas do Catálogo (raiz, níveis, produtos e busca).
- Quem monta é o shell (`abasDoShell`, `apps/mobile/src/lib/abas.ts`); o desenho é a `BarraAbas` do kit (64 dp + área segura,
  ícones `home`, `pin`, `users`, `clipboard`, `menu`). As telas do Catálogo não mexem na barra. No Gestão, as abas são as do
  perfil (o shell decide), com o mesmo desenho.

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
┌──────────────────────────────────────────────┐
│ [foto] PST-1022 · JG                         │
│        Pastilha de freio dianteira           │
│        Serve em: Gol, Voyage, Saveiro 1.0/…  │  ← até 2 linhas
│        Equivale a: Cobreq N-1022 · Fras-le … │
│        (Cerâmica) (Com sensor)               │  ← etiquetas
│        R$ 89,90                 [Estoque 24] │
└──────────────────────────────────────────────┘
```
- Título do nível em `t.secao` (Archivo 700, 17) e, abaixo, os chips **Com estoque** (quem vê estoque) e de **marca**, como hoje.
- "12 produtos" (12 `ink2`) e **um só cartão de produto**, o `CartaoProduto` (`modules/catalogo/app/telas/comum.tsx`), o mesmo
  da busca, nesta ordem: foto, código, descrição até 2 linhas, **"Serve em:"** com a aplicação **em até 2 linhas** com
  reticências (RN-CAT-12; a ficha mostra tudo), **"Equivale a:"** com as referências de concorrente (RN-CAT-09), as
  **etiquetas** em `Selo` neutro (até 4), preço e estoque no contexto do cliente (promotor sem preço e estoque, RN-CAT-05).
  Rótulos "Serve em:"/"Equivale a:" em `t.smallStrong`, texto em `t.sub` `ink2`. Tudo lido do aparelho (offline igual).
  Sem aplicação, referência ou etiqueta: a linha não aparece (nada de "Sem aplicação").
- **"Oferece junto" só na ficha** (`catalogo-aplicacao.md` §3.1), não no cartão: manteria o cartão alto demais para a lista.
- Na busca, o mesmo cartão mostra o caminho acima da descrição e o trecho achado em negrito (§5).
- Muitos itens: "120 produtos · mostrando 100" e **Mostrar mais** (de 100 em 100).

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
- Busca: resultados na tabela de produtos com a coluna **Caminho** ("Automotivo › Freios › Pastilhas") **no lugar** da coluna
  Categoria (RD-0047, 10/11): as duas dizem onde o produto fica, e a hierarquia substitui a categoria do ERP. Quando o Caminho não
  vem (perfil sem leitura do cadastro, `mostrarCaminho` falso), a Categoria fica, para a busca não perder a única pista de lugar.
- Estados: carregando (linhas-esqueleto), vazio ("Nenhum produto neste nível"), erro (a `TelaDeErro`/aviso padrão do BKO).
- A exportação em PDF/Excel continua no topo e exporta o nível aberto (na raiz, o catálogo inteiro).

## 7. Componentes do kit
| Peça | Componente | Situação |
|---|---|---|
| lista de níveis (app) | **`ListaNiveis`** (`@macuxi/ui/mobile`, `navegacao.tsx`): `itens: { id, nome, contagem, pulado? }[]`, `rotulo`, `rotuloContagem`, `onEscolher` | designer-ux entrega no kit; substitui o `NiveisArvore` do módulo |
| trilha | `Trilha` (sem `atualTocavel`; item `desligado` para nível pulado) | já existe; a opção `desligado` entra com a `ListaNiveis` |
| cartão de produto (último nível e busca) | `CartaoProduto` (do módulo, `telas/comum.tsx`) com `Selo`/`Badge` do kit | já existe; a tela "Por linha" e a lista dela saíram |
| atalho "Ver por linha" | `LinhaAtalho` | **saiu do Catálogo** (o componente fica no kit: Rascunhos da T-0141) |
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
- Último nível: o mesmo cartão da busca, com "Serve em:" em até 2 linhas, "Equivale a:" e etiquetas; nenhuma outra lista de
  produtos no app (sem tela "Por linha").
- Um sistema só: abre já nos grupos, com o sistema na trilha sem toque. Sem hierarquia: lista de produtos com a busca.
- Offline: tudo igual. Promotor: sem preço e estoque e sem ação de pedido.
- Barra inferior do Campo (vendedor) com as 5 abas Início · Rota · Clientes · Pedidos · Mais e o "Mais" aceso em todos os níveis
  e na busca (§2.1).
- BKO: mesma hierarquia e contagens, nível na URL, Voltar do navegador sobe um nível, sem o filtro "Categoria".

## 10. Premissas (ajustáveis pelo dono do produto)
- Os nomes dos níveis no cabeçalho vêm do ERP (no plural); sem nome, "Categorias".
- A busca procura no catálogo inteiro, não só no nível aberto.
- "Outros produtos" e "Sem classificação" no fim da lista, para nenhum produto ficar sem caminho.
- A exportação do BKO segue o nível aberto (premissa do gerente, R-20261109-094901).
- Uma só lista de produtos (o último nível com o `CartaoProduto` rico); "Oferece junto" só na ficha (premissa do gerente,
  R-20261109-094901; entrega R-20261109-103358-modulo-catalogo).

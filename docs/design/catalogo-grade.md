# Catálogo em grade, igual à simulação de marca (app Campo)

> 2026-11-13 · designer-ux · T-0173 · Origem: R-20261112-180555, -181237 e -181527 (Alexandre). Regra de preço: RN-VEN-01,
> "Catálogo sem cliente" (doc 03). **Em aprovação**: o código só muda depois do "aprovado" do dono do produto.
> Imagens a 412 dp, na marca v1: `docs/design/telas/T-0173-catalogo-menu.png` (pelo menu), `T-0173-catalogo-filtro.png`
> (sistema e categoria escolhidos) e `T-0173-catalogo-cliente.png` (pela ficha do cliente). Fonte: `T-0173-catalogo.html`
> (`?v=menu|filtro|cliente`). Referência: a simulação de marca (`recados/anexos/2026-11-12-catalogo-simulacao-marca.png`).
> **Substitui** a parte de lista e busca do `rota-catalogo-perfil.md` §3 e a entrada por "Sistemas" (`ListaNiveis`, imagem
> T-0142). A ficha do produto continua como no §3.

Tela: `modules/catalogo/app/telas/catalogo.tsx` e `comum.tsx` (modulo-catalogo).

## 1. Ordem da tela
1. **Faixa Azul noite** (`<Screen cabecalho>`, `componentes.md` §5.2):
   - título `Catálogo`;
   - subtítulo **abaixo** do título, como em Clientes (`posicaoSubtitulo="abaixo"`, o padrão; MC-0008): a contagem da lista,
     `40 produtos` (`1 produto` no singular). Com filtro ou busca, a contagem é a do resultado (`5 produtos`);
   - à direita, a hora do sync: `SeloAtualizacao` com `sobreFaixa` (`↻ 06:30`, "Atualizando…", "Sem sinal", "Sem resposta",
     os textos de `desenhoSeloAtualizacao`). O toque é o mesmo do puxar para baixo;
   - aberto pela ficha do cliente: o voltar na faixa com o nome do cliente (`‹ Mercadinho São Jorge`).
2. **Busca** (`CampoBusca` 48): `Produto, código ou aplicação`, com o ✕ para limpar. Mesmas regras de hoje (offline, 3 letras,
   `Você quis dizer`, `NadaEncontrado`).
3. **Sistema** em chips (`LinhaChips` + `Chip` 36, rola na horizontal): `Todos` (marcado ao abrir) e um chip por sistema, na
   ordem do cadastro.
4. **Categoria** em chips, numa 2ª linha, **só depois de escolher um sistema**: `Todas` (marcado) e as categorias daquele
   sistema. Níveis abaixo da categoria não viram chip: os produtos deles entram na grade da categoria.
5. **Grade** de 2 colunas (§2).
6. Fim da lista: `MostrarMais` com `contagem={false}` (só o botão `+ Mostrar mais`; a contagem já está na faixa). Páginas de 20.

Com busca, os chips continuam e filtram o resultado. Trocar de sistema volta a categoria para `Todas`.

**Saem:** a linha "Abra pela ficha do cliente para ver o preço da tabela dele." (e a "Preços da tabela do cliente
selecionado."), a lista de "Sistemas" como entrada, a trilha, o título do nível, "40 produtos ativos", "Atualizado às… · puxe
para sincronizar" e os chips de marca e "Com estoque" (a busca acha pela marca; o estoque está em cada cartão).

## 2. Cartão do produto
`Cartao` branco (borda `line`, raio 16, respiro 10 em cima e dos lados e 12 embaixo), 180 dp de largura no aparelho de 412 dp
(colunas iguais, 12 dp entre elas e entre as linhas). Os dois cartões de uma linha têm a altura do maior; preço e tag ficam
embaixo, alinhados. O cartão inteiro é o alvo e abre a ficha.

| Ordem | O que aparece | Como |
|---|---|---|
| 1 | foto | 112 dp de altura, raio 12, `cover`. Sem foto: a caixa `neutralBg` vazia, do mesmo tamanho (sem a inicial, que repetia a 1ª letra do nome; RD-0242) |
| 2 | nome | 15/600, até 2 linhas com reticências |
| 3 | marca | 13 `ink2`, 1 linha. Sem marca no cadastro, a linha fica vazia |
| 4 | preço | Archivo 700 18, números tabulares (§3) |
| 5 | estoque | `ChipEstado pequeno` (24 dp), §4 |

- Uma informação por linha (RD-0207): sem código, sem hora do estoque e sem etiquetas no cartão. Código, etiquetas e
  estoque por filial ficam na ficha.
- Promoção: o preço de tabela riscado ao lado do preço, 12/400 `ink2` (`R$ 8,99 R$ 9,90`). É o mesmo fato (preço).
- Busca que achou pelo código do concorrente (RN-CAT-09): a linha da marca vira `Equivale a Freiomax CB 3401`, com o trecho
  destacado.
- Com o slot `produto.acoes` (dentro do pedido): botão `+` 44 dp com borda à direita do preço, TalkBack `Adicionar <produto>
  ao pedido`. Fora do pedido não aparece.
- TalkBack do cartão: `"<nome>, <marca>, <preço>, <estoque>"` (ex.: "Açúcar cristal 1 kg, Doce Vale, R$ 4,95, 6 em
  estoque").
- Promotor (RN-CAT-05, `promotor_ve_preco_estoque` = não): sem preço e sem tag; o cartão fica com foto, nome e marca.

## 3. Preço (RN-VEN-01)
| Como abriu | Preço do cartão |
|---|---|
| pelo menu (sem cliente) | o da tabela da **filial padrão** do vendedor |
| pela ficha do cliente | o da tabela do cliente |
| produto sem preço nessa tabela | `Sem preço` (15/600 `ink3`), nunca o valor de outra tabela |

Nada na tela explica de qual tabela é o preço: com cliente, o voltar na faixa já diz o nome dele.

## 4. Tag de estoque (uma só)
| Estoque | Texto | Tom do `ChipEstado` |
|---|---|---|
| 10 ou mais | `Estoque: 84` | `sucesso` (`success` sobre `successBg`, 5,5:1) |
| de 1 a 9 | `Estoque: 6` | `aviso`, o laranja da simulação (`warning` #7A4F00 sobre `warningBg` #FFF1D6, 6,4:1) |
| 0, ou nenhum saldo recebido | `Estoque: 0` | `erro` (`danger` sobre `dangerBg`, 6,0:1) |

Rótulo `Estoque: N` e o fim do `Estoque sem informação`: `catalogo-campo-v2/spec.md` §3 (R-20261115-082500).

- Tenant que não mostra a quantidade (`estoque_mostrar_quantidade` = não): `Em estoque`, `Pouco estoque`, `Sem estoque`.
- O número é inteiro, na unidade base, das filiais que valem para o estoque (RN-CAT-07; com cliente, a filial dele,
  RN-CORE-39). Sem hora no cartão.
- **A conferir pelo modulo-catalogo:** o parâmetro `estoque_baixo_ate` tem padrão 10 (doc 03, tabela de parâmetros); a regra
  pedida é de 1 a 9, a mesma do "Risco de ruptura" da folha do item (`pedido-v4.md` §5.2).

## 5. Estados
- Carregando a 1ª vez: `Loading` no lugar da grade; a faixa e a busca já aparecem.
- Catálogo ainda não chegou ao aparelho: `EstadoVazio` `O catálogo ainda não está no aparelho` com a ação `Sincronizar`.
- Filtro sem produto: `Nenhum produto em <categoria>` e o chip `Todas` continua tocável.
- Busca sem resultado: `NadaEncontrado` (sem mudança).
- Sem sinal: o `SeloAtualizacao` mostra `Sem sinal`; a grade continua com o que está no aparelho.

## 6. Componentes
`Screen` com `cabecalho` (`CabecalhoTela`), `SeloAtualizacao sobreFaixa`, `CampoBusca`, `LinhaChips`, `Chip`, `Cartao`,
`ChipEstado pequeno`, `MostrarMais contagem={false}`, `NadaEncontrado`, `EstadoVazio`, todos de `@macuxi/ui/mobile`. A grade é
uma `FlatList` com `numColumns={2}` do módulo. Nenhum componente novo além das duas props do kit (`sobreFaixa` e `contagem`).

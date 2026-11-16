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
para sincronizar" e os chips de marca (a busca acha pela marca). Filial e itens sem estoque ficam no filtro (`catalogo-campo-v2/spec.md` §4).

## 2. Cartão do produto
Cartão: `catalogo-campo-v2/spec.md` §1 (fonte única: foto, nome, códigos, preço, `Estoque: N` e o botão de estoque por filial, com o
leitor de tela e o promotor). Aqui fica só o que o v2 não muda:
- `Cartao` branco (borda `line`, raio 16), duas colunas iguais com 12 dp entre elas e entre as linhas; o cartão inteiro abre a ficha.
- Promoção: o preço de tabela riscado ao lado do preço, 12/400 `ink2` (`R$ 8,99 R$ 9,90`). É o mesmo fato (preço).
- Com o slot `produto.acoes` (dentro do pedido): botão `+` 44 dp com borda à direita do preço, TalkBack `Adicionar <produto>
  ao pedido`. Fora do pedido não aparece.

## 3. Preço (RN-VEN-01)
| Como abriu | Preço do cartão |
|---|---|
| pelo menu (sem cliente) | o da tabela da filial de cadastro do vendedor, ou da filial escolhida no filtro (`catalogo-campo-v2/spec.md` §4) |
| pela ficha do cliente | o da tabela do cliente |
| produto sem preço nessa tabela | `Sem preço` (16/600 `ink3`), nunca o valor de outra tabela |

Nada na tela explica de qual tabela é o preço: com cliente, o voltar na faixa já diz o nome dele.

## 4. Tag de estoque (uma só)
Desde R-20261115-083600, só duas cores, no cartão, na busca e na ficha (o laranja de 1 a 9 saiu):

| Estoque | Texto | Tom do `ChipEstado` |
|---|---|---|
| acima de 0 | `Estoque: 84` | `sucesso` (`success` sobre `successBg`, 5,5:1) |
| 0, negativo ou nenhum saldo recebido | `Estoque: 0` | `erro` (`danger` sobre `dangerBg`, 6,0:1) |

- Tenant que não mostra a quantidade (`estoque_mostrar_quantidade` = não): `Em estoque` ou `Sem estoque`.
- O número é inteiro, na unidade base. Valor de N, o botão `Estoque por filial` e o `999+`: `catalogo-campo-v2/spec.md` §3. Sem hora no cartão.

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

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
   - aberto pela ficha do cliente: o voltar na faixa com o nome do cliente (`‹ Mercadinho São Jorge`).
2. **Busca** (`CampoBusca` 48): `Produto, código ou aplicação`, com o ✕ para limpar. Mesmas regras de hoje (offline, 3 letras,
   `Você quis dizer`, `NadaEncontrado`).
3. Família e Sistema na folha Filtrar (`filtro-padrao-campo/spec.md` §0).
4. **Grade** de 2 colunas (§2).
5. Fim da lista: `MostrarMais` com `contagem={false}` (só o botão `+ Mostrar mais`; a contagem já está na faixa). Páginas de 20.

Com busca, o filtro continua valendo sobre o resultado.

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
| 0, negativo ou nenhum saldo recebido depois da carga (carregando: §7.3) | `Estoque: 0` | `erro` (`danger` sobre `dangerBg`, 6,0:1) |

- Tenant que não mostra a quantidade (`estoque_mostrar_quantidade` = não): `Em estoque` ou `Sem estoque`.
- O número é inteiro, na unidade base. Valor de N, o botão `Estoque por filial` e o `999+`: `catalogo-campo-v2/spec.md` §3. Sem hora no cartão.

## 5. Estados
- Carregando a 1ª vez: `Loading` no lugar da grade; a faixa e a busca já aparecem.
- Catálogo ainda não chegou ao aparelho: `EstadoVazio` `O catálogo ainda não está no aparelho` com a ação `Sincronizar`.
- Filtro sem produto: `Nenhum produto em <categoria>`.
- Busca sem resultado: `NadaEncontrado` (sem mudança).
- Sem sinal: a grade continua com o que está no aparelho.
- Erro ao abrir: §7.1.
- Estoque carregando: §7.3.

## 6. Componentes
`Screen` com `cabecalho` (`CabecalhoTela`), `CampoBusca`, `Cartao`,
`ChipEstado pequeno`, `MostrarMais contagem={false}`, `NadaEncontrado`, `EstadoVazio`, todos de `@macuxi/ui/mobile`. A grade é
uma `FlatList` com `numColumns={2}` do módulo. Nenhum componente novo além da prop `contagem` do kit.

## 7. T-0192 (v1.0.20): sem "puxar" e estoque carregando
> 2026-11-21 · designer-ux · T-0192 · Origem: R-20261121-122841 (Alexandre). Implementa: modulo-catalogo
> (`modules/catalogo/app/telas/catalogo.tsx`, `comum.tsx`, `estoque-filial.tsx`, `app/lib/`). Muda layout em
> dois pontos (§7.3): passa pelo design-de-marca.

### 7.1 Sem "puxar para sincronizar"
- **Sai o gesto**: o `<Screen>` da aba (`catalogo.tsx:218`) fica sem `refreshing` e sem `onRefresh`. Sai também o
  "(puxar a tela sincroniza)" do comentário do topo (`catalogo.tsx:4`).
- **Erro ao abrir** (hoje o aviso `Não foi possível abrir o catálogo agora. Puxe a tela para tentar de novo.`, em
  `catalogo.tsx:165` e `:184`, no `Banner` de `:251`): no lugar do `Banner` e do vazio, um só `EstadoVazio`:
  - `testID="catalogo-erro"`, `icone="alert"`;
  - título exato: `Não foi possível abrir o catálogo agora`;
  - `acao={{ rotulo: 'Tentar de novo', testID: 'catalogo-erro-acao' }}`: refaz a mesma carga da lista (o efeito de
    `catalogo.tsx:136-188`), sem sincronizar.
  - Com o erro, não aparecem o `Banner`, o `EstadoVazio` "O catálogo ainda não está no aparelho" nem o `VazioDaBusca`
    (uma informação, um lugar).
- **Continua**: o `EstadoVazio` `O catálogo ainda não está no aparelho` com a ação `Sincronizar` (`catalogo.tsx:279`,
  `onPress: auto.puxar`), só quando o aparelho está sem catálogo e não houve erro.

### 7.2 "Ainda carregando" × "não há" (critério)
O critério é do aparelho inteiro, não de cada produto: só há "carregando" com carga em andamento, como o indicador
`Catálogo NN%` do shell (`carga-fundo.ts`). Uma marca só, calculada pela tela numa função pura em
`modules/catalogo/app/lib/` (ex.: `cargaDoCartao(sync, modoCarga)` → `{ estoqueCarregando }`): `estoqueCarregando` é
verdadeira quando `modoCarga === 'local'` **e** `estoque_saldo` está em `sync.pendentes`.

- Preço não tem estado carregando: com preço pendente (`CHAVES_DO_CATALOGO`, `carga-online.ts:14-18`) a tela está em
  `'api'` ou `'sem_sinal'`, nunca em `'local'`.
- `modoCarga === 'api'` (`modoDaCarga`, ADR 0054): preço e estoque vêm da API, já reais; a marca fica falsa.
- `modoCarga === 'sem_sinal'`: continua o `CatalogoCarregando` (`TEXTO_CATALOGO_CARREGANDO`) no lugar da grade; não há cartão.
- Busca pela API em modo local (`catalogo.tsx:172-178`): com `estoqueCarregando`, a tela **não** troca o estoque da API
  pelo do aparelho; o cartão mostra o estado carregando (§7.3).
- Com a marca falsa, vale o que já existe (§3 e §4).
- O domínio (`modules/catalogo/domain/vitrine.ts`) **não muda**: a API usa a mesma função e lá o dado existe sempre;
  `MENSAGEM_SEM_PRECO_CATALOGO` continua significando "não há". A marca chega ao `CartaoGrade` por prop
  (`estoqueCarregando`); o contrato `ItemVitrine` não muda.

### 7.3 O que o cartão mostra
Escolha: **traço** (`—`, U+2014) no lugar da quantidade do estoque. Motivo: fica parado no chip (sem animação ao sol nem
em aparelho fraco, sem salto de layout) e não repete o indicador `Catálogo 63%` do shell, que já diz que está carregando.

- `estoqueCarregando`: chip `Estoque: —` (`ChipEstado pequeno`) tom `neutro` (também no tenant sem quantidade), sem o
  botão `Estoque por filial`. TalkBack (`rotuloAcessivel` do chip): `Estoque carregando`.
- Nenhum texto novo na tela além do traço; sem `Banner` de carga.
- **Mudança de cor/layout** (para o design-de-marca): (1) o tom `neutro` do `ChipEstado` (`neutralInk` sobre
  `neutralBg`, ≥ 4,5:1 em `tokens.test.ts`) entra no cartão do catálogo pela primeira vez; (2) o erro ao abrir passa de
  `Banner` amarelo para `EstadoVazio` com ação. Nenhuma cor nova, nenhum token novo.

### 7.4 Componentes
`Screen` (sem `refreshing`/`onRefresh`), `EstadoVazio` (com `acao`), `ChipEstado pequeno` tom `neutro`, `CatalogoCarregando`,
`TEXTO_CATALOGO_CARREGANDO`, token `TONS_ESTADO.neutro`, todos de `@macuxi/ui/mobile`. **Nenhum componente novo** no kit.

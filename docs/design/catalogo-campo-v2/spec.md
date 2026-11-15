# Catálogo do Campo v2: cartão, ficha, estoque zero, filtro de filial e busca (simulação)

> 2026-11-15 · designer-ux · origem: R-20261115-071600-alexandre (teste de campo, 15/11 ~7h de Manaus) e as decisões de
> R-20261115-073000-alexandre, R-20261115-074500-alexandre, R-20261115-084500-alexandre e R-20261115-083000-alexandre (estoque por filial). **Aprovada** pelo dono do produto, com os códigos em duas linhas e o rótulo `Estoque: 28` (R-20261115-082500-alexandre). Fonte:
> `catalogo-campo-v2.html` (`?v=grade|filtrada|ficha|busca|dica|folha|filiais`) e `simulacao.css`. PNGs 360 × 800 (escala 2).
> Barra de baixo: a real do Campo, `Início · Rota · Clientes · Pedidos · Performance · Mais` (`apps/mobile/src/lib/abas.ts`, 6 posições;
> a Performance fica na barra, R-20261115-084500). O Catálogo está no `Mais`, que fica aceso.
> Pareceres: corretor (RD-0496 e RD-0497) e marca (MC-0086) atendidos; o RD-0498 deixou de valer (§4). Altera `catalogo-grade.md` §1, §2 e §4.
> Tela: `modules/catalogo/app/telas/catalogo.tsx`, `comum.tsx` e `produto.tsx` (modulo-catalogo). Dados de exemplo fictícios.

| PNG | O que mostra |
|---|---|
| `01-grade.png` | grade depois do ✕ na filial: sem selo, estoque somado das filiais |
| `02-grade-filtrada-filial.png` | **como abre**: selo 1 e o chip `Filial Boa Vista ✕` |
| `03-ficha-referencia-cruzada.png` | ficha: copiar ao lado do código do produto; botão `Estoque por filial`; "Referência cruzada" |
| `04-busca-referencia-cruzada.png` | "cb3401" acha a pastilha pelo código do concorrente |
| `05-busca-dica.png` | a dica da busca, com o campo em foco e vazio |
| `06-folha-filtro.png` | a folha "Filtrar": filial e itens sem estoque (a mesma das outras telas, `../filtro-padrao-campo/spec.md`) |
| `07-estoque-por-filial.png` | a folha "Estoque por filial": tabela Filial \| Estoque, sua filial primeiro, uma filial em 0 e uma negativa |

## 1. Cartão da grade (de cima para baixo)
A ordem continua a de hoje, foto e depois nome (R-20261115-074500).
1. **Foto** 96 dp (antes 112, para o cartão não crescer).
2. **Nome grande**: Archivo 700 16/20, até 3 linhas (antes 15/600, 2 linhas). Os dois cartões de uma linha reservam a mesma
   altura para o nome, para a linha dos códigos ficar alinhada.
3. **Códigos em duas linhas, logo embaixo do nome** (R-20261115-082500): em cima `980 · Travex` (código da marca · marca,
   13 `ink2`) e embaixo `PAF.1434 [copiar]` (código do produto, 13/700 `ink`; o botão é um quadro de 28 dp com o ícone
   `copiar`, alvo de 44 dp). Na ficha, uma linha só. Sem marca, a linha fica só com o código do produto e o copiar.
4. Busca que achou pela referência cruzada: `Equivale a Freiomax CB 3401`, com o código destacado (`accentSoft`), como já previa o RN-CAT-09.
5. **Preço** (sem mudança) e **estoque** (§3).

O copiar sai do rodapé do cartão e **copia só o código do produto** (`PAF.1434`), sem o código da marca nem a marca
(decisão do dono do produto, R-20261115-084500). O cartão inteiro continua abrindo a ficha; o toque
no copiar só copia (`Código copiado`).

## 2. Ficha
- Faixa: `‹ Catálogo`, o nome (título) e a linha `980 · Travex · PAF.1434 [copiar]`; embaixo, `PC · EAN 7891234500980`.
- **Sai** o botão `Copiar código` na caixa própria (`BotaoCopiarCodigo variante="ficha"`): fica só a variante ícone, ao lado do código do produto.
- O copiar da ficha também **copia só o código do produto** (`PAF.1434`), igual ao do cartão (R-20261115-084500).
- Cartão de preço: `Preço` e o valor; embaixo, o botão **`Estoque por filial`** (R-20261115-083000). **Saem** do cartão as
  linhas por filial (`Boa Vista [Estoque: 0]`, `Manaus 12`) e o `Atualizado às`, que passam para a folha (§2.1).
  - `Button variant="outline"` (secundário claro, borda `lineStrong`), `height={48}`, largura cheia, ícone `home`, texto
    `Estoque por filial`. O principal da tela continua só o `Adicionar ao orçamento`.
  - Leitor de tela: `Estoque por filial, botão`. O botão aparece com qualquer número de filiais (com uma só, a tabela tem uma linha).
- `Adicionar ao orçamento` (extensão `produto.acoes`, sem mudança).
- **Referência cruzada** (era "Equivale a"): até 3 linhas `marca` (`ink2`) e `código` (700), na ordem do cadastro. A marca é
  opcional (R-20261115-073000): sem ela, a linha mostra só o código. Sem referência, a seção não aparece.

### 2.1 Folha "Estoque por filial" (`07-estoque-por-filial.png`)
O toque no botão abre a **`Folha`** do kit (`packages/ui/src/mobile/folha.tsx`), a mesma do `Filtrar` desta tela, e não o
`Dialogo`: o `Dialogo` é de confirmação (dois botões obrigatórios, papel `alert`), e a tabela é só leitura. Nenhum componente novo.
- Props: `titulo="Estoque por filial"`, `fechar={{ rotulo: 'Fechar' }}` (✕ de 48 dp), `rotuloFechar="Fechar estoque por filial"`
  (toque fora), `rolavel` (muitas filiais rolam dentro da folha). O Voltar do Android fecha (`onRequestClose`), e o foco volta
  ao botão `Estoque por filial`. Movimento: folha de 280 ms de baixo; com "reduzir movimento", só aparece.
- Abaixo do título, 13 `ink2`: `PAF.1434 · Atualizado às 07:28` (hora da última carga de estoque no fuso do tenant; de outro
  dia, `Atualizado em 14/11 às 18:10`). Sem sinal, a folha mostra o que está no aparelho, com essa mesma linha.
- **Tabela** de duas colunas:
  - cabeçalho `Filial` (à esquerda) e `Estoque` (à direita), 13/600 `ink2` sobre `neutralBg`, 36 dp;
  - uma linha por filial, 48 dp, divisória `lineSoft`: nome 15 `ink`; quantidade Archivo 700 16, alinhada à direita, números tabulares;
  - **ordem**: a filial do vendedor primeiro, com a marca `sua filial` (13 `ink2`, como no `Filtrar`); as outras em ordem alfabética;
  - **cor da quantidade** (R-20261115-083000): **acima de 0** em `success` #1D6B4F (6,4:1 sobre branco); **0 ou negativo** em
    `danger` #A8261B (7,1:1). O número sempre aparece, a cor nunca está sozinha. Negativo com o sinal de menos (`−2`).
  - Só verde e vermelho: aqui não há o laranja de 1 a 9 da tag do cartão (`../catalogo-grade.md` §4).
- Tenant que não mostra a quantidade (`estoque_mostrar_quantidade` = não): a coluna `Estoque` mostra `Em estoque` (verde) ou
  `Sem estoque` (vermelho).
- **Leitor de tela**, na ordem: título (cabeçalho), ✕ `Fechar`, a linha `PAF.1434, atualizado às 07:28`, e cada filial como um
  item só: `Boa Vista, sua filial, estoque 0` · `Belém, estoque menos 2` · `Manaus, estoque 12`. O cabeçalho da tabela não é lido
  (cada linha já diz "estoque").

## 3. Estoque: sem saldo ou sem informação = 0
Rótulo `Estoque: N` no cartão da grade e na busca (filial do vendedor); o zero fica vermelho (R-20261115-082500). Na ficha, o
estoque fica na folha `Estoque por filial` (§2.1, R-20261115-083000). Faixas e tenant que esconde a quantidade: `../catalogo-grade.md` §4. Acaba o `Estoque sem
informação` (`modules/catalogo/app/lib/grade.ts:47` e `apresentacao.ts`, `rotuloEstoque`).

## 4. Filtro no topo (padrão de Pedidos)
- Linha de busca de Pedidos: `CampoBusca` + `BotaoFiltro` (48 dp, selo com a contagem) e `EtiquetaFiltro` embaixo
  (`packages/ui/src/mobile/filtro.tsx`, `pedidos-filtro-periodo.md`).
- **O vendedor tem uma filial, obrigatória** (R-20261115-073000): ela é a referência de preço e estoque, e o filtro abre nela, com
  o selo `1` e o chip `Filial Boa Vista ✕`. Diferente de Pedidos (o padrão "Este mês" não conta), aqui o padrão aparece, como o
  dono do produto pediu.
- O ✕ do chip mostra **Todas as filiais**: estoque somado; o preço continua o da tabela da filial do vendedor (RN-VEN-01).
- A folha "Filtrar" tem dois grupos (R-20261115-074500):
  - **Filial**: a do vendedor (`sua filial`), as outras e `Todas as filiais`;
  - **Itens sem estoque**: `Mostrar` (padrão) ou `Ocultar`. Com `Ocultar`, o selo soma 1 e entra o chip `Só com estoque ✕`.
- Com dois grupos, a folha segue o padrão das folhas de vários grupos: rodapé com `Limpar` (neutro: volta para a filial do
  vendedor e `Mostrar`) e `Ver 1.284 produtos` (principal, fecha). O RD-0498 (tirar o `Limpar`) deixa de valer, porque agora ele
  desfaz duas escolhas de uma vez.
- A filial muda o estoque (e o preço) mostrado e não esconde produtos; quem esconde os sem estoque é o `Ocultar`.
- Os chips de sistema continuam na tela (navegação, como a situação em Pedidos).
- Aberto pela ficha do cliente: a filial é a do cliente (RN-CORE-39), no mesmo chip.

## 5. Busca
- Placeholder: `Código, marca, descrição…` (o que cabe nos 222 dp do campo).
- **Dica**, só com o campo em foco e vazio, 13 `ink2`: `Também acha por aplicação e referência cruzada.` (RD-0496: diz só o que o
  placeholder não diz). Some ao digitar.
- Acha por código (da marca e do produto), marca, descrição, aplicação e referência cruzada, online e offline (FTS5), ignorando
  espaço, hífen, ponto e maiúscula (RN-CAT-09).

## 6. Os códigos do produto (decisão de R-20261115-073000)
| Na tela | O que é | Onde está hoje |
|---|---|---|
| `980` | **código da marca** | o código da marca no ERP (provável `external_id` da marca). Hoje vem escrito dentro do nome do produto na carga; o modulo-catalogo confirma a origem, e o modulo-integracao confere se a carga da marca traz o código |
| `Travex` | marca | `brand` |
| `PAF.1434` | **código do produto**, o que se copia | `erp_code` (Core); `sku` no Hub |
| `EAN 789…` | código de barras | `ean`, só na ficha |
| referências | códigos da concorrência, marca opcional | `catalogo.referencias`; Hub `referencias` (até 3, RN-CAT-09) |

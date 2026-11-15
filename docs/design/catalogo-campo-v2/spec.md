# Catálogo do Campo v2: cartão, ficha, estoque zero, filtro de filial e busca (simulação)

> 2026-11-15 · designer-ux · origem: R-20261115-071600-alexandre (teste de campo, 15/11 ~7h de Manaus). **Simulação para
> aprovação**: nada muda no código antes do "aprovado" do dono do produto. Fonte: `catalogo-campo-v2.html` (`?v=grade|filtrada|ficha|busca|dica|folha`)
> e `simulacao.css`. PNGs 360 × 800 (escala 2). Altera `catalogo-grade.md` §1, §2 e §4 quando aprovada.
> Tela: `modules/catalogo/app/telas/catalogo.tsx`, `comum.tsx` e `produto.tsx` (modulo-catalogo). Dados de exemplo fictícios.

| PNG | O que mostra |
|---|---|
| `01-grade.png` | grade depois do ✕ na filial: sem selo, estoque somado das filiais |
| `02-grade-filtrada-filial.png` | **como abre**: selo 1 e o chip `Filial Boa Vista ✕` |
| `03-ficha-referencia-cruzada.png` | ficha: copiar ao lado do código no cabeçalho; seção "Referência cruzada" |
| `04-busca-referencia-cruzada.png` | "cb3401" acha a pastilha pelo código do concorrente |
| `05-busca-dica.png` | a dica da busca, com o campo em foco e vazio |
| `06-folha-filtro.png` | a folha "Filtrar" (a mesma das outras telas, `../filtro-padrao-campo/spec.md`) |

## 1. Cartão da grade (de cima para baixo)
1. **Nome grande**: Archivo 700 16/20, até 3 linhas (antes 15/600, 2 linhas, abaixo da foto).
2. **Foto** 96 dp (antes 112, para o cartão não crescer).
3. **Linha dos códigos, logo embaixo da foto**: `980 [copiar] · Travex · PAF.1434`. Na coluna de 360 dp ela quebra em dois
   pontos fixos: `980 [copiar]` (código 13/700 `ink`; o botão é um quadro de 28 dp com o ícone `copiar`, alvo de 44 dp) e
   `Travex · PAF.1434` (13 `ink2`, 1 linha com reticências). Na ficha, uma linha só.
4. Busca que achou pela referência cruzada: `Equivale a Freiomax CB 3401`, com o código destacado (`accentSoft`), como já previa o RN-CAT-09.
5. **Preço** (sem mudança) e **estoque** (§3).

O copiar sai do rodapé do cartão. O cartão inteiro continua abrindo a ficha; o toque no copiar só copia (`Código copiado`).

## 2. Ficha
- Faixa: `‹ Catálogo`, o nome (título) e a linha `980 [copiar] · Travex · PAF.1434`; embaixo, `PC · EAN 7891234500980`.
- **Sai** o botão `Copiar código` na caixa própria (`BotaoCopiarCodigo variante="ficha"`): fica só a variante ícone, ao lado do código.
- Preço e estoque: `Estoque na filial Boa Vista`, a tag e as outras filiais em linhas (`Manaus 12`).
- `Adicionar ao orçamento` (extensão `produto.acoes`, sem mudança).
- **Referência cruzada** (era "Equivale a"): até 3 linhas `marca` (`ink2`) e `código` (700), na ordem do cadastro. Sem referência, a seção não aparece.

## 3. Estoque: sem saldo ou sem informação = 0
| Caso | Tag |
|---|---|
| 10 ou mais | `84 em estoque` (sucesso) |
| 1 a 9 | `6 em estoque` (aviso) |
| 0, ou nenhum saldo recebido | **`0 em estoque`** (erro) |

Acaba o `Estoque sem informação` (`modules/catalogo/app/lib/grade.ts:47` e `apresentacao.ts`, `rotuloEstoque`). Tenant que esconde a
quantidade: `Sem estoque` (premissa; o número não aparece para ninguém nesse tenant).

## 4. Filtro no topo (padrão de Pedidos)
- Linha de busca de Pedidos: `CampoBusca` + `BotaoFiltro` (48 dp, selo com a contagem) e `EtiquetaFiltro` embaixo
  (`packages/ui/src/mobile/filtro.tsx`, `pedidos-filtro-periodo.md`).
- **Ao abrir, o filtro já vem na filial padrão do vendedor**: selo `1` e o chip `Filial Boa Vista ✕`. Diferente de Pedidos (o
  padrão "Este mês" não conta), aqui o padrão aparece, como o dono do produto pediu.
- O ✕ do chip volta para **Todas as filiais**: estoque somado; o preço continua o da tabela da filial padrão (RN-VEN-01).
- A folha "Filtrar" tem o grupo **Filial**: a do vendedor (`sua filial`), as outras e `Todas as filiais`. Um grupo só: tocar aplica e
  fecha. `Limpar` volta para a filial do vendedor.
- Os chips de sistema continuam na tela (navegação, como a situação em Pedidos).
- Aberto pela ficha do cliente: a filial é a do cliente (RN-CORE-39), no mesmo chip.

## 5. Busca
- Placeholder: `Código, marca, descrição…` (o que cabe nos 222 dp do campo).
- **Dica**, só com o campo em foco e vazio, 13 `ink2`: `Busque por código, marca, descrição, aplicação ou referência cruzada.` Some ao digitar.
- Acha por código, marca, descrição, aplicação e referência cruzada, online e offline (FTS5), ignorando espaço, hífen, ponto e maiúscula (RN-CAT-09).

## 6. Os códigos do produto hoje (contratos)
| Campo | Onde | O que é | Na tela |
|---|---|---|---|
| `erp_code` | Core `ProductBase`; no Hub, `sku` (até 60) | código do produto no ERP do cliente; é o que o pedido usa e o que o copiar copia | `980` |
| `ean` | Core e Hub (8, 12, 13 ou 14 dígitos) | código de barras | ficha: `EAN 789…` |
| `external_id` | todas as tabelas | identificador técnico da integração | não aparece |
| referências | `catalogo.referencias`, Hub `referencias` (marca + código até 30; até 3, RN-CAT-09) | códigos da concorrência | ficha e busca |
| código do fabricante | **não existe** | ex.: `PAF.1434` | simulado como "código do produto" |

Leitura do designer-ux: "código" = `erp_code`; "código do produto" = o código do fabricante (part number). Hoje não há campo para ele.
Pode ser que, na carga do teste de campo, ele venha dentro do nome ("(980 - PAF.1434)"). Se a leitura se confirmar, o campo novo
precisa entrar no Core, no Hub, no `produto.csv`, nas views do Conector e no BKO (modulo-core, modulo-integracao, banco-dados).

## 7. Perguntas ao dono do produto
1. **Os dois códigos:** "código" é o código do produto no seu ERP (`980`) e "código do produto" é o código do fabricante (`PAF.1434`)?
   Ou o "código do produto" é o código de barras (EAN)? Se for o do fabricante, ele vem do ERP numa coluna própria ou dentro do nome?
2. **Copiar:** copia só o código do ERP (`980`), como na simulação? Ou o do fabricante também precisa de botão?
3. **Ordem do cartão:** nome em cima da foto e a linha dos códigos logo embaixo dela, como na simulação? Ou a foto primeiro?
4. **Filtro de filial:** a filial muda o estoque (e o preço) mostrado, sem esconder produtos, como na simulação? Ou esconde os
   produtos sem estoque ou sem preço naquela filial?

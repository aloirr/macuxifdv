# Catálogo do Campo v2: cartão, ficha, estoque zero, filtro de filial e busca (simulação)

> 2026-11-15 · designer-ux · origem: R-20261115-071600-alexandre (teste de campo, 15/11 ~7h de Manaus) e as decisões de
> R-20261115-073000-alexandre, R-20261115-074500-alexandre e R-20261115-084500-alexandre. **Simulação para aprovação**: nada muda no código antes do "aprovado" do dono do produto. Fonte:
> `catalogo-campo-v2.html` (`?v=grade|filtrada|ficha|busca|dica|folha|card-1-linha`) e `simulacao.css`. PNGs 360 × 800 (escala 2).
> Barra de baixo: a real do Campo, `Início · Rota · Clientes · Pedidos · Performance · Mais` (`apps/mobile/src/lib/abas.ts`, 6 posições;
> a Performance fica na barra, R-20261115-084500). O Catálogo está no `Mais`, que fica aceso.
> Pareceres: corretor (RD-0496 e RD-0497) e marca (MC-0086) atendidos; o RD-0498 deixou de valer (§4). Altera `catalogo-grade.md` §1, §2 e §4 quando aprovada.
> Tela: `modules/catalogo/app/telas/catalogo.tsx`, `comum.tsx` e `produto.tsx` (modulo-catalogo). Dados de exemplo fictícios.

| PNG | O que mostra |
|---|---|
| `01-grade.png` | grade depois do ✕ na filial: sem selo, estoque somado das filiais |
| `02-grade-filtrada-filial.png` | **como abre**: selo 1 e o chip `Filial Boa Vista ✕` |
| `03-ficha-referencia-cruzada.png` | ficha: copiar ao lado do código do produto; uma linha por filial; "Referência cruzada" |
| `04-busca-referencia-cruzada.png` | "cb3401" acha a pastilha pelo código do concorrente |
| `05-busca-dica.png` | a dica da busca, com o campo em foco e vazio |
| `06-folha-filtro.png` | a folha "Filtrar": filial e itens sem estoque (a mesma das outras telas, `../filtro-padrao-campo/spec.md`) |
| `catalogo-campo-v2-card-1-linha.png` | **variante em aberto** (§7): os códigos e o copiar numa linha só, para comparar com a `02` |

## 1. Cartão da grade (de cima para baixo)
A ordem continua a de hoje, foto e depois nome (R-20261115-074500).
1. **Foto** 96 dp (antes 112, para o cartão não crescer).
2. **Nome grande**: Archivo 700 16/20, até 3 linhas (antes 15/600, 2 linhas). Os dois cartões de uma linha reservam a mesma
   altura para o nome, para a linha dos códigos ficar alinhada.
3. **Linha dos códigos, logo embaixo do nome**: `980 · Travex · PAF.1434 [copiar]` (código da marca · marca · código do
   produto). Na coluna de 360 dp ela quebra em dois pontos fixos: `980 · Travex` (13 `ink2`) e `PAF.1434 [copiar]` (13/700 `ink`;
   o botão é um quadro de 28 dp com o ícone `copiar`, alvo de 44 dp). Na ficha, uma linha só. Sem marca, a linha fica só com o código do produto e o copiar.
4. Busca que achou pela referência cruzada: `Equivale a Freiomax CB 3401`, com o código destacado (`accentSoft`), como já previa o RN-CAT-09.
5. **Preço** (sem mudança) e **estoque** (§3).

O copiar sai do rodapé do cartão e **copia só o código do produto** (`PAF.1434`), sem o código da marca nem a marca
(decisão do dono do produto, R-20261115-084500). O cartão inteiro continua abrindo a ficha; o toque
no copiar só copia (`Código copiado`).

## 2. Ficha
- Faixa: `‹ Catálogo`, o nome (título) e a linha `980 · Travex · PAF.1434 [copiar]`; embaixo, `PC · EAN 7891234500980`.
- **Sai** o botão `Copiar código` na caixa própria (`BotaoCopiarCodigo variante="ficha"`): fica só a variante ícone, ao lado do código do produto.
- O copiar da ficha também **copia só o código do produto** (`PAF.1434`), igual ao do cartão (R-20261115-084500).
- Preço e, embaixo, **uma linha por filial** (RD-0497): a filial do vendedor primeiro, com a tag colorida (`Boa Vista [0 em
  estoque]`), e as outras com o número (`Manaus 12`); por fim `Atualizado às 07:28`. Sai o rótulo "Estoque na filial…".
- `Adicionar ao orçamento` (extensão `produto.acoes`, sem mudança).
- **Referência cruzada** (era "Equivale a"): até 3 linhas `marca` (`ink2`) e `código` (700), na ordem do cadastro. A marca é
  opcional (R-20261115-073000): sem ela, a linha mostra só o código. Sem referência, a seção não aparece.

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

## 7. Pergunta ao dono do produto (aberta)
1. **Linha dos códigos no cartão:** em duas linhas (`980 · Travex` e `PAF.1434 [copiar]`, a `02`, que segue valendo) ou numa
   linha só (`catalogo-campo-v2-card-1-linha.png`)? Na coluna de 360 dp a linha única só cabe com texto 12 e o copiar sem quadro
   (ícone de 24, alvo de 44), e mesmo assim a marca encurta com "…" (`980 · T… · PAF.1434`). Na ficha já é uma linha só.

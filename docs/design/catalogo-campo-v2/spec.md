# Catálogo do Campo v2: cartão, ficha, estoque zero, filtro de filial e busca (simulação)

> 2026-11-15 · designer-ux · origem: R-20261115-071600-alexandre (teste de campo, 15/11 ~7h de Manaus) e as decisões de
> R-20261115-073000-alexandre, R-20261115-074500-alexandre, R-20261115-084500-alexandre, R-20261115-083000-alexandre, R-20261115-083600-alexandre, R-20261115-084600-alexandre, R-20261115-085500-alexandre e R-20261115-090000-alexandre (estoque na hora e por filial, telas aprovadas, ícone `pacote`, folha) R-20261115-093000-alexandre (regra definitiva de filial, §4) e R-20261115-100000-alexandre (N pela opção A). **Aprovada** pelo dono do produto, com os códigos em duas linhas e o rótulo `Estoque: 28` (R-20261115-082500-alexandre). Fonte:
> `catalogo-campo-v2.html` (`?v=grade|filtrada|ficha|busca|dica|folha|filiais|multi`) e `simulacao.css`. PNGs 360 × 800 (escala 2).
> Barra de baixo: a real do Campo, `Início · Rota · Clientes · Pedidos · Performance · Mais` (`apps/mobile/src/lib/abas.ts`, 6 posições;
> a Performance fica na barra, R-20261115-084500). O Catálogo está no `Mais`, que fica aceso.
> Pareceres: corretor (RD-0496 e RD-0497) e marca (MC-0086) atendidos; o RD-0498 deixou de valer (§4). Altera `catalogo-grade.md` §1, §2 e §4.
> Tela: `modules/catalogo/app/telas/catalogo.tsx`, `comum.tsx` e `produto.tsx` (modulo-catalogo). Dados de exemplo fictícios.

| PNG | O que mostra |
|---|---|
| `01-grade.png` | usuário com **uma** filial de venda: filial de cadastro na faixa, sem selo e sem chip, N da filial |
| `02-grade-filtrada-filial.png` | **como abre** com três filiais de venda: selo 1, chip `Suas filiais (3)` sem ✕, `Estoque: 17` (0 + 12 + 5) |
| `03-ficha-referencia-cruzada.png` | ficha: `Estoque: 17` no cartão de preço com `Por filial` à direita; copiar ao lado do código; "Referência cruzada" |
| `04-busca-referencia-cruzada.png` | "cb3401" acha a pastilha pelo código do concorrente |
| `05-busca-dica.png` | a dica da busca, com o campo em foco e vazio |
| `06-folha-filtro.png` | a folha "Filtrar": `Suas filiais (3)` ou uma delas, e itens sem estoque (`../filtro-padrao-campo/spec.md`) |
| `07-estoque-por-filial.png` | a folha "Estoque por filial": tabela Filial \| Estoque, só as filiais de venda, a de cadastro primeiro |
| `08-grade-multi-filial.png` | uma filial escolhida no filtro: chip `Filial Manaus ✕`, preço e N de Manaus; a faixa continua com a sua filial |

Dados das telas: Carla, filial de cadastro Boa Vista, filiais de venda Boa Vista, Manaus e Porto Velho (na 01, só Boa Vista).
O login sem filial e o BKO (Usuários): `../filial-cadastro-venda/spec.md`.

## 1. Cartão da grade (de cima para baixo)
A ordem continua a de hoje, foto e depois nome (R-20261115-074500).
1. **Foto** 96 dp (antes 112, para o cartão não crescer).
2. **Nome grande**: Archivo 700 16/20, até 3 linhas (antes 15/600, 2 linhas). Os dois cartões de uma linha reservam a mesma
   altura para o nome, para a linha dos códigos ficar alinhada.
3. **Códigos em duas linhas, logo embaixo do nome** (R-20261115-082500): em cima `980 · Travex` (código da marca · marca,
   13 `ink2`) e embaixo `PAF.1434 [copiar]` (código do produto, 13/700 `ink`; o botão é um quadro de 28 dp com o ícone
   `copiar`, alvo de 44 dp). Na ficha, uma linha só. Sem marca, a linha fica só com o código do produto e o copiar.
4. Busca que achou pela referência cruzada: `Equivale a Freiomax CB 3401`, com o código destacado (`accentSoft`), como já previa o RN-CAT-09.
5. **Preço** (sem mudança) e, na última linha, **`Estoque: N`** com o botão `Estoque por filial` à direita (§3).

O copiar sai do rodapé do cartão e **copia só o código do produto** (`PAF.1434`), sem o código da marca nem a marca
(decisão do dono do produto, R-20261115-084500). O cartão inteiro continua abrindo a ficha; o toque
no copiar só copia (`Código copiado`).

## 2. Ficha
- Faixa: `‹ Catálogo`, o nome (título) e a linha `980 · Travex · PAF.1434 [copiar]`; embaixo, `PC · EAN 7891234500980`.
- **Sai** o botão `Copiar código` na caixa própria (`BotaoCopiarCodigo variante="ficha"`): fica só a variante ícone, ao lado do código do produto.
- O copiar da ficha também **copia só o código do produto** (`PAF.1434`), igual ao do cartão (R-20261115-084500).
- Cartão de preço (R-20261115-083600, substitui o botão sozinho de R-20261115-083000): `Preço` e o valor; uma divisória
  `lineSoft`; embaixo, numa linha, **`Estoque: N`** à esquerda (`ChipEstado`, 28 dp, 13/600; cor e valor de N no §3) e o botão
  **`Por filial`** à direita. As linhas por filial e o `Atualizado às` ficam só na folha (§2.1).
  - Botão: `Button variant="outline"` (secundário claro, borda `lineStrong`), `height={48}`, largura do texto, ícone `pacote`
    em grafite (`Icon name="pacote"` do kit, cor `ink` do secundário; o `home` sai: é o ícone da aba Início, R-20261115-084600). O principal da tela continua só o `Adicionar ao orçamento`.
  - Leitor de tela: o chip lê `Estoque 0` e o botão `Estoque por filial, botão`. Aparece com qualquer número de filiais (com
    uma só, a tabela tem uma linha).
- `Adicionar ao orçamento` (extensão `produto.acoes`, sem mudança).
- **Referência cruzada** (era "Equivale a"): até 3 linhas `marca` (`ink2`) e `código` (700), na ordem do cadastro. A marca é
  opcional (R-20261115-073000): sem ela, a linha mostra só o código. Sem referência, a seção não aparece.

### 2.1 Folha "Estoque por filial" (`07-estoque-por-filial.png`)
O toque no botão abre a **`Folha`** do kit, que sobe de baixo (decisão do dono do produto, R-20261115-085500; sem janela no meio) (`packages/ui/src/mobile/folha.tsx`), a mesma do `Filtrar` desta tela, e não o
`Dialogo`: o `Dialogo` é de confirmação (dois botões obrigatórios, papel `alert`), e a tabela é só leitura. Nenhum componente novo.
- Props: `titulo="Estoque por filial"`, `fechar={{ rotulo: 'Fechar' }}` (✕ de 48 dp), `rotuloFechar="Fechar estoque por filial"`
  (toque fora), `rolavel` (muitas filiais rolam dentro da folha). O Voltar do Android fecha (`onRequestClose`), e o foco volta
  ao botão `Estoque por filial`. Movimento: folha de 280 ms de baixo; com "reduzir movimento", só aparece.
- Abaixo do título, 13 `ink2`: `PAF.1434 · Atualizado às 07:28` (hora da última carga de estoque no fuso do tenant; de outro
  dia, `Atualizado em 14/11 às 18:10`). Sem sinal, a folha mostra o que está no aparelho, com essa mesma linha.
- **Tabela** de duas colunas:
  - cabeçalho `Filial` (à esquerda) e `Estoque` (à direita), 13/600 `ink2` sobre `neutralBg`, 36 dp. Fica por pedido do dono do
    produto ("tabelado: Coluna Filial… Coluna Estoque", R-20261115-083000), que fecha o RD-0574 por decisão;
  - uma linha por filial, 48 dp, divisória `lineSoft`: nome 15 `ink`; quantidade Archivo 700 16, alinhada à direita, números tabulares;
  - **quais e em que ordem** (R-20261115-093000): só as filiais de venda do usuário (§4); a de cadastro primeiro, com a marca
    `sua filial` (13 `ink2`, como no `Filtrar`), e as outras em ordem alfabética. Sem linha de total: o
    `Estoque: N` do cartão e da ficha já é a soma (§3);
  - **cor da quantidade**: a do §3, só no texto, sobre branco (`success` #1D6B4F, 6,4:1; `danger` #A8261B, 7,1:1). O número
    sempre aparece, e a cor nunca está sozinha. Negativo com o sinal de menos (`−2`).
- Tenant que não mostra a quantidade (`estoque_mostrar_quantidade` = não): a coluna `Estoque` mostra `Em estoque` (verde) ou
  `Sem estoque` (vermelho).
- **Leitor de tela**, na ordem: título (cabeçalho), ✕ `Fechar`, a linha `PAF.1434, atualizado às 07:28`, e cada filial como um
  item só: `Boa Vista, sua filial, estoque 0` · `Belém, estoque menos 2` · `Manaus, estoque 12`. O cabeçalho da tabela não é lido
  (cada linha já diz "estoque").

## 3. Estoque na hora: `Estoque: N` e o botão à direita (R-20261115-083600)
Rótulo `Estoque: N` no cartão da grade, na busca e na ficha, sem toque nenhum. Sem saldo ou sem informação = 0.
- **Valor de N:**
  - com cliente: a filial do cliente (RN-CORE-39);
  - filial escolhida no filtro (§4): só a daquela filial (R-20261115-084600);
  - sem filial escolhida, para todo perfil: a **soma das filiais de venda** (opção A, R-20261115-100000); com uma só, a dela.
- **Cor:** a do `../catalogo-grade.md` §4, no chip e na tabela da folha (§2.1). O "Risco de ruptura" da folha do item do pedido não muda.
- **Botão no cartão** (grade e busca), à direita do chip, na mesma linha: só ícone `pacote` 18 em grafite (`ink`, a cor do secundário no kit; validação da marca), quadro de 32 dp (borda
  `lineStrong`, raio 10), `hitSlop` 8 (alvo de 48 dp, dentro do respiro do cartão); `accessibilityLabel="Estoque por filial"`.
  O toque abre a folha (§2.1) e não abre a ficha.
- **Cabe no aparelho de 360 dp** (medido na simulação): o cartão tem 136 dp por dentro; chip (respiro 8) + 6 + botão 32.
  Cabe até `Estoque: 999` e `Estoque: −999`. **Acima de 999, o cartão mostra `Estoque: 999+`**, obrigatório (com `Estoque: 999` sobra 1 dp; validação da marca). O
  número exato fica na ficha e na folha. Abaixo de −999 não cabe: **a confirmar** com o modulo-catalogo se o ERP manda saldo assim.
- **Promotor** (R-20261115-090000): vê `Estoque: N`, o botão e a folha. O preço segue a RN-CAT-05 de hoje (`promotor_ve_preco_estoque`); o modulo-catalogo ajusta a regra só para o estoque.
- Tenant que esconde a quantidade: `../catalogo-grade.md` §4. Acaba o `Estoque sem informação` (`modules/catalogo/app/lib/grade.ts:47` e `apresentacao.ts`, `rotuloEstoque`).

## 4. Filtro no topo (padrão de Pedidos)
- Linha de busca de Pedidos: `CampoBusca` + `BotaoFiltro` (48 dp, selo com a contagem) e `EtiquetaFiltro` embaixo
  (`packages/ui/src/mobile/filtro.tsx`, `pedidos-filtro-periodo.md`).
- **Filial** (regra: `../filial-cadastro-venda/spec.md` §1, R-20261115-093000; substitui a regra por perfil de R-20261115-073000,
  R-20261115-090000 e R-20261115-092000):
  - a filial de cadastro aparece **sempre na faixa**, no subtítulo `Sua filial: Boa Vista · 1.284 produtos`. Não é filtro e não
    tem ✕; com outra filial escolhida no filtro, a faixa continua nela, e o chip diz a filial do preço e do estoque (`08`);
  - o preço, o `Estoque: N` (§3), o filtro e a folha (§2.1) usam só as filiais de venda.
- **Filtro de filial**, só com mais de uma filial de venda (com uma só, não há chip, e o grupo Filial não aparece na folha "Filtrar"):
  - abre em `Suas filiais (3)`, com o selo `1` e o chip sem ✕ (`EtiquetaFiltro` sem `onRemover`);
  - escolhida uma filial (R-20261115-084600): chip `Filial Manaus ✕` e o selo `1`; o ✕ volta ao padrão.
- Preço: o da tabela da filial escolhida; sem escolha, o da filial de cadastro (RN-VEN-01).
- A folha "Filtrar" tem dois grupos (R-20261115-074500):
  - **Filial**: `Suas filiais (3)` (padrão) e as filiais de venda, a de cadastro primeiro (`sua filial`);
  - **Itens sem estoque**: `Mostrar` (padrão) ou `Ocultar`. Com `Ocultar`, o selo soma 1 e entra o chip `Só com estoque ✕`.
- Com dois grupos, a folha segue o padrão das folhas de vários grupos: rodapé com `Limpar` (neutro: volta para o padrão do filtro de
  filial e `Mostrar`) e `Ver 1.284 produtos` (principal, fecha). O RD-0498 (tirar o `Limpar`) deixa de valer, porque agora ele
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

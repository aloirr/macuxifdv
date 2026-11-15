# Reteste — revisão do BKO, bloqueio de usuário, spec e código do cabeçalho do Início (variação C) — 15/11/2026

Corretor-redundancias. Pedido do gerente-projetos (14/11/2026, ~22h de Manaus; regra R-20261110-062506).
Caixa de recados: `coord.mjs` dá HTTP 403 nesta nuvem. O parecer fica só neste relatório; os recados aos donos, o
encaminhamento ao testes e a `entrega` ao gerente saem quando a caixa voltar.
Achados de origem: [2026-11-15-reteste-5-lotes](2026-11-15-reteste-5-lotes.md). A numeração segue do RD-0395.

## Lote 1 — `nuvem/bko-revisao-designer-ux` @ `bbd24f46`

| RD | Achado | Reteste | Status |
|---|---|---|---|
| RD-0392 | `bko-revisao.md` §P13 (e) repetia a regra do nome "Promotor" da §P10 | `bko-revisao.md:349`: "Decidida: e. Nome do adicional (R-20261114-205500-alexandre): §P10, texto final.", fora da lista a–h dos itens em aberto. A regra fica só na l.308 | **corrigido** |
| RD-0393 | `portal-config-enxuto.md` §11.8: dois históricos de testID ("antes `promotor-avulso`") | `portal-config-enxuto.md:259`: só `empresa.adicional-<adicional>` e `empresa.adicional-<adicional>-qtd`. `git grep avulso` nos dois docs: só a l.308 da bko-revisao, que é a regra | **corrigido** |

Achado novo: nenhum. **Parecer do lote 1: sem achado em aberto.**

## Lote 2 — `nuvem/usuario-bloqueio-designer-ux` @ `355136a9` (MC-0064)

Conferidos: o diff de `usuario-bloqueio.html` e os três prints 1366×768 (lista, menu "⋯", gaveta).
- O "⋯" agora é o `IconMais` do kit, e o menu ficou com Desbloquear, Editar, Redefinir senha e Desativar (com um traço
  acima). Sumiu o `<hr>`, porque o traço passou para a borda do item: um separador só.
- Os ícones vêm de uma função `svg()` só, e a gaveta reusa o `V` em vez de um segundo SVG do carrinho. Isso **tira** uma
  duplicação.
- Renata Promotora: perfil "Promotor" e ícone do módulo Promotor. São colunas diferentes (perfil × módulos): `manter`.
- Telas: um selo por linha, um botão principal, nenhum texto de funcionamento e nenhum aviso fora do lugar.

Achado novo: nenhum. **Parecer do lote 2: sem achado em aberto.**

## Lote 3 — `nuvem/inicio-cabecalho-designer-ux` @ `76fa58a6` (spec da variação C)

### Achados novos (seguram o lote: estão em doc)

| Campo | RD-0396 |
|---|---|
| Onde | `docs/design/telas/inicio-cabecalho.md` l.3-4, l.11, l.26, l.31 e l.33 |
| Tipo | doc |
| O que se repete | A escolha da C aparece **4×**: l.3 "**Escolhida: C (72).**", l.11 "(a escolhida; …)", l.31 "**C (escolhida)**" e l.33 "**Escolhida: C (72).**" (frase igual à da l.3). O "A e B são histórico" aparece **3×**: l.3-4 "As variações A e B ficam só como histórico", l.11 "(A e B: histórico)" e o título da l.26 "(A e B só como histórico)" |
| Impacto | leitura: a decisão está no topo, e as outras 5 menções só repetem o que já foi dito |
| Severidade | baixa |
| Proposta | Fica a nota da l.3-4. l.11: `` `02-variacao-b-64.png` (A e B: histórico) e `03-variacao-c-72.png` (a escolhida; tela inteira: …)`` → `` `02-variacao-b-64.png` e `03-variacao-c-72.png` (tela inteira: …)``. l.26: `## 2. Variações (A e B só como histórico)` → `## 2. Variações`. l.33: `**Escolhida: C (72).** É a que tem…` → `**Por que a C:** é a que tem…`. A coluna "Escolhida (C)" da l.15 e o negrito da linha C na l.31 podem ficar, porque marcam a coluna e a linha da tabela |
| Dono | designer-ux |

| Campo | RD-0397 |
|---|---|
| Onde | `docs/design/telas/inicio-cabecalho.md` l.31 × l.43 e l.22 × l.33 |
| Tipo | doc |
| O que se repete | As medidas da foto aparecem **2×**: a tabela da §2 (l.31: 72 × 72, `radius.xl` (16), `fonts.display` 24) e a §3 (l.43: "72 × 72, raio `radius.xl` (16), iniciais `fonts.display` 24"). O "31 dp mais baixo" também aparece **2×**: l.22 e l.33 ("mesmo assim o painel fica 31 dp mais baixo que hoje"). Os dois números já saem da tabela da l.20 (131 → 100) |
| Impacto | manutenção: se a medida mudar, são dois lugares a trocar no mesmo doc |
| Severidade | baixa |
| Proposta | l.43: `- Foto/iniciais: 72 × 72, raio `radius.xl` (16), iniciais `fonts.display` 24; fundo …` → `- Foto/iniciais: medidas da C (§2); fundo …`. l.33, junto com o RD-0396: `**Por que a C:** é a que tem a altura do bloco de três linhas de texto (≈ 70 dp), que é o pedido ("ao lado de" e "maior"), e a data e a frase ainda cabem em uma linha a 390 dp.` |
| Dono | designer-ux |

**Parecer do lote 3: com achado em aberto: RD-0396 e RD-0397 (baixa, doc). Seguram o lote.**

## Lote 4 — `nuvem/inicio-cabecalho-modulo-core` @ `d6a36237` (código da variação C)

Conferidos: o diff de `tela-inicio-campo.tsx`, `escala-inicio.ts`, `usar-inicio-campo.ts` e dos testes, e os prints
`docs/modulos/core/prints/inicio-enquadrado/inicio-cabecalho-390x844-fonte-1-nome-{curto-com-foto,longo-sem-foto}.png`.
- **Tela.** São os mesmos 4 itens e o sino: foto (ou iniciais), saudação, data · DU e frase. Nenhum texto novo, e nada
  do painel se repete no meio da tela. O "Boa noite, Maximiliano" cabe em 1 linha, sem reticências.
- **Toque.** São 3 `Pressionavel` com `onPerfil`, mas só um é lido (`accessibilityLabel` único; os outros dois têm
  `no-hide-descendants`). É assim porque o sino fica no meio da coluna de textos: `manter`.
- **Testes.** Os 4 casos novos do layout e os 3 da escala cobrem coisas diferentes, sem caso repetido.

### Achado novo (segura o lote: código de produção)

| Campo | RD-0398 |
|---|---|
| Onde | `modules/core/app/telas/inicio/escala-inicio.ts`: `alturaDoPainel` (a nova função) × `alturaEstimadaInicio` e `linhasDaFrase` |
| Tipo | código |
| O que se repete | (1) O ajudante `const linha = (corpo, n = 1) => corpo * fs * ENTRELINHA * n` está escrito **2×**, igual, em `alturaDoPainel` e em `alturaEstimadaInicio`. (2) `linhasData` repete a conta de `linhasDaFrase`, `Math.min(2, Math.max(1, Math.ceil(caracteres * corpo * fs * LARGURA_CARACTERE / util)))`, só trocando `frase.length` por `CARACTERES_DATA` |
| Impacto | manutenção: se a entrelinha ou a estimativa de linhas mudar, são duas contas a trocar, e elas podem passar a dar números diferentes para o mesmo texto |
| Severidade | baixa |
| Proposta | Um ajudante de módulo `const alturaLinhas = (corpo: number, fs: number, n = 1): number => corpo * fs * ENTRELINHA * n;`, usado nas duas funções. `linhasDaFrase` passa a delegar para `function linhasDoTexto(caracteres: number, corpo: number, fontScale: number, largura: number, reserva = 40): number` (a conta de hoje com `caracteres`). Em `alturaDoPainel`: `const linhasData = linhasDoTexto(CARACTERES_DATA, t.fonte.data, fs, e.largura, reserva);` |
| Dono | modulo-core |

### Encaminhado ao testes (defeito funcional, não é RD; não catalogado como RD)
- `VisaoInicioCampo.foto` (`usar-inicio-campo.ts:41`) só é preenchida no mock dos prints (`_src/mock-usar-inicio.ts:8`).
  O `usarInicioCampo` não lê a foto do perfil, e no app sempre aparecem as iniciais. O print "nome curto com foto"
  mostra uma tela que o app ainda não produz. A spec (§3) diz que "A foto vem do perfil".

O recado ao testes (cc gerente-projetos) não saiu porque a caixa deu 403.

**Parecer do lote 4: com achado em aberto: RD-0398 (baixa, código de produção). Segura o lote.**

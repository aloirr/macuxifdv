# Roteiro do aparelho — Catálogo v2 do Campo

Spec aprovada: `docs/design/catalogo-campo-v2/spec.md` (branch `nuvem/catalogo-campo-designer-ux`, commit `fd17f346`), com as
decisões R-20261115-073000, R-20261115-074500, R-20261115-082500 e R-20261115-084500-alexandre. Faixas de estoque e tenant que
esconde a quantidade: `docs/design/catalogo-grade.md` §4 (fonte da verdade, RD-0560). Pareceres: corretor (RD-0560, branch
`nuvem/catalogo-campo-corretor-redundancias`) e marca (`nuvem/catalogo-campo-design-de-marca` e `nuvem/catalogo-v2-estoque-design-de-marca`).
Telas: `modules/catalogo/app/telas/catalogo.tsx`, `comum.tsx` e `produto.tsx` (modulo-catalogo). Fuso: o do tenant.

Testes automáticos: `tests/modulos/catalogo-v2-campo-r20261115.test.ts` (cartão real renderizado, estoque montado pelo domain).
Até o PR do modulo-catalogo entrar, os casos novos aparecem como "expected fail" (`it.fails`) e viram `it` sozinhos pelo detector
de cada critério (`tests/modulos/apoio/estado-prs.ts`).

| Critério | Teste automático | Neste roteiro |
|---|---|---|
| a) `Estoque: N`; 0 e sem saldo = `Estoque: 0` vermelho | EST-* (limites 1, 9, 10; 0; negativo; sem saldo com e sem cliente; milhar; Todas as filiais = soma; tenant que esconde; promotor sem estoque) | 1 e 6 |
| b) códigos em 2 linhas: em cima `980 · Travex`, embaixo `PAF.1434` + copiar | COD-1 a COD-5; COD-6 = pendência do código da marca no contrato | 2 |
| c) o copiar copia só o código do produto | CP-1 a CP-5 | 3 |
| d) o filtro abre na filial do vendedor (selo 1, chip `Filial Boa Vista ✕`) | FIL-1 a FIL-3 (textos da folha e dos chips) | 4 |

**Como registrar:** print dos passos com 📷 (vão junto com o relatório do corretor e o parecer de marca). Marque ✅ ou ❌ na coluna
**Resultado**. Em ❌, anote a tela, o que apareceu, o que era esperado e a gravidade (alta, média ou baixa). Os passos com 🏷️ vão ao
**design-de-marca**.

**Antes de começar**
1. Instale o build do Campo com o Catálogo v2. Perfil → anote a versão.
2. Data e hora do aparelho em automático, no fuso do tenant.
3. Tenha à mão: um vendedor com filial cadastrada (ex.: Boa Vista), um promotor, acesso ao BKO e uma calculadora.
4. No BKO (ou no ERP de teste), anote 6 produtos e o saldo deles em cada filial:
   - **P1** com 84 na filial do vendedor; **P2** com 6; **P3** com 10 e **P4** com 9 (limites); **P5** com 0 na filial do vendedor e
     12 em outra (ex.: Manaus); **P6** sem nenhum saldo recebido;
   - **P7** sem marca no cadastro; **P8** com marca e **sem código da marca**; **P9** com referência cruzada (ex.: Freiomax CB 3401).
5. Sincronize uma vez com sinal (o catálogo inteiro no aparelho).

---

## 1. Cartão: estoque (critério a; spec §3; catalogo-grade.md §4)
| # | O que fazer | O que conferir | Resultado esperado | Resultado |
|---|---|---|---|---|
| 1.1 📷 🏷️ | Mais → Catálogo, ache P1 | Tag | `Estoque: 84`, verde (sucesso). Uma tag só no cartão; "estoque" aparece uma vez | |
| 1.2 📷 | P2 | Tag | `Estoque: 6`, laranja (aviso) | |
| 1.3 | P3 e P4 | Limite | P3 `Estoque: 10` verde; P4 `Estoque: 9` laranja | |
| 1.4 📷 | P5 (0 na sua filial, 12 em Manaus) | Zero | `Estoque: 0`, **vermelho**. O número é o da sua filial, não o de Manaus | |
| 1.5 📷 | P6 (nenhum saldo recebido) | Sem informação | `Estoque: 0`, vermelho. "Estoque sem informação" em qualquer lugar = ❌ médio | |
| 1.6 | Produto com mais de 999 | Milhar | `Estoque: 1.284` (ponto de milhar) | |
| 1.7 | Valor × regra: some na calculadora o saldo de P5 em todas as filiais; toque no ✕ do chip da filial | Soma | Com "Todas as filiais", o cartão de P5 mostra `Estoque: <soma>` (ex.: 12). O preço não muda (RN-VEN-01) | |
| 1.8 | Tenant com "mostrar quantidade" desligado (BKO) e sincronize | Sem número | P1 `Em estoque`, P2 `Pouco estoque`, P5 e P6 `Sem estoque` (vermelho). Nenhum número aparece | |
| 1.9 | Entre com o promotor sem `promotor_ve_preco_estoque` | RN-CAT-05 | Sem preço e sem tag de estoque nos cartões | |

## 2. Cartão: códigos em duas linhas (critério b; spec §1.3)
| # | O que fazer | O que conferir | Resultado esperado | Resultado |
|---|---|---|---|---|
| 2.1 📷 🏷️ | P1 na grade | Ordem | Foto → nome (até 3 linhas, maior) → linha `980 · Travex` (cinza) → linha `PAF.1434` em negrito com o **ícone de copiar** ao lado → preço → tag de estoque | |
| 2.2 📷 | Dois cartões lado a lado, um de nome curto e um de nome longo | Alinhamento | As linhas dos códigos ficam na mesma altura nos dois cartões | |
| 2.3 📷 | P7 (sem marca) | Sem marca | A linha de cima some; embaixo do nome vem só `PAF.…` com o copiar. Linha vazia ou "·" solto = ❌ baixo | |
| 2.4 📷 | P8 (marca sem código da marca) | Sem código auxiliar | Premissa do testes (a spec não diz): a linha de cima mostra só a marca (`Travex`), sem "·" solto nem traço. Anote o que aparece; se for diferente, registre como divergência para o designer-ux | |
| 2.5 | Rótulos | Sem rótulo | Nenhum "Código:", "Ref.:" ou "Marca:" no cartão | |
| 2.6 📷 | Busque `cb3401` | Referência cruzada | P9 aparece; as duas linhas de código continuam e, embaixo delas, `Equivale a Freiomax CB 3401` com o código destacado | |
| 2.7 📷 | Ficha de P1 | Ficha | Faixa: `‹ Catálogo`, o nome e **uma linha só** `980 · Travex · PAF.1434 [copiar]`; embaixo `PC · EAN …` | |

## 3. Copiar (critério c; spec §1 e §2, R-20261115-084500)
| # | O que fazer | O que conferir | Resultado esperado | Resultado |
|---|---|---|---|---|
| 3.1 📷 | Toque no ícone de copiar do cartão de P1 | Toque | Aviso `Código copiado`; o toque **não** abre a ficha | |
| 3.2 | Cole num app de notas | Conteúdo | Exatamente `PAF.1434`: sem `980`, sem `Travex`, sem rótulo, sem espaço antes ou depois, sem quebra de linha | |
| 3.3 | Toque no cartão fora do ícone | Ficha | Abre a ficha | |
| 3.4 📷 | Ficha de P1 | Um copiar | Só o ícone ao lado do código do produto. **Não há** o botão "Copiar código" na caixa própria | |
| 3.5 | Toque no copiar da ficha e cole | Conteúdo | `PAF.1434`, igual ao 3.2 | |
| 3.6 | P7 e P8 | Sem marca / sem código auxiliar | O copiar copia só o código do produto | |
| 3.7 | TalkBack no ícone | Leitura | "Copiar código PAF.1434" | |

## 4. Filtro padrão (critério d; spec §4)
| # | O que fazer | O que conferir | Resultado esperado | Resultado |
|---|---|---|---|---|
| 4.1 📷 🏷️ | Mais → Catálogo (abrir do zero, depois de fechar o app) | Ao abrir | O `BotaoFiltro` com o selo **1** e, embaixo da busca, o chip `Filial Boa Vista ✕` (a filial do vendedor) | |
| 4.2 📷 | Toque no filtro | Folha "Filtrar" | Grupo **Filial**: `Boa Vista · sua filial` marcada, as outras e `Todas as filiais`. Grupo **Itens sem estoque**: `Mostrar` marcado. Rodapé `Limpar` e `Ver N produtos` | |
| 4.3 | Valor × regra: o N do `Ver N produtos` × o subtítulo do cabeçalho com a mesma escolha | Contagem | Os dois números iguais. A filial não esconde produto (o total não muda ao trocar a filial) | |
| 4.4 | Escolha `Ocultar` | Selo e chip | Selo **2**; entra o chip `Só com estoque ✕`; P5 e P6 somem da grade | |
| 4.5 | Toque `Limpar` | Volta ao padrão | Filial do vendedor e `Mostrar`; selo 1 | |
| 4.6 | ✕ do chip da filial | Todas | Chip some, selo 0, estoque somado (ver 1.7) | |
| 4.7 | Saia do Catálogo e volte | Reabrir | Abre de novo na filial do vendedor (selo 1) | |
| 4.8 | Clientes → um cliente de outra filial → Catálogo | RN-CORE-39 | O chip mostra a filial do **cliente**; o estoque é o dela | |

## 5. Offline (modo avião)
| # | O que fazer | O que conferir | Resultado esperado | Resultado |
|---|---|---|---|---|
| 5.1 | Modo avião, abra o Catálogo | Abertura | Abre na filial do vendedor (selo 1), com cartões, códigos e `Estoque: N` iguais aos com sinal | |
| 5.2 | Busque `PAF1434`, `paf 1434` e `cb3401` | Busca local | Acha P1 e P9 (ignora espaço, hífen, ponto e maiúscula; RN-CAT-09) | |
| 5.3 | Copie o código do cartão e da ficha | Copiar | Funciona sem sinal; cola `PAF.1434` | |
| 5.4 | Troque para `Todas as filiais` e `Ocultar` | Filtro offline | O estoque somado e a ocultação funcionam sem sinal | |
| 5.5 | P6 offline | Sem saldo | `Estoque: 0` vermelho (nunca "sem informação") | |
| 5.6 | Volte o sinal e sincronize | Reconexão | Nada duplica; a hora `Atualizado às hh:mm` da ficha muda para a da sincronização (fuso do tenant) | |

## 6. Ficha: estoque por filial (spec §2; RD-0497)
| # | O que fazer | O que conferir | Resultado esperado | Resultado |
|---|---|---|---|---|
| 6.1 📷 🏷️ | Ficha de P5 | Linhas | Primeiro `Boa Vista [Estoque: 0]` (tag vermelha); depois `Manaus 12` (sem cor); por fim `Atualizado às hh:mm`. Sem o rótulo "Estoque na filial…" | |
| 6.2 | Ficha de P6 | Sem saldo | A linha da sua filial aparece com `Estoque: 0`. Se ela sumir e as outras ficarem sem rótulo = ❌ médio (observação do corretor) | |
| 6.3 | Hora | Fuso | `Atualizado às` no horário de Manaus (UTC−4), não em UTC | |
| 6.4 | Ficha de P9 | Referência cruzada | Seção "Referência cruzada" com até 3 linhas marca + código; sem referência, a seção não aparece | |

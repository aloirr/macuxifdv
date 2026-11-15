# Início do Campo: cabeçalho com a foto ao lado dos textos

> **Escolhida: C (72).** 14/11/2026, dono do produto, recado R-20261114-212000-alexandre ("Tamanho C"). As variações A e B
> ficam só como histórico.
>
> 2026-11-15 · designer-ux · pedido do dono do produto R-20261114-204000 (chat de 14/11/2026, ~20h40 de Manaus, com o
> print do Início do Campo): foto à esquerda, ao lado da saudação, da data e da frase, para ela ficar maior; fontes menores
> se for preciso.
> Imagens (390 × 844 dp, 2×) em `telas/inicio-cabecalho/`, com o `.html` de cada uma ao lado:
> `00-comparativo.png` (só os cabeçalhos: antes e A, B e C, nome curto e longo), `01-variacao-a-56.png`,
> `02-variacao-b-64.png` (A e B: histórico) e `03-variacao-c-72.png` (a escolhida; tela inteira: antes, nome curto com foto, nome longo com iniciais).
> Dados fictícios ("Lucas Andrade" e "Maximiliano Aparecido Conceição"; a foto é uma silhueta desenhada).

## 1. O que muda
| | Hoje (v1.0.7) | Escolhida (C) |
|---|---|---|
| Linha 1 | avatar 40 + data · DU + sino | foto/iniciais à esquerda, na altura do bloco de texto |
| Linha 2 | "Boa noite, {primeiro nome}" na largura inteira | à direita da foto, empilhados: saudação (com o sino na mesma linha), data · DU, frase |
| Linha 3 | frase | — |
| Altura do painel (sem a barra de status) | 131 dp | 100 dp |

O painel fica **31 dp mais baixo**: sobra altura para as Metas do mês e a Produtividade, e a `escalaInicio` precisa
encolher menos as letras do meio no celular pequeno. Nada sai e nada entra: são os mesmos 4 itens (foto, saudação, data, frase)
e o sino.

## 2. Variações (A e B só como histórico)
| | Foto | Raio | Iniciais |
|---|---|---|---|
| A | 56 × 56 | `radius.md` (12) | `fonts.display` 20 |
| B | 64 × 64 | `radius.lg` (14) | `fonts.display` 22 |
| **C (escolhida)** | **72 × 72** | `radius.xl` (16) | `fonts.display` 24 |

**Escolhida: C (72).** É a que tem a altura do bloco de três linhas de texto (≈ 70 dp), que é o pedido ("ao lado de" e
"maior"); mesmo assim o painel fica 31 dp mais baixo que hoje, e a data e a frase ainda cabem em uma linha a 390 dp.

## 3. Tipografia e cores (tokens de `packages/ui`)
- Saudação: `fonts.display` **22** (hoje 24), cor `colors.faixaTitulo`; 1 linha, encolhe para caber até 0,75
  (`adjustsFontSizeToFit`, `minimumFontScale={0.75}`, ≈ 16,5) e só então reticências. Continua só o primeiro nome
  (`saudacaoComNome`). No teste a 390 dp: "Boa noite, Maximiliano" ficou em 19,5, sem reticências.
- Data · DU: `fonts.body` **13** (hoje 14; o corpo do `type.sub`), `colors.faixaSub`; o "· DU 11 de 23" segue sem quebra
  (`semQuebra`). Se não couber, quebra em 2 linhas antes do "·".
- Frase: `fonts.body` **13** itálico (hoje 14), `colors.faixaSub`, até 2 linhas (`numberOfLines={2}`), com aspas.
- Foto/iniciais: 72 × 72, raio `radius.xl` (16), iniciais `fonts.display` 24; fundo `colors.neutralBg`, iniciais em `colors.accentInk` (`initials(nome)`); com foto, a imagem cobre a área
  (`resizeMode="cover"`) com o mesmo raio. A foto vem do perfil (o mesmo dado do avatar de hoje).
- Espaços: `layoutCabecalho(insets.top)` como hoje (respiro de cima 12, lateral 20, embaixo 16); foto ↔ textos `space.md`
  (12); entre as linhas de texto `space.xxs` (2). Foto centralizada na vertical com o bloco de texto.
- Contraste na faixa (manual da marca §3): `faixaTitulo` 12,77:1, `faixaSub` 8,07:1, `accentInk` sobre `neutralBg` 10,99:1;
  todos ≥ 4,5:1. Nenhuma cor nova.
- Na escala (`escala-inicio.ts`): a foto escala com o fator, mas com piso de 56 (no menor fator a foto vira 56, nunca
  menor); as três letras seguem o piso de 11 dp com a fonte do sistema. A conta da altura do painel passa a ser
  `max(foto, saudação + data + frase)` no lugar de `ALVO_TOQUE + saudação + frase`.

## 4. Sino e toque
- O sino (o do `ProvedorSinoCabecalho`, com o balão) fica no canto de cima, na linha da saudação, com **alvo de 48 × 48**
  (`ALVO_TOQUE`). Para não tirar largura da data e da frase, ele sobe 10 dp e avança 12 dp no respiro do painel
  (margem negativa), sem sobrepor o texto; só a saudação divide a linha com ele.
- Toque na foto ou nos textos abre o Perfil (`onPerfil`), como hoje: um só `Pressionavel` com `accessibilityLabel`
  "Boa noite, Lucas. Abrir perfil"; a foto mantém o rótulo "Foto de {nome}" e os textos ficam fora da leitura repetida.
- Com a fonte do sistema grande: a saudação encolhe até 0,75 e depois usa reticências; a data e a frase quebram; a foto
  continua centralizada na vertical.

## 5. Gestão
O Início do Gestão não tem esse cabeçalho (é o `BoasVindas` de `apps/mobile/src/components/inicio.tsx`, sobre o fundo
Pérola, sem faixa e sem avatar), então esta mudança é só do Campo. Se o dono do produto quiser o mesmo no Gestão, entra
como pedido à parte ao `engenheiro-apps`.

## 6. Quem implementa e o que falta antes do lote
- **modulo-core** (dono de `modules/core/app/telas/inicio/tela-inicio-campo.tsx` e `escala-inicio.ts`, conferido com
  `node scripts/coord.mjs dono`): estilos `linhaTopo`, `perfil`, `textos`, `avatar` e a `BASE.painel` da escala, com os
  testes da escala atualizados. Não precisa de componente novo em `packages/ui`.
- Antes do lote e do build: **validação do design-de-marca** (mudança de layout numa superfície da marca) e **parecer do
  corretor-redundancias** sem achado aberto; revisão de UX do designer-ux no print do aparelho.

# Parecer de marca · Catálogo v2 · rótulo "Estoque: N"

## Versão 2 (commits `f9e40d05`, `f9e648c5` e `d4d41718`, comparados com `fd17f346`): **liberado**
> 2026-11-15 · design-de-marca · decisões R-20261115-083000, R-20261115-083600 e R-20261115-084600-alexandre (ícone `pacote`, opção 1 do anexo `R-20261115-084500-icones-estoque.png`).
> **Base:** branch `nuvem/catalogo-campo-designer-ux`, commit `d4d4171834127d720e38c38c9932dc7d77fe5ace`. PNGs `02`, `03`, `07` e `08` (conferidas byte a byte com as do commit), `simulacao.css`, HTML, `spec.md` §2 a §4, `packages/ui/src/mobile/icon.tsx`, `packages/ui/src/web/icons.tsx` e `docs/design/telas/icones.js`.

Nada fere o manual. Não há achado.

| Item | Situação | Conferido |
|---|---|---|
| Duas cores só (verde > 0, vermelho ≤ 0) | **ok** | Chip: `#1D6B4F` no `#E2F1EA` (5,51:1) e `#A8261B` no `#FDE8E6` (6,04:1), pelos tokens. Sai o âmbar `warning` do Catálogo e não entra cor nova. A cor é situação e vem sempre com o número (§3) |
| Ícone `pacote`: desenho | **ok** | É a opção 1 aprovada (caixa com a fita): hexágono de 4 a 20 na horizontal e de 3 a 21 na vertical, a aresta do meio e a fita do meio de uma aresta do topo ao meio da oposta. Fica dentro da grade 24, com a mesma margem da `caixa` e da `copiar` |
| Ícone `pacote`: traço | **ok** | No mobile ele herda o `{...c}` comum (traço 2, ponta e junção arredondadas, sem preenchimento) e não traz `stroke`, `fill` nem hex próprio. Na web usa o `Svg` comum dos outros ícones. Os quatro traços são iguais nos dois kits e na simulação, e o teste do kit confere |
| Ícone `pacote`: cor e tamanho | **ok** | Grafite `#16202A` no branco (16,48:1), 18 dp, num quadro de 32 dp com borda `#C9CED5` no cartão e no botão `outline` de 48 dp ("Por filial") na ficha. É o padrão do copiar ao lado, sem cor nova. A prancha da proposta mostrava o ícone em Azul noite: no app vale a cor do kit para ícone de botão secundário, que é o grafite |
| Folha "Estoque por filial" | **ok** | É a `Folha` do kit: título Archivo ExtraBold, cabeçalho da tabela `#4A5562` na Névoa (6,53:1), "sua filial" `#4A5562` no branco (7,59:1), linhas `#ECEEF1`. Número em Archivo Bold 16 tabular: verde `#1D6B4F` no branco (6,43:1) e vermelho `#A8261B` no branco (7,10:1), inclusive o negativo `−2`, com o sinal |
| Chip "Suas filiais (3)" | **ok** | É a `EtiquetaFiltro` comum: Azul noite na pílula `#DFE2E6` (9,83:1), com o ✕, igual ao "Filial Boa Vista". Sem forma nem cor nova |
| Cartão a 360 dp | **ok** | Úteis 136 dp. Chip com 8 dp de lado + 6 dp de espaço + botão de 32 dp: `Estoque: 0` 113 dp, `Estoque: 52` 120 dp, `Estoque: 999+` e `Estoque: −999` 135 dp. Cabe, mas no limite (sobra 1 dp no pior caso). Por isso o `999+` da spec §3 tem que ser aplicado no cartão |
| Tipografia | **ok** | Chip Plex SemiBold 12 (cartão) e 13 (ficha), botão Plex SemiBold 15. Nada fora do §5 |

**Para o testes, fora da marca:** com o tamanho de fonte do Android aumentado, o `Estoque: 999+` com o botão pode não caber no cartão. Vale conferir no aparelho.

---

## Versão 1 (commit `fd17f346`)

> 2026-11-15 · design-de-marca · decisão R-20261115-082500-alexandre (rótulo `Estoque: 28`; o zero fica `Estoque: 0` no vermelho de hoje).
> **Base:** branch `nuvem/catalogo-campo-designer-ux`, commit `fd17f346fefd33e5992a5abd3511d2db72c58195` (designer-ux). PNGs `01` a `05` de `docs/design/catalogo-campo-v2/` (conferidas byte a byte com as do commit), `simulacao.css`, HTML, `spec.md` §3 e `catalogo-grade.md` §4. Conferido contra `docs/marca/manual.md` v1 (§3 paleta e contraste, §5 tipografia) e contra o `ChipEstado` do kit (`packages/ui/src/mobile/base.tsx`, no `main`).
> **Escopo:** só o rótulo do estoque. O resto do Catálogo v2 já foi liberado no parecer `2026-11-15-catalogo-filtro-campo.md` (branch `nuvem/catalogo-campo-design-de-marca`).

## Veredito: **liberado**
O rótulo novo muda só o texto. A cor, o fundo, a forma, o peso e o tamanho do chip continuam os do `ChipEstado`, e ele cabe com folga no cartão a 360 dp. Não há achado.

## O que foi conferido
| Item | Situação | Conferido |
|---|---|---|
| Vermelho do `Estoque: 0` | **ok** | Texto `#A8261B` (`danger`) sobre `#FDE8E6` (`dangerBg`), pelos tokens (`simulacao.css`, `.ce.erro`). No PNG `02` o fundo medido é `#FDE8E6` e o texto `#A8261B`. É o erro da paleta (§3), sem cor "quase igual" |
| Papel da cor | **ok** | Vermelho só para a situação "sem estoque", sempre com texto (§3). A escala verde, âmbar e vermelho é a mesma de antes |
| Contraste | **ok** | `Estoque: 0`, `#A8261B` no `#FDE8E6`: **6,04:1**. `Estoque: 28`, `#1D6B4F` no `#E2F1EA`: **5,51:1**. `Estoque: 2`, `#7A4F00` no `#FFF1D6`: **6,38:1**. Todos acima de 4,5:1 |
| Peso e tamanho | **ok** | IBM Plex Sans SemiBold (600), 12 px na pílula de 24 dp no cartão e na busca, 13 px na pílula de 28 dp na ficha. É o mesmo do `ChipEstado` do kit (`pequeno` 12 e normal 13, com 10 e 12 dp de lado). Mesmo peso e tamanho nas três telas equivalentes |
| Cabe no cartão a 360 dp | **ok** | O cartão tem 158 dp e 136 dp úteis (padding de 10 dp e borda de 1 dp). Largura medida com a fonte real, mais os 20 dp do chip: `Estoque: 0` 79 dp, `Estoque: 28` 86 dp, `Estoque: 1.284` 104 dp e `Estoque: 128.400` 119 dp. Até 6 dígitos com separador cabe numa linha, sem cortar (`white-space: nowrap`) |
| Tipografia do texto | **ok** | Só Plex Sans no rótulo, sem fonte nem peso novo (§5) |

## Fora do escopo da marca
Na ficha, a filial do vendedor mostra `Estoque: 0` e as outras só o número (`Manaus 12`). É decisão de texto e de layout do designer-ux e do corretor (RD-0497), não de marca.

# Parecer de marca · Catálogo v2 · rótulo "Estoque: N"

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

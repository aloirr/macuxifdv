# Parecer da marca · Fotos em lote no BKO (T-0174), spec e `Progresso` do kit

> 2026-11-15 (Manaus) · design-de-marca
> - **Spec:** `docs/design/telas/fotos-em-lote.md` e `packages/ui/src/web/index.ts`, que agora exporta o `Progresso`. Estão no `nuvem/T-0174-designer-ux`, head `2af5da7f`.
> - **Contexto:** a ADR 0054 está no `nuvem/T-0174-engenheiro-software`, head `9aee8ae4`.
> - **O que falta:** a tela ainda não foi implementada. Validei a spec e o componente contra o manual, com as cores dos tokens de `apps/web/app/globals.css` no `main`.

## Veredito
**Liberado (spec e kit), sem achado de marca.** O reteste no print de 1366×768, com os estados da spec §8, fica para quando a tela do `modulo-catalogo` existir.

## Cores e estados

| Elemento (seção da spec) | Token → hex | Par e razão | Manual | Resultado |
|---|---|---|---|---|
| Área de envio (2.1) | borda tracejada `border-field` `#C9CED5`, fundo `bg-surface` `#FFFFFF` | enfeite (1,58) | §3: borda forte | conforme |
| Arrastando por cima (2.1) | `border-accent` `#1E3350` 2 px, fundo `bg-accent-soft` `#DFE2E6`, texto `text-ink-2` `#4A5562` | texto 5,84; Azul noite no Azul suave 9,83 | §3: Azul suave é o fundo do cartão em destaque, e Azul noite é o estado ativo | conforme |
| Botão "Escolher ZIP" | `Button primary`, Azul noite com texto branco | 12,77 | §3: botão principal | conforme |
| Linhas de orientação e limites (12 a 14 px) | `text-ink-2` no branco | 7,59 | §3 | conforme |
| `Progresso` (3.3), preenchimento | `tom="destaque"` → `bg-grafico` `#C2540A`, trilho `bg-line-2` `#ECEEF1` | 3,96 contra o trilho e 4,60 contra o branco (≥ 3:1 de gráfico) | §3: o Sol laranja é cor de gráfico e de barra. É o mesmo papel da barra da entrada do Gestão (`#C2540A` no `#DFE2E6`) | conforme |
| `Progresso`, texto | rótulo `text-ink-2` 13 px e valor `text-ink` 13/600 com `tabular-nums` | 7,59 e 16,48 no branco | §3 e §5 | conforme |
| Cartões-filtro (3.4), números | `text-success` `#1D6B4F`, `text-warning` `#7A4F00` e `text-danger` `#A8261B` no branco; o zero vai em `text-ink`; "Repetidas" em `text-ink-2` | 6,43, 7,13 e 7,10 | §3: situação sempre com texto. O rótulo diz a situação, e o zero não ganha cor | conforme |
| Cartão marcado (3.4) | traço 2 px `border-accent`, fundo `bg-accent-soft` e o número na cor da situação | verde 4,94, âmbar 5,49 e vermelho 5,46 no `#DFE2E6` | o mesmo padrão do Farol (lote 11) | conforme |
| Selos (5.1 e 5.2) | `pending` Azul noite no Azul suave (9,83), `success` (5,51), `warning` (6,38), `danger` (6,04) e `neutral` `#34404D` na Névoa (9,09) | ≥ 4,5 | §3: cada um com o rótulo em texto. "Enviando", "Conferindo" e "Processando" saem no tom `pending` (Azul noite), o estado em andamento, e não no laranja | conforme |
| Avisos (6) | `Notice` `danger` e `info`, `ErrorBlock` e diálogo com `Button danger` | tons do kit | §3: o erro sai em vermelho com texto, nunca em laranja | conforme |

- **Cores:** a spec não traz nenhum hex solto nem cor nova. Tudo vem pelo token do kit.
- **Laranja:** só aparece no preenchimento da barra. Não é usado em texto, em erro nem em botão.
- **Verde:** só aparece em situação com rótulo, nunca como enfeite.

## Componente `Progresso` (`packages/ui/src/web/progresso.tsx`, exportado agora)
- **Conformidade:** o componente segue o manual.
  - O percentual sempre aparece em texto.
  - O `progressbar` tem nome e `aria-valuetext`.
  - O `transition` respeita o `prefers-reduced-motion`.
- **Orientação para o kit (sem achado):** o tom `sucesso` (`bg-success`) com `mostrarRotulo={false}` deixaria uma barra verde sem texto visível, e o manual §3 só admite verde com texto.
  - A Fotos em lote usa só o `destaque` com o rótulo visível, então está conforme.
  - Quando outra tela usar o `sucesso`, mantenha o rótulo visível. Se o designer-ux quiser travar isso no tipo, fica a critério dele.

## Tom
- A spec não traz nenhuma peça de voz da marca: nome de produto, slogan, e-mail ou boas-vindas.
- Os textos de interface (§2 a §6) são do designer-ux e do corretor. Eles são diretos e dizem a ação ("Divida as fotos em mais de um ZIP.", "Envie de novo.").
- Não catalogo nada fora do meu escopo.

## Pendências (não seguram)
- **Simulação aprovada não aberta:** a `R-20261115-071800-upload-fotos.png` também não abriu nesta sessão (HTTP 403 no repositório de recados). Quando a tela vier, o reteste confere o print contra essa simulação, que prevalece sobre a spec nos pontos "[conferir simulação]".
- **Prints de 1366×768 (spec §8):** envio vazio, enviando, processando, concluído com as 4 situações e com o filtro "Recusadas" marcado, lote repetido e recusado por `zip_grande`.

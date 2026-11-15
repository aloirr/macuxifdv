# Parecer de marca · T-0174 · BKO "Produtos → Fotos em lote" · 2ª revisão

> 2026-11-15 (Manaus) · design-de-marca · 2ª revisão, pedida pela sessão de revisão do gerente-projetos, antes do lote (R-20261112-065914).
> **Base:** `main` `origin/main` desta data; `nuvem/T-0174-designer-ux` `24eb01ba` (kit `packages/ui/src/web/ui.tsx`, `progresso.tsx`, `index.ts` e spec `docs/design/telas/fotos-em-lote.md`); `nuvem/T-0174-modulo-catalogo` `d66ebfff` (`modules/catalogo/web` e os textos do `domain`). Diff `git diff origin/main...<branch>`, conferido contra `docs/marca/manual.md` §3 (paleta) e §5 (tipografia).
> **Pareceres anteriores** (não repito o que já foi fechado): `nuvem/fotos-lote-design-de-marca` `bb95aeab` (spec e `Progresso`, liberado) e `nuvem/T-0174-design-de-marca` `f0a3b96a` (MC-0089 a MC-0091, fechados na reconferência).
> **Sem print:** a sessão não tem `node_modules` nem banco, e a tela depende da API. Avaliado pelo código e pela spec. O reteste é no print de 1366×768 (spec §8).
> **Recados:** `node scripts/coord.mjs caixa design-de-marca` respondeu HTTP 403 (repositório de recados não anexado). A simulação aprovada `R-20261115-071800-upload-fotos.png` continua sem abrir. As mensagens aos donos vão pelo gerente-projetos.

## Parecer: **liberado com ajustes** (1 achado baixo, MC-0100)

## O que mudou desde a reconferência e o resultado
| Commit | O que mudou | Marca |
|---|---|---|
| designer-ux `24eb01ba` | spec: rotas sem contradição e o texto do `LOTE_DIVERGENTE` ("O arquivo mudou desde o início do envio. Escolha o ZIP de novo.") | sem impacto em cor, tipo ou layout. A voz é direta e diz a ação |
| modulo-catalogo `32ff05e9`, `80a1c8ad`, `a47e521d`, `d66ebfff` | trava dos lotes em andamento, limites do tenant nos textos ("Foto acima de 2 MB", "As fotos passam de 1024 MB descompactadas…"), constantes de texto movidas para `contracts` | só texto e regra. Nenhuma classe de cor, tamanho ou peso mudou na página |

## Correções anteriores nos heads atuais
- **MC-0089** continua fechado: o "‹ Fotos em lote" usa `font-semibold text-accent-ink` com o foco `outline-accent` (`fotos-lote-page.tsx`, `PageHeader` do lote).
- **MC-0090** continua fechado: o `KpiCard` do kit tem `selecionado` (`border border-accent ring-1 ring-inset ring-accent bg-accent-soft`, uma borda de 2 px e fundo Azul suave de ponta a ponta). A página usa a prop sem `<button>` em volta. Os números no Azul suave `#DFE2E6` ficam em verde 4,94, âmbar 5,49, vermelho 5,46 e `text-ink-2` 5,84, todos acima de 4,5:1.
- **MC-0091** continua fechado: "Peça ao administrador da sua empresa."

## Varredura do head atual
- **Cor:** só tokens do kit (`ink`, `ink-2`, `field`, `surface`, `accent`, `accent-soft`, `accent-ink`, `line-2`, `grafico`, `success`, `warning`, `danger`). Nenhum hex solto, `style=` ou cor nova no diff de `modules/catalogo/web`.
- **Laranja:** só no preenchimento do `Progresso` (padrão `tom="destaque"` → `bg-grafico`), com o valor em texto (`mostrarRotulo="valor"`).
- **Selos:** em andamento em `pending` (Azul noite), interrompido em `warning`, recusado e falhou em `danger`, na fila e já enviado em `neutral`, sempre com rótulo.
- **Botões:** um principal (Azul noite) por estado. "Escolher ZIP" no envio, "Enviar outro ZIP" no fim, e "Cancelar envio" `danger` só no diálogo.
- **Tipografia:** 12, 13 e 14 px e os 26 px `font-display` extra-negrito do `KpiCard`, com `tabular-nums` nos números, tudo dentro da escala do kit.
- **Logo, ícone, grafismo:** nenhum novo. Só o `IconDownload` do kit em "Baixar CSV".
- **Voz:** sem peça de voz da marca. Não catalogo os textos de interface, que são do designer-ux e do corretor.

## Achados

### MC-0100 · "Ligadas" com zero pintado de verde · baixa
| Campo | Conteúdo |
|---|---|
| ID | MC-0100 |
| Onde | BKO, relatório do lote, cartão 1. `modules/catalogo/web/lib/fotos-lote.ts:39-44` (`corDoCartao`) e a spec `docs/design/telas/fotos-em-lote.md:115` (tabela da §3.4, linha 1) |
| Tipo | cor |
| Fere | §3: o verde de sucesso é só para situação e nunca decoração. A própria spec §3.4 diz "o número com zero fica em `text-ink`". Um lote em que nenhuma foto ligou (tudo sem produto ou recusado) mostra "Ligadas **0**" em verde `#1D6B4F`, ou seja, sinal de sucesso onde não houve nenhum. Os cartões 2 e 3 já voltam para `text-ink` no zero, e o 1 não |
| Gravidade | baixa |
| Correção | spec, linha 1 da tabela §3.4: `text-success` → `text-success` (0 → `text-ink`). Código: em `corDoCartao`, depois de `if (c === 'repetidas') return 'text-ink-2';`, testar `if (valor === 0) return 'text-ink';` **antes** de `if (c === 'ligadas') return 'text-success';`. Resultado: o zero fica em `#16202A`, e de 1 em diante segue `#1D6B4F` (6,43 no branco, 4,94 no Azul suave). Vale um teste em `fotos-lote.test.ts` com `corDoCartao('ligadas', 0) === 'text-ink'` |
| Dono | designer-ux (spec §3.4) · modulo-catalogo (`web/lib/fotos-lote.ts`) |

## Pendências (não seguram)
- Conferir o layout contra a simulação aprovada (HTTP 403 nesta sessão), nos pontos **[conferir simulação]** da spec §2.1, §3.3 e §3.4.
- Reteste no print de 1366×768 (spec §8) para fechar MC-0089 a MC-0091 e MC-0100 no print.
- Ordem de merge: o `modulo-catalogo` usa `KpiCard` com `onClick`, `selecionado` e `testid` e o `Progresso` exportado pelo kit, que estão só no `nuvem/T-0174-designer-ux`. O designer-ux entra antes, como já está no quadro (item 4 antes do 5).

# Parecer de marca · reteste B de 4 lotes de 15/11/2026 (bloqueio de usuário, revisão do BKO e cabeçalho do Início do Campo)

> 2026-11-15 · design-de-marca · pedido do gerente-projetos (14/11/2026, ~22h de Manaus).
> **Base:** `main` `17d91b28`, contra `docs/marca/manual.md` v1, `decisoes.md` e o parecer `2026-11-15-reteste-lotes.md` (`369c0716`).
> Cada lote foi lido com `git diff origin/main...<SHA>` e, no reteste, com o diff contra o SHA do parecer anterior.
> **Recados:** a CLI de recados dá HTTP 403 nesta nuvem. Os avisos aos donos vão pelo gerente-projetos.
> **Achados novos:** nenhum. A numeração segue na MC-0065.

## Resumo
| Lote | Branch · SHA | Reteste | Achados novos | Parecer |
|---|---|---|---|---|
| 1 | `nuvem/usuario-bloqueio-designer-ux` · `355136a` | MC-0064 fechada | nenhum | **liberado** (veja a ressalva da pilha) |
| 2 | `nuvem/bko-revisao-designer-ux` · `bbd24f4` | commit novo só de doc (RD-0392 e RD-0393) | nenhum | **liberado** (mantido) |
| 3 | `nuvem/inicio-cabecalho-designer-ux` · `76fa58a` | variação C registrada na spec | nenhum | **liberado** |
| 4 | `nuvem/inicio-cabecalho-modulo-core` · `d6a3623` | código e prints da variação C | nenhum | **liberado** |

## Lote 1 · Bloqueio de usuário no BKO (MC-0064)
- **MC-0064 fechada.** A simulação `docs/design/telas/usuario-bloqueio/usuario-bloqueio.html` agora segue o `MenuAcoes` do kit (`packages/ui/src/web/menu-acoes.tsx` no `ec94326`):
  - botão "⋯" de 36 px, raio 10, sem borda, `ink-2` e, aberto, `ground` com `ink` (kit: `h-9 w-9 rounded-[10px] text-ink-2`, `bg-ground text-ink`), com o `IconMais` de três pontos;
  - menu com `min-width` de 200, `py-1` e a sombra do kit; item de 40 px, padding de 14, peso 500 e `ink`; o "Desativar" em `danger`, com a linha `line-2` em cima (como o kit faz no primeiro item de perigo);
  - foco no item: `#DFE2E6` (`accent-soft`) com contorno de 2 px `#1E3350` por dentro (MC-0060, mantido).
- Os ícones de módulo são os de `packages/ui/src/web/icons.tsx` (`IconGestor`, `IconVendedor` e `IconPromotor`, a gôndola com produtos), copiados path a path, com traço 1,9 (`TRACO_DO_MODULO`). A Renata Promotora agora mostra o ícone do Promotor, e não mais o do Gestor.
- Os 3 PNGs refeitos (`1-lista-bloqueado`, `2-menu-desbloquear` e `3-gaveta-bloqueado`) mostram o mesmo desenho.
- **Ressalva da pilha (não é achado de marca):** o branch foi criado sobre o PR #250 (`e6453f5`, `nuvem/acesso-bko-modulo-core`). O `git diff origin/main...355136a` traz o `menu-linha.tsx` e o `icones-modulo.tsx` do `modulo-core`, com a **MC-0061 e a MC-0062 ainda abertas** (média). O que é do designer-ux está liberado, mas o merge deste branch não pode levar o código do #250 antes dessas duas fecharem. O merge entra depois do #250 corrigido, ou só com os 3 commits do designer-ux (`675c0b1`, `8ad8a87` e `355136a`).

## Lote 2 · Revisão do BKO, commit novo (RD-0392 e RD-0393)
- `git diff ec94326 bbd24f4`: só 2 docs. Em `bko-revisao.md` §P13, a decisão "e" (nome "Promotor") sai da lista de abertas e vira a linha "Decidida". Em `portal-config-enxuto.md` §11.8, saem as notas "antes `promotor-avulso`" dos testIDs.
- Nada de cor, logo, ícone, tipografia ou nome visível mudou. O nome do módulo continua "Promotor" (R-20261114-205500), e o "avulso" fica só na linha do preço. **Liberado**, como já estava.

## Lote 3 · Início do Campo, spec com a variação C escolhida
- `git diff 6f7023f 76fa58a`: só `docs/design/telas/inicio-cabecalho.md`. A spec registra a escolha "Tamanho C" (R-20261114-212000-alexandre), põe A e B como histórico e fixa os valores da C: foto de 72 × 72, raio `radius.xl` (16), iniciais `fonts.display` 24, piso de 56, saudação `fonts.display` 22 em `faixaTitulo` e data e frase `fonts.body` 13 em `faixaSub`.
- Os tokens e o contraste na faixa (`faixaTitulo` 12,77:1, `faixaSub` 8,07:1, `accentInk` sobre `neutralBg` 10,99:1) são os mesmos que já foram conferidos no parecer anterior. Não entra nenhuma cor nova.
- No §4, "o sino (com o balão)" é o painel que abre ao tocar, e não um número: o sino do app (`apps/mobile/src/components/sino.tsx`) só tem a bolinha. Está coerente com a MC-0059.
- **Liberado.**

## Lote 4 · Início do Campo, implementação da variação C (modulo-core)
Código (`modules/core/app/telas/inicio/tela-inicio-campo.tsx` e `escala-inicio.ts`):
- **Cor:** só tokens. A saudação usa `colors.faixaTitulo`; a data e a frase, `colors.faixaSub`; as iniciais, `colors.accentInk` sobre `colors.neutralBg`. Não há hex solto.
- **Tipografia:** a saudação usa `fonts.display` 22, com `minimumFontScale` 0,75 (antes era 0,6), como na spec. A data e a frase usam `fonts.body` 13, e a frase vai em itálico. As iniciais usam `fonts.display` 24. O piso de letra de 11 dp foi mantido.
- **Forma:** foto de 72 com piso de 56 (`limita(..., 56, 72)`), raio `radius.xl` (16 no `packages/ui/src/mobile/tokens.ts`) e `overflow: 'hidden'`, para a foto ficar com o mesmo raio. Entre as linhas, `space.xxs`; entre a foto e o texto, `space.md`.
- **Sino:** o `sinoDoPainel` continua vindo do `ProvedorSinoCabecalho` do shell, que é o `<Sino sobreFaixa />` (`apps/mobile/src/app/(tabs)/_layout.tsx:50`). Ele usa `coresDoSino(true)`: botão vazado com borda `faixaTrilho`, ícone branco e bolinha `graficoEscuro` (`#F59A52`, 5,85:1) com aro `faixa`. O sino não foi redesenhado na tela.
- **Gestão:** não mudou. A mudança é só do Campo, como diz a spec no §5.

Prints (`docs/modulos/core/prints/inicio-enquadrado/inicio-cabecalho-390x844-fonte-1-*.png`, 390 × 844):
- **Nome curto com foto:** foto de 72 com raio 16 à esquerda. Ao lado ficam "Boa noite, Lucas" em Archivo branco, a data · DU e a frase em itálico, com o sino de bolinha Sol claro na linha da saudação. A faixa Azul noite vai de ponta a ponta.
- **Nome longo sem foto:** "MC" em Azul noite sobre Névoa, no mesmo tamanho. "Boa noite, Maximiliano" cabe em 1 linha, sem reticências, e não encosta no sino.
- O meio e o rodapé não mudaram em relação ao Início aprovado.
- **Liberado.**
- **Pendência de reteste:** os prints são da página de captura (`docs/modulos/core/prints/inicio-enquadrado/gerar.mjs`), não do aparelho. Reteste no print do aparelho do próximo build: a foto real recortada no raio 16 e o sino na linha da saudação, com a fonte do sistema em 1,0 e em 1,3.

## Achados
| ID | Gravidade | Onde | Fere | Correção | Dono | Estado |
|---|---|---|---|---|---|---|
| MC-0064 | baixa | simulação do bloqueio: "⋯", item e ícones de módulo fora do kit | §5 e checklist C | "⋯" de 36, item de 40 com peso 500 e ícones de `icons.tsx` com traço 1,9 | designer-ux | **fechado** (`355136a`) |

Continuam abertos, fora destes 4 lotes: MC-0061 e MC-0062 (média, seguram o #250) e MC-0063 (baixa), todos do `modulo-core`.

## Pendências para o gerente-projetos
- **Lote 1:** fazer o merge só depois do #250 corrigido (MC-0061 e MC-0062), ou levar só os 3 commits do designer-ux. Do jeito que está, o branch leva o código do #250 junto.
- **Lote 4:** pedir ao `testes` o print do aparelho no próximo build, para o reteste final da marca no Início do Campo.

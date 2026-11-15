# Parecer de marca · `CampoSenha` com olho no kit (app e web)

> 2026-11-15 · design-de-marca · pedido R-20261115-071000 (dono do produto: "Padrão da senha é o olho para mostrar e ocultar").
> **Base:** PR #323, branch `nuvem/campo-senha-designer-ux`, commit `63b85a1d7527710cdeddf8fe1d8cbfac24b35a84`, contra `docs/marca/manual.md` v1 (§3 paleta, §5 tipografia).
> **Arquivos lidos:** `packages/ui/src/mobile/icon.tsx` (`olho`, `olhoRiscado`), `packages/ui/src/web/icons.tsx` (`IconEye`, `IconEyeOff`), `packages/ui/src/mobile/campo-senha.ts` e `campo-senha-rn.tsx`, `packages/ui/src/web/campo-senha.tsx`, `packages/ui/src/mobile/tokens.ts`, `apps/web/app/globals.css` e `docs/design/campo-senha/spec.md`.
> **Print:** [`auditorias/2026-11-15-campo-senha/campo-senha.png`](../auditorias/2026-11-15-campo-senha/campo-senha.png). Gerado no Chromium headless a partir de um HTML de teste com os SVG, as medidas e os hex do commit: o app em 52/48/22 e a web em 44/44/18, a área de toque tracejada, o erro e o olho ao lado de quatro ícones do kit em 24 px. Não é print do aparelho: o print da tela de verdade vem quando as telas migrarem.

## Veredito: **liberado**
Nenhum achado. O ícone é da família do kit, a cor e o contraste estão no manual e a área de toque é a do kit.

## O que foi conferido
- **Desenho e traço:**
  - Os dois ícones seguem a família do kit: grade de 24, `fill="none"`, traço 2, pontas e junções arredondadas, sem preenchimento. No print, ao lado do pin, da casa, do relógio e do alerta, o peso é o mesmo.
  - O app (`olho`, `olhoRiscado`) e a web (`IconEye`, `IconEyeOff`) usam o **mesmo desenho, caminho por caminho**: o usuário vê o mesmo olho no celular e no BKO.
  - O risco do `olhoRiscado` corta o olho de canto a canto e tem a fresta em volta da pupila. Fica legível em 18 px.
- **Cor:**
  - O ícone é `ink2` `#4A5562` (Texto secundário, §3) sobre o branco do campo, com **7,59:1** (o mínimo para ícone é 3:1). Na web, o hover vai para `ink` `#16202A` (grafite).
  - A borda do campo é `#C9CED5` (borda forte, §3) e a borda de erro é `#A8261B`, com texto da tela (§3, situação).
  - O foco na web usa o contorno Azul noite `#1E3350`. Tudo sai por token (`colors.ink2`, `colors.lineStrong`, `colors.danger`, `text-ink-2`, `border-field`, `outline-accent`), sem hex solto e sem cor nova.
  - O ícone não usa laranja nem verde, e o olho não vira enfeite.
- **Área de toque:** no app, o alvo é de **48 × 48 dp** (`ALVO_TOQUE`), dentro do campo de 52 dp, com o texto recuado 52 dp para não passar por baixo do olho. Na web, o alvo é de **44 × 44 px** no campo de 44 px. Os dois estão no padrão do kit. O ícone tem 22 dp no app e 18 px na web, proporcional à altura de cada campo.
- **Tipografia:** rótulo em IBM Plex Sans SemiBold 13 e valor em Plex Sans 16 no app e 15 na web, dentro da escala do kit (§5).
- **Texto "As duas senhas iguais"** (spec §4, proposta): é texto de interface, do designer-ux e do corretor. Para a marca, segue o padrão dos outros itens ("Uma letra", "Um número"), sem jargão. Não há objeção. Como muda texto aprovado, entra só com o "de acordo" do Alexandre, como a spec já diz.

## Fora deste parecer
- O comportamento do teclado (`visible-password`, `new-password`) e a migração das telas são do testes e dos donos das telas. Quando as telas migrarem para o `CampoSenha`, a marca confere no print do aparelho e do navegador (login do Campo e do Gestão, "Crie sua senha", login do BKO e Entrar do portal).

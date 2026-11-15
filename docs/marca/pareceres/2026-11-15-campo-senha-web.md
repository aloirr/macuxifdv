# Parecer de marca · olho na senha da web (login do BKO, "Crie sua senha" e portal `config.`)

> 2026-11-15 · design-de-marca · pedido R-20261115-071000 (dono do produto: "Padrão da senha é o olho para mostrar e ocultar").
> **Base:** PR #328, branch `nuvem/campo-senha-engenheiro-apps`, commit `f3245738f86cefd5b7d84d870cd119315455b1cb`, contra `docs/marca/manual.md` v1 e o parecer do `CampoSenha` do kit ([`2026-11-15-campo-senha.md`](2026-11-15-campo-senha.md), `551a8bf`).
> **Arquivos lidos:** `apps/web/components/login-screen.tsx`, `ciclo-senha.tsx`, `portal/base.tsx`, `portal/tela-entrar.tsx` e `portal/passo-empresa.tsx`, mais `CLASSE_CAMPO_ACESSO` (`packages/ui/src/web/ui.tsx:137`) e o `CampoSenha` web do kit.
> **Print:** [`auditorias/2026-11-15-campo-senha-web/web-senha.png`](../auditorias/2026-11-15-campo-senha-web/web-senha.png). Mostra o login do BKO com erro na senha, o "Crie sua senha" com a senha visível e o foco no campo, e o Entrar do portal com o olho em hover.
> - É um HTML de teste no Chromium headless, com as classes do commit traduzidas para CSS (os tokens de `globals.css`), os SVG do kit e as fontes do `apps/web`.
> - O `next dev` do branch não subiu no worktree: o Turbopack recusa o `node_modules` ligado de fora da raiz e esta sessão não instala dependências.
> - As faixas do logo no print são ilustrativas (a medida da MC-0022). O PR não mexe na faixa.

## Veredito: **liberado**
Nenhum achado. As três telas usam o `CampoSenha` e a `CLASSE_CAMPO_ACESSO` do kit. O olho, a cor, o traço e a área de toque são os mesmos validados no `551a8bf`.

## O que foi conferido
- **Um campo só em toda a web:**
  - saem o `CampoDeSenha` local do "Crie sua senha", o `CampoSenha` local do portal e os três `campoCss` soltos (login, ciclo da senha e portal);
  - todos passam a usar a mesma classe do kit, e não há hex novo nem classe de cor fora dos tokens;
  - o mesmo campo, com o mesmo olho, no BKO e no portal, é exatamente a consistência que a marca pede.
- **Login do BKO:**
  - O campo ganhou `w-full` e agora ocupa a largura do formulário (400 px), como no portal. Antes, os três campos do login eram os únicos sem largura cheia.
  - A borda de erro é a do kit: `aria-[invalid=true]:border-danger` (`#A8261B`), com a mensagem em 12 px `text-danger`. O erro tem 6,57:1 no Pérola e 7,10:1 no branco, sempre com texto (§3, situação).
  - O olho fica em `ink-2` `#4A5562` (7,59:1 no branco), com hover em grafite e foco com contorno Azul noite.
- **"Crie sua senha" (web):** um olho só, no "Senha nova", mostra os dois campos. O "Repita a senha" vem sem olho e sem o recuo do olho, como na spec §2 do kit. O botão de texto "Esconder senha" saiu: na tela fica só o ícone, e o texto vai para o leitor de tela.
- **Portal `config.` (Entrar e senha inicial do admin):** o mesmo `CampoSenha` do kit, com o estado na tela. O olho, o alvo de 44 × 44 px, o ícone de 18 px e as cores são iguais aos do BKO.
- **`aria-pressed` saiu do olho:** não muda nada visível. O rótulo falado é que diz o estado ("Mostrar senha" / "Ocultar senha"), como no kit.
- **Tipografia:** os rótulos em Plex SemiBold 13, o valor em Plex 15 e o título "Entrar" em Archivo ExtraBold 28, sem mudança.

## Fora deste parecer
- **MC-0022:** a área de proteção do logo na `MarcaNaFaixa` segue aberta com o engenheiro-apps, e este PR não mexe nela.
- **O teste novo (`campo-senha-telas.test.tsx`) e o comportamento** (`autoComplete`, foco no erro) ficam com o testes.
- Quando o PR estiver no ar, a marca confere de novo no print do navegador de verdade (login do BKO, "Crie sua senha" e Entrar do portal).

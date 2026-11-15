# Parecer de marca · senha do modulo-core no `CampoSenha` do kit (login e "Crie sua senha" do app, Redefinir senha do BKO)

> 2026-11-15 · design-de-marca · pedido do gerente-projetos (R-20261115-071000, dono do produto: "Padrão da senha é o olho para mostrar e ocultar").
> **Base:** branch `nuvem/login-teclado-modulo-core`, commits `9e0b931c`, `01ddf2a6` e `46988ad3`, contra o `main` `40f91c1e`, o `docs/marca/manual.md` v1 e os pareceres do kit (`551a8bf`) e da web (`92fa60c`).
> **Arquivos lidos:** `modules/core/app/components/tela-login.tsx`, `tela-crie-sua-senha.tsx` e `estilos-de-acesso.ts`; `modules/core/web/components/usuarios/usuarios-page.tsx`; o `CampoSenha` do kit (`packages/ui/src/mobile/campo-senha-rn.tsx`, `campo-senha.ts` e `packages/ui/src/web/campo-senha.tsx`), a `CLASSE_CAMPO_ACESSO` (`packages/ui/src/web/ui.tsx:137`) e a spec `docs/design/campo-senha/spec.md`.
> **Print:** [`auditorias/2026-11-15-senha-core/senha-core.png`](../auditorias/2026-11-15-senha-core/senha-core.png). Playwright/Chromium, `deviceScaleFactor` 1.
> - É um HTML de teste com as medidas e os tokens do código (fontes do `apps/web`, SVG do olho do kit). O BKO não subiu nesta sessão, e o app foi avaliado pelo código e pela spec: a parte de baixo do print é uma simulação, não um print do aparelho.
> - Nomes e e-mails do print são fictícios.

## Veredito: **liberado**
Nenhum achado. As três telas passam a usar o `CampoSenha` do kit, já validado. O olho, a cor, o traço, a área de toque, a borda de erro e o foco são os mesmos do resto do ecossistema.

## O que foi conferido
- **Olho só em ícone (app e BKO):**
  - saem o "Mostrar/Esconder" em texto Azul noite do app (`olhoTexto`, `estilos-de-acesso.ts`) e o botão de linha "Mostrar senha/Esconder senha" do BKO;
  - fica o olho do kit em `ink2` `#4A5562` (7,59:1 no branco), sem fundo nem borda, 22 dp com alvo de 48 dp no app e 18 px com alvo de 44 px no BKO;
  - o Azul noite volta a ficar só para o que é ação principal e link (§3).
- **Altura, raio e borda iguais aos outros campos:**
  - **App:** o `CampoSenha` do kit tem os mesmos valores do `estilosDeAcesso.entrada` usado no Código da empresa e no E-mail: 52 dp, borda de 1 em `lineStrong` `#C9CED5`, raio `radius.md` (12), recuo de 14, Plex 16 em grafite sobre o branco. O rótulo continua em Plex SemiBold 13 e o espaço entre o rótulo, o campo e o erro continua em 4.
  - **BKO:** o campo segue com 44 px, raio de 12 px e borda `field` `#C9CED5`, igual ao "Gerar senha" ao lado (44 px). O valor passa de 14 para 15 px, que é a medida da `CLASSE_CAMPO_ACESSO` do kit, a mesma das outras senhas da web (login, "Crie sua senha" e portal). Não fere o manual.
- **Erro:**
  - no app, a borda vira `danger` `#A8261B`, e no login a mensagem fica abaixo em 12 px `danger`, como nos outros dois campos da tela;
  - no "Crie sua senha", a borda vermelha marca a senha que falta regra e a repetição que não confere, como antes;
  - erro sempre com texto (§3, situação). O vermelho tem 7,10:1 no branco e 6,57:1 no Pérola.
- **Foco:**
  - no BKO, o contorno é Azul noite `#1E3350` com a borda grafite (`focus-visible`), o mesmo das outras senhas da web e dos campos do `globals.css`;
  - no app, nenhum campo das telas de acesso tem estilo de foco próprio, e a senha segue igual.
- **"Crie sua senha" do app:** o olho fica só no "Senha nova" e mostra os dois campos. O "Repita a senha" vem sem olho e sem o recuo, como na spec §2.
- **Cor nova:** nenhuma. Sai o `colors` do import do "Crie sua senha", e não entra hex solto.

## Fora deste parecer
- O código da empresa em maiúsculas enquanto digita (`9e0b931c`, `46988ad3`) e o teclado de senha (`visible-password`) são comportamento: ficam com o testes.
- A mensagem de erro da senha logo abaixo do campo no login (a spec do kit diz que o texto fica com a tela) é texto e lugar de alerta: fica com o designer-ux e o corretor.
- Quando a v1.0.10 estiver no aparelho, a marca confere de novo no print do Campo e do Gestão (login e "Crie sua senha") e no print do navegador (Usuários → Redefinir senha).

# "Copiar" ao lado da senha no e-mail "Seu acesso ao Macuxi" — simulação (R-20261124-093023)

Base: HTML real de `renderizarEmail('acesso_inicial', …)` (`packages/platform-sdk/src/email/modelos.ts`, sem alteração), dados da demonstração (Distribuidora Exemplo, código `demo`, `vendedor@exemplo.com.br`) e senha fictícia no formato do gerador (`modules/core/domain/acesso-senha.ts`: 12 caracteres com um especial), `Kp7#rTm2xQ9a`. Só o bloco da senha muda; cores da paleta (manual da marca §3).

Programas de e-mail não rodam JavaScript: um botão que copie sozinho, dentro do e-mail, não existe.

## Opção A — botão "Copiar senha" que abre uma página do Macuxi
- E-mail: `email-acesso-copiar-a-390.png`, `email-acesso-copiar-a-1366.png`. Botão de contorno Azul noite (44 px de altura), para não competir com "Abrir o backoffice", que segue como o único principal.
- Página: `email-acesso-copiar-a-pagina-390.png` (estado depois do toque). Link `https://bko.macuxifdv.com.br/acesso/copiar?t=<token>`: sem senha na URL; token aleatório, de uso único, que vence em minutos. A página mostra a senha e o botão Copiar (52 px), que usa a área de transferência do navegador, e confirma com "Senha copiada. Cole no campo Senha.".
- Prós: copia de verdade, com um toque, em qualquer programa de e-mail.
- Contras:
  - um passo a mais: abre o navegador, copia e volta ao app;
  - os verificadores de link (Outlook Safe Links, antivírus, a pré-visualização do Gmail) abrem o link antes da pessoa. Se a abertura gastar o token, a pessoa recebe "link já usado". Para evitar isso, o token só pode ser gasto no toque em Copiar (POST), e a página fica exposta enquanto o token valer;
  - provedores com rastreio de cliques reescrevem o link e guardam o token nos registros deles;
  - abre uma superfície nova que mostra a senha (página pública, limite de tentativas, sem cache, sem indexação, Referrer-Policy) e precisa de trabalho de API e de tela (`modulo-core` e `engenheiro-software`);
  - "toque no link para ver a sua senha" é o mesmo padrão do golpe de phishing.

## Opção B — senha num bloco fácil de selecionar
- `email-acesso-copiar-b-390.png`, `email-acesso-copiar-b-1366.png`. Campo branco com borda `#7A8593`, fonte mono de 24 px, espaçamento de 2 px, `user-select: all`, e a dica "Toque e segure para copiar".
- Prós: funciona sem internet, no e-mail que já chegou e em qualquer programa; nenhum passo, link, token ou superfície nova; muda só o modelo do e-mail.
- Contras:
  - copiar ainda leva dois toques (segurar e depois Copiar no menu do sistema);
  - o `user-select: all` não é garantido: o Gmail (web e app) e o Outlook do Windows descartam parte do CSS. Onde ele cai, o toque longo seleciona só a "palavra", e o especial da senha (`#`, `@`, `!`…) corta a seleção (no exemplo, só `Kp7`);
  - observação: o e-mail atual **já** leva `user-select: all` na senha (`SELECIONAVEL` em `modelos.ts`). O ganho da B está no alvo maior, que parece um campo, e na dica.

## Recomendada: B
É a única que funciona em todo programa de e-mail, sem internet e sem nova exposição da senha. A A troca um toque a menos por um link de senha que os verificadores de link consomem e que imita phishing.
Para a B ficar completa no Gmail e no Outlook, o especial da senha temporária não pode cortar a seleção. Hoje ele é sorteado em `!@#$%&*?` (RN-CORE-32), e a troca seria usar um especial que conta como letra na seleção, como o `_`. Essa decisão é do Alexandre e a mudança é do `modulo-core`; até lá, a dica cobre o caso comum.

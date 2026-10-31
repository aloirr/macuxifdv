# Gerar os 2 APKs de desenvolvimento (EAS) — passo a passo

> Para o Alexandre, no PC. Fecha o critério 1 da T-0004 e a Sprint 0. Fonte técnica: `docs/desenho/T-0004.md` §7.

> **Atalho**: `_instalar\gerar-apks.cmd` (do Alexandre) confere Node/pnpm, faz o login na Expo se precisar e oferece um menu com os builds (Campo + Gestão, demonstração, só Campo) e o `expo start --dev-client`. Os passos abaixo são o caminho manual.

## Antes (uma vez)
1. Abra o **PowerShell** e instale o EAS CLI: `npm i -g eas-cli`
2. Entre na conta Expo: `eas login` (a conta precisa ter acesso à organização **macuxifdv**, dona do projeto `48bb6c9b…` herdado da Fase M).
   - Se não tiver acesso: na pasta `apps\mobile`, rode `eas init` para criar um projeto seu e avise o gerente (o engenheiro ajusta `owner`/`projectId` no `app.config.ts`).
3. Confirme: `eas whoami`

## Gerar os APKs
4. Vá para a pasta do app: `cd C:\macuxifdv\apps\mobile`
5. Macuxi Campo: `eas build --profile campo --platform android`
6. Macuxi Gestão: `eas build --profile gestao --platform android`
   - Os builds rodam na nuvem da Expo (≈ 15–25 min cada). No fim, o EAS mostra um link/QR para baixar o APK.
   - As bibliotecas de câmera novas (foto da fachada) exigem exatamente este build.

## Testar no celular
7. Instale os 2 APKs no Android (permitir "fontes desconhecidas").
8. No PC, sirva o JavaScript para os dois: `npx expo start --dev-client` (celular e PC na mesma rede).
9. Abra o Macuxi Campo, entre com código da empresa + e-mail + senha (usuários da fixture/seed), confira "Meus módulos".
10. Para levar a campo sem o PC: `eas build --profile campo-preview --platform android`.

## Depois
- Avise o gerente com os 2 links do build: a T-0004 e a Sprint 0 fecham.
- Pendente: arte do ícone do Macuxi Gestão (hoje igual ao do Campo).

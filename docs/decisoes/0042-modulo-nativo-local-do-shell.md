# ADR 0042 — Módulo nativo local do shell (`apps/mobile/modules/<nome>`), só para diagnóstico

- **Status**: aceita em 2026-11-10 (revisão do engenheiro-software sobre a proposta do engenheiro-apps)
- **Data**: 2026-11-10
- **Tarefa**: T-0144 (o app fechava 3 vezes na 1ª abertura, sem tela de erro)
- **Autor**: engenheiro-software
- **Origem**: R-20261110-062231-alexandre (quedas da v1.0.2), R-20261110-074248-engenheiro-apps (proposta e pedido de revisão).

## Contexto
A v1.0.2 fechou fora do React (o JS não viu erro nenhum). Sem adb nem relatório de bug no aparelho do dono do produto, a única
fonte confiável da causa é o próprio Android: `ActivityManager.getHistoricalProcessExitReasons` (Android 11+) e o último erro Java
não tratado. Nenhuma biblioteca Expo expõe isso, e um SDK de monitoramento (Sentry, Crashlytics) traz dependência pesada, conta
externa e dado do usuário fora do nosso controle.

## Decisão
1. O shell pode ter **módulo nativo local** em `apps/mobile/modules/<nome>` (Expo Modules API, Kotlin, achado pelo autolinking em
   `./modules`), sem `package.json` próprio, sem dependência nova e sem mudança no `pnpm-lock.yaml`.
2. Escopo: **só leitura e diagnóstico**. O módulo não muda o comportamento do app; a regra (o que é queda, texto, máscara de dado
   pessoal) fica no TS puro do shell (`src/lib/`), com teste.
3. O JS carrega com `requireOptionalNativeModule`: APK sem o módulo, iOS ou Android abaixo do mínimo respondem "indisponível",
   nunca lançam. **Plano B do build**: se o Kotlin não compilar no EAS, apagar a pasta do módulo devolve o build ao estado anterior
   sem mexer no TS.
4. Primeiro módulo: `macuxi-saida` (`ultimasSaidas(limite)`, `ultimoErroJava()`), dono `engenheiro-apps`.
5. Módulo nativo novo, ou que faça mais que diagnóstico, precisa de ADR própria.

## Alternativas consideradas
- **Sentry/Crashlytics**: dependência pesada, conta externa, dado pessoal fora do tenant. Rejeitada por ora.
- **Plugin de config com código nativo gerado no prebuild**: mais difícil de ler e revisar que um módulo Expo. Rejeitada.
- **Pacote no workspace (`packages/<nome>`)**: exigiria `package.json` e lockfile para um código que só o shell usa. Rejeitada.

## Consequências
- O PC do dono do produto não tem JDK: o Kotlin só compila no EAS (ou num build `--local` com JDK 17 e Android SDK). A revisão do
  engenheiro-software confere API mínima (`minSdk` 24 do RN 0.86; a leitura das saídas é guardada por `SDK_INT >= 30`), imports,
  `expo-module.config.json` e o autolinking (`expo-modules-autolinking resolve -p android` lista o módulo).
- A pasta `apps/mobile/modules/` entra no git (o `.gitignore` do shell só ignora `/android` da raiz do app).

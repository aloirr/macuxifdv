# Inventário do Expo: o que depende da conta antes de inativá-la

Pedido do dono do produto (R-20261114-224500-alexandre): "me avise quando puder inativar minha conta no expo".
Levantamento do engenheiro-apps em 14/11/2026, 22h46 (Manaus), sobre o `main` em `03926f1`. Só levantamento: nenhum código foi alterado.
O destino pedido era `docs/producao/expo-inventario.md`, mas o guardião bloqueou porque o caminho é do gerente-projetos. Por isso o arquivo ficou aqui, num caminho do engenheiro-apps; o gerente pode movê-lo.

**Resposta curta:** **ainda não dá para inativar.** Hoje a conta guarda três coisas que não existem em outro lugar:
1. as **chaves de assinatura** dos dois APKs;
2. o **contador do versionCode**;
3. as **credenciais do push**.

Antes de inativar é preciso baixar as chaves e o contador (passo 0, abaixo), levar o build para o GitHub Actions e, para inativar de vez, trocar o push para o FCM direto (opção 2).

## 0. Passo crítico, antes de qualquer outra coisa (Alexandre, cerca de 30 min)

Sem a **mesma chave de assinatura**, o Android recusa instalar por cima do app que já está nos aparelhos. O vendedor teria de desinstalar, e perderia o que estiver na fila do aparelho sem sincronizar. Por isso, com a conta ainda ativa:

1. **Baixar as duas keystores**, uma por pacote. Na pasta `apps/mobile`, com o eas-cli logado na conta:
   - `eas credentials -p android` → perfil `campo-producao` → **Keystore: Manage everything needed to build your project** → **Download existing keystore**;
   - repetir para o perfil `gestao-producao`, que tem outro pacote e outra chave;
   - guardar os dois `.jks`, a senha do keystore, o alias e a senha da chave num cofre de senhas e numa cópia fora do computador.
   - Não gerar chave nova. Uma chave nova obriga a desinstalar o app em todos os aparelhos.
2. **Anotar o versionCode atual** de cada pacote:
   - `eas build:version:get -p android -e campo-producao`;
   - `eas build:version:get -p android -e gestao-producao`.

   Hoje o contador fica na Expo (`appVersionSource: remote`). O primeiro build fora do EAS precisa de um versionCode **maior** que esse, senão o Android não instala por cima.
3. **Baixar os APKs que ainda servem**: os links `expo.dev/artifacts/...` morrem com a conta (`eas build:list`, ou `pnpm --filter mobile eas:apk ... --publicar` para o bucket).
4. **Guardar o `google-services.json`**, que hoje está na variável de arquivo `GOOGLE_SERVICES_JSON` do environment `production` do EAS. Ele também pode ser baixado de novo no console do Firebase, no projeto que já existe desde 02/11 (T-0065).
5. **Conferir quem é dono da organização `macuxifdv`** na Expo. Se a conta do Alexandre for a única dona, inativá-la pode apagar a organização junto, com o projeto, as credenciais e o push.

## A. Inventário

Legenda da coluna "Tipo":
- **CONTA**: para de funcionar sem a conta.
- **LIB**: só usa a biblioteca npm do Expo SDK e não depende de conta.
- **DOC**: documentação ou teste que precisa de ajuste.
- **—**: não existe no repositório; nada a fazer.

### A.1 Build (EAS Build)

| # | Arquivo:linha | O que é | Tipo | Se a conta for inativada |
|---|---|---|---|---|
| 1 | `.github/workflows/eas-build.yml:1-120` | Workflow "eas build": instala o `eas-cli`, faz `eas whoami` e chama `eas build --no-wait`. O build roda no servidor da Expo. | CONTA | Para. Substituir pelo workflow de build local (gradle/`expo prebuild`) que outra sessão está fazendo; depois apagar ou desligar este (dono: engenheiro-software). |
| 2 | Secret `EXPO_TOKEN` do GitHub (lido em `eas-build.yml:44,60,97,104`) | Token de acesso da conta Expo. | CONTA | Revogar no expo.dev e apagar o secret do GitHub depois que o build novo estiver validado. |
| 3 | `apps/mobile/eas.json:1-21` | Perfis `campo-producao` e `gestao-producao`. Também guardam `appVersionSource: remote` (linha 2), `autoIncrement` (linha 4), `environment: production` (linhas 7 e 15, de onde vem a variável `GOOGLE_SERVICES_JSON`) e `credentialsSource: remote` (linhas 9 e 17, a assinatura que está na Expo). | CONTA | Fica sem uso. O versionCode passa a ser do repositório (ex.: `android.versionCode` no `app.config.ts`, a partir de `scripts/eas/versao.json`) e a assinatura passa a vir dos secrets do Actions (A.3). |
| 4 | `apps/mobile/scripts/eas/build.mjs:1-70`, `comum.mjs:41-55` | Script que chama `eas build` com o nome do build. | CONTA | Sai, ou fica só para montar o nome do build (`src/lib/nome-build.ts` é lógica pura e continua). |
| 5 | `apps/mobile/scripts/eas/baixar-apk.mjs:9,137-138` | Baixa o APK do EAS (`eas build:list` / `build:view`) e publica no bucket. | CONTA | A parte do EAS para. O envio ao bucket (`s3-assinado.ts`) continua útil para o APK gerado no Actions. |
| 6 | `apps/mobile/scripts/eas/eas.test.ts:15,55,109,124,212-230`, `scripts/eas/eas-build.yml` (cópia do workflow), `scripts/eas/T-0109-workflow.diff` | Testes e cópias do workflow do EAS. | DOC | Ajustar ou remover junto com os itens 1, 3 e 4. |
| 7 | `apps/mobile/package.json:15-16` (`eas:build`, `eas:apk`) | Atalhos dos scripts do EAS. | CONTA | Saem com os itens 4 e 5. |
| 8 | `tests/modulos/shells.test.ts:42,46-59`, `apps/mobile/src/lib/nome-build.test.ts:55-62`, `src/lib/endereco-do-build.test.ts:93-109` | Testes que leem o `eas.json` e o `extra.eas`. | DOC | Reescrever para a fonte nova das variáveis de build (`APP_VARIANT`, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_PERFIL_BUILD`). |
| 9 | `apps/mobile/src/lib/nome-build.ts:8-13,57-60` | Comentários e nome do perfil do `eas.json`. | DOC | Ajustar o texto. A lógica continua. |
| 10 | `.github/workflows/ci.yml:286-310` | Bundle do Metro nas duas variantes, "antes de gastar build da Expo". | LIB | Continua (não usa conta). Só o comentário muda. |

### A.2 Projeto e identidade na Expo

| # | Arquivo:linha | O que é | Tipo | Se a conta for inativada |
|---|---|---|---|---|
| 11 | `apps/mobile/app.config.ts:167` | `extra.eas.projectId = 48bb6c9b-…` | CONTA | Opção 1: precisa continuar, porque o push usa esse projeto. Opção 2: sai. |
| 12 | `apps/mobile/app.config.ts:169` | `owner: 'macuxifdv'` (organização na Expo). | CONTA | Opção 2: sai. |
| 13 | `apps/mobile/app.config.ts:97` | `slug: 'macuxi-fdv'` | LIB | O `expo prebuild` ainda exige um slug. Pode ficar e não depende de conta. |
| 14 | `apps/mobile/app.config.ts:6-9,18-21` | Comentário sobre a assinatura e o versionCode na EAS. | DOC | Atualizar junto com o item 3. |

### A.3 Credenciais

| # | Onde | O que é | Tipo | Se a conta for inativada |
|---|---|---|---|---|
| 15 | Expo, credenciais Android de `br.com.macuxi.campo` | Keystore (chave de assinatura) do Macuxi Campo. Não está no repositório. | CONTA | **Perde-se para sempre.** Baixar antes (passo 0). No Actions vira os secrets `ANDROID_KEYSTORE_CAMPO_BASE64`, `ANDROID_KEYSTORE_CAMPO_SENHA`, `ANDROID_KEY_CAMPO_ALIAS` e `ANDROID_KEY_CAMPO_SENHA`. |
| 16 | Expo, credenciais Android de `br.com.macuxi.gestao` | Keystore do Macuxi Gestão. | CONTA | O mesmo, com os secrets `ANDROID_KEYSTORE_GESTAO_BASE64`, `ANDROID_KEYSTORE_GESTAO_SENHA`, `ANDROID_KEY_GESTAO_ALIAS` e `ANDROID_KEY_GESTAO_SENHA`. |
| 17 | Expo, contador remoto do versionCode (os dois pacotes) | Número que sobe a cada build. | CONTA | Anotar antes (passo 0). O primeiro build do Actions usa um número maior. |
| 18 | Expo, variável de arquivo `GOOGLE_SERVICES_JSON` (environment `production`), lida em `app.config.ts:113-116` | Configuração do Firebase do app. O `.gitignore` (`apps/mobile/.gitignore:44-45`) impede que ela entre no repositório. | CONTA | Guardar o arquivo e criar o secret `GOOGLE_SERVICES_JSON` (base64) no Actions. O workflow decodifica o arquivo para uma pasta temporária e passa o caminho na variável. O `app.config.ts` não muda. |
| 19 | Expo, credencial de push FCM V1 (chave da conta de serviço do Google enviada à Expo na T-0065) | É com ela que o servidor `exp.host` entrega no FCM. | CONTA | Opção 1: continua na Expo. Opção 2: a mesma conta de serviço, ou uma chave nova, vai para a API (`FCM_SERVICE_ACCOUNT_JSON`). |
| 20 | Upload key / Google Play | Não há. Distribuição direta por APK (`buildType: apk`); o Play fica para depois. | — | Nada a fazer agora. No Play, usar a mesma keystore como upload key. |

### A.4 Push

| # | Arquivo:linha | O que é | Tipo | Se a conta for inativada |
|---|---|---|---|---|
| 21 | `apps/mobile/src/services/push.ts:129-130` | `getExpoPushTokenAsync({ projectId })`: o token Expo depende do projeto na conta. | CONTA | Opção 2: trocar por `getDevicePushTokenAsync()`, que devolve o token FCM. |
| 22 | `apps/mobile/src/lib/push.ts:56-58` | `tokenExpoValido`: aceita só `ExponentPushToken[...]`. | CONTA | Opção 2: passar a aceitar o token FCM (texto opaco, até cerca de 300 caracteres). |
| 23 | `apps/mobile/src/services/push.ts:23,35`, `services/permissoes.ts:41,53`, `app.config.ts:158` (plugin `expo-notifications`) | Biblioteca de notificações: canal, permissão, toque e tarefa do push silencioso. | LIB | Continua igual nas duas opções. |
| 24 | `modules/core/api/push.ts:27` | `URL_EXPO_PUSH = https://exp.host/--/api/v2/push/send` | CONTA | Opção 2: envio pelo FCM HTTP v1 (`https://fcm.googleapis.com/v1/projects/<id>/messages:send`). |
| 25 | `modules/core/api/push.ts:31-38` | `montarMensagemExpo`: descarta o que não for token Expo. | CONTA | Opção 2: montar a mensagem FCM. Na convivência, escolher o caminho pelo formato do token. |
| 26 | `modules/core/api/push.ts:41-56`, `consumidores.ts:40-47` | `enviarPush` em lote para o Expo, chamado pelo despachante da outbox. | CONTA | Opção 2: envio por token (o FCM v1 não tem lote) com token OAuth da conta de serviço. Erro `UNREGISTERED` limpa o `push_token`. |
| 27 | `MACUXI_PUSH_ATIVO=1` na API e no worker (`apps/api/src/worker.ts:7`) | Chave que liga o envio. | LIB | Continua. Na opção 2 ganha a companhia de `FCM_SERVICE_ACCOUNT_JSON`. |
| 28 | `modules/core/contracts/notificacao.ts:26-27` | `PushTokenSchema` (`token` com até 300 caracteres, `plataforma: 'android'`). | LIB | Serve aos dois tipos de token. Não precisa de versão nova do contrato. |
| 29 | `db/migrations/0006_core_lote_a.up.sql:24-25` (`core.dispositivo.push_token`, `push_plataforma`) | Coluna do token. | LIB | Não precisa de migração: o tipo sai do formato (`ExponentPushToken[` é Expo; o resto é FCM). Uma coluna `push_tipo` é opcional (banco-dados). |
| 30 | Testes de push: `modules/core/api/push.test.ts:4`, `consumidores.test.ts:15`, `consumidores.db.test.ts:18`, `notificacoes.db.test.ts:125,131`, `apps/api/test/core-push.banco.test.ts:30,139`, `tests/integracao/api/notificacoes.test.ts:253-262`, `tests/integracao/demo/smoke-demo.test.ts:55`, `apps/mobile/src/lib/push.test.ts:44-57` | Testes com tokens e URL do Expo. | DOC | Opção 2: acrescentar os casos FCM e manter os de Expo até o fim da convivência. |

### A.5 Atualização pelo ar (EAS Update / OTA)

| # | Onde | O que é | Tipo | Se a conta for inativada |
|---|---|---|---|---|
| 31 | `apps/mobile/package.json`, `app.config.ts` | **Não há** `expo-updates`, `runtimeVersion` nem `updates.url` (conferido com grep; `docs/desenho/T-0088.md:15` confirma: sem OTA). | — | Nada a fazer. Toda mudança de JS já sai em build novo. |

### A.6 Documentação (ajuste de texto, não bloqueia)

| # | Arquivo:linha | O que é |
|---|---|---|
| 32 | `apps/mobile/docs/eas-build-sem-pc.md:1-36` | Passo a passo do `EXPO_TOKEN` e do workflow do EAS. Substituir pelo passo a passo do build no Actions. |
| 33 | `apps/mobile/docs/eas-build-passo-a-passo.md:26-55` | `eas build:version:*`, `eas build` e o `EXPO_TOKEN` no environment `APK_BUCKET`. |
| 34 | `docs/status/eas-build-passo-a-passo.md:10-24` | Passo a passo antigo, com perfis que já saíram. |
| 35 | `docs/produto/07-agentes-e-coordenacao.md:228-240` | Nome do build "no Expo", link do expo.dev e "Onde sai o build" pelo `eas-build.yml` (dono: gerente-projetos). |
| 36 | `docs/status/producao.md:121` | "assinatura pela EAS". |
| 37 | `docs/desenho/T-0004.md:150-155` | Comandos `eas build` e `owner`/`projectId`. É um registro histórico e pode ficar. |
| 38 | `docs/status/demo.md:40-45`, `docs/testes/roteiro-build-05-11.md:9-10` | Links `expo.dev/artifacts` de APKs antigos. Morrem com a conta. São históricos. |
| 39 | `CLAUDE.md` (seção "Nuvem, PR e git": build pelo `eas-build.yml`) | Atualizar quando o build do Actions substituir o EAS (dono: gerente-projetos). |

**Total: 39 itens.**
- **18 dependem da conta (CONTA)**: 1–5, 7, 11, 12, 15–19, 21, 22 e 24–26.
- **6 só usam a biblioteca (LIB)**: 10, 13, 23 e 27–29.
- **2 não existem hoje (—)**: 20 (upload key) e 31 (OTA).
- **13 são docs e testes (DOC)**: 6, 8, 9, 14, 30 e 32–39.

Bibliotecas que **não** dependem de conta e ficam: `expo`, `expo-router`, `expo-notifications`, `expo-sqlite`, `expo-secure-store`, `expo-location`, `expo-image-picker`, `expo-background-task`, `expo-task-manager`, `expo-constants`, `expo-dev-client` (só entra no build de depuração) e as demais `expo-*` do `apps/mobile/package.json`, além das variáveis `EXPO_PUBLIC_*` (o Metro embute no bundle sem a Expo).

## B. Opções

Preços e limites do Expo conferidos até meados de 2026. **Confirmar em expo.dev/pricing antes de decidir**, porque a Expo muda a tabela.

### Opção 1: plano gratuito do Expo, mantendo o push pelo Expo

- **Custo mensal: US$ 0.**
- **O que continua de graça:**
  - o Expo Push Service (sem cobrança por mensagem; limite de vazão em torno de 600 notificações por segundo por projeto);
  - o projeto e as credenciais guardadas.
- **Limites do plano Free:**
  - cerca de 15 builds Android por mês, na fila de baixa prioridade. Deixa de importar com o build no Actions;
  - EAS Update até cerca de 1.000 usuários ativos por mês. Não usamos.
- **A conta não pode ser inativada.** O token `ExponentPushToken` é emitido para o `projectId` da conta, e a entrega passa pela credencial FCM V1 guardada na Expo (item 19). Só dá para cancelar o plano pago, se houver um, e revogar o `EXPO_TOKEN`.
- **Trabalho do time: cerca de 3 a 4 h.**
  - versionCode no repositório e limpeza do `eas.json`, dos scripts e dos testes (engenheiro-apps, 2 a 3 h);
  - docs (1 h).
  - O workflow de build no Actions é de outra sessão e não está nessa conta.
- **Trabalho do Alexandre:** passo 0 (30 min) e a troca do plano (5 min).

### Opção 2: push pelo FCM direto, para inativar a conta de vez

- **Custo mensal: US$ 0.** O FCM é gratuito, e o projeto do Firebase já existe desde a T-0065.
- **Trabalho do time: cerca de 20 a 26 h**, mais 1 h do Alexandre.

**App** (engenheiro-apps, 5 a 7 h):
- `services/push.ts:129-130`: `getDevicePushTokenAsync()` em vez de `getExpoPushTokenAsync`;
- `lib/push.ts:56-58`: validação do token FCM;
- `app.config.ts:167,169`: tirar `extra.eas.projectId` e `owner`;
- `googleServicesFile` continua vindo de `GOOGLE_SERVICES_JSON`, agora pelo arquivo decodificado do secret no Actions. O config plugin é o do próprio Expo (`android.googleServicesFile`) e não precisa de dependência nova;
- conferir no aparelho que a notificação visível, o toque (`data.link`) e o push silencioso (`data.entidades` como texto, que o app já aceita) funcionam com a mensagem montada pela API em vez da do Expo.

**API** (modulo-core / engenheiro-software, 8 a 10 h):
- envio pelo FCM HTTP v1 com a conta de serviço. O token OAuth sai de um JWT assinado com `node:crypto`, sem dependência nova; o `google-auth-library` é opcional;
- a troca de `exp.host` fica atrás de uma escolha pelo formato do token, para os dois tipos conviverem;
- erro `UNREGISTERED`/`NOT_FOUND` limpa o `push_token`;
- `android.priority: HIGH`, canal `avisos` e dados só em texto;
- não precisa de migração: o tipo sai do formato do token. Uma coluna `push_tipo` é opcional (banco-dados, 1 h).

**Testes** (testes, 4 a 6 h): unitários e de banco do envio FCM, convivência Expo + FCM e roteiro no aparelho com o app fechado.

**Revisões e docs** (corretor-redundancias, engenheiro-software e docs): 2 a 3 h.

**O que o Alexandre faz no Firebase** (o projeto já existe; 30 a 60 min):
1. Conferir que o projeto tem os dois apps Android `br.com.macuxi.campo` e `br.com.macuxi.gestao` (pacotes de `app.config.ts:55` e `:65`). Se faltar um, adicionar e baixar o `google-services.json` novo, que vale para os dois.
2. Google Cloud → IAM → contas de serviço → a conta do Firebase Admin (ou uma nova com o papel "Firebase Cloud Messaging API Admin") → **criar chave JSON**.
3. Secrets sugeridos:
   - GitHub Actions: `GOOGLE_SERVICES_JSON`, com o arquivo em base64;
   - API e worker: `FCM_SERVICE_ACCOUNT_JSON`, com a chave da conta de serviço em base64, no `.env` da produção e no secret do workflow de deploy (dono: engenheiro-software), e `FCM_PROJECT_ID`.

**Impacto nos aparelhos já instalados:**
- os APKs atuais (até o Oficial v1.0.7) só registram o token Expo, e esse token para quando a conta sair;
- a convivência começa com o build novo (já pelo Actions, com a mesma keystore e versionCode maior). Nele o app registra o token FCM no `PUT /v1/core/dispositivos/atual/push`, que já troca o token antigo do aparelho, e a API envia pelo FCM para esse aparelho e pelo Expo para quem ainda não atualizou;
- a conta só sai quando todos os aparelhos estiverem no build novo. A conferência é feita no banco: nenhum `push_token like 'ExponentPushToken[%'` nos dispositivos ativos;
- **sem push, o app não para**: o botão Sincronizar e a sincronização em segundo plano (ADR 0017) seguem funcionando. O que se perde é só o aviso imediato.

### Ordem segura

1. **Passo 0**: baixar as duas keystores, o versionCode, os APKs e o `google-services.json`, e conferir o dono da organização (Alexandre).
2. Secrets no GitHub: keystores, senhas, aliases e `GOOGLE_SERVICES_JSON`.
3. Build pelo Actions validado: instalar **por cima** do Oficial atual num aparelho de teste, sem desinstalar. Se instalar, a assinatura e o versionCode estão certos.
4. Opção 2: build com o FCM, API com a convivência, aparelhos atualizados e nenhum token Expo ativo.
5. Revogar o `EXPO_TOKEN`, apagar o secret e desligar o `eas-build.yml`.
6. **Só então inativar a conta.** Na opção 1 a conta fica no plano Free e para no passo 5.

**Recomendação do engenheiro-apps:**
- passos 0 a 3 já, em qualquer opção;
- a opção 1 serve como estado intermediário, sem custo;
- a opção 2 só se a meta for apagar a conta, porque o custo é o trabalho (20 a 26 h) e a convivência até o último aparelho atualizar.

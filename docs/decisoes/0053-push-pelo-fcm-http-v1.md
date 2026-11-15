# ADR 0053 — Push pelo FCM HTTP v1

- **Status**: proposta em 2026-11-14 (branch `nuvem/push-fcm-engenheiro-software`). Alvo: v1.0.10 (não segura a v1.0.9).
- **Data**: 2026-11-14 (Manaus)
- **Autor**: engenheiro-software
- **Origem**: R-20261114-231500-alexandre ("vamos migrar para o firebase"): opção 2 do inventário
  `apps/mobile/docs/expo-inventario.md` (engenheiro-apps), itens 19 e 21 a 30.
- **Quem implementa**: modulo-core (`modules/core/api/push.ts`, `consumidores.ts`, `modules/core/contracts/notificacao.ts`);
  engenheiro-apps (`apps/mobile`, branch `nuvem/push-fcm-engenheiro-apps`); engenheiro-software (secrets e `push.env`, esta ADR).

## Contexto
- Hoje o app pede o token com `getExpoPushTokenAsync({ projectId })` e o servidor manda em lote para
  `https://exp.host/--/api/v2/push/send`. O `exp.host` entrega no FCM com a chave da conta de serviço que enviamos à Expo
  (T-0065). Tudo depende da conta da Expo.
- O FCM HTTP v1 (`https://fcm.googleapis.com/v1/projects/<id>/messages:send`) aceita uma mensagem por chamada, autenticada
  por token OAuth da conta de serviço. O app obtém o token FCM com `getDevicePushTokenAsync()` (o `expo-notifications`
  continua: canal, permissão, toque e tarefa do push silencioso).
- `core.dispositivo.push_token` é `text` e `PushTokenSchema` (`modules/core/contracts/notificacao.ts`) aceita qualquer texto
  de 1 a 300 caracteres com `plataforma: 'android'`. Não restringe ao formato Expo.
- Na produção o push ainda está **desligado**: nenhum `MACUXI_PUSH_ATIVO` chega ao worker (só a demo o ligava).

## Decisão

### 1. Convivência dos dois tokens, tipo pelo formato
- **Expo**: `ExponentPushToken[...]` ou `ExpoPushToken[...]` (regex `^Expo(nent)?PushToken\[.+\]$`, a mesma de hoje).
  **FCM**: qualquer outro texto não vazio, opaco, até 300 caracteres (na prática ~150 a 200).
- Função pura `tipoDoToken(token: string): 'expo' | 'fcm'` em `modules/core/contracts/notificacao.ts` (o app e a API usam a
  mesma), com teste dos dois formatos e dos casos de borda (`ExpoPushToken[]`, com colchetes vazios, não casa a regex e
  cai em `fcm`; o FCM recusa com 400 e o token é limpo, §5).
- **Sem coluna `push_tipo`** e sem migração: o tipo sai do texto. A coluna fica opcional no futuro (banco-dados), só se
  surgir um terceiro tipo ou plataforma.
- **Contrato do registro (combinado com o engenheiro-apps)**: o app v1.0.10+ manda o token FCM **cru** no mesmo
  `PUT`/`POST` de registro que já existe, no mesmo campo `token` do `PushTokenSchema`, `plataforma: 'android'`. O schema já
  aceita os dois formatos: **não muda e não ganha versão nova**. O app troca o `tokenExpoValido` por uma validação que aceita
  os dois (ou usa `tipoDoToken`). O servidor continua guardando um token por aparelho; o token novo substitui o antigo no
  mesmo `dispositivo_id`, como hoje.

### 2. Envio
- `enviarPush` separa os destinos por `tipoDoToken`: os Expo seguem o caminho atual (lote no `exp.host`); os FCM vão um a um
  (o v1 não tem lote) para `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, com
  `Authorization: Bearer <token OAuth>`, o mesmo `TEMPO_LIMITE_MS` por chamada e concorrência pequena (até 5 em paralelo),
  para não prender o lote do despachante (ADR 0007).
- Mensagem FCM:
  ```json
  { "message": {
      "token": "<token>",
      "notification": { "title": "<até 120>", "body": "<até 178, com …>" },
      "android": { "priority": "HIGH", "notification": { "channel_id": "avisos" } },
      "data": { "link": "/m/...", "entidades": "[\"catalogo.produto\"]" } } }
  ```
  - `android.priority: HIGH` sempre (inclusive no silencioso, para acordar o app em segundo plano; RN-CORE-23).
  - **Silencioso** (título e corpo vazios): sem `notification` e sem `android.notification`; só `data`.
  - `data` só aceita valores texto: `link` vai como texto (ausente quando nulo, nunca `"null"`); `entidades` vai como
    **JSON em texto** (`JSON.stringify([...])`). O app faz `JSON.parse` de `data.entidades` quando vier texto e continua
    aceitando o vetor que o Expo entrega.
  - Mesmos cortes de hoje (120 e 178). Nada do conteúdo vai para log.

### 3. Token OAuth sem dependência nova
- JWT RS256 assinado com `node:crypto` (`createSign('RSA-SHA256')` com a `private_key` da conta de serviço): cabeçalho
  `{ alg: 'RS256', typ: 'JWT', kid: private_key_id }`, carga `{ iss: client_email, scope:
  'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }`.
- Troca em `POST https://oauth2.googleapis.com/token` (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`,
  `assertion=<jwt>`, `application/x-www-form-urlencoded`).
- **Cache** em memória do processo até ~5 min antes do `expires_in`; uma troca por vez (promessa compartilhada). Um 401 do
  FCM descarta o cache e tenta uma vez de novo.
- Nenhuma biblioteca do Google (`google-auth-library`, `firebase-admin`): são dependências pesadas para duas chamadas HTTP.
  A função de assinatura e a de troca recebem `agora` e `fetcher` para teste puro.

### 4. Credenciais
- `FCM_SERVICE_ACCOUNT_JSON`: o JSON da conta de serviço **em base64, numa linha** (`base64 -w0 conta.json`).
  `FCM_PROJECT_ID`: o ID do projeto do Firebase (não o nome).
- Só no `.env` local e nos secrets. Na produção: secrets `PROD_FCM_SERVICE_ACCOUNT_JSON` e `PROD_FCM_PROJECT_ID` do
  environment `PRODUCAO`. O `producao-publicar.yml` confere que vêm juntos e têm formato válido, e grava
  `/opt/macuxi/push.env` (modo 600) com `FCM_SERVICE_ACCOUNT_JSON`, `FCM_PROJECT_ID` e `MACUXI_PUSH_ATIVO=1`. **Só o worker**
  lê o `push.env` (`compose.yml`); a api não envia push. Sem os dois secrets, o arquivo fica vazio e o push segue
  desligado, como hoje. Nomes em `scripts/deploy/producao/env.modelo`; teste em `scripts/ci/producao-push.test.mjs`.
- **Nunca em log**: nem o JSON, nem a chave, nem o `client_email`, nem o JWT, nem o token OAuth, nem o token do aparelho.
  Erros do Google entram no log só com o status HTTP e o `error.status` do FCM (ex.: `UNREGISTERED`).

### 5. Erros e limpeza do token
- `UNREGISTERED` ou `NOT_FOUND` (HTTP 404), ou HTTP 400 `INVALID_ARGUMENT` cujo detalhe aponta o campo `message.token`:
  limpar o token (`update core.dispositivo set push_token = null, push_plataforma = null where push_token = $1`), sem
  erro para o despachante. O app registra de novo no próximo início.
- 401: renovar o token OAuth e tentar uma vez (§3). 429 e 5xx: erro para o despachante (nova tentativa da outbox, ADR 0007).
  403 (`PERMISSION_DENIED`, API desativada ou papel errado): erro com log de configuração, sem dado pessoal.
- Uma falha de um token não derruba os outros do mesmo evento: o handler conta enviadas, ignoradas e limpas; só relança se
  houver erro de nova tentativa (429/5xx/rede).

### 6. Falha segura
- `MACUXI_PUSH_ATIVO` continua sendo a chave geral. Com ela ligada e **sem** `FCM_SERVICE_ACCOUNT_JSON` ou `FCM_PROJECT_ID`
  (ou com o JSON ilegível), o caminho FCM fica desligado: tokens FCM são ignorados, com um log `push_fcm_desligado` (sem
  token, sem usuário) uma vez por processo, e o Expo segue funcionando.

### 7. Fim do exp.host
- Só quando **nenhum token Expo ativo** existir no banco (`select count(*) from core.dispositivo where push_token ~
  '^Expo(nent)?PushToken\[' and deleted_at is null and bloqueado_em is null` = 0 em todos os tenants), o que acontece depois
  que todos os aparelhos estiverem na v1.0.10+. Até lá a convivência fica.
- Então saem, numa tarefa só: o caminho Expo de `push.ts` (`URL_EXPO_PUSH`, `montarMensagemExpo`, os testes de Expo), o
  `extra.eas.projectId` e o `getExpoPushTokenAsync` do app, e a credencial FCM enviada à Expo (item 19 do inventário).
  Antes disso, um aparelho antigo que sobrar continua recebendo pelo Expo.

### 8. O que o dono do produto cria no Firebase (uma vez)
1. Projeto no Firebase (pode ser o mesmo do `google-services.json` do app, se já houver) e o ID do projeto.
2. No Google Cloud do projeto: ativar a API **"Firebase Cloud Messaging API (V1)"**.
3. Conta de serviço própria do servidor com o papel **"Firebase Cloud Messaging API Admin"** (só ele) e uma chave JSON.
4. Secrets no environment `PRODUCAO` do GitHub: `PROD_FCM_SERVICE_ACCOUNT_JSON` (saída de `base64 -w0 chave.json`) e
   `PROD_FCM_PROJECT_ID`. Depois, apagar a chave baixada do computador.
5. O `google-services.json` do app (engenheiro-apps, build EAS) tem de ser do **mesmo projeto**, senão o FCM recusa o token.

## Alternativas consideradas
- **Continuar no Expo (opção 1)**: rejeitada pelo dono do produto; prende o push à conta da Expo.
- **`firebase-admin` ou `google-auth-library`**: rejeitadas; dependência pesada para duas chamadas HTTP (§3).
- **Coluna `push_tipo`**: adiada; o formato já distingue os dois e evita migração e campo novo no contrato.
- **Contrato de registro novo (`@v2`)**: desnecessário; o `PushTokenSchema` já aceita os dois formatos.

## Consequências
- Uma chamada HTTP por aparelho no FCM (antes, uma por lote). Com até 5 em paralelo e o prazo de 10 s, cabe no lote do
  despachante para as equipes atuais.
- O worker passa a guardar uma chave privada do Google no `push.env`; ela tem só o papel de enviar mensagem.
- O push da produção liga quando os secrets `PROD_FCM_*` existirem e a v1.0.10 for publicada; até lá, segue desligado.
- Testes do modulo-core: casos FCM (mensagem, silencioso, `data` texto, limpeza por 404/400, 401 com renovação, falha
  segura sem secrets) mantendo os de Expo até o §7.

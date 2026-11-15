# Checklist para inativar a conta do Expo

Pedido do dono do produto: R-20261115-010000-alexandre ("quero ... o expo inativado e o firebase rodando 100%"). A decisão é migrar para o Firebase e manter o Expo pago até lá (R-20261114-231500-alexandre). O inventário completo, com os 31 itens, está em `apps/mobile/docs/expo-inventario.md` (branch `nuvem/expo-inventario-engenheiro-apps`).

**Regra:** nenhum agente mexe na conta do Expo. Só o dono do produto inativa, e só quando todos os itens abaixo estiverem marcados.

## 1. Antes de tudo, com a conta ainda ativa (dono do produto)
- [x] Baixar as duas keystores, `campo-producao` e `gestao-producao`, e criar os 8 secrets `ANDROID_KEY*_CAMPO` e `ANDROID_KEY*_GESTAO` no GitHub. Feito em 14/11 às 23h40.
- [x] Criar as variáveis `ANDROID_CERT_SHA256_CAMPO` e `ANDROID_CERT_SHA256_GESTAO` com os fingerprints do expo.dev. Feito em 14/11 às 23h55.
- [x] Guardar o `google-services.json` no secret `GOOGLE_SERVICES_JSON_BASE64`. Feito.
- [ ] Anotar o versionCode atual de cada pacote (`eas build:version:get -p android -e campo-producao` e o mesmo com `gestao-producao`). O build do Actions usa 1000009 na 1.0.9, que é maior.
- [ ] Baixar os APKs que ainda servem: os links `expo.dev/artifacts` morrem com a conta.
- [ ] Conferir quem é dono da organização `macuxifdv` no Expo. Se for só a conta dele, inativar apaga a organização junto.

## 2. Build sem o Expo
- [x] Workflow `android-build.yml` no main (#304).
- [ ] Corrigir o disco cheio no runner (PR de governança, engenheiro-software): liberar espaço e gerar só arm64-v8a e armeabi-v7a.
- [ ] Um build do Actions verde nas duas variantes, com o `conferir assinatura` batendo com os fingerprints.
- [ ] Instalar o APK do Actions por cima do APK do Expo num aparelho. Tem de instalar sem desinstalar e manter a fila do aparelho.

## 3. Push sem o Expo (FCM direto, ADR 0053)
- [x] Secrets `PROD_FCM_SERVICE_ACCOUNT_JSON` e `PROD_FCM_PROJECT_ID` no environment PRODUCAO. Feito em 15/11 às 0h10.
- [ ] PR de governança do FCM (ADR e deploy) e PR do modulo-core (envio) no main. O #305 está sendo dividido em dois.
- [ ] App com `getDevicePushTokenAsync` (branch `nuvem/push-fcm-engenheiro-apps`) no main, no build da v1.0.10.
- [ ] Deploy da v1.0.10 ("aprovo deploy v1.0.10").
- [ ] Teste no aparelho com a v1.0.10: notificação visível, toque abrindo o link e push silencioso, com o app fechado.
- [ ] **Todos os aparelhos em uso na v1.0.10 ou mais nova.** Enquanto houver aparelho com a 1.0.9 ou mais velha, o token dele é do Expo e só o `exp.host` entrega.

## 4. Limpeza no repositório (depois dos itens 2 e 3)
- [ ] Desligar o `eas-build.yml` e apagar o secret `EXPO_TOKEN` (engenheiro-software, governança).
- [ ] Tirar `extra.eas.projectId` e `owner` do `app.config.ts` e o `eas.json` (engenheiro-apps).
- [ ] Tirar o caminho do `exp.host` do `modules/core/api/push.ts` (modulo-core).
- [ ] Ajustar os testes e os docs que citam o EAS (itens 6, 8, 9, 14 e 30 do inventário).

## 5. Inativar (dono do produto)
- [ ] Revogar o `EXPO_TOKEN` no expo.dev.
- [ ] Inativar a conta.

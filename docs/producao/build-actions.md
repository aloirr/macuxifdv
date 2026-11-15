# Build do APK pelo GitHub Actions

O workflow **android build** (`.github/workflows/android-build.yml`) gera o APK do Macuxi Campo e do Macuxi Gestão no próprio GitHub. Ele assina com a mesma chave do EAS, para o APK instalar por cima do que já está nos aparelhos. Nenhum agente toca na chave: só o dono do produto baixa a keystore e cria os secrets.

## 1. Baixar a keystore de cada app (uma vez)

No PC, na pasta `apps/mobile` do repositório, logado na Expo (`npx eas-cli login`):

**Windows (PowerShell)**

```powershell
$env:APP_VARIANT = "campo"
npx eas-cli credentials -p android
```

**Linux/mac**

```bash
APP_VARIANT=campo npx eas-cli credentials -p android
```

1. Escolha o perfil **campo-producao**.
2. Entre em **Keystore: Manage everything needed to build your project** e depois em **Download existing keystore**.
3. Anote num lugar seguro os três dados que o comando mostra: **Keystore password**, **Key alias** e **Key password**.
4. O arquivo `.jks` fica na pasta em que você rodou o comando (`apps/mobile`).
5. Anote o **SHA256 Fingerprint** do resumo das credenciais. Ele também está em expo.dev → projeto → Credentials → Android → `br.com.macuxi.campo`.

Repita com `APP_VARIANT=gestao` e o perfil **gestao-producao** (pacote `br.com.macuxi.gestao`).

Nunca adicione o `.jks` ao git. Apague o arquivo depois do passo 3 desta página.

## 2. Gerar o base64 da keystore

**Windows (PowerShell)**, já copiando para a área de transferência:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\caminho\arquivo.jks")) | Set-Clipboard
```

**Linux:** `base64 -w0 arquivo.jks` · **mac:** `base64 -i arquivo.jks | pbcopy`

Faça o mesmo com o `google-services.json` do Firebase. É o mesmo arquivo da variável `GOOGLE_SERVICES_JSON` do EAS (console do Firebase → Configurações do projeto → Seus apps → Android). Sem ele o APK sai sem notificação push (RN-CORE-23).

## 3. Criar os secrets

No GitHub, abra `aloirr/macuxifdv` → **Settings → Secrets and variables → Actions → New repository secret**. Os nomes precisam ser exatos:

| Secret | Valor |
|---|---|
| `ANDROID_KEYSTORE_BASE64_CAMPO` | base64 do `.jks` do Campo |
| `ANDROID_KEYSTORE_PASSWORD_CAMPO` | Keystore password do Campo |
| `ANDROID_KEY_ALIAS_CAMPO` | Key alias do Campo |
| `ANDROID_KEY_PASSWORD_CAMPO` | Key password do Campo |
| `ANDROID_KEYSTORE_BASE64_GESTAO` | base64 do `.jks` do Gestão |
| `ANDROID_KEYSTORE_PASSWORD_GESTAO` | Keystore password do Gestão |
| `ANDROID_KEY_ALIAS_GESTAO` | Key alias do Gestão |
| `ANDROID_KEY_PASSWORD_GESTAO` | Key password do Gestão |
| `GOOGLE_SERVICES_JSON_BASE64` | base64 do `google-services.json` |

Recomendado: na aba **Variables**, crie `ANDROID_CERT_SHA256_CAMPO` e `ANDROID_CERT_SHA256_GESTAO` com o SHA256 Fingerprint do expo.dev, com ou sem os dois-pontos. Se o APK sair com outra chave, o build fica vermelho.

## 4. Rodar o build

1. Abra **Actions → android build → Run workflow**.
2. Preencha **variante** (ambas, campo ou gestao), **versao** (ex.: `1.0.8`) e **perfil** (`producao`). Deixe **version_code** vazio.
3. No fim, o APK fica em **Artifacts**, na página do run: `Campo-Oficial-v1.0.8` e `Gestao-Oficial-v1.0.8`. O GitHub entrega um `.zip` com o `.apk` dentro e o guarda por 30 dias.

Com o version_code vazio, o número sai da versão: 1.0.8 vira 1000008. Esse número fica acima do contador do EAS, então o APK instala por cima.

Se voltar a gerar pelo EAS depois, suba antes o contador dele para um número maior que o último do Actions:

```bash
npx eas-cli build:version:set -p android --profile campo-producao
npx eas-cli build:version:set -p android --profile gestao-producao
```

## 5. Runner de 4 núcleos

O repositório é privado e de conta pessoal, então o runner padrão (`ubuntu-latest`) tem 2 núcleos. O de 4 núcleos (larger runner) só existe em organização no plano Team ou Enterprise, e todo minuto dele é cobrado.

Quando houver um disponível, crie em **Settings → Secrets and variables → Actions → Variables** a variável `ANDROID_RUNNER` com o label do runner, por exemplo `ubuntu-latest-4-cores`. Não precisa de PR. Para voltar ao padrão, apague a variável.

Tempo estimado por variante, ainda sem medição (as duas variantes rodam em paralelo, e com "ambas" os minutos cobrados dobram):

| Runner | Sem cache | Com cache |
|---|---|---|
| 2 núcleos | 35 a 50 min | 18 a 28 min |
| 4 núcleos | 20 a 30 min | 10 a 16 min |

## 6. Conferir o certificado

O resumo do run mostra o **SHA-256 do certificado** de cada APK. Compare com o SHA256 Fingerprint em expo.dev → Credentials → Android → pacote do app. Se for igual, o APK atualiza por cima do instalado. Se for diferente, o Android recusa a atualização: não distribua esse APK.

No PC também dá para conferir, com o build-tools do Android SDK:

```bash
apksigner verify --print-certs Campo-Oficial-v1.0.8.apk
```

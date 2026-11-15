# Build do app no EAS sem o PC

Para o Alexandre. Gera os builds (ex.: `Campo-Oficial-v1.0.7` / `Gestao-Oficial-v1.0.7`) pelo GitHub Actions.
Os passos (a), (b) e (c) são feitos uma vez só.

## (a) Token da Expo
1. Entre em expo.dev → **Account settings** → **Access tokens** → **Create token**.
2. Dê um nome (ex.: `github-eas-build`) e copie o token. Ele só aparece uma vez.

## (b) Secret no GitHub
1. No repositório do GitHub: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Nome: `EXPO_TOKEN`. Valor: o token do passo (a). **Add secret**.

## (c) Arquivo do workflow
Já instalado em `.github/workflows/eas-build.yml`; nada a fazer.

## (d) Disparar o build
**Actions** → **eas build** → **Run workflow**:
- variante: `ambas`
- perfil: `producao`
- ref: `main`

## (e) Links
- Os links dos builds saem no resumo do run (seção **Builds enviados ao EAS**).
- O APK fica no expo.dev, no link do build, quando o build terminar.

## (f) Se falhar
- "Crie o secret EXPO_TOKEN em Settings → Secrets and variables → Actions": refaça o passo (b).
- Outro erro: veja o log do passo **eas build --no-wait**.

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
1. No repositório do GitHub (web): **Add file** → **Create new file**.
2. Nome do arquivo: `.github/workflows/eas-build.yml`.
3. Cole o conteúdo de `apps/mobile/scripts/eas/eas-build.yml`, inteiro.
4. **Commit changes** → **Commit directly to the main branch**. Na descrição estendida, deixe como último bloco só a linha:
   ```
   Agente: alexandre
   ```
   Sem essa linha o CI de governança recusa o commit.

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

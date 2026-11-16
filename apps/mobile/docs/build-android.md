# Build do APK (Campo e Gestão) pelo GitHub Actions

Workflow `.github/workflows/android-build.yml`, sem conta da Expo (R-20261115-091000-alexandre).

## 1. Disparar
No GitHub: **Actions** → **android build** → **Run workflow**, no branch `main`:

| Input | O que pôr |
|---|---|
| `variante` | `ambas`, `campo` ou `gestao` |
| `versao` | versão do app em X.Y.Z (ex.: `1.0.13`) |
| `perfil` | `producao` (perfil `<variante>-producao` do `apps/mobile/eas.json`, canal Oficial) |
| `version_code` | vazio: sai da versão (`1.0.13` → `1000013`). Preencha só se o aparelho recusar instalar por cima |

## 2. Baixar o APK
No fim do run, seção **Artifacts**: um arquivo por variante, com o nome do build
(ex.: `Campo-Oficial-v1.0.13` e `Gestao-Oficial-v1.0.13`). Fica 30 dias no run.

## 3. Conferir versão e assinatura
- No resumo do run, um bloco por APK: versionName, versionCode, perfil, tamanho e SHA-256 do certificado.
- "igual ao esperado": assinatura de produção confirmada. "sem valor esperado": compare o SHA-256 com o do
  run anterior da mesma variante; se for diferente, não distribua.
- No aparelho: **Perfil**, linha da versão no fim da tela, com o nome do build (ex.: `Campo-Oficial-v1.0.13`).

## 4. Se falhar
- "secrets ausentes": a mensagem lista os secrets da variante que faltam em **Settings** → **Secrets and
  variables** → **Actions**; quem cria é o dono do produto.
- "versão inválida" ou "versionCode inválido": corrija o input e rode de novo.
- Erro no passo **conferir assinatura**: não distribua o APK; a mensagem do passo diz o motivo.
- Outro erro: log do passo vermelho.

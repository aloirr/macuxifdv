# Builds do app com nome e versão (EAS) — passo a passo

> T-0109. Para o Alexandre, no PC (PowerShell), na pasta `C:\macuxifdv\apps\mobile`. Completa o
> `docs/status/eas-build-passo-a-passo.md` (que continua valendo para o primeiro acesso ao EAS).

## O que mudou
Só os perfis de produção ficam no `eas.json`: os de desenvolvimento e preview (demo) saíram.

| Build | Perfil do `eas.json` | Nome (mensagem no EAS, linha da versão no Perfil e arquivo do APK) |
|---|---|---|
| Campo oficial | `campo-producao` | `Campo-Oficial-v1.0.0` |
| Gestão oficial | `gestao-producao` | `Gestao-Oficial-v1.0.0` |

- **Versão (X.Y.Z)**: um lugar só, `apps/mobile/scripts/eas/versao.json`. Vale para as duas variantes e os
  dois perfis. Hoje `1.0.0`. O `app.config.ts`, os scripts e o Perfil leem dali.
- **versionCode do Android**: é do EAS (`appVersionSource: remote` + `autoIncrement` em todos os perfis). Cada build
  pega o número seguinte do servidor da Expo, separado por pacote (`br.com.macuxi.campo` e `br.com.macuxi.gestao`).
  Assim o número **nunca repete nem volta** e o APK novo sempre instala por cima do antigo.
  - Por que não um arquivo no repositório: o número teria de subir num commit a cada build. Com builds saindo do PC e
    da nuvem, dois builds poderiam pegar o mesmo número antes do merge. O contador do EAS é atômico e não precisa de
    commit.
- **Perfil do app**: a linha da versão, no fim da tela, mostra o nome do build (ex.: `Campo-Oficial-v1.0.0`).

## Antes (uma vez)
1. `npm i -g eas-cli`, `eas login` e `eas whoami` (como no passo a passo antigo).
2. Confira o contador do versionCode: `eas build:version:get -p android -e campo-producao` (e `-e gestao-producao`).
   Ele deve estar acima do versionCode do APK instalado nos aparelhos. Se precisar ajustar (só para subir):
   `eas build:version:set -p android -e campo-producao`.

## Gerar um build (o passo do dia a dia)
3. Na pasta `C:\macuxifdv\apps\mobile`:
   - Oficial do Campo: `pnpm eas:build campo oficial`
   - Oficial das duas: `pnpm eas:build ambos oficial`
   - Só ver o comando, sem gerar: acrescente `--simular`. Opções do `eas build` vão depois de `--` (ex.: `-- --no-wait`).
4. O script chama `eas build --platform android --profile <perfil> --message <Nome>`. No painel da Expo, a lista de
   builds mostra a mensagem `Campo-Oficial-v1.0.0`; o versionCode aparece no detalhe do build.

## Baixar o APK
5. O APK fica no expo.dev, no link do build, quando o build terminar.

## Nova versão do app
6. Troque a versão em `apps/mobile/scripts/eas/versao.json` (ex.: `1.1.0`) por um PR do engenheiro-apps. O formato é
   sempre X.Y.Z; fora disso, o `app.config.ts` e os scripts param com erro em vez de gerar nome torto.
7. Gere os builds normalmente (passo 3): os nomes passam a `Campo-Oficial-v1.1.0` etc., e o versionCode continua subindo.

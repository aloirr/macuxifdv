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

## Baixar o APK com o nome certo e publicar com link temporário
5. Baixar o último build terminado do perfil: `pnpm eas:apk campo oficial`
   → salva em `apps/mobile/dist/apk/Campo-Oficial-v1.0.0.apk` (pasta fora do git). Um build específico:
   `pnpm eas:apk --build <id do build>` (o nome vem do perfil e da versão gravados no build).
6. Publicar no bucket privado e gerar o link (vale 72 h; até 168 h com `--validade-horas`):
   `node --env-file=..\..\.env scripts\eas\baixar-apk.mjs campo oficial --publicar`
   → envia para `apk/build-<versionCode>/Campo-Oficial-v1.0.0.apk` e imprime o link temporário (o download já sai com o
   nome `Campo-Oficial-v1.0.0.apk`). Mande esse link para quem vai instalar; depois do prazo ele para de funcionar.

### Bucket (uma vez)
- Crie um bucket **privado** no Object Storage da Magalu Cloud (ou outro compatível com S3) e uma chave de acesso só
  para ele (ler e gravar objetos). Sem acesso público: quem baixa usa o link assinado.
- No `.env` da raiz (nunca no repositório): `MACUXI_APK_S3_ENDPOINT` (ex.: `https://br-se1.magaluobjects.com`),
  `MACUXI_APK_S3_REGIAO` (ex.: `br-se1`), `MACUXI_APK_S3_BUCKET`, `MACUXI_APK_S3_CHAVE`, `MACUXI_APK_S3_SEGREDO`
  e, opcional, `MACUXI_APK_S3_PREFIXO` (padrão `apk`). O script nunca imprime esses valores.
- Publicar pelo GitHub em vez do PC (opcional): `scripts/eas/T-0109-workflow.diff` traz o workflow manual
  `apk — publicar`. Ele mexe em `.github/`, então é governança: só entra com a autorização do Alexandre, que também
  cadastra os segredos no environment `APK_BUCKET` (os cinco acima + `EXPO_TOKEN`).

## Nova versão do app
7. Troque a versão em `apps/mobile/scripts/eas/versao.json` (ex.: `1.1.0`) por um PR do engenheiro-apps. O formato é
   sempre X.Y.Z; fora disso, o `app.config.ts` e os scripts param com erro em vez de gerar nome torto.
8. Gere os builds normalmente (passo 3): os nomes passam a `Campo-Oficial-v1.1.0` etc., e o versionCode continua subindo.

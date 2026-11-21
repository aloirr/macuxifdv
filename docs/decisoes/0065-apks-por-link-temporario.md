# ADR 0065 — APKs do Campo e do Gestão por link temporário do portal

- **Status**: proposta em 2026-11-21.
- **Data**: 2026-11-21 (Manaus)
- **Tarefa**: T-0190 (v1.0.19, item 5). Regra: RN-CORE-67.
- **Autor**: engenheiro-software
- **Origem**: R-20261120-194335-alexandre (item 5) e R-20261120-200027-alexandre (item 5): os APKs passam a ser baixados por link temporário gerado no BKO, igual ao Conector, e não por página pública.
- **Desenho**: `docs/desenho/T-0190.md`. Revê a parte do download do desenho `docs/desenho/v1017-campo-versao-e-marca.md` §2 e estende a ADR 0037.

## Contexto
Desde a v1.0.17, `GET /v1/app/versao` (pública, sem sessão) devolve a última versão de cada variante e o `apk_url`, lido de `APP_<CAMPO|GESTAO>_APK_URL`. Quem tem o endereço baixa o APK sem login, e o endereço não expira.

O Conector já sai por link temporário (ADR 0037):
- o pacote fica num bucket privado;
- a API lê o manifesto `ultimo.json` e assina um GET curto;
- a rota do módulo decide quem pede e audita a geração.

## Decisão
1. **Produtos de pacote:** `PRODUTOS_PACOTE = ['conector', ...VARIANTES_APP]` no SDK (`campo`, `gestao`). O APK fica em `pacotes/<variante>/<arquivo>.apk`, com `pacotes/<variante>/ultimo.json`. São o mesmo bucket, a mesma porta (`ServicoPacotes`, `ctx.pacotes`) e a mesma validade do Conector: 300 s por padrão, de 60 a 900 s (`MACUXI_PACOTES_VALIDADE_S`).
2. **Publicação:** `pnpm --filter api publicar-pacote <campo|gestao> <arquivo.apk> --versao X.Y.Z`, com o tipo `application/vnd.android.package-archive`. Na produção, o workflow manual `apk-publicar.yml` (environment `PRODUCAO`, aprovação a cada execução) baixa o artefato de uma execução do `android-build.yml` e publica no bucket. O `android-build.yml` não muda. O workflow novo vai num PR de governança separado.
3. **Rota do Core:** `POST /v1/core/apps/download` `{ variante }`, ação `app.baixar` (admin; o super-admin entra pelo portal). A licença é conferida no `domain` do Core (RN-CORE-67). Respostas:
   - link de 5 min (máximo 15), no `LinkPacoteSchema` do SDK com a `variante`;
   - 404 `APP_SEM_PACOTE` sem APK publicado;
   - 403 `APP_SEM_LICENCA` sem a licença;
   - 503 `ARMAZENAMENTO_INDISPONIVEL` sem S3, pela porta.

   A auditoria `core.app_download_link` grava a variante, a versão e o arquivo. A URL assinada nunca vai para log nem para a auditoria.
4. **Rota pública sem link do APK, em dois contratos** (ajuste do gerente da sessão fixa, 21/11 01h18: os apps instalados não podem regredir). A API não lê mais `APP_*_APK_URL`. O app novo se distingue pela query, e só por ela:
   - `GET /v1/app/versao?variante=X&contrato=2` (o que o `rotaAppVersao` do SDK monta): `AppVersaoPublicadaV2Schema`, com `variante`, `versao` e `publicada_em`, sem `apk_url`. Nele o `apk_url` é opcional (https) só para ler um servidor antigo.
   - `GET /v1/app/versao?variante=X`, sem `contrato` (apps v1.0.17 e v1.0.18): o `AppVersaoPublicadaSchema` antigo, estrito e com `apk_url` https obrigatório. O `apk_url` passa a ser `https://api.macuxifdv.com.br/v1/app/atualizar?variante=X` (base em `MACUXI_API_URL_PUBLICA`), nunca o APK.
   - `GET /v1/app/atualizar?variante=X`, pública: página HTML de uma linha, "<Macuxi Campo|Macuxi Gestão> X.Y.Z" e "Peça o link de download ao gestor ou ao administrador da empresa.". Não tem link, não lista nem serve arquivo e não leva dado de tenant; CSP `default-src 'none'; style-src 'unsafe-inline'`.
   - `contrato` diferente de `2` é 400 `VALIDACAO`. A query (e não um cabeçalho) mantém o cache `public, max-age=300` separado por contrato sem `Vary`.
   - O `AppVersaoPublicadaSchema` fica `@deprecated` e sai quando nenhum app instalado for anterior à v1.0.19.
5. **App:** com versão nova, o app mostra "Versão X disponível: peça o link ao administrador" e não abre mais o download sozinho.

## Alternativas
- **Manter o `apk_url` público com endereço difícil de adivinhar:** não expira e circula sem controle. Recusada pela decisão do dono do produto.
- **API servindo os bytes do APK (cerca de 100 MB) com sessão:** prende a API e a banda; o bucket já assina GET (ADR 0037). Recusada.
- **Link pedido pelo próprio app:** exige sessão e regra de perfil no aparelho. Fica fora: backlog só com autorização do dono do produto.
- **Responder V2 também aos apps antigos:** eles validam com `apk_url` obrigatório e passariam a mostrar "Não deu para verificar agora". Recusada (regressão).
- **`apk_url` antigo apontando para o portal (`config.`):** exige login de administrador; o vendedor cairia numa tela de entrada sem saber o que fazer. Recusada em favor da página de orientação da API.
- **Cabeçalho ou rota nova para o V2:** cabeçalho pede `Vary` no cache público; rota nova duplica a rota. A query `contrato=2` é o mínimo.
- **Tornar opcional o `apk_url` do `AppVersaoPublicadaSchema` existente:** o `apps/mobile` lê `apk_url` como `string` e o typecheck do PR quebraria antes do PR do app. Por isso a versão nova do contrato é um schema novo (mudança incompatível = nova versão).

## Consequências
- O APK só sai para quem entra no portal com permissão. Cada geração do link fica na auditoria, mas o download em si não, porque vai direto ao bucket (premissa (b) da T-0190).
- O binário é o mesmo para todos os tenants e o link não leva dado de tenant.
- Os apps v1.0.17 e v1.0.18 não regridem: recebem o contrato antigo válido, mostram "Atualizar para X.Y.Z" e o botão abre a página que pede o link ao gestor ou ao administrador. O app novo mostra a versão e pede o link ao administrador, sem abrir nada.
- Operação:
  - autorizar o PR de governança do `apk-publicar.yml`;
  - aprovar cada publicação;
  - no próximo deploy, tirar `APP_*_APK_URL` do ambiente da produção (a API já ignora essa variável).

  Não há secret, bucket nem host novo: `PROD_S3_KEY_ID`/`PROD_S3_SECRET` e o bucket `macuxi-prod`.
- O `APP_<VARIANTE>_VERSAO` continua sendo a fonte da versão pública. Ele é atualizado no deploy, como hoje.

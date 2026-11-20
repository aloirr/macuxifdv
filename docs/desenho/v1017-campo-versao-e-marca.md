# Desenho v1.0.17 (Campo): ocultar a logomarca do Macuxi e "Verificar atualização"

Origem: teste de campo do Campo v1.0.16 (R-20261120-055304-alexandre, 20/11/2026 ~05h50 Manaus), itens 15 e 19.
Dono da plataforma: `engenheiro-software`. Banco: `banco-dados` (migração 0091). Telas: `engenheiro-apps` e `designer-ux`.

## 1. Item 15: ocultar a logomarca do Macuxi (portal › Config)

**Banco (0091, `banco-dados`, outro branch):** `plataforma.tenant.ocultar_marca_macuxi boolean not null default false`;
`plataforma.sa_gravar_ocultar_marca(sid text, tenant uuid, ocultar boolean)` no padrão da `sa_gravar_logo` (só super-admin,
RN-CORE-33, mesma auditoria), que devolve o jsonb da marca; `sa_marca_da_empresa` passa a trazer `ocultar_marca_macuxi`.

**Contratos (`@macuxi/platform-sdk`, `empresa-logo.ts`):**
- `MarcaEmpresaSchema` ganha `ocultar_marca_macuxi: z.boolean()` (todas as rotas da marca e da logo do portal o devolvem).
- `GravarOcultarMarcaMacuxiSchema = { ocultar: boolean }` (estrito) e `rotaOcultarMarcaMacuxi(tenantId)`.
- Parâmetros do Core: chave reservada `empresa_ocultar_marca_macuxi` (`PARAMETRO_EMPRESA_OCULTAR_MARCA`), montada por
  `parametrosDaEmpresa`; o app e o BKO leem com `ocultarMarcaMacuxiDosParametros(parametrosCore)` (só `true` oculta).

**API:**
- `PUT /v1/plataforma/empresas/:tenant_id/marca/ocultar-macuxi` com `{ ocultar }`: só super-admin (403 `PERFIL_SEM_ACESSO`
  com a frase da escrita, 401 sem sessão), 400 `VALIDACAO`, 404 `TENANT_NAO_ENCONTRADO`, 503 `MARCA_INDISPONIVEL` sem a função;
  200 `MarcaEmpresa`, `private, no-store`. Idempotente (o mesmo valor regrava igual).
- O aparelho e o BKO recebem pelo mesmo caminho do nome e da logo (T-0182 §3.1): `GET /v1/me/modulos` e
  `GET /v1/sync/novidades`, parâmetros do Core. Trocar o valor muda o `versao_licencas`, então chega na próxima sincronização.
  Não há rota nova `/v1/me/...`.

**Transição (API antes da 0091):** a leitura do tenant em `licencas.ts` usa `to_jsonb(t) ->> 'ocultar_marca_macuxi'` (sem a
coluna = `null` = `false`; um 42703 derrubaria o login e o `/v1/me/modulos` de todos), e o retorno das `sa_*` sem o campo
vale `false`. O PUT responde 503 até a função existir.

## 2. Item 19: "Verificar atualização" do app

O APK sai do `android-build.yml` (sem loja, sem Expo). A API diz a última versão publicada; o app compara e abre o link.

**Contrato (`@macuxi/platform-sdk`, `app-versao.ts`):** `AppVersaoPublicadaSchema = { variante: 'campo'|'gestao', versao:
'X.Y.Z', apk_url: https, publicada_em: ISO | null }`; `haVersaoNova(atual, publicada)` (numérico; inválida = `false`);
`ROTA_APP_VERSAO`, `rotaAppVersao(variante)`, `CODIGO_SEM_VERSAO`.

**API:** `GET /v1/app/versao?variante=campo|gestao`, pública (sem sessão, sem dado de tenant), `public, max-age=300`.
Configuração do servidor, lida na subida: `APP_CAMPO_VERSAO`, `APP_CAMPO_APK_URL`, `APP_GESTAO_VERSAO`, `APP_GESTAO_APK_URL`
e, opcionais, `APP_CAMPO_PUBLICADA_EM`/`APP_GESTAO_PUBLICADA_EM` (ISO). Variante sem os dois valores, ou com valor fora do
contrato, = 404 `SEM_VERSAO`; variante inválida ou chave a mais na query = 400 `VALIDACAO`.

**No app (`engenheiro-apps`):** sem rede ou 404 = "sem atualização"; `haVersaoNova(versaoDoApp, r.versao)` decide se mostra
a ação de baixar `apk_url`. Publicar uma versão = atualizar as variáveis no servidor depois do build (deploy só com o
"aprovo deploy" do dono do produto).

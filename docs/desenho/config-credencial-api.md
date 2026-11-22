# Desenho — credencial de API separada do Conector e guia da API em PDF (portal `config.`)

> 2026-11-22 · engenheiro-software · v1.0.21, sessão S6 · decisão do dono do produto R-20261121-232500-alexandre (portal `config.` enxuto na v1.0.21).
> Origem: pendência do §10.5 de `docs/design/telas/portal-config-enxuto.md` (aba Integração em dois lados, §10.2). Desenho curto, sem código de produção.

## Resumo da decisão
- **Sem migração.** A credencial de API é um registro de `integracao.conector` com `tipo = 'nuvem'` (o valor já existe no CHECK `conector_tipo_valido` da `0010_integracao.up.sql`, em `TIPOS_CONECTOR` e no Drizzle). A chave continua em `integracao.credencial` (HMAC com pepper), igual à do Conector.
- **Sem rota nova de escrita.** O `POST /v1/integracao/conectores` já aceita `tipo: 'nuvem'`. A única mudança de API é **um filtro opcional `?tipo=`** no `GET /v1/integracao/conectores` (contrato aditivo, sem versão nova).
- **Guia em PDF estático**, gerado na sessão a partir do OpenAPI do Hub e dos textos de `api/openapi/guia-pdf-textos.ts` (comando `pnpm --filter @macuxi/integracao guia-pdf`), guardado no repositório e servido por uma **rota pública** `GET /integracao/v1/guia.pdf`, irmã do `openapi.json`.

## 1. O que existe hoje

| Peça | Onde | Como funciona |
|---|---|---|
| Tabela do Conector | `db/migrations/0010_integracao.up.sql` (`integracao.conector`, linha 44: `tipo text not null default 'conector'`; linha 62: `check (tipo in ('conector','nuvem','arquivo'))`); espelho Drizzle `modules/integracao/db/nuvem.ts` | Um registro por Conector do tenant; `identificador` único no tenant; `ativo`, `recebe_pedidos`, `entidades text[]`, `ips_permitidos inet[]`, `aceita_cancelamento`. RLS por `tenant_id`. |
| Tabela da chave | mesma migração, `integracao.credencial` (linha 85) | `prefixo`, `hash_chave` (64 hex), `versao_pepper`, `escopo` (`integracao.v1`), `papel` (`atual`/`anterior`), `revogada_em/por`, `motivo_revogacao`, `ultimo_uso_em`. FK composta `(tenant_id, conector_id)`. |
| Tipo | `modules/integracao/contracts/bko.ts:24` `TIPOS_CONECTOR = ['conector','nuvem','arquivo']`, `TipoConector`; `ConectorCriar.tipo` (default `'conector'`), `ConectorResumo.tipo` | O `nuvem` existe ponta a ponta (contrato, CHECK, Drizzle, `bko-comum.ts:21`), mas nada o cria hoje. |
| `ROTULO_TIPO` | só no portal: `apps/web/components/portal/aba-integracao.tsx:25` (`conector`, `nuvem` = "Integração em nuvem", `arquivo`) | Rótulo da coluna "Tipo" da tabela única de hoje. (O `ROTULO_TIPO` de `modules/integracao/domain/carga-arquivo.ts:281` e o de `modules/pesquisa` são outra coisa: tipos de coluna/pergunta.) |
| Rotas do portal/BKO | `modules/integracao/api/bko-conectores.ts` (`criarRotasConectores`), montadas em `/v1/integracao/` por `modules/integracao/api/index.ts:68` | `GET conectores` (`monitor.ver`), `POST conectores` (`conector.gerenciar`, 201, devolve `ConectorCriado` com a chave em claro uma vez), `PATCH conectores/:id` (`conector.gerenciar`; `ativo:false` **revoga** todas as chaves do Conector com `motivo_revogacao = 'Conector desativado'`). Todas com `superAdmin: 'aceita'`, `carteira: 'nao_se_aplica'`. |
| Geração e hash | `modules/integracao/api/chave.ts` | `gerarChave()` = `mxc_` + 32 bytes base64url, prefixo = 8 primeiros; `hashDaChave(pepper, chave)` = HMAC-SHA256 em hex; pepper `MACUXI_HUB_CHAVE_PEPPER` (≥ 32 bytes), sem ele 503 `servico_indisponivel` (falha fechada). |
| Regra | `modules/integracao/domain/credencial.ts` (RN-INT-10: uma chave por Conector, escopo `integracao.v1`, só hash, rotação com convivência, recusa genérica) e `verificarTopologiaConectores` (RN-INT-13: cada entidade vem de um só Conector ativo; um só recebe pedidos), conferida dentro da transação depois do `pg_advisory_xact_lock` por tenant → 409 `topologia_conflitante`. |
| Autenticação do Hub | `apps/api/src/conector.ts` + `modules/integracao/api/autenticacao.ts` | `Authorization: Bearer <chave>` + `X-Macuxi-Conector-Id`; licença do módulo no tenant da chave (403 `modulo_inativo`). A versão (`X-Macuxi-Conector-Versao`) ausente **não bloqueia** (`avaliarVersaoConector` → `versao_ilegivel`, `bloqueia: false`). |
| Quem chama do portal | `packages/platform-sdk/src/api.ts:392-396` (ADR 0029, T-0093/ADR 0031) | Com `superAdmin: 'aceita'`, o token do portal do **admin do cliente** vale só na empresa da sessão (`x-macuxi-tenant` igual; senão 403) e entra como o `admin` real do tenant (ação/perfil e licença valem). `conector.gerenciar` = só `admin` (`modules/integracao/manifest.ts:56`). |
| Portal hoje | `aba-integracao.tsx` + `apps/web/lib/portal-rotas.ts` (`ROTAS_PORTAL.conectores = '/integracao/conectores'`, `OPENAPI_HUB`) | Uma tabela de todos os tipos, um formulário com `tipo: 'conector'` fixo, o Conector de arquivo (`CONECTOR_ARQUIVO_PORTAL`, sai pelo §10), link do OpenAPI público via `PROXY_OPENAPI_HUB` (`apps/web/next.config.ts:18,91`). |
| OpenAPI e guia | `modules/integracao/api/openapi/{gerar,guia,gravar,publico}.ts`; `modules/integracao/docs/{openapi-hub-v1.json,guia-api-hub.md}` (819 linhas) | `pnpm --filter @macuxi/integracao openapi` regrava o JSON e os blocos de exemplo do guia; `openapi.test.ts`/`guia.test.ts` cobram deriva. Rota pública `GET /integracao/v1/openapi.json` (limite 60/min, cache 1 h, ETag). |

## 2. Separar a credencial de API por tipo — sem migração
- **Credencial de API = `integracao.conector` com `tipo = 'nuvem'`** + sua linha em `integracao.credencial`. O ERP chama o Hub (`/integracao/v1`) com a mesma autenticação do Conector (chave + identificador). Nada muda no banco: o CHECK, o default e o Drizzle já cobrem o valor. **Não aciono o banco-dados.**
- Rótulo: "Integração em nuvem" vira irrelevante no portal (cada lado já tem o seu título, §10.2; a coluna Tipo sai). O valor técnico fica `nuvem` (renomear para `api` exigiria migração do CHECK, mudança de contrato e de testes estáticos, sem ganho).
- **"Ou é Conector, ou é API"** já sai de graça da RN-INT-13: se o Conector ativo tem as 8 entidades e recebe pedidos, a credencial de API cai no 409 `topologia_conflitante` (e vice-versa). O portal manda `entidades` = as livres (`entidadesLivres`, já existe) e mostra a mensagem do 409.
- **Ajustes do módulo (sem banco):**
  1. `avaliarSaudeConector` (`modules/integracao/domain/monitor.ts:19`): para `tipo = 'nuvem'` não há sinal de vida; a saúde passa a ser `desativado` se inativo, senão `ok` (opcional: `nunca_conectou` enquanto `credencial.ultimo_uso_em` for nulo). Sem isso, o monitor do BKO e os alertas acusam `sem_sinal`/`nunca_conectou` para toda credencial de API. Teste no domain citando RN-INT-10/RN-INT-13.
  2. Política de versão: não se aplica a `nuvem` (`situacao_versao = 'sem_politica'` no resumo). Hoje já não bloqueia sem cabeçalho; só o rótulo do monitor muda.

## 3. Rotas do portal
Todas em `/v1/integracao/` (rotas de módulo, `x-macuxi-tenant` obrigatório, `superAdmin: 'aceita'`, `carteira: 'nao_se_aplica'`). Licença do módulo `integracao` no tenant verificada pela plataforma (403 `MODULO_INATIVO`, RN-CORE-02). Isolamento: `ctx.comTenant` (RLS) + `where tenant_id = $1` já presentes; o admin do cliente só alcança a empresa da sessão (ADR 0031).

| Ação | Método e caminho | Ação/perfil | Mudança |
|---|---|---|---|
| Listar só as de API | `GET /v1/integracao/conectores?tipo=nuvem` | `monitor.ver` (admin, analista) | **Nova query opcional** `tipo` (`ConectoresQuery`); sem ela, devolve todos como hoje (BKO não muda). O lado esquerdo do portal usa `?tipo=conector`. Nunca devolve chave, hash nem prefixo de outro tenant (só `ChaveResumo` do próprio). |
| Criar | `POST /v1/integracao/conectores` com `{ tipo: 'nuvem', conector_id, nome, recebe_pedidos, entidades }` | `conector.gerenciar` (só admin) | Nenhuma. 201 `ConectorCriado`; **a chave em claro só nesta resposta** (`ChaveConectorCriada.chave`), nunca em listagem, log ou auditoria (a auditoria grava só identificador/entidades/pedidos). |
| Revogar | `PATCH /v1/integracao/conectores/:id` com `{ ativo: false }` | `conector.gerenciar` | Nenhuma (padrão existente: desativar revoga as chaves; reativar exige chave nova). O §10.2 não pede botão de revogar no portal; fica disponível no BKO. |

**Coordenação com a S10:** a sessão S10 está acrescentando `POST /v1/integracao/conectores/:id/chave` (gerar nova chave de um Conector existente) em `modules/integracao/api/bko-conectores.ts`. A credencial de API (`tipo = 'nuvem'`) usa essa mesma rota para gerar nova chave; nada de rota própria. Quem mexer em `bko-conectores.ts` nesta versão parte do que a S10 entregar.

Erros (corpo `ErroApi`, ADR 0008): 400 Zod (`identificador` fora de `ConectorIdentificador`, `tipo` fora da lista); 401 `NAO_AUTENTICADO` sem sessão; 403 `PERFIL_SEM_ACESSO` (perfil sem `conector.gerenciar` ou tenant diferente da sessão do portal) ou `MODULO_INATIVO`; 404 `CONECTOR_NAO_ENCONTRADO` (PATCH de id de outro tenant cai aqui, sem revelar existência); 409 `conector_ja_existe` (identificador repetido no tenant, inclusive entre Conector e API: o espaço de identificadores é um só) e 409 `topologia_conflitante` (RN-INT-13, com `conflitos`/`entidades_livres`); 422 `RN-INT-10` (IP inválido); 503 `servico_indisponivel` (sem pepper).

Decisão: **não** criar `/credenciais-api` à parte — seria a mesma tabela, a mesma geração e a mesma revogação em dois lugares (uma informação, um lugar). O filtro é a menor mudança e compatível.

## 4. Contrato Zod
- Arquivo: `modules/integracao/contracts/bko.ts` (exportado por `contracts/index.ts`).
- **Novo** (aditivo, sem versão nova nem ADR): `export const ConectoresQuery = z.object({ tipo: TipoConector.optional() }); export type ConectoresQuery = z.infer<typeof ConectoresQuery>;` — usado como `query` na rota `listar` de `bko-conectores.ts`.
- Reusados sem mudança: `ConectorCriar` (com `tipo: 'nuvem'`), `ConectorCriado`, `ChaveConectorCriada` (`contracts/conector.ts`), `ConectorResumo`, `ChaveResumo`, `ConectorAtualizar`, `TipoConector`.
- Nenhum evento novo. `.coord/contratos/` não muda (é contrato de rota BKO, não evento/extensão).

## 5. Guia da API em PDF
**Recomendação: PDF estático gerado na sessão e versionado; nada gerado na hora.** Gerar na hora exigiria navegador headless no servidor (pesado, frágil, sem ganho: o guia só muda com o Hub).

- **Fonte:** o OpenAPI do Hub (`gerarOpenApiHub`, de `api/openapi/gerar.ts`, com os exemplos já testados) + os textos do guia em `modules/integracao/api/openapi/guia-pdf-textos.ts`. O `guia-api-hub.md` não entra no PDF. A referência completa continua sendo o `openapi.json`.
- **Gerador:** `modules/integracao/api/openapi/gravar-pdf.ts` (script, não roda em produção), pelo comando `pnpm --filter @macuxi/integracao guia-pdf`. Monta o HTML com as funções puras de `api/openapi/guia-pdf.ts` e imprime em PDF A4 pelo Chromium do Playwright (`page.pdf()`). Saída: `modules/integracao/docs/guia-api-hub.pdf`.
- **Dependência:** nenhuma nova (o Playwright já existe no repositório). Sem ADR.
- **Deriva:** o gerador grava o SHA-256 do HTML de entrada em `modules/integracao/docs/guia-api-hub.pdf.sha256`; um teste (`guia-pdf.test.ts`, sem navegador) recalcula o HTML e compara. Mudou o OpenAPI ou um texto sem regerar o PDF → teste vermelho. O CI não precisa do Chromium.
- **Rota:** pública, sem token (o guia é documentação pública, como o OpenAPI, ADR 0030): `GET /integracao/v1/guia.pdf`, em `rotasPublicas` de `modules/integracao/api/index.ts`, limite 60/min, cache 1 h + ETag, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename=macuxi-guia-api-v1.pdf`, `X-Content-Type-Options: nosniff`. O arquivo é lido uma vez na subida (Buffer em memória).
- **Plataforma (meu):** hoje `RotaPublica` com `cache` só devolve JSON e `TIPOS_CONTEUDO_ROTA` não tem PDF. Mudança em `packages/platform-sdk/src/api.ts` (e montagem em `apps/api`): `RotaPublica.tipoConteudo?: 'application/pdf'` + `nomeArquivo`, `executar` podendo devolver `Buffer`, ETag sobre os bytes, sempre `attachment`. Aditivo, com teste.
- **Portal:** `OPENAPI_HUB` ganha o irmão `GUIA_PDF_HUB = { rotaNaApi: '/integracao/v1/guia.pdf', viaProxy: '/api-proxy/_publico/integracao/v1/guia.pdf' }` e o rewrite no `next.config.ts`; o botão "Baixar o guia (PDF)" usa `baixarDocumentoPublico`. API e portal saem na mesma versão (v1.0.21), então o botão aparece sempre; se a rota responder 404 (servidor antigo), vale a constante única "Ainda não disponível neste servidor." (§0, RD-0288) — **pergunta ao designer-ux:** aceita isso no lugar de "o botão não aparece" do §10.2, para não sondar a rota a cada abertura?
- **Layout:** o modulo-integracao manda o PDF ao designer-ux para revisão (§10.5) e o design-de-marca valida (cor/layout do PDF, regra da Definição de pronto).

## 6. Divisão por dono e horas

| # | Dono | Arquivos | O quê | Horas |
|---|---|---|---|---|
| 1 | modulo-integracao | `modules/integracao/contracts/bko.ts` (+ teste) | `ConectoresQuery` | 0,5 |
| 2 | modulo-integracao | `modules/integracao/api/bko-conectores.ts` (+ teste) | filtro `?tipo=` no `listar` | 1 |
| 3 | modulo-integracao | `modules/integracao/domain/monitor.ts` (+ teste RN), `api/bko-comum.ts` | saúde e versão de `nuvem` sem sinal | 1,5 |
| 4 | modulo-integracao | `modules/integracao/api/openapi/{guia-pdf,guia-pdf-textos,gravar-pdf}.ts` (+ `guia-pdf.test.ts`), `docs/guia-api-hub.pdf`, `docs/guia-api-hub.pdf.sha256`, `package.json` (script `guia-pdf`), `api/guia-pdf-rota.ts` e `api/index.ts` (rota pública), `docs/modulos/integracao/hub-api.md` | gerador, PDF, rota | 5 |
| 5 | engenheiro-software | `packages/platform-sdk/src/api.ts` (+ teste), montagem em `apps/api/src/app.ts` se preciso | rota pública binária PDF | 2 |
| 6 | engenheiro-apps | `apps/web/components/portal/aba-integracao.tsx`, `apps/web/lib/portal-rotas.ts` (`GUIA_PDF_HUB`), `apps/web/next.config.ts` (rewrite), `apps/web/lib/portal-falso.ts`, testes do portal | lado direito: `POST` com `tipo:'nuvem'`, lista `?tipo=nuvem`, lado esquerdo `?tipo=conector`, botão do guia | 3 |
| 7 | designer-ux / design-de-marca | `docs/design/telas/portal-config-enxuto.md` (fechar a pendência do §10.5 e a pergunta do botão) | revisão do layout do PDF e da tela | 1,5 |
| 8 | testes | `tests/` (e2e do portal: criar credencial de API, 409 com o Conector cobrindo tudo, tenant alheio = 404/403, chave só uma vez, download do PDF) | roteiro e testes | 2 |
| 9 | corretor-redundancias | parecer sobre tela e PDF | — | 1 |

Total ≈ 17,5 h. Ordem: 5 e 1–3 em paralelo → 4 → 6 → 7, 8, 9.
**Banco-dados:** nada (sem migração). **Governança** (`.github/**`, `.claude/**`, `.coord/donos.json`, `scripts/coord*.mjs`): **nenhum arquivo** precisa mudar. A geração do PDF roda na sessão (Chromium do Playwright instalado com `pnpm exec playwright install chromium`); o CI só roda o teste de deriva.

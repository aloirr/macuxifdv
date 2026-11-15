# T-0182 — Logo do cliente e nome fantasia: desenho técnico

> 2026-11-15 · engenheiro-software · tarefa `.coord/tarefas/T-0182.md` (número provisório; migração provisória 0082).
> Spec aprovada: `docs/design/telas/logo-cliente.md` (branch `nuvem/logo-cliente-designer-ux`, d832bc4a). Decisões do dono
> do produto R-20261114-223500 e R-20261114-234500. Este desenho decide onde os dados ficam, as rotas, como o app recebe e
> quem faz o quê. Nada de armazenamento novo, nada de dependência nova.

## 1. Onde ficam

### 1.1 Decisão
- **Bytes:** na porta que a plataforma já usa (`ArmazenamentoArquivos`, `apps/api/src/arquivos.ts`; disco em dev/CI, S3 em
  produção, `armazenamento-s3.ts`). Chave no formato fechado que já existe:
  `<tenant_id>/plataforma/<aaaa-mm>/<logo_id>.<png|jpg>`. `logo_id` = UUID gerado pela API a cada envio (não é dado do
  aparelho). O `CHAVE_ARQUIVO_RE` do branch T-0174 já aceita `.png`; se a T-0174 ainda não estiver no `main` quando as rotas
  forem feitas, o mesmo ajuste entra no PR das rotas (mesmo dono).
- **Metadados e nome fantasia:** colunas novas em `plataforma.tenant` (não em `plataforma.arquivo`: lá `enviado_por` é FK
  para `core.usuario`, e o super-admin do portal não é usuário do tenant). Motivos: a logo é atributo do tenant (1 por
  empresa); o `macuxi_app` já tem `select` em `plataforma.tenant` com RLS (`isolamento_tenant`, 0001), então a API lê junto
  com o fuso (`lerTenant`, `apps/api/src/licencas.ts`) sem função nem grant novo.

### 1.2 Migração 0082 (banco-dados) — `0082_plataforma_tenant_logo`
Aditiva; nenhuma coluna existente muda.

| Coluna | Tipo | Regra (CHECK) |
|---|---|---|
| `nome_fantasia` | `text null` | sem espaço nas pontas, não vazio, até 80 caracteres |
| `logo_id` | `uuid null` | — |
| `logo_tipo` | `text null` | `image/png` ou `image/jpeg` |
| `logo_sha256` | `text null` | `^[0-9a-f]{64}$` |
| `logo_tamanho_bytes` | `integer null` | 1 a 1048576 |
| `logo_largura_px` | `integer null` | 1 a 4096 |
| `logo_altura_px` | `integer null` | 200 a 4096 |
| `logo_chave` | `text null` | começa com `tenant_id::text || '/plataforma/'` |
| `logo_atualizada_em` | `timestamptz null` | — |

- CHECK `tenant_logo_completa`: as 8 colunas `logo_*` todas nulas ou todas preenchidas.
- `nome` continua sendo a razão social. Nenhum índice novo (lida sempre pela PK).

**Funções do portal** (SECURITY DEFINER, `search_path = pg_catalog, plataforma, pg_temp`, EXECUTE só ao `macuxi_portal`;
mesmo molde da 0073 `sa_dados_legais`/`sa_gravar_dados_legais`). Acesso: `sa_sessao_valida(p_sid)`; sem sessão = 28000;
**super-admin** em qualquer tenant; **admin do cliente** só quando `tenant_id` da sessão = `p_tenant` (a spec §2: "quem já
entra na aba Empresa"); senão 42501. Tenant inexistente ou apagado = P0002.

1. `plataforma.sa_marca_da_empresa(p_sid uuid, p_tenant uuid) -> jsonb` — devolve `MarcaEmpresa` (§2.1) **mais**
   `logo.chave` (só a API usa; a rota tira antes de responder).
2. `plataforma.sa_gravar_nome_fantasia(p_sid uuid, p_tenant uuid, p_nome text) -> jsonb` — `null` apaga. Idempotente:
   valor igual não muda a linha nem audita. Valor novo audita `sa.empresa.nome_fantasia` (antes/depois; dado de pessoa
   jurídica) em `plataforma.auditoria_plataforma`. Trava a linha (`for update`). Devolve o mesmo de (1).
3. `plataforma.sa_gravar_logo(p_sid uuid, p_tenant uuid, p jsonb) -> jsonb` — `p` com EXATAMENTE `id, tipo, sha256,
   tamanho_bytes, largura_px, altura_px, chave` (chave a mais/a menos ou tipo errado = 22023; fora dos CHECKs = 23514).
   Idempotente pelo `sha256`: igual ao gravado = nada muda, não audita. Senão grava, `logo_atualizada_em = now()`, audita
   `sa.empresa.logo.gravar` (sha antes/depois, sem bytes). Devolve (1) + `chave_anterior` (texto ou null) para a API apagar
   o objeto antigo.
4. `plataforma.sa_remover_logo(p_sid uuid, p_tenant uuid) -> jsonb` — zera as 8 colunas; idempotente (já sem logo = nada
   muda); audita `sa.empresa.logo.remover`. Devolve (1) + `chave_anterior`.

- **Listagem do portal (`sa_listar_tenants`) não muda.** O nome fantasia e a logo vêm da rota da marca (§2), lida só pelo
  cartão da aba Empresa. Uma informação, um lugar; e a 0071 fica como está.
- A conferência de catálogo das migrações do portal (contagem das `sa_*` executáveis pelo `macuxi_portal`, hoje 17 na 0070)
  passa a 21. Atenção (lição da 0070): `apps/api/test/funcoes-sa.ts` e `scripts/deploy/producao/banco-dbaas.sh` (meus), `db/testes/funcoes-sa.ts` e
  `db/src/excecoes.ts` (banco-dados) leem a
  lista; a migração e esses dois arquivos vão **no mesmo lote** (PR único autorizado pelo dono do produto), senão o CI cai.
- Teste `db/testes/tenant-logo.db.test.ts`: CHECKs, tudo-ou-nada, idempotência, auditoria, admin do cliente de outro
  tenant = 42501, `macuxi_app` do tenant B não lê a logo do tenant A (RLS).

## 2. Rotas do portal `config.` (`apps/api/src/empresa-logo.ts`, novo)

Constantes e contratos em `packages/platform-sdk/src/empresa-logo.ts` (novo; exportado no `index.ts`).

### 2.1 Contratos (Zod)
```ts
EmpresaLogoSchema = z.object({ sha256, tipo: z.enum(['image/png','image/jpeg']), tamanho_bytes, largura_px, altura_px,
  atualizada_em: Instante }).strict()
MarcaEmpresaSchema = z.object({ tenant_id, razao_social, nome_fantasia: z.string().nullable(),
  logo: EmpresaLogoSchema.nullable() }).strict()
GravarNomeFantasiaSchema = z.object({ nome_fantasia: z.string().trim().max(80).transform(v => v || null).nullable() }).strict()
LIMITES_LOGO = { bytes: 1_048_576, alturaMinPx: 200, ladoMaxPx: 4096, tipos: ['image/png','image/jpeg'] }
CODIGOS_LOGO = { formato: 'LOGO_FORMATO', grande: 'LOGO_GRANDE_DEMAIS', altura: 'LOGO_ALTURA_MINIMA',
  lado: 'LOGO_LADO_MAXIMO', naoEncontrada: 'LOGO_NAO_ENCONTRADA' }
MENSAGENS_LOGO  // as frases da spec §2, uma constante por código (o portal mostra a `mensagem` da resposta)
nomeDaEmpresa(nomeFantasia, razaoSocial)  // "Licenciado para <x>": fantasia; vazia → razão social (spec §5)
```

### 2.2 Rotas
Todas com `exigirPortal` (`portal-comum.ts`), `tenant_id` da URL validado (UUID), admin do cliente só o da sessão (403
`PERFIL_SEM_ACESSO` antes de chamar o banco; a função confere de novo) e `traduzirErroSa`.

| Método e caminho | Corpo | Resposta |
|---|---|---|
| `GET /v1/plataforma/empresas/:tenant_id/marca` | — | 200 `MarcaEmpresa` |
| `PUT /v1/plataforma/empresas/:tenant_id/marca` | JSON `GravarNomeFantasia` | 200 `MarcaEmpresa` |
| `GET /v1/plataforma/empresas/:tenant_id/logo` | — | 200 bytes (`Content-Type` gravado, `ETag` = sha256, `Cache-Control: private, no-store`); sem logo = 404 `LOGO_NAO_ENCONTRADA` |
| `PUT /v1/plataforma/empresas/:tenant_id/logo` | **bytes crus** `image/png` ou `image/jpeg` (sem multipart, como `PUT /v1/arquivos/:id`) | 200 `MarcaEmpresa` |
| `DELETE /v1/plataforma/empresas/:tenant_id/logo` | — | 200 `MarcaEmpresa` |

- **Pré-visualização:** antes de salvar, o portal mostra o arquivo local (`URL.createObjectURL`). A logo salva vem do `GET
  .../logo` (com o token do portal) e vira `blob:` para o `<img>`.
- **PUT da logo, no servidor** (nessa ordem; autenticação no `onRequest`, antes de receber o corpo, como em `arquivos.ts`):
  1. `Content-Type` fora de png/jpeg → **415 `LOGO_FORMATO`**;
  2. corpo acima de 1 MiB (`bodyLimit`) → **413 `LOGO_GRANDE_DEMAIS`**;
  3. assinatura (`detectarTipoImagem`, `packages/platform-sdk/src/imagens.ts` da T-0174) diferente do `Content-Type`, ou
     ilegível no decodificador (`apps/api/src/decodificadores.ts` da T-0174, que já confere o teto de megapixels antes de
     alocar) → **422 `LOGO_FORMATO`**;
  4. altura < 200 px (`dimensoesImagem`) → **422 `LOGO_ALTURA_MINIMA`**; maior lado > 4096 px → **422 `LOGO_LADO_MAXIMO`**
     (protege o aparelho e o PDF de imagem gigante: 1 MB de PNG pode declarar 20.000 px);
  5. grava o objeto novo → `sa_gravar_logo` → apaga `chave_anterior` (melhor esforço; falha só vai a log). Se o banco falhar,
     apaga o objeto novo. Mesmo sha256 da atual = 200 sem gravar nada (idempotente).
- **DELETE:** `sa_remover_logo` → apaga `chave_anterior` (melhor esforço).
- Sem armazenamento configurado → 503 `ARMAZENAMENTO_INDISPONIVEL` (o mesmo de `arquivos.ts`).
- Log pino: `tenant_id`, `request_id`, tamanho, tipo, dimensões e tempo. Nunca bytes nem nome do arquivo.

### 2.3 Mensagens no portal (frases exatas da spec §2)

| Situação | Código / status | Frase |
|---|---|---|
| formato | 415 ou 422 `LOGO_FORMATO` | "Use um arquivo PNG ou JPG." |
| tamanho | 413 `LOGO_GRANDE_DEMAIS` | "O arquivo passa de 1 MB. Envie um menor." |
| altura | 422 `LOGO_ALTURA_MINIMA` | "A imagem tem menos de 200 px de altura. Envie uma maior." |
| lado máximo | 422 `LOGO_LADO_MAXIMO` | **proposta:** "A imagem passa de 4096 px. Envie uma menor." (designer-ux confirma o texto) |
| rota ausente | 404 de rota (`ehRotaAusente`) | "Ainda não disponível neste servidor." (constante RD-0288) |
| qualquer outro erro (rede, 5xx, 503) | — | "Não foi possível salvar. Tente de novo." |

O portal confere tipo, tamanho e altura **antes de enviar** (mesmas `LIMITES_LOGO`, altura pelo `Image` do navegador) e
mostra a mesma frase; o servidor revalida sempre.

## 3. Como o app recebe e guarda

### 3.1 Pelos parâmetros do Core (sem contrato novo do modulo-core)
`parametrosParaAparelho('core', …)` (`apps/api/src/me-modulos.ts`) passa a injetar duas chaves reservadas, lidas da linha do
tenant em `lerTenant` (`licencas.ts`, junto do fuso):
- `empresa_nome`: `nomeDaEmpresa(nome_fantasia, nome)` (fantasia; vazia → razão social);
- `empresa_logo`: `{ sha256, tipo, largura_px, altura_px } | null`.

Por quê: os parâmetros já chegam pelo `GET /v1/me/modulos` e pelo `GET /v1/sync/novidades`; o `versao_licencas` é o hash
dos módulos com os parâmetros, então **trocar a logo ou o nome muda a versão e o aparelho recebe na próxima sincronização**
sem nada novo no motor; e o motor já guarda os parâmetros no aparelho (offline). `MeusModulosRespostaSchema`
(`modules/core/contracts/modulos.ts`, modulo-core) **não muda** (parâmetros são `record`). As chaves e o
`EmpresaDoAparelhoSchema` + `empresaDosParametros(parametrosCore)` ficam em `packages/platform-sdk/src/empresa-logo.ts`.
Uma linha em `plataforma.parametro` com o mesmo nome é sobrescrita pela API (chave reservada, teste).

### 3.2 Bytes para o aparelho
`GET /v1/me/empresa/logo/:sha256` (rota de plataforma, sessão do app, tenant do token; módulo Core, sempre ativo):
devolve os bytes se `:sha256` for o atual do tenant; senão 404 `LOGO_NAO_ENCONTRADA` (o aparelho nunca guarda logo velha).
`Cache-Control: private, max-age=31536000, immutable` (o endereço muda com o sha).

### 3.3 Cópia no aparelho (shell, engenheiro-apps)
- Depois de cada `aplicarModulosAtivos`/sync: se `empresa_logo.sha256` ≠ o guardado, baixa, confere o tamanho, grava em
  `<documentos>/empresa/<tenant_id>/logo-<sha256>.<png|jpg>`, guarda `{ tenant_id, sha256, tipo, caminho }` e apaga a
  anterior. `empresa_logo = null` → apaga. Falha no download → mantém o que tinha e tenta na próxima sync.
- **Carga** (variação A): só quando há cópia guardada **e** o `tenant_id` dela é o da empresa do último login (logo de um
  tenant nunca aparece em outro; troca de empresa/sair apaga a pasta do tenant anterior).
- **Mais:** frase com `empresa_nome`; placa só com a cópia guardada.
- **PDF:** `AmbienteAparelho.logoDaEmpresa?: () => Promise<string | null>` (novo, opcional, em
  `packages/platform-sdk/src/ambiente.ts`) devolve a cópia como data URI (`data:image/png;base64,…`); `null` = sem logo.
  O shell mobile lê o arquivo guardado; o shell web (BKO, sempre online) busca o `GET /v1/me/empresa/logo/:sha256` com a
  sessão e converte. O módulo nunca sabe onde o arquivo está.

## 4. Quem faz, em ordem

**Etapa 1 (em paralelo, depois deste desenho):**
- **banco-dados** — `db/migrations/0082_plataforma_tenant_logo.{up,down}.sql`, `db/esquema/plataforma.ts`,
  `db/testes/tenant-logo.db.test.ts`, `db/testes/funcoes-sa.ts`, `db/src/excecoes.ts`, `db/testes/estatico.test.ts` (se listar funções), `docs/banco/plataforma.md`,
  `docs/banco/rls.md`. Down: apaga as 4 funções e as 9 colunas (perde as logos: os objetos ficam órfãos no armazenamento).
- **engenheiro-software** — `packages/platform-sdk/src/empresa-logo.ts` (+ teste), `src/index.ts`, `src/ambiente.ts`
  (`logoDaEmpresa?`), e o ajuste do `CHAVE_ARQUIVO_RE` se a T-0174 não tiver entrado. Primeiro o SDK, porque os outros
  importam dele.
- **designer-ux** — placa em `packages/ui` (mobile): `PlacaLogo` com tamanhos `carga` (64/48, até 112×96) e `mais` (52/36,
  até 176×152), prop `borda`, `contain`, `accessibilityLabel` opcional (§1 da spec). Só visual, sem I/O. Confirma a frase de
  `LOGO_LADO_MAXIMO`.
- **modulo-vendedor** — `modules/vendedor/domain/pdf-pedido.ts`: CSS da `.logo` (spec §6), comentário do `logo_src`
  atualizado, teste em `pdf-pedido.test.ts` (logo larga, quadrada, vazia = padrão).

**Etapa 2 (depende do SDK; a migração pode estar só no branch):**
- **engenheiro-software** — `apps/api/src/empresa-logo.ts` (rotas §2.2 e §3.2), registro em `apps/api/src/app.ts`,
  `apps/api/src/licencas.ts` e `me-modulos.ts` (§3.1), `apps/api/test/empresa-logo.test.ts` (validações, idempotência,
  admin do cliente de outro tenant = 403, tenant A × B), `apps/api/test/funcoes-sa.ts` e `scripts/deploy/producao/banco-dbaas.sh` (21
  funções). Vai no mesmo PR único da 0082 (lição da 0070).
- **modulo-vendedor** — `modules/vendedor/app/screens/order-detail-screen.tsx`: `logo_src: await ambiente.logoDaEmpresa?.()`;
  `modules/vendedor/web/components/orders/exportar-pdf.ts`: `ctx.logo_src` (quem chama passa o valor do ambiente web).

**Etapa 3 (depende da etapa 2 e da placa):**
- **engenheiro-apps** — portal: `apps/web/components/portal/tela-empresa.tsx` (cartão "Logo" primeiro na aba Empresa, os 6
  estados, campo nome fantasia), componente novo `apps/web/components/portal/cartao-logo.tsx` (+ teste),
  `apps/web/lib/portal-rotas.ts`; BKO: `logoDaEmpresa` no ambiente web. Mobile: cópia no aparelho (`apps/mobile/src/lib/`
  arquivo novo, ex. `logo-empresa.ts`, + teste), `logoDaEmpresa` no ambiente, carga (`apps/mobile/src/app/sync.tsx` e o que
  ela usa; MC-0088 na linha "Etapa n de N"), Mais (`apps/mobile/src/app/(tabs)/mais.tsx`).

**Etapa 4:** testes (`tests/`: tenant A × B ponta a ponta, critérios 1–5) · corretor-redundancias · design-de-marca (prints
de Campo, Gestão, portal e PDF) · engenheiro-software (revisão final).

**modulo-core:** nada nesta tarefa (o contrato dele não muda, §3.1).

## 5. Premissas
1. Admin do cliente grava a logo e o nome fantasia da própria empresa (spec §2, aprovada). A RN-CORE-33 diz que alterar
   empresa é do time da Macuxi; marca não é dado cadastral (CNPJ, código, módulos) — o gerente confirma com o dono do
   produto; se ele disser "só a Macuxi", basta trocar o teste de acesso nas 3 funções de escrita.
2. O teto de 4096 px de lado é meu (não está na spec); a frase dele precisa do designer-ux.
3. Depende da T-0174 (`imagens.ts`, `decodificadores.ts` e o `CHAVE_ARQUIVO_RE` com `.png`). Se a T-0174 atrasar, as rotas
   trazem só o reconhecimento de PNG que faltar, sem duplicar o que vem lá.
4. Sem evento novo (nenhum módulo reage à troca da logo) e sem entidade de sync nova.

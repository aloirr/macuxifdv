# T-0182 — Logo do cliente e nome fantasia: desenho técnico

> 2026-11-15 · engenheiro-software · tarefa `.coord/tarefas/T-0182.md` (número provisório). Spec: `docs/design/telas/logo-cliente.md`
> (designer-ux). Decisões do dono do produto R-20261114-223500 e R-20261114-234500. Nada de armazenamento nem dependência nova.

## 0. Decisões do gerente-projetos (15/11/2026)
1. Migração **0081** (renumeração final da sessão fixa, 15/11: o `main` vai até a 0080, #352).
2. **Só o super-admin grava** logo e nome fantasia (RN-CORE-33: a empresa é cadastrada só no portal). O admin do cliente só
   lê a da própria empresa; o cartão dele no portal é só leitura.
3. Teto de **4096 px** de lado (protege o aparelho e o PDF: 1 MB de PNG pode declarar 20.000 px). A frase é a da spec §2 (§2.3).

## 1. Onde ficam

### 1.1 Decisão
- **Bytes:** na porta `ArmazenamentoArquivos` (`apps/api/src/arquivos.ts`; disco em dev/CI, S3 em produção). Chave
  `<tenant_id>/plataforma/<aaaa-mm>/<logo_id>.<png|jpg>`; `logo_id` = UUID da API a cada envio. O `CHAVE_ARQUIVO_RE` é
  **o mesmo da T-0174** (aceita também `.webp` e `.pNNN.zip`), para o merge dos dois não conflitar na linha.
- **Metadados:** colunas em `plataforma.tenant` (a logo é atributo do tenant; `plataforma.arquivo.enviado_por` é FK para
  `core.usuario`, e o super-admin não é usuário do tenant). O `macuxi_app` já lê `plataforma.tenant` com RLS, então a API lê
  junto com o fuso (`lerTenant`, `apps/api/src/licencas.ts`).

### 1.2 Migração 0081 (banco-dados) — `0081_plataforma_tenant_logo`
Aditiva. Colunas (todas `null`): `nome_fantasia` (aparado, não vazio, até 80), `logo_id` uuid, `logo_tipo` (png|jpeg),
`logo_sha256` (`^[0-9a-f]{64}$`), `logo_tamanho_bytes` (1 a 1048576), `logo_largura_px` (1 a 4096), `logo_altura_px` (200 a
4096), `logo_chave` (começa com `<tenant_id>/plataforma/`), `logo_atualizada_em`. CHECK: as 8 `logo_*` todas nulas ou todas
preenchidas. `nome` continua sendo a razão social.

Funções (SECURITY DEFINER, EXECUTE só ao `macuxi_portal`, molde da 0073). Sessão por `sa_sessao_valida` (sem sessão = 28000);
tenant inexistente = P0002; fora do acesso = 42501.

| Função | Quem | Faz |
|---|---|---|
| `sa_marca_da_empresa(sid, tenant)` | super-admin; admin do cliente só na empresa da sessão | `MarcaEmpresa` + `logo.chave` (só a API usa) |
| `sa_gravar_nome_fantasia(sid, tenant, nome)` | só super-admin | `null` apaga; igual = nada muda; audita `sa.empresa.nome_fantasia` |
| `sa_gravar_logo(sid, tenant, jsonb)` | só super-admin | jsonb com exatamente `id, tipo, sha256, tamanho_bytes, largura_px, altura_px, chave` (22023/23514); mesmo sha = nada muda; audita `sa.empresa.logo.gravar`; devolve + `chave_anterior` |
| `sa_remover_logo(sid, tenant)` | só super-admin | zera as 8 colunas; idempotente; audita `sa.empresa.logo.remover`; devolve + `chave_anterior` |

A interna `plataforma.marca_da_empresa_json(uuid)` (INVOKER, sem EXECUTE) monta o jsonb. **Down:** apaga as **5 funções** (as
4 `sa_*` e a `marca_da_empresa_json`) e as 9 colunas; os objetos das logos ficam órfãos no armazenamento.
`sa_listar_tenants` não muda: nome fantasia e logo vêm só da rota da marca.

**Lista das `sa_*` (RD-0910): uma fonte só**, `FUNCOES_SA_ATUAIS` e `SA_INTERNA` em `db/testes/funcoes-sa.ts` (banco-dados;
31 depois da 0081). `apps/api/test/funcoes-sa.ts` só a reexporta com o tipo; o `banco-dbaas.sh` (passo 6) a lê na imagem da
versão (`node --import tsx`, `LISTAS_SA_JS`), e o `funcoes-sa.test.ts` roda o mesmo comando e confere a saída.

## 2. Rotas (`apps/api/src/empresa-logo.ts`; contratos em `packages/platform-sdk/src/empresa-logo.ts`)

### 2.1 Contratos (SDK)
`EmpresaLogoSchema`, `MarcaEmpresaSchema`, `GravarNomeFantasiaSchema`, `Sha256LogoSchema`, `LIMITES_LOGO`, `CODIGOS_LOGO`,
`MENSAGENS_LOGO`, `conferirLogo`, `nomeDaEmpresa`, `LogoDoAparelhoSchema`, `empresaDosParametros` e `proporcaoDaLogo`.

### 2.2 Acesso, rotas e PUT da logo

Leitura com `exigirPortal` (admin do cliente só na empresa da sessão); escrita com `exigirSuperAdmin` (403
`PERFIL_SEM_ACESSO` antes do banco; no PUT da logo, antes de receber o corpo). A função confere de novo.

| Método e caminho | Corpo | Resposta |
|---|---|---|
| `GET /v1/plataforma/empresas/:tenant_id/marca` | — | `MarcaEmpresa` |
| `PUT /v1/plataforma/empresas/:tenant_id/marca` | `GravarNomeFantasia` (vazio apaga) | `MarcaEmpresa` |
| `GET /v1/plataforma/empresas/:tenant_id/logo` | — | bytes, `ETag` = sha256, `private, no-store` |
| `PUT /v1/plataforma/empresas/:tenant_id/logo` | bytes crus `image/png`\|`image/jpeg` | `MarcaEmpresa` |
| `DELETE /v1/plataforma/empresas/:tenant_id/logo` | — | `MarcaEmpresa` |
| `GET /v1/me/empresa/logo/:sha256` | — | bytes da logo **atual** do tenant do token (sha velho = 404); `private, max-age=31536000, immutable` |

- Os dois GETs de bytes usam `enviarBytesDaLogo` (chave do próprio tenant, armazenamento, objeto ausente = 404 com aviso).
- **PUT da logo:** `conferirLogo` (SDK, pura, a mesma no portal e na API; só lê o cabeçalho) → grava o objeto novo →
  `sa_gravar_logo` → apaga `chave_anterior` (melhor esforço). Banco falhou = apaga o novo. Mesmo sha256 da atual = 200 sem gravar.
- Sem armazenamento = 503 `ARMAZENAMENTO_INDISPONIVEL` (`erroArmazenamentoIndisponivel`, de `arquivos.ts`).
- Log: `tenant_id`, `request_id`, tamanho, tipo, dimensões e tempo; nunca bytes nem nome de arquivo.

### 2.3 Recusas e frases (`MENSAGENS_LOGO`, montadas de `LIMITES_LOGO`; o portal mostra a `mensagem` da resposta)

| Código | Status | Frase |
|---|---|---|
| `LOGO_FORMATO` | 415 (tipo) ou 422 (assinatura/cabeçalho) | Use um arquivo PNG ou JPG. |
| `LOGO_GRANDE_DEMAIS` | 413 | O arquivo passa de 1 MB. Envie um menor. |
| `LOGO_ALTURA_MINIMA` | 422 | A imagem tem menos de 200 px de altura. Envie uma maior. |
| `LOGO_LADO_MAXIMO` | 422 | A imagem passa de 4096 px de largura ou altura. Envie uma menor. |
| `LOGO_NAO_ENCONTRADA` | 404 | Esta empresa ainda não tem logo. |

## 3. Como o app recebe e guarda

### 3.1 Parâmetros do Core (contrato do modulo-core não muda)
`parametrosParaAparelho('core', …)` (`me-modulos.ts`) injeta duas chaves reservadas (sobrescrevem `plataforma.parametro` de
mesmo nome): `empresa_nome` = `nomeDaEmpresa(nome_fantasia, nome)` e `empresa_logo` = `LogoDoAparelho | null`
(`{ sha256, tipo, largura_px, altura_px }`). O aparelho lê com `empresaDosParametros`. O `versao_licencas` é o hash dos
módulos com os parâmetros: trocar logo ou nome muda a versão e o aparelho recebe na próxima sincronização (offline depois).

### 3.2 Bytes para o aparelho
`GET /v1/me/empresa/logo/:sha256` (tabela do §2.2): sessão do app, módulo Core; só a logo atual do tenant do token.

### 3.3 Cópia no aparelho (engenheiro-apps)
Baixa só quando o sha256 muda, confere com `conferirLogo`, grava em `<documentos>/empresa/<tenant_id>/logo-<sha256>.<ext>` e
apaga a anterior; `empresa_logo = null` apaga. Falha mantém o que tinha. A tela só usa a cópia do tenant da sessão. PDF:
`AmbienteAparelho.logoDaEmpresa?()` (SDK, `ambiente.ts`) devolve data URI ou `null`; o BKO busca o GET do aparelho.

### 3.4 Contrato da placa (RD-0921)
- **Proporção: uma fonte**, `proporcaoDaLogo(logo)` do SDK (largura_px ÷ altura_px gravados pela API). A placa recebe
  `proporcao: number` obrigatória e não mede a imagem no `onLoad`.
- **Nome:** a placa recebe `nomeEmpresa` (o `empresa_nome`: fantasia ou razão social), não `nomeFantasia`.
- Componente: `PlacaLogoCliente` (`packages/ui`, designer-ux).

## 4. Quem faz
- **banco-dados:** 0081 (up/down), `db/esquema/plataforma.ts`, `db/testes/` (incl. `funcoes-sa.ts`), `docs/banco/`.
- **engenheiro-software:** SDK (`empresa-logo.ts`, `imagens.ts` idêntico ao da T-0174, `ambiente.ts`), rotas, `licencas.ts`,
  `me-modulos.ts`, `funcoes-sa.ts` da API e `banco-dbaas.sh`.
- **designer-ux:** `PlacaLogoCliente` (§3.2) e a spec.
- **engenheiro-apps:** cartão do portal, cópia no aparelho, carga, Mais e `logoDaEmpresa` nos dois shells.
- **modulo-vendedor:** logo no PDF do pedido.
- **testes, corretor-redundancias, design-de-marca, engenheiro-software (revisão).** modulo-core: nada.

## 5. Premissas
1. Sem evento novo e sem entidade de sync nova.
2. A T-0174 não está no `main`: `imagens.ts` (e teste) idênticos ao do branch dela; os decodificadores não vêm (a logo não gera
   miniatura).

## 6. Notas do deploy
- **Todo aparelho recebe `modulos_mudaram` uma vez** depois do deploy (`empresa_nome` entra nos parâmetros do Core e muda o
  `versao_licencas`): uma volta de conferência em todas as entidades, uma vez por aparelho. Depois, o mesmo só acontece nos
  aparelhos do tenant a cada troca de logo ou nome.
- Ordem: a 0081 entra antes (ou junto) das rotas; sem as colunas, o `lerTenant` cai.

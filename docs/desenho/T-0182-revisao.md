# T-0182 — Logo do cliente: revisão final do engenheiro-software

> 2026-11-15 · engenheiro-software · contra o desenho `docs/desenho/T-0182-logo-cliente.md`, a tarefa `.coord/tarefas/T-0182.md`
> (branch `nuvem/logo-cliente-gerente-projetos`) e o CLAUDE.md. Legenda: 🔴 bloqueia · 🟡 corrigir (lote seguinte) · 🟢 ok/sugestão.
> **Renumeração (sessão fixa do gerente-projetos, 15/11):** a migração da logo passa a ser a **0082**; a 0081 ficou com a
> tela de carga (`plataforma_frase_carga`). As citações abaixo já usam 0082 para a logo.
> Registro em `docs/desenho/` (caminho do engenheiro-software; `docs/revisoes/` é do gerente-projetos).

## Branches revisados (diff contra `origin/main` 19d2371a)

| Branch | SHA | Dono |
|---|---|---|
| `nuvem/logo-cliente-banco-dados` | 12e4f610 | banco-dados |
| `nuvem/logo-cliente-engenheiro-software` | 69ad7d4e | engenheiro-software |
| `nuvem/logo-cliente-designer-ux-ui` | 4ff50dac | designer-ux |
| `nuvem/logo-cliente-modulo-vendedor` | d5506130 | modulo-vendedor |
| `nuvem/logo-cliente-engenheiro-apps` | 9cffd4dd (inclui o commit do nome fantasia do admin do cliente) | engenheiro-apps |
| `nuvem/logo-cliente-testes` | 11cd8d4b | testes |

## Integração local (sem push)

`origin/main` + os 6 branches na ordem acima: **nenhum conflito** entre eles.
Na sessão, com o mesmo script do CI:
- typecheck e lint: verdes em `@macuxi/platform-sdk`, `@macuxi/comum`, `api`, `@macuxi/ui`, `@macuxi/vendedor`, `mobile`, `web`
  e `@macuxi/db` (16/16 tarefas; os 13 avisos do `api` já existiam e nenhum é dos arquivos do lote). `typecheck:tests` e o
  eslint de `tests/` também passaram. `pnpm fronteiras`: 0 erros; os 11 avisos já existiam e nenhum é do lote.
- testes: platform-sdk 889, comum 139, ui 428, mobile 566, web 239 (+10 do `cartao-logo` depois do 9cffd4dd),
  vendedor 1372, api 556 (`empresa-logo.test.ts` 20/20, `funcoes-sa.test.ts` 4/4). Única falha no `api`:
  `cli-super-admin.test.ts`, por ambiente (o Node da sessão não tem `crypto.argon2Sync`); já falhava antes do lote.
- **`@macuxi/db`: todos os arquivos caem** com `Numeração de migração com buraco: esperado 0075, achei 0081` (na revisão, a logo ainda era a 0081)
  (`db/src/migrador.ts:62`), inclusive o `estatico.test.ts`, que roda sem banco. Veja o 🔴 1.
- Testes de banco (`*.db.test.ts`) e `tests/integracao` com banco: só no CI (sem Docker).

## 🔴 Bloqueia

1. **Merge da 0082 (logo) sem a 0075–0081 no `main` deixa o `main` vermelho.** Dono: **banco-dados**, com a ordem decidida pelo
   gerente-projetos. Arquivos: `db/migrations/0082_plataforma_tenant_logo.{up,down}.sql` e `db/testes/estatico.test.ts:206`
   (`nomes[80]`). O `main` vai até a 0074. O migrador não aceita buraco (`db/src/migrador.ts:59-62`), então o branch
   `nuvem/logo-cliente-banco-dados` derruba sozinho toda a suíte do `@macuxi/db`, e com ela o CI do PR. Hoje a 0075–0080
   estão em outros branches, com números repetidos:
   - 0075: `catalogo_referencia_marca_opcional` e `plataforma_frase_carga`;
   - 0080: `core_usuario_codigo_fdv` e `catalogo_foto_lote`;
   - 0081: `plataforma_frase_carga`, em `nuvem/carga-frases-banco-dados-2` e `-3`.

   Saídas possíveis: (a) a 0082 só entra depois da 0075–0081 no `main`; ou (b) o gerente renumera a logo para o próximo
   número livre no momento do merge. Na saída (b), o banco-dados troca o nome do arquivo e todas as citações do número:
   `db/testes/estatico.test.ts`, `db/testes/funcoes-sa.ts` (`FUNCOES_SA_0082`, `MARCA_INTERNA_0082`),
   `db/testes/tenant-logo.db.test.ts`, `db/testes/portal-admin-multiperfil.test.ts`, `db/esquema/plataforma.ts` e
   `docs/banco/*`. Nos outros donos o número aparece só em comentários: `apps/api/src/empresa-logo.ts`,
   `apps/api/test/funcoes-sa.ts`, `packages/platform-sdk/src/empresa-logo.ts` e
   `tests/integracao/banco/conformidade.test.ts`.

   **O código do lote não tem 🔴.** Este bloqueio é de ordem de merge: nenhum PR do lote entra antes da migração, porque as
   rotas leem as colunas novas em `lerTenant`, `apps/api/src/licencas.ts:87`, e sem elas toda rota autenticada cai.

## 🟡 Corrigir (lote seguinte; o 1 pode ir no commit pendente do engenheiro-apps)

1. **engenheiro-apps:** com o aparelho bloqueado (RN-CORE-15), a logo some e não volta.
   - Arquivos: `apps/mobile/src/state/plataforma.tsx:830-834` e `apps/mobile/src/lib/logo-empresa.ts:16` e `:53-58`.
   - O que acontece: o `apagarFotos` apaga a pasta `empresa/`, mas a chave `fv:empresa:logo` fica no aparelho. Ela não casa
     com `chavesDoAparelhoBloqueado` (`lib/aparelho-bloqueado.ts:14-20`, só `fv:session`, `fv:u:` e `macuxi:u:`). O
     comentário "o registro dela sai com as chaves locais" está errado.
   - Efeito: no próximo login da mesma empresa, `acaoDaLogo` vê o mesmo sha256 e responde `manter`. O `uriDaLogo` não acha o
     arquivo e devolve `null`, então a carga, o Mais e o PDF ficam sem logo até o super-admin trocar a imagem.
   - Correção: gravar `null` no registro junto com o `apagarPastaDaEmpresa()`, ou fazer o `acaoDaLogo` baixar de novo quando
     o arquivo não existe (pela porta). Incluir um teste.
2. **modulo-vendedor:** comentário desatualizado em `modules/vendedor/web/components/orders/exportar-pdf.ts:9`. O texto diz
   "(BKO ainda sem fonte da logo)", mas o BKO já passa a logo (`logoParaPdf`). Tirar o parêntese.

## 🟢 Conferido / sugestões

- **Fronteiras e contratos:** os módulos só usam `@macuxi/platform-sdk`. Contratos Zod `.strict()` em
  `packages/platform-sdk/src/empresa-logo.ts`. O contrato do Core (`MeusModulosRespostaSchema`) não muda, e não há evento
  nem entidade de sync novos (desenho §5.4).
- **RLS e tenant:**
  - `GET /v1/me/empresa/logo/:sha256` passa por `preparar(req, 'core')` (sessão e licença do Core). Lê a logo dentro de
    `comTenant`, com a RLS `isolamento_tenant`, e devolve 404 se o sha não é o atual do tenant **do token**. Confere também
    que a chave começa com `<tenant>/plataforma/`.
  - As rotas do portal fazem 403 antes do banco, e as `sa_*` conferem de novo (42501). O CHECK `tenant_logo_chave_formato`
    prende a chave ao próprio tenant e ao `logo_id`, e `chamar()` recusa chave de outro tenant vinda do banco.
  - LC-03 (testes) cobre A × B nas duas direções.
- **Cache `immutable` e troca de tenant:** o endereço é o sha256, e bytes iguais dão o mesmo sha. Uma resposta guardada
  nunca mostra a outro tenant uma imagem diferente da que o sha descreve. O aparelho só pede o sha dos próprios parâmetros,
  e o BKO busca com `cache: 'no-store'` (`apiFetch`). O 404 sai sem o `immutable`. Sugestão (não exigida): mandar
  `Vary: Authorization` para proxies mal configurados.
- **`logoDaEmpresaWeb` com `qc.fetchQuery`:**
  - A logo sai da mesma consulta do menu (`consultaMeusModulos`); com `staleTime` de 60 s, uma imagem trocada no portal pode
    levar até 1 min para chegar ao PDF do BKO. Nesse tempo o sha velho dá 404, o `apiFetch` lança, o retorno é `null` e o
    PDF sai com a logo padrão. Não há vazamento.
  - O login limpa o cache (`login-screen.tsx:118`), então trocar de usuário ou de tenant não reaproveita a consulta.
- **Cópia no aparelho:**
  - A tela só mostra a cópia do tenant da sessão (`logoDoTenant`). Ao entrar em outra empresa, a pasta é apagada antes de
    qualquer download (`atualizarLogoDaEmpresa`). Os bytes passam de novo por `conferirLogo` e pelo `maxBytes`.
  - Diferença do desenho §3.3: "sair" não apaga a cópia. A pasta só sai no próximo login de outra empresa ou com o aparelho
    bloqueado. Aceito: é dado da empresa, não pessoal, e nunca aparece para outro tenant. Fica registrado aqui.
- **`versao_licencas`:** `empresa_nome` entra sempre nos parâmetros do Core.
  - **No deploy, todo aparelho recebe `modulos_mudaram` uma vez** (`sync.ts:192`): uma volta de conferência em todas as
    entidades. O mesmo acontece em todos os aparelhos do tenant a cada troca de logo ou nome. É o que o desenho §3.1 previa,
    e o custo é o de uma troca de parâmetro. Anotar nas notas do deploy.
  - As chaves também chegam às rotas do Conector (`licencasDoTenantNoBanco`). Não faz mal.
- **Idempotência:** o PUT com o mesmo sha devolve 200 e não grava nada; a função também é idempotente pelo sha. Na corrida
  entre dois envios, o objeto que sobra é apagado. Se o banco falhar, o objeto novo é apagado. O DELETE é idempotente.
- **Logs:** `tenant_id`, tamanho, tipo, dimensões e tempo. Não registram bytes, nome de arquivo nem dado pessoal. A
  auditoria guarda só o sha256 e o nome fantasia (pessoa jurídica).
- **Segurança do upload:** a autenticação e o super-admin são conferidos no `onRequest`, antes do corpo. O `bodyLimit` é de
  1 MiB. Só o cabeçalho é lido, sem decodificar a imagem, e o teto de 4096 px protege o aparelho e o PDF.
- **PDF:** o `logo_src` passa por `escapeHtml` (`pdf-pedido.ts:332`). O CSS `.logo` segue a spec §6 (16 mm de altura, até
  48 mm, contain, sem raio). Offline, o PDF usa a cópia guardada.
- **Login e senhas sem a logo do cliente:** só a `TelaCarga` passa `logoCliente`. A linha "Etapa n de N" ficou sempre à
  vista (MC-0088).
- **`packages/ui`:** `PlacaLogoCliente` e `caixaDaPlacaLogo` são puros, sem I/O. O kit não depende do SDK (o rótulo vem de
  `@macuxi/comum/marca`).

## Conflitos previsíveis com a T-0174 (`nuvem/T-0174-engenheiro-software`)

Teste de merge local sobre a integração: conflitos em 3 arquivos, todos mecânicos e todos do engenheiro-software.
- `packages/platform-sdk/src/index.ts`: manter `./imagens` e acrescentar `./zip`.
- `apps/api/src/arquivos.ts`, em 4 pontos:
  - imports: unir;
  - comentário da porta e `CHAVE_ARQUIVO_RE`: vale o da T-0174, que já aceita `.png`;
  - `indisponivel` × `erroArmazenamentoIndisponivel`: manter o export do T-0182 e trocar os usos de `indisponivel()` da
    T-0174 por ele.
- `.coord/diario/engenheiro-software.md`: manter as duas linhas.

`packages/platform-sdk/src/imagens.ts` e o teste dele são idênticos nos dois branches e não conflitam.

## Ordem de merge recomendada

0. Pré-requisito (🔴 1): a 0075–0081 no `main`, com o gerente desfazendo as repetições de 0075 e 0080. Se não for
   possível, a logo é renumerada para o próximo número livre.
1. **PR único autorizado** (lição da 0070): `banco-dados` + `engenheiro-software`. A 0082, a lista das 31 `sa_*`
   (`db/testes/funcoes-sa.ts`, `apps/api/test/funcoes-sa.ts`, `scripts/deploy/producao/banco-dbaas.sh`) e o `lerTenant` com
   as colunas novas precisam entrar juntos.
2. `designer-ux-ui` (placa em `packages/ui`), sem dependência do item 1.
3. `modulo-vendedor` (depende do `logoDaEmpresa?` do SDK, item 1).
4. `engenheiro-apps` (depende do 1 e do 2).
5. `testes` (por último, depois de tudo no `main`).
6. Se a T-0174 entrar depois: resolver os 3 conflitos acima no branch dela (dono: engenheiro-software).

## Veredito

**Código sem 🔴: aprovado.** O merge está **bloqueado só pela ordem das migrações** (🔴 1). Os dois 🟡 vão para o lote
seguinte; o 🟡 1 pode ir no commit pendente do engenheiro-apps.

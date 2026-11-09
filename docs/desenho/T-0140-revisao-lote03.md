# Revisão final parcial do lote 03 (engenheiro-software, 09/11/2026)

Escopo: diff da árvore local contra `origin/main` em T-0142 (Catálogo), T-0098 (Integração, SDK e API), T-0141 C infra
(0055, `EnderecoEntregaErp.origem`, `@macuxi/comum/endereco`), T-0033 (banco modelo) e o lote 03 do shell e dos RD de
Promotor, Pesquisa, Treinamento, Gestor e Core (comum). Fora: `modules/vendedor` (T-0141 A/B/C/F), T-0117 (Core, `apps/web`,
cookie do SDK) e `modules/core` (datas, RD-0046). Revisão por leitura e grep (PC lento); nenhum teste rodado.

Itens conferidos: fronteiras (nenhum import de módulo fora de `packages/*` e `contracts`; o único `@macuxi/db/teste` é o
`*.db.test.ts` do Promotor, permitido), regra no `domain` com teste citando RN/RF, `tenant_id`/RLS, licença e perfil nas
rotas, offline, segredo e dado pessoal em log, compatibilidade de contrato.

## Veredito por entrega

| Entrega | Dono | Veredito |
|---|---|---|
| T-0142 hierarquia (domain, API, app, BKO) | modulo-catalogo | **🔴 bloqueia** (1 🔴, 2 🟢) |
| T-0098 rota `conector/download` | modulo-integracao | 🟢 pode ir (1 🟢) |
| T-0098 SDK `ctx.pacotes` e adaptador S3 da API | engenheiro-software | 🟢 pode ir |
| T-0141 C: 0055 | banco-dados | 🟢 pode ir |
| T-0141 C: `EnderecoEntregaErp.origem` | modulo-integracao | 🟢 pode ir (aditivo no v1, registro do `aprovado@1` atualizado) |
| T-0141 C: `@macuxi/comum/endereco` | engenheiro-software | 🟢 pode ir |
| T-0033 banco modelo | banco-dados | 🟢 pode ir |
| Shell (RD-0016/0019/0032/0033/0040, lease, `mascararDadoPessoal`, RN-CORE-32) | engenheiro-apps / designer-ux / engenheiro-software | 🟢 pode ir (1 🟡 meu) |
| RD do Promotor, Pesquisa, Treinamento | donos | 🟢 pode ir (1 🟢 Pesquisa) |
| Gestor (datas 422) | modulo-gestor | 🟢 pode ir (1 🟢) |

## Achados

### modulo-catalogo (T-0142)

- 🔴 `modules/catalogo/contracts/rotas.ts:61` e `:46` — `ConsultaHierarquiaQuery.no` e `ConsultaVitrineQuery.no` têm
  `max(40)`, mas o item virtual "Outros produtos" tem id `outros:<uuid do nível>` = 43 caracteres (`catalogo_no.id` é uuid,
  0013). No BKO (`web/pages/catalogo-page.tsx:153` e `:197`), clicar em "Outros produtos" manda `GET hierarquia?no=outros:<uuid>`
  → 400; com `hier.isError`, a página mostra a tabela com `noDaLista = null`, ou seja, **todos** os produtos do tenant, sem
  aviso (valor errado na tela). O app não sofre (usa o domain offline). O teste `api/rotas.test.ts:600` não cobre
  `outros:` nem `sem-linha` pela API. Correção: `max(80)` (ou validar `uuid | 'sem-linha' | 'outros:'+uuid`) nas duas queries e
  um caso na rota com `outros:<uuid>` em `hierarquia` e em `produtos?no=`.
- 🟢 `api/rotas.ts:203` e `:283` — `hierarquia` e `produtos?no=` chamam `repo.dadosExportacao()`, que também lê
  `produto_relacao` inteira (3ª consulta sem uso). Um `arvoreENos()` só com nós e vínculos poupa a consulta por clique.
- 🟢 `db/aparelho.ts:112` — comentário ainda cita `app/lib/lista-por-linha-local.ts`, apagado nesta tarefa.

Pontos bons: `navegarHierarquia` pura com testes RF-CAT-09 (valor × regra: soma dos níveis = total), mesma regra no app e
no BKO, `marca_concorrente` do próprio Catálogo no aparelho (sync do manifesto), rota com `produto.consultar` e licença
(403 sem o módulo testado).

### modulo-integracao (T-0098 e T-0141 C)

- 🟢 `api/conector-download.ts:17` — o 503 repete à mão código e texto; usar `erroArmazenamentoIndisponivel()` do SDK
  (mesma frase e `CODIGO_ARMAZENAMENTO_INDISPONIVEL`, fonte única).

Pontos bons: só `conector.gerenciar` + super-admin, licença pela plataforma, auditoria só com versão e arquivo (a URL
assinada nunca vai a log nem auditoria), `.strip()` tira `publicado_em`, 404 sem auditar; `origem` é `nullish` e
aditivo no v1 (`VERSAO_CONTRATO` segue `v1`, testes RN-VEN-17 com Conector antigo × novo).

### banco-dados (0055 e T-0033)

Sem achado. 0055: só 3 CHECKs aditivos (origem, editado sem id, editado completo), sem coluna, RLS e grants intactos,
down idempotente. T-0033: nomes validados antes do SQL dinâmico, lock próprio com prazo, `is_template` como marca de
pronto, chave pelo checksum das migrações, falha do modelo volta ao caminho antigo, ligado só em Postgres local
(`MACUXI_PG_MODELO`), e o `admin-sem-superusuario` recusa servidor com modelo.

### modulo-gestor

- 🟢 `api/rotas.ts:118` — `ErroRegraNegocio('DATA_INVALIDA', ...)`: o padrão do 422 é `codigo` de RN; aqui é validação de
  entrada. Aceitável, mas o mesmo caso em outros módulos responde 400 `VALIDACAO`; alinhar quando houver um padrão de
  "data inexistente" no SDK.

### modulo-pesquisa

- 🟢 `domain/util.ts:19` — `export { somarDiasCivis as somarDias }` mantém um apelido local depois do RD-0042; os
  chamadores (`domain/publico.ts:101`, `:127`) podem importar do comum e o apelido sai.

### engenheiro-software (eu)

- 🟡 `packages/comum/src/dado-pessoal.ts:2-4` — o comentário diz que a máscara é a fonte única também do log do Conector,
  mas `apps/conector/src/log/mascara.ts` segue com as regras e marcadores próprios (`[email]` × `[e-mail]`) e
  `modules/integracao/domain/linhas-invalidas.ts:39` é outra regra de propósito (RD-0043). Corrigir o comentário (ou
  combinar a convergência com o modulo-integracao em recado próprio).

Sem achado no SDK `pacotes.ts` (porta pura, lista fechada de produtos, nome do arquivo por regex antes da chave e do
`Content-Disposition`, validade 60 a 900 s, manifesto com teto de 4 KiB e falha fechada 503) nem no shell (trava única no
lugar do `sync:lease`, máscara única no registro de erro e no armazenamento do aparelho, `caminhoDoLinkInterno` no SDK,
RN-CORE-32 com mínimo e frase vindos do Core).

## Contagem

| Dono | 🔴 | 🟡 | 🟢 |
|---|---|---|---|
| modulo-catalogo | 1 | 0 | 2 |
| modulo-integracao | 0 | 0 | 1 |
| modulo-gestor | 0 | 0 | 1 |
| modulo-pesquisa | 0 | 0 | 1 |
| engenheiro-software | 0 | 1 | 0 |
| banco-dados, modulo-promotor, modulo-treinamento, engenheiro-apps, designer-ux | 0 | 0 | 0 |

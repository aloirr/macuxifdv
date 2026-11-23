# ADR 0069 — Reenvio do pré-cadastro recusado no mesmo cliente, com histórico de revisões

- **Status**: proposta (o número 0069 vale depois de conferido no `.coord/quadro.md` pelo gerente-projetos; livre no `origin/main` c460e92).
- **Data**: 2026-11-23 (Manaus)
- **Versão**: v1.0.29. Regras: RN-CORE-16 (revista), RN-CORE-78 (revista), RN-CORE-79 (revista), RN-INT-22 (revista).
- **Autor**: engenheiro-software
- **Origem**: decisões do dono do produto R-20261123-141413 e R-20261123-142306 (reenvio = o mesmo pré-cadastro corrigido, com histórico;
  API do Core para o BKO corrigir os recusados; uma lista só de campos obrigatórios; Hub reabre a mesma linha da fila, com `revisao`,
  `hash` e erros por campo). Também fecha o 🟡 da revisão da v1.0.28 em `modules/core/api/cliente-cadastro.ts:60-63` (o 23505 vira
  409 genérico) e a falta de testes de banco da substituição.
- **Substitui**: o item 7 da ADR 0067 (reenvio após recusa = cliente novo). Os itens 1 a 6 da ADR 0067 seguem valendo, com o item 4
  (parâmetro próprio do pré-cadastro) trocado pelo item 6 abaixo e o item 6 (motivo só ao vendedor) ampliado pelo item 7 abaixo.

## Contexto
Na v1.0.28 o pré-cadastro recusado pelo ERP é corrigido no app com um `id` novo (`idDoReenvio`, `modules/core/app/lib/pre-cadastro-local.ts`):
o servidor apaga o recusado do mesmo CPF/CNPJ (`decidirDocumentoDuplicado`) e cria outro cliente, que entra no Hub como outra linha de
`integracao.cliente_fila_erp`. Isso perde o elo entre as tentativas (o ERP e o BKO veem dois clientes), deixa pedidos e visitas do vendedor
presos ao `id` apagado e não guarda os erros por campo. Também não há como o BKO corrigir um recusado.

Achado na leitura do código para este desenho (vale para a v1.0.28 em produção, independente desta ADR): **não há provedor de sync no
servidor para a entidade de push `cliente_pre_cadastro`**. O manifesto do Core a declara em `sync`, mas `provedoresSyncCore`
(`modules/core/api/sync.ts`) não tem `receber` para ela; o push do aparelho cai em `SYNC_NAO_IMPLEMENTADO` (retentável,
`rejeitarItensInvalidos` do SDK) e o pré-cadastro feito no Campo fica na fila do aparelho sem chegar ao servidor. Só o `POST
/v1/core/clientes/pre-cadastro` (BKO) grava. Esta ADR inclui o receptor (item 3); quando ele entrar no ar, os itens represados nos
APKs v1.0.28 chegam de uma vez, inclusive correções com `id` novo — por isso a compatibilidade do item 4 é obrigatória.

## Decisão

### 1. O reenvio é uma revisão do mesmo cliente
- O pré-cadastro tem **revisão**: `core.cliente.revisao_cadastro` começa em 1 no primeiro recebimento e sobe 1 a cada reenvio. Cada
  revisão é uma **tentativa** em `core.cliente_pre_cadastro_tentativa`: número, hash do payload, origem (`campo` | `bko`), quem corrigiu
  (usuário e perfil), quando chegou, campos alterados (só os nomes), resultado (`aguardando` | `aceito` | `recusado`), quando o ERP
  respondeu, motivo e erros por campo.
- Corrigir só vale para cliente **`recusado`** (RN-CORE-78). A correção leva a `revisao_base` (a revisão que a pessoa viu): igual à atual
  = revisão nova; a anterior com o mesmo hash da atual = repetição idempotente (`ja_existia: true`); qualquer outra = 409
  `REVISAO_DESATUALIZADA` (vendedor e BKO corrigiram ao mesmo tempo; quem chegou depois recarrega). Pendente ou aprovado = 422
  `CADASTRO_NAO_RECUSADO`.
- A revisão nova grava os dados no mesmo `core.cliente` (mesmo `id`), volta o status a `pendente`, limpa `motivo_recusa` e
  `erros_recusa`, cria a tentativa, publica `core.cliente.pre_cadastro_revisado@1` e `core.cliente.atualizado@1` (o pull leva a linha
  ao aparelho), tudo na mesma transação. Reenviar sem mudar nada é permitido (o ERP pode ter resolvido o problema do lado dele): a
  tentativa fica com `campos_alterados` vazio.
- O vendedor segue vendendo para o cliente pendente ou recusado (nada muda no Vendedor) e vê o motivo e os erros por campo no app.

### 2. Hash do payload
- `hash = sha256(canonico)` em hexadecimal minúsculo (64 caracteres). `canonico` é um texto JSON gerado pela função pura
  `canonicalPreCadastro` (domain do Core) e o SHA-256 roda na API com `node:crypto` (`createHash('sha256')`, já usado no Core); o domain
  não importa módulo do Node (roda no aparelho).
- Canonicalização (versão 1; mudar qualquer regra = ADR nova, e hashes de versões diferentes nunca são comparados):
  1. chaves fixas, **todas presentes**, em ordem lexicográfica por ponto de código: `bairro, cep, cidade, documento, email, filial_id,
     inscricao_estadual, latitude, logradouro, longitude, nome_fantasia, numero, razao_social, telefone, uf`;
  2. texto: `trim`; vazio vira `null`; `documento`, `cep` e `telefone` só com dígitos; `uf` em maiúsculas; `email` em minúsculas;
     `inscricao_estadual` em maiúsculas (`ISENTO`); demais textos como vieram (sem mudar acento nem caixa);
  3. `latitude`/`longitude`: número arredondado a 6 casas (`Math.round(v * 1e6) / 1e6`) ou `null`; `filial_id`: UUID em minúsculas ou
     `null`; `undefined` vira `null`;
  4. `JSON.stringify` do objeto montado nessa ordem, sem espaços.
- Fora do hash: `id`, `origem`, `revisao_base` e tudo o que não é dado do cliente. O hash não é segredo nem identificador público: não
  vai a log, nem ao papel `macuxi_leitura` (dado pessoal de baixa entropia, como o CPF, entra no texto).

### 3. Receptor do push `cliente_pre_cadastro`
- Novo provedor em `provedoresSyncCore`: `{ entidade: entidadePreCadastroServidor, receber: receberPreCadastros }` (direção `push`,
  schema `PreCadastroClienteSchema`). Cada item roda o mesmo caminho da rota (função compartilhada, sem duplicar SQL): sem
  `revisao_base` = criação (item 4 para `id` novo com documento de recusado); com `revisao_base` = correção (item 1).
- Permissão: ação `cliente.pre_cadastrar`; correção pelo aparelho só para cliente da carteira do vendedor (escopo de carteira; fora
  dela = item `rejeitado` `FORA_DA_CARTEIRA`). Licença do Core pelo SDK.
- Resultado por item: `aceito` (inclusive `ja_existia`) ou `rejeitado` com o código da regra (`CAMPOS_OBRIGATORIOS`,
  `DOCUMENTO_JA_CADASTRADO`, `CADASTRO_INDISPONIVEL`, `REVISAO_DESATUALIZADA`, `CADASTRO_NAO_RECUSADO`) e a mensagem em português; o
  app mostra "Não enviado" com "Corrigir e reenviar", como hoje.

### 4. Compatibilidade com o APK v1.0.28 (`id` novo substituindo o recusado)
**Decisão: o `id` novo vira o cliente vivo e herda o histórico do recusado como revisão seguinte** (a linhagem continua; o `id`
canônico passa a ser o novo). Não mapeamos o `id` novo para o original.
- No recebimento de um pré-cadastro com `id` novo X e o CPF/CNPJ de um recusado vivo Y (`decidirDocumentoDuplicado` →
  `substituir: Y`), na mesma transação e nesta ordem: Y recebe `deleted_at` (libera o índice único do documento); X é inserido com
  `revisao_cadastro = Y.revisao_cadastro + 1`; as tentativas de Y passam para X (`cliente_id = X`, `cliente_id_original = Y`); a
  tentativa nova de X é gravada; audita `cliente.recusado_substituido` (sem o motivo, como hoje); publica
  `core.cliente.pre_cadastrado@1` de X (no Hub, X é cliente novo para o ERP, com `revisao` > 1).
- `cliente_id_original` é o alias: o consumidor do retorno do ERP e as rotas do BKO resolvem Y → X por ele (índice próprio). Não há
  tabela de alias à parte (uma informação, um lugar).
- **Por que não mapear X → Y** (manter Y e descartar X): o APK v1.0.28 põe X na lista do vendedor pela sobreposição da fila, e o
  vendedor pode fazer check-in, visita e pedido para X antes do push (offline-first). Esses itens chegam com `cliente_id = X`; com X
  mapeado para Y, eles falhariam no escopo de carteira (X não existe) ou exigiriam resolver alias no SDK e em todos os módulos que
  recebem `cliente_id`. Tornar X canônico mantém o comportamento que o APK v1.0.28 já espera (o pull traz X e tira Y) e o histórico
  continua inteiro.
- O caminho termina quando a versão mínima do Campo passar de 1.0.28: a remoção (`decidirDocumentoDuplicado` volta a só bloquear) vai
  numa ADR curta, com a política de versão.

### 5. 23505 no insert do pré-cadastro (🟡 da v1.0.28)
O `catch` em `modules/core/api/cliente-cadastro.ts:60-63` passa a decidir pela restrição (`(e as { constraint?: string }).constraint`),
depois do `rollback to savepoint`, pela função pura `decidirConflitoUnicidade` (domain do Core, RN-CORE-78):
- `cliente_pkey` (corrida do mesmo `id`): reconsulta `select status_cadastro, deleted_at from core.cliente where id = $1` (RLS do tenant).
  Achou vivo → 200 `{ id, status_cadastro, ja_existia: true }` (o outro pedido gravou primeiro; é a idempotência). Achou apagado ou não
  achou (id de outro tenant, escondido pela RLS) → 409 `CADASTRO_INDISPONIVEL`, mesmo texto de hoje.
- `cliente_documento_uk` (corrida do mesmo CPF/CNPJ): reconsulta por `documento` (vivo). Mesmo `id` do pedido → 200 `ja_existia: true`;
  outro `id` → 409 `DOCUMENTO_JA_CADASTRADO` (o texto de hoje). Sem laço de nova tentativa.
- Outra restrição → relança (500; o log leva só o nome da restrição e o `request_id`).

### 6. Campos obrigatórios numa lista só (RN-CORE-16 + RN-CORE-79)
- **Parâmetro único**: `plataforma.parametro`, módulo `core`, chave **`cliente.campos_obrigatorios`** (a da RN-CORE-16, já lida pelo Hub,
  pelo Início e pela consulta `core.cadastro_cliente@1`). Valor: lista de `CampoCadastroCliente`. Razão social e CPF/CNPJ entram sempre
  (`camposExigidos`, sem mudança). Sem linha = padrão da RN-CORE-16 (razão social, CPF/CNPJ, IE só para CNPJ, logradouro, número,
  bairro, cidade, UF, CEP).
- **Pré-cadastro usa a mesma lista**: obrigatórios do pré-cadastro = `camposExigidos(parametro)` menos `complemento` (o cliente não tem a
  coluna) e `geolocalizacao` (vem do aparelho e pode faltar), pela função pura `obrigatoriosDoPreCadastro`. A conferência é a da
  RN-CORE-16 (`cadastroCompleto`: IE só para CNPJ, `ISENTO` vale, CPF/CNPJ com dígito válido) mais as validações de formato de hoje
  (`validarPreCadastro`), no app offline e na API.
- **Tela**: Parâmetros › Clientes mostra uma lista só (`GET|PUT /v1/core/parametros/campos-obrigatorios`); sai
  `/v1/core/parametros/pre-cadastro` (o BKO web sai no mesmo deploy da API).
- **Espelho para o APK v1.0.28**: o APK antigo lê `cliente.pre_cadastro.obrigatorios` do pull `parametro`. Até a versão mínima passar de
  1.0.28, o `PUT` grava também essa chave, na mesma transação, com a projeção `projecaoLegadaObrigatorios(lista)` (configuráveis
  antigos; `endereco` entra se qualquer campo de endereço for exigido). A projeção é igual ou mais exigente que a regra nova, para o APK
  antigo não mandar o que a API recusa (custo aceito: no APK antigo a IE é pedida também para CPF; o vendedor digita `ISENTO`).
- **Migração** (banco-dados): para cada tenant, `E` = lista efetiva da RN-CORE-16 (valor válido da chave, ou o padrão) e `P` = a chave do
  pré-cadastro expandida (`endereco` → logradouro, número, bairro, cidade, UF, CEP). Tenant com `P` vivo: grava
  `cliente.campos_obrigatorios = ordem canônica de (E ∪ P)`. Todo tenant: grava o espelho `cliente.pre_cadastro.obrigatorios =
  projecao(E ∪ P)` (ou de `E`), para o APK v1.0.28 receber no pull. Nada é apagado.
- **Efeitos a conferir antes do deploy** (o banco-dados entrega a consulta de conferência junto com a migração): (a) tenant que marcou
  no pré-cadastro um campo fora da RN-CORE-16 (ex.: telefone) passa a ver clientes do ERP sem esse campo como cadastro incompleto
  (RN-CORE-17: pedido só como orçamento); (b) tenant sem nenhuma das chaves passa a exigir no pré-cadastro IE (CNPJ) e endereço. A
  consulta lista os tenants em (a) e em (b); o gerente leva ao dono do produto antes do "aprovo deploy".

### 7. API do Core para o BKO corrigir os recusados
Rotas com `superficie: 'bko'`, `carteira: 'nao_se_aplica'` (o tenant inteiro), licença do Core pelo SDK, RLS do tenant; a API revalida
tudo o que o BKO mandar (mesma função compartilhada do item 3). O motivo e os erros por campo passam a ir também a quem tem a ação
`cliente.pre_cadastro_recusados` (analista e admin); para os demais perfis, fora o vendedor da carteira, seguem nulos
(`motivoRecusaVisivel` não muda: ela é a regra do pull e do Cliente 360). Nunca em log nem na auditoria.

### 8. Hub `/integracao/v1` (RN-INT-22), aditivo na v1
- A revisão nova **reabre a mesma linha** de `integracao.cliente_fila_erp` (`rejeitado → pendente`, `revisao` nova, `hash` e `payload`
  novos, `tentativas = 0`, `enviado_em`, `motivo` e `erros` limpos; `recebido_em` fica o do primeiro recebimento, que mantém a ordem da
  fila). Linha `vinculado` nunca reabre.
- `GET /clientes/pendentes` entrega `revisao` e `hash` em cada cliente (`tentativa` passa a contar as entregas da revisão).
- `POST /clientes/{cliente_uuid}/retorno` aceita `revisao` (opcional; ausente = a revisão atual da linha, que é o que o Conector antigo
  quer dizer) e, em `rejeitado_erp`, `erros: [{ campo, codigo, mensagem }]` (opcional, até 50). Regras (`aplicarRetornoCliente`):
  - `revisao` maior que a da linha → 422 `revisao_desconhecida`;
  - `rejeitado_erp` de revisão **anterior** → 200 `{ obsoleto: true }`, sem gravar nem publicar (não sobrescreve a revisão nova);
  - `vinculado` de revisão anterior → **vale** (o cliente existe no ERP; ignorar o código faria o ERP criar o cliente de novo na revisão
    nova): grava, publica com a `revisao` informada e a linha fica `vinculado`. Ponto para o dono do produto confirmar (ver
    Consequências);
  - mesma revisão: regras de hoje; `rejeitado_erp` sobre linha `rejeitado` com o mesmo motivo e os mesmos erros = `repetido: true`;
    com motivo ou erros diferentes = **fato novo**: 200, grava e publica.
- O retorno de sucesso traz `revisao` (a da linha depois do retorno) e `obsoleto` (só quando `true`). Mesma permissão de hoje (Conector
  que "Recebe pedidos", senão 403), sem cursor.
- Erros: `mensagem` passa por `mascararDadoPessoal` (`@macuxi/comum`) e é cortada em 300 caracteres antes de gravar; motivo, erros e hash
  nunca vão a log (o log do retorno leva `cliente_uuid`, `revisao`, `status`, `repetido`, `obsoleto`).
- Incompatível (tirar campo, tornar `revisao` obrigatório no retorno, mudar o sentido de `tentativa` para o total) = `/integracao/v2`.

### 9. Eventos
- **Novo**: `core.cliente.pre_cadastro_revisado@1` (Core publica; Integração consome) — fato distinto do recebimento.
- **Aditivos, mesma versão** (campos opcionais; consumidores com `eventoTolerante`): `integracao.cliente.retorno_erp@1` ganha `revisao` e
  `erros`; a consulta `core.clientes_pre_cadastro_sem_erp@1` ganha `revisao` e `hash` na saída.
- `core.cliente.pre_cadastrado@1` não muda (a revisão vai pela consulta).

## Desenho técnico

### A. Contratos do Core (`modules/core/contracts`) — modulo-core

`cliente-pre-cadastro.ts` (novos, exportados pelo `index.ts`):
```ts
export const RevisaoCadastroSchema = z.number().int().min(1);
export const HashPreCadastroSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const OrigemTentativaSchema = z.enum(['campo', 'bko']);
export const ResultadoTentativaSchema = z.enum(['aguardando', 'aceito', 'recusado']);
export const SituacaoRecusadoSchema = z.enum(['recusado', 'reenviado', 'aceito']);   // lista do BKO

/** Erro por campo devolvido pelo ERP (campo = nome canônico do ClienteParaErp ou o que o ERP mandou). */
export const ErroCampoCadastroSchema = z.object({
  campo: z.string().trim().min(1).max(60),
  codigo: z.string().trim().min(1).max(60),
  mensagem: z.string().trim().min(1).max(300),
}).strict();
export const ErrosCampoCadastroSchema = z.array(ErroCampoCadastroSchema).max(50);
export const ERROS_RECUSA_MAX = 50;

// PreCadastroClienteSchema: + revisao_base: RevisaoCadastroSchema.nullish()  (ausente = criação; APK v1.0.28 nunca manda)

/** Correção do BKO: PUT /v1/core/clientes/:id/pre-cadastro (o id vem do caminho; origem = 'bko'). */
export const CorrecaoPreCadastroSchema = PreCadastroClienteSchema.omit({ id: true, origem: true, revisao_base: true })
  .extend({ revisao_base: RevisaoCadastroSchema }).strict();
export const PreCadastroClienteSaidaSchema = z.object({          // revisto: + revisao (o mesmo schema serve criação e correção)
  id: Uuid, status_cadastro: StatusCadastroSchema, revisao: RevisaoCadastroSchema, ja_existia: z.boolean(),
});

export const TentativaPreCadastroSchema = z.object({
  revisao: RevisaoCadastroSchema,
  hash: HashPreCadastroSchema.nullable(),                       // nulo = tentativa anterior à v1.0.29 (migração)
  origem: OrigemTentativaSchema,
  corrigido_por: z.object({ id: Uuid, nome: z.string(), perfil: z.string() }).nullable(),
  enviado_em: z.string().datetime(),
  campos_alterados: z.array(z.string()).max(20),                 // só nomes de coluna, nunca valores
  resultado: ResultadoTentativaSchema,
  respondido_em: z.string().datetime().nullable(),
  motivo: z.string().max(500).nullable(),
  erros: ErrosCampoCadastroSchema,
  cliente_id_original: Uuid.nullable(),                          // id do recusado substituído pelo APK v1.0.28
});
export const HistoricoPreCadastroSchema = z.object({ cliente_id: Uuid, revisao_atual: RevisaoCadastroSchema, tentativas: z.array(TentativaPreCadastroSchema) });

export const RecusadosEntradaSchema = z.object({
  situacao: SituacaoRecusadoSchema.default('recusado'),
  busca: z.string().trim().max(60).optional(),                  // razão social (contém) ou dígitos do documento (prefixo)
  limite: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),                        // opaco: (recusado_em, id) da última linha
}).strict();
export const RecusadoItemSchema = z.object({
  cliente_id: Uuid,
  revisao: RevisaoCadastroSchema,
  documento_mascarado: z.string().nullable(),                    // mascararDocumentoDoFarol (domain/farol.ts), sem cópia
  razao_social: z.string(),
  vendedor: z.object({ id: Uuid, nome: z.string() }).nullable(), // papel 'vendedor' da carteira
  recusado_em: z.string().datetime(),                            // respondido_em da última tentativa recusada
  motivo: z.string().max(500).nullable(),
  erros: ErrosCampoCadastroSchema,
  situacao: SituacaoRecusadoSchema,
});
export const RecusadosSaidaSchema = z.object({ itens: z.array(RecusadoItemSchema).max(200), proximo_cursor: z.string().nullable() });

/** GET /v1/core/clientes/:id/pre-cadastro: dados atuais para o formulário de correção (documento completo: quem corrige precisa). */
export const PreCadastroAtualSchema = CorrecaoPreCadastroSchema.omit({ revisao_base: true }).extend({
  id: Uuid, revisao: RevisaoCadastroSchema, status_cadastro: StatusCadastroSchema, motivo: z.string().max(500).nullable(), erros: ErrosCampoCadastroSchema,
});

export const ClientePreCadastroRevisadoSchema = z.object({
  cliente_id: Uuid, revisao: RevisaoCadastroSchema, origem: OrigemTentativaSchema, revisado_em: z.string().datetime(),
});
export const EVENTO_CLIENTE_PRE_CADASTRO_REVISADO = definirEvento('core.cliente.pre_cadastro_revisado@1', ClientePreCadastroRevisadoSchema);

// ClientePreCadastroParaErpSchema (saída de core.clientes_pre_cadastro_sem_erp@1): + revisao: RevisaoCadastroSchema, + hash: HashPreCadastroSchema
```
- Saem de uso no app v1.0.29 e ficam só para o espelho legado (marcar `@deprecated`, remover com a versão mínima > 1.0.28):
  `PARAMETRO_PRE_CADASTRO_OBRIGATORIOS`, `CAMPOS_PRE_CADASTRO_CONFIGURAVEIS`, `ObrigatoriosPreCadastroSchema`,
  `obrigatoriosPreCadastroDasLinhas`. Sai `ParametroPreCadastroSchema` (a rota sai).
- `cadastro.ts`: `export const CAMPOS_CADASTRO_FIXOS = ['razao_social', 'documento'] as const` (o domain deixa de ter a cópia
  `CAMPOS_FIXOS`); `ParametroCamposObrigatoriosClienteSchema = z.object({ obrigatorios: z.array(CampoCadastroCliente).max(14)
  .refine(semRepetir) }).strict()` (GET devolve a lista efetiva, já com os fixos; PUT aceita sem eles e o servidor acrescenta);
  `camposExigidosDasLinhas(linhas)` para o app ler o pull `parametro` (mesmo molde de `obrigatoriosPreCadastroDasLinhas`).
- `sync.ts` (`ClienteSyncSchema`, aditivos opcionais): `revisao_cadastro: z.number().int().min(1).nullable().optional()`,
  `erros_recusa: ErrosCampoCadastroSchema.nullable().optional()` (mesma regra de visibilidade do `motivo_recusa`).

### B. Domain do Core (funções puras, teste antes, citando a RN) — modulo-core
| Função | Arquivo | RN |
|---|---|---|
| `canonicalPreCadastro(dados: DadosPreCadastro): string` | `domain/cliente-pre-cadastro.ts` | RN-CORE-78 |
| `camposAlteradosPreCadastro(antes: DadosPreCadastro, depois: DadosPreCadastro): string[]` (compara pelos valores canônicos; devolve nomes na ordem canônica) | idem | RN-CORE-78 |
| `decidirReenvioPreCadastro(atual: { status_cadastro: StatusCadastro \| null; revisao_cadastro: number; hash_atual: string \| null } \| null, pedido: { revisao_base: number; hash: string }): { acao: 'nova_revisao'; revisao: number } \| { acao: 'repetido' } \| { acao: 'recusar'; http: 404 \| 409 \| 422; codigo: 'NAO_ENCONTRADO' \| 'REVISAO_DESATUALIZADA' \| 'CADASTRO_NAO_RECUSADO' }` | idem | RN-CORE-78 |
| `decidirDocumentoDuplicado(iguais)` → `{ bloqueia: boolean; substituir: { id: string; revisao: number } \| null }` (revista: no máximo um vivo por documento, pelo índice único) | idem | RN-CORE-78 |
| `decidirConflitoUnicidade(e: { restricao: string \| undefined; id: string; porId: { status_cadastro: StatusCadastro \| null; apagado: boolean } \| null; porDocumento: { id: string } \| null }): { resposta: 'ja_existia'; status_cadastro: StatusCadastro } \| { resposta: 'erro'; codigo: 'CADASTRO_INDISPONIVEL' \| 'DOCUMENTO_JA_CADASTRADO' } \| { resposta: 'relancar' }` | idem | RN-CORE-78 |
| `situacaoDoRecusado(c: { status_cadastro: StatusCadastro \| null; revisao_cadastro: number \| null }): SituacaoRecusado` (`recusado` → recusado; `pendente` com revisão > 1 → reenviado; `aprovado` → aceito) | idem | RN-CORE-78 |
| `errosRecusaSeguros(erros: unknown): ErroCampoCadastro[]` (valida, corta em 50 itens e 300 caracteres, `mascararDadoPessoal` na mensagem) | idem | RN-CORE-78, regra 8 |
| `decidirRecusaErp(cliente, retorno: { revisao?: number; motivo: string \| null; erros: ErroCampoCadastro[] })` (revista): revisão anterior → `nada/revisao_antiga`; revisão atual com status `pendente` → `gravar`; já `recusado` na mesma revisão com o mesmo motivo e erros → `nada/ja_recusado`; diferente → `gravar` (fato novo) | `domain/cliente-vinculo-erp.ts` | RN-CORE-78, RN-INT-22 |
| `obrigatoriosDoPreCadastro(exigidos: readonly CampoCadastroCliente[]): CampoCadastroCliente[]` | `domain/pre-cadastro-campos.ts` | RN-CORE-16, RN-CORE-79 |
| `validarPreCadastro(dados, exigidos: readonly CampoCadastroCliente[])` (revista: obrigatório pela `cadastroCompleto` + formatos de hoje) | idem | RN-CORE-16, RN-CORE-79 |
| `projecaoLegadaObrigatorios(exigidos: readonly CampoCadastroCliente[]): CampoPreCadastroConfiguravel[]` | idem | RN-CORE-79 (compat. v1.0.28) |
| `idDoReenvio` (app, revista): o recusado reenvia com o **mesmo** id e `revisao_base = revisao_cadastro` | `app/lib/pre-cadastro-local.ts` | RN-CORE-78 |
Saem: `camposFaltantesPreCadastro` e `camposObrigatoriosPreCadastro` (trocadas por `obrigatoriosDoPreCadastro` + `cadastroCompleto`);
`sobreporPreCadastros` deixa de esconder o recusado do mesmo documento quando o item da fila tem o mesmo `id`.

### C. API do Core — modulo-core
| Método e caminho (`/v1/core/...`) | Ação (perfis) | Corpo / consulta | Resposta |
|---|---|---|---|
| `POST clientes/pre-cadastro` (revista: 23505, legado, tentativa rev. 1) | `cliente.pre_cadastrar` (como hoje) | `PreCadastroClienteSchema` | `PreCadastroClienteSaidaSchema` |
| push `cliente_pre_cadastro` (novo receptor, item 3) | `cliente.pre_cadastrar` + carteira | `PreCadastroClienteSchema` | resultado por item |
| `GET clientes/pre-cadastro/recusados` | `cliente.pre_cadastro_recusados` (analista, admin) | `RecusadosEntradaSchema` | `RecusadosSaidaSchema` |
| `GET clientes/:id/pre-cadastro` | `cliente.pre_cadastro_recusados` | — | `PreCadastroAtualSchema` (404 se não for pré-cadastro; Y resolvido para X pelo alias) |
| `GET clientes/:id/pre-cadastro/historico` | `cliente.pre_cadastro_recusados` | — | `HistoricoPreCadastroSchema` |
| `PUT clientes/:id/pre-cadastro` | `cliente.pre_cadastro_corrigir` (analista, admin), auditado | `CorrecaoPreCadastroSchema` | `PreCadastroClienteSaidaSchema`; 409 `REVISAO_DESATUALIZADA`, 409 `DOCUMENTO_JA_CADASTRADO`, 422 `CADASTRO_NAO_RECUSADO`, 422 `CAMPOS_OBRIGATORIOS` |
| `GET\|PUT parametros/campos-obrigatorios` (substitui `parametros/pre-cadastro`) | `parametro.campos_obrigatorios` (analista, admin) / `parametro.campos_obrigatorios_editar` (admin), auditado | `ParametroCamposObrigatoriosClienteSchema` | idem |
- A lista de recusados traz só clientes com ao menos uma tentativa `recusado`; `situacao` filtra pelo `situacaoDoRecusado` (o
  `reenviado` e o `aceito` mostram o motivo e os erros da última recusa). Ordem: `recusado_em` mais recente primeiro, `cliente_id`
  desempata.
- Saem as ações `parametro.pre_cadastro` e `parametro.pre_cadastro_editar` (trocadas pelas duas acima no `manifest.ts`); entram
  `cliente.pre_cadastro_recusados` e `cliente.pre_cadastro_corrigir`; o manifesto publica `core.cliente.pre_cadastro_revisado@1`.
- Auditoria da correção: `cliente.pre_cadastro_corrigir` com `{ revisao, campos_alterados, origem }` (sem valores, sem motivo).
- `CHAVES_PARAMETRO_SYNC` (`api/sync.ts`): entra `PARAMETRO_CAMPOS_OBRIGATORIOS`; o espelho legado continua na lista.
- Pull do `cliente` leva `revisao_cadastro` e `erros_recusa` (este só ao vendedor, pela mesma regra do `motivo_recusa`).
- A consulta `core.clientes_pre_cadastro_sem_erp@1` devolve `revisao` (coluna) e `hash` (calculado na API pelos dados atuais, que são os
  da revisão atual).
- Consumidor `integracao.cliente.retorno_erp@1` (revisto): resolve o `cliente_id` pelo alias quando o cliente está apagado; grava o
  resultado na tentativa da `revisao` do evento (ou na atual, sem `revisao`); só muda `core.cliente` quando a decisão do domain manda;
  `erros_recusa` pelo `errosRecusaSeguros`.

### D. Banco — banco-dados (migração `0098_core_integracao_pre_cadastro_revisao`, número provisório pela ordem de merge; se a ADR 0068 levar a 0098, esta vira a próxima livre)
1. `core.cliente`:
   - `revisao_cadastro integer` (check `revisao_cadastro is null or revisao_cadastro >= 1`); preenche `1` onde `origem_cadastro <> 'erp'`;
     `null` nos clientes do ERP. Grant de SELECT ao `macuxi_leitura`.
   - `erros_recusa jsonb` (checks: `erros_recusa is null or (jsonb_typeof(erros_recusa) = 'array' and jsonb_array_length(erros_recusa) <= 50)`
     e `erros_recusa is null or status_cadastro = 'recusado'`). **Sem** grant ao `macuxi_leitura`.
2. `core.cliente_pre_cadastro_tentativa` (nova; fora do sync, entra em `db/src/excecoes.ts`):
   `id uuid pk default gen_random_uuid()`, `tenant_id`, `cliente_id uuid not null` (FK `(tenant_id, cliente_id)` → `core.cliente
   (tenant_id, id)`), `revisao integer not null check (>= 1)`, `hash text check (hash is null or hash ~ '^[0-9a-f]{64}$')`,
   `origem text not null check in ('campo','bko')`, `corrigido_por uuid` (FK `(tenant_id, corrigido_por)` → `core.usuario`),
   `corrigido_por_perfil text`, `cliente_id_original uuid`, `campos_alterados text[] not null default '{}'`, `enviado_em timestamptz not null`,
   `resultado text not null default 'aguardando' check in ('aguardando','aceito','recusado')`, `respondido_em timestamptz`,
   `motivo text check (motivo is null or char_length(motivo) <= 500)`, `erros jsonb` (mesmos checks de array ≤ 50), `created_at`,
   `updated_at` (gatilho `plataforma.definir_updated_at`), `deleted_at`, `external_id`.
   Restrições: `unique (tenant_id, cliente_id, revisao)`; check `resultado = 'recusado' or (motivo is null and erros is null)`.
   Índices: `(tenant_id, cliente_id_original) where cliente_id_original is not null` (alias) e `(tenant_id, respondido_em desc, cliente_id)
   where resultado = 'recusado' and deleted_at is null` (lista do BKO).
   RLS `isolamento_tenant` (`macuxi_app`: select, insert, update; sem DELETE), `manutencao`, `leitura` com SELECT por coluna **sem**
   `hash`, `motivo` e `erros`.
   Carga inicial: uma tentativa `revisao = 1` por pré-cadastro existente (`origem_cadastro <> 'erp'`, vivo): `origem = origem_cadastro`,
   `enviado_em = created_at`, `resultado` pelo status (`pendente` → aguardando, `aprovado` → aceito, `recusado` → recusado),
   `respondido_em` (`aprovado_em` ou `updated_at`), `motivo = motivo_recusa`, `hash` nulo. As substituições da v1.0.28 (só pelo BKO, se
   houver) ficam como estão; o elo delas segue na auditoria (`cliente.recusado_substituido`).
3. `integracao.cliente_fila_erp`: `revisao integer not null default 1 check (revisao >= 1)`, `hash text check (hash is null or hash ~
   '^[0-9a-f]{64}$')`, `erros jsonb` (checks de array ≤ 50 e `erros is null or estado = 'rejeitado'`). Grant ao `macuxi_leitura` só da
   `revisao`. Índice do poll sem mudança.
4. Parâmetro unificado (item 6): `insert ... on conflict (tenant_id, modulo, chave) where deleted_at is null do update` das duas chaves,
   com a expansão e a projeção escritas em SQL e conferidas no teste de banco contra as funções do domain (`obrigatoriosDoPreCadastro`,
   `projecaoLegadaObrigatorios`); mais a consulta de conferência do item 6 (fora da migração, em `db/consultas/` ou no dicionário).
5. Caminho de volta (`.down.sql`): apaga a tabela de tentativas e as colunas novas (o histórico e os erros se perdem; os parâmetros
   ficam). Volte antes o código do Core e do Hub que lê as colunas (senão 42703/42P01).
6. Dicionários: `docs/banco/core.md` e `docs/banco/integracao.md` ("0098"); `modules/core/db/nuvem.ts` e `modules/integracao/db/nuvem.ts`.

### E. Integração — modulo-integracao
- `contracts/cliente-erp.ts`: `ErroCampoRetornoCliente = z.object({ campo: z.string().trim().min(1).max(60), codigo:
  z.string().trim().min(1).max(60), mensagem: z.string().trim().min(1).max(300) })`; `ClienteParaErp` + `revisao:
  z.number().int().positive().optional()`, `hash: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional()`; `RetornoCliente` +
  `revisao: z.number().int().positive().optional()`, `erros: z.array(ErroCampoRetornoCliente).min(1).max(50).optional()` (no
  `superRefine`: `erros` só com `rejeitado_erp`); `RetornoClienteAceito` + `revisao: z.number().int().positive()`, `obsoleto:
  z.literal(true).optional()`.
- `contracts/eventos.ts`: `ClienteRetornoErpEvento` + `revisao: z.number().int().positive().optional()`, `erros:
  z.array(ErroCampoRetornoCliente).max(50).optional()` (mesma versão @1).
- `domain/cliente-fila.ts`: `ClienteNaFila` + `revisao`, `hash`, `erros`; `selecionarClientesPendentes` entrega `revisao` e `hash` (das
  colunas, não do payload); `aplicarRetornoCliente` com as regras do item 8 (novo código de falha `revisao_desconhecida`; resultado com
  `obsoleto`); nova `decidirEntradaNaFila(atual: { revisao: number; estado: EstadoClienteNaFila } | null, nova: { revisao: number }):
  'inserir' | 'reabrir' | 'nada'` (reabre só revisão maior e linha não `vinculado`); `iguaisErrosRetorno(a, b): boolean` (compara motivo
  normalizado e erros pela ordem de `campo, codigo`).
- `api/consumidores-cliente.ts`: `entrarClienteNaFila` passa a fazer upsert pela decisão acima (`on conflict (tenant_id, cliente_uuid) do
  update ... where cliente_fila_erp.revisao < excluded.revisao and cliente_fila_erp.estado <> 'vinculado'`), gravando `revisao` e `hash`
  da consulta; novo `consumidorClientePreCadastroRevisado` (mesma função) para `core.cliente.pre_cadastro_revisado@1`; manifesto da
  Integração passa a consumir o evento.
- `api/rotas-clientes.ts`: seleção e retorno com as colunas novas; `erros` gravados depois de `mascararDadoPessoal` e corte; log sem
  motivo, erros e hash.
- `docs/modulos/integracao/hub-api.md` §6.6b, o OpenAPI (`api/openapi`) e o guia PDF: campos novos e as regras do item 8.

### F. Registro de contratos — engenheiro-software (depois do aceite desta ADR)
`.coord/contratos/eventos.md` (evento novo e os aditivos) e `.coord/contratos/modulos.md` (rotas, consulta, ações).

### G. Testes de banco obrigatórios (sessão, Postgres local, antes do push)
- Core (`modules/core/api/cliente-cadastro.db.test.ts` e o novo `cliente-pre-cadastro-bko.db.test.ts`): criação grava a tentativa 1;
  correção pelo BKO e pelo push sobe a revisão, reabre `pendente`, limpa motivo e erros e publica os dois eventos uma vez; repetição
  idempotente; `REVISAO_DESATUALIZADA` com dois corretores; `CADASTRO_NAO_RECUSADO`; substituição pelo `id` novo (APK v1.0.28): Y
  apagado, X com revisão + 1, tentativas re-apontadas com `cliente_id_original`; 23505 de `cliente_pkey` em corrida (mesmo tenant →
  `ja_existia`; outro tenant → `CADASTRO_INDISPONIVEL`) e de `cliente_documento_uk` (→ `DOCUMENTO_JA_CADASTRADO`); RLS entre tenants
  na tabela nova; motivo e erros fora da auditoria; retorno de revisão antiga não muda o cliente.
- Banco (`db/testes/`): checks, grants por coluna do `macuxi_leitura`, carga inicial das tentativas, migração do parâmetro conferida
  contra o domain, up/down.
- Integração (`modules/integracao/api/clientes-erp.db.test.ts`): reabertura da mesma linha (`rejeitado → pendente`, `revisao + 1`,
  `tentativas = 0`); `vinculado` não reabre; `GET /pendentes` com `revisao` e `hash`; retorno obsoleto (200, sem publicar); fato novo
  na mesma revisão (200, publica); `revisao_desconhecida`; erros mascarados e fora do log.

## Alternativas
- **Mapear o `id` novo do APK v1.0.28 para o original (alias X → Y)**: mantém o `id` original, mas quebra o que o vendedor fez offline
  para X antes do push (check-in, visita, pedido) ou obriga a resolver alias no SDK e em todos os módulos; descartada (item 4).
- **Manter o caminho antigo para sempre** (`id` novo = cliente novo, sem histórico): é o que o dono do produto pediu para trocar.
- **Republicar `core.cliente.pre_cadastrado@1` na revisão**: o Hub trataria igual, mas o fato é outro (correção, com quem e quando);
  evento novo deixa o registro de eventos legível.
- **Hash guardado em `core.cliente`**: a consulta calcula pelos dados atuais (que são os da revisão atual) e a tentativa guarda o de cada
  revisão; coluna a mais seria a mesma informação em dois lugares.
- **Dois parâmetros com a tela juntando**: a RN-CORE-16 e a RN-CORE-79 seguiriam podendo divergir; o dono do produto pediu uma lista só.
- **Hub v2**: tudo cabe como aditivo na v1 (RN-INT-09); o Conector antigo segue funcionando sem `revisao`.

## Consequências
- O BKO passa a ver o motivo e os erros por campo (analista e admin); a RN-CORE-78 muda nesse ponto.
- O APK v1.0.28 segue funcionando: o pull traz campos novos que ele ignora; a correção dele (id novo) vira a revisão seguinte; o espelho do
  parâmetro mantém o formulário antigo coerente com a API. O espelho e o caminho de substituição saem com a versão mínima > 1.0.28.
- Com o receptor do push no ar, os pré-cadastros represados nos aparelhos v1.0.28 chegam juntos no primeiro sync depois do deploy.
- **Para o dono do produto confirmar antes do deploy**: (a) `vinculado` de revisão antiga vale (item 8); (b) os efeitos da lista única
  sobre clientes do ERP e sobre o pré-cadastro (item 6, consulta de conferência).
- Ordem do lote: migração 0098 → Core (contratos, domain, API, receptor, BKO, app) e Integração juntos → BKO web no mesmo deploy (a rota
  `parametros/pre-cadastro` sai).

## Texto proposto das RN (o gerente-projetos aplica no doc 03)
- **RN-CORE-16 Cadastro completo** (revista na v1.0.29): o cliente só fica **ativo para faturamento** quando todos os campos da lista
  `cliente.campos_obrigatorios` da empresa estão preenchidos e válidos. Padrão: razão social; CNPJ ou CPF com dígito verificador válido;
  inscrição estadual ou "isento" (só para CNPJ); logradouro, número, bairro, município, UF e CEP. A empresa acrescenta ou tira campos em
  Parâmetros › Clientes, mas não tira a razão social nem o CNPJ/CPF. **É a mesma lista do pré-cadastro (RN-CORE-79).** A verificação
  roda na integração (Hub), na edição pelo BKO, na sincronização e no pré-cadastro, e mora no `domain` do Core.
- **RN-CORE-78 Pré-cadastro de cliente** (revista na v1.0.29): o FDV só faz o pré-cadastro e quem aprova é o ERP. O cadastro feito no
  Campo ou no BKO chega como pendente e entra na fila do ERP assim que o servidor o recebe. O ERP devolve o código ou a recusa com motivo
  e, se quiser, os erros por campo; o mesmo código é idempotente, outro código é conflito e código já usado por outro cliente é recusado.
  **O recusado é corrigido e reenviado no mesmo cadastro**, pelo vendedor no app ou pelo analista ou admin no BKO: cada reenvio é uma
  revisão nova, com número, hash dos dados, quem corrigiu e quando, e o resultado do ERP (motivo e erros por campo) fica no histórico.
  Só o recusado pode ser corrigido; quem corrigiu em cima de uma revisão que já mudou recebe aviso para recarregar. O vendedor continua
  vendendo para o cliente pendente ou recusado. O motivo e os erros vão ao vendedor do cliente e a quem corrige no BKO, nunca a log nem
  à auditoria. Até a versão mínima do Campo passar de 1.0.28, o cadastro novo com o CPF/CNPJ de um recusado (app antigo) assume o
  histórico do recusado como a revisão seguinte.
- **RN-CORE-79 Campos obrigatórios do pré-cadastro** (revista na v1.0.29): o pré-cadastro exige os campos da lista única de Parâmetros ›
  Clientes (RN-CORE-16), menos complemento e geolocalização; razão social e CPF/CNPJ são sempre obrigatórios. A inscrição estadual só é
  exigida para CNPJ ("isento" vale). A regra vale no app offline e a API revalida; a mudança é auditada.
- **RN-INT-22 Cliente novo para o ERP** (revista na v1.0.29): o Hub oferece ao ERP, em `/integracao/v1`, os pré-cadastros pendentes ainda
  sem código, em ordem de chegada, cada um com a revisão e o hash dos dados, e recebe de volta o código ou a recusa com motivo e,
  opcionalmente, os erros por campo, como o retorno de pedidos da RN-INT-08. O reenvio reabre a mesma linha da fila (de rejeitado para
  pendente, com a revisão nova). O retorno informa a revisão: recusa de revisão antiga não vale sobre a nova; o código do ERP vale mesmo
  de revisão antiga. Recusa nova na mesma revisão, com outro motivo ou outros erros, é um fato novo. Só o Conector que recebe pedidos usa
  essas rotas. Motivo e erros nunca vão a log.

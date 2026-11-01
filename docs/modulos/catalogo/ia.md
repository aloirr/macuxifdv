# Catálogo — chamada ao provedor de IA da busca (T-0041)

Código: `modules/catalogo/api/ia/` (`provedor-http.ts`, `buscar.ts`) + regras puras em `domain/` (`ia.ts`, `parametros.ts`, `limite-ia.ts`). Testes: `api/ia/provedor-http.test.ts`, `domain/ia.test.ts`, `domain/parametros.test.ts`. Regra de origem: **RN-CAT-03** (só consulta respondida consome; falha e tempo esgotado não) e RF-CAT-01/02 (contingência e aviso discreto).

## Tempo limite real
- `criarPortaInterpretacaoHttp({ url, timeoutMs, fetch?, criarSinalTempo?, montarCorpo?, extrairFiltros?, cabecalhos? })` implementa `PortaInterpretacaoLlm` (domain) sobre HTTP. **Uma chamada só, sem retry em cascata.**
- O `fetch` recebe um `AbortSignal` = `AbortSignal.timeout(timeoutMs)`; se o chamador passar `signal` (`interpretarBusca({ signal })` → `porta.interpretar(entrada, { signal })`), os dois são combinados com `AbortSignal.any`. Estourar o prazo **cancela a requisição de fato** (conexão liberada).
- A espera também compete com o signal (`Promise.race`): um `fetch` que ignore o signal não prende a busca além do prazo.
- Erros: prazo estourado ⇒ `ErroTempoEsgotadoIa`; rede, HTTP não-2xx e corpo que não é JSON ⇒ `ErroProvedorIa` (`motivo`: `rede` | `http` | `resposta_invalida` | `cancelada`; a mensagem nunca leva o texto da pergunta). Cancelamento pelo chamador não é "tempo esgotado".
- **Parâmetro**: `resolverTimeoutIaMs(valor?)` (`domain/parametros.ts`): padrão **8000 ms**, aceita inteiros de **1000 a 30000 ms**, fora disso `RangeError` em português. O resultado vai em `timeoutMs`. **Premissa**: `ParametrosCatalogo` (contracts, estrito) ainda não tem o campo; a API lê o valor do tenant (ex.: `ia_timeout_ms`) por onde a configuração vier e passa à função. Pedido de contrato abaixo.

## Fallback sem IA
- `interpretarBusca` (domain) nunca lança por falha do provedor: erro, HTTP não-2xx, corpo inválido, tempo esgotado ou cancelamento ⇒ filtros das **regras locais** (`interpretarConsulta`) + `AVISO_BUSCA_FALHOU` ("A busca inteligente está indisponível agora. Mostramos a busca simples; tente de novo em instantes.").
- O contrato `ResultadoBusca` já comporta o aviso: `resumoDaInterpretacao(r)` devolve `interpreted_by` (`llm`|`regras`), `degraded` (true se há aviso) e `notice`. Nenhuma mudança de contrato é necessária para o aviso.

## Orquestração e log (`interpretarComMedicao`)
- Mede a duração (`relogio`, padrão `performance.now`) e registra **um** log por chamada ao provedor, no formato pino (`log.info|warn(obj, msg)`): `{ evento: 'catalogo.ia.interpretacao', tenant_id, duracao_ms, desfecho, origem, timeout_ms }`. `info` quando respondida; `warn` em erro/tempo esgotado. **Sem texto da pergunta, sem usuário, sem dado pessoal** (testado). Busca offline/limite/sem porta não chama o provedor e não gera log.
- Ordem na rota: cache (não consome) → `verificarConsultaIa` → `interpretarComMedicao` → resposta com `resumo`.

## Cota (RN-CAT-03)
- `debitarCota` (callback da rota) é chamado **no máximo uma vez e só quando o provedor respondeu** (`desfecho = respondida`). Erro, HTTP não-2xx, corpo que não é JSON, tempo esgotado, cancelamento, cache, offline, limite e sem provedor **não debitam** (testado).
- Distinção mantida da RN-CAT-03: resposta 2xx com JSON **fora do formato de filtros** (Zod) ainda conta (houve custo; cai na contingência). Já corpo que nem é JSON é falha do provedor e não conta.
- Falha ao gravar o débito não derruba a busca: vai para o log (`catalogo.ia.debito_falhou`, só `tenant_id`).
- Persistência: o débito real (incremento atômico condicional `update … set usadas = usadas + 1 where usadas < limite returning`) é do banco; o domain tem a regra (`registrarDesfechoIa`).

## Testes com timers falsos
`AbortSignal.timeout` usa um timer interno do Node que `vi.useFakeTimers()` **não** controla. Por isso a porta aceita `criarSinalTempo` (padrão `AbortSignal.timeout`); os testes injetam um equivalente com `setTimeout` (controlável) que aborta com o mesmo `TimeoutError`, e há um teste com o `AbortSignal.timeout` real (timers reais, 30 ms) provando a ligação padrão.

## Premissas e fora do escopo
- Formato do corpo/resposta é do provedor escolhido (`montarCorpo`, `extrairFiltros` injetados); a porta HTTP é genérica. Segredos/URL vêm do `.env` na montagem da rota (rota `/v1/catalogo/busca` ainda não existe — próximas tarefas).
- O "Pergunte ao catálogo" (`PortaRespostaLlm`) e os embeddings (`PortaEmbeddings`) reutilizarão o mesmo padrão em tarefas seguintes; esta entrega cobre só a interpretação da busca.

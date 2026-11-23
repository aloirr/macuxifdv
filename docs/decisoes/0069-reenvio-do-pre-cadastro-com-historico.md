# ADR 0069 — Reenvio do pré-cadastro recusado no mesmo cliente, com histórico de revisões

- **Status**: proposta (o número 0069 vale depois de conferido no `.coord/quadro.md` pelo gerente-projetos; livre no `origin/main` c460e92).
- **Data**: 2026-11-23 (Manaus)
- **Versão**: v1.0.30. Regras: RN-CORE-16 (revista), RN-CORE-78 (revista), RN-CORE-79 (revista), RN-INT-22 (revista); RN-CORE-59 e RN-CORE-77 como referência (item 10).
- **Autor**: engenheiro-software
- **Origem**: decisões do dono do produto R-20261123-141413 e R-20261123-142306 (reenvio = o mesmo pré-cadastro corrigido, com histórico;
  API do Core para o BKO corrigir os recusados; uma lista só de campos obrigatórios; Hub reabre a mesma linha da fila, com `revisao`,
  `hash` e erros por campo). Também fecha o 🟡 da revisão da v1.0.28 em `modules/core/api/cliente-cadastro.ts:60-63` (o 23505 vira
  409 genérico) e a falta de testes de banco da substituição.
- **Respostas do dono do produto às premissas** (23/11/2026, pelo gerente-projetos): (a) **mudou** — "cliente com dois códigos: o
  pré-cadastro gera o código FDV; o código ERP fica em branco; ao voltar aprovado do ERP, preenche o código ERP e atualiza os demais
  dados com o que o ERP mandou (o ERP manda)" → item 10 e item 8 revisto; (b) aceita: a lista única pode marcar como incompletos
  clientes do ERP; (c) aceita: empresa sem parâmetro passa a exigir IE (CNPJ) e endereço no pré-cadastro; (d) aceita: a correção pelo
  BKO é só para analista e admin. O receptor do push (item 3) vai na v1.0.30, sem hotfix na v1.0.28.
- **Segunda rodada, decidida** (23/11/2026, "1 B / 2 A / 3 A", pelo gerente-projetos): (1) **B** — **todo cliente ganha Código FDV**,
  inclusive o que vem direto do ERP: o cliente novo gravado pelo consumidor da carga do ERP e a carga inicial dos clientes que já
  existem, em todas as empresas (migração 0098); gerado pelo banco, 5 dígitos, contador por empresa, nunca reaproveitado → item 10 e
  D.7 reescritos; (2) **A** — depois da aprovação, os dados do ERP chegam pela carga normal de clientes e sobrescrevem os do vendedor
  (como já estava no item 10); (3) **A** — os duplicados que a v1.0.28 já criou não são tratados agora (consequências).
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
- Fora do hash: `id`, `codigo_fdv`, `origem`, `revisao_base` e tudo o que não é dado do cliente. O hash não é segredo nem identificador público: não
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
- **Efeitos aceitos pelo dono do produto** (respostas (b) e (c), 23/11/2026): (a) tenant que marcou no pré-cadastro um campo fora da
  RN-CORE-16 (ex.: telefone) passa a ver clientes do ERP sem esse campo como cadastro incompleto (RN-CORE-17: pedido só como
  orçamento); (b) tenant sem nenhuma das chaves passa a exigir no pré-cadastro IE (CNPJ) e endereço. A consulta de conferência do
  banco-dados (`db/scripts/conferencia-0098.sql`) segue no lote, só para o gerente informar quantos tenants mudam; não é mais condição
  do "aprovo deploy".

### 7. API do Core para o BKO corrigir os recusados
Rotas com `superficie: 'bko'`, `carteira: 'nao_se_aplica'` (o tenant inteiro), licença do Core pelo SDK, RLS do tenant; a API revalida
tudo o que o BKO mandar (mesma função compartilhada do item 3). O motivo e os erros por campo passam a ir também a quem tem a ação
`cliente.pre_cadastro_recusados` (analista e admin); para os demais perfis, fora o vendedor da carteira, seguem nulos
(no pull e no Cliente 360 a regra é a função pura `perfilVeRecusa(perfil)` do domain do Core, que substitui
a `motivoRecusaVisivel` da ADR 0067). Nunca em log nem na auditoria. **Decidido** (resposta (d)):
ver e corrigir recusados no BKO é só para analista e admin; supervisor e gerente não recebem as ações.

### 8. Hub `/integracao/v1` (RN-INT-22), aditivo na v1
- A revisão nova **reabre a mesma linha** de `integracao.cliente_fila_erp` (`rejeitado → pendente`, `revisao` nova, `hash` e `payload`
  novos, `tentativas = 0`, `enviado_em`, `motivo` e `erros` limpos; `recebido_em` fica o do primeiro recebimento, que mantém a ordem da
  fila). Linha `vinculado` nunca reabre.
- `GET /clientes/pendentes` entrega `revisao` e `hash` em cada cliente (`tentativa` passa a contar as entregas da revisão).
- `POST /clientes/{cliente_uuid}/retorno` aceita `revisao` (opcional; ausente = a revisão atual da linha, que é o que o Conector antigo
  quer dizer) e, em `rejeitado_erp`, `erros: [{ campo, codigo, mensagem }]` (opcional, até 50). Regras (`aplicarRetornoCliente`):
  - `revisao` maior que a da linha → 422 `revisao_desconhecida`;
  - `rejeitado_erp` de revisão **anterior** → 200 `{ obsoleto: true }`, sem gravar nem publicar (não sobrescreve a revisão nova);
  - `vinculado` de revisão anterior → **vale** (decidido; coerente com a resposta (a), "o ERP manda"): o cliente existe no ERP com
    aquele código e ignorá-lo faria o ERP criar o cliente de novo na revisão nova. Grava, publica com a `revisao` informada e a linha
    fica `vinculado` (não é mais oferecida). Os dados que valem são os do ERP (item 10), e não os da revisão nova: a revisão nova não
    chega ao ERP, e a carga do ERP sobrescreve o que o vendedor corrigiu;
  - `vinculado` sobre linha `rejeitado` da **mesma** revisão → **vale** (muda: era `transicao_invalida`). O ERP recusou e depois criou o
    cliente (ex.: o cadastro do ERP corrigiu do lado dele); o ERP manda. Linha `pendente` da revisão atual que nunca foi entregue segue
    `cliente_nao_entregue`;
  - mesma revisão: regras de hoje; `rejeitado_erp` sobre linha `rejeitado` com o mesmo motivo e os mesmos erros = `repetido: true`;
    com motivo ou erros diferentes = **fato novo**: 200, grava e publica.
- No Core, `decidirVinculoErp` acompanha: `recusado` sem código passa a **gravar** (sai o resultado `cadastro_recusado`); o update do
  vínculo limpa `motivo_recusa` e `erros_recusa` (os CHECKs da 0097/0098 exigem nulos fora de `recusado`). A tentativa da `revisao` do
  retorno fica `aceito` com `respondido_em`; a tentativa atual, se for outra e estiver `aguardando`, também fica `aceito` (o cliente foi
  aceito no ERP; a auditoria `cliente.vincular_erp` leva a `revisao` vinculada).
- O retorno de sucesso traz `revisao` (a da linha depois do retorno) e `obsoleto` (só quando `true`). Mesma permissão de hoje (Conector
  que "Recebe pedidos", senão 403), sem cursor.
- Erros: `mensagem` passa por `mascararDadoPessoal` (`@macuxi/comum`) e é cortada em 300 caracteres antes de gravar; motivo, erros e hash
  nunca vão a log (o log do retorno leva `cliente_uuid`, `revisao`, `status`, `repetido`, `obsoleto`).
- Incompatível (tirar campo, tornar `revisao` obrigatório no retorno, mudar o sentido de `tentativa` para o total) = `/integracao/v2`.

### 9. Eventos
- **Novo**: `core.cliente.pre_cadastro_revisado@1` (Core publica; Integração consome) — fato distinto do recebimento.
- **Aditivos, mesma versão** (campos opcionais; consumidores com `eventoTolerante`): `integracao.cliente.retorno_erp@1` ganha `revisao` e
  `erros`; a consulta `core.clientes_pre_cadastro_sem_erp@1` ganha `revisao`, `hash` e `codigo_fdv` (item 10) na saída.
- `core.cliente.pre_cadastrado@1` não muda (a revisão vai pela consulta).

### 10. Cliente com dois códigos: Código FDV e Código ERP (resposta (a) do dono do produto)
Hoje (base c460e92) o cliente tem um código só: o **Código ERP** é `core.cliente.external_id` (0002; único vivo por tenant,
`cliente_external_uk`), nulo no pré-cadastro até o retorno `vinculado`. **Não existe Código FDV de cliente**: o `id` é UUID gerado no
aparelho (não é código para pessoa) e o `codigo_fdv` que existe é só do usuário (`core.usuario.codigo_fdv`, 0080, RN-CORE-59).
- **Código FDV** = coluna nova **`core.cliente.codigo_fdv text`**, no mesmo molde da RN-CORE-59 (0080): gerado pelo banco em sequência
  por empresa, só dígitos, 5 dígitos (`00001`…`99999`), único entre os vivos do tenant, só de leitura e nunca reaproveitado. Contador
  próprio `core.cliente_codigo_fdv_contador` (não divide a numeração com o usuário).
- **Quem tem (decisão 1 B)**: **todo cliente vivo**, qualquer que seja a origem (`campo`, `bko` ou `erp`). Não há mais exceção por
  origem: o CHECK `cliente_codigo_fdv_origem` da versão anterior desta ADR sai, e entra o CHECK `cliente_codigo_fdv_vivo`
  (`deleted_at is not null or codigo_fdv is not null`): cliente vivo sem código é erro de banco (23514), não estado possível.
- **Gatilho no insert de qualquer origem**: `cliente_codigo_fdv_emitir` (BEFORE INSERT) numera todo insert com `codigo_fdv` nulo — o
  pré-cadastro da rota do BKO, o receptor do push do Campo e o cliente novo do `consumidorClienteDoErp`. O código informado fica (backup
  da 0072 e herança do item 4), sobe o contador para `greatest(atual, n)` e passa pelo CHECK de formato e pelo índice único, como na 0080.
  `cliente_codigo_fdv_somente_leitura` (BEFORE UPDATE): mudar o código = 23514 → 422 `CODIGO_FDV_SOMENTE_LEITURA`; o apagado sem
  código que volta a vivo ganha o próximo número no mesmo update (como o usuário na 0080).
- **Upsert da carga do ERP sem gastar número**: o consumidor grava com `insert ... on conflict (tenant_id, external_id) do update`, e o
  BEFORE INSERT roda antes de o Postgres descobrir o conflito. Sem cuidado, cada carga de um cliente que já existe queimaria um número
  (buraco a cada minuto do Conector; o contador chegaria a 99999 em semanas). Por isso o gatilho, quando o insert traz `external_id`,
  **primeiro procura o vivo com o mesmo `(tenant_id, external_id)`** (índice `cliente_external_uk`): achou → não emite, **copia o código
  do vivo para a linha proposta** e trava o vivo com `for no key update` até o fim da transação; não achou → emite. A cópia é
  obrigatória: o Postgres confere os CHECKs (`ExecConstraints`) **antes** de detectar o conflito do `on conflict`, e com o código nulo o
  `cliente_codigo_fdv_vivo` recusaria toda carga repetida do ERP. O conflito troca a linha proposta pelo update, que não mexe no código:
  não gasta número e o código do vivo não muda. A trava é a mesma que o update do conflito pega; com ela o vivo não pode ser apagado
  entre a procura e o conflito, então a linha proposta nunca é gravada com o código dele (a ressalva da versão anterior, "o vivo some e
  a outbox repete", deixa de existir). Corrida entre duas cargas do mesmo cliente novo grava um cliente só e perde no máximo um número
  (buraco aceito, nunca repete). O consumidor não muda. (Desvio do banco-dados em 266cece, aceito pelo engenheiro-software: a versão
  anterior deste item mandava deixar o código nulo.)
- **Carga inicial (backfill), em todas as empresas**: na 0098, os clientes **vivos** de cada tenant recebem `00001`… em ordem
  determinística de **`created_at, id`** (o `id` desempata as linhas da mesma carga do ERP, que têm o mesmo `created_at`), num update só,
  antes de criar os gatilhos (o somente leitura recusaria o update). O contador de cada tenant termina no maior número emitido; tenant
  sem cliente vivo fica sem linha e nasce no primeiro insert.
- **Apagados (decisão de desenho, coerente com a 0080)**: os clientes apagados antes da 0098 **ficam sem código** e não consomem
  número. Não aparecem em tela nem no pull, e numerá-los gastaria a faixa de 5 dígitos com linhas mortas. O apagado depois da 0098
  guarda o código (fica fora da unicidade dos vivos e o número continua contado; nunca volta a ser emitido). O apagado antigo que
  voltar a vivo ganha o próximo número.
- **Acima de 99999 (decisão de desenho, igual à 0080)**: não há teto. O 100.000º cliente da empresa recebe `100000`, depois `100001`…
  (`lpad(n, greatest(5, dígitos de n), '0')`; o CHECK de formato da 0080 aceita 6 ou mais dígitos sem zero à esquerda). "5 dígitos" é o
  mínimo, não o máximo; nada é recusado nem reaproveitado. O domain usa `formatarCodigoFdv` e `validarCodigoFdv`
  (`modules/core/domain/codigo-fdv.ts`), que já seguem essa regra.
- **Quando aparece**: o pré-cadastro recebe o código quando o **servidor** o recebe (o aparelho não gera número sequencial offline: até
  o primeiro sync o app mostra o cliente sem ele, e o pull traz o código); o cliente do ERP recebe o código quando a carga o grava.
- **Substituição do APK v1.0.28 (item 4)**: o `id` novo X herda o `codigo_fdv` do recusado Y (Y é apagado antes e o índice único só olha
  os vivos). O código acompanha a linhagem, como o histórico.
- **Código ERP** = `external_id`, em branco até o retorno `vinculado` (item 8), que o preenche. Sem coluna nova.
- **O ERP manda nos dados** (decisão de desenho): o retorno `vinculado` do Hub **continua só com o código** (sem dados do cliente). Os
  dados chegam pela **carga normal de clientes do ERP** (`integracao.cliente.atualizado@1` → `consumidorClienteDoErp`, upsert por
  `external_id`), que já existe e já é o único caminho ERP → `core.cliente`. Aceitar dados no retorno criaria um segundo caminho com o
  mesmo mapeamento (uma informação, um lugar). Depois do vínculo, a primeira carga com aquele `external_id` sobrescreve os campos
  gravados pela carga (`COLUNAS_GRAVADAS`: razão social, fantasia, documento, IE, contato, endereço, ativo, cadastro incompleto) e
  aplica carteira, contatos, pagamento, canal, filial e financeiro do ERP; campo que o ERP manda vazio fica vazio. Entre o vínculo e a
  carga, o cliente mostra os dados do vendedor (minutos, pela periodicidade do Conector).
- **Campos que o vendedor digitou**: são sobrescritos pelos do ERP; não ficam guardados à parte (a tentativa guarda só hash e nomes de
  campos). Ficam: `codigo_fdv`, `origem_cadastro` (`campo`/`bko`), `revisao_cadastro`, as tentativas e `status_cadastro = 'aprovado'`.
  A coordenada segue a RN-CORE-77: a do pré-cadastro é gravada com `coordenada_origem = 'manual'` (hoje fica nula e o ERP sem
  coordenada a apagaria); o ERP com coordenada a substitui.
- **Carga que chega antes do vínculo**: hoje, se o ERP manda na carga um cliente cujo CPF/CNPJ está num pré-cadastro sem código, o
  consumidor grava um cliente **novo** sem documento (duplicado; o `vinculado` depois cai em `codigo_em_uso`). Passa a lançar
  `ReferenciaAusenteErp('cliente_pre_cadastro')` (a outbox repete com espera, RN-INT-04) até o `vinculado` preencher o `external_id`;
  então o upsert por `external_id` atualiza o próprio pré-cadastro. Decisão pura `decidirDocumentoDoErp` no domain. Se o ERP nunca
  mandar o `vinculado` (recusou e criou o cliente por fora), o Conector resolve mandando o `vinculado` com o código (vale sobre
  `rejeitado`, item 8); esgotadas as repetições, o evento vai para a lista de falhas da Integração, como qualquer referência ausente.
- **Hub**: `ClienteParaErp` ganha `codigo_fdv` (opcional, aditivo na v1), para o ERP guardar a referência do FDV; a consulta
  `core.clientes_pre_cadastro_sem_erp@1` o devolve. Fora do hash (não é dado digitado e não muda entre revisões).
- **Onde aparecem os dois** (nenhuma tela mostra os dois hoje; detalhe na resposta (ii) do desenho, seção H).

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
  hash: HashPreCadastroSchema.nullable(),                       // nulo = tentativa anterior à v1.0.30 (migração)
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
- Saem de uso no app v1.0.30 e ficam só para o espelho legado (marcar `@deprecated`, remover com a versão mínima > 1.0.28):
  `PARAMETRO_PRE_CADASTRO_OBRIGATORIOS`, `CAMPOS_PRE_CADASTRO_CONFIGURAVEIS`, `ObrigatoriosPreCadastroSchema`,
  `obrigatoriosPreCadastroDasLinhas`. Sai `ParametroPreCadastroSchema` (a rota sai).
- `cadastro.ts`: `export const CAMPOS_CADASTRO_FIXOS = ['razao_social', 'documento'] as const` (o domain deixa de ter a cópia
  `CAMPOS_FIXOS`); `ParametroCamposObrigatoriosClienteSchema = z.object({ obrigatorios: z.array(CampoCadastroCliente).max(14)
  .refine(semRepetir) }).strict()` (GET devolve a lista efetiva, já com os fixos; PUT aceita sem eles e o servidor acrescenta);
  `camposExigidosDasLinhas(linhas)` para o app ler o pull `parametro` (mesmo molde de `obrigatoriosPreCadastroDasLinhas`).
- `sync.ts` (`ClienteSyncSchema`, aditivos opcionais): `revisao_cadastro: z.number().int().min(1).nullable().optional()`,
  `erros_recusa: ErrosCampoCadastroSchema.nullable().optional()` (mesma regra de visibilidade do `motivo_recusa`),
  `codigo_fdv: z.string().nullable().optional()` (item 10; vem em todo cliente, de qualquer origem; ausente = emissor antigo).
- Item 10 (aditivos): `codigo_fdv: z.string().nullable()` em `PreCadastroClienteSaidaSchema` (nulo só se a migração não entrou),
  `PreCadastroAtualSchema` (+ `external_id`), `RecusadoItemSchema` e `ClientePreCadastroParaErpSchema`; no contrato do Cliente 360
  (app e BKO) `codigo_fdv` ao lado do `external_id`. `PreCadastroClienteSchema` e `CorrecaoPreCadastroSchema` seguem `.strict()` sem o
  campo (mandar `codigo_fdv` = 400/422; nunca se grava pelo corpo).

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
| `decidirVinculoErp` (revista, item 8): `recusado` sem código → `gravar` (sai `cadastro_recusado`); revisão do retorno ≤ atual vale; maior → `nada/revisao_desconhecida` | idem | RN-CORE-78, RN-INT-22 |
| `decidirDocumentoDoErp(dono: { origem_cadastro: string; external_id: string \| null } \| null, externalIdDoEvento: string): 'seguir' \| 'esperar_vinculo' \| 'sem_documento'` (item 10: pré-cadastro sem código com o mesmo documento = esperar; outro dono = sem documento, como hoje) | `domain/cliente-erp.ts` | RN-CORE-78, RN-INT-04 |
| `obrigatoriosDoPreCadastro(exigidos: readonly CampoCadastroCliente[]): CampoCadastroCliente[]` | `domain/pre-cadastro-campos.ts` | RN-CORE-16, RN-CORE-79 |
| `validarPreCadastro(dados, exigidos: readonly CampoCadastroCliente[])` (revista: obrigatório pela `cadastroCompleto` + formatos de hoje) | idem | RN-CORE-16, RN-CORE-79 |
| `projecaoLegadaObrigatorios(exigidos: readonly CampoCadastroCliente[]): CampoPreCadastroConfiguravel[]` | idem | RN-CORE-79 (compat. v1.0.28) |
| `idDoReenvio` (app, revista): o recusado reenvia com o **mesmo** id e `revisao_base = revisao_cadastro` | `app/lib/pre-cadastro-local.ts` | RN-CORE-78 |
Saem: `camposFaltantesPreCadastro` e `camposObrigatoriosPreCadastro` (trocadas por `obrigatoriosDoPreCadastro` + `cadastroCompleto`) e
`motivoRecusaVisivel` (trocada por `perfilVeRecusa(perfil): boolean`, que filtra o motivo e os erros por campo de uma vez);
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
  `erros_recusa` pelo `errosRecusaSeguros`. No `vinculado` (item 8): grava sobre `recusado`, limpa `motivo_recusa` e `erros_recusa`.
- Item 10: `consumidorClienteDoErp` usa `decidirDocumentoDoErp` (pré-cadastro sem código com o mesmo documento →
  `ReferenciaAusenteErp('cliente_pre_cadastro')`); o insert do pré-cadastro (rota e receptor) grava `coordenada_origem = 'manual'` quando
  vem coordenada; a substituição do item 4 copia o `codigo_fdv` de Y para X; selects do pull, do Cliente 360, da lista de recusados e da
  consulta do Hub incluem `codigo_fdv`; 23514 `cliente_codigo_fdv_somente_leitura` → 422 `CODIGO_FDV_SOMENTE_LEITURA`. O
  `consumidorClienteDoErp` não muda por causa do código (o gatilho numera o cliente novo do ERP e não gasta número no upsert de quem já
  existe); um 23514 `cliente_codigo_fdv_vivo` nele é corrida e segue o caminho de erro da outbox (repete).

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
7. Código FDV do cliente (item 10, decisão 1 B), na mesma 0098 (ainda não está no `main`), no molde da 0080, nesta ordem:
   a. `core.cliente.codigo_fdv text` (sem default) com o CHECK de formato da 0080 (`cliente_codigo_fdv_formato`, a mesma regex: 5
      dígitos `00001`–`99999` ou 6+ sem zero à esquerda) e o índice único `cliente_codigo_fdv_uk (tenant_id, codigo_fdv) where
      deleted_at is null and codigo_fdv is not null`. **Sem** o CHECK `cliente_codigo_fdv_origem` da versão anterior.
   b. `core.cliente_codigo_fdv_contador` (uma linha por tenant, id por `uuid_de_chave`, nunca diminui, piso pelo maior código gravado,
      vivo ou apagado, RLS enable + force + `isolamento_tenant` + `manutencao`, `macuxi_app` só select, `macuxi_leitura` select; fora do
      sync em `db/src/excecoes.ts`; na 1ª leva da ordem do backup da 0072).
   c. Carga inicial de **todos os clientes vivos de todas as empresas** (`deleted_at is null`, qualquer `origem_cadastro`):
      `row_number() over (partition by tenant_id order by created_at, id)`, gravado com `lpad(n, greatest(5, dígitos de n), '0')`, num
      update só; apagados ficam nulos; o contador de cada tenant nasce no maior `n` (tenant sem vivo: sem linha). O `updated_at` dos
      vivos anda (o pull leva o código). O update roda pelo dono da migração, sem outbox: nenhum evento é publicado.
   d. CHECK `cliente_codigo_fdv_vivo` (`deleted_at is not null or codigo_fdv is not null`), criado depois da carga.
   e. Função SECURITY DEFINER `core.cliente_codigo_fdv()` (search_path fixo, sem EXECUTE a ninguém) e os gatilhos
      `cliente_codigo_fdv_emitir` (BEFORE INSERT: código informado → fica e sobe o contador; linha inserida já apagada e sem código
      (backup) → fica sem código; código nulo com `external_id` e vivo com o mesmo `(tenant_id, external_id)` → não emite: **copia o
      código do vivo** para a linha proposta e trava o vivo com `for no key update` até o fim da transação, porque o CHECK
      `cliente_codigo_fdv_vivo` é conferido antes do conflito do `on conflict` (item 10); senão emite, com a linha do contador travada
      até o fim da transação) e `cliente_codigo_fdv_somente_leitura` (BEFORE UPDATE: mudar = 23514 hint RN-CORE-78; apagado sem código
      que volta a vivo ganha o próximo número). O contador que diminui (`cliente_codigo_fdv_contador_nao_diminui`) também sai com 23514
      e hint RN-CORE-78. Os gatilhos rodam antes do `cliente_updated_at` e não mexem nele.
   f. Grant de SELECT da coluna ao `macuxi_leitura`; o `.down.sql` apaga gatilhos, função, CHECKs, índice, contador e coluna (perde os
      códigos; volte antes o código do Core e do Hub que lê a coluna).
   Volume: o backfill escreve uma vez cada cliente vivo (dezenas de milhares por empresa grande) e cada aparelho puxa a carteira inteira
   de novo no primeiro sync depois do deploy. Medido pelo banco-dados (23/11/2026, Postgres 16 local, fsync desligado): **12,3 s** a
   0098 inteira com 240 mil clientes vivos (200 mil numa empresa); em produção conte com mais. Durante esse tempo os clientes vivos
   ficam travados para escrita (o update roda na transação da migração): a 0098 roda na janela do deploy, **com a carga do ERP
   parada** (Consequências, plano de deploy). Depois dela, o upsert da carga sobre cliente que já existe custa ~0,75 ms por linha. Se uma view do Conector (`db/conector/`) passar a expor o código, sai no PR conjunto do kit (R-20261115-171000);
   esta ADR não pede.

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
  `obsoleto`); nova `decidirEntradaClienteNaFila(atual: { revisao: number; estado: EstadoClienteNaFila } | null, nova: { revisao: number }):
  'inserir' | 'reabrir' | 'nada'` (reabre só revisão maior e linha não `vinculado`); `iguaisErrosRetorno(a, b): boolean` (compara motivo
  normalizado e erros pela ordem de `campo, codigo`).
- `api/consumidores-cliente.ts`: `entrarClienteNaFila` passa a fazer upsert pela decisão acima (`on conflict (tenant_id, cliente_uuid) do
  update ... where cliente_fila_erp.revisao < excluded.revisao and cliente_fila_erp.estado <> 'vinculado'`), gravando `revisao` e `hash`
  da consulta; novo `consumidorClientePreCadastroRevisado` (mesma função) para `core.cliente.pre_cadastro_revisado@1`; manifesto da
  Integração passa a consumir o evento.
- `api/rotas-clientes.ts`: seleção e retorno com as colunas novas; `erros` gravados depois de `mascararDadoPessoal` e corte; log sem
  motivo, erros e hash.
- `docs/modulos/integracao/hub-api.md` §6.6b, o OpenAPI (`api/openapi`) e o guia PDF: campos novos e as regras do item 8.
- Item 8 revisto e item 10: `aplicarRetornoCliente` aceita `vinculado` sobre linha `rejeitado` da mesma revisão (sai a
  `transicao_invalida` desse caso; o texto "estado final" sai do domain, do hub-api.md, do OpenAPI e do guia);
  `ClienteParaErp` + `codigo_fdv: z.string().nullable().optional()` (da consulta), entregue em `GET /clientes/pendentes` e
  documentado (exemplos e coleções Postman/Insomnia).

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
- Item 10: Código FDV emitido no recebimento (rota e push) e no cliente novo da carga do ERP, em sequência sem repetir em inserts
  concorrentes do mesmo tenant; upsert da carga sobre cliente que já existe não gasta número (dez cargas seguidas do mesmo cliente =
  contador parado, código do vivo igual ao de antes); carga do mesmo cliente com o vivo apagado em outra transação espera a trava e
  não grava a linha proposta com o código dele; linha inserida já apagada e sem código fica sem código; backfill em dois tenants com ordem `created_at, id` (empate de `created_at` desempatado pelo `id`), apagados nulos,
  contador no maior número; `100000` depois de `99999` (contador posto em 99999 no teste); `cliente_codigo_fdv_vivo` recusa vivo sem
  código; apagado antigo que volta a vivo ganha número; hint `RN-CORE-78` no 23514 do somente leitura e do contador que diminui; restauração do backup em qualquer ordem; herdado por X na substituição, só
  de leitura (23514 → 422); `vinculado` sobre `recusado` grava e limpa motivo e erros;
  carga do ERP com o documento de um pré-cadastro sem código repete (`ReferenciaAusenteErp`) e, depois do `vinculado`, sobrescreve o
  próprio pré-cadastro (sem duplicar), mantendo `codigo_fdv`, `origem_cadastro` e a coordenada `manual` quando o ERP não manda
  coordenada; Hub: `vinculado` sobre `rejeitado` da mesma revisão = 200 e `codigo_fdv` em `GET /clientes/pendentes`.

### H. Telas: onde os dois códigos aparecem — sessão D (`modules/core/app`, `modules/core/web`), com o designer-ux
Hoje (c460e92) nenhuma tela mostra "Código FDV" e "Código ERP" do cliente: o app (Campo e Gestão usam a mesma ficha do Core) mostra o
`external_id` sem rótulo no subtítulo da ficha (`modules/core/app/components/cliente360.tsx:13`, `subtituloDaFicha`, usado em
`modules/core/app/telas/cliente.tsx:168`) e o usa só na busca (`modules/core/app/lib/carteira.ts:23`; `modules/vendedor/app/lib/catalog.ts:51`
pelo `erp_code` de `modules/vendedor/app/lib/pull.ts:128`); a lista de clientes do app (`modules/core/app/telas/clientes.tsx`) não mostra
código. O BKO não mostra nenhum: o cabeçalho do Cliente 360 mostra razão social, documento e cidade
(`modules/core/web/components/cliente360/cliente360-page.tsx:52`), a carteira mostra só o nome
(`modules/core/web/components/carteira/carteira-page.tsx:126`) e a lista de recusados (novo, branch do Core) não tem código.
A fazer (texto e forma pelo designer-ux; validação do design-de-marca se mudar layout):
- App, ficha do cliente: o subtítulo passa a mostrar os dois códigos com rótulo (ex.: "FDV 00012 · ERP C5007"; sem o que não existe);
  a busca da carteira casa também pelo Código FDV (`clienteCasaBusca` recebe `codigo_fdv`); o banco local do aparelho guarda a coluna.
  Como todo cliente tem Código FDV (decisão 1 B), o rótulo "FDV" aparece em todos; "ERP" só onde há `external_id`.
- App, pré-cadastro e "Corrigir e reenviar": mostra o Código FDV depois do sync (antes dele, nada).
- BKO, Cliente 360 (cabeçalho), Carteira (linha) e a lista e o formulário dos recusados: os dois códigos; o Código ERP vazio aparece
  como "Aguardando o ERP" só onde o status do pré-cadastro já é mostrado (uma informação, um lugar).
- Fora da sessão D: `modules/vendedor/app/lib/pull.ts` e `catalog.ts` (modulo-vendedor) se a busca do pedido também usar o Código FDV.

### I. Impacto nos commits já feitos
- **banco-dados 619cd07** (`0098`): acrescentar o item D.7 inteiro (a–f: coluna, CHECK de formato, índice único, contador, carga de
  **todos os vivos de todas as empresas** por `created_at, id`, CHECK `cliente_codigo_fdv_vivo`, função e gatilhos com a procura por
  `external_id` antes de emitir, grant, down) na própria 0098, **sem** o CHECK `cliente_codigo_fdv_origem`; testes em
  `db/testes/cliente-codigo-fdv.db.test.ts` (lista do item G), `db/src/excecoes.ts` (contador), ordem do backup da 0072,
  `modules/core/db/nuvem.ts`, `docs/banco/core.md` e a fixture `dois-tenants` (todo cliente vivo com código, inclusive os do ERP);
  tempo da 0098 medido com o volume da maior empresa. O resto da 0098 não muda. A conferência segue só informativa, com a contagem
  dos duplicados da v1.0.28 (pré-cadastros vivos sem código do ERP com auditoria `cliente.vinculo_erp_recusado` de resultado
  `codigo_em_uso`), sem correção (decisão 3 A).
- **modulo-core 7eaf9ab + 30e5847** (contratos, domain e API): contratos com `codigo_fdv` em todo cliente (A); `decidirVinculoErp`
  revista e `decidirDocumentoDoErp` nova, com testes (B); consumidor do retorno (grava sobre `recusado`, limpa motivo e erros,
  tentativas `aceito`), `consumidorClienteDoErp` (esperar o vínculo; nada a mudar pelo código, o gatilho numera), `coordenada_origem =
  'manual'` no insert do pré-cadastro, herança do código na substituição, `codigo_fdv` nos selects do pull (todo cliente), Cliente
  360, carteira do BKO, recusados e consulta do Hub, 422 `CODIGO_FDV_SOMENTE_LEITURA` (C); teste de banco do cliente novo do ERP com
  código e da carga repetida sem gastar número (G).
- **modulo-integracao 6082aec**: `aplicarRetornoCliente` aceita `vinculado` sobre `rejeitado` da mesma revisão (teste que hoje espera
  `transicao_invalida` muda); `ClienteParaErp.codigo_fdv` na seleção e no `GET /clientes/pendentes` (sempre preenchido para o
  pré-cadastro vivo; segue `nullable().optional()` no contrato, aditivo na v1); hub-api.md, OpenAPI, exemplos, coleções e guia PDF (com
  o `.sha256`) refeitos. A decisão 1 B não muda nada no Hub além disso (o ERP não recebe o Código FDV dos clientes que ele mesmo
  mandou). O `vinculado` de revisão antiga já está como decidido.
- **Sessão D** (app e BKO do Core): seção H, com o Código FDV em todo cliente (ficha, busca e carteira do app; Cliente 360, carteira e
  recusados do BKO); o banco local do aparelho ganha a coluna e o primeiro sync depois do deploy traz a carteira inteira com o código.

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
- **Dados do cliente no retorno `vinculado`** (aditivo no `RetornoCliente`): o ERP mandaria tudo de uma vez, mas seria um segundo
  caminho ERP → `core.cliente` com o mesmo mapeamento da carga (carteira, contatos, financeiro, filial, ordem do `alterado_em`);
  descartada (item 10).
- **Código FDV gerado no aparelho** (prefixo do aparelho + sequência local): existiria offline, mas não seria sequencial por empresa
  nem do formato da RN-CORE-59; descartada.
- **Código FDV só para os pré-cadastros** (versão anterior desta ADR): evitava o pull inteiro de novo, mas deixava parte dos clientes
  sem o código; o dono do produto escolheu todo cliente (decisão 1 B).
- **Numerar também os clientes apagados no backfill**: gastaria a faixa de 5 dígitos com linhas que ninguém vê; descartada (como a 0080).
- **Teto em 99999 (recusar o 100.000º cliente)**: pararia o cadastro e a carga do ERP de uma empresa grande; descartada em favor dos 6
  dígitos da 0080.
- **Trocar o upsert do `consumidorClienteDoErp` por "update, senão insert"** para não gastar número: mesma proteção, mas só nesse
  caminho e com código a mais no Core; a procura no gatilho protege qualquer upsert por `external_id`.
- **Adotar o pré-cadastro pelo documento na carga do ERP** (sem esperar o `vinculado`): o Hub não saberia e continuaria oferecendo a
  linha ao ERP (cliente criado duas vezes) sem um evento novo do Core para a Integração; descartada em favor de esperar o vínculo.

## Consequências
- O BKO passa a ver o motivo e os erros por campo (analista e admin); a RN-CORE-78 muda nesse ponto.
- O APK v1.0.28 segue funcionando: o pull traz campos novos que ele ignora; a correção dele (id novo) vira a revisão seguinte; o espelho do
  parâmetro mantém o formulário antigo coerente com a API. O espelho e o caminho de substituição saem com a versão mínima > 1.0.28.
- Com o receptor do push no ar, os pré-cadastros represados nos aparelhos v1.0.28 chegam juntos no primeiro sync depois do deploy.
- Decididos pelo dono do produto (23/11/2026): os efeitos da lista única (item 6), a correção só por analista e admin (item 7) e os dois
  códigos com "o ERP manda" (item 10), do qual decorre o `vinculado` de revisão antiga e sobre `rejeitado` valer (item 8); na segunda
  rodada ("1 B / 2 A / 3 A"), o Código FDV em todo cliente, os dados do ERP pela carga normal e os duplicados da v1.0.28 fora desta
  versão. Decididos no desenho (engenheiro-software): apagados sem código, sem teto acima de 99999 e backfill por `created_at, id`.
- Depois do vínculo, o que o vendedor digitou é sobrescrito pela carga do ERP (só a coordenada `manual` fica quando o ERP não manda
  coordenada, RN-CORE-77). Entre o vínculo e a carga, o cliente mostra os dados do vendedor.
- Todo cliente vivo tem Código FDV (decisão 1 B). O do pré-cadastro só existe depois que o servidor o recebe (offline o app mostra o
  cliente sem ele); o do ERP nasce quando a carga o grava.
- O backfill da 0098 escreve uma vez cada cliente vivo de todas as empresas: o primeiro sync depois do deploy traz a carteira inteira
  de novo a cada aparelho (uma vez só). A numeração dos clientes antigos segue a ordem de entrada no FDV (`created_at, id`), não a do
  código do ERP.
- Clientes apagados antes da 0098 ficam sem código; a empresa que passar de 99999 clientes segue em `100000` (sem teto).
- Os duplicados que a v1.0.28 já criou (carga antes do vínculo: cliente do ERP sem documento + pré-cadastro em `codigo_em_uso`) **não
  são tratados agora** (decisão 3 A); o banco-dados só os conta na consulta de conferência. Cada um ganha o próprio Código FDV no
  backfill.
- Ordem do lote: migração 0098 → Core (contratos, domain, API, receptor, BKO, app) e Integração juntos → BKO web no mesmo deploy (a rota
  `parametros/pre-cadastro` sai).
- **Plano de deploy da 0098**: o backfill trava para escrita todos os clientes vivos durante a migração (12,3 s com 240 mil clientes na
  base de teste; mais em produção). Ela roda **na janela do deploy, com a carga do ERP parada** (Conector sem enviar clientes e fila do
  Hub sem consumir), e a carga volta depois de a 0098 terminar. O push do Campo e o BKO que gravam cliente nesse intervalo esperam
  a migração terminar.
- O upsert da carga do ERP sobre cliente que já existe passa a travar o vivo (`for no key update`) desde o gatilho até o fim da
  transação — a mesma trava que o update do conflito já pegava; custo medido ~0,75 ms por linha.

## Texto proposto das RN (o gerente-projetos aplica no doc 03)
- **RN-CORE-16 Cadastro completo** (revista na v1.0.30): o cliente só fica **ativo para faturamento** quando todos os campos da lista
  `cliente.campos_obrigatorios` da empresa estão preenchidos e válidos. Padrão: razão social; CNPJ ou CPF com dígito verificador válido;
  inscrição estadual ou "isento" (só para CNPJ); logradouro, número, bairro, município, UF e CEP. A empresa acrescenta ou tira campos em
  Parâmetros › Clientes, mas não tira a razão social nem o CNPJ/CPF. **É a mesma lista do pré-cadastro (RN-CORE-79).** A verificação
  roda na integração (Hub), na edição pelo BKO, na sincronização e no pré-cadastro, e mora no `domain` do Core.
- **RN-CORE-78 Pré-cadastro de cliente** (revista na v1.0.30): o FDV só faz o pré-cadastro e quem aprova é o ERP. O cadastro feito no
  Campo ou no BKO chega como pendente e entra na fila do ERP assim que o servidor o recebe. **Todo cliente tem Código FDV**, venha do
  pré-cadastro ou do ERP: gerado pelo sistema quando o servidor recebe o pré-cadastro ou quando a carga do ERP grava o cliente novo, em
  sequência da empresa com 5 dígitos (00001…; depois de 99999 vem 100000), como o do usuário na RN-CORE-59; só de leitura e nunca
  reaproveitado, nem de cliente apagado. Os clientes que já existiam receberam o código pela ordem de entrada no FDV. O pré-cadastro
  tem também o Código ERP, em branco até o ERP aprovar. O ERP devolve o código ou a recusa com motivo e, se quiser, os erros por campo; o mesmo código
  é idempotente, outro código é conflito e código já usado por outro cliente é recusado. **Aprovado, o ERP manda**: o código do ERP é
  gravado (mesmo que o cadastro estivesse recusado ou numa revisão mais nova) e os demais dados passam a ser os que o ERP manda na carga
  de clientes, por cima do que foi digitado; o Código FDV e o histórico ficam.
  **O recusado é corrigido e reenviado no mesmo cadastro**, pelo vendedor no app ou pelo analista ou admin no BKO: cada reenvio é uma
  revisão nova, com número, hash dos dados, quem corrigiu e quando, e o resultado do ERP (motivo e erros por campo) fica no histórico.
  Só o recusado pode ser corrigido; quem corrigiu em cima de uma revisão que já mudou recebe aviso para recarregar. O vendedor continua
  vendendo para o cliente pendente ou recusado. O motivo e os erros vão ao vendedor do cliente e a quem corrige no BKO, nunca a log nem
  à auditoria. Até a versão mínima do Campo passar de 1.0.28, o cadastro novo com o CPF/CNPJ de um recusado (app antigo) assume o
  histórico do recusado como a revisão seguinte.
- **RN-CORE-79 Campos obrigatórios do pré-cadastro** (revista na v1.0.30): o pré-cadastro exige os campos da lista única de Parâmetros ›
  Clientes (RN-CORE-16), menos complemento e geolocalização; razão social e CPF/CNPJ são sempre obrigatórios. A inscrição estadual só é
  exigida para CNPJ ("isento" vale). A regra vale no app offline e a API revalida; a mudança é auditada.
- **RN-INT-22 Cliente novo para o ERP** (revista na v1.0.30): o Hub oferece ao ERP, em `/integracao/v1`, os pré-cadastros pendentes ainda
  sem código, em ordem de chegada, cada um com o Código FDV, a revisão e o hash dos dados, e recebe de volta o código do ERP ou a recusa
  com motivo e, opcionalmente, os erros por campo, como o retorno de pedidos da RN-INT-08. O reenvio reabre a mesma linha da fila (de
  rejeitado para pendente, com a revisão nova). O retorno informa a revisão: recusa de revisão antiga não vale sobre a nova; o código do
  ERP vale sempre, mesmo de revisão antiga ou depois de uma recusa (o ERP manda), e os dados do cliente passam a vir da carga de
  clientes do ERP, que sobrescreve o que o vendedor digitou; o cliente novo que a carga do ERP grava recebe o Código FDV
  (RN-CORE-78), e a carga de um cliente que já existe não o muda; até o código chegar, a carga que traz o mesmo CPF/CNPJ espera e não cria outro cliente. Recusa nova na mesma revisão,
  com outro motivo ou outros erros, é um fato novo. Só o Conector que recebe pedidos usa essas rotas. Motivo e erros nunca vão a log.

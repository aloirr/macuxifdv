# ADR 0013 — Rotas de Conector na API: prefixo `/<modulo>/v1` e chave de API por Conector

- **Status**: proposta (2026-11-01; aceita quando o gerente-projetos der o OK ao desenho T-0032)
- **Data**: 2026-11-01
- **Tarefa**: T-0032 (desenho: [docs/desenho/T-0032.md](../desenho/T-0032.md)); origem: T-0025 (`docs/modulos/integracao/hub-api.md`
  §3, §17a), T-0027 (PR #24) e T-0031 (PR #25)
- **Autor**: engenheiro-software
- **Base**: ADR 0001 (fronteiras), ADR 0004 (permissão por ação), ADR 0006 (rotas declarativas, `comTenant`, limitador),
  ADR 0007 (outbox e `macuxi_worker`), ADR 0008 (erros de módulo), RN-CORE-01/02, RN-INT-01, 06, 09, 10, 11, 12 e 13

## Contexto
O Hub de Integração tem 7 rotas chamadas pelo **Conector** (programa instalado no servidor do cliente), não por um usuário:
`POST /lotes`, `GET /lotes/{id}`, `GET /cursores/{entidade}`, `POST /reconciliacoes`, `GET /pedidos/pendentes`,
`POST /pedidos/{uuid}/retorno` e `POST /sinal` (`ROTAS_HUB`, `modules/integracao/contracts/hub.ts`). Elas não cabem em
`RotaModulo` (ADR 0006):
- o prefixo é **`/integracao/v1`**, fixo no Conector 1.2.0 já distribuído (não `/v1/integracao`);
- a autenticação é **chave de API por Conector** (`Authorization: Bearer <chave>` + `X-Macuxi-Conector-Id`), sem JWT, sem
  usuário, sem perfil e sem carteira; o **tenant vem da chave** (RN-INT-10);
- o corpo de erro tem campos a mais (`erros[]` em `RecusaLote`/`RecusaRetorno`) e códigos em minúsculas que o Conector já lê;
  existem status que módulo nenhum usa hoje (413 com código do Hub, **426** para versão abaixo da mínima);
- o `POST /lotes` aceita até 8 MiB e 5.000 linhas, acima do teto de corpo e de elementos das rotas comuns.

As rotas do **BKO** da Integração (`/v1/integracao/*`: Conectores, chaves, monitor, inativação, mapeamento) são rotas de
usuário comuns e seguem a ADR 0004/0006 sem mudança.

## Decisão
1. **Nova peça declarativa no platform-sdk**: `ModuloApi.conector?: ApiConector`, com
   - `autenticar(e: EntradaAutenticacaoConector) → ConectorAutenticado | RecusaConector` — o módulo resolve a chave (hash com o
     pepper, função `SECURITY DEFINER`, `avaliarChaveConector`, lista de IPs). Recebe os cabeçalhos em minúsculas, o IP, o
     relógio, o log e **só** `semTenant` do banco (a única leitura sem tenant). Devolve `tenant_id` e um objeto opaco do
     Conector (`id`, `identificador`, mais o que o módulo quiser: `entidades`, `recebe_pedidos`, situação da chave);
   - `antes?(ctx, rota)` — o que o módulo confere em toda rota já autenticada: balde de taxa (`consumirToken`), tamanho
     do corpo pelo parâmetro do tenant (`verificarTamanhoCorpo`) e política de versão (`avaliarVersaoConector` +
     `rotaBloqueadaPorVersao` → 426);
   - `rotas: RotaConector[]` — `{ id, metodo, caminho, cabecalhos?, params?, query?, corpo?, status?, limiteCorpoBytes?,
     maxElementosCorpo?, executar(ctx: ContextoConector) }`. Sem `acao`, `perfis` nem `carteira`: quem chama é o Conector.
2. **Só módulo com `apps.conector` no manifesto** pode declarar `conector` (`definirModuloApi`/`createApp` recusam o resto).
   Hoje é só a `integracao`. As rotas montam em **`/<modulo>/v1/<caminho>`** → `/integracao/v1/...`. Versão nova
   incompatível = `/<modulo>/v2` com nova ADR (RN-INT-09); `v1` continua montada pelo prazo da regra.
3. **Pipeline da plataforma** (`apps/api`, plugin Fastify encapsulado no prefixo, com tratador de erro e 404 próprios), nesta ordem:
   1. limite de falhas de autenticação por IP (20/min, limitador em memória da ADR 0006) → 429 `limite_de_taxa` + `Retry-After`;
   2. teto de corpo da rota (`bodyLimit` do Fastify: 8 MiB em `POST /lotes`, 1 MiB nas outras) e de elementos de array
      (`maxElementosCorpo`) → 413 `corpo_grande`;
   3. `autenticar` do módulo → 401 `credencial_invalida` (mensagem sempre genérica) | 403 `acesso_negado`; o motivo exato vai
      só para o log; a falha conta no limite do item 1;
   4. licença do módulo **no tenant** (`plataforma.tenant_modulo` ativo; não há perfil) → 403 `modulo_inativo`; na mesma
      transação lê os parâmetros do módulo (`plataforma.parametro`) e o fuso do tenant;
   5. Zod de cabeçalhos, params, query e corpo declarados → 400 `requisicao_invalida` (a rota que precisa de erro próprio,
      como o `envelope_invalido` do lote, não declara `corpo` e valida no módulo);
   6. `antes` do módulo (taxa, tamanho pelo parâmetro do tenant, versão) e `executar`.
4. **`ContextoConector`**: `tenantId`, `conector` (o objeto do `autenticar`), `rota` (id), `cabecalhos`, `corpo`, `query`,
   `params`, `bytesCorpo`, `ip`, `requestId`, `agora()`, `fuso()`, `parametros()`, `log` (já com `tenant_id`, `modulo`,
   `request_id` e `conector`) e `comTenant(fn(db, tx))` com o **tenant da chave** e o papel `macuxi_app` (RLS). O `tx` é o
   mesmo `TransacaoTenant` das rotas de usuário (`publicar` na outbox, `auditar`) com `usuario_id = null`; `consultar`
   (ADR 0012) não vale aqui (não há usuário) e lança `ConsultaIndisponivel`. Corpo, query e cabeçalhos com `tenant_id` são
   ignorados.
5. **Erros**: `ErroConector(status, corpo, cabecalhos?)` no SDK, com `status` ∈ {400, 401, 403, 404, 409, 413, 422, 426,
   429, 503} e `corpo` validado contra `ErroApiSchema` **mais campos extras** (o `erros[]` de `RecusaLote`/`RecusaRetorno`).
   A plataforma, nas rotas de Conector, usa os códigos do Hub em minúsculas (`requisicao_invalida`, `credencial_invalida`,
   `acesso_negado`, `modulo_inativo`, `corpo_grande`, `limite_de_taxa`, `nao_encontrado`, `servico_indisponivel`) e põe
   `requisicao_id` no corpo; erro inesperado = 500 sem detalhe. 429 e 503 levam `Retry-After` em segundos inteiros.
   `ErroHttpModulo` continua só para as rotas de usuário.
6. **Logs**: `Authorization` e `X-Macuxi-*` nunca entram em log (redação no pino do `apps/api`); o log leva `tenant_id`,
   `modulo`, `request_id`, `conector` (identificador), `rota` e códigos; nunca linhas, `registros`, `payload` nem a chave.
7. **Segundo plano**: aceita a proposta do módulo — a **outbox é a fila** (ADR 0007): o `POST /lotes` publica o evento interno
   `integracao.lote.recebido@1` na transação do lote e o consumidor do próprio módulo aplica em blocos de ~500 linhas. Sem
   pg-boss.
8. **Segredo**: `MACUXI_HUB_CHAVE_PEPPER` (≥ 32 bytes) no `.env`, lido pelo módulo como o Core lê `MACUXI_JWT_SEGREDO`
   (`criarModuloApiIntegracao({ pepper: () => process.env.MACUXI_HUB_CHAVE_PEPPER })`). Sem pepper, `autenticar` falha
   fechada (503 `servico_indisponivel` + log de erro), nunca aceita chave.
9. **OpenAPI** (`GET /integracao/v1/openapi.json`, sem autenticação e sem dado de tenant, gerado de `ROTAS_HUB`) entra depois
   da T-0032; a dependência para gerar o JSON Schema do Zod (`zod-to-json-schema`, sem dependências transitivas) fica
   aprovada por esta ADR quando a tarefa for aberta.

## Alternativas consideradas
- **`RotaModulo` com uma bandeira "conector"**: misturaria duas autenticações no mesmo caminho de código, com `acao`,
  `perfis` e `carteira` sem sentido para a máquina; o prefixo `/v1/integracao` quebraria o Conector distribuído.
- **Rotas de Conector como `rotasPublicas`** (sem token) e autenticação dentro de cada rota: cada rota repetiria chave,
  licença, taxa e versão; um esquecimento abre o tenant.
- **JWT de serviço emitido para o Conector** (troca chave → token): mais uma ida e volta e um token para renovar num
  programa que roda sem operador; a chave por Conector já foi decidida pelo Alexandre (2026-10-31).
- **Processo/serviço separado só para o Hub**: outra implantação, outro pool e outra cópia da licença e da outbox para 7 rotas;
  reavaliar se o volume de lotes pedir escala própria (o plugin encapsulado já isola prefixo, erros e limites).
- **Fila pg-boss para a aplicação dos lotes**: dependência nova sem ganho sobre a outbox, que já tem retentativa e idempotência.

## Consequências
- platform-sdk: `ApiConector`, `RotaConector`, `ContextoConector`, `EntradaAutenticacaoConector`, `ConectorAutenticado`,
  `RecusaConector`, `ErroConector`, validação em `definirModuloApi` (só módulo com `apps.conector`; ids e caminhos únicos).
- apps/api: `src/conector.ts` (plugin com o pipeline do item 3, limitador de falhas por IP, licença do tenant, erros do Hub),
  redação de cabeçalhos no logger, testes sem banco (módulo de fixture) e com banco (dois tenants).
- modules/integracao/api (dono: modulo-integracao): `autenticar`, `antes`, as 7 rotas, os consumidores e as rotas do BKO,
  ligando as funções do `domain` sem reimplementar regra.
- O Conector não muda (1.2.0): prefixo, cabeçalhos, códigos e corpos já são os do contrato.
- Os limites em memória (falhas por IP, balde por Conector) valem para uma instância; ao escalar horizontalmente viram
  contador compartilhado com a mesma interface (como o limitador de login, ADR 0006).

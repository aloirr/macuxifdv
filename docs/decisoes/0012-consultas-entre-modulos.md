# ADR 0012 — Consultas entre módulos na API e no aparelho

- **Status**: aceita (2026-11-01, OK do gerente R-20261101-042340 ao desenho T-0029) · complementos: ADR 0019 (`usaConsultasOpcionais`),
  ADR 0025 (`{ licenca: 'tenant' }`)
- **Data**: 2026-11-01
- **Tarefa**: T-0029 (desenho: [docs/desenho/T-0029.md](../desenho/T-0029.md) §3.5 e §11, item E1)
- **Autor**: engenheiro-software
- **Base**: ADR 0001 (fronteiras), ADR 0003 (motor e registro de telas), ADR 0005 (produto no Core, preço no Catálogo), ADR 0006
  (rotas declarativas, `comTenant`), desenho T-0008 §2.1 (fonte de outro módulo no aparelho), RN-CORE-03, RN-CAT-06, RN-VEN-01

## Contexto
Para aceitar o pedido do aparelho, o Vendedor precisa, **no servidor**, do preço da tabela do cliente (dono: Catálogo, ADR 0005)
e do cadastro do cliente, do produto e do vendedor (dono: Core) — para revalidar (RN-VEN-01, RN-CAT-06), guardar o retrato do
documento e mandar as chaves do ERP ao Hub. **No aparelho**, precisa do mesmo preço offline, mas não pode importar o `domain` do
Catálogo (`precoVisivel`). A regra 1 proíbe ler tabela de outro schema e importar código que não seja `contracts`. Hoje só o Core
oferece serviços à plataforma (`servicos.carteira`, `usuariosVisiveis`), e eventos não servem: são assíncronos, e o pedido tem de
ser validado na hora do push.

## Decisão
1. **Contrato no dono**: o módulo provedor declara a consulta no próprio `contracts` com
   `definirConsulta({ nome: '<modulo>.<consulta>@vN', entrada: Zod, saida: Zod })`. Mudança incompatível = `@vN+1` (como evento).
2. **Manifesto**: o provedor lista `ofereceConsultas: [...]`; o consumidor lista `usaConsultas: [...]`. A montagem (`definirModuloApi`,
   `criarShell`, `createApp`) recusa: consulta usada sem provedor instalado, provedor que não está em `depende` ou `opcionais` do
   consumidor, consulta oferecida sem implementação, nome fora do padrão. O registro fica em `.coord/contratos/modulos.md`.
3. **API**: o provedor implementa em `ModuloApi.consultas` (`implementarConsulta(def, (entrada, ctx) => saida)`); o consumidor
   chama `tx.consultar(def, entrada)` **dentro do próprio `comTenant`**. A implementação recebe o mesmo `ClienteBanco` (mesma
   transação, mesmo tenant, RLS, papel `macuxi_app`), o usuário e o relógio da requisição, e só faz SQL no schema do próprio
   módulo. Entrada e saída passam pelo Zod nos dois lados. Provedor opcional inativo no tenant → `ConsultaIndisponivel`
   (o consumidor trata, RN-CORE-03); provedor em `depende` está sempre ativo quando o consumidor está.
4. **Aparelho**: o provedor implementa em `definirModuloShell({ consultas })` lendo só as próprias entidades locais; o consumidor
   chama `ambiente.consultar(def, entrada)`. Mesmo contrato e mesmo resultado que no servidor (a regra pura do provedor roda nos
   dois lados), então o aparelho avisa o que o servidor vai decidir.
5. **Limites**: consulta é leitura, sem efeito colateral e sem evento; entrada com listas limitadas no schema (ex.: ≤ 500 ids);
   o log da consulta leva `modulo` (provedor), `consulta` e `request_id`, nunca a entrada nem a saída.
6. Primeiras consultas: `catalogo.precos_cliente@1` (API e aparelho) e `core.cadastro_resumo@1` (API).

## Alternativas consideradas
- **Read-model no Vendedor** alimentado por eventos do Catálogo e do Core (`vendedor.preco_cliente`): consistência eventual (o
  preço novo pode não ter chegado no push), dado duplicado e mais eventos a publicar antes da demo.
- **Chamar a rota REST do outro módulo** (`/v1/catalogo/...`) de dentro da API: ida e volta HTTP no mesmo processo, outra
  transação (outro instante de leitura) e autenticação de serviço a inventar.
- **`servicos` do Core estendidos a qualquer módulo** sem contrato no manifesto: dependência escondida, sem verificação de
  `depende`, sem versão.
- **Ler o schema do outro módulo com uma view de leitura**: quebra a regra 1 e prende o Vendedor à forma das tabelas do Catálogo.
- **No aparelho, o Vendedor ler as linhas de preço e repetir a regra**: duplica `precoVisivel` (RN-CAT-06) em dois módulos.

## Consequências
- platform-sdk: `definirConsulta`, `implementarConsulta`, `DefinicaoConsulta`, `ofereceConsultas`/`usaConsultas` no `Manifesto`,
  `ModuloApi.consultas`, `TransacaoTenant.consultar`, `ModuloShell.consultas`, `Ambiente.consultar`, `ConsultaIndisponivel`;
  testes de montagem e de execução (memória e Postgres).
- apps/api: o `createApp` monta o registro de consultas dos módulos instalados e liga ao `comTenant`.
- Módulos: Catálogo e Core oferecem; Vendedor usa. Novas consultas seguem o mesmo caminho (próxima prevista:
  `core.financeiro_cliente@1`, crédito e títulos para RN-VEN-12/13).
- dependency-cruiser não muda: o consumidor importa só o `contracts` do provedor.
- **Complemento (ADR 0025, 2026-11-05)**: `tx.consultar(def, entrada, { licenca: 'tenant' })` checa o provedor pela licença do
  tenant, e não pelos módulos de quem consulta. O usuário e o escopo são os mesmos. Vale só para leitura agregada de
  indicador (RN-CORE-27).
- **Complemento (T-0084, 2026-11-06)**: no aparelho, a implementação da consulta lê, só para leitura, as entidades locais do
  próprio módulo **e as dos módulos em `depende` do provedor** (ex.: `catalogo.busca_produtos@1` lê o `produto` do Core). Os
  `opcionais` e os donos de `usaConsultasOpcionais` ficam de fora (erro de programação; para ler, use a consulta deles);
  dependência inativa para o usuário → `ConsultaIndisponivel`. O `ContextoConsultaAparelho` ganhou `linhasPorCampo` e
  `versaoLinhas`, as mesmas do motor (ADR 0003, T-0052-B4), com a mesma restrição. Só alarga o canal do aparelho e não muda a
  regra 1: `depende` já é a aresta que o provedor declara, e no servidor a consulta continua fazendo SQL só no próprio schema.

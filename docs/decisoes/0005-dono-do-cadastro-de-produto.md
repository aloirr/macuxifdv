# ADR 0005 — Dono do cadastro de produto: Core (base) e Catálogo (preço, estoque, conteúdo e busca)

- **Status**: aceita
- **Data**: 2026-10-31
- **Tarefa**: decisão do Alexandre (R-20261031-021714-alexandre, distribuída no aviso R-20261031-023717-gerente-projetos) · código na T-0007 (Sprint 1)
- **Autor**: engenheiro-software (registro da decisão do Alexandre)

## Contexto
Na Fase M o produto (`Product`, `ProductListQuery`, `StockByBranch`, `MixSuggestion`) nasceu dentro do app do
vendedor, e na cópia da T-0001 os tipos ficaram provisoriamente em `modules/vendedor/contracts`. O doc 04
colocava `produto` no schema `catalogo`. As duas posições quebram o modelo modular:

- **Promotor** (mix obrigatório, ruptura, preço, validade), **Pesquisa** e **Gestor** precisam do produto e não
  podem depender de um módulo opcional (Catálogo) nem do Vendedor (RN-CORE-03: desativar um módulo desativa
  quem depende dele).
- **Vendedor** não emite pedido sem preço e estoque; esses dados são do Catálogo e chegam do ERP pelo Hub.
- Deixar os tipos no Vendedor faria Promotor, Pesquisa e Gestor importarem `modules/vendedor/contracts`, criando
  uma dependência falsa de quem nem vende.

## Decisão
1. **Core é dono do cadastro base de produto**: schema `core`, tabela `produto` com `id`, `sku`, `ean`, `nome`,
   `marca`, `categoria`, `unidade`, `ativo`, `external_id` (mais os campos comuns `tenant_id`, `created_at`,
   `updated_at`, `deleted_at`, RLS ligado). Tipos em `modules/core/contracts`.
2. **Catálogo é dono de preço, estoque, conteúdo e busca**: `tabela_preco`, `tabela_preco_item`, `deposito`,
   `estoque_saldo`, `produto_atributo`, `produto_midia`, `produto_conteudo`, `sinonimo`, `produto_embedding`
   (pgvector) e `busca_log`, no schema `catalogo`, referenciando `core.produto` por `produto_id`. Tipos em
   `modules/catalogo/contracts`.
3. **Vendedor depende do Catálogo** (`depende: ['core', 'catalogo']` no manifesto) e consome produto, preço e
   estoque **por contrato** (tipos dos `contracts`, eventos `catalogo.*@vN`, endpoints `/v1/catalogo`) — nunca lê
   tabela de outro schema. RN-CORE-03: Catálogo desativado ⇒ Vendedor desativado.
4. **Promotor, Pesquisa e Gestor usam só o produto do Core** (`core.produto` via `@macuxi/core/contracts`).
5. Texto do doc 04, seção "Dados" (já aplicado pelo gerente-projetos):
   > Decisão (ADR-0005): o cadastro base de produto fica no schema `core` (tabela `produto`); preço, estoque,
   > conteúdo e busca ficam no schema `catalogo`. O Vendedor depende do Catálogo e consome produto, preço e
   > estoque por contrato; Promotor, Pesquisa e Gestor usam só o produto do Core.

   A tabela de schemas do doc 04 passou `produto` (cadastro base) da linha `catalogo` para a linha `core`.

## Transição (concluída na T-0007)
- Até a T-0007 a cópia da Fase M ficou em `modules/vendedor/contracts` para manter os 277 testes da T-0001 verdes.
- Migrações: `core.produto` nasceu na T-0002 (`db/migrations/0002_core.up.sql`); as tabelas de preço/estoque do Catálogo
  entram com o módulo Catálogo, depois do adaptador SQLite do aparelho (T-0008, busca offline FTS5).

## Adendo (2026-10-31) — o que a T-0007 entregou
Entregue na nuvem (merge 6fba044), revisado pelo engenheiro no fechamento da rodada local (R-20261031-121124).
- **Core**: `ProductBase` em `modules/core/contracts` (`id`, `sku`, `ean`, `nome`, `marca`, `categoria`, `unidade`,
  `ativo`, `external_id`).
- **Catálogo**: `ProductPrice`, `StockByBranch`, `ProductStock`, `Product` (= `ProductBase` + preço e estoque),
  `ProductListQuery` e `MixSuggestion` em `modules/catalogo/contracts`. O manifesto saiu com `produto` fora do sync e
  ganhou `assistente` em `perfis` (o assistente de BKO trabalha com pedidos e o Vendedor depende do Catálogo).
- **Vendedor**: `depende: ['core', 'catalogo']`. Nenhum tipo de produto é definido no módulo; app e web importam
  `@macuxi/catalogo/contracts`.
- **Shells**: `apps/web/lib/modulos.ts` e `apps/mobile/src/lib/modulos.ts` instalam o manifesto do Catálogo. Sem ele,
  `criarShell` recusa o Vendedor (dependência não instalada). A ordem de montagem é core → catalogo → vendedor.
- **Testes**: `tests/modulos/produto-dono.test.ts` cobre RN-CORE-03 com os manifestos reais (Catálogo desligado ⇒ Vendedor
  desligado). O espelho `packages/platform-sdk/src/manifestos-referencia.test.ts` e `.coord/contratos/modulos.md` foram
  alinhados depois do merge.
- **Fixture** `db/seeds/fixtures/dois-tenants.ts`: passou a licenciar o Catálogo onde licencia o Vendedor. Antes disso o
  vendedor da fixture perdia o Vendedor por RN-CORE-03, e `apps/api/test/banco.test.ts` ficava vermelho com banco real.
  Na nuvem, sem Postgres, esses testes são pulados.

Decisões tomadas na revisão:
1. **Eventos de produto do ERP**: `integracao.produto.atualizado@1` passa a ser consumido pelo **Core**, que é o dono de
   `core.produto`. O Catálogo deixa de consumi-lo e reage só a `integracao.preco.atualizado@1` e
   `integracao.estoque.atualizado@1`. Se a busca precisar reindexar quando o nome do produto mudar (T-0008), o Catálogo
   consome um evento do Core (`core.produto.atualizado@1`, a criar quando houver o consumidor), nunca o do Hub. Recados:
   modulo-core (declarar e implementar) e modulo-catalogo (retirar do `consome`).
2. **Categoria e marca** continuam no sync do Catálogo como taxonomia de navegação e busca. O texto `marca`/`categoria`
   em `core.produto` continua sendo o cadastro base. Reavaliar na T-0008 (FTS5).

## Alternativas consideradas
- **Produto inteiro no Catálogo** (premissa anterior do doc 04): Promotor, Pesquisa e Gestor passariam a depender
  de um módulo opcional e pago; tenant só de trade marketing teria de licenciar o Catálogo.
- **Produto no Vendedor** (como veio da Fase M): dependência falsa de Promotor/Pesquisa/Gestor no Vendedor e
  violação do espírito de RN-PRO-01 (promotor sem nada de pedido).
- **Produto em `plataforma`**: o schema de plataforma é de tenant, licença, evento e auditoria — não de dado de
  negócio; misturaria responsabilidades e o dono do módulo deixaria de ser um agente de módulo.

## Consequências
- O Core cresce um agregado (produto base) com sync `servidor_vence` vindo do ERP pelo Hub; o Catálogo enriquece por
  `produto_id`, sem duplicar o cadastro.
- O Vendedor ganha uma dependência obrigatória (Catálogo); a ordem de instalação nos shells passa a ser
  core → catalogo → vendedor (`ordenarPorDependencia`), e o registro de dependências em `.coord/contratos/modulos.md`
  muda na T-0007.
- O Hub de Integração mapeia o produto do ERP para `core.produto` e preço/estoque para `catalogo.*` (doc 06).
- Busca offline (FTS5) é do Catálogo e depende do adaptador SQLite do motor (T-0008, ADR 0003).

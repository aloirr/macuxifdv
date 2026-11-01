# Módulos e dependências

| Módulo | Depende | Opcionais | Apps | Perfis |
|---|---|---|---|---|
| core | — | — | campo, gestao, web | todos |
| catalogo | core | — | campo, gestao, web | vendedor, promotor, supervisor, gerente, analista, assistente, admin (o Vendedor depende dele; ADR 0005; admin cadastra conteúdo — RN-CAT-04) |
| vendedor | core, catalogo | — | campo, gestao (T-0029), web | vendedor, supervisor, gerente, analista, assistente, admin (alvo T-0029 §7; hoje no manifesto: vendedor, analista, assistente). Promotor nunca (RN-PRO-01) |
| promotor | core | catalogo, pesquisa, vendedor | campo, gestao, web | promotor, supervisor, gerente, analista, admin (cadastros de trade, T-0010) |
| gestor | core | vendedor, promotor, pesquisa, treinamento | gestao, web | supervisor, gerente |
| pesquisa | core | — | campo, gestao, web | vendedor, promotor, supervisor, gerente, analista, admin |
| treinamento | core | vendedor | campo, gestao, web | vendedor, promotor, supervisor, gerente, analista, admin |
| integracao | core | — | web, conector | admin, analista |

> Fonte da verdade: `modules/<m>/manifest.ts`. Espelho com teste de consistência: `packages/platform-sdk/src/manifestos-referencia.test.ts`.
> ADR 0005 (T-0007): o cadastro base de produto é do Core; o Catálogo é dono de preço, estoque, conteúdo e busca. O Vendedor
> **depende** do Catálogo: desativar o Catálogo desativa o Vendedor (RN-CORE-03; teste `tests/modulos/produto-dono.test.ts`).
> Ordem de instalação nos shells: core → catalogo → vendedor (`ordenarPorDependencia`).
> Nomes de ação são GLOBAIS (um nome, um dono): prefixe com a entidade do módulo (ex.: Gestor `ranking_equipe.ver`, Treinamento
> `ranking.ver`). Catálogo (T-0021): `produto.consultar` e `produto.perguntar` (todos), `produto.ver_preco_estoque` (todos menos o
> promotor; o domínio libera o promotor com `promotor_ve_preco_estoque`, RN-CAT-05), `produto.enriquecer`, `sinonimo.gerenciar`,
> `destaque.gerenciar`, `busca.ver_sem_resultado` (analista e admin, RN-CAT-04).

## Consultas entre módulos (ADR 0012)

Leitura síncrona com contrato versionado no `contracts` do dono (`definirConsulta`), oferecida em `ofereceConsultas` e usada por
quem a lista em `usaConsultas` (dono em `depende` ou `opcionais`). Na API: `tx.consultar(def, entrada)` dentro do `comTenant` de
quem consulta (mesma transação e RLS); no aparelho: `ambiente.consultar(def, entrada)` sobre as linhas locais do dono. Dono inativo
ou sem implementação no canal → `ConsultaIndisponivel` (503 `CONSULTA_INDISPONIVEL` se ninguém tratar). Mudança incompatível = `@vN+1`.
A montagem (`defineModule`, `definirModuloApi`, `validarConjunto`, `criarShell`) recusa o que estiver fora destas regras.

| Consulta | Dono | API | Aparelho | Usada por | Situação |
|---|---|---|---|---|---|
| `catalogo.precos_cliente@1` | catalogo | sim | sim (linhas de preço locais, `precoVisivel`, RN-CAT-06) | vendedor | aprovada (T-0029), implementação na onda 2 |
| `core.cadastro_resumo@1` | core | sim | não (o Vendedor lê `cliente`/`produto` locais com os tipos de `@macuxi/core/contracts`) | vendedor | aprovada (T-0029), implementação na onda 2 |

> Próxima prevista: `core.financeiro_cliente@1` (crédito e títulos, RN-VEN-12/13). Espelho com teste:
> `packages/platform-sdk/src/manifestos-referencia.test.ts` (estado-alvo da T-0029).

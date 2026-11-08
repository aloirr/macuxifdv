# ADR 0027 — Marcas concorrentes da referência cruzada: o Promotor é o dono, o Catálogo lê pelo contrato dele

- **Status**: **substituída pela [0034](0034-marcas-concorrentes-no-catalogo.md)** em 2026-11-08 (decisão do dono do produto, R-20261107-173950 b: o cadastro de marcas passa a ser do Catálogo). Fica como histórico.
- **Status anterior**: aceita (2026-11-05, decisão do Alexandre às 21h, repassada pelo gerente-projetos em R-20261105-213304). Substitui a
  proposta anterior desta ADR, que levava a tabela para o Core e **não vale**.
- **Tarefa**: T-0085 (RN-CAT-09; [desenho](../desenho/T-0085.md))
- **Autor**: engenheiro-software
- **Base**: ADR 0005 (sem FK entre schemas), ADR 0012 (consultas entre módulos), ADR 0025 (licença na consulta), regra 1 do CLAUDE.md
- **Nome do arquivo**: ficou o da proposta (`...-no-core`) para não quebrar os links. Vale o título.

## Decisão
1. **Dono:** o cadastro `promotor.concorrente` continua do Promotor (tela, rotas e entidade de pull `concorrente`). Nada vai para o
   Core: sem `core.marca_concorrente`, sem `core.marcas_concorrentes@1`, sem cópia de ids, sem mexer na FK interna do Promotor.
2. **Leitura pelo Catálogo, só por contrato do Promotor:**
   - servidor: a consulta `promotor.concorrentes@1` (pedida ao modulo-promotor em R-20261105-220143; `{ids?, incluir_inativos?}` →
     `{concorrentes: [{id, nome, ativo, external_id}]}`);
   - aparelho: a entidade `concorrente` (`ConcorrenteSync`), quando ela existir no aparelho.
3. **Referência:** `catalogo.produto_referencia.marca_id` guarda o id do concorrente do Promotor, **sem FK** (outro schema). A API
   do Catálogo valida a marca pela consulta antes de gravar. Marca inativa ou desconhecida sai da busca e da tela (RN-CAT-09).

## Riscos (registrados)
1. **Tenant sem a licença do Promotor:** não há lista de marcas. O BKO não grava referência (422 `RN-CAT-09`) e a busca pelo código
   do concorrente não funciona. O tenant típico de autopeças (Catálogo + Vendedor) fica sem a função até licenciar o Promotor.
2. **Usuário sem o Promotor no perfil, mesmo com o tenant licenciado** (o caso do **vendedor**: o Promotor não tem o perfil
   `vendedor`). Pela ADR 0012 a consulta responde `ConsultaIndisponivel` e o pull não leva a entidade `concorrente` ao aparelho
   (só entidades de módulos efetivos). Sem o nome da marca, a referência some para o vendedor, online e offline. A ADR 0025
   (item 4) proíbe usar `{ licenca: 'tenant' }` para mostrar dado de módulo que a pessoa não tem. **Hoje o critério 4 da T-0085
   não fecha para o vendedor.**

## Caminho para fechar o risco 2 (próximo lote, sem trocar o dono)
- **Retrato do nome na referência:** `produto_referencia.marca_nome` (migração 0034, banco-dados), gravado pela rota do BKO e pelo
  consumidor do ERP depois de validar a marca por `promotor.concorrentes@1`. Quem grava tem o Promotor (analista e admin no
  perfil; o consumidor usa a licença do tenant, ADR 0012/0022). O pull de `produto_referencia` passa a levar `marca_nome`
  (aditivo) e o aparelho deixa de ler a entidade `concorrente`.
- **Nome e ativo em dia:** o Promotor publica `promotor.concorrente.alterado@1` (`{id, nome, ativo}`) e o Catálogo consome e
  atualiza o retrato. Consumir evento não cria dependência de manifesto.
- O risco 1 continua: sem o Promotor, não há marca para escolher.

## Alternativas descartadas
- **Core dono** (proposta anterior desta ADR): descartada pelo Alexandre.
- **Tabela própria no Catálogo:** fere "a mesma usada pelo Promotor" (RN-CAT-09); o tenant cadastraria as marcas duas vezes.
- **Marca em texto livre:** perde a escolha da lista e aceita "Freiomax" e "FREIO MAX" como marcas diferentes.

## Consequências
- Contratos K1–K3 do desenho T-0085 (`core.marca_concorrente`, `core.marcas_concorrentes@1`, rotas do Core) e o §6 (adaptação do
  Promotor) **saem**. O registro em `.coord/contratos/modulos.md` foi corrigido.
- O Hub (K11) não resolve a marca: ele repassa `marca_external_id`/`marca_nome` e o consumidor do Catálogo resolve pela consulta do
  Promotor. Marca desconhecida descarta só aquela referência, com aviso.
- O Promotor não deve inativar nem apagar marca com referência sem avisar o Catálogo (a referência some da busca).

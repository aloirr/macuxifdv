# Consumidores do ERP no Core (T-0066)

O Hub aplica o lote e publica `integracao.<entidade>.atualizado@1` (um por registro que mudou). O Core consome os eventos
das entidades que ele é dono. Código: `modules/core/api/consumidores-erp*.ts`; regras puras: `domain/erp-mapeamento.ts`,
`domain/cliente-erp.ts`, `domain/produto.ts`, `domain/produto-unidade.ts`, `domain/cliente-endereco.ts`. Testes × Postgres: `api/consumidores-erp.db.test.ts`.

Regras comuns: upsert por `external_id` (idempotente); inativação do ERP = `ativo = false` (usuário, produto, cliente) ou
`deleted_at` (título, rota, paradas, vínculos); referência ausente (RN-INT-04) lança `ReferenciaAusenteErp` e a outbox
repete (nada de órfão); só dado do ERP (linha com `external_id`) é removido ou trocado, o que foi criado à mão fica; sem
dado pessoal em log; fuso e relógio vêm de `ctx.fuso()` / `ctx.agora()`.

| Evento | Destino | Observações |
|---|---|---|
| `integracao.vendedor.atualizado@1` | `core.usuario` (perfil `vendedor`) | **Sem senha** (`senha_hash` nulo): o usuário só entra depois do convite/ativação pelo admin no BKO. E-mail ausente ou duplicado = e-mail provisório `erp-<hex>@sem-email.invalid`; usuário existente com o mesmo e-mail e sem `external_id` é adotado. Perfil e equipe nunca mudam pelo ERP (equipe é do BKO). Inativação bloqueia o login. |
| `integracao.cliente.atualizado@1` | `core.cliente` + `core.carteira` + `core.cliente_contato` + `core.cliente_financeiro` | Cadastro e cadastro mínimo (RN-CORE-16/17). Carteira: 1 vendedor por cliente (`carteira.external_id` = cliente); troca encerra o vínculo do ERP anterior; sem vendedor no payload encerra o do ERP; vínculos manuais e de promotor ficam. Contatos: `external_id = <cliente>:<posição>`, o 1º é principal se não houver outro. Financeiro: limite e bloqueio do payload; saldo = soma dos títulos abertos; crédito disponível calculado pelo domínio. Publica `core.cliente.atualizado@1` (origem `erp`). |
| `integracao.produto.atualizado@1` | `core.produto` | Cadastro base. Não toca custo, preço de venda nem desconto máximo (RN-CORE-18; o payload não os traz; preço vem por `preco.atualizado@1` no Catálogo). SKU de outro produto do ERP: ignora com aviso; de cadastro sem `external_id`: adota. |
| `integracao.produto_unidade.atualizado@1` | `core.produto_unidade` | T-0061, RN-VEN-15. Unidades de venda (UN, CX c/ 12) e fator inteiro > 0, EAN opcional. Produto ausente = `referencia_ausente` (reprocessável). Invariantes da 0013: (produto, unidade) único vivo (a de cadastro sem `external_id` é adotada; a de outro `external_id` é ignorada com aviso) e **no máximo uma `padrao` viva por produto** (marcar uma nova desmarca a anterior na mesma transação). Inativada nunca é padrão. Fator ou sigla inválidos: ignora com aviso. |
| `integracao.cliente_endereco.atualizado@1` | `core.cliente_endereco` | T-0061, RF-CORE-12, RN-VEN-17. Endereços de entrega do ERP. Cliente ausente = `referencia_ausente`. **No máximo um `principal` vivo por cliente**: marcar um novo desmarca o anterior; `tipo: principal` vale como principal; cobrança e inativo nunca são principal. UF em maiúsculas, CEP só com dígitos (8) ou nulo, coordenada fora da faixa vira nula; sem logradouro/cidade/UF válidos: ignora com aviso (sem dado pessoal no log). |
| `integracao.titulo.atualizado@1` | `core.titulo` | `baixado` vira `liquidado`; sem emissão usa o vencimento; recalcula `saldo_aberto_cents` do financeiro. |
| `integracao.rota.atualizado@1` | `core.rota` + `core.rota_parada` | A rota do ERP é recorrente; o Core materializa as próximas 4 ocorrências do `dia_semana` (ou só hoje), `origem = erp`, `publicada`, `external_id = <rota>@<data>`. Futuro que saiu do conjunto e parada removida recebem `deleted_at`; passado não muda. Dia que o vendedor já tem rota de outra origem não é sobrescrito (aviso). |

## Limites assumidos
- A janela de 4 semanas das rotas só avança quando o ERP reenvia a rota (sem job de rematerialização na v1).
- Não há guarda de `alterado_em` no Core: a ordem entre duas versões do mesmo registro vem da outbox (o Hub já descarta
  versão obsoleta, RN-INT-02).
- Referência ausente esgotadas as 10 tentativas da outbox deixa o evento parado (monitor do Hub).

## Pendente
- `integracao.nota.atualizado@1` -> `core.historico_compra`: depende de tabela de notas (pedido ao banco-dados
  R-20261102-132945-modulo-core), para somar por cliente e mês sem duplicar na reentrega.
- Medidas (`core.medida`, `core.medidas@1`, RN-CORE-19) e custo/preço/desconto máximo vindos do `produto.atualizado@1`: fora da T-0061 do Core (recado R-20261102-123438).

## Leitura pública (T-0061)
O Vendedor não lê tabela do Core: usa as entidades de pull `cliente_endereco` (escopo carteira) e `produto_unidade` (escopo tenant)
com as funções puras de `@macuxi/core/contracts` (`contracts/enderecos.ts`): `enderecosDeEntrega`, `enderecoPadrao`,
`listarEnderecosDoCliente`, `unidadesDoProduto`, `unidadePadraoDoProduto`, `rotuloDaUnidade`, `fatorValido`. O Cliente 360
(API, app offline e BKO) mostra os endereços ativos com o padrão (principal; sem principal, o primeiro de entrega) destacado e
primeiro; o cadastro de produtos do BKO mostra UN/CX c/ fator com a padrão marcada. Testes: `api/enderecos-unidades.db.test.ts`.

# Consumidores do ERP no Core (T-0066)

O Hub aplica o lote e publica `integracao.<entidade>.atualizado@1` (um por registro que mudou). O Core consome os eventos
das entidades que ele é dono. Código: `modules/core/api/consumidores-erp*.ts`; regras puras: `domain/erp-mapeamento.ts`,
`domain/cliente-erp.ts`, `domain/produto.ts`. Testes × Postgres: `api/consumidores-erp.db.test.ts`.

Regras comuns: upsert por `external_id` (idempotente); inativação do ERP = `ativo = false` (usuário, produto, cliente) ou
`deleted_at` (título, rota, paradas, vínculos); referência ausente (RN-INT-04) lança `ReferenciaAusenteErp` e a outbox
repete (nada de órfão); só dado do ERP (linha com `external_id`) é removido ou trocado, o que foi criado à mão fica; sem
dado pessoal em log; fuso e relógio vêm de `ctx.fuso()` / `ctx.agora()`.

| Evento | Destino | Observações |
|---|---|---|
| `integracao.vendedor.atualizado@1` | `core.usuario` (perfil `vendedor`) | **Sem senha** (`senha_hash` nulo): o usuário só entra depois do convite/ativação pelo admin no BKO. E-mail ausente ou duplicado = e-mail provisório `erp-<hex>@sem-email.invalid`; usuário existente com o mesmo e-mail e sem `external_id` é adotado. Perfil e equipe nunca mudam pelo ERP (equipe é do BKO). Inativação bloqueia o login. |
| `integracao.cliente.atualizado@1` | `core.cliente` + `core.carteira` + `core.cliente_contato` + `core.cliente_financeiro` | Cadastro e cadastro mínimo (RN-CORE-16/17). Carteira: 1 vendedor por cliente (`carteira.external_id` = cliente); troca encerra o vínculo do ERP anterior; sem vendedor no payload encerra o do ERP; vínculos manuais e de promotor ficam. Contatos: `external_id = <cliente>:<posição>`, o 1º é principal se não houver outro. Financeiro: limite e bloqueio do payload; saldo = soma dos títulos abertos; crédito disponível calculado pelo domínio. Publica `core.cliente.atualizado@1` (origem `erp`). |
| `integracao.produto.atualizado@1` | `core.produto` | Cadastro base. Não toca custo, preço de venda nem desconto máximo (RN-CORE-18; o payload não os traz; preço vem por `preco.atualizado@1` no Catálogo). SKU de outro produto do ERP: ignora com aviso; de cadastro sem `external_id`: adota. |
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
- Eventos novos de `produto_unidade`, `cliente_endereco` e medidas: dependem do contrato da Integração.

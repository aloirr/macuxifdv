# Medidas do produto (RF-CORE-14; RN-CORE-19; T-0063)

Medidas por tenant (`core.medida`, migração 0018): sigla de 1 a 4 letras maiúsculas, única no tenant; descrição (até 40); ativa. Lista inicial em todo tenant: UN, CX, PCT, FD, LT, BD, TB, GL, KG, DZ, DP. Todo produto tem a medida da unidade (`core.produto.unidade`) e, opcionalmente, a embalagem (`embalagem_medida` + `embalagem_quantidade`, inteira > 1, medida diferente da unidade, as duas juntas ou nenhuma).

## Regras (`modules/core/domain/medida.ts`, testes citando RN-CORE-19)
- Sigla: aparada e em maiúsculas; fora de `^[A-Z]{1,4}$` = `MEDIDA_INVALIDA`. Descrição obrigatória.
- Inativar é permitido mesmo em uso: o produto mantém a sigla (e pode editar o resto) e a medida some das escolhas novas. Trocar para sigla inativa = `MEDIDA_INATIVA`; sigla inexistente = `MEDIDA_NAO_CADASTRADA`.
- Apagar (soft) só sem uso: "Medida em uso por N produto(s): inative em vez de apagar." (`MEDIDA_EM_USO`). A sigla de medida em uso não muda (a descrição sim). Sigla de medida apagada pode ser cadastrada de novo (a linha apagada é reaproveitada).
- O banco também protege (FK composta `(tenant_id, sigla)`, gatilho `medida_em_uso`); o erro dele vira 422, nunca 500.

## API (`/v1/core`, todas por tenant, licença do módulo e ação do manifesto)
| Rota | Ação | Perfis |
|---|---|---|
| `GET medidas` | `produto.editar_preco` | gerente, analista, admin |
| `POST medidas` `{id, sigla, descricao}` (201; idempotente pelo `id`) | `medida.gerenciar` | analista, admin |
| `PUT medidas/:id` `{sigla?, descricao?, ativo?}` (inativar/reativar = `ativo`) | `medida.gerenciar` | analista, admin |
| `DELETE medidas/:id` (204; só sem uso) | `medida.gerenciar` | analista, admin |
| `PUT produtos/:id/medidas` `{unidade, embalagem_medida?, embalagem_quantidade?}` | `medida.gerenciar` | analista, admin |

Erros 422: `MEDIDA_INVALIDA`, `MEDIDA_DUPLICADA`, `MEDIDA_INATIVA`, `MEDIDA_NAO_CADASTRADA`, `MEDIDA_EM_USO`, `EMBALAGEM_INCOMPLETA`, `EMBALAGEM_INVALIDA`. Toda escrita é auditada (`medida.criar|editar|inativar|reativar|apagar`, `produto.editar_medida`).

## Contratos
- Consulta pública `core.medidas@1` (`CONSULTA_MEDIDAS`): entrada `{ siglas: string[] }` (até 500, normalizadas), saída `{ medidas: [{ sigla, descricao, ativo }] }` só das que existem (ativas e inativas). Usada pelo Hub (sigla desconhecida ou inativa = `referencia_ausente`).
- Sync: entidade `medida` (pull, escopo tenant, inativas e removidas incluídas) e `produto` com `embalagem_medida`/`embalagem_quantidade` opcionais.
- ERP (`integracao.produto.atualizado@1`): grava `embalagem_medida`/`embalagem_quantidade` quando vierem; evento sem embalagem não apaga a que o BKO cadastrou; medida da unidade não cadastrada = registro ignorado com aviso (rede de segurança; o Hub já recusa antes).

## BKO
Parâmetros → Produtos: aba **Medidas** (cadastrar, editar, inativar/reativar, apagar só sem uso; busca por sigla ou descrição) e, na aba Produtos, a coluna **Medida** e o botão **Medidas** (medida da unidade só entre as ativas + embalagem opcional). Gerente consulta; analista e admin editam.

## Premissas
- Inativar em uso é permitido (premissa do gerente); apagar e trocar a sigla em uso são recusados.
- Produto que já usa uma medida depois inativada continua editável sem trocar a sigla.
- A embalagem do BKO fica em `core.produto`; o Core NÃO grava `core.produto_unidade` (unidades de venda do Vendedor) a partir dela.

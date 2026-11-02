# Medidas do produto (RF-CORE-14; RN-CORE-19; T-0063)

Medidas por tenant (`core.medida`, migração 0018): sigla de 1 a 4 letras maiúsculas, única no tenant; descrição (até 40); ativa. Lista inicial em todo tenant: UN, CX, PCT, FD, LT, BD, TB, GL, KG, DZ, DP. Todo produto tem a medida da unidade (`core.produto.unidade`) e, opcionalmente, a embalagem (`embalagem_medida` + `embalagem_quantidade`, inteira de 2 a 9999, medida diferente da unidade, as duas juntas ou nenhuma).

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

Erros 422: `MEDIDA_INVALIDA`, `MEDIDA_DUPLICADA`, `MEDIDA_INATIVA`, `MEDIDA_NAO_CADASTRADA`, `MEDIDA_EM_USO`, `EMBALAGEM_INCOMPLETA`, `EMBALAGEM_INVALIDA` (inclui quantidade fora de 2 a 9999), `EMBALAGEM_DIVERGE_ERP`. Toda escrita é auditada (`medida.criar|editar|inativar|reativar|apagar`, `produto.editar_medida`).

## Embalagem do produto x unidade de venda do ERP (`core.produto_unidade`) — precedência (RN-CORE-19, RN-VEN-15)
- **Fonte para o BKO**: a embalagem do produto (`embalagem_medida` + `embalagem_quantidade`) é o que o BKO e o PDF mostram e edita.
- **Fonte do pedido**: `core.produto_unidade` (sigla + `fator`) é a unidade de venda que veio do ERP e que o Vendedor usa no item.
- **Coerência** (função pura `validarMedidasDoProduto` + `reconciliarEmbalagemComErp`, `domain/medida.ts`): se existe `produto_unidade` VIVA (não apagada) com a mesma sigla da embalagem e fator de 2 a 9999, a `embalagem_quantidade` tem de ser igual ao `fator`. Fator 1 (a unidade base) nunca vira embalagem.
- **No BKO** (`PUT produtos/:id/medidas`): divergência = 422 `EMBALAGEM_DIVERGE_ERP`, "A embalagem CX deste produto já vem do ERP com N unidades. Informe N ou corrija a unidade de venda no ERP."
- **No consumidor do ERP** (`integracao.produto.atualizado@1`): o ERP prevalece. Depois do upsert, se a embalagem gravada tem a sigla de uma unidade de venda viva com fator diferente, a `embalagem_quantidade` do produto é atualizada para o fator, com log (só `external_id`, sigla e fator; sem dado pessoal). Vale também para evento sem embalagem (que mantém a do BKO). Quando o Core ganhar o consumidor de `integracao.produto_unidade.atualizado@1`, ele deve chamar a mesma `reconciliarEmbalagemComErp` depois de gravar o fator.
- Sigla sem `produto_unidade` correspondente: a embalagem do BKO vale como está.

## Teto da quantidade da embalagem
Inteiro de 2 a 9999 (`EMBALAGEM_QUANTIDADE_MIN/MAX` em `contracts/medida.ts`; o banco tem o mesmo CHECK). No BKO, fora disso = 422 `EMBALAGEM_INVALIDA` (o Zod do `PUT` é tolerante de propósito, para a mensagem em português sair do domain; os schemas de saída/pull validam o intervalo). No consumidor do ERP, a embalagem fora do intervalo (ou incompleta, ou igual à unidade) é **descartada com log**: o produto entra sem ela (ou mantém a do BKO), sem retentativa sem fim.

## Concorrência e casos de borda
- Dois `POST medidas` simultâneos com o MESMO `id` devolvem a mesma medida (`insert ... on conflict (id) do nothing`; só quem gravou audita). Com ids diferentes e a mesma sigla, um vence e o outro recebe **422** `MEDIDA_DUPLICADA` (o projeto usa 422 para regra de negócio, não 409).
- Recadastrar a sigla de uma medida apagada reaproveita a linha apagada e troca o `id` (PK) pelo do cliente; um aparelho que não sincronizou entre apagar e recriar guarda a medida antiga até o próximo pull completo (impacto baixo: o app procura por sigla).
- Produto do ERP com medida não cadastrada: o Hub já o barra antes com `referencia_ausente` (reprocessável, "Cadastre em Parâmetros → Produtos → Medidas"); o consumidor do Core só ignora com log como rede de segurança. Se a consulta `core.medidas@1` ficar indisponível (RN-INT-14), o lote pode fechar sem o produto e sem aviso no Hub: pendência registrada.
- O ERP não consegue remover a embalagem: evento sem embalagem mantém a do BKO.

## Contratos
- Consulta pública `core.medidas@1` (`CONSULTA_MEDIDAS`): entrada `{ siglas: string[] }` (até 500, normalizadas), saída `{ medidas: [{ sigla, descricao, ativo }] }` só das que existem (ativas e inativas). Usada pelo Hub (sigla desconhecida ou inativa = `referencia_ausente`).
- Sync: entidade `medida` (pull, escopo tenant, inativas e removidas incluídas) e `produto` com `embalagem_medida`/`embalagem_quantidade` opcionais.
- ERP (`integracao.produto.atualizado@1`): grava `embalagem_medida`/`embalagem_quantidade` quando vierem (2 a 9999; o ERP vence a `produto_unidade`, veja acima); evento sem embalagem não apaga a que o BKO cadastrou; medida da unidade não cadastrada = registro ignorado com aviso (rede de segurança; o Hub já recusa antes).

## BKO
Parâmetros → Produtos: aba **Medidas** (cadastrar, editar, inativar/reativar, apagar só sem uso; busca por sigla ou descrição) e, na aba Produtos, a coluna **Medida** e o botão **Medidas** (medida da unidade só entre as ativas + embalagem opcional). Gerente consulta; analista e admin editam.

## Premissas
- Inativar em uso é permitido (premissa do gerente); apagar e trocar a sigla em uso são recusados.
- Produto que já usa uma medida depois inativada continua editável sem trocar a sigla.
- A embalagem do BKO fica em `core.produto`; o Core NÃO grava `core.produto_unidade` (unidades de venda do Vendedor) a partir dela.

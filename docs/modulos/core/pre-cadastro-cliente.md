# Pré-cadastro de cliente (v1.0.28; RN-CORE-78, RN-CORE-79, RN-INT-22)

O FDV só faz o pré-cadastro; quem aprova é o ERP. Não há aprovação no BKO.

- **Criar:** `POST /v1/core/clientes/pre-cadastro` (ação `cliente.pre_cadastrar`), idempotente pelo `id`. Revalida os campos obrigatórios (razão social e CPF/CNPJ sempre; os demais pelo parâmetro da empresa). Falta de campo: 422 `CAMPOS_OBRIGATORIOS` com `detalhes.campos` (só as chaves). Grava `status_cadastro = 'pendente'` e publica `core.cliente.pre_cadastrado@1` (`cliente_id`, `recebido_em`) na mesma transação.
- **Fila do ERP:** consulta `core.clientes_pre_cadastro_sem_erp@1` (pendentes sem `external_id`, ordem de chegada, paginada por `depois_de`; campo `recebido_em`).
- **Retorno do ERP** (`integracao.cliente.retorno_erp@1`): `vinculado` grava `external_id`, `status_cadastro = 'aprovado'` e `aprovado_em`; `rejeitado_erp` grava `status_cadastro = 'recusado'` e `motivo_recusa` (até 500). O motivo nunca vai a log nem à auditoria. Os dois publicam `core.cliente.atualizado@1`. O legado `aprovado` sem código também recebe o código.
- **Parâmetro:** `GET|PUT /v1/core/parametros/pre-cadastro`. Leitura: ação `parametro.pre_cadastro` (admin, analista); gravação: `parametro.pre_cadastro_editar` (admin); auditada. Valor em `plataforma.parametro` (`core`, `cliente.pre_cadastro.obrigatorios`, lista de `nome_fantasia`, `inscricao_estadual`, `telefone`, `email`, `endereco`). O app lê pelo pull `parametro` (`obrigatoriosPreCadastroDasLinhas`).
- **BKO:** Parâmetros › Clientes › "Pré-cadastro de cliente" (`modules/core/web/components/pre-cadastro`).
- **Pull do cliente** leva `status_cadastro` e `motivo_recusa`.

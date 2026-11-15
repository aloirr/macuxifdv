# Vínculo automático do vendedor do ERP por nome (proposta, T-0175)

Status: PROPOSTA, sem código. Complementa o vínculo manual (RN-CORE-58). Se aprovada, vira RN-CORE-61.

## Regra
Na carga de vendedores do ERP, quando o usuário do Macuxi ainda não tem Código ERP e o NOME COMPLETO do vendedor do ERP é igual ao dele, o sistema grava o `external_id` nesse usuário, sem criar o provisório. O vínculo manual continua valendo para o que o automático não resolve.

## Normalização (função pura `normalizarNomeParaVinculo`)
Minúsculas; sem acentos (NFD); pontuação (`. , - ' _`) vira espaço; espaços repetidos viram um; trim. Só nome COMPLETO: igualdade exata depois disso, com pelo menos 2 palavras. Nada de "parecido" ou parcial ("Maria S." não casa com "Maria Souza").

## Quando NÃO vincula (sempre avisa, nunca escolhe)
- Homônimos: 2 ou mais usuários elegíveis com o mesmo nome normalizado, ou o mesmo nome em 2 vendedores do ERP na mesma carga. Não vincula; cria o provisório como hoje. Aviso no Monitor do Hub pelo código `referencia_ausente` (já existe no Hub; o dado ausente é "usuário único para este vendedor"), com o código ERP, o nome e a contagem de candidatos, sem e-mail nem dado pessoal.
- Usuário que já tem outro Código ERP: não vincula; aviso `referencia_ausente` com os dois códigos.
- Usuário inativo: não vincula (decisão do admin vale; RN-CORE-57); aviso. Reativar e vincular é manual.
- Perfil incompatível: só `vendedor` com vendedor e `promotor` com promotor (mesma regra do manual, `VINCULO_PERFIL_INCOMPATIVEL`). Os demais perfis nunca entram, mesmo com nome igual.
- Usuário provisório (e-mail `@sem-email.invalid`) nunca é candidato; vendedor do ERP inativo também não vincula.
- Aviso uma vez por código e nome (idempotente por carga reentregue).

## Onde roda
No consumidor `consumidores-erp-vendedor.ts` (core), no ramo "não há usuário com este `external_id`", ANTES do insert do provisório e depois da adoção por e-mail igual (que continua com prioridade). A busca é só em `core.usuario` do tenant (RLS), com a normalização aplicada em memória sobre vendedores/promotores vivos, ativos e sem `external_id`. Uma transação por evento, idempotente: reentrega acha o `external_id` já gravado e segue o ramo normal. Respeita `erp_alterado_em` e `desligado_no_bko_em` como a adoção por e-mail. Completa as notas do vendedor (`completarNotasDoVendedor`) como hoje.

## Auditoria
Registro `usuario.vincular_erp_por_nome` em `plataforma.auditoria` (ator sistema/Hub): `usuario_id`, `external_id`, regra, sem o nome. Cada aviso de recusa fica no Monitor.

## Desfazer
Pelo BKO, ação "Desvincular ERP" no usuário (admin, `usuario.editar`): limpa o `external_id`, audita `usuario.desvincular_erp` e grava uma marca de bloqueio (`vinculo_erp_auto_bloqueado_em`, a pedir ao banco-dados) para a carga não vincular de novo pelo mesmo nome; a carga seguinte cria o provisório e o admin escolhe o vínculo manual certo. Notas e carteira movidas pela carga voltam pelo vínculo manual.

## Pedidos a outros donos
- banco-dados: coluna `core.usuario.vinculo_erp_auto_bloqueado_em timestamptz`; nenhum índice novo.
- integracao: confirmar o texto do aviso `referencia_ausente` no Monitor e que o consumidor pode emitir o aviso (hoje só o Hub emite).

## Testes previstos
Domain (`RN-CORE-61`): normalização (caixa, acento, espaços, pontuação, nome de 1 palavra), candidato único, homônimo, outro código, inativo, perfis, provisório. DB: carga vincula e completa notas; homônimo e outro código criam provisório e avisam; reentrega idempotente; desvincular impede novo automático; auditoria sem nome; RLS entre tenants.

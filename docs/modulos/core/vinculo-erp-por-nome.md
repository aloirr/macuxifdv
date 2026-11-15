# Vínculo automático do vendedor do ERP por nome (aprovado, T-0175)

Status: APROVADO pelo dono do produto (R-20261115-111500) e IMPLEMENTADO na v1.0.12 como extensão da RN-CORE-58 (`domain/vinculo-por-nome.ts`, consumidor `consumidores-erp-vendedor.ts`). Complementa o vínculo manual. Desvio: o aviso das recusas sai como notificação aos admins (`notificarSistema`), pois o core não emite no Monitor do Hub; o aviso `referencia_ausente` no Monitor fica para a v1.0.13, pelo integracao.

## Regra
Na carga de vendedores do ERP, quando o usuário do Macuxi ainda não tem Código ERP e o NOME COMPLETO do vendedor do ERP é igual ao dele, o sistema grava o `external_id` nesse usuário, sem criar o provisório. O vínculo manual continua valendo para o que o automático não resolve.

## Normalização (função pura `normalizarNomeParaVinculo`)
Minúsculas; sem acentos (NFD); pontuação (`. , - ' _`) vira espaço; espaços repetidos viram um; trim. Só nome COMPLETO: igualdade exata depois disso, com pelo menos 2 palavras. Nada de "parecido" ou parcial ("Maria S." não casa com "Maria Souza").

## Quando NÃO vincula (sempre avisa, nunca escolhe)
- Homônimos: 2 ou mais usuários elegíveis com o mesmo nome normalizado, ou o mesmo nome em 2 vendedores do ERP na mesma carga. Não vincula; cria o provisório como hoje. Aviso por notificação aos admins na v1.0.12, só com o código ERP e a contagem de candidatos, sem nome nem e-mail. O aviso no Monitor do Hub (`referencia_ausente`) vem na v1.0.13, pelo integracao.
- Usuário que já tem outro Código ERP: não vincula; notificação aos admins (Monitor na v1.0.13).
- Usuário inativo: não vincula (decisão do admin vale; RN-CORE-57); notificação aos admins. Reativar e vincular é manual.
- Perfil incompatível: só `vendedor` com vendedor e `promotor` com promotor (mesma regra do manual, `VINCULO_PERFIL_INCOMPATIVEL`). Os demais perfis nunca entram, mesmo com nome igual.
- Usuário provisório (e-mail `@sem-email.invalid`) nunca é candidato; vendedor do ERP inativo também não vincula.
- Aviso uma vez por código e nome (idempotente por carga reentregue).

## Onde roda
No consumidor `consumidores-erp-vendedor.ts` (core), no ramo "não há usuário com este `external_id`", ANTES do insert do provisório e depois da adoção por e-mail igual (que continua com prioridade). A busca é só em `core.usuario` do tenant (RLS), com a normalização aplicada em memória sobre vendedores/promotores vivos, ativos e sem `external_id`. Uma transação por evento, idempotente: reentrega acha o `external_id` já gravado e segue o ramo normal. Respeita `erp_alterado_em` e `desligado_no_bko_em` como a adoção por e-mail. Completa as notas do vendedor (`completarNotasDoVendedor`) como hoje.

## Auditoria
Registro `usuario.vincular_erp_por_nome` em `plataforma.auditoria` (ator sistema/Hub, `usuario_id` nulo e `request_id` = id do evento): `usuario_id`, `external_id`, regra, sem o nome. Cada recusa vira notificação aos admins.


## Pedidos a outros donos
- integracao (v1.0.13): emitir o aviso `referencia_ausente` no Monitor; hoje só o Hub emite.

## Testes previstos
Domain (`RN-CORE-61`): normalização (caixa, acento, espaços, pontuação, nome de 1 palavra), candidato único, homônimo, outro código, inativo, perfis, provisório. DB: carga vincula e completa notas; homônimo e outro código criam provisório e avisam; reentrega idempotente; auditoria sem nome; RLS entre tenants.

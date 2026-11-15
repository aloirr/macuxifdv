# apps/api — API do Macuxi (Fastify, monólito modular)

O bootstrap monta só os módulos efetivos do usuário (licença, perfil e escopo de carteira em toda rota). A regra mora no
`domain` de cada módulo; a API revalida. A carga do ERP (lotes, ordem, erros por linha, Monitor) está em
[`docs/modulos/integracao/hub-api.md`](../../docs/modulos/integracao/hub-api.md); aqui não se repete.

## Regras de carga e de usuário (decisões de 15/11/2026)

Situação conferida no `main` em 15/11/2026 (horário de Manaus). "Pendente" = decidido, ainda não está no código.

| # | Regra | RN | Situação no código |
|---|---|---|---|
| 1 | Ordem única de carga, filial primeiro | RN-INT-04, RN-CORE-39 | Feita: `ORDEM_CARGA_ENTIDADES` em `modules/integracao/contracts/entidades.ts` e `DEPENDENCIAS` em `modules/integracao/domain/ordem.ts`. |
| 2 | Usuário com filial de cadastro (obrigatória) e filiais de venda (pelo menos 1, a de cadastro sempre incluída). O vendedor vem do ERP com `filial_external_id`; filial inexistente = linha `referencia_ausente`, reprocessável no Monitor | RN-CORE-39 | Parcial: o Hub confere a referência (`referencia_ausente`) e avisa `vendedor_sem_filial`. Pendente: gravar as filiais no usuário (Core e banco); o doc 03 e o contrato ainda dizem "exatamente uma filial" para o vendedor. |
| 3 | Referência cruzada: só o código é obrigatório; marca opcional, pelo `marca_external_id` ou pelo nome; marca inativa ou ausente fica oculta | RN-CAT-09 | Parcial: o contrato do Hub aceita sem marca. O Catálogo (`resolverReferenciasDoErp`) ainda descarta a referência sem marca, com marca desconhecida ou inativa, em vez de guardá-la oculta. |
| 4 | Código FDV do usuário: 5 dígitos sequenciais por empresa (`00001`), em todos os perfis, gerado pelo sistema, só leitura | — | Pendente (sem RN no doc 03 e sem código). |
| 5 | Usuário nunca é excluído, só desativado, inclusive pela carga. Única exceção: a exclusão da empresa inteira | RN-INT-06 (carga inativa, nunca apaga); exceção: RN-PLA-09/10 (ADR 0052; ainda fora do doc 03) | Feita: não há rota de exclusão de usuário; a carga do ERP só faz `ativo = false` (`modules/core/api/consumidores-erp-vendedor.ts`). |
| 6 | Vínculo do usuário com o ERP: manual no BKO ou automático pelo nome completo normalizado (sem caixa, acentos e pontuação; espaços juntados; 2 palavras ou mais; igualdade exata). Vincula só com **um** candidato ativo, do mesmo perfil e sem código ERP; com homônimo, outro código ERP ou usuário inativo não vincula, cria o provisório e avisa os admins (notificação). Ordem na carga: e-mail, depois nome, depois provisório | RN-CORE-58, RN-CORE-61 | Feita no branch `nuvem/codigo-fdv-modulo-core` (`modules/core/domain/vinculo-por-nome.ts` e `consumidores-erp-vendedor.ts`), ainda não no `main`; no `main` a adoção automática é só pelo e-mail. |
| 7 | Estoque: só das filiais de venda do usuário; N = soma delas | RN-CORE-39, RN-CAT-07 | Pendente: hoje vale a filial do cliente (com cliente) ou as filiais da carteira (sem cliente), em `filiaisDoEstoque` (`modules/catalogo/domain/estoque.ts`). A soma dos depósitos por filial já é feita. |

# apps/api — API do Macuxi (Fastify, monólito modular)

O bootstrap monta só os módulos efetivos do usuário (licença, perfil e escopo de carteira em toda rota). A regra mora no
`domain` de cada módulo; a API revalida. A carga do ERP (lotes, ordem, erros por linha, Monitor) está em
[`docs/modulos/integracao/hub-api.md`](../../docs/modulos/integracao/hub-api.md); aqui não se repete.

## Regras de carga e de usuário (decisões de 15/11/2026)

O texto das regras está na [§21 do `hub-api.md`](../../docs/modulos/integracao/hub-api.md#21-regras-de-carga-15112026) (docs do Hub); aqui fica só a situação no código, conferida no `main` em 15/11/2026 (horário de Manaus). "Pendente" = decidido, ainda não está no código.

| # | Regra | RN | Situação no código |
|---|---|---|---|
| 1 | Ordem única de carga, filial primeiro | RN-INT-04, RN-CORE-39 | Feita: `ORDEM_CARGA_ENTIDADES` em `modules/integracao/contracts/entidades.ts` e `DEPENDENCIAS` em `modules/integracao/domain/ordem.ts`. |
| 2 | Filiais do usuário (cadastro e venda) | RN-CORE-39 | Parcial: o Hub confere a referência (`referencia_ausente`) e avisa `vendedor_sem_filial`. Pendente: gravar as filiais no usuário (Core e banco); o doc 03 e o contrato ainda dizem "exatamente uma filial" para o vendedor. |
| 3 | Referência cruzada só com o código | RN-CAT-09 | Parcial: o contrato do Hub aceita sem marca. O Catálogo (`resolverReferenciasDoErp`) ainda descarta a referência sem marca, com marca desconhecida ou inativa, em vez de guardá-la oculta. |
| 4 | Código FDV do usuário | — | Pendente (sem RN no doc 03 e sem código). |
| 5 | Usuário nunca excluído, só desativado | RN-INT-06 (carga inativa, nunca apaga); exceção: RN-PLA-09/10 (ADR 0052; ainda fora do doc 03) | Feita: não há rota de exclusão de usuário; a carga do ERP só faz `ativo = false` (`modules/core/api/consumidores-erp-vendedor.ts`). |
| 6 | Vínculo do usuário com o ERP | RN-CORE-58, RN-CORE-61 | Feita no branch `nuvem/codigo-fdv-modulo-core` (`modules/core/domain/vinculo-por-nome.ts` e `consumidores-erp-vendedor.ts`), ainda não no `main`; no `main` a adoção automática é só pelo e-mail. |
| 7 | Estoque pelas filiais de venda | RN-CORE-39, RN-CAT-07 | Pendente: hoje vale a filial do cliente (com cliente) ou as filiais da carteira (sem cliente), em `filiaisDoEstoque` (`modules/catalogo/domain/estoque.ts`). A soma dos depósitos por filial já é feita. |

# Módulos e dependências

| Módulo | Depende | Opcionais | Apps | Perfis |
|---|---|---|---|---|
| core | — | — | campo, gestao, web | todos |
| catalogo | core | — | campo, gestao, web | vendedor, promotor, supervisor, gerente, analista, assistente (o Vendedor depende dele; ADR 0005) |
| vendedor | core, catalogo | — | campo, web | vendedor, analista, assistente (+ gestor via extensão) |
| promotor | core | catalogo, pesquisa, vendedor | campo, gestao, web | promotor, supervisor, gerente, analista, admin (cadastros de trade, T-0010) |
| gestor | core | vendedor, promotor, pesquisa, treinamento | gestao, web | supervisor, gerente |
| pesquisa | core | — | campo, gestao, web | vendedor, promotor, supervisor, gerente, analista, admin |
| treinamento | core | vendedor | campo, gestao, web | vendedor, promotor, supervisor, gerente, analista, admin |
| integracao | core | — | web, conector | admin, analista |

> Fonte da verdade: `modules/<m>/manifest.ts`. Espelho com teste de consistência: `packages/platform-sdk/src/manifestos-referencia.test.ts`.
> ADR 0005 (T-0007): o cadastro base de produto é do Core; o Catálogo é dono de preço, estoque, conteúdo e busca. O Vendedor
> **depende** do Catálogo: desativar o Catálogo desativa o Vendedor (RN-CORE-03; teste `tests/modulos/produto-dono.test.ts`).
> Ordem de instalação nos shells: core → catalogo → vendedor (`ordenarPorDependencia`).

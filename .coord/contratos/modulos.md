# Módulos e dependências

| Módulo | Depende | Opcionais | Apps | Perfis |
|---|---|---|---|---|
| core | — | — | campo, gestao, web | todos |
| catalogo | core | — | campo, gestao, web | vendedor, promotor, supervisor, gerente, analista |
| vendedor | core | catalogo | campo, web | vendedor, analista, assistente (+ gestor via extensão) |
| promotor | core | catalogo, pesquisa, vendedor | campo, gestao, web | promotor, supervisor, gerente, analista |
| gestor | core | vendedor, promotor, pesquisa, treinamento | gestao, web | supervisor, gerente |
| pesquisa | core | — | campo, gestao, web | vendedor, promotor, supervisor, gerente, analista |
| treinamento | core | vendedor | campo, gestao, web | vendedor, promotor, supervisor, gerente, analista |
| integracao | core | — | web, conector | admin, analista |

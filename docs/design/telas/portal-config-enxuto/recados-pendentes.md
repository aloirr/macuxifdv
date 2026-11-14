# Recados pendentes (designer-ux, 2026-11-14)

`node scripts/coord.mjs enviar` falhou nesta sessão (HTTP 403: GraphQL indisponível; repositório de recados não liberado). Quem tiver acesso, poste os três recados abaixo com estes comandos; o designer-ux apaga este arquivo no próximo lote.

```
node scripts/coord.mjs enviar --de designer-ux --para engenheiro-apps --tipo pedido --assunto "Portal config. enxuto: implementar spec" --corpo "Contexto: pedido de enxugar o config. | O que preciso: implementar docs/design/telas/portal-config-enxuto.md no branch nuvem/portal-parametros-engenheiro-apps; cópia corretor-redundancias e design-de-marca | Pronto quando: telas iguais às simulações depois-*, testes verdes"

node scripts/coord.mjs enviar --de designer-ux --para corretor-redundancias --tipo aviso --assunto "Portal config. enxuto: implementar spec" --corpo "Contexto: pedido de enxugar o config. | O que preciso: implementar docs/design/telas/portal-config-enxuto.md no branch nuvem/portal-parametros-engenheiro-apps; cópia corretor-redundancias e design-de-marca | Pronto quando: telas iguais às simulações depois-*, testes verdes"

node scripts/coord.mjs enviar --de designer-ux --para design-de-marca --tipo aviso --assunto "Portal config. enxuto: implementar spec" --corpo "Contexto: pedido de enxugar o config. | O que preciso: implementar docs/design/telas/portal-config-enxuto.md no branch nuvem/portal-parametros-engenheiro-apps; cópia corretor-redundancias e design-de-marca | Pronto quando: telas iguais às simulações depois-*, testes verdes"
```

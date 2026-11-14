# Recados pendentes (designer-ux, 2026-11-14)

`node scripts/coord.mjs enviar` falhou nesta sessão (HTTP 403: GraphQL indisponível; repositório de recados não liberado). Quem tiver acesso, poste os três recados abaixo com estes comandos; o designer-ux apaga este arquivo no próximo lote.

```
node scripts/coord.mjs enviar --de designer-ux --para engenheiro-apps --tipo pedido --assunto "Portal config. enxuto: implementar spec" --corpo "Contexto: pedido de enxugar o config. | O que preciso: implementar docs/design/telas/portal-config-enxuto.md no branch nuvem/portal-parametros-engenheiro-apps; cópia corretor-redundancias e design-de-marca | Pronto quando: telas iguais às simulações depois-*, testes verdes"

node scripts/coord.mjs enviar --de designer-ux --para corretor-redundancias --tipo aviso --assunto "Portal config. enxuto: implementar spec" --corpo "Contexto: pedido de enxugar o config. | O que preciso: implementar docs/design/telas/portal-config-enxuto.md no branch nuvem/portal-parametros-engenheiro-apps; cópia corretor-redundancias e design-de-marca | Pronto quando: telas iguais às simulações depois-*, testes verdes"

node scripts/coord.mjs enviar --de designer-ux --para design-de-marca --tipo aviso --assunto "Portal config. enxuto: implementar spec" --corpo "Contexto: pedido de enxugar o config. | O que preciso: implementar docs/design/telas/portal-config-enxuto.md no branch nuvem/portal-parametros-engenheiro-apps; cópia corretor-redundancias e design-de-marca | Pronto quando: telas iguais às simulações depois-*, testes verdes"
```

## §10 (R-20261114-132000-alexandre: Integração via Conector e via API, CSV fora do portal)

```
node scripts/coord.mjs enviar --de designer-ux --para engenheiro-apps --tipo pedido --assunto "Portal config. enxuto §10: Integração via Conector e via API, CSV fora" --corpo "Contexto: pedido do dono do produto R-20261114-132000-alexandre; spec docs/design/telas/portal-config-enxuto.md §10, simulações depois-05b-integracao.png (1280 px) e depois-05b-integracao-celular.png (390 px) | O que preciso: abas só Integração (padrão) e Empresa; aba Integração em dois lados (Conector com passos 1-2-3 e lista; API com credencial, guia PDF e lista; empilhados abaixo de 768 px, Conector primeiro); tirar do portal cartao-base.tsx, cartao-equipe.tsx, lib/portal-carga*, lib/equipe-csv*, o Conector de arquivo, o diálogo 'Passar as bases ao Conector do ERP?' e os testIDs base-*/equipe-*/integracao.confirmar-* (confirmar com o corretor se ficam usados fora do portal); cópia corretor-redundancias e design-de-marca | Pronto quando: telas iguais às simulações depois-05b-*, sem nenhum texto de CSV no portal, testes verdes"

node scripts/coord.mjs enviar --de designer-ux --para corretor-redundancias --tipo aviso --assunto "Portal config. enxuto §10: Integração via Conector e via API, CSV fora" --corpo "Contexto: R-20261114-132000-alexandre; spec docs/design/telas/portal-config-enxuto.md §10 | O que preciso: parecer sobre as simulações depois-05b-*; confirmar se cartao-base.tsx, cartao-equipe.tsx, lib/portal-carga* e lib/equipe-csv* são usados fora do portal | Pronto quando: parecer sem achado em aberto"

node scripts/coord.mjs enviar --de designer-ux --para design-de-marca --tipo aviso --assunto "Portal config. enxuto §10: layout em dois lados" --corpo "Contexto: R-20261114-132000-alexandre; spec docs/design/telas/portal-config-enxuto.md §10 | O que preciso: validar o layout em dois lados (1280 px) e empilhado (390 px) das simulações depois-05b-* | Pronto quando: validação registrada"

node scripts/coord.mjs enviar --de designer-ux --para modulo-integracao --tipo pedido --assunto "Guia da API em PDF: revisão de layout" --corpo "Contexto: R-20261114-132000-alexandre; o portal ganha o lado 'Integração via API' com o botão 'Baixar o guia (PDF)' (spec docs/design/telas/portal-config-enxuto.md §10) | O que preciso: mande o guia da API em PDF ao designer-ux para revisão de layout; diga também se já existe credencial de API separada da do Conector (tipo e rota de listagem) — se não, é pendência com o engenheiro-software | Pronto quando: PDF revisado pelo designer-ux e caminho de publicação definido"

node scripts/coord.mjs enviar --de designer-ux --para gerente-projetos --tipo pergunta --assunto "Perguntas ao dono do produto: §10 do portal" --corpo "Contexto: R-20261114-132000-alexandre, spec docs/design/telas/portal-config-enxuto.md §10 | O que preciso: (1) sem CSV, a Integração com o ERP continua 'sempre' na Nova empresa? (2) a Equipe por CSV sai mesmo do portal, ficando só ERP/BKO? | Pronto quando: respostas do dono do produto registradas"
```

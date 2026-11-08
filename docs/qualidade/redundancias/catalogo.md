# Catálogo de redundâncias (RD)

Este catálogo é mantido pelo **corretor-redundancias**. Cada achado tem um número `RD-nnnn` sequencial, e o
detalhe de cada um fica no relatório indicado. O status de cada achado é um destes: `aberto` (recado enviado ao dono),
`em correção` (dono confirmou), `corrigido` (reteste com evidência), `reaberto` (reteste falhou), `manter`
(redundância útil, com justificativa) ou `fora` (não é RD).

Severidade: **alta** (confunde ou contradiz) · **média** (polui) · **baixa** (estética).

| ID | Onde | Tipo | Severidade | Dono | Status | Relatório | Recado |
|---|---|---|---|---|---|---|---|
| RD-0001 | Campo › Início › "META DE HOJE" com o realizado do mês | — | — | testes · engenheiro-apps | **fora**: defeito funcional, não é RD. Saiu do escopo por decisão do dono do produto (08/11 ~14h). Correção no shell (R-20261108-154308-engenheiro-apps). O número fica reservado | [2026-11-08-inicio-campo](2026-11-08-inicio-campo.md) | R-20261108-144456-testes |
| RD-0002 | Campo › Início › cartão Meta: progresso do mês em 4 representações | indicador | alta | engenheiro-apps · modulo-core · designer-ux | aberto | [2026-11-08-inicio-campo](2026-11-08-inicio-campo.md#rd-0002--progresso-do-mês-em-4-representações-no-mesmo-cartão) | R-20261108-161014 · R-20261108-161023 · R-20261108-161038 |
| RD-0003 | Campo › Início: "hoje" repetido (4–5×) com a data no cabeçalho | texto | média | engenheiro-apps · banco-dados · designer-ux | aberto | [2026-11-08-inicio-campo](2026-11-08-inicio-campo.md) | R-20261108-161014 · R-20261108-161050 · R-20261108-161038 |
| RD-0004 | Campo › Início › cartão Meta: "mês" repetido (3–5×) | texto | média | engenheiro-apps | aberto | [2026-11-08-inicio-campo](2026-11-08-inicio-campo.md) | R-20261108-161014 |
| RD-0005 | Campo › Início › linhas Positivação e Visitas: unidade repetida | texto | média | engenheiro-apps | aberto | [2026-11-08-inicio-campo](2026-11-08-inicio-campo.md) | R-20261108-161014 |
| RD-0006 | Campo › Início: "sem rota" e "não é dia útil" ditos 2× | texto | média | engenheiro-apps | aberto | [2026-11-08-inicio-campo](2026-11-08-inicio-campo.md) | R-20261108-161014 |
| RD-0007 | Campo › Início › Cobertura "0% meta 90%" × "x de y" (Visitas × Cobertura: `manter?`) | indicador | média | engenheiro-apps · gerente-projetos | aberto | [2026-11-08-inicio-campo](2026-11-08-inicio-campo.md) | R-20261108-161014 |
| RD-0008 | Campo › Início: aviso de dado antigo preso ao cartão Meta, e "Sincronize" 2× | layout | média | designer-ux · engenheiro-apps | aberto | [2026-11-08-inicio-campo](2026-11-08-inicio-campo.md) | R-20261108-161038 · R-20261108-161014 |
| RD-0009 | Campo › Início › Recados: selo + bolinha, "Ver todos" com 1, prévia cortada | texto · layout | baixa | engenheiro-apps · modulo-core | aberto | [2026-11-08-inicio-campo](2026-11-08-inicio-campo.md) | R-20261108-161014 · R-20261108-161023 |
| RD-0010 | Campo › Início: Orçamentos "0" + "R$ 0"; barras vazias seguidas | indicador | baixa | modulo-vendedor · engenheiro-apps | aberto | [2026-11-08-inicio-campo](2026-11-08-inicio-campo.md) | R-20261108-161030 · R-20261108-161014 |
| RD-0011 | Campo › Início › Orçamentos e A faturar repetem a aba Pedidos (ficam, porque abrem filtrado; 2 cartões viram 1) | layout | baixa | modulo-vendedor · designer-ux | aberto | [2026-11-08-inicio-campo](2026-11-08-inicio-campo.md) | R-20261108-161030 |
| RD-0012 | `apps/mobile/src/lib/inicio.ts` + `(tabs)/index.tsx`: contornos que repetem regras do Core e não rodam | código | média | engenheiro-apps · modulo-core | aberto | [2026-11-08-inicio-campo](2026-11-08-inicio-campo.md) | R-20261108-161014 · R-20261108-161023 |
| RD-0013 | `modules/core/contracts/inicio.ts:193` `VisaoInicio.sincronizacao` sem leitor | código | baixa | modulo-core | aberto | [2026-11-08-inicio-campo](2026-11-08-inicio-campo.md) | R-20261108-161023 |
| RD-0014 | T-0111 · rótulos dos 7 perfis base em 4 mapas, 3 textos (Admin × Administrador; Assistente × Assistente de BKO) | texto | média | engenheiro-software · designer-ux · modulo-core | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173557 · R-20261108-173629 · R-20261108-173537 |
| RD-0015 | T-0111 · RN-CORE-33 em listas fixas fora do motor (`PERFIS_DO_APP`, `BASES_SEM_BKO`, `perfis-page.tsx:258`); SQL da 0041/0046 = manter | código | média | engenheiro-software · modulo-core | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173557 · R-20261108-173537 |
| RD-0016 | T-0111 · `acesso.ts` (+ teste) copiado entre `apps/mobile` e `apps/web`; nomes dos lugares em 3 mapas | código | baixa | engenheiro-apps · engenheiro-software | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173615 · R-20261108-173557 |
| RD-0017 | T-0111 · página Perfis: mensagens repetidas (7×, 3×) e a tela decide comparando o texto | texto | média | modulo-core | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173537 |
| RD-0018 | T-0111 · `core/web/lib/perfis.ts`: `ORDEM_ESCOPO` copiado, caminho morto `:188-189`, comparação de alvos 2×, 40 literal | código | baixa | modulo-core | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173537 |
| RD-0019 | T-0094 · ciclo de senha implementado 2× (app `core/app/lib/senha.ts` × BKO `apps/web/lib/ciclo-senha.ts`): 6 funções e 12 textos | código · texto | média | modulo-core · engenheiro-apps | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173537 · R-20261108-173615 |
| RD-0020 | T-0094 · validação do login copiada (app × BKO) e `EMAIL_RE` em 7 arquivos | código | média | engenheiro-software · modulo-core · engenheiro-apps | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173557 · R-20261108-173537 · R-20261108-173615 |
| RD-0021 | T-0094 · regra da senha em 3 redações; frase do que falta em 2 funções (kit com 8 literal) | texto · código | baixa | designer-ux · modulo-core | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173629 · R-20261108-173537 |
| RD-0022 | T-0094 · StyleSheet e link "Voltar ao login" repetidos nas 3 telas de acesso do app | layout · código | baixa | modulo-core | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173537 |
| RD-0023 | T-0113 · normalização do nome da marca 3× no Catálogo, uma na rota (fora do domain) | código | média | modulo-catalogo | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173643 |
| RD-0024 | T-0113 · `catalogo/domain/marcas.ts` ainda diz que a marca é do Promotor; "cadastro de concorrentes" × "Marcas concorrentes" | doc · texto | baixa | modulo-catalogo | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173643 |
| RD-0025 | T-0113 · Promotor: caminho de escrita do `concorrente` morto (validação, schema, corpo do form) | código | baixa | modulo-promotor | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173656 |
| RD-0026 | T-0114 · monitor: alerta `cancelamento_recusado` 2× na página, "ERP" 4× na frase, UUID ao lado do número | texto · layout | média | modulo-integracao | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173714 |
| RD-0027 | T-0114 · leitura do aceite de cancelamento escrita 2× no Hub | código | baixa | modulo-integracao | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173714 |
| RD-0028 | T-0114 · `vendedor/domain/order.ts`: apelidos de status em 3 listas | código | baixa | modulo-vendedor | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173728 |
| RD-0029 | T-0114 · ajuda de "Cancelar pedido" na página Perfis repete a regra de antes da T-0114 | texto · doc | baixa | modulo-core | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173537 |
| RD-0030 | T-0119 · critérios do ranking (tolerância, código, filtros) copiados no índice de pré-seleção | código | média | modulo-catalogo | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173643 |
| RD-0031 | T-0119 · documento do ranking montado 2× (`busca-consulta.ts` × `docDeBusca`) | código | baixa | modulo-catalogo | aberto | [2026-11-08-lote](2026-11-08-lote.md) | R-20261108-173643 |

## Encaminhados ao testes (defeito funcional, sem número RD)
| Data | Onde | Recado |
|---|---|---|
| 2026-11-08 | Campo › Início › Recados: um recado antigo aparece só com a hora, sob "de hoje" | R-20261108-161059-corretor-redundancias |
| 2026-11-08 | T-0114 · `orderActions`: `can_cancel` liberado com `locked_reason` "cancele no ERP" | R-20261108-173739-corretor-redundancias |
| 2026-11-08 | T-0094 · "Crie sua senha": fallback do 422 RN-CORE-32 diferente no app e no BKO | R-20261108-173739-corretor-redundancias |
| 2026-11-08 | T-0119 · `catalogo.busca_produtos@1` na API sem o índice nem o cache (20 mil); `referencias: []` | R-20261108-173739-corretor-redundancias |

# Vendedor — "Desc./Acrésc. (%)" do prazo de pagamento (proposta)

Pedido do Alexandre: R-20261115-111000, alvo **v1.0.13**. **Etapa 1: só proposta, nenhum código.** Nada aqui está aprovado; as decisões abaixo são a recomendação do `modulo-vendedor` e esperam o "de acordo" do Alexandre (perguntas na seção 9).

Referências: doc 03 (`docs/produto/03-regras-de-negocio.md`) RN-VEN-02 (l. 191), RN-VEN-03 (l. 200), RN-VEN-10 (l. 201), RN-VEN-18 e preço congelado (l. 247-250), RN-VEN-24/25 (l. 270-275), RN-VEN-40 (l. 286), RN-VEN-42 (l. 288-299), RN-INT-09 (l. 390); doc 06 (integração ERP); `pedido-e-aprovacao.md` e `pre-venda-e-erp.md` desta pasta.

## 0. O que existe hoje (levantamento)
- **O prazo é do Vendedor**, não do Core: `vendedor.prazo_pagamento` (migração 0037, `db/migrations/0037_forma_prazo_escalonada.up.sql` l. 14-26), com parcelas e prazo médio, sem nenhum percentual. Domínio: `modules/vendedor/domain/pagamento.ts` (`PrazoDePagamento`, l. 13-24; `prazoMedioDias`, `descricaoPrazo`).
- **BKO**: `modules/vendedor/web/pages/formas-pagamento-page.tsx` e `web/lib/formas-pagamento.ts` (`FormPrazo`, `parcelasDoTexto`, CSV); contrato `modules/vendedor/contracts/formas-pagamento.ts` (`PrazoPagamento`, `SalvarPrazoRequest`).
- **App (pull)**: `PrazoPagamentoSyncSchema` em `modules/vendedor/contracts/sync.ts` (l. 177-190), **`.strict()`**.
- **Hub**: `PrazoPagamentoPayload` em `modules/integracao/contracts/entidades.ts` (l. 345-364) e `PagamentoErp` (forma, prazo, parcelas, prazo médio) em `modules/integracao/contracts/pedido.ts` (l. 86-98), campo `pagamento` do `PedidoParaErp` (l. 113-123). `VERSAO_CONTRATO = 'v1'` (`contracts/base.ts` l. 12); campo novo opcional é compatível (RN-INT-09).
- **Kit/Conector**: tabela `dbo.tha_prazo_pagamento` e view `vw_macuxi_prazo_pagamento` (`modules/integracao/kit-thathyany/sql/criar-banco.sql` l. 83-98 e 374-376); staging do pedido com `pagamento_*` (l. 498-501) e a procedure de entrada (l. 545-568); view-modelo em `db/conector/views-modelo.sql` (l. 172-181); mapeamento do pedido em `apps/conector/src/pedidos.ts` (l. 110-156); consulta do prazo em `apps/conector/exemplos/conector.exemplo.json` (l. 163-166).
- **Totais**: `totaisDoPedido` (`modules/vendedor/domain/preco-pedido.ts` l. 284-313), `nivelDeAprovacao` (l. 319), `linhasDosTotais` (`domain/apresentacao-totais.ts` l. 30-50), usado no Resumo, no detalhe e nos PDFs.
- A RN-VEN-02 ainda cita "± ajuste financeiro da condição" (resto da condição de pagamento legada, RN-VEN-14). Esta proposta **dá corpo a essa frase**.

## 1. Onde aplica: total do pedido ou cada item; ordem
**Decisão:** o percentual do prazo incide **sobre o total do pedido**, **depois** dos descontos/acréscimos dos itens e do desconto/acréscimo do pedido (RN-VEN-02), e antes de qualquer frete (o frete não tem valor, RN-VEN-16). Ordem:
1. preço de tabela do item → desconto/acréscimo do item (preço unitário arredondado, como hoje);
2. soma dos itens → desconto/acréscimo do pedido (rateio pelo maior resto, como hoje) = **total dos itens**;
3. **ajuste do prazo** = total dos itens × percentual do prazo (seção 4) → **Valor final**.

O ajuste do prazo é **rateado nas linhas pelo maior resto** (mesma função `ratear` da RN-VEN-02), para que o `total_cents` de cada linha enviado ao ERP continue somando exatamente o total do pedido.

**Justificativa:** o "% Acres.Fin." do ERP é uma característica do prazo (custo financeiro), não do produto; vale para o pedido inteiro e tem de ser o último passo, para não "descontar do desconto". Um só arredondamento no total (mais o rateio) evita acumular centavos de arredondamento por item.
**Alternativa descartada:** aplicar em cada item (alteraria o preço unitário e o mínimo do produto, e espalharia erro de arredondamento por linha); aplicar antes do desconto do pedido (o vendedor digitaria o desconto sobre um valor que ele não vê).

## 2. Conta na alçada de desconto?
**Decisão: não.** A alçada (RN-VEN-10) e o desconto efetivo (RN-VEN-03) continuam olhando só descontos **concedidos pelo vendedor** (item e pedido); o ajuste do prazo fica **fora** do cálculo, assim como o preço mínimo do item (RN-VEN-11), o "Limitar desconto por pedido" e o "Desconto máximo do pedido (%)". Pedido em nome usa a alçada do gestor com a mesma conta (RN-VEN-35).
**Justificativa:** o percentual vem do cadastro (ERP/BKO), o vendedor não o escolhe nem o altera; o desconto do prazo à vista (−1,71%) levaria pedidos à vista a esbarrar na alçada de 5% sem nenhuma concessão do vendedor. Acréscimo do prazo também não "libera" desconto.
**Alternativa descartada:** somar ao desconto efetivo (distorce a alçada e o relatório de descontos; o supervisor aprovaria "desconto" que é de cadastro). Para o gerente enxergar o efeito, o relatório de descontos passa a mostrar o ajuste do prazo em **coluna separada** (seção 9, Gestor).
**Crédito (RN-VEN-12)** usa o **Valor final** (com o prazo): é o que o cliente passa a dever.

## 3. Aparece nos totais da tela e no PDF
**Decisão:** **linha própria**, logo abaixo das linhas de Desconto/Acréscimo do pedido e acima do "Valor final", **só quando o percentual do prazo ≠ 0** (nunca "fixa", ao contrário das três linhas fixas do Resumo, que existem para o cartão não mudar de altura). Uma linha só, com o % no rótulo e o valor em R$ no valor:

| Situação | Rótulo exato | Valor |
|---|---|---|
| percentual negativo | `Desconto do prazo (1,71%)` | `− R$ 17,10` |
| percentual positivo | `Acréscimo do prazo (2,50%)` | `+ R$ 25,00` |
| percentual 0 | (a linha não aparece) | — |

Mesma função de `domain` (`linhasDosTotais`) para Resumo, detalhe do pedido/orçamento (app e BKO) e os dois PDFs (cliente e interno); o PDF usa o mesmo rótulo. As linhas existentes "Valor de tabela / Desconto (%) / Desconto (R$)" passam a calcular a partir do **total dos itens (antes do prazo)**, para não misturar os dois ajustes (hoje usam `total_cents − subtotal_cents`, `apresentacao-totais.ts` l. 31). Nada novo em "Alertas" (RN-VEN-42: o prazo não bloqueia nem muda o resultado). Na **folha do item** não aparece (o prazo é do pedido). Na lista de prazos da aba Venda, o percentual aparece como texto curto à direita (`−1,71%`), **só quando ≠ 0**, porque o vendedor o usa para escolher (decisão final de forma com o `designer-ux`).
**Justificativa:** "uma informação, um lugar" e "só o que o usuário usa para agir": o cliente precisa ver de onde vem a diferença entre tabela e valor final; uma linha basta e o % no rótulo evita o par %/R$ (menos ruído que duas linhas).
**Alternativa descartada:** duas linhas (%/R$) como no desconto do pedido (mais altura para um dado secundário); embutir no "Desconto (R$)" (misturaria o desconto do vendedor, que vai para a alçada, com o do cadastro).

## 4. Limites, precisão e arredondamento
**Decisão:**
- **Faixa:** −99,99 a +99,99, **2 casas** (0,01 ponto percentual). Vazio/ausente = 0. Negativo = desconto, positivo = acréscimo.
- **Banco:** `numeric(5,2)` (mesma convenção dos percentuais da 0013: `db/migrations/0013*.up.sql` l. 25), `not null default 0`, `check (between -99.99 and 99.99)`.
- **Contrato JSON/CSV:** número decimal com até 2 casas (`z.number().min(-99.99).max(99.99)` + checagem de centésimos), pois o ERP e o CSV já falam decimal.
- **Domain:** converte para **inteiro em centésimos de ponto percentual** (`bp`; −1,71 → −171) logo na entrada e **nunca usa ponto flutuante** na conta de dinheiro.
- **Arredondamento (centavos):** `ajuste_cents = arredondarMeiaParaCima(base_cents × |bp| ÷ 10 000)`, **no módulo**, e depois aplica o sinal (meia afasta do zero; igual à RN-VEN-02, que arredonda "meia para cima" em centavos positivos). Multiplicação inteira (base ≤ ~10^9 centavos × 9 999 cabe em 2^53).

Exemplos (percentual −1,71 → `bp` = −171):
- total dos itens R$ 1.000,00 (100 000): 100 000 × 171 ÷ 10 000 = 1 710 → **− R$ 17,10** → Valor final R$ 982,90 (98 290).
- total dos itens R$ 123,45 (12 345): 12 345 × 171 ÷ 10 000 = 211,0995 → 211 → **− R$ 2,11** → R$ 121,34.
- total R$ 29,00 (2 900): 2 900 × 171 ÷ 10 000 = 49,59 → 50 → **− R$ 0,50** → R$ 28,50.
- meia exata, 0,50% sobre R$ 11,00 (1 100 × 50 ÷ 10 000 = 5,5): desconto → −6 centavos; acréscimo → +6 centavos (meia afasta do zero).

**Justificativa:** `numeric(5,2)` casa com o que o ERP guarda e com o resto do banco; inteiro em `bp` no domain mantém a conta exata e testável (centavos, regra 4).
**Alternativa descartada:** guardar centésimos inteiros no banco (`integer`, −9999..9999): exato, mas destoa dos demais percentuais e obriga conversão em toda consulta/CSV; `float`: arredonda mal (ex.: 0,285 vs 0,28499…).

## 5. Volta ao ERP na devolução do pedido?
**Decisão: sim**, aditivo no bloco `pagamento` do `PedidoParaErp` (`pedido.ts`, `PagamentoErp`): `percentual_ajuste` (decimal, 2 casas, negativo = desconto) **e** `ajuste_cents` (inteiro com sinal, em centavos; negativo = desconto), mais as linhas `itens[].total_cents` **já com o ajuste rateado** e o `total_cents` final. No Conector, colunas novas na staging do pedido: `pagamento_percentual_ajuste` (DECIMAL(5,2)) e `pagamento_ajuste_cents` (BIGINT). O **retorno do ERP** (`retorno_erp`) **não** traz o percentual: o pedido guarda o retrato do que foi enviado.
**Justificativa:** o ERP precisa conferir o total sem refazer a conta; o valor em centavos evita divergência de arredondamento entre os dois lados, e o percentual permite auditar. `desconto_total_cents`/`acrescimo_total_cents`/`desconto_pct`/`acrescimo_pct` existentes **não** incluem o prazo (só o ajuste do pedido), para o ERP não contar duas vezes.
**Risco:** o ERP da thathyany já aplica "% Acres.Fin." ao lançar uma condição. Se a procedure reaplicar, haverá **dupla aplicação**. A procedure deve gravar as linhas como vêm (já ajustadas) e **não** reaplicar o percentual (pergunta 1 da seção 11).
**Alternativa descartada:** mandar só o percentual e deixar o ERP calcular (o total do ERP divergiria do PDF entregue ao cliente por arredondamento); mandar só os centavos (perde a rastreabilidade).

## 6. Pedido offline quando o percentual muda
**Decisão: congela no pedido, com revalidação tolerante no envio.**
- Ao escolher o prazo (ou ao salvar), o app grava o **retrato** no pedido: `prazo_percentual_ajuste` e `prazo_ajuste_cents` (junto do retrato de forma/prazo da 0037, "os 8 vêm juntos", l. 22-26). O total do PDF e do pedido não muda depois, mesmo com pull novo (coerente com "pedido corrigido ou editado não reprecifica", l. 249).
- **Orçamento:** o percentual congela junto com o preço (RN-VEN-18); no "Transformar em pedido" dentro do prazo do preço mantém; fora dele **reprecifica com o percentual vigente** do prazo, mostrando a diferença por item/total, como já faz com os preços.
- **API revalida** (regra 2): (a) faixa e 2 casas; (b) o prazo existe, está ativo, é da forma e o cliente o aceita (já existe, `api/pagamento.ts`); (c) **recalcula** o ajuste pelo percentual do push e confere o total; (d) compara o percentual do push com o vigente do prazo: **igual** → aceita; **diferente** e o cadastro do prazo foi alterado **depois** do `criado_em` do pedido → aceita (o pedido nasceu offline antes da mudança) e grava aviso na linha do tempo ("Prazo 28/56 com −1,71%; cadastro hoje −2,00%"); **diferente** e o cadastro não mudou depois → **recusa** 422 com a frase em português (RN-VEN-40): "O desconto do prazo não confere com o cadastro. Atualize o app e refaça o pedido." (nunca aceita percentual que o cadastro não tenha tido, para o aparelho não "inventar" desconto).
**Justificativa:** o cliente já recebeu o PDF com um valor; mudar o total no servidor sem o vendedor ver seria pior que honrar o valor congelado. A checagem pela data do cadastro impede abuso sem recusar o pedido legítimo feito offline.
**Alternativa descartada:** o servidor sempre usar o percentual vigente (muda o total depois do PDF); o servidor sempre recusar divergência (derruba pedido legítimo de quem passou o dia offline).

## 7. Nomes, versão e default
| Onde | Nome |
|---|---|
| Contrato do Hub, prazo (`entidades.ts`) | `prazo_pagamento.percentual_ajuste` (decimal, `nullish`) |
| Contrato do Hub, pedido (`pedido.ts`, `PagamentoErp`) | `pagamento.percentual_ajuste` e `pagamento.ajuste_cents` (opcionais) |
| Contrato do Vendedor (BKO, pull) | `percentual_ajuste` em `PrazoPagamento`, `SalvarPrazoRequest`, `PrazoPagamentoSyncSchema`; `prazo_percentual_ajuste` e `prazo_ajuste_cents` no pedido |
| Banco | `vendedor.prazo_pagamento.percentual_ajuste numeric(5,2) not null default 0` |
| Kit/ERP (thathyany) | coluna de origem **"% Acres.Fin."**; no kit, `tha_prazo_pagamento.percentual_ajuste DECIMAL(5,2) NULL` e a mesma coluna na view `vw_macuxi_prazo_pagamento` e em `db/conector/views-modelo.sql` |
| CSV do Hub (`modelos-csv.ts`) | `prazo_pagamento.percentual_ajuste` ("Desc./Acrésc. (%)"); exemplo `-1,71` e `0`; descrição: "Negativo = desconto, positivo = acréscimo. Vazio = 0 na criação e não altera na atualização." |
| Staging do pedido no ERP | `pagamento_percentual_ajuste`, `pagamento_ajuste_cents` |

- **Versão:** **mesma `v1`** (campo novo opcional é compatível, RN-INT-09; sem ADR). Convém **Conector 1.5.0** (sobe a versão **recomendada**, não a mínima): o 1.4.x ignora o campo e continuaria enviando o pedido sem o ajuste, e o ERP cobraria diferente do PDF; o Hub sinaliza o Conector antigo (RN-INT-11) quando o prazo do pedido tiver percentual ≠ 0.
- **Default ausente = 0** (no Hub, na carga, no pull, no pedido antigo e no APK anterior).
- **Atenção:** `PrazoPagamentoSyncSchema` é `.strict()`; um app antigo que valide estritamente quebraria ao receber o campo novo. O pull só pode levar o campo depois de a versão do app que o conhece estar no ar, ou o schema passar a `.passthrough()` por decisão do `engenheiro-software` (pergunta 6).
- **Alternativa descartada:** nome `acrescimo_financeiro_pct` (não diz que é assinado) e `desconto_pct` negativo (o nome `desconto_pct` já existe no pedido com outro sentido, `>= 0`); subir `/v2` (não há quebra).

## 8. RN novas propostas
Numeração a partir do maior existente (RN-VEN-42, RN-INT-14, RN-CORE-49). Emendas, sem número novo: **RN-VEN-02** (acrescentar "Valor final = total dos itens ± ajuste do prazo (RN-VEN-43)", trocando o resto "ajuste financeiro da condição"), **RN-VEN-03/10/11** ("o ajuste do prazo não entra") e **RN-VEN-24** (o prazo tem o percentual).
- **RN-VEN-43 Desc./Acrésc. (%) do prazo.** Cada prazo tem o campo "Desc./Acrésc. (%)", de −99,99 a +99,99 com 2 casas (negativo = desconto; vazio = 0). Incide sobre o total dos itens, depois dos ajustes de item e de pedido, e é rateado nas linhas pelo maior resto. Arredondamento em centavos, meia para cima no módulo, depois o sinal. Não entra no desconto efetivo (RN-VEN-03), na alçada (RN-VEN-10), no preço mínimo (RN-VEN-11) nem nos limites de desconto; entra no crédito (RN-VEN-12). O orçamento também mostra e congela o ajuste. Pedido em nome usa a mesma conta.
- **RN-VEN-44 Totais do prazo.** Linha própria só quando o percentual ≠ 0: `Desconto do prazo (1,71%)` / `Acréscimo do prazo (2,50%)`, com valor `− R$ …` / `+ R$ …`, entre os ajustes do pedido e o "Valor final", igual no Resumo, no detalhe (app e BKO) e nos PDFs; "Valor de tabela / Desconto / Acréscimo" ignoram o prazo. Na lista de prazos, o percentual aparece à direita só quando ≠ 0.
- **RN-VEN-45 Percentual congelado.** O pedido e o orçamento guardam o percentual e o valor do ajuste do momento da escolha; a API recalcula e aceita o percentual do push se for o vigente ou se o cadastro do prazo mudou depois do `criado_em` do pedido (aviso na linha do tempo); caso contrário recusa com frase em português (RN-VEN-40). Transformar orçamento fora do prazo do preço reprecifica com o percentual vigente.
- **RN-VEN-46 Prazo no BKO.** O formulário e a lista de prazos (Parâmetros → Formas de pagamento e prazos) têm a coluna/campo "Desc./Acrésc. (%)" (formato `−1,71%`, `+2,50%`, `0,00%`), no CSV e na auditoria (RN-AUD-01: alteração de percentual guarda antes/depois). Só quem tem `forma_pagamento.gerenciar` edita (a API revalida).
- **RN-INT-15 Percentual do prazo no Hub.** `prazo_pagamento.percentual_ajuste` (carga/delta/CSV) e `pagamento.percentual_ajuste` + `pagamento.ajuste_cents` (pedido ao ERP) são opcionais e aditivos no `v1`; ausente = 0; fora da faixa ou com mais de 2 casas = erro de linha na carga; o ERP grava as linhas do pedido como vieram e **não reaplica** o percentual.
- **RN-CORE:** nenhuma (o prazo não é do Core).

## 9. Agentes e caminhos afetados (fase de implementação)
| Agente | Caminhos | O que muda |
|---|---|---|
| `modulo-vendedor` | `modules/vendedor/{domain,contracts,api,app,web}`, `docs/modulos/vendedor/` | `ajusteDoPrazo` e `totaisDoPedido` (domain, testes `RN-VEN-43`), `linhasDosTotais`, validação na API (`api/pagamento.ts`, `receber.ts`), consumidor do Hub, pull, telas do Resumo/detalhe, PDF, BKO (form, lista, CSV) |
| `modulo-integracao` | `modules/integracao/{contracts,domain,api,kit-thathyany,kit-piloto,docs}` | `PrazoPagamentoPayload`, `PagamentoErp`, `modelos-csv.ts`, exemplos, kit SQL (tabela, view, staging, procedure) |
| `engenheiro-software` | `apps/conector`, ADR/versão, CI | Conector 1.5.0 (mapeia as colunas novas, `apps/conector/src/pedidos.ts`, exemplos JSON), política de versão, `.strict()` do pull |
| `banco-dados` | `modules/vendedor/db`, `db/migrations`, `db/conector` | migração aditiva (prazo: `percentual_ajuste`; pedido: `prazo_percentual_ajuste`, `prazo_ajuste_cents`, check de coerência junto do retrato), view-modelo do Conector, auditoria |
| `designer-ux` | `packages/ui`, `docs/design/` | linha do total, chip na lista de prazos, campo/coluna no BKO, textos |
| `engenheiro-apps` | shells | só a revisão técnica e a compatibilidade com o APK anterior (a tela é do módulo) |
| `modulo-gestor` | `modules/gestor` | coluna separada do ajuste do prazo nos relatórios de desconto (aviso, sem mudar contrato) |
| `testes`, `corretor-redundancias`, `design-de-marca` | — | roteiro do build, parecer da linha de total, validação visual |
| `gerente-projetos` | `docs/produto/03-*.md` | incorporar as RN acima ao doc 03 depois da aprovação |

## 10. Riscos
1. **Dupla aplicação no ERP** (procedure reaplicar "% Acres.Fin."): maior risco financeiro; exige o aceite do ERP da thathyany.
2. **Conector antigo** ignora o campo: total do ERP ≠ PDF. Mitigação: versão recomendada e sinal do Hub (seção 7).
3. **Pull estrito** quebra o app antigo (seção 7).
4. **Prazo que muda no ERP** com pedido offline: tratado em 6, com o aviso na linha do tempo.
5. **Centavos de rateio**: o maior resto mantém a soma das linhas igual ao total; teste de propriedade obrigatório.
6. **Relatórios do Gestor/Promotor** que somam descontos precisam distinguir o prazo.

## 11. Perguntas em aberto para o Alexandre
1. O ERP (procedure do Conector da thathyany) aceita gravar as linhas **já ajustadas** e **não** reaplicar o "% Acres.Fin."? Ou prefere mandar o **preço base + percentual** e deixar o ERP calcular?
2. Confirma que o ajuste do prazo **não conta na alçada** (nem no máximo de desconto), mas **conta no crédito**?
3. O ERP é a fonte do percentual (o BKO só consulta) ou o BKO também edita, e a carga do ERP sobrescreve? (Hoje o prazo é editável nos dois, `SalvarPrazoRequest`.)
4. Aprova a linha **única** `Desconto do prazo (1,71%)` (só quando ≠ 0) e o percentual na lista de prazos do app?
5. Pedido offline: aprova "congela + aceita se o cadastro mudou depois do pedido; senão recusa" (seção 6)?
6. Pode subir o **Conector 1.5.0** como versão recomendada e adiar o campo no pull até o app novo estar no ar (ou liberar o schema do pull)? Isso cabe na v1.0.13?
7. Orçamento já salvo com prazo sem percentual: continua com 0 (congelado) até ser transformado; confirma?

## 12. Pendências e observações
- **Recados não enviados:** o repositório `aloirr/macuxifdv-recados` está inacessível nesta sessão (HTTP 403). Os pedidos aos donos (`modulo-integracao`, `banco-dados`, `engenheiro-software`, `designer-ux`) e o aviso ao `gerente-projetos` ficam **pendentes** para quando houver acesso; esta página é o conteúdo deles.
- Sem Conector/banco local nesta etapa: nada foi executado nem testado (só leitura).
- Depois da aprovação: tarefa nova (T-nnnn), testes antes do código (RN-VEN-43/44/45), `typecheck:tests`, parecer do corretor e do design-de-marca antes do build.

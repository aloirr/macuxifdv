# Curvas ABC do cliente (RN-CORE-49)

Pedido do dono do produto (14/11/2026): a curva deve dizer de quê é (faturamento, volume, frequência) e usar percentuais padrão.

## Regra
Compara o **mês atual** com a **média dos 3 meses anteriores**, por dimensão:

| Dimensão | Campo do histórico (`historico_compra`) | Rótulo na tag |
|---|---|---|
| Faturamento | `valor_cents` | Faturamento A/B/C |
| Volume | `itens` | Volume A/B/C |
| Frequência | `pedidos` | Frequência A/B/C |

variação % = (mês atual − média) ÷ média × 100. Curva **A**: variação ≥ `a_min_pct`; **C**: variação < `c_abaixo_pct`; senão **B**.
Padrão: `a_min_pct = 20` e `c_abaixo_pct = 0`. Decisão do dono do produto (14/11/2026, 6h16), texto literal: "Curva A entre 20% ou mais acima da media. Curva B: abaixo de 20% até a média. Curva C abaixo da media."
Ou seja: **A** com variação ≥ +20%; **B** de 0% (inclusive, na média) até abaixo de +20%; **C** abaixo de 0%. As mesmas faixas valem para faturamento, volume e frequência e seguem como parâmetros do tenant.

- Soma das linhas do mesmo mês (ERP + Macuxi); mês sem linha vale 0; a virada de ano usa dezembro, novembro e outubro anteriores.
- Sem nenhuma linha em ou antes do 3º mês anterior: sem curva ("sem histórico de 3 meses").
- Média zero numa dimensão: sem a curva dela.
- Sem `pedidos_visiveis` (RN-PRO-01): sem curvas.

## Parâmetros do tenant (`parametro`, módulo `core`)
`cliente.curva_abc.a_min_pct` e `cliente.curva_abc.c_abaixo_pct`. Ausente, apagada, não numérica ou fora de −100..1000: padrão da chave. Se `a_min_pct ≤ c_abaixo_pct`, os dois voltam ao padrão.
Código: `modules/core/domain/curvas-abc.ts` (`curvaPelaVariacao`, `curvasAbcDoCliente`, `faixasCurvaAbcDasLinhas`, `totalDoMes`); app: `usar-clientes-locais.ts` (`faixasCurva`) e `telas/cliente.tsx`.

## Premissas
- Volume = `itens` do histórico; frequência = `pedidos`.
- O mês atual é parcial: no começo do mês a tendência é C.
- Edição das faixas no BKO não faz parte desta entrega (só leitura do parâmetro).

## Ficha do cliente (14/11)
Abas: Resumo · Cadastro (rótulo curto de "Dados cadastrais", que não cabe em 5 abas de 360 dp) · Financeiro · Compras · Anexos. Rodapé (check-in e ação de destaque) em todas as abas; alertas no topo do conteúdo em todas.
Saíram: tag Positivado, tag "Curva X", segmento como tag (virou dado em Cadastro), lista de títulos, "Compras dos últimos 12 meses" e "Últimos pedidos" (viraram "Histórico de Pedidos", em Compras).

# Curvas ABC do cliente (RN-CORE-49)

Pedido do dono do produto (14/11/2026): a curva deve dizer de quê é (faturamento, volume, frequência) e usar percentuais padrão.

## Regra
Compara o **mês atual** com a **média dos 3 meses anteriores**, por dimensão:

| Dimensão | Campo do histórico (`historico_compra`) | Rótulo na tag |
|---|---|---|
| Faturamento | `valor_cents` | Faturamento A/B/C |
| Volume | `itens` | Volume A/B/C |
| Frequência | `pedidos` | Frequência A/B/C |

variação % = (mês atual − média) ÷ média × 100. Curva **A**: variação ≥ `a_min_pct`; **B**: variação ≥ `b_min_pct`; senão **C**.
Padrão de cada dimensão: `{ a_min_pct: 20, b_min_pct: 0 }`. Decisão do dono do produto (14/11/2026, 6h16), texto literal: "Curva A entre 20% ou mais acima da media. Curva B: abaixo de 20% até a média. Curva C abaixo da media."
Ou seja: **A** com variação ≥ +20%; **B** de 0% (inclusive, na média) até abaixo de +20%; **C** abaixo de 0%. Cada dimensão tem a própria faixa, configurável no BKO (decisão do dono do produto, 14/11/2026, 6h18, literal: "As faixas de curva de volume, faturamento e frequência devem ser configurações no BKO").

- Soma das linhas do mesmo mês (ERP + Macuxi); mês sem linha vale 0; a virada de ano usa dezembro, novembro e outubro anteriores.
- Sem nenhuma linha em ou antes do 3º mês anterior: sem curva ("sem histórico de 3 meses").
- Média zero numa dimensão: sem a curva dela.
- Sem `pedidos_visiveis` (RN-PRO-01): sem curvas.

## Parâmetros do tenant (`parametro`, módulo `core`)
Uma chave por dimensão, valor `{ a_min_pct, b_min_pct }` (número, −100..1000, `a_min_pct > b_min_pct`):
`cliente.curva_abc.faturamento`, `cliente.curva_abc.volume`, `cliente.curva_abc.frequencia`. Cada dimensão ausente, apagada ou inválida cai no padrão sozinha. Sem tabela nova; o pull `parametro` já leva as linhas ao aparelho.
- **API**: `GET|PUT /v1/core/parametros/curvas-abc`, ação `parametro.curva_abc` (analista e admin; licença do módulo `core`), corpo `{ faturamento, volume, frequencia }`, 422 `RN-CORE-49` com `erros[{campo: '<dimensao>.<a_min_pct|b_min_pct>', mensagem}]`, escrita idempotente e auditada (antes/depois). Código: `api/parametros-curvas-abc.ts`.
- **BKO**: painel "Curvas ABC do cliente" (`web/components/farol/curvas-abc-parametros-panel.tsx`), montado na página Farol de clientes (Clientes), abaixo dos parâmetros do farol; some sem a ação `parametro.curva_abc`. Três linhas (Faturamento, Volume, Frequência) com "Curva A a partir de (%)", "Curva B a partir de (%)" e "C abaixo disso".
- **Contrato**: `contracts/curvas-abc.ts` (`FaixaCurvaAbcSchema`, `ParametrosCurvaAbcSchema`).
- **Domínio/app**: `domain/curvas-abc.ts` (`curvaPelaVariacao`, `curvasAbcDoCliente`, `faixasCurvaAbcDasLinhas`, `validarParametrosCurvaAbc`, `totalDoMes`); app: `usar-clientes-locais.ts` (`faixasCurva`, por dimensão) e `telas/cliente.tsx`.
- **Banco**: sem migração nem seed (usa `plataforma.parametro` existente).

## Premissas
- Volume = `itens` do histórico; frequência = `pedidos`.
- O mês atual é parcial: no começo do mês a tendência é C.

## Ficha do cliente (14/11)
Abas: Resumo · Cadastro (rótulo curto de "Dados cadastrais", que não cabe em 5 abas de 360 dp) · Financeiro · Compras · Anexos. Rodapé (check-in e ação de destaque) em todas as abas; alertas no topo do conteúdo em todas.
Saíram: tag Positivado, tag "Curva X", segmento como tag (virou dado em Cadastro), lista de títulos, "Compras dos últimos 12 meses" e "Últimos pedidos" (viraram "Histórico de Pedidos", em Compras).

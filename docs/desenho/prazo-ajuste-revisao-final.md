# Revisão final — % do prazo (v1.0.13)

Revisor: `engenheiro-software`, 15/11/2026, ~13h40 (Manaus). Recados inacessíveis: este parecer substitui os recados aos donos.
Base: proposta 454ee68, desenho 7a8e57d. Branches: banco-dados 0ffa290; modulo-vendedor adb7a34, ae1605b e 03b1ec3 (diff contra o origin/main); modulo-integracao ed2f4cf (o Conector 1.5.0 ainda não está no branch e não foi revisto).
Testes do vendedor rodados na sessão (5 arquivos, 62 testes, verdes). Não há teste de banco do INSERT com o retrato novo: o 🔴 abaixo só apareceria no CI de stack ou em produção.

## modulo-vendedor (`nuvem/prazo-ajuste-codigo-modulo-vendedor`)
- 🔴 `modules/vendedor/api/pagamento.ts:70` e `:127`, com `receber.ts:376` e `orcamentos.ts:129`: sem forma e prazo (condição legada, RN-VEN-14), o retrato grava `prazo_percentual_ajuste = 0` com `prazo_pagamento_id` nulo. Isso viola o CHECK `pedido_prazo_percentual_com_prazo` da 0075 (23514), e o pedido ou o orçamento sem prazo deixa de entrar. **Correção:** `valorPercentualPrazo(pagamento, pct)` devolve `null` quando `pagamento` é nulo. Incluir um teste da regra e um `*.db.test.ts` do INSERT sem prazo.
- 🟡 `pagamento.ts:97` e `domain/pagamento.ts:129`: o código do 422 é `prazo_percentual_mudou`, fora do padrão de código de RN. **Correção:** `RN-VEN-45`, mantendo a mensagem.
- 🟡 `domain/pagamento.ts:135` e `pagamento.ts:104`: o percentual do push divergente é aceito só porque o `created_offline_at`, informado pelo aparelho, é anterior à mudança do cadastro. Assim, um push alterado pode mandar −99,99 sem alçada, e o `aviso_percentual` não chega à linha do tempo (RN-VEN-45). **Correção:** quando o push diverge do vigente e é aceito, gravar o aviso no histórico e mandar o pedido para aprovação (RN-VEN-10). No mínimo, gravar o aviso.
- 🟡 `contracts/index.ts:291`: `PedidoPush.prazo_percentual_ajuste` não confere as 2 casas. Com −1,715 o cálculo usa −171 bp, e o banco arredonda o retrato para −1,72. **Correção:** usar o `PercentualAjusteSchema` sem o `.default`, ou seja, `.optional()`.
- 🟡 `api/aprovado-erp.ts:94-101`: o `pagamento.percentual_ajuste` informativo não vai ao ERP, então o Conector 1.5.0 sempre recebe NULL. É aceitável na v1.0.13 enquanto a pergunta 1 (dupla aplicação) estiver aberta, mas a pendência tem de ficar declarada. Senão, enviar `Number(p.prazo_percentual_ajuste)` quando houver.
- 🟢 `contracts/prazo-ajuste.ts`: funções puras em `contracts` são **aceitáveis**. O dependency-cruiser permite `contracts → domain` do próprio módulo, e o Core e o Promotor já expõem funções puras por `contracts`. Há uma fonte só, e o Catálogo não importa o `domain`. Manter sem I/O.
- 🟢 `::float8` (`pagamento.ts:39`, `sync.ts:225`, `formas-pagamento.ts:15`): é só transporte, no mesmo padrão dos centavos do `sync.ts`. O cálculo é inteiro (`percentualAjusteParaBp` com `Math.round`, depois `aplicarPontosBase`), e o arredondamento é exato em ±99,99. Opcional: devolver `(percentual_ajuste*100)::int` e nada de float.
- 🟢 `contracts/sync.ts:181`: o `Number.isInteger(Math.round(...))` é sempre verdadeiro e pode sair. Depois do merge da integração, trocar `percentualDoRegistro` (`formas-erp.ts`) por `r.data.percentual_ajuste ?? 0`.
- 🟢 `app/lib/documento.ts:279`: o ajuste é aplicado antes da faixa escalonada, mas o `precoDoItem` ajusta a base já com a faixa. A comparação do orçamento com faixa pode divergir.
- OK: `.strict()` mantido, com o campo explícito (desenho §4). Idempotência inalterada (`on conflict (id) do nothing`; o consumidor faz `update`). Nenhum dado pessoal ou segredo em log. Os testes citam RN-VEN-43 a 46.

## banco-dados (`nuvem/prazo-ajuste-banco-dados`)
- 🟡 `db/conector/views-modelo.sql:179`: `percentual_ajuste {decimal}` não existe no Conector. **Correção:** `{numero}` (desenho §1).
- 🟢 `db/testes/estatico.test.ts`: `nomes[74]` ficou fora da ordem das linhas vizinhas (cosmético).
- OK: a 0075 é aditiva, sem backfill nem reescrita, com CHECKs de faixa e uma volta idempotente. O RLS e os grants são herdados, e o Drizzle está coerente.

## modulo-integracao (`nuvem/prazo-ajuste-modulo-integracao`)
- 🟢 `domain/pagamento.ts:28`: `percentualAjusteDoPrazo` só é usado no teste. Usar ou remover.
- OK: o campo é opcional e `nullish` no v1 (RN-INT-09), e o `PercentualAjuste` confere a faixa e as 2 casas (RN-INT-15). O OpenAPI, o CSV e o kit estão atualizados.
- Pendente: revisar o commit do Conector 1.5.0 quando ele chegar ao branch.

## Ordem de merge e de ativação
1. banco-dados (0075). 2. modulo-integracao (contrato). 3. modulo-vendedor, só depois do 🔴 corrigido e com o CI rodado sobre o main que já tem a 0075. 4. Conector 1.5.0. 5. `nuvem/prazo-ajuste-engenheiro-software`.
- Se o vendedor entrar antes do banco, a API vai ao ar lendo `percentual_ajuste` sem a coluna (42703), e o pull de prazos e o push de todo pedido com prazo caem. No deploy, a 0075 precisa estar aplicada antes da API.
- **422 para o app antigo:** um APK anterior ao v1.0.13 não manda o percentual. Quando o ERP passar a mandar um % diferente de 0, todo pedido novo desse APK com aquele prazo é recusado com "Atualize o app e refaça o pedido." Por isso a coluna da `vw_macuxi_prazo_pagamento`, hoje comentada, só deve ser ligada no ERP depois que os vendedores estiverem com o v1.0.13.

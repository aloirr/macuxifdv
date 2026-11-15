# Revisão final — % do prazo (v1.0.13)

Revisor: `engenheiro-software`, 15/11/2026, ~13h40 (Manaus). Recados inacessíveis: este parecer substitui os recados aos donos.
Base: proposta 454ee68, desenho 7a8e57d. Branches: banco-dados 0ffa290; modulo-vendedor adb7a34, ae1605b e 03b1ec3 (diff contra o origin/main); modulo-integracao ed2f4cf (o Conector 1.5.0 ainda não está no branch e não foi revisto).
Testes do vendedor rodados na sessão (5 arquivos, 62 testes, verdes). Não há teste de banco do INSERT com o retrato novo: o 🔴 abaixo só apareceria no CI de stack ou em produção.

## modulo-vendedor (`nuvem/prazo-ajuste-codigo-modulo-vendedor`)
- 🔴 `modules/vendedor/api/pagamento.ts:70` e `:127`, com `receber.ts:376` e `orcamentos.ts:129`: sem forma e prazo (condição legada, RN-VEN-14), o retrato grava `prazo_percentual_ajuste = 0` com `prazo_pagamento_id` nulo. Isso viola o CHECK `pedido_prazo_percentual_com_prazo` da 0081 (23514), e o pedido ou o orçamento sem prazo deixa de entrar. **Correção:** `valorPercentualPrazo(pagamento, pct)` devolve `null` quando `pagamento` é nulo. Incluir um teste da regra e um `*.db.test.ts` do INSERT sem prazo.
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
- OK: a 0081 é aditiva, sem backfill nem reescrita, com CHECKs de faixa e uma volta idempotente. O RLS e os grants são herdados, e o Drizzle está coerente.

## modulo-integracao (`nuvem/prazo-ajuste-modulo-integracao`)
- 🟢 `domain/pagamento.ts:28`: `percentualAjusteDoPrazo` só é usado no teste. Usar ou remover.
- OK: o campo é opcional e `nullish` no v1 (RN-INT-09), e o `PercentualAjuste` confere a faixa e as 2 casas (RN-INT-15). O OpenAPI, o CSV e o kit estão atualizados.
- Pendente: revisar o commit do Conector 1.5.0 quando ele chegar ao branch.

## Ordem de merge e de ativação
Substituída pela ordem final, no fim deste parecer: banco-dados → engenheiro-software → modulo-vendedor → modulo-integracao → testes.
- Se o vendedor entrar antes do banco, a API vai ao ar lendo `percentual_ajuste` sem a coluna (42703), e o pull de prazos e o push de todo pedido com prazo caem. No deploy, a 0081 precisa estar aplicada antes da API.
- **422 para o app antigo:** um APK anterior ao v1.0.13 não manda o percentual. Quando o ERP passar a mandar um % diferente de 0, todo pedido novo desse APK com aquele prazo é recusado com "Atualize o app e refaça o pedido." Por isso a coluna da `vw_macuxi_prazo_pagamento`, hoje comentada, só deve ser ligada no ERP depois que os vendedores estiverem com o v1.0.13.

---

# Segunda revisão final (15/11/2026, ~15h00 em Manaus)

Base: vendedor a581f7b, ec4d2c4 e 6588e66; banco-dados 0e40dc2; integração 8dcf0ff e 9752561; testes 006cdc0. Juntei os cinco branches sobre o origin/main 007289e com `git merge-tree`, na ordem abaixo, e não houve conflito. Nessa árvore, typecheck do vendedor, da integração, do Conector e do `tests/` limpos. Rodei 131 arquivos de teste (vendedor domain/contracts/app/api, Conector, integração, kits e o ensaio): 2 falham, os dois descritos abaixo. Os `*.db.test.ts` ficam para o CI, porque aqui não há Postgres.

## modulo-vendedor (6588e66): sem 🔴
- Corrigido: o 🔴 do `null` sem prazo. `valorPercentualPrazo(pagamento, pct)` está em `api/pagamento.ts:127`, com `receber.ts:381`, `orcamentos.ts:129` e o `prazo-percentual.db.test.ts`, que cobre os casos sem prazo e com prazo.
- Corrigidos: o 🟡 do código `RN-VEN-45`; o 🟡 das 2 casas no push (`PercentualAjusteBase.optional()`); o 🟡 da pendência declarada em `aprovado-erp.ts:102`; e o 🟢 da ordem faixa → % em `app/lib/documento.ts:279` (6588e66), igual a `domain/aprovacao.ts:366`, com teste.
- Corrigido: o 🟡 do push divergente. Agora ele vai para a alçada (`domain/aprovacao.ts:130`, `comPercentualDoPrazoMudou`), com testes em `revalidar-ajuste-valor.test.ts:102-109`.
- 🟡 Motivo `credito`: **aceitável na v1.0.13, como pendência do próximo lote.** Não é 🔴, porque a segurança está garantida: o pedido não passa sem a alçada, a fila e o RLS seguem iguais e o título vencido já usa o mesmo caminho. Mesmo assim, o aprovador do Gestão vê "Crédito do cliente" ou "Crédito disponível R$ …" (`modules/gestor/app/lib/apresentacao.ts:22` e `:35`), e o `pending_reason` não aparece na fila. Ele aprova sem ver o motivo real. **Correção no próximo lote:** banco-dados cria uma migração nova com o motivo `prazo_percentual` no CHECK da 0009; o vendedor inclui o motivo em `MOTIVOS_APROVACAO` (`domain/aprovacao.ts:20`); o Gestão cria o rótulo "Percentual do prazo mudou". O caso é raro: o ERP precisa mudar o % entre o pedido e a sincronização.

## banco-dados (0e40dc2): sem achados
- Corrigido: o 🟡 do `{numero}` em `views-modelo.sql:179`. A coluna segue comentada (`:204`) até os vendedores estarem na v1.0.13.

## modulo-integracao (8dcf0ff e 9752561): 1 🔴
- 🔴 `modules/integracao/kit-thathyany/sql/criar-banco.sql`, entre as linhas 545 e 560: o kit foi gerado sem o `@pagamento_percentual_ajuste` na `sp_macuxi_pedido_inserir`, mas o `kit-thathyany/conector/conector.json` (o EXEC do cabeçalho) já passa esse parâmetro. No kit, toda gravação de pedido falha com "too many arguments". Depois do merge do banco-dados, o teste de deriva `kit-thathyany.test.ts:30` falha (falhou aqui, na árvore juntada). **Correção:** trazer o banco-dados (ou o main depois do merge dele), rodar `scripts/gerar.ts` e fazer um commit novo com o `criar-banco.sql` regenerado.
- OK, Conector 1.5.0: o `SELECT *` só no prazo deixa a coluna opcional, e a ausência ou o NULL não mandam a chave (`test/prazo-ajuste.test.ts`). `pagamento_percentual_ajuste` é só informativo, sem recalcular nada (`src/pedidos.ts:158`). Config antiga do cliente segue igual, e o SP modelo do banco-dados tem o parâmetro com `= NULL`.
- OK, gerador do kit: `colunasDaView` (`scripts/gerar.ts:284`) expande o `*` para os campos do contrato, menos os `so_kit`. O `kit-piloto.test.ts:131` ignora o `*`.
- OK, teste "1.4.0 ou mais nova" (`test/filial-pedido.test.ts:38`) com `compararVersoes`.
- 🟢 `test/prazo-ajuste.test.ts:86`: `toBe('1.5.0')` vai quebrar no 1.5.1. Usar `compararVersoes(...) >= 0`, como no filial.

## testes (006cdc0): 1 🔴
- 🔴 `tests/modulos/prazo-ajuste-valor-regra.test.ts:127-128`: o teste ainda espera o código `prazo_percentual_mudou` e o texto antigo, e falha contra o vendedor ec4d2c4. **Correção:** `codigo: 'RN-VEN-45'` e `'Este prazo de pagamento mudou. Atualize o app e refaça o pedido.'`.
- 🟡 `:125`: o ensaio não confere a regra nova. **Correção:** conferir `mudou_depois: true` e que `revalidarPedido({ ...entrada(-171), percentual_mudou: true })` dá `pending_approval` com o `pending_reason` "Percentual do prazo mudou".
- Dependência: o arquivo importa `PercentualAjuste`/`PrazoPagamentoPayload` da integração e `PercentualAjusteBase`/`revalidarPercentualDoPrazo` do vendedor. Por isso entra depois dos dois.

## Ordem final de merge
1. banco-dados: 0081 e modelos do Conector.
2. engenheiro-software (este parecer e o desenho do Conector 1.5.0).
3. modulo-vendedor (6588e66). O CI precisa rodar sobre o main que já tem a 0081.
4. modulo-integracao, depois do commit com o kit regenerado sobre o banco-dados (Conector 1.5.0).
5. testes, depois do commit com as linhas 127-128 corrigidas.
No deploy, a 0081 é aplicada antes da API. A coluna `percentual_ajuste` da view do ERP só é ligada com os vendedores na v1.0.13.

## Atualização (15/11/2026, ~15h em Manaus): migração 0081 e ordem nova
- A migração do prazo passou de 0075 para 0081. As citações acima foram atualizadas, e a ordem de merge da primeira revisão fica substituída pela ordem final acima.
- O main de hoje vai até a 0080, e a 0081 é a próxima.
- O `conector-publicar.yml` publica o 1.5.0 digitando `1.5.0` no input `versao`, depois do merge do PR da integração.

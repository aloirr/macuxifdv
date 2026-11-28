# ADR 0077 — ST e IPI vindos do ERP, sem cálculo de imposto no FDV

- **Status**: proposta.
- **Data**: 2026-11-28 (Manaus)
- **Versão**: v1.0.44 (sessão S24, tarefa T-0208).
- **Autor**: engenheiro-software
- **Origem**: decisão 63 A do dono do produto (R-20261127-235610-alexandre): o FDV não calcula imposto, só recebe e mostra o
  ST e o IPI do ERP. Contrato do ERP em R-20261128-000409 e R-20261128-000536 (T-0132 do ERP, v0.3.31, com as Regras fiscais da
  T-0127). Nomes no FDV em R-20261128-100133. Fecha o item 4 de R-20261124-032154.
- **Relacionadas**: ADR 0013 (Hub e Conector), ADR 0076 (alargamento na mesma versão, D5), RN-INT-08 (retorno do ERP), RN-INT-09
  (campo novo opcional continua `v1`), RN-VEN-02 (total da linha), T-0011 (retorno e `vendedor.pedido.faturado@1`).

## Contexto

O pedido do FDV leva hoje só o valor sem imposto (`total_cents` do item e do pedido, RN-VEN-02). Quem conhece a regra fiscal
(NCM, CFOP, UF, MVA, alíquotas) é o ERP. A T-0132 do ERP (v0.3.31) passa a devolver, por item e no total, os campos `v_icms_st`
e `v_ipi`, opcionais e aditivos, nos eventos do ERP `pedido.pedido.aprovado@1` e `pedido.pedido.faturado@1` (sem versão nova), no
status do pedido e na resposta ao Hub `/integracao/v1`, e no catálogo de entidades v2 do ERP.

No FDV o valor do ERP chega por um caminho só: o Conector lê o ERP e chama `POST /integracao/v1/pedidos/{uuid}/retorno`
(`RetornoErp`, `modules/integracao/contracts/pedido.ts`); o Hub publica `integracao.pedido.retorno_erp@1` e o Vendedor aplica.
Os eventos do FDV `vendedor.pedido.aprovado@1` (sai **antes** de o ERP ver o pedido) e `vendedor.pedido.faturado@1` (só
quantidades, "sem valores", `.coord/contratos/eventos.md`) não mudam.

## Decisão

### D1 — O FDV não calcula imposto (decisão 63 A)

- Nenhuma alíquota, base de cálculo, MVA, NCM fiscal nem fórmula de ST ou IPI entra no FDV (domain, API, app, PDF, Conector).
- O FDV **recebe, guarda e mostra** o que o ERP mandou, no item, no total do pedido e no PDF. Não soma itens, não rateia, não
  arredonda, não deriva um valor do outro.
- **O valor sem imposto continua como hoje**: `total_cents` do item e do pedido, descontos, acréscimos, rateio e todas as regras
  que usam o total (crédito, aprovação, metas, ranking, comissão) seguem com o valor sem imposto. Receber ST e IPI não muda
  nenhum desses números.
- ST e IPI aparecem em **linhas próprias** (item, totais do pedido e PDF). Não há "total com impostos" calculado no FDV: somar
  `total_cents + ST + IPI` seria derivar valor. Se o dono do produto quiser essa linha, ela vem pronta do ERP numa versão futura
  do contrato (premissa a confirmar na simulação, T-0208 critério 2).

### D2 — Nomes e tipo no FDV (R-20261128-100133)

| No ERP (T-0132, v0.3.31) | No FDV | Tipo |
|---|---|---|
| `v_icms_st` (item e total) | `v_icms_st_cents` | inteiro ≥ 0, em centavos, opcional e anulável |
| `v_ipi` (item e total) | `v_ipi_cents` | inteiro ≥ 0, em centavos, opcional e anulável |

O Conector faz o de-para. Se o ERP mandar reais com 2 casas, a conversão para centavos é feita em decimal exato (nunca em
`double`), como já é feita para `valor_cents`; valor com fração de centavo vem como erro do Conector, não é arredondado. O FDV só
aceita inteiro (Zod `int().nonnegative()`).

### D3 — A regra dos 3 casos (vale para o item e para o total, ST e IPI separados)

| O que chega | Significado | O FDV guarda | O FDV mostra |
|---|---|---|---|
| `0` | o ERP calculou e deu zero | `0` | `R$ 0,00` |
| campo ausente (ou `null`) | o ERP não tem regra fiscal para aquele item | `NULL` | "não informado" (**nunca** zero) |
| total ausente porque faltou regra em algum item | o total não é conhecido | `NULL` no total | total "não informado", **sem somar os itens** |

- Se o total vier e algum item vier ausente, o FDV mostra o total como veio (é do ERP) e o item como "não informado". Nada é
  conferido nem corrigido por soma.
- **Antes da resposta do ERP** (pedido offline, na fila, `pendente` ou `enviado`): o FDV mostra **"calculado pelo ERP"** no lugar
  dos valores. A troca para valor ou "não informado" acontece quando o pedido passa a `integrado`, `faturado_parcial` ou
  `faturado_total`. Pedido integrado antes desta versão, ou por um Conector/ERP sem a T-0132, mostra "não informado".
- A escolha entre os três textos é uma função pura do domain do Vendedor (D6), com teste citando a RN (D8).

### D4 — Contrato do Hub (`/integracao/v1`, aditivo, continua `v1`, RN-INT-09)

Dono: `modulo-integracao` (`modules/integracao/contracts/pedido.ts`). O engenheiro-software não altera esse arquivo; os nomes
abaixo são o contrato a implementar.

```ts
/** ADR 0077: impostos que o ERP calculou; o FDV só guarda e mostra (decisão 63 A). Ausente = "não informado". */
export const ImpostoErpCents = CentavosNaoNegativos.nullish();
export const ImpostoItemRetorno = z.object({
  sequencia: z.number().int().positive(),          // a do PedidoParaErp.itens
  v_icms_st_cents: ImpostoErpCents,
  v_ipi_cents: ImpostoErpCents,
});
export const ImpostosRetorno = z.object({
  v_icms_st_cents: ImpostoErpCents,                 // total do pedido; ausente quando faltar em algum item
  v_ipi_cents: ImpostoErpCents,
  itens: z.array(ImpostoItemRetorno),             // pode vir vazio: todos os itens "não informado"
});
// RetornoErpBase ganha: impostos: ImpostosRetorno.nullish()
```

- `impostos` é um **objeto**: a presença dele quer dizer "o ERP mandou a visão fiscal". Ausente = Conector ou ERP antigo: o Hub
  e o Vendedor **não apagam** o que já estava gravado. Presente = substitui por inteiro os valores do pedido e dos itens (o último
  retorno aceito com o bloco vence); item do pedido que não aparece em `itens` fica `NULL`.
- Vale só em `integrado`, `faturado_parcial` e `faturado_total`. Em outro status o Hub ignora o bloco sem erro (não derruba o
  retorno do Conector).
- Linha com `sequencia` inexistente ou repetida é descartada e vai ao monitor pelo mesmo caminho do P-4 (T-0031), com os códigos
  `sequencia_inexistente` e `sequencia_repetida`; o status do retorno vale.
- Sai também, igual, em `integracao.pedido.retorno_erp@1` como `impostos?` (alargamento aditivo na mesma versão; o único
  consumidor, o Vendedor, é tolerante). Registrado em `.coord/contratos/eventos.md`.
- `PedidoParaErp` (FDV → ERP) **não** ganha os campos: o FDV não manda imposto ao ERP.
- Conector: a versão que lê `v_icms_st` e `v_ipi` do ERP (status e resposta da T-0132) e preenche `impostos` é do
  `modulo-integracao` (`apps/conector`); não exige `exigeConector` novo, porque o campo é só de volta.

### D5 — Onde ficam guardados

**Servidor (migração 0112, banco-dados; 0110 e 0111 estão reservadas):**

| Tabela | Coluna | Tipo |
|---|---|---|
| `vendedor.pedido` | `v_icms_st_cents` | `bigint null`, check `>= 0` |
| `vendedor.pedido` | `v_ipi_cents` | `bigint null`, check `>= 0` |
| `vendedor.pedido_item` | `v_icms_st_cents` | `bigint null`, check `>= 0` |
| `vendedor.pedido_item` | `v_ipi_cents` | `bigint null`, check `>= 0` |

- Sem `default`: `NULL` é "não informado" e é o valor de toda linha existente; `0` só entra quando o ERP manda `0`.
- Nenhum gatilho, check ou função soma esses campos nem os relaciona com `total_cents` (o check de totais da 0007 não muda).
- Down: `drop column` das quatro (os valores voltam a vir no próximo retorno do ERP). Não toca `sa_*` nem o kit do Conector.
- Quem grava é o consumidor do Vendedor de `integracao.pedido.retorno_erp@1`, na mesma transação do status; o Hub não guarda
  cópia dos valores.

**Aparelho (SQLite):** o app guarda o pedido e o item do pull em `ent_pedido` e `ent_pedido_item` (coluna `dados`, JSON,
`packages/platform-sdk/src/sqlite/esquema.ts`). Não há migração no aparelho: as chaves entram no JSON.

- `PedidoSyncSchema` e `PedidoItemSyncSchema` (`modules/vendedor/contracts/sync.ts`, dono `modulo-vendedor`) ganham
  `v_icms_st_cents: z.number().int().nonnegative().nullable().optional()` e `v_ipi_cents` igual, **só no pull**
  (`servidor_vence`). O pull manda `null` explícito quando a coluna é `NULL`. Precedente: `prazo_percentual_ajuste` (T-0188) —
  o APK anterior não valida o pull em tempo de execução e ignora a chave nova.
- O push do app **nunca** manda esses campos (o app não tem o valor). Se vierem no push, a API ignora.
- Pedido criado offline ainda não tem a linha do servidor: não há chave, e o app mostra "calculado pelo ERP" (D3).

### D6 — Exibição (domain do Vendedor)

Função pura sugerida em `modules/vendedor/domain/impostos.ts` (dono `modulo-vendedor`):

```ts
export type ImpostoExibido = { tipo: 'valor'; cents: number } | { tipo: 'nao_informado' } | { tipo: 'calculado_pelo_erp' };
export function impostoExibido(valor: number | null | undefined, status: StatusPedido): ImpostoExibido;
```

- `status` antes de `integrado` → `calculado_pelo_erp`; depois, `null`/ausente → `nao_informado`; número → `valor` (inclusive 0).
- A função **não recebe** os itens: o total nunca é derivado deles.
- Telas (app e BKO) e PDF usam só essa função. Textos finais ("calculado pelo ERP", "não informado") ficam com o designer-ux na
  simulação; o código do `tipo` não muda.

### D7 — Regra para o doc 03 (o gerente-projetos leva; número a definir no doc, sugestão RN-VEN-48)

"ST e IPI do pedido vêm do ERP e são só mostrados, no item, no total e no PDF, em linhas próprias. O FDV não calcula imposto nem
soma itens. 0 = calculado e zero; ausente = 'não informado' (nunca zero); total ausente = 'não informado'. Antes da resposta do
ERP o pedido mostra 'calculado pelo ERP'. O valor sem imposto continua como hoje. *(ADR 0077, 28/11/2026.)*"

### D8 — O teste que prova que não há cálculo (T-0208 critério 4)

Dono: `modulo-vendedor` (domain e API), com conferência do `testes`. Três provas, citando a RN do D7:

1. **Total sem mudança**: o mesmo pedido, com e sem `impostos` aplicados (ST e IPI diferentes de zero), tem `total_cents` do
   pedido e de cada item idênticos, e o PDF mostra o mesmo valor sem imposto.
2. **Sem soma**: total ausente com todos os itens presentes → o total sai "não informado" (`impostoExibido(null, 'integrado')`),
   e a resposta da API e o pull trazem `null`, não a soma dos itens. Item `0` sai `R$ 0,00`; item ausente sai "não informado".
3. **Sem fórmula no código**: um teste de varredura em `modules/vendedor/{domain,api}` e `modules/integracao/{domain,api}` falha
   se aparecer `aliquota`, `mva`, `base_calculo`/`baseCalculo` ou qualquer expressão aritmética envolvendo `v_icms_st_cents` ou
   `v_ipi_cents` (o valor só é copiado, nunca operado).

Com Postgres (T-0208 critério 3): o retorno com os 3 casos grava `0`, `NULL` e `NULL` no total, e um retorno seguinte sem
`impostos` não apaga nada.

### D9 — Ordem e donos

| Etapa | Dono | O quê |
|---|---|---|
| E1 | engenheiro-software | esta ADR e o registro em `.coord/contratos/eventos.md` |
| E2 | designer-ux | simulação do pedido e do PDF com os 3 casos e "calculado pelo ERP" (critério 2) |
| E3 | banco-dados | migração 0112 (D5) e o teste de banco dela |
| E4a | modulo-integracao | `ImpostosRetorno` no `RetornoErp` e no `retorno_erp@1` (D4); descarte de sequência no monitor; Conector lendo `v_icms_st`/`v_ipi` |
| E4b | modulo-vendedor | gravar no consumidor do retorno, `impostoExibido` (D6), sync (D5), telas, PDF e os testes do D8 |
| E5 | testes, corretor-redundancias, design-de-marca, engenheiro-software | roteiro com os 3 casos, parecer e revisão final |

O teste de ponta a ponta depende do ERP na v0.3.31; E2 a E4 andam antes com os campos opcionais.

## Alternativas consideradas

- **Calcular ST e IPI no FDV** (tabela de alíquotas e MVA por NCM/UF): descartada pela decisão 63 A; duplicaria a regra fiscal
  do ERP e daria valor divergente da nota.
- **Ausente = 0**: descartada; esconde item sem regra fiscal (o ERP pediu o contrário).
- **Somar os itens quando o total vier ausente**: descartada; o ERP manda o total ausente justamente porque ele não é conhecido.
- **Campos soltos no `RetornoErp`, sem o objeto `impostos`**: descartada; não diferencia "ERP sem regra" de "Conector antigo que
  não manda nada", e um retorno antigo apagaria os valores.
- **Versão nova (`v2`) do retorno ou `@2` do evento**: descartada; o campo é opcional e aditivo (RN-INT-09, como `chave_acesso` e
  `itens_faturados`).
- **Levar ST e IPI em `vendedor.pedido.faturado@1`**: descartada; o evento é de quantidades e nenhum consumidor precisa do valor.
- **Tabela própria de impostos por pedido**: descartada; quatro colunas anuláveis bastam e mantêm o pull como está.

## Consequências

- Pedidos antigos e pedidos de ERP sem a T-0132 mostram "não informado" depois de integrados; nunca zero.
- O valor sem imposto e todas as regras sobre ele ficam iguais; nenhum indicador muda.
- Toda revisão procura conta com `v_icms_st_cents`/`v_ipi_cents`; a varredura do D8 trava no CI da versão.
- Um "total com impostos" fica fora até o ERP mandar o valor pronto.

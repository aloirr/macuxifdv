# ADR 0076 — Quantidade fracionária no pedido (KG e M, até 4 casas)

- **Status**: proposta (número 0076 reservado pelo gerente-projetos da S12, ainda não escrito no `.coord/quadro.md` do `origin/main`;
  conferido livre em `docs/decisoes/` do `origin/main` em 25/11/2026 03h40, Manaus).
- **Data**: 2026-11-25 (Manaus)
- **Versão**: v1.0.35 (sessão S12; número da tarefa a confirmar pelo gerente-projetos — citar "quantidade fracionária, ADR 0076").
- **Autor**: engenheiro-software
- **Origem**: decisão do dono do produto (vender por peso e por metro, com fração) e a avaliação do engenheiro de 25/11, que
  classificou a mudança como **incompatível** (quantidade inteira em contratos, eventos, banco e app).
- **Relacionadas**: ADR 0016 (medida de venda, fator, `exigeConector`), ADR 0070 / T-0195 (atualização obrigatória do APK,
  `situacaoDaVersao`, `ctx.versaoApp`), ADR 0062 (precedente de evento em duas versões), RN-VEN-02, RN-VEN-04, RN-VEN-15,
  RN-VEN-23, RN-CORE-19, RN-INT-08.

## Contexto

Hoje a quantidade é inteira em toda a cadeia:

- contratos do Hub: `ItemFaturado.quantidade` (`modules/integracao/contracts/pedido.ts`), `ItemFaturadoDescartado.quantidade`,
  `ItemPedidoErp.fator`, `ProdutoUnidadePayload.fator` (`entidades.ts`);
- Core: `ProdutoUnidadeSyncSchema.fator` (`modules/core/contracts/sync.ts`);
- Vendedor: `PedidoItemSyncSchema` (push e pull), `vendedor.pedido.criado@1`, `vendedor.pedido.aprovado@1`,
  `vendedor.pedido.faturado@1`;
- banco: `core.produto_unidade.fator`, `vendedor.pedido_item` (`quantidade`, `fator`, `quantidade_base`, `quantidade_faturada`,
  `quantidade_embalagem`, `quantidade_unidades`) e `integracao.pedido_retorno_erro.quantidade` em `integer`;
- domain: `exigirFator` duplicado em `preco-item.ts` e `preco-pedido.ts` (recusa fator não inteiro), `quantidadePermitida` trunca no
  inteiro, `total_cents = preco_unitario_cents * quantidade`.

O app antigo valida o pull com schemas `.strict()` e `int()`: uma linha com `fator: 12.5` ou `quantidade: 1.25` derruba o pull
dele. Os apps até a v1.0.32 não mandam o cabeçalho `x-macuxi-app` e nunca são bloqueados pela API (ADR 0070 D2). O Conector 1.5.x
lê quantidade e fator como inteiros.

## Decisão

### D1 — Regra (RN-VEN-02 v3 e RN-VEN-15)

- **Fração só nas unidades `KG` e `M`**, com até **4 casas decimais**. Nas demais unidades a quantidade continua inteira.
- **Total do item = preço unitário × quantidade, arredondado ao centavo, meio para cima** (igual ao `vProd` do Manual da NF-e:
  `qCom × vUnCom` com 2 casas). O preço unitário continua arredondado antes, como na v2 (RN-VEN-02). Com quantidade inteira o
  resultado é idêntico ao de hoje. Exemplo: R$ 19,99/kg × 1,250 kg = 2.498,75 centavos → **2.499**.
- **Fator** (unidades base por embalagem) aceita até 4 casas e é > 0 (ex.: CX com 12,5 kg).
- **Quantidade fracionária e fator fracionário nunca juntos no mesmo item**: assim `quantidade_base = quantidade × fator` tem no
  máximo 4 casas e cabe exata no banco. Na prática a venda em KG/M tem fator 1 (unidade base) ou inteiro.
- O desconto/acréscimo do pedido segue rateado nas linhas pelo maior resto (sem mudança). Faixa escalonada (RN-VEN-23) compara a
  quantidade decimal com o mínimo inteiro, sem mudança. Estoque fracionário **fica fora** desta ADR: o estoque segue inteiro e a
  comparação "quantidade ≤ estoque" (RN-VEN-04) funciona com a quantidade decimal.

Texto para o doc 03 (o gerente-projetos leva): **RN-VEN-02 v3** — "… total da linha = preço unitário × quantidade, arredondado ao
centavo, meio para cima (como o vProd da NF-e). A quantidade admite até 4 casas decimais só nas unidades KG e M; nas demais é
inteira. Quantidade e fator nunca são fracionários no mesmo item. *(v3: ADR 0076, 25/11/2026.)*"

### D2 — Representação no fio: **número JSON**, não string

A quantidade e o fator trafegam como **número JSON com no máximo 4 casas** (`1.25`, `12.5`, `3`). Motivos:

1. **Compatível onde não há fração.** Inteiro continua idêntico no fio (`3` é `3`). Pedido sem fração sai byte a byte igual para o
   app antigo, o Conector 1.5.x e os consumidores do `@1`. Uma string (`"3.0000"`) mudaria **todo** item, inclusive os inteiros,
   e obrigaria versão nova de todos os contratos ao mesmo tempo.
2. **Exato o bastante.** O teto (D7) tem no máximo 14 dígitos significativos, abaixo dos 15 que o `double` garante. O
   `JSON.stringify` do JS sempre devolve a forma mais curta que volta ao mesmo número (`1.2345` → `"1.2345"`), e o Conector lê
   o texto do número direto em decimal (`decimal` do .NET, `numeric` do banco do ERP), sem passar por float.
3. **Os schemas já são `z.number()`.** A mudança é tirar o `.int()` e pôr a regra das 4 casas (`QuantidadeDecimalSchema`, D4).

Regras de uso:

- **Nunca fazer conta com o `number` decimal.** Conta é feita no inteiro em escala (D3) e só volta a `number` para o fio.
- **Banco → TS:** o `node-pg` devolve `numeric` como **string**. Toda leitura dessas colunas converte com `quantidadeDoBanco`
  (D4). Não há conversor global de tipo (afetaria os percentuais `numeric(5,2)` que já são lidos como texto); `::float8` no SQL
  também não. Escrita: passar o `number` (o `node-pg` manda o texto do número).

### D3 — Representação interna: inteiro de 1/10.000

No `domain` (Vendedor, Core, Integração) a quantidade e o fator são **inteiros em escala 10.000** (`1,25` → `12500`). Somas,
comparações e `quantidade_base` usam esse inteiro. O total do item multiplica em `BigInt` (preço × quantidade em escala passa de
2^53 com quantidades grandes) e arredonda meio para cima: `(preco × q + 5.000) / 10.000`, divisão inteira.

### D4 — Nomes exatos (para todos trabalharem em paralelo)

**`@macuxi/comum/quantidade`** (`packages/comum/src/quantidade.ts`, puro, sem Zod; engenheiro-software, etapa E1):

| Nome | Assinatura / valor | Comportamento |
|---|---|---|
| `CASAS_QUANTIDADE` | `4` | |
| `ESCALA_QUANTIDADE` | `10_000` | |
| `UNIDADES_FRACIONARIAS` | `['KG', 'M'] as const` | |
| `unidadeFracionaria` | `(sigla: string \| null \| undefined) => boolean` | `trim().toUpperCase()` ∈ `UNIDADES_FRACIONARIAS` |
| `quantidadeEmEscala` | `(q: number) => number` | `RangeError` se não finito ou com mais de 4 casas; devolve inteiro |
| `quantidadeDaEscala` | `(u: number) => number` | `u / 10_000` (só para o fio e a tela) |
| `temFracao` | `(q: number) => boolean` | `quantidadeEmEscala(q) % 10_000 !== 0` |
| `quantidadeDoBanco` | `(v: string \| number) => number` | texto do `numeric` → `number`; `RangeError` se inválido ou > 4 casas |
| `quantidadeBase` | `(quantidade: number, fator: number) => number` | `quantidade × fator` exato pela escala; `RangeError` se os dois tiverem fração |
| `totalDaLinhaCents` | `(precoUnitarioCents: number, quantidade: number) => number` | D1/D3, `BigInt`, meio para cima |
| `formatarQuantidade` | `(q: number, unidade: string \| null) => string` | KG/M: vírgula, **mínimo 3 e no máximo 4 casas**, sigla minúscula: `1,250 kg`, `2,500 m`, `0,1255 kg`. Demais: inteiro com ponto de milhar e a sigla como vier: `1.200 CX` |

**`@macuxi/platform-sdk`** (engenheiro-software, etapa E1):

| Nome | Onde | O quê |
|---|---|---|
| `QuantidadeDecimalSchema` | `src/quantidade.ts` | `z.number().finite().positive()` + no máximo 4 casas (mensagem `quantidade deve ter no máximo 4 casas decimais`) e `≤ QUANTIDADE_DECIMAL_MAX` |
| `FatorDecimalSchema` | `src/quantidade.ts` | idem, `> 0`, 4 casas, `≤ 9999` (mesmo teto de `EMBALAGEM_QUANTIDADE_MAX`) |
| `QUANTIDADE_DECIMAL_MAX` | `src/quantidade.ts` | `999_999_999.9999` |
| `VERSAO_APP_FRACAO` | `src/app-versao.ts` | `'1.0.35'` |
| `fracaoLiberada` | `src/app-versao.ts` | `({ campo, gestao, agora }: { campo: VersaoPublicadaApp \| null; gestao: VersaoPublicadaApp \| null; agora: Date }) => boolean` (D6) |
| `clienteAceitaFracao` | `src/app-versao.ts` | `(app: AppDoCabecalho \| null) => boolean`: cabeçalho presente e versão ≥ `VERSAO_APP_FRACAO` |
| `CODIGO_FRACAO_BLOQUEADA` | `src/quantidade.ts` | `'quantidade_fracionaria_bloqueada'` (422, D6) |
| `MENSAGEM_FRACAO_BLOQUEADA` | `src/quantidade.ts` | "Quantidade com casas decimais só é aceita 24 h depois da publicação do Macuxi Campo e do Macuxi Gestão 1.0.35. Envie a quantidade inteira ou tente de novo mais tarde." (o designer-ux pode reescrever; o código não muda) |
| `CODIGO_FRACAO_INVALIDA` | `src/quantidade.ts` | `'quantidade_fracionaria_invalida'` (422: fração fora de KG/M, mais de 4 casas, ou quantidade e fator fracionários juntos; RN-VEN-02 v3) |

**`modules/vendedor/domain/quantidade.ts`** (modulo-vendedor):

- `exigirFator(fator: number): void` — **um só**, exportado daqui; sai a cópia de `preco-item.ts` e a de `preco-pedido.ts`. Aceita
  `> 0` com até 4 casas; senão lança `Error('RN-VEN-15: fator da unidade inválido.')`.
- `exigirQuantidade(i: { quantidade: number; unidade: string | null; fator: number }): void` — lança com `CODIGO_FRACAO_INVALIDA`
  nas três situações do D1.
- `quantidadePermitida(estoque, quantidade, unidade?: string | null)` — com unidade fracionária trunca em 4 casas; sem ela,
  trunca no inteiro (comportamento atual).
- `precoDoItem` passa a usar `totalDaLinhaCents` e `quantidadeBase`. O PDF (`netUnitCents`) continua `total ÷ quantidade`.

### D5 — Contratos

| Contrato | Mudança | Compatibilidade |
|---|---|---|
| `vendedor.pedido.criado@2` (**novo**) | igual ao `@1`, com `itens[].quantidade: QuantidadeDecimalSchema`. Código: `PedidoCriadoEventoV2`, `EVENTO_PEDIDO_CRIADO_V2 = definirEvento('vendedor.pedido.criado@2', …)` | nova versão (decisão do dono do produto e avaliação de 25/11) |
| `vendedor.pedido.criado@1` | publicado **em paralelo** com o `@2`, na mesma transação, até a desativação (D8). Pedido com item fracionário **não** sai no `@1` | sem mudança no schema |
| `vendedor.pedido.aprovado@1` | `itens[].quantidade`, `fator` e `quantidade_venda` decimais | alargamento na mesma versão (ver abaixo) |
| `vendedor.pedido.faturado@1` | `itens[].quantidade` decimal | idem |
| `integracao.pedido.retorno_erp@1` | `ItemFaturado.quantidade: QuantidadeDecimalSchema` | idem |
| `integracao.produto_unidade.atualizado@1` | `ProdutoUnidadePayload.fator: FatorDecimalSchema` | idem |
| Hub ↔ Conector (`/integracao/v1/*`) | `ItemPedidoErp.fator: FatorDecimalSchema.nullish()`, `quantidade` e `quantidade_venda` com 4 casas; `ItemFaturado.quantidade` e `ItemFaturadoDescartado.quantidade` decimais; `ProdutoUnidadePayload.fator` decimal | v1 do Hub; o pedido com fração exige **Conector 1.6.0** (`exigeConector`, D6) |
| sync `produto_unidade` (`ProdutoUnidadeSyncSchema.fator`) | `FatorDecimalSchema` | pull filtrado para app antigo (D6) |
| sync `pedido_item` (`PedidoItemSyncSchema`) | `quantidade`, `fator`, `quantidade_base`, `quantidade_faturada` decimais (push e pull) | push com trava; pull filtrado (D6) |

**Por que só o `criado` ganha `@2`.** O `criado@1` tem consumidores com projeção própria (Gestor) e é o evento que o dono do produto
decidiu versionar. Os quatro alargados na mesma versão têm consumidores **só dentro do monólito**, que entram no mesmo deploy
(etapa E3) **antes** de qualquer fração existir: nada fracionário é emitido enquanto a trava (D6) estiver fechada. A regra "mudança
incompatível = nova versão" fica atendida pela ordem das etapas; esta ADR é o registro da exceção.

### D6 — A trava (para o APK antigo e o Conector antigo não quebrarem)

**De onde vem "versão nova obrigatória".** Da mesma fonte da T-0195: a última versão publicada de cada variante e o
`publicada_em` (`ctx.versaoApp.publicada('campo' | 'gestao')` na API; a última resposta de `GET /v1/app/versao` no app). O APK é o
mesmo para todos os tenants (um manifesto por variante, ADR 0070 D1), então a trava abre para a plataforma toda; não há chave por
tenant.

`fracaoLiberada({ campo, gestao, agora })` é `true` só quando **as duas** variantes atendem:

- versão publicada **maior** que `VERSAO_APP_FRACAO` → atende; ou
- versão publicada **igual** a `VERSAO_APP_FRACAO`, com `publicada_em` válido e `agora ≥ publicada_em + PRAZO_ATUALIZACAO_APP_MS`
  (24 h: a partir daí a API bloqueia com 426 todo app ≥ 1.0.33 abaixo da 1.0.35);
- qualquer outro caso (sem versão, sem hora, menor, porta ausente) → **fechada**.

Publicar uma 1.0.36 depois não fecha a trava de novo (a primeira regra). Sem `ctx.versaoApp` na rota = fechada.

**Onde a trava é aplicada (fechada):**

| Entrada | Resposta |
|---|---|
| Hub, `POST /integracao/v1/lotes` com `produto_unidade` de `fator` fracionário | **422 `quantidade_fracionaria_bloqueada`**, `erros[]` um por registro (`campo: registros[i].fator`), mensagem `MENSAGEM_FRACAO_BLOQUEADA`. O Conector tenta de novo sozinho; o lote entra quando a trava abrir |
| Hub, `POST /integracao/v1/pedidos/{uuid}/retorno` com `ItemFaturado.quantidade` fracionária | 422 `quantidade_fracionaria_bloqueada` (`campo: itens_faturados[i].quantidade`) |
| Vendedor, push `pedido` / `PUT` do orçamento com item fracionário | 422 `quantidade_fracionaria_bloqueada` ("Não aceito" no app) |

**Sempre (aberta ou fechada):**

- **Pull filtrado por versão do cliente** (`clienteAceitaFracao(ctx.versaoApp?.doCliente ?? null)`): para cliente sem o cabeçalho
  ou abaixo da 1.0.35, o Core **omite** as linhas de `produto_unidade` com fator fracionário e o Vendedor **omite** os pedidos que
  tenham algum item com quantidade ou fator fracionário. Protege os apps até a 1.0.32, que nunca recebem 426.
- **Conector**: `exigeConector` devolve `VERSAO_CONECTOR_FRACAO = '1.6.0'` (`modules/integracao/domain/pedido-versao.ts`) quando
  algum item tem `quantidade`, `quantidade_venda` ou `fator` fracionário (a exigência maior vence, como a da filial). O pedido
  espera na fila com o alerta do monitor (`pedidosAguardandoConector`) até o Conector 1.6.0.
- **App 1.0.35**: o teclado decimal só aparece quando `unidadeFracionaria(unidade)` **e** `fracaoLiberada(...)` com as duas
  últimas respostas guardadas de `GET /v1/app/versao` (Campo e Gestão). Offline sem resposta guardada = inteiro. Diferença de
  cache (até 10 min) entre app e API vira, no pior caso, um "Não aceito" corrigível.

### D7 — Banco (migração **0106**, reservada; banco-dados)

- `core.produto_unidade.fator` → `numeric(9,4)`, check `fator > 0`.
- `vendedor.pedido_item`: `quantidade`, `fator`, `quantidade_base`, `quantidade_faturada`, `quantidade_embalagem`,
  `quantidade_unidades` → `numeric(14,4)`. Mantêm-se os checks atuais (`quantidade > 0`, `quantidade_base = quantidade * fator`,
  `quantidade_faturada between 0 and quantidade_base`, `quantidade_embalagem = fator`, `quantidade_unidades = quantidade * fator`)
  e entra `pedido_item_fracao_coerente check (quantidade = trunc(quantidade) or fator = trunc(fator))`. A função
  `vendedor.pedido_item_quantidade_base()` e a do 0018 seguem iguais (a multiplicação `numeric` é exata).
- `integracao.pedido_retorno_erro.quantidade` → `numeric(14,4)`.
- Toda outra coluna, view ou índice que leia essas colunas (ex.: índice da reserva de filial da 0061, views do Conector, funções que
  somem `quantidade_faturada`) é levantada e ajustada pelo banco-dados na mesma 0106. `numeric(14,4)` comporta o teto de D4.
- A 0106 não mexe em funções `sa_*` nem no kit do Conector (se mexer, vale o PR conjunto `alexandre/migracao-*`).

### D8 — Desativação do `vendedor.pedido.criado@1`

O servidor para de publicar o `@1` na **primeira versão a partir da v1.0.36** em que as três condições valem, conferidas pelo
engenheiro-software na revisão:

1. nenhum módulo declara o `@1` em `consome` (Gestor e Core já leem o `@2`; `grep "vendedor.pedido.criado@1"` só em histórico);
2. a outbox não tem `vendedor.pedido.criado@1` pendente nem falho há 7 dias;
3. a trava (D6) está aberta há pelo menos 7 dias.

Depois disso o `@1` vira "só histórico" em `eventos.md` (como o `aprovacao_solicitada@1`, ADR 0062): o schema e o consumidor tolerante
ficam para o que ainda estiver na outbox. Cada consumidor lê **uma** versão só (quem migrou para o `@2` deixa de declarar o `@1`),
para não contar o pedido duas vezes.

### D9 — Ordem das etapas (tudo na v1.0.35; E2 a E5 em paralelo depois da E1)

| Etapa | Dono | O quê |
|---|---|---|
| E1 | engenheiro-software | esta ADR e `.coord/contratos`; depois, em PR próprio, `@macuxi/comum/quantidade` e `platform-sdk` (D4) com testes de borda; garantir `ctx.versaoApp` também nas rotas do Hub |
| E2 | banco-dados | migração 0106 (D7) e o teste de banco dela |
| E3a | modulo-core | `ProdutoUnidadeSyncSchema.fator`, consumidor de `produto_unidade.atualizado@1` com fator decimal, pull filtrado (D6), consumidor do `criado@2` (metas) no lugar do `@1`; leitura com `quantidadeDoBanco` |
| E3b | modulo-vendedor | domain (D4, RN-VEN-02 v3 com teste citando a RN), `PedidoItemSyncSchema`, trava no push, `criado@2` + `@1` em paralelo, `aprovado@1`/`faturado@1` alargados, pull filtrado, `quantidadeDoBanco` nas leituras, PDF com `formatarQuantidade` |
| E3c | modulo-integracao | contratos do Hub (D5), trava no lote e no retorno (D6), `VERSAO_CONECTOR_FRACAO` no `exigeConector`, **Conector 1.6.0** (`apps/conector`) lendo e gravando decimal |
| E3d | modulo-gestor | consumir `vendedor.pedido.criado@2` no lugar do `@1` (projeção com quantidade decimal) e tolerância ao `faturado@1` decimal |
| E4 | engenheiro-apps | teclado `decimal-pad` com vírgula só em KG/M e só com `fracaoLiberada`, 4 casas; `formatarQuantidade` no carrinho e no detalhe; guardar a última resposta de `GET /v1/app/versao` das duas variantes |
| E5 | testes | roteiro: inteiro idêntico ao de hoje; 1,250 kg × R$ 19,99 = R$ 24,99; trava fechada → 422; app 1.0.34 sem linha fracionária no pull; Conector 1.5 → pedido esperando |
| E6 | gerente + dono do produto | deploy v1.0.35 e publicação dos dois APKs 1.0.35; a trava abre sozinha 24 h depois |

Ninguém emite fração antes da E6 + 24 h, então E2 e E3 podem entrar em qualquer ordem **dentro do mesmo lote** (a 0106 e as leituras
com `quantidadeDoBanco` precisam estar no mesmo deploy: sem elas o código atual leria string).

## Alternativas consideradas

- **String decimal no fio** (`"1.2500"`): exata por construção, mas muda o tipo de todo item, inclusive os inteiros, e quebra o app
  e o Conector antigos mesmo sem nenhuma fração. Descartada (D2).
- **Quantidade em milésimos inteiros no fio** (`quantidade_mil`): campo novo em todos os contratos, conversão nas duas pontas e
  risco de ler o campo errado. Descartada; a escala fica só dentro do domain (D3).
- **`numeric` lido como `number` por conversor global no `node-pg`**: muda a leitura de todas as colunas `numeric` do sistema de uma
  vez. Descartada (D2).
- **Chave por tenant para liberar a fração**: o APK é o mesmo para todos e a obrigatoriedade já é medida pela T-0195; uma chave a
  mais exigiria tela no BKO e ainda dependeria da versão. Descartada.
- **Trava só pela versão, sem filtrar o pull**: os apps até a 1.0.32 não recebem 426 e quebrariam no pull. Descartada (D6).
- **`@2` também para `aprovado`, `faturado`, `retorno_erp` e `produto_unidade`**: dobraria publicadores e consumidores sem ganho,
  porque os consumidores entram no mesmo deploy antes de qualquer fração. Descartada (D5).

## Consequências

- O Conector precisa da 1.6.0 para receber pedido com fração; até lá esses pedidos esperam na fila com o alerta do monitor.
- Lotes de `produto_unidade` com fator fracionário ficam recusados (422) até a trava abrir; os demais registros dessa entidade no
  mesmo lote esperam junto.
- Um app antigo não vê, no pull, os pedidos com fração nem as embalagens com fator fracionário.
- Toda leitura nova de quantidade no banco passa por `quantidadeDoBanco`; o revisor procura `quantidade` lida sem ela.

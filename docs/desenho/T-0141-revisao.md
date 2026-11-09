# Revisão final — T-0141 (Novo pedido v3) — engenheiro-software

- **Data**: 2026-11-09 · **Base**: `git diff origin/main` + arquivos novos (não rastreados) em `modules/vendedor`, `db/migrations/0055_*`,
  `packages/comum/src/endereco.ts`, `.coord/contratos/eventos.md`
- **Entregas revisadas**: modulo-vendedor R-20261109-110054 (D, E, G, H, I, F domain) e R-20261109-143406 (A, B, C, F tela, G "Preços
  de hoje"); banco-dados R-20261109-122523 (0055); desenho `docs/desenho/T-0141.md` (item C)
- **Veredito: APROVADA sem 🔴.** 4 🟡 (3 do modulo-vendedor, 1 meu) e 4 🟢. Os 🟡 não seguram o lote; entram antes do build do APK
  seguinte ou numa T de correção.

## O que foi conferido

| Ponto | Resultado |
|---|---|
| Fronteiras | Vendedor importa só `@macuxi/{comum,core/contracts,catalogo/contracts,integracao/contracts,platform-sdk,ui,db/teste}`. `@macuxi/comum` declarado no `package.json`. Sem tabela de outro schema |
| Regra no domain com teste citando RN | `domain/endereco-pedido.ts` (RN-VEN-17, 15 casos), `domain/orcamento.ts` (`validadeDoPreco`, `precoDoOrcamentoVale`, RN-VEN-18), `domain/rascunhos.ts` (RN-VEN-39, relógio injetado), `domain/pdf-pedido.ts` (`orderPdfFileName`, RN-VEN-41), `app/lib/salvar-na-fila.ts` (`motivoDaRecusa`, RN-VEN-40). A API revalida: `receber.ts:167` e `orcamentos.ts` chamam `enderecoDoPedido`; `receber.ts:309` só congela o preço com `precoDoOrcamentoVale` |
| Contrato (C) | Igual ao desenho §2: `EnderecoEditadoPedido` estrito (60/20/60/60/60, UF das 27, CEP 8), `EnderecoEntregaPedido` com `origem` opcional, `PedidoPush.endereco_entrega_editado` aditivo; `aprovado@1` com `origem?` (continua @1; registro atualizado); Hub `EnderecoEntregaErp.origem` nullish no v1 |
| Banco | 0055 só com os 3 CHECKs do desenho §6; `down` remove os 3; linhas antigas sem `origem` = `erp`; o retrato editado do domain (`id`/`external_id` nulos, `principal: false`, UF maiúscula, CEP 8 dígitos) satisfaz os 3 |
| Multi-tenant e RLS | Nenhuma consulta nova sem `tenant_id`; a 0055 não mexe em política nem em grant |
| Licença e perfil | Push e edição passam por `recusaDePerfil` (promotor = 403 RN-PRO-01, agora numa checagem só em `revalidarPedido`). Página `rascunhos` com `acao: 'pedido.criar'` (o promotor não abre). Ver 🟡 V1 (linha de atalho) |
| Offline | Rascunho e endereço editado moram no aparelho e na fila; formulário sem consulta de CEP; "Preços de hoje" calculado com os dados locais; a API recalcula na chegada |
| Dado pessoal fora de log | Recusa do endereço com `MSG_ENDERECO_INVALIDO` fixa, sem o conteúdo; a API não loga o push; erro do Postgres (CHECK 23514) sai só com o SQLSTATE (`log-seguro.ts`); `console.warn` do app só no renomear do PDF (sem endereço) |
| Pull (500 corrigido) | `api/sync.ts`: `$8` (fuso) só na consulta do pedido (`validade_ate`); item e evento levam 7 parâmetros. Teste `orcamentos.test.ts:98/112/113` confere o número. Listagem (`pedidos.ts`): `$15` (agora) saiu e `por_status` virou `$15`; 15 valores para 15 marcadores |
| Compatibilidade do aparelho antigo | APK antigo sem `origem`: o retrato lido com `origem` ausente vira `erp` (`mapeamento.ts`, `pull.ts`, `enderecoParaEvento`). Documento antigo com `validade_data`: o app deriva o dia do preço (`dataDoPrecoDoOrcamento`). A API nova não manda mais `expirado` (o enum antigo do APK é superconjunto). O APK antigo nunca filtra `situacao=expirado` |
| Ordem de publicação | Ver §Ordem |

## Achados

### 🟡 V1 — modulo-vendedor — linha "Rascunhos (n)" fora do `SePode`
`modules/vendedor/app/screens/orders-screen.tsx:262`: o `LinhaAtalho` para Rascunhos aparece só pela contagem, sem `SePode
acao="pedido.criar"` (o botão "Novo" da linha 257 tem). A página já é barrada pela `acao`, mas um promotor que entra num aparelho em
que um vendedor deixou rascunho veria a linha (o rascunho é local) e cairia numa tela negada. Regra 7 do CLAUDE.md: o promotor nunca
vê pedido. **Correção:** envolver a linha no mesmo `SePode` e, de preferência, a contagem só para quem pode criar.

### 🟡 V2 — modulo-vendedor — "preço de dd/mm" com duas fontes
- PDF: `domain/pdf-pedido.ts:259` usa `etiquetaPrecoDe(order.created_at, tz)`.
- App e BKO: `selo-lista.ts:15` e `order-detail-screen.tsx:203/225` usam `dataDoPrecoDoOrcamento(validade_data, dias)` (validade − `orcamento.validade_dias` atual).
- Divergem em 2 casos:
  - orçamento editado depois dos 7 dias (a API renova a validade em `orcamentos.ts` e o `created_at` fica);
  - tenant que muda `orcamento.validade_dias` depois de salvar.
- Critério 5 da tarefa (valor × regra): o mesmo documento tem de mostrar o mesmo dia no app, no BKO e no PDF.
- **Correção:** uma função só no domain para o dia do preço de um documento, usada pelo PDF, pelo selo e pela folha. A base mais firme é a `validade_data` com os dias gravados no documento; se precisar de campo novo no detalhe, me peça o contrato.

### 🟡 V3 — modulo-vendedor — Transformar não herda o endereço no servidor
Desenho §4: "Transformar: sem endereço no corpo, o pedido herda o retrato do orçamento". Hoje quem copia é o aparelho
(`app/lib/documento.ts:75` → `domain/orcamento.ts:316`). A API (`receber.ts:167`), com `orcamento_origem_id` e sem
`endereco_entrega_id`/`endereco_entrega_editado`, cai no endereço principal. Um APK anterior (Campo ou Gestão ainda não atualizado)
que transforma um orçamento com endereço editado manda só `delivery_address.id` (nulo) e perde o endereço **sem avisar**.
**Correção:** no `receberUm`, com `origem` e sem os dois campos, usar o retrato do orçamento de origem (editado continua editado),
com teste de API citando RN-VEN-17.

### 🟡 V4 — engenheiro-software (meu) — `PAYLOAD_INVALIDO` em inglês chega à tela
`packages/platform-sdk/src/sync.ts:281` junta as mensagens do Zod (`Invalid enum value…`, `Required`) na `mensagem` do item rejeitado.
Com a RN-VEN-40, o `motivoDaRecusa` passa essa frase adiante (tem espaço, não é código). O caminho é raro, porque o app valida antes com o
mesmo domain, mas um contrato divergente mostraria inglês técnico. **Correção (minha):** mensagem fixa em português ("Dados do
pedido inválidos. Atualize o app e tente de novo.") com os caminhos dos campos, sem `received`.

### 🟢 S1 — modulo-vendedor — comentários desatualizados
- `contracts/index.ts:325`: o comentário ainda diz "Vencido/convertido/cancelado = 422 RN-VEN-18".
- `api/sync.ts:93`: o comentário ainda lista "$8 fuso do tenant" no `FILTROS_PEDIDO`, que não usa mais o `$8`.

### 🟢 S2 — modulo-vendedor — limites do endereço em dois lugares
`LIMITES_ENDERECO` (domain) e `LIMITES_ENDERECO_PEDIDO` (contrato) repetem os números, e um teste confere que são iguais. O contrato já
importa enums do domain (`contracts/index.ts:20-22`); pode importar este também e apagar a cópia.

### 🟢 S3 — modulo-vendedor — F.4 pendente
O aviso "Pedido guardado em Rascunhos" com o botão Abrir, na saída sem a pergunta, ficou de fora: a pendência já está declarada na
entrega. O critério 3 (nenhuma saída perde o pedido) está atendido pelo rascunho automático. O aviso entra quando o engenheiro-apps
expuser o evento de saída do shell.

### 🟢 S4 — banco-dados — CHECK sem `NOT VALID`
Os 3 `add constraint` da 0055 varrem `vendedor.pedido` com trava exclusiva. Na demo e no começo da produção é instantâneo. Em tabela
grande, o padrão é `NOT VALID` e depois `VALIDATE CONSTRAINT` em migrações separadas. Só para registro.

## Ordem de publicação (desenho §7)
1. **API e 0055 antes do APK** (Campo-Demo e Gestao-Demo). O APK novo com a API antiga perderia o endereço editado em silêncio,
   porque o `PedidoPush` não é estrito. A edição do orçamento (`EditarOrcamentoRequest` estrito) daria 400, sem perda. A conversão
   com o preço vencido seria recusada com a mensagem antiga, RN-VEN-18, também sem perda.
2. A 0055 pode subir antes ou junto da API: a API nova não depende dos CHECKs.
3. Seed demo (sem `--recriar`) depois da 0055, para o p11 editado.
4. A API nova com o APK antigo é compatível (tabela acima). O V3 é o único caso de perda com versões misturadas.

# ADR 0004 — Permissão por ação declarada no manifesto

- **Status**: aceita
- **Data**: 2026-10-31
- **Tarefa**: T-0001 (Fase A2) — débito do vendedor (`acoesPedido` no `manifest.ts`)
- **Autor**: engenheiro-software

## Contexto
O manifesto dizia só "para quem o módulo aparece" (`perfis`). A matriz do doc 03 §2 é por **ação**
(criar/cancelar/aprovar pedido, coletas de trade, criar pesquisa…), e RN-PRO-01 exige que o promotor
nunca veja nem execute ação de pedido, na UI e na API, **mesmo com o Vendedor ativo** (esclarecimento de
2026-10-30). Sem lugar no SDK, o Vendedor exportou `acoesPedido` à parte, que nenhum shell lia.

## Decisão
- `defineModule` aceita o campo opcional `acoes: { '<entidade>.<verbo>': { perfis, descricao? } }`
  (padrão `{}` — nenhum manifesto existente quebra). Nome no formato `ACAO_RE` (`pedido.criar`).
- **RN-PRO-01 na plataforma, em duas camadas**: `defineModule` recusa ação `pedido.*` com `promotor`, e
  `criarPermissoes(...).pode` nega ação de pedido ao promotor mesmo que um manifesto escape.
- `criarPermissoes(manifestos)` → `pode(acao, { perfil, modulosAtivos })` (módulo dono efetivo + perfil;
  ação desconhecida = negada), `acoesPermitidas`, `regraDaAcao` e `verificarAcao` para a API (401 /
  403 `MODULO_INATIVO` / 403 `PERFIL_SEM_ACESSO`). `validarConjunto` acusa a mesma ação em dois módulos.
- Shell: página com `acao` só aparece/abre para quem pode; item de extensão com `acao` só é listado se
  `filtro.pode(acao)` (sem `pode` → escondido, falha fechada); telas usam `usePode`/`<SePode>`.
- **testID é da tela, não do manifesto**: o botão "Duplicar" e o "Novo pedido" exigem a mesma ação
  `pedido.criar` mas têm testIDs diferentes; ficam no código da tela do módulo.
- Escopo do dado (próprio/equipe/tenant) **não** entra aqui: continua no `domain` + `verificarCarteira`.

## Alternativas consideradas
- **Permissões só no `domain` de cada módulo**: o shell não teria como esconder ações de outros módulos
  (ex.: botão de pedido registrado em `cliente.acoes` do core) sem importar o domain alheio.
- **Papéis/permissões no banco (RBAC configurável)**: flexível, mas a Sprint 0 não tem tela nem regra para
  isso; o manifesto é a fonte versionada. Se vier, o banco passa a restringir o que o manifesto permite.
- **Ação no JWT**: contraria a decisão de checar licença por requisição (RN-CORE-01, Q8).

## Consequências
- O Vendedor move `acoesPedido` para `acoes` do manifesto (recado ao modulo-vendedor); os testIDs vão para
  as telas na B2. Outros módulos declaram as suas quando tiverem ações (promotor: coletas; pesquisa:
  publicar…).
- A API (T-0004) usa `verificarAcao` em toda rota de escrita; o mesmo nome de ação liga UI, API e teste.

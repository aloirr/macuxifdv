# Perfis: kit da tabela de permissões (ADR 0073, etapa E5)

Base: simulação aprovada `docs/design/simulacoes/2026-11-24/perfis-tabela.md` (um perfil por vez, linha = permissão) e a
validação de marca `docs/marca/auditorias/2026-11-24-perfis-tabela.md`. Código: `packages/ui/src/web/tabela-permissoes.tsx`
(componentes) e `tabela-permissoes-estado.ts` (contas puras). Só apresentação: a página (modulo-core) diz o que está
marcado, travado, sem licença, o nível e os alvos; nenhuma regra mora no kit.

| Peça | Uso |
|---|---|
| `TabelaPermissoes` | `grupos` (na ordem da ADR), `abertos`, `onAlternarAberto`, `onAlternarLinha`, `onMarcarVarias`, `aviso` (único, autogestão), `busca`/`onBusca`. Sem resultado: "Nenhuma permissão com esse nome." |
| `GrupoPermissoes` | Cabeçalho: caixa tri-estado (`aria-checked="mixed"`), seta (`aria-expanded`), título, selo "Sem licença" e "n de m ligadas". |
| `LinhaPermissao` | Caixa à esquerda do nome; à direita o cadeado com o motivo escrito, "Sem efeito: …" ou o slot `direita` (nível, "De: … Mudar"). |
| `SeletorEscopo` | Segmentado de escopo com `teto`: os níveis acima levam cadeado, ficam desabilitados e as setas os pulam; `motivoTeto` é falado em cada um. |
| `CaixaMarcar` | Caixa de 20 px num alvo de 44 px, `role="checkbox"`; espaço liga/desliga; travada continua focável (`aria-disabled`). |

## Regras de desenho
- **Caixa do grupo** liga ou desliga só as linhas livres (`mudancasDaCaixaDoGrupo`): com todas as livres marcadas, desliga; senão, liga. Grupo sem livre (tudo travado ou sem licença) deixa a caixa desabilitada.
- **Contagem** "n de m ligadas" conta todas as linhas do grupo, livres ou não.
- **Autogestão**: a linha leva só o cadeado (`trava: {}`), sem motivo; o motivo vai uma vez no `aviso` do topo.
- **Sem licença**: selo no cabeçalho, a frase `textoSemLicenca(modulo)` embaixo e as linhas desabilitadas com o valor guardado.
- **Cores da caixa**: marcada `accent` #1E3350 (✓ 12,77:1); vazia borda `field`; travada vazia `line-2` com borda `line`; **travada marcada `field` #7A8593 (✓ branco 3,75:1)**, no lugar do `disabled` #8B96A3 (3,00:1, observação 1 da auditoria de marca). Sem token novo.
- Motivos sem código de regra (UX-13). Movimento: escala 0,97 em 120 ms no toque, desligada com "reduzir movimento".

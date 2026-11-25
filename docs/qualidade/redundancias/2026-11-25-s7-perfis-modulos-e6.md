# S7 — E6 nos módulos: `perfis` → `acao` nas rotas de leitura (ADR 0073)

Data: 25/11/2026 (Manaus). Base: catálogo v2 49323be. Commits revisados (1 cada, `git show HEAD`):
- core e6fb29ebb72b63dbdb056cb5ada2285ac66ef2a5 (modulo-core)
- pesquisa 06e19a18f9e08580466450e265c44bccd362259f (modulo-pesquisa)
- promotor e08cc5c136bb05e46efb6bc8fc6eb192c7f74aae (modulo-promotor)

**Parecer: NÃO LIBERADO** nos três (4 achados baixos, em código, teste ou comentário de produção; a exceção R-20261111-190159 não os cobre).

## Pontos pedidos
| Ponto | Conclusão |
|---|---|
| Chave no `manifest.acoes` × `ACOES_DA_TRANSICAO` (SDK) | Perfis e descrições iguais, texto por texto, nas 7 chaves. **manter? (transitório)**: o comentário do SDK (`permissoes-perfil.ts:162-167`) diz que a entrada sai quando os três módulos migrarem, e o manifesto prevalece no `acoesDoModulo`. Fica conferir a retirada no commit do engenheiro-software. |
| Constantes de perfis que sobraram | Pesquisa: `PERFIS_LEITURA_BKO` removida, sem uso restante. Core: `PERFIS_GESTAO` do domain segue em uso (`perfilDeGestao` e teste), sem sobra. Promotor: `PERFIS_RELATORIO` segue em uso no web (`web/index.ts`). O `PERFIS_LEITURA` do manifesto do promotor repete a lista literal de `PERFIS_RELATORIO` (contracts), mas nenhum manifesto importa de `contracts` (todos usam constantes locais): **manter**. |
| Testes repetidos | Ver RD-3709 e RD-3710. |

## Achados
| ID | Onde | Proposta | Sev. | Dono |
|---|---|---|---|---|
| RD-3708 | `modules/core/manifest.ts:21-24` | A lista `['supervisor', 'gerente', 'analista', 'assistente', 'admin']` aparece 4 vezes. Usar `const PERFIS_LEITURA = ['supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const;` e `perfis: [...PERFIS_LEITURA]`, como nos outros manifestos. | baixa | modulo-core |
| RD-3709 | `modules/pesquisa/api/api.test.ts:110` | O ramo `: { perfis: r.perfis! }` e o `as never` sobraram (nenhuma rota tem mais `perfis`). Trocar por `{ modulo: 'pesquisa', acao: r.acao!, permissoes: perm }`. | baixa | modulo-pesquisa |
| RD-3710 | `modules/promotor/api/rotas.test.ts:41` | `expect(quem('relatorio_trade.ver'))...` está dentro do `for` e roda 2 vezes igual. Deixar no laço só o `acao` e a linha do `quem` uma vez, depois. | baixa | modulo-promotor |
| RD-3711 | `modules/promotor/api/rotas-cadastros.ts:3` | O comentário "leitura: `PERFIS_RELATORIO`" ficou desatualizado. Trocar por "leitura: ação `cadastro_trade.ver`". | baixa | modulo-promotor |

Defeito funcional encaminhado: nenhum.

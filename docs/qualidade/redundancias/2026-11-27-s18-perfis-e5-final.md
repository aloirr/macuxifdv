# Redundâncias: parecer final da E5 dos perfis (S18, v1.0.40, 27/11/2026, horário de Manaus)

Rodada nos heads exatos. O #854 foi lido só no diff dos commits do modulo-core contra `429e0062` e contra o #853. O que veio por merge de outro dono (0109) não conta. Nas rotas V2 (`5785a719`), só o RD-3734 e o RD-3735.

| PR | Dono | Branch | Head | Base do diff |
|---|---|---|---|---|
| #853 | designer-ux | `nuvem/v1040-designer-ux-perfis` | `75a3813bc7f25ac87795ac95819140486013ab9c` | já lido em [2026-11-27-s18-perfis-e6](2026-11-27-s18-perfis-e6.md) |
| #854 | modulo-core | `nuvem/v1040-modulo-core-perfis` | `183638eb8990351d6795a44291002402b7147b77` | `429e0062` (commits `5785a719`, `8cb4d518`, `183638eb`) e `75a3813b` |

Parecer anterior: [2026-11-27-s18-perfis-e6](2026-11-27-s18-perfis-e6.md) (`3ccd9d1b`).

## Parecer
- **#853 designer-ux `75a3813b`: LIBERADO.** É o mesmo SHA do parecer anterior, sem commit novo.
- **#854 modulo-core `183638eb`: NÃO LIBERADO.** Seguram o RD-3734 (média, reaberto: sobrou a parte do `sync.ts` e do `clientes.ts`) e o RD-3741 (média, novo: a regra de promotor do SDK foi copiada no domain).

## Reteste
| RD | Situação | Evidência |
|---|---|---|
| RD-3734 | reaberto | `promotor-pedidos.ts:24-28` (api) passa a chamar o domain e só lê o parâmetro quando precisa. Sobrou o resto: `sync.ts:287` ainda testa `ctx.usuario.perfil !== 'promotor' && ctx.usuario.cargo !== 'promotor'` antes de chamar `usuarioVePedidos`, que faz o mesmo teste com outra fórmula. Com isso, o core continua com 2 fórmulas para "é promotor?". `perfilRecebeHistoricoDeCompra('promotor', x)`, que devolve sempre `x`, segue em `sync.ts:288` e `clientes.ts:95`. |
| RD-3735 | corrigido | `MENSAGEM_PERFIS_NAO_MIGRADOS` está em `contracts/perfis.ts:259` e `perfis-v2.ts:167` a usa. Saíram `MENSAGEM_NAO_MIGRADO` e `ehNaoMigrado`, com os 3 desvios, e a tela mostra o texto da API (`frasesDaRecusa`, `errorMessage`). "em migração", "em ajuste" e "e tente de novo" não aparecem mais em `modules/core`. |
| RD-3736 | corrigido | `perfis-tabela.ts:6` importa `CHAVE_ACESSO`, `NIVEIS_ALCADA` e `NIVEIS_ESCOPO` do SDK. Saíram `ALVO_TODOS`, `CHAVE_BKO` e as 2 listas locais. |
| RD-3737 | corrigido | `SeletorDeOrigem` (`cabecalho-perfil.tsx:19`) serve as 2 telas, e `origemDoValor` (`perfis-tabela.ts:22`) desmonta o prefixo nas 2, com teste. `SEM_CONEXAO` e `ehSemConexao` estão na lib, e `novo-perfil.tsx:63` usa `SEM_CONEXAO` ou `errorMessage`. |

## RD-3734 (reaberto): o que falta
- `modules/core/api/sync.ts:287-288` passa a ser:
  ```ts
  if (t.tabela !== 'core.historico_compra') return linhas;
  return (await usuarioVePedidos(ctx, db)) ? linhas : ocultarHistorico(linhas);
  ```
- `modules/core/api/clientes.ts:95` passa a ser `const comHistorico = await usuarioVePedidos(ctx, db);`.
- Sai o import de `perfilRecebeHistoricoDeCompra` em `sync.ts:52` e `clientes.ts:20`. A função fica no domain, porque `documentos-cliente.ts:164` a usa com o perfil real.

## RD-3741: "é promotor?" e "tem `pedido.ver`?" do SDK copiados no domain do core (código, média, modulo-core, #854)
- `modules/core/domain/promotor-pedidos.ts:24-42` (`5785a719`) traz 3 cópias:
  - `UsuarioDaRequisicaoPedidos` copia o formato de `ctx.usuario` (`perfil`, `perfil_acesso`), que o SDK já tem (`PerfilDaRequisicaoV2`);
  - `requisicaoDePromotor` copia `promotorNaRequisicao` (`packages/platform-sdk/src/acesso-por-cargo.ts:97`, PR 2 `37d2417b`), e o próprio comentário diz "mesma regra do SDK `promotorNaRequisicao`". Com o PR 2 no `main`, a mesma regra fica em 3 lugares, contando o `sync.ts:405` do SDK (RD-3733);
  - `'pedido.ver' in u.perfil_acesso.permissoes` refaz `podePeloCargo(perfil_acesso, 'pedido.ver')` (`perfis-por-cargo.ts:255`, já no SDK deste head), mas sem a trava do cargo (`vetadaPeloCargo`).
- **Impacto: manutenção.** Quando a regra de promotor mudar (fase 2 da ADR 0073), vai ser preciso mudar o SDK e o core juntos. O teste `promotor-pedidos.test.ts:62` prova uma cópia ("igual ao SDK"), não a regra.
- **Proposta (com o PR 2 no `main`, ou com o `37d2417b` no branch):**
  ```ts
  import { podePeloCargo, promotorNaRequisicao, type Perfil, type PerfilDaRequisicaoV2 } from '@macuxi/platform-sdk';

  /** ADR 0073 §2.4: só o promotor depende; em `concessao` vale `pedido.ver` do perfil, em `legado` o parâmetro `promotor_ve_pedidos`. */
  export function usuarioDaRequisicaoVePedidos(u: { perfil?: Perfil; perfil_acesso?: PerfilDaRequisicaoV2 }, parametroLigado: boolean): boolean {
    if (!promotorNaRequisicao(u)) return true;
    return u.perfil_acesso ? podePeloCargo(u.perfil_acesso, 'pedido.ver') : parametroLigado;
  }
  ```
  Saem `UsuarioDaRequisicaoPedidos` e `requisicaoDePromotor`. Em `api/promotor-pedidos.ts:26`, fica `!u.perfil_acesso && promotorNaRequisicao(u)`. No teste, sai o caso de `requisicaoDePromotor` (o SDK já o prova em `acesso-por-cargo.test.ts`), e o título do describe passa a "RN-PRO-01 / ADR 0073 §2.4: quem lê pedidos na requisição".

## Conferido sem achado
- **`SEM_CONEXAO` e `ehSemConexao` da lib:** o SDK tem um `ehSemConexao` (`ambiente.ts:60`), mas ele só reconhece o `ErroSemConexao` do app. O da lib reconhece a falha do `fetch` da web (`TypeError`, ou status 0), e nada no SDK web faz isso. O texto é das 2 telas dos perfis e fica num lugar só. O "Sem conexão com o servidor…" do portal (`apps/web/lib/portal-api.ts:35`) é de outro dono e de outra superfície, e fica fora deste lote.
- **`SeletorDeOrigem`:** é um componente só, nas 2 telas. O vazio de cada tela é diferente e diz a ação de cada uma ("Começar sem permissões" × "Escolha um perfil…"), por isso fica.
- **`MENSAGEM_PERFIS_NAO_MIGRADOS`:** segue o padrão de `MENSAGEM_PERFIL_REPETIDO`, em contracts. A tela não o importa: mostra o texto da API.
- **`usuario-perfis.ts:50-57` (`conferirPerfisDoUsuario` em `concessao`):** usa `carregarEstadoV2`, `conferir` e `licencasDoTenant`, que agora são exportados de `perfis-v2.ts`, e não refaz nada. A troca do usuário na lista (`some` e `map`) aparece 2 vezes na mesma função, uma por motor, e a de `legado` sai na fase 2. Fica `manter?`.
- **`tenantEmConcessao`:** é a consulta que já existia em `exigirTenantMigrado`, separada para o uso novo. Não foi refeita.
- **`perfis-v2.db.test.ts:481-489`:** monta `perfil_acesso` com `resolverPerfilPeloCargo` do SDK, como a API faz. Não refaz a regra.

## Recados
Nenhum recado foi gravado: a CLI `coord.mjs` ficou com HTTP 403 do repositório de recados nesta sessão. O gerente repassa o RD-3734 (reaberto) e o RD-3741 ao modulo-core.

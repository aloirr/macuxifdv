# Permissões por perfil de acesso (ADR 0033)

> Dono: engenheiro-software. Código: `packages/platform-sdk/src/permissoes-perfil.ts` (chaves, fábrica, `pode`, limites).
> Valor de fábrica = o abaixo (plataforma) + o `perfis` de cada ação do manifesto do módulo (`acoes`, ADR 0004).
> O tenant muda pela página Perfis de acesso do BKO (só o que mudou fica no banco). Mudar um valor de fábrica de chave existente
> muda os tenants que não a sobrepuseram: avise todos e registre aqui.
> Ninguém compara perfil com nome fixo: consulte `pode(ctx.usuario.perfis, chave, alvo?)` ou declare `acao` na rota.

## Chaves da plataforma (módulo dono: core)

| Chave | Área | Valor | Fábrica | Limite travado |
|---|---|---|---|---|
| `acesso.campo` | acesso | sim/não | vendedor, promotor | — |
| `acesso.gestao` | acesso | sim/não | supervisor, gerente | — |
| `acesso.bko` | acesso | sim/não | gerente, analista, assistente, admin | nunca em base vendedor/promotor/supervisor (RN-CORE-33) |
| `acesso.portal` | acesso | sim/não | admin | só base admin (RN-CORE-33) |
| `dados.escopo` | dados | nível escopo | carteira (vendedor, promotor), equipe (supervisor), equipes_abaixo (gerente), tenant (analista, assistente, admin) | nunca acima do da base (RN-CORE-04) |
| `usuario.criar` | usuarios | sim/não | admin | gestão do último admin (RN-CORE-35, proposta) |
| `usuario.editar` | usuarios | sim/não | admin | idem |
| `usuario.desativar` | usuarios | sim/não, nunca no próprio | admin | idem |
| `senha.redefinir` | usuarios | alvos (códigos de perfil ou `*`) | admin: `*` | nunca o próprio nem perfil de base admin (P7) |
| `perfil.gerir` | usuarios | sim/não | admin | gestão do último admin |

## Limites de tenant (validarAcessoDoTenant, em toda escrita)
- 7 perfis de fábrica presentes e ativos; base do personalizado imutável; código único.
- Todo usuário com ao menos um perfil ativo (RN-CORE-01).
- Sempre um usuário ativo com perfil de base admin, `acesso.bko` e a gestão (`perfil.gerir`, `usuario.criar|editar|desativar`); quem a tem não a tira de si.
- Multiperfil: união; RN-CORE-33 e RN-PRO-01 pela regra mais restritiva (basta um perfil do usuário).

## Ações dos módulos
As do `acoes` de cada `modules/<m>/manifest.ts`, agrupadas por área (`areaDaAcao`). Níveis por ação (pedido, aprovar, metas) entram quando o desenho da página for aprovado.

### Rastreamento (T-0156, ADR 0061, desenho `docs/desenho/tracking.md` §6; a declarar pelo modulo-core no manifesto)
As 3 ações (`trajeto.ver_equipe`, `rastreamento.configurar` e `ausencia.cadastrar`), os perfis de fábrica e o que cada uma deixa ver estão no desenho, §6 (fonte única). A área de cada uma vem do `areaDaAcao` do platform-sdk.

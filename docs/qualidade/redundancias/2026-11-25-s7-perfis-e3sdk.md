# Redundâncias — Perfis pelo cargo, E3 do SDK (S7, 25/11/2026, manhã de Manaus)

Escopo: commit `15a9e0a` (engenheiro-software, ADR 0073 E3, 1 commit sobre a E1): `packages/platform-sdk/src/{acesso-por-cargo.ts (+test), acesso.ts, api.ts, permissoes.ts, index.ts}`, `packages/config/{regras/perfil-fixo.mjs, perfil-fixo.test.ts, eslint.mjs}`, `apps/api/test/acesso-por-cargo.test.ts`. Convivência com o motor antigo até a E6 aceita (as funções `*PeloCargo` e o motor antigo lado a lado não são RD).

**Parecer: NÃO LIBERADO em 15a9e0a** (RD-3098, RD-3099 e RD-3700 seguram; RD-3701 é só teste, baixa, não segura).

## RD-3098 — RN-PRO-01 pelo cargo escrita duas vezes, e "veto + concessão" repetido em 3 lugares (código, média)
- `cargo === 'promotor' && ehAcaoDeEscritaDePedido(...)` está em `vetadaPeloCargo` (`permissoes.ts`, novo) e em `travaDaChavePeloCargo` (`perfis-por-cargo.ts:186`, E1).
- O par `vetadaPeloCargo(x, p.cargo) || !podePeloCargo(p, x)` aparece 3 vezes: `criarPermissoes().pode` (`permissoes.ts:97-102`), `verificarAcaoPeloCargo` (`permissoes.ts:178`) e `exigirPermissaoPeloCargo` (`acesso-por-cargo.ts:97`).
- Correção: mover `vetadaPeloCargo` para `perfis-por-cargo.ts` (exportada de lá); em `travaDaChavePeloCargo`, `if (vetadaPeloCargo(chave, cargo)) return { regra: 'RN-PRO-01', ... }`; em `podePeloCargo`, trocar `const v = perfil?.permissoes[chave]; if (!v) return false;` por `if (!perfil || vetadaPeloCargo(chave, perfil.cargo)) return false; const v = perfil.permissoes[chave]; if (!v) return false;`. Os 3 chamadores ficam só com `podePeloCargo(...)` (`pode`: `[...ctx.modulosAtivos].includes(def.modulo) && podePeloCargo(ctx.perfilAcesso, acao)`; `verificarAcaoPeloCargo`: `if (!podePeloCargo(usuario.perfil_acesso, acao)) return SEM_ACESSO;`; `exigirPermissaoPeloCargo`: `if (!podePeloCargo(usuario.perfil_acesso, chave, alvo)) throw ...`). A barreira em profundidade continua (o veto vale mesmo com perfil montado à mão), num lugar só. O teste importa `vetadaPeloCargo` de `./perfis-por-cargo`.

## RD-3099 — resposta 403 e licença do módulo reescritas (código, média)
- `SEM_ACESSO` nasce em `permissoes.ts:136`, mas `acesso-por-cargo.ts:70-75` recria o mesmo objeto (`semAcesso`) e `permissoes.ts:158` (ao lado da constante) mantém o literal.
- `verificarLicenca` (`permissoes.ts:183-188`) repete o 401 e o 403 `MODULO_INATIVO` com a mesma mensagem de `verificarAcesso` (`acesso.ts:59-62`).
- Correção: exportar `SEM_ACESSO` de `permissoes.ts`; em `acesso-por-cargo.ts` apagar `semAcesso` e usar `SEM_ACESSO`; em `permissoes.ts:158`, `return SEM_ACESSO;`. Mover `verificarLicenca` para `acesso.ts` e fazer `verificarAcesso` começar por `const lic = verificarLicenca(usuario, regra.modulo); if (!lic.ok) return lic;` (as linhas 59-62 saem). Mensagens e códigos ficam num lugar só e sobrevivem à E6 (sem depender de `usuario.perfil`).

## RD-3700 — duas portas para o mesmo caminho novo (código, média)
- `verificarAcao(..., { motor: 'cargo' })` só chama `verificarAcaoPeloCargo`; fora do teste que confere o próprio atalho (`acesso-por-cargo.test.ts:207-220`), ninguém usa a opção, e a ADR 0073 não a pede.
- Correção: tirar o parâmetro `opcoes` e a linha `if (opcoes.motor === 'cargo') ...` de `verificarAcao`; o JSDoc volta a "Verificação da API para uma ação: autenticação → licença do módulo → perfil (mesma ordem de `verificarAcesso`)."; no cabeçalho de `permissoes.ts`, a lista fica "(`verificarAcaoPeloCargo`, `ContextoPermissao.perfilAcesso`)"; apagar o teste das linhas 207-220. `MotorPermissao` e `motorDePermissao` ficam (a E4 escolhe a função pelo motor).

## RD-3701 — equivalência dos 7 perfis testada duas vezes (teste, baixa; não segura, R-20261111-190159)
- `acesso-por-cargo.test.ts:185-205` (SDK, 3 manifestos de mentira e 9 ações) repete o laço `verificarAcaoPeloCargo(...).ok === verificarAcao(...).ok` + `diferencasEntreMotores(...) == []` de `apps/api/test/acesso-por-cargo.test.ts:104-113`, que roda o mesmo laço em todas as chaves dos módulos instalados.
- Correção: apagar o `it('equivalência: ...')` do SDK (a cobertura de regra do SDK já está nos testes de RN-PRO-01, RN-CORE-02 e leitura dupla do mesmo arquivo). Lote seguinte.

## Conferido sem achado
- `autorizarRotaPeloCargo`: reaproveita `promotorBarradoNaRota`, `verificarLicenca` e `verificarAcaoPeloCargo`; a regra BKO (RN-CORE-33) só consulta `acesso.bko`, que `resolverPerfilPeloCargo` (E1) já trava pelo cargo: sem cópia da lista `CARGOS_SEM_BKO`.
- `camposPeloCargo` delega a `resolverPerfilPeloCargo`; `cargo` ao lado de `perfil_acesso.cargo` é o campo da ADR 0073 §2.8 (`manter`: hierarquia × permissão, comentado como sempre igual).
- `diferencasEntreMotores` usa `combinarPerfis` da E1; `moduloDaAcao` usa `definicao` existente.
- `perfil-fixo.mjs`: a lista `NOMES_DE_PERFIL` repete `PERFIS` do SDK, mas o `packages/config` não pode importar o SDK (`manter`). O bloco do ESLint e a junção do plugin `macuxi` não repetem configuração.
- `apps/api/test/acesso-por-cargo.test.ts`: o teste de rotas e o de RN-PRO-01/RN-CORE-33 nas rotas reais cobrem casos distintos.
- Exports novos (`camposPeloCargo`, `autorizarRotaPeloCargo`, `exigirPermissaoPeloCargo`, `diferencasEntreMotores`, `motorDePermissao`, `verificarLicenca`, `moduloDaAcao`): uso previsto na E4/E6; só a opção `motor` não tem (RD-3700).

## Reteste do SDK em b8c88d6 (25/11, manhã de Manaus) — **LIBERADO**
- RD-3098 corrigido: `vetadaPeloCargo` em `perfis-por-cargo.ts`, usada por `travaDaChavePeloCargo` e no início de `podePeloCargo`; `pode`, `verificarAcaoPeloCargo` e `exigirPermissaoPeloCargo` só com `podePeloCargo`.
- RD-3099 corrigido: `SEM_ACESSO` exportado e usado em `acesso-por-cargo.ts` e `verificarAcao`; `verificarLicenca` em `acesso.ts`, chamada por `verificarAcesso`.
- RD-3700 corrigido: `verificarAcao` sem `opcoes`, JSDoc e cabeçalho sem o atalho, teste apagado. RD-3701 corrigido: teste de equivalência do SDK apagado.
- `PENDENTES_DA_E6` (20 rotas) com `toEqual` de igualdade: troca o filtro por uma comparação só, sem repetir a lista. Sem achado novo. As mudanças em `tests/modulos/**` no diff contra 15a9e0a vêm do `main` (o commit não toca `tests/`).

## E3 do core em 90fe8ba (modulo-core; antes 44ee92f LIBERADO) — **NÃO LIBERADO**
Delta: `aplicarCopiarDe(origem, cargo, fontes)` chama `resolverPerfilPeloCargo` do SDK + 3 testes (RN-PRO-01, RN-CORE-33, RN-CORE-04), sem repetição entre si nem com os do SDK (aqui é a cópia; lá, a resolução).

### RD-3702 — cópia feita duas vezes (código, média)
- `aplicarCopiarDe` passa `copiar(base)` a `resolverPerfilPeloCargo`, que já monta um objeto novo chave a chave com o mesmo laço (`{ ...(v.nivel ? { nivel } : {}), ...(v.alvos ? { alvos: [...v.alvos] } : {}) }`, `packages/platform-sdk/src/perfis-por-cargo.ts:218-219`). `copiar` (`modules/core/domain/perfis-cargo.ts:69-72`) fica sem outro uso.
- Correção: apagar `const copiar = ...` e trocar a última linha por `return { ok: true, permissoes: resolverPerfilPeloCargo({ codigo: '', cargo, permissoes: base }).permissoes };`. O teste "sem vínculo com a origem" (`not.toBe`) continua passando.

### `ChaveDoCatalogo` em dois lugares (nota do testes) — `manter` até a E5
- `modules/core/web/lib/acesso.ts:173` (interface local, já no `main`, forma da grade antiga lida de `PerfilDetalhe.chaves`) e `modules/core/contracts/perfis.ts:150` (novo, `GET /v1/core/permissoes/catalogo`, com `disponivel` e `motivo`). Mesmo nome, formas e rotas diferentes, sem import cruzado: é a convivência antigo × novo aceita até a troca. Quando a tela passar ao catálogo novo (E5), a interface local sai e `linhasPorModulo` usa o tipo do contrato; se a E5 não a tirar, vira RD.

## Reteste do core em 2fc6078 (25/11, manhã de Manaus) — **LIBERADO**
- RD-3702 corrigido: `copiar` apagada; `aplicarCopiarDe` passa `permissoes: base` a `resolverPerfilPeloCargo`.
- Teste novo "a origem não é mutada pela cópia (nem pelo teto do cargo)": cobre a origem intacta; o `not.toBe` existente cobre o resultado sem vínculo. Casos diferentes, sem repetição. 9 testes verdes na sessão. Sem achado novo.

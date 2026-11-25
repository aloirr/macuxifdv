# Redundâncias — Perfis pelo cargo, E4 da API (S7, 25/11/2026, noite de Manaus)

Escopo: commit `9a1b03d` (engenheiro-software, ADR 0073 E4, 1 commit sobre `4b69db0a8`): `apps/api/src/{licencas.ts, app.ts, tipos.ts}`, testes `motor-permissao.test.ts`, `perfis-motor.banco.test.ts`, `super-admin.test.ts`.

**Parecer: NÃO LIBERADO em 9a1b03d** (RD-3712 segura; RD-3713 a RD-3715 são só teste, baixa, lote seguinte — R-20261111-190159).

## RD-3712 — comentário cita constante de teste que sai (doc, baixa)
- `app.ts:831-832`: "a rota sem `acao` com lista `perfis` própria ainda não tem chave no catálogo (`PENDENTES_DA_E6` do teste acesso-por-cargo) e o cargo não a abre sozinho". O 2481442 (fim da transição) apaga `PENDENTES_DA_E6`.
- Correção: "a rota sem `acao` com lista `perfis` própria ainda não tem chave no catálogo e o cargo não a abre sozinho: vale também a lista de hoje."

## RD-3713 — equivalência dos modelos testada de novo pela rota (teste, baixa)
- `motor-permissao.test.ts:110-129` (4 modelos × 5 rotas, status igual nos dois motores, sem log) repete `acesso-por-cargo.test.ts:102-131` (7 modelos, todas as chaves e rotas, `diferencasEntreMotores` vazio). A ligação no `montarRota` já está nos `it` de concessão desmarcada, RN-PRO-01, RN-CORE-33 e leitura dupla segura.
- Correção: apagar o `it('leitura dupla: os modelos dão o mesmo resultado ...')`.

## RD-3714 — escolha do motor conferida duas vezes (teste, baixa)
- `motor-permissao.test.ts:94-96`: `V1` e `null` pela rota (201) repetem `motorDoTenant(V1)`/`(null)` = 'base' de `:83-90`.
- Correção: no `it` da concessão desmarcada, ficar só com `expect((await criarPedido(montar(LEGADO, vendedorSemCriar).app, 'vendedor')).statusCode).toBe(201);`.

## RD-3715 — log da divergência conferido no teste de banco (teste, baixa)
- `perfis-motor.banco.test.ts:126-145` confere o log (`perfis.motores_divergem`, chaves, perfil, sem o id) já garantido sem banco em `motor-permissao.test.ts:131-137`; o "sem divergência" do intacto já está no `it` 1 do mesmo arquivo (`diferencasEntreMotores` vazio para todo usuário). O valor do teste de banco é o 403/201 vindo do Postgres.
- Correção: título "ponta a ponta: concessão desmarcada recusa no 'cargo' (403) e não muda o 'legado' (201)"; `montar` sem `Writable`, `linhas`, `logger` (devolve o app); apagar `expect(intacto.linhas...)`, `const log = ...`, `expect(log)...` e `expect(migrado.linhas...)`; imports `Writable` e `opcoesLogger` saem.

## Conferido sem achado
- `plataforma.perfil_do_usuario`: não existe em `db/` nem no `origin/main`; `lerPerfilPorCargo` não repete função do banco (o comentário já diz que faz o papel dela até a publicação). `concessoesDe` é a única leitura de `perfil_concessao` no código; reaproveita `ehNivel` do mesmo arquivo.
- `autorizarPeloCargo` × SDK: delega a `autorizarRotaPeloCargo` (licença, BKO, RN-PRO-01, ação) sem copiar regra; a chamada extra a `verificarAcesso` é a leitura dupla segura da ADR (transitória). A licença roda de novo dentro do SDK (`verificarLicenca`, uma função só): repetição de chamada, não de regra — `manter?` até a E6 tirar o passo 1 do motor antigo.
- `motorDoTenant` só traduz a marca para `motorDePermissao`; `adminDoModelo` reaproveita `modelosDePerfil`; `catalogo` em `LicencasTenant` e `LicencasUsuario` vem do mesmo `lerTenant`.
- `super-admin.test.ts`: caso do super-admin no 'cargo' não repete os outros.

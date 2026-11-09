# Revisão final — T-0117 (BKO: refresh em cookie httpOnly) e sobras do Core — engenheiro-software

- **Data**: 2026-11-09 · **Base**: ADR 0038, desenho `docs/desenho/T-0117.md` v2; `git diff origin/main` + arquivos novos em
  `apps/api/src/sessao-web.ts`, `packages/platform-sdk/src/{cookie-sessao.ts,web/session.ts,web/api.ts}`, `modules/core/api/index.ts`,
  `modules/core/contracts/auth.ts`, `apps/web/{lib/session.ts,components/login-screen.tsx,components/app-shell.tsx}`
- **Entregas revisadas**: engenheiro-apps R-20261109-134534 e R-20261109-134941 (BKO), modulo-core (as 4 rotas e os schemas web),
  testes R-20261109-140052 (o smoke da demo), e a minha parte na API e no SDK
- **Veredito T-0117: APROVADA sem 🔴.** 1 🟡 (gerente-projetos, roteiro de publicação) e 1 🟢 (meu).
- **Veredito sobras do Core (datas impossíveis e `novoId`/GPS, RD-0046): APROVADA sem achado.**

## O que foi conferido (T-0117)

| Ponto | Resultado |
|---|---|
| Token fora do `localStorage` | `@macuxi/platform-sdk/web`: acesso no `sessionStorage` com a cópia do usuário; o refresh nunca é guardado (`saveSession` ignora o 3º parâmetro); migração apaga `macuxi.web.refresh`/`macuxi.web.token`. `apps/web`: o único `localStorage.setItem` é o código da empresa (`login-screen.tsx:116`); `getRefreshToken` saiu |
| Token fora do log | `CAMINHOS_REDIGIDOS_LOG` (`apps/api/src/config.ts`) cobre `cookie`, `set-cookie` (pedido e resposta) e `refresh_token`/`*.refresh_token`; teste em `apps/api/test/sessao-web-cookie.test.ts` |
| Cookie | `__Secure-macuxi_rt` (sem `Secure` só no PC), host-only, `Path=/api-proxy/auth`, `HttpOnly`, `SameSite=Strict`, `Max-Age` = 30 dias (teto de 90); o valor fora do formato lança erro (nunca injeta atributo) |
| CSRF | `X-Macuxi-CSRF: 1` liga o modo; valor diferente ou `Sec-Fetch-Site` `same-site`/`cross-site` = 403 `CSRF_RECUSADO` antes de validar e de contar tentativa; sem o cabeçalho o cookie nunca é lido. A API não tem CORS (grep sem `cors`/`access-control`) |
| Rotação e encerramento | `renovar` grava o cookie girado e apaga com 401/423; `encerrar` apaga sempre; logout sem cookie responde `{}` sem chamar o Core; troca de senha emite cookie novo (as famílias antigas já foram revogadas, ADR 0032) |
| App Android | Não manda o cabeçalho → corpo de sempre, sem `Set-Cookie`. Schemas do app (`SessaoRespostaSchema`, `RefreshRespostaSchema`) sem mudança |
| Contrato do Core | `SessaoWebRespostaSchema`/`RefreshWebRespostaSchema` = `.omit({ refresh_token })` dos estritos (o Zod 3 mantém o `strict` no `omit`): uma resposta com token no corpo é recusada no BKO. Teste `modules/core/api/sessao-web-cookie.test.ts` confere o papel das 4 rotas |
| Plataforma | `cookieSessao` só no manifesto `core`, só `POST`, sem `cache`/`conexao` (`problemasCookieSessao`, conferido na subida) |
| Multiaba | `navigator.locks` (`macuxi-refresh`) + uma renovação por aba; aba nova com usuário e sem token restaura pelo cookie |
| Demo (mock-api) | `LoginDemo` separado; `sessaoWeb` ignorado fora do modo `v1` |

## Achados (T-0117)

### 🟡 G1 — gerente-projetos — publicar a API (com o Core) antes do BKO, ou no mesmo `compose up`
- O BKO novo valida a resposta com o schema web estrito.
- **BKO novo + API antiga:** a API ignora o cabeçalho e devolve o `refresh_token` no corpo, e o login do BKO é recusado. A falha é visível e segura, mas derruba o BKO.
- **API nova + BKO antigo:** funciona. Fica sem a renovação, então o usuário entra de novo a cada 15 min até o BKO subir.
- **Roteiro:**
  1. Imagem da API (que já leva o Core) antes ou junto da do BKO.
  2. Depois do deploy, o smoke `tests/scripts/bko-cookie-demo.mjs` (testes).
  3. No recado de publicação, avisar que cada usuário do BKO entra de novo uma vez.

### 🟢 G2 — engenheiro-software (meu) — restauração trata a falta de rede como recusa
`packages/platform-sdk/src/web/session.ts` (`restaurarSessao`): se o `renovarAcesso` falha por rede (e não por 401), a aba limpa a
sessão e volta ao login, e o cookie ainda vale. **Melhoria:** separar recusa (401/423, limpa) de falha de rede (mantém o usuário e tenta
de novo no próximo foco). Não é risco de segurança.

## Sobras do Core

| Item | Resultado |
|---|---|
| Datas impossíveis | `modules/core/contracts/rota.ts:6` e `visita.ts:61`: `regex` + `refine(ehDataCivil)` do `@macuxi/comum/calendar`, mensagem em português; testes `tests/integracao/api/datas-invalidas-t0140.test.ts` e `tests/modulos/t0140-lote03-datas-invalidas.test.ts` |
| `novoId` e GPS (RD-0046) | `modules/core/app/lib/acoes-visita.ts:51/56/99/101` usam `ambiente.novoId()`/`ambiente.posicaoAgora()`; `dispositivo.ts` (cópia do GPS) apagado; o shell liga `posicaoAgora` em `apps/mobile/src/services/ambiente.ts:39`; o padrão do SDK (`semPosicao`) devolve `null`. Política RN-CORE-10 mantida (sem a posição do cliente como reserva) |
| `formatarCep` ambíguo no mock-api | `apps/mock-api/src/legado/dominio.ts` reexporta o do comum (pedido R-20261109-112736): resolvido no working tree |

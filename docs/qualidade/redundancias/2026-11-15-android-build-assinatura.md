# PR #325 · leitura do certificado do apksigner 36/37 · parecer do corretor-redundancias

**Veredito: COM ACHADO.** São 3 achados, todos de gravidade baixa (RD-0486 a RD-0488), e todos do engenheiro-software:
- RD-0486 e RD-0487 estão em código de CI e **seguram** o PR;
- RD-0488 está só em comentário e **não segura**, pela regra de 11/11 (R-20261111-190159).

Corretor-redundancias, 15/11/2026 (Manaus). Conferi o PR #325, branch `nuvem/android-build-assinatura-engenheiro-software`, commit **4b32919**, pelo diff contra o `origin/main` (`.github/workflows/android-build.yml`, `scripts/ci/android-build.mjs`, `scripts/ci/android-build.test.mjs`).

## 1. O que foi pedido
| Ponto | Resultado |
|---|---|
| Lógica repetida entre o shell e o `.mjs` | Toda a leitura (o debug, o SHA-256, os assinantes, o esperado) saiu do shell e foi para `certificadoDoApk`. A conferência é uma só, como devia ser. Sobra uma regra em 2 lugares: a recusa do APK que não verifica (**RD-0486**). |
| Resumo duplicado | O `$GITHUB_STEP_SUMMARY` é escrito uma vez só, no passo "resumo do APK". No log, porém, o SHA-256 sai 2 ou 3 vezes (**RD-0487**). O comentário do workflow repete a documentação do `.mjs` (**RD-0488**). |

## 2. Achados
### RD-0486 · baixa · código · engenheiro-software · segura
- **Onde:** `android-build.yml`, passo "conferir assinatura" (`if ! CERTS="$(… apksigner verify …)"; then printf …; ::error …; exit 1`), e `android-build.mjs`, função `certificadoDoApk` (`if (/DOES NOT VERIFY/.test(texto)) throw …`), com o teste próprio em `android-build.test.mjs` (`'DOES NOT VERIFY\nERROR: …'`).
- **O que se repete:** o apksigner sai com código diferente de 0 quando o APK não verifica, e o shell já para nesse caso, com a saída e o `::error`. A regra do `.mjs` diz o mesmo e não roda nunca no workflow: é um caminho morto com teste próprio.
- **Proposta:** a regra fica num lugar só, o código de saída do apksigner no shell, que é o sinal da própria ferramenta. Saem a linha `DOES NOT VERIFY` do `certificadoDoApk` e a asserção dela no teste. O JSDoc diz "Lança Error com o motivo"; os outros motivos continuam lá.

### RD-0487 · baixa · texto (log do CI) · engenheiro-software · segura
- **Onde:** `android-build.mjs`, o modo `certificado`: `for (const l of c.linhas) console.log(l)` seguido de `console.log(\`SHA-256 do certificado: ${c.sha} (${c.conferido})\`)`.
- **O que se repete:** `linhas` traz o DN e também a linha "certificate SHA-256 digest" de cada assinante, e depois vem a linha do SHA-256 com o resultado. No build-tools 37 (blocos V2 e V3), o mesmo hash sai 3 vezes no log; no 36, 2 vezes.
- **Proposta:** o log mostra o DN de cada assinante e uma linha só com o SHA-256 e o resultado. Filtrar `linhas` por ` certificate DN: ` na hora de escrever, ou o `certificadoDoApk` devolver `dns` no lugar de `linhas`. Depois:
  ```
  V2 Signer: certificate DN: CN=…
  V3.0 Signer: certificate DN: CN=…
  SHA-256 do certificado: <hex> (igual ao esperado)
  ```
  O teste `certificado: lê o SHA-256…` passa a conferir só as linhas de DN.

### RD-0488 · baixa · comentário · engenheiro-software · não segura
- **Onde:** `android-build.yml`, o comentário de 4 linhas antes de "conferir assinatura" (formatos 36 e 37, "Signer #1 certificate …"/"V2 Signer: certificate …", debug, assinantes diferentes, SHA-256 esperado).
- **O que se repete:** é o mesmo conteúdo do JSDoc de `certificadoDoApk` e do cabeçalho do `.mjs`. Quando o formato mudar de novo, vai ser preciso atualizar os 2.
- **Proposta:** "Só o DN e o SHA-256 (públicos) vão ao log, e o SHA-256 vai ao resumo. A conferência (formatos do apksigner e motivos de vermelho) é do `scripts/ci/android-build.mjs certificado`."

## 3. Conferido sem achado
- O `::error` aparece uma vez por falha: no shell, quando o apksigner falha; no `.mjs`, quando a leitura recusa.
- A normalização do esperado (sem `:`, sem espaço, em minúsculas) agora fica só no `.mjs`; a cópia do shell saiu.
- O teste antigo `apksigner" verify --print-certs` saiu e entrou um mais preciso; os casos de teste não se repetem.

## 4. Reteste (15/11/2026, commit 69a23c2 do engenheiro-software)
**Veredito: LIMPO.** Os 3 achados estão corrigidos e não há achado novo.

| RD | Situação | Evidência |
|---|---|---|
| RD-0486 | **corrigido** | A linha `/DOES NOT VERIFY/` saiu do `certificadoDoApk`, e o caso dela saiu do teste, inclusive do título. A recusa do APK que não verifica fica só no shell (`if ! CERTS=…; then … exit 1`). `git grep "DOES NOT VERIFY"` não acha nada no `.mjs` nem no workflow. |
| RD-0487 | **corrigido** | O `certificadoDoApk` devolve `dns` no lugar de `linhas`. O log mostra o DN de cada assinante e uma linha com o SHA-256 e o resultado, ou seja, o hash sai uma vez só. O teste confere que `dns` só traz linhas de DN, e o cabeçalho do `.mjs` diz o mesmo. |
| RD-0488 | **corrigido** | O comentário do workflow ficou com 2 linhas: "Só o DN e o SHA-256 (públicos) vão ao log, e o SHA-256 vai ao resumo. A conferência (…) é do scripts/ci/android-build.mjs certificado." Os formatos e os motivos de vermelho ficam só no `.mjs`. |

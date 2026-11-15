# "Esqueci a senha" — matriz de testes (R-20261114-204500-alexandre)

Pedido do dono do produto (14/11/2026, ~20h45 de Manaus): "Esqueci a senha deixe como está. Só garanta que está funcionando."
Base: T-0094, ADR 0032, RN-CORE-32/34; rota `POST /v1/auth/senha/esqueci` (`ROTA_ESQUECI_SENHA`, `modules/core/contracts/auth.ts`),
`modules/core/api/autenticacao.ts` (`esqueciSenha`), e-mail `nova_senha` motivo `esqueci` (`packages/platform-sdk/src/email/modelos.ts`).
Sem mudança de código de produção. Testes de banco rodam só no CI (`stack-isolado.yml`); na sessão: lint, `typecheck:tests` e o
arquivo carregando (pula sem banco).

## Cobertura que já existia

| Cenário | Onde |
|---|---|
| 202 `{}` idêntico: existe, não existe, inativo, bloqueado pelo admin, outra empresa, empresa inexistente | `tests/integracao/api/ciclo-senha-t0094.test.ts` CS-05; `modules/core/api/senha-acesso.test.ts` |
| mesmo custo (um hash) exista ou não o usuário | `senha-acesso.test.ts` |
| e-mail `nova_senha`/`esqueci` na outbox, auditoria sem dado pessoal | CS-05; `senha-acesso.test.ts` |
| temporária paralela (a atual continua valendo; entrar com a atual descarta a temporária) | CS-05 (P6); `senha-acesso.test.ts` |
| login com a temporária = 403 `SENHA_A_TROCAR`; "Crie sua senha" com ela derruba sessões; temporária e antiga = 401 | CS-05; `senha-acesso.test.ts` |
| vencida: 71 h 59 vale, 72 h = 410 (relógio injetado) | CS-04; `senha-acesso.test.ts` |
| 15 min sem repetir; limite 3/h por código + e-mail e 5/15 min por IP (429 igual para quem existe ou não) | CS-05; `senha-acesso.test.ts` |
| multi-tenant (mesmo e-mail em A e B) | CS-05 |
| sem e-mail configurado: mesma resposta, nada gravado | `senha-acesso.test.ts` |
| texto do e-mail `esqueci` (abertura, fecho "a sua senha atual continua valendo") | `packages/platform-sdk/src/email/modelos.test.ts` |
| telas: validação, erros (sem internet, 429), chamada `/auth/senha/esqueci`, confirmação neutra | `modules/core/app/lib/senha.test.ts` (app); `apps/web/lib/ciclo-senha.test.ts` (BKO) |
| senha em claro só no `.eml` (nunca em log, evento, auditoria, colunas da outbox) | CS-09 |

## Casos novos — `tests/integracao/api/esqueci-senha-jornada.test.ts` (CI)

| Id | Cenário | Esperado |
|---|---|---|
| EJ-01 ×3 | jornada inteira no Campo (vendedor), Gestão (supervisor) e BKO (analista); código e e-mail digitados em maiúsculas e com espaços | 202 `{}`; a OUTBOX (carga decifrada) leva código canônico, login, 72 h, app certo e a mesma senha; e-mail renderizado com código, e-mail e senha; login com ela = 403 `SENHA_A_TROCAR` (`expira_em` = validade gravada) sem sessão nem último login; "Crie sua senha" = 200; login normal com a nova = 200 e token vale; temporária e antiga = 401 com o mesmo corpo de quem não existe |
| EJ-02 | dados inválidos (código com caractere proibido, vazio, sem e-mail, campo a mais) | 400 `VALIDACAO` com corpo igual para e-mail que existe e que não existe; nada gravado nem enviado |
| EJ-03 | temporária vencida → pedir outra | 410 `SENHA_TEMPORARIA_VENCIDA` no login e na troca, sem sessão; o novo pedido gera outra senha que entra; a vencida = 401 |
| EJ-04 | senha INICIAL vencida (primeiro acesso) → "Esqueci" | 410 citando "Esqueci a senha"; a temporária do Esqueci leva a "Crie sua senha"; login normal depois; a inicial = 401 |
| EJ-05 | bloqueado por 5 senhas erradas (15 min) → "Esqueci" | o e-mail sai; a temporária = 423 `USUARIO_BLOQUEADO` enquanto dura o bloqueio; depois entra, e a troca zera as falhas |
| EJ-06 | toque duplo: 3 pedidos simultâneos do mesmo usuário | um e-mail só, e a senha que ele leva entra (403 `SENHA_A_TROCAR`) |

EJ-06 é o teste vermelho esperado enquanto o defeito D-01 existir (ver abaixo); passa quando a leitura do usuário no "Esqueci"
for serializada.

## Defeito

**D-01 — pedidos simultâneos geram dois e-mails e o primeiro leva uma senha que não entra.** `modules/core/api/autenticacao.ts`
(`esqueciSenha`, linhas ~320–332) lê o usuário com `usuarioPorEmail` (`modules/core/api/repositorio.ts` ~117, `select` sem
`for update`) e decide pelo intervalo de 15 min com o `senha_temporaria_criada_em` lido; dois pedidos que chegam juntos (toque
duplo no "Enviar", reenvio do app) leem os dois `null`, gravam cada um a sua senha (o segundo sobrescreve o hash) e enfileiram dois
e-mails com chaves diferentes. A pessoa recebe duas senhas e a do primeiro e-mail dá 401. Reproduzir: EJ-06 no CI. Dono:
`modulo-core`.

## Teste manual (aparelho real e navegador)

1. Campo e Gestão: tela de entrada → "Esqueci a senha" → código e e-mail certos → confirmação neutra; o e-mail chega com código,
   e-mail e senha; entrar com ela abre "Crie sua senha"; criar a senha entra direto; sair e entrar com a nova.
2. Repetir com e-mail que não existe: a mesma confirmação, nenhum e-mail.
3. Sem internet: a tela pede para conectar e não some o que foi digitado.
4. BKO (navegador): o mesmo roteiro do item 1 com um analista ou gerente.
5. Tocar duas vezes rápido em "Enviar": conferir quantos e-mails chegam e se a senha do último entra (D-01).

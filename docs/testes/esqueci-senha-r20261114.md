# "Esqueci a senha" — matriz de testes (R-20261114-204500-alexandre)

Pedido do dono do produto (14/11/2026, ~20h45 de Manaus): "Esqueci a senha deixe como está. Só garanta que está funcionando."
Atualizada em 21/11/2026 (v1.0.21) para o fluxo de hoje: layout "Crie a sua senha" e `MACUXI_EMAIL_URL_*` (ADR 0032, adendo de 19/11).
Base: T-0094, RN-CORE-32/34; `POST /v1/auth/senha/esqueci` (`modules/core/contracts/auth.ts`), `esqueciSenha` em
`modules/core/api/autenticacao.ts`, modelo `nova_senha` motivo `esqueci` (`packages/platform-sdk/src/email/modelos.ts`),
`lerConfigEmail` (`apps/api/src/email/config.ts`). Sem mudança de código de produção.

## Cobertura que já existia

| Cenário | Onde |
|---|---|
| 202 `{}` igual para quem existe ou não, inativo, bloqueado pelo admin, outra empresa; limites 3/h e 5/15 min; 15 min sem repetir; temporária paralela; multi-tenant | `tests/integracao/api/ciclo-senha-t0094.test.ts` CS-04/CS-05; `modules/core/api/senha-acesso.test.ts` |
| senha em claro só no e-mail (log, evento, auditoria, colunas da outbox) | CS-09 |
| layout do modelo e leitura das `MACUXI_EMAIL_URL_*` (inválida, sem https em produção) | `packages/platform-sdk/src/email/modelos.test.ts`; `apps/api/src/email/config.test.ts` |
| telas (validação, sem internet, 429, confirmação neutra) | `modules/core/app/lib/senha.test.ts`; `apps/web/lib/ciclo-senha.test.ts` |

## Jornada — `tests/integracao/api/esqueci-senha-jornada.test.ts`

| Id | Cenário | Esperado |
|---|---|---|
| EJ-01 ×3 | Campo (vendedor), Gestão (supervisor) e BKO (analista); código e e-mail em maiúsculas e com espaços | 202 `{}`; a outbox leva código, login, 72 h, `apps` do perfil e a senha gerada; o despachante real, com a configuração lida de `MACUXI_EMAIL_URL_ATIVOS` e `MACUXI_EMAIL_URL_BKO`, grava o `.eml`: assunto "Sua senha temporária do Macuxi", texto inteiro conferido ("Crie a sua senha no app Macuxi Campo / no app Macuxi Gestão / no backoffice", contexto do "Esqueci", código, e-mail, senha, "Vale por 72 horas.", assinatura), logo claro e escuro em `<URL_ATIVOS>/macuxi-logo-*-email.png`, botão "Abrir o backoffice" com o endereço da `MACUXI_EMAIL_URL_BKO` só no BKO; login com a temporária = 403 `SENHA_A_TROCAR` sem sessão; "Crie sua senha" = 200; login normal = 200; temporária e antiga = 401 igual ao de quem não existe |
| EJ-02 | dados inválidos (código com caractere proibido, vazio, sem e-mail, campo a mais) | 400 `VALIDACAO` igual para quem existe e quem não existe; nada gravado nem enviado |
| EJ-03 | temporária vencida → novo pedido | 410 `SENHA_TEMPORARIA_VENCIDA` no login e na troca, sem sessão; a nova entra; a vencida = 401 |
| EJ-04 | senha inicial vencida → "Esqueci" | 410 citando "Esqueci a senha"; a temporária leva a "Crie sua senha"; a inicial = 401 |
| EJ-05 | bloqueado por 5 senhas erradas | o e-mail sai; a temporária = 423 `USUARIO_BLOQUEADO` com `minutos_restantes` enquanto dura; depois entra e a troca zera as falhas |
| EJ-06 | 3 pedidos simultâneos | um e-mail só, e a senha dele leva a "Crie sua senha" (o D-01 de 15/11 foi corrigido: `usuarioPorEmail(email, { travar: true })`) |

## Teste manual (aparelho real e caixa de e-mail)

1. Campo e Gestão: "Esqueci a senha" → código e e-mail certos → confirmação neutra; o e-mail chega com o logo, o título
   "Crie a sua senha no app …", código, e-mail e senha; entrar com ela abre "Crie sua senha"; criar a senha entra direto.
2. BKO: o mesmo com um analista; o botão "Abrir o backoffice" abre o endereço da `MACUXI_EMAIL_URL_BKO`.
3. Caixa em modo escuro (Gmail app, Outlook): o logo negativo aparece; sem `MACUXI_EMAIL_URL_ATIVOS`, só o texto "Macuxi Força de Vendas".
4. E-mail que não existe: a mesma confirmação, nenhum e-mail.

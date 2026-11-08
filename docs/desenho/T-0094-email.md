# Desenho T-0094 — E-mail transacional (acesso inicial e nova senha)

> 2026-11-07 · engenheiro-software · status: **implementado (porta, SDK, cliente SMTP, fila cifrada); não ligado no worker** ·
> frente N5 da nuvem, branch `nuvem/T-0094-email` · regras: RN-CORE-32, RN-CORE-33, RN-CORE-34 (premissas abaixo) ·
> relacionados: RF-CORE-01/02, `docs/modulos/core/usuarios.md`, ADR 0007 (outbox/pg-boss), CLAUDE.md regras 4 e 8.

## 1. Objetivo
Mandar ao usuário, por e-mail, o acesso inicial (ao ser criado) e a nova senha (esqueci a senha ou redefinição pelo BKO), sem
bloquear a rota, com nova tentativa e **sem nenhum e-mail, nome ou senha em log, evento ou job em claro**.

## 2. Premissas (a confirmar pelo gerente)
- `.coord/tarefas/T-0094.md` e RN-CORE-32/33/34 ainda não existem no `main` (o último RN é RN-CORE-31). Assumido:
  - **RN-CORE-32 Acesso inicial.** Ao criar o usuário, e-mail "Seu acesso ao Macuxi" com código da empresa, login e senha
    inicial; a senha vale **72 h** e precisa ser **trocada no 1º acesso**.
  - **RN-CORE-33 Nova senha.** "Esqueci a senha" (pedido do usuário na tela de login) ou redefinição pelo admin no BKO geram o
    e-mail "Sua nova senha" com senha provisória, mesmas regras (72 h, troca no 1º acesso); a senha anterior deixa de valer.
  - **RN-CORE-34 Envio.** Assíncrono, por fila, com nova tentativa; nunca bloqueia nem derruba a rota. Nenhum e-mail, nome ou
    senha em log ou evento; a carga na fila vai cifrada.
- A troca obrigatória e a validade ainda **não têm coluna** em `core.usuario` (`docs/modulos/core/usuarios.md`, pendência 1):
  o e-mail já anuncia a regra; o banco e o login passam a cumpri-la na pendência (d).
- Sem dependência nova (nada de `nodemailer`/`pg-boss` no `package.json` nesta frente): cliente SMTP próprio e adaptador do
  pg-boss por tipo estrutural.

## 3. Onde está
| Camada | Arquivo | O quê |
|---|---|---|
| SDK (puro TS) | `packages/platform-sdk/src/email/modelos.ts` | `ModeloEmailSchema` (`acesso_inicial`, `nova_senha`), `DestinatarioEmailSchema`, `DadosAcessoInicialSchema`, `DadosNovaSenhaSchema` (`motivo`: `esqueci`/`redefinicao_bko`), `PedidoEmailSchema` (discriminado), `renderizarEmail` → `{assunto, texto, html}`, `renderizarEmailParaLog` (marcadores), `renderizarEmailSemSenha`, `valoresSensiveisEmail`, `VALIDADE_SENHA_PROVISORIA_HORAS = 72` |
| SDK | `packages/platform-sdk/src/email/porta.ts` | porta `EnvioEmail`, `ResultadoEnvioEmail(Schema)`, `OpcoesEnvioEmail(Schema)`, `CODIGOS_EMAIL`, `TransporteEmail`, `MensagemEmail`, `EnderecoEmail` |
| API | `apps/api/src/email/config.ts` | `lerConfigEmail(env)`, `descreverConfigEmail`, `derivarChaveFila`, `lerRemetente` |
| API | `apps/api/src/email/smtp.ts` · `mime.ts` | cliente SMTP mínimo e montagem MIME |
| API | `apps/api/src/email/arquivo.ts` | transporte `arquivo` (caixa da demo) |
| API | `apps/api/src/email/cifra.ts` | AES-256-GCM da carga da fila |
| API | `apps/api/src/email/fila.ts` | `FilaEmail`, `criarFilaPgBoss` (estrutural), `criarFilaMemoria` |
| API | `apps/api/src/email/servico.ts` | `criarEnvioEmail` (porta), `criarProcessadorEmail` (worker), `ligarEmail` (fábrica) |
| API | `apps/api/src/email/erros.ts` | `ErroEmail { codigo, retentavel, codigoSmtp?, etapa? }`, `comoErroEmail` |

## 4. Interface
```ts
interface EnvioEmail {
  enviar<M extends ModeloEmail>(modelo: M, destinatario: DestinatarioEmail, dados: DadosPorModelo[M],
    opcoes?: { idEnvio?: string /* UUID: idempotência */; tenantId?: string }): Promise<ResultadoEnvioEmail>;
}
type ResultadoEnvioEmail =
  | { ok: true; idEnvio: string; situacao: 'enfileirado' | 'enviado' }
  | { ok: false; codigo: CodigoEmail; retentavel: boolean };
interface TransporteEmail { nome: string; entregar(msg: MensagemEmail): Promise<{ idMensagem?: string }> }
```
- `enviar` **nunca lança**: dado inválido ⇒ `EMAIL_DADOS_INVALIDOS` (não retentável); fila fora ⇒ `EMAIL_FILA_INDISPONIVEL`
  (retentável); envio desligado ⇒ `EMAIL_DESLIGADO`. A rota decide o que fazer (ex.: criar o usuário assim mesmo e o BKO
  avisar "e-mail não enviado; informe a senha ao usuário").
- `idEnvio`: UUID gerado por quem chama (no BKO/app, como todo id do sistema) ou pelo serviço. É o `id` do job e o
  `Message-ID` (`<idEnvio@dominio-do-remetente>`): o mesmo pedido repetido não gera 2º e-mail.
- `CODIGOS_EMAIL`: `EMAIL_DADOS_INVALIDOS`, `EMAIL_FILA_INDISPONIVEL`, `EMAIL_DESLIGADO`, `EMAIL_CONFIG_INVALIDA`,
  `EMAIL_CIFRA_INVALIDA`, `EMAIL_CONEXAO`, `EMAIL_TEMPO_ESGOTADO`, `EMAIL_TLS_INDISPONIVEL`, `EMAIL_AUTENTICACAO`,
  `EMAIL_RECUSA_TEMPORARIA`, `EMAIL_RECUSA_DEFINITIVA`, `EMAIL_PROTOCOLO`, `EMAIL_TRANSPORTE`.
- Validação: e-mails em minúsculas; nome, empresa e código sem caractere de controle (CR/LF ⇒ injeção de cabeçalho); senha
  8–128 sem espaço nas pontas; `urlAcesso` só http(s); objetos `strict`.

## 5. Fluxo
```
rota (Core: criar usuário / esqueci / redefinir)
  └─ envio.enviar(modelo, destinatario, dados, { idEnvio, tenantId })
       ├─ Zod (PedidoEmailSchema) ─✗→ { ok:false, EMAIL_DADOS_INVALIDOS }   (log: só caminho+código do Zod)
       ├─ cifra AES-256-GCM (AAD = idEnvio)
       ├─ fila.enfileirar({ v:1, idEnvio, modelo, tenantId, carga })      (id do job = idEnvio)
       └─ { ok:true, situacao:'enfileirado' }  ← volta na hora
worker (pg-boss: retryLimit 5, retryDelay 30 s, backoff, expireInSeconds 120; batchSize 1)
  └─ processador: decifra ─✗→ conclui + warn EMAIL_CIFRA_INVALIDA
       ├─ renderiza (texto + HTML) + versão de log + versão sem senha
       └─ transporte.entregar(msg)
            ├─ ok                → info 'enviado' (id_envio, modelo, tenant_id, tentativa, id_mensagem)
            ├─ retentável        → warn 'falha_temporaria' e LANÇA ErroEmail (pg-boss tenta de novo)
            ├─ retentável, última→ error 'esgotado' e lança (job falha no pg-boss)
            └─ não retentável    → warn 'descartado' e conclui
```
Retentável: 4xx, rede, tempo esgotado, falha de TLS no aperto de mão, erro inesperado. Não retentável: 5xx, credencial
recusada, servidor sem STARTTLS quando exigido, carga que não decifra, dado inválido.

## 6. Cliente SMTP (`smtp.ts`, sem dependência)
Conexão com prazo por etapa (`MACUXI_SMTP_TIMEOUT_MS`), saudação 220, EHLO (HELO se 5xx), STARTTLS (exigido: sem o anúncio,
recusa antes do AUTH; dados recebidos junto com o 220 do STARTTLS derrubam a conexão — RFC 3207 §6) ou TLS implícito (465),
AUTH PLAIN (ou LOGIN), MAIL FROM, RCPT TO, DATA com dot-stuffing, QUIT. MIME: `multipart/alternative` texto + HTML, UTF-8,
base64 em linhas de 76, `Subject` e nomes em RFC 2047, `Date` UTC, `Message-ID`, `Auto-Submitted: auto-generated`.
Erro: `ErroEmail` com **só etapa + código SMTP** (`SMTP rcpt_to: resposta 550`); a resposta textual do servidor nunca é
guardada (pode ecoar o destinatário), nem credencial. Credencial em conexão sem TLS só com `permitirCredencialSemTls`
(a configuração liga apenas fora de produção).

## 7. Variáveis de ambiente
| Variável | Padrão | Uso |
|---|---|---|
| `MACUXI_EMAIL_TRANSPORTE` | `smtp` com `MACUXI_SMTP_HOST`, senão `arquivo` | `smtp`, `arquivo` ou `desligado` |
| `MACUXI_SMTP_HOST` | — | servidor SMTP |
| `MACUXI_SMTP_PORTA` | 587 (465 com `tls`) | porta |
| `MACUXI_SMTP_TLS` | `starttls` (porta 465: `tls`) | `starttls`, `tls` ou `nenhum` (credencial com `nenhum` é recusada em produção) |
| `MACUXI_SMTP_USUARIO` / `MACUXI_SMTP_SENHA` | — | AUTH (as duas ou nenhuma) |
| `MACUXI_SMTP_REMETENTE` | `Macuxi <nao-responda@macuxifdv.com.br>` | `Nome <email>` ou só o e-mail |
| `MACUXI_SMTP_TIMEOUT_MS` | 15000 | prazo de cada etapa (1000–120000) |
| `MACUXI_EMAIL_PASTA` | `<tmp>/macuxi-email` | pasta do transporte `arquivo` |
| `MACUXI_EMAIL_ARQUIVO_MASCARAR` | desligado | `1`: o `.eml` sai com a senha mascarada |
| `MACUXI_EMAIL_CHAVE` | HKDF-SHA256 do `MACUXI_JWT_SEGREDO`, rótulo `macuxi.email.fila.v1` | 32 bytes em base64 (ou 64 hex) |

Falha fechada: em produção (`NODE_ENV=production`), sem `MACUXI_EMAIL_CHAVE` nem `MACUXI_JWT_SEGREDO` (≥ 32) a configuração é
recusada. Fora de produção, sem nenhum dos dois, a chave é efêmera (aviso). API e worker precisam da **mesma** chave:
`descreverConfigEmail` mostra `impressao_chave` (8 hex de um SHA-256 com rótulo, não reversível) para conferir.

### Secrets que o dono do produto cria (GitHub Actions e `.env` da VM da demo)
`MACUXI_SMTP_HOST`, `MACUXI_SMTP_PORTA`, `MACUXI_SMTP_USUARIO`, `MACUXI_SMTP_SENHA`, `MACUXI_SMTP_REMETENTE`, `MACUXI_SMTP_TLS`,
`MACUXI_EMAIL_CHAVE`. Gerar a chave:
```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Trocar a chave invalida os e-mails ainda na fila (viram `EMAIL_CIFRA_INVALIDA`, descartados): trocar com a fila vazia.
No DNS do domínio remetente (`macuxifdv.com.br`): **SPF** autorizando o provedor SMTP, **DKIM** publicado pelo provedor e,
de preferência, **DMARC** (`p=quarantine` depois de validar). Sem SPF/DKIM o e-mail cai no spam ou é recusado (5xx ⇒ descartado).

## 8. Segurança (RN-CORE-34, CLAUDE.md regra 8)
- **Log**: só `id_envio`, `modelo`, `tenant_id`, `tentativa`, `codigo`, `etapa`, `codigo_smtp`, `transporte`, `id_mensagem`.
  Erro do Zod: só caminho e código. Erro desconhecido: vira `EMAIL_TRANSPORTE` com mensagem genérica (`comoErroEmail`).
  `ConfigEmail.toJSON()` devolve a descrição segura (log por engano não vaza credencial). O transporte `arquivo` loga a versão
  de log do corpo (nome/e-mail em marcadores, senha `********`).
- **Fila**: a carga é AES-256-GCM (IV aleatório, AAD = `idEnvio`); o job e a coluna `output` do pg-boss não têm dado pessoal.
- **Eventos**: nenhum evento de outbox é publicado pelo e-mail. Quem auditar (ex.: `usuario.criar`) grava só
  `email_enfileirado: true`/o código, nunca o endereço.
- **Conexão**: STARTTLS exigido por padrão; nunca manda credencial em claro (fora de produção, só com `MACUXI_SMTP_TLS=nenhum`
  explícito); `.eml` da demo com permissão 0600 em pasta 0700.
- Testes conferem, em todo log capturado, que nenhum de `valoresSensiveisEmail(pedido)` aparece.

## 9. Testes
- SDK: `packages/platform-sdk/src/email/{modelos,porta}.test.ts` (26) — renderização (login, código, senha, 72 h, troca no 1º
  acesso), escape de HTML, recusas do Zod (CRLF, url `javascript:`, strict), versão de log sem valor sensível, contrato do resultado.
- API: `apps/api/src/email/*.test.ts` (63) — config (sem senha/usuário/chave em erro e descrição), MIME, SMTP contra servidor
  falso em 127.0.0.1 (feliz com AUTH PLAIN/LOGIN em `nenhum`, 5xx sem destinatário na mensagem, 4xx retentável, sem STARTTLS ⇒
  recusa antes do AUTH, injeção pré-TLS, tempo esgotado, conexão recusada), arquivo, cifra (ida e volta, adulteração, AAD),
  serviço + fila em memória (volta na hora, retentativa, não retentável, esgotado, idempotência), pg-boss com boss falso.
  Rodar: `pnpm --filter api exec vitest run --config src/email/vitest.config.ts` (o `vitest.config.ts` da API só inclui `test/**`).

## 10. Pendências (fora do escopo desta frente)
- **(a)** `pnpm add pg-boss` (v10) no `apps/api` e ligar no `worker.ts` (`ligarEmail({ config: lerConfigEmail(process.env), log,
  boss }).iniciar()`) e na API (`envio` disponível às rotas do Core, ex.: em `ServicosCore`) — **depois do T-0093** (login do
  portal mexe em `app.ts`/`api.ts`/`plataforma.ts`). Até lá, `ligarEmail` sem `boss` usa a fila em memória.
- **(b)** Incluir `src/**/*.test.ts` no `apps/api/vitest.config.ts` para o CI rodar os testes desta pasta.
- **(c)** Registrar RN-CORE-32..34 no doc 03 e criar `.coord/tarefas/T-0094.md` (gerente-projetos).
- **(d)** Coluna de troca obrigatória e validade da senha provisória em `core.usuario` (ex.: `senha_provisoria_ate timestamptz`)
  — `banco-dados` + `modulo-core`; o login passa a recusar após 72 h e devolver `trocar_senha`.
- **(e)** Rotas do Core chamarem a porta: `POST /usuarios` (acesso inicial), `PUT /usuarios/:id/senha` (redefinição) e a rota
  pública "esqueci a senha" (nova; resposta sempre igual exista ou não o e-mail, com limite por IP/e-mail) — `modulo-core`.

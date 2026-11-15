# Core — autenticação e licenças (T-0003, Fase 2)

Fonte: `modules/core/{contracts,domain,api,app,web}`. Regras: RF-CORE-01/02, RN-CORE-01..05.

## Rotas
| Rota | Quem | Observações |
|---|---|---|
| `POST /v1/auth/login` | público | `{ codigo_empresa, email, senha, dispositivo_id? }`; limite de FALHAS 10/5 min por IP real + empresa + e-mail e teto geral 300/5 min por IP + empresa (429 `MUITAS_TENTATIVAS`; ver "Limite de tentativas"). Código, e-mail ou senha errados: a MESMA resposta (401 `CREDENCIAIS_INVALIDAS`). Nome e fuso do tenant só saem depois da senha validada |
| `POST /v1/auth/refresh` | público | refresh rotativo (cada um vale uma vez); reuso de refresh já trocado revoga a família inteira (401 `SESSAO_INVALIDA`) |
| `POST /v1/auth/logout` | público | revoga a família; resposta igual para token desconhecido |
| `GET /v1/me/modulos` | plataforma (T-0004) | módulos efetivos por requisição; não é do Core |
| `GET /v1/core/licencas` | admin | estado tenant → perfil → usuário (+ `dependencias` quando a plataforma fornecer `ctx.dependencias`) |
| `PUT /v1/core/licencas/tenant/:modulo` · `.../perfis/:perfil/:modulo` · `.../usuarios/:id/:modulo` | admin (`modulo.gerir_licencas`) | `{ ativo }`; `core` não desliga (422 `RN-CORE-01`); exceção do usuário só remove; grava auditoria e publica `core.usuario.modulos_alterados@1` |
| sync pull `cliente`, `carteira`, `produto` | token | horizonte seguro, cursor `(updated_at, id)`, carteira (RN-CORE-04) |

## Sessão
- JWT HS256, 15 min, só `sub`, `tid`, `perfil`, `iat`, `exp` (nunca licença). Segredo em `MACUXI_JWT_SEGREDO` (mín. 32 caracteres); sem ele o login responde 503 e ninguém autentica.
- `autenticar` consulta `core.usuario` a cada requisição: bloqueio remoto, inativação e troca de perfil valem na hora.
- Refresh opaco `<tenant_id>.<segredo>`; o banco guarda o sha256 do segredo (`core.sessao`).
- Bloqueio: 5 falhas seguidas bloqueiam 15 min; senha certa zera. Bloqueio, inativo e aparelho bloqueado só são revelados (423 `USUARIO_BLOQUEADO`) a quem acertou a senha.
- Senha: argon2id PHC (Node >= 24.7, `crypto.argon2`). Log sem e-mail, senha ou token.

## Pendências de outros donos (T-0003 Fase 2)
- banco-dados: migração 0004 (`core.sessao`, `core.dispositivo`, `core.usuario.tentativas_falhas`/`bloqueio_ate`) — o SQL de `api/repositorio.ts` espera esses nomes; os testes do Core usam repositório em memória.
- engenheiro-software: `ErroHttpModulo` (401/423/503 hoje saem 422 com o mesmo `codigo`); `ctx.dependencias`; `MACUXI_JWT_SEGREDO` no `.env.example`/servidor; ligar `TelaLogin`/`entrarComSenha` no shell e remover o login de demonstração; testes com `createApp` em `apps/api/test/core.test.ts`.

## Limite de tentativas do login (T-0026, demo atrás do túnel)
Problema: o limite antigo (5/5 min por IP + empresa) contava também as entradas certas e, atrás do cloudflared, todos os aparelhos chegam com o mesmo IP: a 6ª entrada dava 429 para todos.

Decisão:
- **IP real**: o Core usa `ctx.ip` (= `request.ip` do Fastify). Atrás de proxy confiável o servidor liga `trustProxy` (apps/api, do engenheiro; env `MACUXI_TRUST_PROXY`) e o IP vem de X-Forwarded-For/CF-Connecting-IP. Sem `trustProxy`, o IP é o do proxy e o limite se comporta como antes por aparelho único: **ligar na demo**.
- **Só falhas contam**: `api/limite-login.ts`, chave `IP|empresa|e-mail`, **10 falhas em 5 min** (janela fixa, memória do processo) respondem 429 com `detalhes.retry_after_s`. Entrada certa zera a chave e nunca consome. Falha = credenciais inválidas (inclui empresa/e-mail inexistentes); 423 (bloqueio revelado só a quem acertou a senha) não conta. O bloqueio por usuário (5 falhas, 15 min, RF-CORE-01) continua no domínio e vale para qualquer IP; o limite por IP cobre quem erra e-mail/empresa e a tentativa de adivinhar muitos e-mails.
- **Teto geral**: o limite da plataforma na rota (`index.ts`) passou a **300/5 min** por IP + empresa, contando tudo, só contra abuso.
- Testes: `api/autenticacao.test.ts` (memória) e `api/login-limite.db.test.ts` (Postgres): 10 acertos seguidos sem 429; falhas do mesmo IP + e-mail bloqueiam; dois IPs atrás do mesmo proxy não se bloqueiam.

## RN-CORE-15 — aparelho bloqueado vale para o tenant inteiro (T-0017)
Decisão do Alexandre (2026-10-31). Aparelho bloqueado (perda, roubo, desligamento) **não autentica nenhum usuário do tenant**, não só o dono registrado.

| Passo | Como funciona |
|---|---|
| Consulta | `RepositorioTenant.dispositivoBloqueado(dispositivoId)` olha `core.dispositivo.bloqueado_em` do aparelho, sem filtrar por usuário. O RLS isola o tenant: aparelho do tenant A não existe para o B. **Sem mudança de schema**: `core.dispositivo` já tem `tenant_id` e `bloqueado_em` |
| Login | Com a senha certa num aparelho bloqueado: **423 `DISPOSITIVO_BLOQUEADO`** (mensagem em português com a ação seguinte). Senha errada continua 401 `CREDENCIAIS_INVALIDAS`: o bloqueio só é revelado a quem acertou a senha (mesma regra do `USUARIO_BLOQUEADO`) |
| Refresh | Com refresh **válido** e aparelho bloqueado: 423 `DISPOSITIVO_BLOQUEADO` e a família de sessões é revogada. Refresh inválido, expirado ou reutilizado continua 401 `SESSAO_INVALIDA` (quem não tem sessão não aprende nada). Esse é o momento da "próxima conexão" do aparelho |
| Access token | O JWT de 15 min não leva aparelho: um aparelho bloqueado ainda opera até o acesso expirar (no máximo 15 min), porque a próxima renovação cai no 423. Aceito e documentado |
| App | `tratarAparelhoBloqueado(erro, acoes)` (app/lib/aparelho-bloqueado.ts): apaga os dados locais do tenant **e a fila não enviada**, encerra a sessão, mostra `AVISO_APARELHO_LIMPO` e volta ao login. Perder a fila é intencional. O shell fornece as ações e chama a função em login/refresh |
| BKO | Tela **Aparelhos** (menu Administração, ação `dispositivo.bloquear`: admin e analista). Rotas: `GET /v1/core/dispositivos?bloqueado=&q=`, `PUT /v1/core/dispositivos/:id/bloqueio` (idempotente: mantém o instante do 1º bloqueio) e `DELETE` (desbloqueia). Cada mudança grava `plataforma.auditoria` (`dispositivo.bloquear` / `dispositivo.desbloquear`, quem, antes e depois) |
| Sessões | O bloqueio **não** revoga as sessões na hora, de propósito: o refresh do aparelho precisa chegar à API para o app receber o 423 e limpar |

Testes: `api/autenticacao.test.ts` (login e refresh), `api/carteira.db.test.ts` (consulta por tenant, RLS, rotas e auditoria com Postgres), `app/lib/aparelho-bloqueado.test.ts`, `web/lib/aparelhos.test.ts`.

## T-0017 — rotas e sync de carteira e Cliente 360
| Rota | Quem | Observações |
|---|---|---|
| `GET /v1/core/clientes` | todos os perfis do core | lista paginada (cursor = deslocamento), filtros `q`, `cidade`, `segmento`, `bloqueado`, `com_vencidos`; sempre dentro da carteira (RN-CORE-04) |
| `GET /v1/core/clientes/:id` | todos | `Cliente360Schema`; fora da carteira ou de outro tenant = **404** `CLIENTE_NAO_ENCONTRADO` |
| `GET /v1/core/carteira` | supervisor, gerente, analista, assistente, admin | vínculos dentro da carteira e dos usuários visíveis |
| `PUT /v1/core/carteira` · `DELETE /v1/core/carteira/:id` | `carteira.editar` (analista, admin) | upsert idempotente por (cliente, usuário, papel); papel combina com o perfil (RN-CORE-04/RN-PRO-01); auditoria |
| `GET /v1/core/equipe/hierarquia` | supervisor, gerente, analista, assistente, admin | `HierarquiaEquipeSchema` (contrato para o Gestor): `superior_id` derivado de `core.equipe`; recortada pelos usuários visíveis, sem revelar quem está acima |
| sync pull | token | `cliente`, `carteira`, `cliente_contato`, `cliente_financeiro`, `titulo`, `historico_compra` com `escopo: 'carteira'`; `produto` com `'tenant'`. Janelas: carteira vigente ou encerrada há ≤ 40 dias; títulos abertos ou vencimento ≥ hoje − 90; histórico dos últimos 12 meses. Linhas removidas passam sempre (o aparelho apaga) |
| `servicos.usuariosVisiveis` | plataforma | próprio; supervisor + equipe; gerente + equipes abaixo (recursivo); analista/assistente/admin = tenant |

## Código da empresa e senha (login por senha)
- **Código da empresa** = código da licença (migração 0068): sigla da UF + 4 dígitos, 6 caracteres (ex.: AM4821), sem diferenciar maiúsculas (índice `lower(codigo)`) e aparando as pontas. **O campo (app, BKO, portal) aceita só esse formato**, pela regra única `CodigoEmpresaFormatoSchema` (e `erroDoCodigoEmpresa` para a mensagem), em `contracts`; o campo do app tem `maxLength` 6 (`propsDoCampoCodigoEmpresa`). **O servidor aceita o código antigo e o novo** (`CodigoEmpresaSchema`: 2 a 40 letras, dígitos e hífen, que já inclui UF + 4 dígitos) no login, na troca de senha e no "Esqueci a senha", até o lote de migração dos seeds e fixtures, quando passará a recusar o antigo (R-20261114-222000). O #289 deu o código novo às empresas antigas.
- **Senha** (RN-CORE-32): espaço no começo ou no fim invalida a senha na criação e na troca (falta `espaco`; frase única `MENSAGEM_SENHA_ESPACO_NAS_PONTAS`). O login avisa do mesmo jeito no cliente; a API do login segue aceitando qualquer senha já gravada.

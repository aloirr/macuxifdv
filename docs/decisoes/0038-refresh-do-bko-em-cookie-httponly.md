# ADR 0038 — Token de renovação do BKO em cookie httpOnly gravado pela API, com CSRF por cabeçalho próprio

- **Status**: aceita em 2026-11-09 (esteira permanente, R-20261107-164646; não é governança).
- **Data**: 2026-11-09
- **Tarefa**: T-0117 — conferência T-0110 N1, obrigatória antes de ligar a produção.
- **Autor**: engenheiro-software
- **Base**: ADR 0008 §4 (sessão real nos shells; o refresh do BKO no `localStorage` era pendência), desenho T-0038 §3 (BKO sem CORS: o navegador só fala com a própria origem, pelo `/api-proxy`), ADR 0032 (ciclo de senha, `sessao_versao`).
- **Altera**: ADR 0008 §4 (BKO) e o comentário "sem cookie" do `createApp` (T-0038 §3). O app Android não muda.

## Contexto

O BKO guardava o token de acesso (JWT de 15 min) e o de renovação (rotativo, 30 dias) no `localStorage`. Um XSS no BKO lê o de renovação e mantém a sessão viva fora do navegador por 30 dias.

O navegador nunca fala com a API: chama `https://<bko>/api-proxy/...` e o *rewrite* do Next repassa a `/v1/...`. O *rewrite* repassa `Cookie` e `Set-Cookie` como vieram. Então um cookie gravado pela API chega ao navegador como cookie **do host do BKO**: o domínio da API (`api.` ou o interno `http://api:8100` da demo) nunca aparece para o navegador.

O desenho de madrugada da T-0117 punha a troca cookie ↔ corpo em quatro *route handlers* do Next. Revisto nesta rodada: a regra de segurança ficaria fora da API, duplicada num segundo servidor (repasse do `X-Forwarded-For`, erros, tempo-limite) e sem os testes da API; e a precedência handler × *rewrite* do Next vira um risco de versão.

## Decisão

1. **A API grava e lê o cookie**, numa capacidade de plataforma: `RotaPublica.cookieSessao` (`@macuxi/platform-sdk`, `cookie-sessao.ts`). O Core só declara o papel de cada rota; o `executar` não sabe do cookie.
   - `emitir` (`auth/login`, `auth/senha/trocar`): tira o `refresh_token` da resposta e grava o cookie;
   - `renovar` (`auth/refresh`): lê o cookie para `corpo.refresh_token`, grava o cookie girado; recusa 401/423 apaga o cookie;
   - `encerrar` (`auth/logout`): lê o cookie; apaga SEMPRE (sucesso, 4xx ou 5xx); sem cookie responde `{}` sem chamar o Core.
   - A montagem confere na subida: só no core, só `POST`, sem `cache`/`conexao`, validade de 60 s a 90 dias em `emitir`/`renovar`.
2. **O modo cookie só vale com `X-Macuxi-CSRF: 1`.** Sem o cabeçalho a rota é a de sempre (o app manda e recebe o token no corpo; nenhum cookie é lido nem gravado). No modo cookie, um `refresh_token` no corpo é ignorado: só vale o cookie.
3. **Cookie**: `__Secure-macuxi_rt` (HTTPS) ou `macuxi_rt` (PC, `http://localhost`); `HttpOnly; Secure; SameSite=Strict; Path=/api-proxy/auth; Max-Age=<validade do refresh>`; **sem `Domain`** (host-only: `bko.` e `config.` não compartilham). O caminho é o `PROXY_BASE` + `/auth`, uma constante do SDK com teste de paridade com o cliente web. Fora desse caminho o navegador não manda o cookie (nem às páginas, nem às outras rotas).
   - `MACUXI_SESSAO_COOKIE_SEGURO` (`1`/`0`) decide; ausente, seguro fora do ambiente local (`ehAmbienteLocal`).
4. **CSRF** (sem *double-submit*, que exigiria um 2º cookie legível pelo JS):
   - `SameSite=Strict`: outro site não leva o cookie;
   - cabeçalho próprio `X-Macuxi-CSRF: 1`: exige pré-voo de CORS, que nem o BKO nem a API liberam;
   - `Sec-Fetch-Site`, quando o navegador manda, tem de ser `same-origin` ou `none` (recusa `same-site`: o portal `config.` não usa o cookie do `bko.`);
   - valor diferente de `1` ou outro site: **403 `CSRF_RECUSADO`**, antes de validar o corpo ou contar tentativa.
   - O `login` também passa pela conferência: protege contra *login CSRF*.
5. **No navegador** (`@macuxi/platform-sdk/web`):
   - token de acesso no `sessionStorage` da aba, junto com a cópia do usuário; usuário (não secreto) no `localStorage`. Nenhum token no `localStorage`;
   - aba nova (ou F5 depois de fechar a aba): `loading` → renova pelo cookie → autenticada ou anônima;
   - renovação serializada na aba e entre abas (`navigator.locks`, trava `macuxi-refresh`): a 2ª aba já manda o cookie girado;
   - `encerrarSessaoWeb()` limpa a sessão e chama o logout no modo cookie; `api(..., { sessaoWeb: true })` no login e na troca de senha;
   - migração: as chaves antigas saem do `localStorage` na carga, sem deslogar à força (quem estava logado entra de novo uma vez, até 15 min depois da publicação).
6. **Troca de senha** revoga todas as famílias e sobe a `sessao_versao` (ADR 0032): o cookie antigo é recusado e apagado na próxima renovação; a sessão nova vem no cookie novo. Redefinição pelo admin e bloqueio caem do mesmo jeito (401/423 → cookie apagado).
7. **Logs**: `Cookie`, `Set-Cookie` e `refresh_token` na redação do pino; o token nunca entra em log, auditoria ou evento.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| *Route handlers* do Next fazendo a troca (desenho de madrugada) | regra de segurança fora da API, num 2º servidor que repete repasse de IP, erros e tempo-limite; sem os testes da API; depende da precedência handler × *rewrite* do Next |
| Cookie com `Domain=.macuxifdv.com.br` e o navegador chamando a API direto | exige CORS com credenciais na API e expõe o cookie a todo subdomínio (inclusive o `config.`); contraria a T-0038 §3 |
| `__Host-` com `Path=/` | o cookie iria a toda página e a toda rota da API; o prefixo `__Secure-` com caminho restrito expõe menos |
| CSRF por *double-submit* (cookie legível + cabeçalho igual) | um 2º cookie e mais estado; com `SameSite=Strict`, sem CORS e cabeçalho próprio, não acrescenta proteção |
| Manter no `localStorage` e só endurecer a CSP | XSS ainda lê o token de 30 dias; a conferência T-0110 exige a troca |

## Consequências

- O Core declara `cookieSessao` nas 4 rotas e publica os schemas web da resposta (sem `refresh_token`); o BKO valida com eles.
- O app Android não muda: nunca manda o cabeçalho, recebe o token no corpo e guarda no SecureStore.
- Sessões abertas no dia da publicação: cada usuário do BKO entra de novo uma vez.
- Se o BKO for servido por `http://` fora do PC com o cookie seguro, o navegador recusa o `Secure` e a sessão dura 15 min (falha visível e segura). O roteiro de ligar confere o cookie na demo.
- Risco: se o *rewrite* do Next deixar de repassar `Set-Cookie` numa versão futura, a renovação falha e o usuário volta ao login a cada 15 min (falha segura); o *smoke* da demo cobre o login + renovação pelo BKO.

# Checklist de segurança e LGPD (T-0078)

Fonte: desenho do engenheiro-software (docs/desenho/T-0078.md §3), criado pelo gerente-projetos em 04/11/2026 porque o caminho docs/seguranca/ é dele. Atualizado a cada prova nova (banco-dados: RLS, retenção e exclusão; testes: log sem dado pessoal e carga).

Legenda: ✅ feito, com prova · 🟡 parcial ou pendente (com o que falta).

### Segredos
- ✅ S1 — Segredos só em `.env` fora do git: `.gitignore` (`.env`, `.env.*`, exceto `.env.example`); VM em `/opt/macuxi/*.env` (chmod 600, `preparar-vm.sh`); CI em secrets do GitHub (environments `PRODUCAO` e afins; o `DEMO_SSH_KEY` da demo, desligada em 14/11/2026 pela ADR 0051, pode ser apagado). Prova: `git ls-files | grep -E '(^|/)\.env'` devolve só `db/.env.example` (conferido em 05/11).
- ✅ S2 — Falha fechada sem segredo: API não sobe fora do local sem `MACUXI_JWT_SEGREDO` ≥ 32 caracteres (`apps/api/src/config.ts`, `conferirSegredoJwt`); Hub sem `MACUXI_HUB_CHAVE_PEPPER` responde 503 (ADR 0013).
- 🟡 S3 — Varredura automática de segredo no CI (gitleaks ou equivalente): não existe; pede ADR (dependência no CI).

### Banco e isolamento
- ✅ B1 — RLS ligado e forçado com política em toda tabela de domínio e colunas da regra 5: `db/testes/conformidade.test.ts` (S0-023), com as exceções em `db/src/excecoes.ts`. Conferência pedida ao banco-dados (R-20261104-232912). Prova também: `db/scripts/conferir-rls.sql` (0 linhas = ok) e os casos "B1" de `db/testes/conformidade.test.ts`, inclusive a política `manutencao` da 0031 (T-0075).
- ✅ B2 — API só como `macuxi_app` (sem superusuário/BYPASSRLS; `apps/api/src/banco.ts` recusa subir); worker como `macuxi_worker` (`verificarPapelWorker`).
- ✅ B3 — `tenant_id` só do token, nunca do corpo ou da query (`packages/platform-sdk/src/api.ts`); toda rota checa perfil, carteira e licença (`apps/api/src/app.ts`, `preparar`).

### Senha e token
- ✅ T1 — Senha em argon2id (parâmetros mínimos da OWASP), formato PHC, constraint no banco (`modules/core/api/seguranca.ts`, `core.usuario.senha_hash`).
- ✅ T2 — JWT de acesso HS256 de 15 min só com `sub`, `tid`, `perfil`; refresh opaco rotativo com sha256 no banco; reuso de refresh revoga a família (`modules/core/api/autenticacao.ts`); logout revoga; aparelho bloqueado (RN-CORE-15) apaga os dados locais.
- ✅ T3 — Limite de tentativas no login e no refresh por IP + empresa (`apps/api/src/limitador.ts`), com `MACUXI_TRUST_PROXY` atrás do túnel.

### Log e dado pessoal
- ✅ L1 — Log sem dado pessoal: serializers e redação em `apps/api/src/config.ts`; testes `tests/integracao/api/auth.test.ts` (S0-073: nenhum e-mail, senha, token ou refresh no log com o logger em trace) e `tests/integracao/api/log-sem-dado-pessoal-t0078.test.ts` (sync inteira, métricas da API e do worker, DatabaseError).
- ✅ L2 — Request id em toda resposta (`X-Request-Id`) e em toda linha de log da requisição: `tests/integracao/api/request-id-worker-t0078.test.ts` (200/400/401/404/500 com o mesmo reqId do log; cabeçalho que não é UUID é trocado; o despachante leva o request_id do envelope em toda linha, sem o conteúdo do evento).
- ✅ L3 — Métricas e alertas só com contagens e códigos (`apps/api/src/observabilidade.ts`, `linhaDeMetricas`).

### LGPD
- 🟡 G1 — Retenção: backup diário com 7 cópias (`db/backup/LEIA-ME.md`); o doc 04 pede 30 dias. Prazos de logs da busca e da auditoria: aguardando o banco-dados.
- ✅ G2 — Exclusão sob pedido (titular ou tenant): funções da 0024 e da 0032 (`plataforma.excluir_tenant` em ordem de FK, sem superusuário), roteiro em `docs/banco/lgpd.md` §3–4 e teste `db/testes/lgpd-outbox.test.ts` (R-20261105-001134, banco-dados).
- 🟡 G3 — Termo de uso do dado do ERP: rascunho em docs/seguranca/termo-dado-erp.md (05/11, engenheiro-software); aguarda revisão jurídica e aprovação do dono do produto.
- 🟡 G4 — Localização só no check-in/checkout (doc 04 "LGPD"); fotos com orientação "sem rostos". Prova só documental: nenhum teste prova que a localização só sai no check-in e no checkout (pedido ao testes).

### Observabilidade
- ✅ O1 a O4 — Observabilidade: `apps/api/test/observabilidade.test.ts` (9 ✓ no CI); `curl https://api-demo.macuxifdv.com.br/v1/saude` em 06/11 00:59 UTC deu 200, banco ok, outbox 0/0/null, erros_5xx 0, alertas [] e nenhum segredo; 5xx e fila também na linha de métricas da API e do worker; alerta em `scripts/deploy/demo/alerta-saude.sh` com o teste `tests/integracao/demo/alerta-saude-t0078.test.ts`. **Ressalva:** o cron do alerta na VM é instalado à mão e não há prova de que está ativo (pedido ao engenheiro-software, R-20261105-213451-testes).

### Carga
- ✅ C1 — Carga básica do sync no CI (run 42131001920, commit 0263f9f; `gh run view 42131001920 --log | grep "carga T-0078"`), com Postgres: 20 aparelhos × 3 rodadas = 760 requisições, 0 erros, p50 80 ms, p95 417 ms, máx. 476 ms; 50 aparelhos = 1.900 requisições, 0 erros, p50 168 ms, p95 905 ms, máx. 1.102 ms; teto do roteiro 2.000 ms; `/v1/saude` sem falha de banco nem 5xx depois. Detalhe em `docs/testes/T-0078.md`.

### Base recriada (T-0079)
- ✅ R1 — O aparelho percebe a base recriada ou restaurada e não mostra pedido que o servidor não tem (ADR 0021).

## Decisões do dono do produto pendentes
- G1: retenção do backup em 7 dias (hoje) ou 30 dias (doc 04).
- G3: texto do termo de uso do dado do ERP.

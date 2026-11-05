# Checklist de segurança e LGPD (T-0078)

Fonte: desenho do engenheiro-software (docs/desenho/T-0078.md §3), criado pelo gerente-projetos em 04/11/2026 porque o caminho docs/seguranca/ é dele. Atualizado a cada prova nova (banco-dados: RLS, retenção e exclusão; testes: log sem dado pessoal e carga).

Legenda: ✅ feito, com prova · 🟡 parcial ou pendente (com o que falta).

### Segredos
- ✅ S1 — Segredos só em `.env` fora do git: `.gitignore` (`.env`, `.env.*`, exceto `.env.example`); VM em `/opt/macuxi/*.env` (chmod 600, `preparar-vm.sh`); CI em secrets do GitHub (`DEMO_SSH_KEY`, environment da demo).
- ✅ S2 — Falha fechada sem segredo: API não sobe fora do local sem `MACUXI_JWT_SEGREDO` ≥ 32 caracteres (`apps/api/src/config.ts`, `conferirSegredoJwt`); Hub sem `MACUXI_HUB_CHAVE_PEPPER` responde 503 (ADR 0013).
- 🟡 S3 — Varredura automática de segredo no CI (gitleaks ou equivalente): não existe; pede ADR (dependência no CI).

### Banco e isolamento
- ✅ B1 — RLS ligado e forçado com política em toda tabela de domínio e colunas da regra 5: `db/testes/conformidade.test.ts` (S0-023), com as exceções em `db/src/excecoes.ts`. Conferência pedida ao banco-dados (R-20261104-232912).
- ✅ B2 — API só como `macuxi_app` (sem superusuário/BYPASSRLS; `apps/api/src/banco.ts` recusa subir); worker como `macuxi_worker` (`verificarPapelWorker`).
- ✅ B3 — `tenant_id` só do token, nunca do corpo ou da query (`packages/platform-sdk/src/api.ts`); toda rota checa perfil, carteira e licença (`apps/api/src/app.ts`, `preparar`).

### Senha e token
- ✅ T1 — Senha em argon2id (parâmetros mínimos da OWASP), formato PHC, constraint no banco (`modules/core/api/seguranca.ts`, `core.usuario.senha_hash`).
- ✅ T2 — JWT de acesso HS256 de 15 min só com `sub`, `tid`, `perfil`; refresh opaco rotativo com sha256 no banco; reuso de refresh revoga a família (`modules/core/api/autenticacao.ts`); logout revoga; aparelho bloqueado (RN-CORE-15) apaga os dados locais.
- ✅ T3 — Limite de tentativas no login e no refresh por IP + empresa (`apps/api/src/limitador.ts`), com `MACUXI_TRUST_PROXY` atrás do túnel.

### Log e dado pessoal
- ✅ L1 — Log sem dado pessoal: serializers e redação em `apps/api/src/config.ts`; teste `tests/integracao/api/auth.test.ts` (S0-073: nenhum e-mail, senha, token ou refresh no log com o logger em trace). Reforço pedido ao testes (T-0078).
- ✅ L2 — Request id em toda resposta (`X-Request-Id`) e em toda linha de log da requisição.
- ✅ L3 — Métricas e alertas só com contagens e códigos (`apps/api/src/observabilidade.ts`, `linhaDeMetricas`).

### LGPD
- 🟡 G1 — Retenção: backup diário com 7 cópias (`db/backup/LEIA-ME.md`); o doc 04 pede 30 dias. Prazos de logs da busca e da auditoria: aguardando o banco-dados.
- 🟡 G2 — Exclusão sob pedido (titular ou tenant): aguardando o banco-dados (o que existe: soft delete por `deleted_at`; falta o roteiro de anonimização e de exclusão por tenant).
- 🟡 G3 — Termo de uso do dado do ERP: não existe documento; precisa de texto aprovado pelo Alexandre (o que o Hub lê, para quê, por quanto tempo, quem acessa).
- ✅ G4 — Localização só no check-in/checkout (doc 04 "LGPD"); fotos com orientação "sem rostos".

### Observabilidade
- ✅ O1 a O4 — seção 1 deste desenho (log, `/v1/saude` com banco e outbox, 5xx e outbox contados, alerta simples).

### Carga
- 🟡 C1 — Carga básica do sync: roteiro e ferramenta prontos (seção 2); resultado pendente da execução pelo testes.

### Base recriada (T-0079)
- ✅ R1 — O aparelho percebe a base recriada ou restaurada e não mostra pedido que o servidor não tem (ADR 0021).

## Decisões do dono do produto pendentes
- G1: retenção do backup em 7 dias (hoje) ou 30 dias (doc 04).
- G3: texto do termo de uso do dado do ERP.

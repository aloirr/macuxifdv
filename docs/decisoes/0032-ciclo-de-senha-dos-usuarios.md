# ADR 0032 — Ciclo de senha dos usuários do tenant: senha temporária por e-mail com troca obrigatória, "Esqueci a senha" paralelo, versão de sessão no token, superfície BKO nas rotas e outbox de e-mail cifrada

- **Status**: **proposta** em 2026-11-07 (aceita quando o gerente-projetos confirmar as premissas P5 a P8 com o dono do produto).
  Aplica as decisões do dono do produto de 07/11 (RN-CORE-33 e RN-CORE-34).
- **Data**: 2026-11-07
- **Tarefa**: T-0094 (desenho: [docs/desenho/T-0094.md](../desenho/T-0094.md))
- **Autor**: engenheiro-software
- **Regras**: RN-CORE-32, RN-CORE-33, RN-CORE-34, RN-CORE-31, RN-CORE-15, RN-AUD-01, regra 8
- **Relacionadas**: [0007](0007-despacho-da-outbox-com-macuxi-worker.md) (outbox e despachante), [0029](0029-super-admin-de-plataforma.md) e
  [0031](0031-portal-so-email-e-senha.md) (portal)

## Contexto
O dono do produto decidiu que o admin do cliente cria os demais usuários no BKO com uma senha inicial enviada por e-mail e trocada no
1º uso; que o app e o BKO têm "Esqueci a senha" com a senha nova por e-mail; que o BKO redefine a senha da equipe; que toda troca
encerra as sessões; e que vendedor, promotor e supervisor nunca entram no BKO nem no portal. Hoje: o login devolve a sessão direto,
o token de acesso vive 15 min mesmo depois de a senha mudar, a plataforma não envia e-mail, a Equipe por CSV usa convite por link,
e a recusa de perfil no BKO é só do shell (a API aceita o supervisor em várias rotas do BKO).

## Decisão
1. **Senha temporária com validade e troca obrigatória.** `core.usuario` ganha `trocar_senha` e `senha_expira_em` (72 h). Toda senha
   definida por outra pessoa (BKO, CSV, redefinição) nasce temporária. A master do admin inicial também exige troca, sem validade.
2. **O login não abre sessão para quem precisa trocar:** responde 403 `SENHA_A_TROCAR` (só depois da senha certa). A troca é uma
   rota pública que reconfere código da empresa, e-mail e senha atual e devolve a sessão. Sem token intermediário, sem estado novo no
   servidor; a resposta de sucesso do login não muda de formato.
3. **"Esqueci a senha" grava uma senha temporária paralela** (`senha_temporaria_*`), sem invalidar a atual nem encerrar sessões até
   ser usada. Resposta sempre 202 igual; limites por IP e por chave e um teto de 15 min no banco. O login confere sempre as duas
   senhas (tempo constante).
4. **Versão de sessão no token:** `core.usuario.sessao_versao` sobe a cada troca, redefinição e desativação; o JWT leva `sv`; o
   `autenticar`, que já lê o usuário a cada requisição, recusa a versão antiga. O refresh é revogado na mesma transação; a sessão do
   portal do admin guarda a versão e cai junto. Token antigo sem `sv` vale como 0 (ninguém é deslogado no deploy).
5. **RN-CORE-33 na API:** o login recebe `app` e recusa o perfil de outro app sem abrir sessão (403 `PERFIL_FORA_DO_APP`);
   `RotaModulo.superficie: 'bko'` faz a API recusar perfil fora do BKO (403 `PERFIL_SEM_BKO`) com qualquer token. `PERFIS_DO_APP.web`
   perde o supervisor e é a fonte única (o Core deixa de ter lista própria).
6. **E-mail transacional por outbox no Postgres** (`plataforma.email_saida`), gravada pela conexão da transação do tenant, com `para`
   e `dados` cifrados (AES-256-GCM, chave HKDF do `MACUXI_JWT_SEGREDO`, AAD com id/tenant/modelo); despachante no `macuxi_worker`,
   como o de eventos; a carga é zerada depois do envio ou da falha final. A porta `ServicoEmail` (SDK) e os adaptadores SMTP e
   arquivo vêm da frente N5. Senha nunca em log, evento, auditoria nem em claro no banco.
7. **Convite por link sai** da Equipe por CSV: a senha inicial é gerada no servidor e vai por e-mail.

## Alternativas
- **pg-boss para a fila de e-mail** (sugerido no prompt da N5): exige dependência nova, schema próprio criado com DDL em produção,
  papéis e grants, e um adaptador para gravar na transação do `macuxi_app`; sem a mesma transação, a senha poderia mudar sem e-mail
  (ou o e-mail sair com uma senha que não foi gravada). A outbox já é o padrão da plataforma (ADR 0007). Recusada.
- **Payload da fila em claro**: a senha ficaria legível no banco e nos backups por até 72 h. Recusada.
- **Secret novo para a cifra (`MACUXI_CHAVE_EMAIL`)**: mais isolamento, mas exige mudar a VM, os workflows e os secrets do dono do
  produto. Recusada por ora (a HKDF separa as chaves; a troca do segredo do JWT só perde e-mails pendentes, que vencem em 72 h).
- **Login com 200 `{ etapa: 'trocar_senha', token_troca }`**: muda o formato do sucesso (contrato v2), e o token de troca precisaria
  de uma audiência que o `verificarJwtAcesso` de hoje não confere. Recusada.
- **"Esqueci a senha" trocando a senha atual na hora** (leitura literal de "marca trocar senha"): qualquer pessoa com o código da
  empresa e o e-mail trancaria o usuário para fora e derrubaria as sessões dele. Recusada (P6).
- **Corte do token só pelo vencimento (15 min)**: deixaria o acesso aberto até 15 min depois de um reset feito por suspeita.
  Recusada; o custo é uma coluna lida na consulta que o `autenticar` já faz.
- **Recusar o supervisor no BKO só no shell**: a API continuaria aceitando as rotas do BKO. Recusada.
- **Link de redefinição em vez de senha por e-mail**: mais seguro; o dono do produto escolheu a senha por e-mail e adiou a revisão
  de segurança. A troca é pequena (mesma outbox, mesma tela "Crie sua senha").

## Consequências
- **Risco registrado (decisão do dono do produto):** senha em e-mail pode ser lida por quem tiver acesso à caixa; mitigado por 72 h,
  troca obrigatória e carga cifrada que some depois do envio.
- Login um pouco mais lento (duas conferências argon2id) para não revelar se há "Esqueci a senha" pendente.
- Cada módulo precisa marcar as rotas só do BKO que hoje aceitam vendedor, promotor ou supervisor (inventário por módulo).
- O APK antigo não mostra "Crie sua senha" (vê a mensagem do 403): o build único depois da T-0094 resolve.
- Convites pendentes da Equipe por CSV são revogados pela 0040; essas pessoas recebem acesso por "Enviar acesso" ou "Esqueci a senha".
- Sem SMTP configurado, a criação de usuário no BKO funciona (o admin passa a senha) e a Equipe por CSV recusa gravar (503).
- O dono do produto precisa criar os secrets `MACUXI_SMTP_*` da demo e da produção (lista no desenho da N5).

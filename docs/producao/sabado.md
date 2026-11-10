# Produção — roteiro de sábado, 14/11/2026

Virada para a produção com o cliente real. Base técnica: `docs/status/producao.md` (T-0086) e os workflows `producao-publicar`, `producao-tenant` e `producao-ensaio-restauracao`. Dono deste roteiro: gerente-projetos (T-0157).

Horários de Manaus (UTC−4). O backup automático roda às 06:15 UTC, 02:15 em Manaus.

## 1. O que precisa estar pronto até quarta, 11/11, 18h

Sem estes itens, o ensaio de quinta não acontece e sábado não fecha. Marque cada um e mande ao gerente um recado com "recursos da produção prontos".

### 1.1 Magalu Cloud
- [ ] **VM `macuxi-prod-se1`**: Ubuntu 24.04, região br-se1, disco de 40 GB ou mais, na mesma VPC do banco. Grupo de segurança só com a porta 22.
- [ ] **Chave SSH só da produção** (ex.: `macuxi-prod-deploy`), com a pública no `authorized_keys` do usuário `ubuntu`.
- [ ] **DBaaS `macuxi-prod-db`**: PostgreSQL 16, 2 vCPU e 8 GB, mesma VPC, criptografia em repouso. Anotar IP privado, usuário admin e senha. Baixar o PEM da CA, se o console oferecer. Não criar banco nem papel.
- [ ] **Bucket `macuxi-prod`**: privado, br-se1, com uma chave de Object Storage de leitura e escrita nele.

### 1.2 Domínio e DNS (Cloudflare, `macuxifdv.com.br`)
- [ ] **Túnel `macuxi-prod`** com três hostnames públicos: `api.` → `http://api:8100`; `bko.` → `http://bko:3100`; `config.` → `http://bko:3100`. Copiar o token.
- [ ] **Registros do e-mail** que a Brevo pedir para o domínio remetente: SPF, DKIM e DMARC (`p=none` até o primeiro envio dar certo; depois `p=quarantine`).

### 1.3 Brevo (e-mail)
- [ ] Conta criada e domínio `macuxifdv.com.br` autenticado (selo verde no painel da Brevo).
- [ ] Remetente `nao-responda@macuxifdv.com.br` cadastrado.
- [ ] Chave SMTP gerada (Brevo → SMTP e API → SMTP). Anotar servidor, porta, login e chave.

### 1.4 GitHub, environment `PRODUCAO`
- [ ] Settings → Environments → `PRODUCAO`: revisor obrigatório `aloirr`; "Prevent self-review" desligado; regra de tag `v*`.
- [ ] Secrets obrigatórios: `PROD_SSH_KEY`, `PROD_HOST`, `PROD_USER` (`ubuntu`), `PROD_PG_HOST`, `PROD_PG_ADMIN_USUARIO`, `PROD_PG_ADMIN_SENHA`, `PROD_S3_KEY_ID`, `PROD_S3_SECRET`, `PROD_CLOUDFLARE_TUNNEL_TOKEN`.
- [ ] Secrets recomendados: `PROD_PG_CA_CERT` (TLS com conferência do certificado), `PROD_SSH_KNOWN_HOSTS`, `PROD_ALERTA_WEBHOOK` (ntfy.sh ou Slack).
- [ ] `PROD_TENANT_ADMIN_SENHA`: senha inicial do admin do cliente. Mínimo de 8 caracteres, com letra, número e caractere especial (RN-CORE-32). O admin troca no primeiro acesso.
- [ ] E-mail: `PROD_SMTP_HOST` (`smtp-relay.brevo.com`), `PROD_SMTP_PORTA` (`587`), `PROD_SMTP_TLS` (`starttls`), `PROD_SMTP_USUARIO` (login SMTP da Brevo), `PROD_SMTP_SENHA` (chave SMTP), `PROD_SMTP_REMETENTE` (`Macuxi FDV <nao-responda@macuxifdv.com.br>`).

> **Pendência do nosso lado:** o `producao-publicar.yml` ainda não leva os `PROD_SMTP_*` para a VM (`scripts/deploy/producao/env.modelo`, linhas 34–42). O engenheiro-software manda o diff do workflow para o seu ok até quinta. Sem ele, a produção sobe com o e-mail desligado: o BKO mostra a senha inicial ao admin uma vez, para ele repassar ao usuário, e a importação da equipe por CSV não grava.

### 1.5 Dados do tenant real
- [ ] **Código da empresa** (curto, minúsculo, sem espaço; é o que cada usuário digita no login) e **nome da empresa**.
- [ ] **Fuso** (padrão `America/Manaus`).
- [ ] **Módulos contratados** e licenças por módulo (ex.: `vendedor=12,promotor=3`).
- [ ] **Admin do cliente**: nome e e-mail.
- [ ] **Usuários iniciais**: nome, e-mail, perfil e supervisor de cada vendedor. Planilha no modelo do cartão "Equipe" do portal `config.` (aba Bases).
- [ ] **Parâmetros que fogem do padrão**: alçadas (padrão 5%, 10% e 15%), desconto máximo do produto (15%), raio do check-in (200 m), dias de título vencido (5), frete padrão (CIF). Só o desconto máximo tem tela no BKO; o resto o engenheiro-software grava antes de sábado.
- [ ] **Logo da distribuidora** para o PDF (PNG).

### 1.6 ERP e Conector do cliente
- [ ] **Qual ERP** e qual banco (SQL Server 2012+, PostgreSQL 12+ ou Oracle 11g R2+), com host e porta dentro da rede do cliente.
- [ ] **Servidor Windows** (Server 2016+ ou 10/11, 64 bits) para o Conector, com saída HTTPS (443) liberada para `api.macuxifdv.com.br`, relógio em NTP e 200 MB livres.
- [ ] **Usuário de banco só de leitura** nas views do Macuxi (nunca `sa` ou `postgres`), com escrita só na tabela ou procedure de entrada de pedidos.
- [ ] **Views criadas** a partir de `db/conector/views-modelo.sql`, ou a lista de tabelas do ERP para o modulo-integracao montar as views.
- [ ] **Acesso remoto** ao servidor (AnyDesk, TeamViewer ou VPN) e **um contato do TI do cliente** disponível no sábado, das 8h às 17h.
- [ ] **Plano B**: planilhas de vendedores, clientes, produtos, preços e estoque no modelo da carga por arquivo, caso o Conector não fique pronto no sábado.

## 2. Antes de sábado (quinta e sexta)
| Quando | O quê | Quem |
|---|---|---|
| Qui 12/11 | Ensaio completo nos recursos criados: publicar uma tag de ensaio, criar o tenant `teste-macuxi`, carga inicial de teste e ensaio de restauração com resultado `IGUAL` | gerente, engenheiro-software, banco-dados |
| Qui 12/11 | Conector instalado no servidor do cliente e `testar-conexao` sem erro, apontando para a produção | modulo-integracao com o TI do cliente |
| Sex 13/11 | v1.0.5 oficial no `main`, com CI e "demo — publicar" verdes | gerente |
| Sex 13/11 | APKs Campo-Oficial-v1.0.5 e Gestao-Oficial-v1.0.5 (perfis EAS `campo-producao` e `gestao-producao`) gerados a partir do commit da v1.0.5 e testados no tenant `teste-macuxi` | engenheiro-apps |
| Sex 13/11, até 20h | Alexandre dá o ok da v1.0.5 | Alexandre |

O tenant `teste-macuxi` do ensaio continua na produção para suporte e não recebe dado real.

## 3. Sábado, passo a passo

Cada passo só começa com a conferência do anterior feita. Se a conferência falhar, aplique a coluna "Se falhar" e avise o gerente antes de seguir.

| Hora | Passo | Quem | Conferência | Se falhar |
|---|---|---|---|---|
| 07:00 | **1. Abertura.** `git pull` do `main`, CI do commit da v1.0.5 verde, recado de início a `todos` | gerente | Commit da tag = commit do ok de sexta | Não começa. Gerente propõe ao Alexandre adiar para domingo. |
| 07:15 | **2. Publicar a v1.0.5.** `git tag -a v1.0.5 <sha> -m "v1.0.5: produção"` e `git push origin v1.0.5`. Se a tag já subiu na sexta, só conferir o run | gerente | Actions → "producao — publicar": jobs `conferir` e `bko` verdes; `deploy` esperando aprovação | `conferir` vermelho: o commit não tem CI verde ou a imagem da API não existe. Rodar "demo — publicar" no commit e repetir. |
| 07:30 | **3. Aprovar o deploy** no run (Review deployments → `PRODUCAO` → Approve) | Alexandre | Resumo do run: `publicado: v1.0.5`, `api.macuxifdv.com.br: v1.0.5 no ar`, `bko.macuxifdv.com.br: ok` | Run vermelho com "a produção VOLTOU para a versão anterior": nada muda para o usuário. O engenheiro-software lê o log, corrige e o gerente publica `v1.0.5-1`. |
| 07:50 | **4. Saúde.** Abrir `https://api.macuxifdv.com.br/v1/saude`, `https://bko.macuxifdv.com.br/login` e `https://config.macuxifdv.com.br` | engenheiro-software | `"versao":"v1.0.5"`, `"banco":"ok"`, `"alertas":[]`; BKO e portal abrem; login de super-admin com senha errada responde 401, nunca 503 | 503 `PORTAL_INDISPONIVEL`: falta o `portal.env` na VM; rodar de novo o deploy (Re-run all jobs). Fora do ar: conferir o túnel na Cloudflare. |
| 08:10 | **5. Criar o tenant, simulando.** Actions → "producao — criar tenant" → Run workflow, com `simular` marcado e os dados do item 1.5 | gerente; aprovação do Alexandre | Linha JSON com o código certo, os módulos certos e o e-mail do admin mascarado | Corrigir os campos e rodar de novo. Nada foi gravado. |
| 08:30 | **6. Criar o tenant de verdade.** O mesmo run, com `simular` desmarcado | gerente; aprovação do Alexandre | `"resultado":"criado"` | Erro de dado (nome, módulo): rodar de novo com o código igual; o comando só acrescenta o que falta, não duplica. Código errado: não usar; banco-dados inativa o tenant à mão. |
| 08:45 | **7. Primeiro acesso do admin do cliente** no BKO, com o código da empresa, o e-mail do admin e a senha de `PROD_TENANT_ADMIN_SENHA` | Alexandre com o admin do cliente | BKO pede "Crie sua senha"; depois da troca, o menu abre | Senha recusada: conferir o secret e rodar o passo 6 de novo com redefinição de senha (pedido ao engenheiro-software). |
| 09:00 | **8. Cadastros do pedido** no BKO: formas de pagamento e prazos (se o ERP não manda) e transportadoras. Alçadas, frete padrão e raio do check-in não têm tela: o que fugir do padrão vai ao engenheiro-software até sexta | admin do cliente, com o Alexandre | Cadastros salvos; o pedido de teste do passo 12 mostra a forma, o prazo e a alçada certos | Corrigir pela mesma tela; a mudança fica na Auditoria. |
| 09:30 | **9. Chave do Conector.** Portal `config.` → empresa → aba **Integração automática** → **Gerar credencial**; copiar a chave (aparece uma vez só) e gravar no servidor do cliente com `segredo definir hub_chave` | Alexandre e modulo-integracao | `testar-conexao` sem erro contra `api.macuxifdv.com.br` | Chave perdida: gerar outra credencial no portal e gravar de novo. |
| 09:45 | **10. Carga inicial.** Iniciar o serviço "Macuxi Conector". Ordem: vendedores → clientes → rotas, títulos e notas; produtos → preços → estoque | modulo-integracao | Monitor da integração: cada lote `concluido` ou `concluido_com_erros`; contagens batem com o ERP (o TI do cliente confere) | Erro por linha: corrigir na view e deixar o delta reenviar; `referencia_ausente` some ao reenviar a linha depois da entidade que faltava. Conector parado: plano B com a carga por arquivo. Inativação de mais de 30% parada para confirmar: só confirmar se a contagem estiver certa. |
| 11:30 | **11. Equipe.** Portal `config.` → aba **Bases** → cartão **Equipe**: **Conferir sem gravar** e **Importar equipe** com o CSV do item 1.5; ou BKO → Usuários → **Novo usuário**, um a um | Alexandre ou admin do cliente | Cada usuário recebe o e-mail "Seu acesso ao Macuxi" (caixa de entrada, não spam) | E-mail não chega: conferir SPF e DKIM na Brevo. Sem e-mail, o CSV não grava: criar pelo BKO, que mostra a senha uma vez para o admin repassar. |
| 13:00 | **12. Ponta a ponta** com um vendedor e um supervisor reais: login no Campo, sincronização, rota, check-in, pedido acima da alçada do vendedor, aprovação no Gestão, pedido na fila do ERP, Conector retira, número do ERP volta ao app. Pedido combinado antes com o TI do cliente e cancelado no ERP depois | testes, com o Alexandre no aparelho | Status no app: Enviado → Em aprovação → Aprovado → Recebido no ERP | Parou numa etapa: o dono dela corrige (vendedor, gestor ou integracao). Não distribuir APK até passar. |
| 15:00 | **13. Distribuir os APKs** Campo-Oficial-v1.0.5 e Gestao-Oficial-v1.0.5 à equipe, com `docs/manual/vendedor.md` e `docs/manual/supervisor.md` | engenheiro-apps manda os links; Alexandre repassa | Cada usuário abre, troca a senha e sincroniza; o Perfil mostra `Campo-Oficial-v1.0.5` ou `Gestao-Oficial-v1.0.5` | APK com defeito: suspender o link, gerar outro build do mesmo commit com a correção e uma nova tag. |
| 17:00 | **14. Fechamento.** Recado `entrega` ao Alexandre: o que entrou, contagens da carga, usuários ativos, pendências | gerente | Backup das 02:15 de domingo agendado; alerta de saúde ligado | — |
| Dom 15/11 | **15. Ensaio de restauração** do primeiro backup: Actions → "producao — ensaio de restauração" (`ultimo`) | banco-dados; aprovação do Alexandre | `[ensaio] resultado: IGUAL` | `DIFERENTE` ou falha: banco-dados investiga na segunda; a produção segue no ar. |

## 4. Como voltar atrás
- **Versão com defeito:** Actions → run da tag anterior → "Re-run all jobs" → aprovar. As migrações são aditivas e a versão anterior roda sobre o esquema novo.
- **Tirar tudo do ar na hora:** desligar os hostnames públicos do túnel `macuxi-prod` no painel da Cloudflare. VM e banco ficam como estão.
- **Dado errado na carga:** corrigir no ERP ou na view e deixar o delta reenviar. O Macuxi inativa, não apaga. Restaurar o banco inteiro é manual, com o banco-dados e o Alexandre, a partir do backup.
- **VM perdida:** recriar com a mesma chave e rodar de novo o run da tag em uso. Todos entram de novo no app, e as chaves do Conector são geradas outra vez.

## 5. Contatos do dia
| Quem | Para quê |
|---|---|
| Alexandre | aprovações no GitHub, dados do cliente, decisão de adiar |
| gerente-projetos | ordem dos passos, tag, recados |
| engenheiro-software | deploy, VM, saúde, portal |
| banco-dados | tenant errado, backup, restauração |
| modulo-integracao | Conector, carga, monitor |
| engenheiro-apps | APKs |
| testes | ponta a ponta |
| TI do cliente | servidor do Conector, views, banco do ERP |

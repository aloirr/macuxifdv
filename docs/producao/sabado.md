# Produção — roteiro de sábado, 14/11/2026

Virada para a produção com o cliente real. A referência técnica (recursos, secrets, workflows, volta atrás) é o `docs/status/producao.md`; aqui fica só a ordem do dia. Dono deste roteiro: gerente-projetos (T-0157).

Horários de Manaus (UTC−4). Versão: **v1.0.5**, builds Campo-Oficial-v1.0.5 e Gestao-Oficial-v1.0.5 (cronograma do doc 05, R-20261109-125750).

## 1. O que precisava estar pronto até quarta, 11/11, 18h
Prazo do cronograma (doc 05). O que faltar até sexta à noite adia o sábado. Ao fechar a lista, mande ao gerente um recado com "recursos da produção prontos".

### 1.1 Recursos e secrets (detalhes em `docs/status/producao.md` §4)
- [ ] VM `macuxi-prod-se1` e chave SSH só da produção (item 1)
- [ ] DBaaS `macuxi-prod-db` (item 2)
- [ ] Bucket `macuxi-prod` e chave de Object Storage (item 3)
- [ ] Túnel `macuxi-prod` com `api.`, `bko.` e `config.` (item 4)
- [ ] Environment `PRODUCAO` com a regra de tag `v*` (item 5)
- [ ] Secrets do environment, inclusive `PROD_SUPERADMIN_SENHA` e os `PROD_SMTP_*` (item 6)

### 1.2 Brevo (e-mail)
- [ ] Conta criada e domínio `macuxifdv.com.br` autenticado (selo verde no painel da Brevo).
- [ ] Registros SPF, DKIM e DMARC que a Brevo pedir, na Cloudflare (`p=none` até o primeiro envio dar certo; depois `p=quarantine`).
- [ ] Remetente `nao-responda@macuxifdv.com.br` cadastrado.
- [ ] Chave SMTP gerada (Brevo → SMTP e API → SMTP) e gravada nos secrets `PROD_SMTP_*`.

### 1.3 Dados da empresa cliente
- [ ] **Código da empresa** (minúsculas, números e hífen; não muda depois; é o que cada usuário digita no login), **razão social** e **fuso** (padrão Manaus).
- [ ] **Módulos contratados** e licenças por módulo.
- [ ] **Alçadas** (padrão 5%, 10% e 15%) e **validade do preço do orçamento** (padrão 7 dias).
- [ ] **Admin do cliente**: nome, e-mail e senha inicial.
- [ ] **Filiais**: código, nome, CNPJ e endereço de cada uma, e a filial de cada cliente.
- [ ] **Usuários iniciais**: nome, e-mail, perfil e equipe de cada um, no modelo do cartão "Equipe" do portal (aba Bases).
- [ ] **Tipos de foto do PDV** que a empresa exige além da fachada (ex.: CNH do sócio, contrato social).
- [ ] **Outros parâmetros**, se fugirem do padrão: desconto máximo do produto (15%), raio do check-in (200 m), dias de título vencido (5), frete padrão (CIF). Só o desconto máximo tem tela; o resto o engenheiro-software grava antes de sábado.
- [ ] **Logo da distribuidora** para o PDF (PNG).

### 1.4 ERP e Conector do cliente
- [ ] **Qual ERP** e qual banco (SQL Server 2012+, PostgreSQL 12+ ou Oracle 11g R2+), com host e porta dentro da rede do cliente.
- [ ] **Servidor Windows** (Server 2016+ ou 10/11, 64 bits) para o Conector, com saída HTTPS (443) liberada para `api.macuxifdv.com.br`, relógio em NTP e 200 MB livres.
- [ ] **Usuário de banco só de leitura** nas views do Macuxi (nunca `sa` ou `postgres`), com escrita só na tabela ou procedure de entrada de pedidos.
- [ ] **Views criadas** a partir de `db/conector/views-modelo.sql` do Conector 1.4.0 (com filial, frete, entrega e pagamento), ou a lista de tabelas do ERP para o modulo-integracao montar as views.
- [ ] **Acesso remoto** ao servidor (AnyDesk, TeamViewer ou VPN) e **um contato do TI do cliente** disponível no sábado, das 8h às 17h.
- [ ] **Plano B**: as bases em CSV no modelo da aba Bases do portal (filiais, vendedores, clientes, produtos, preços, estoque), caso o Conector não fique pronto.

## 2. Antes de sábado
| Quando | O quê | Quem |
|---|---|---|
| Qui 12/11 | Ensaio completo nos recursos criados: publicar uma tag de ensaio, criar o super-admin e a empresa `teste-macuxi`, carga inicial de teste e ensaio de restauração com resultado `IGUAL` | gerente, engenheiro-software, banco-dados |
| Qui 12/11 | Conector 1.4.0 instalado no servidor do cliente e `testar-conexao` sem erro, apontando para a produção | modulo-integracao com o TI do cliente |
| Sex 13/11 | v1.0.5 oficial no `main`, com CI e "demo — publicar" verdes | gerente |
| Sex 13/11 | APKs Campo-Oficial-v1.0.5 e Gestao-Oficial-v1.0.5 (perfis EAS `campo-producao` e `gestao-producao`) gerados do commit da v1.0.5 e testados na empresa `teste-macuxi` | engenheiro-apps |
| Sex 13/11, até 20h | Recado do Alexandre com "aprovo deploy v1.0.5" (R-20261111-213829) | Alexandre |

A empresa `teste-macuxi` do ensaio fica na produção para suporte e não recebe dado real.

## 3. Sábado, passo a passo
Cada passo só começa depois de conferido o anterior. Se a conferência falhar, siga a coluna "Se falhar" e avise o gerente antes de continuar.

| Hora | Passo | Quem | Conferência | Se falhar |
|---|---|---|---|---|
| 07:00 | **1. Abertura.** `git pull` do `main`; conferir o CI verde do commit da v1.0.5 e o recado "aprovo deploy v1.0.5"; recado de início a `todos` | gerente | Commit da tag = commit aprovado | Sem o recado ou com o CI vermelho, não começa. Gerente propõe ao Alexandre adiar para domingo. |
| 07:15 | **2. Publicar a v1.0.5.** `git tag -a v1.0.5 <sha> -m "v1.0.5: produção (<ID do recado de aprovação>)"` e `git push origin v1.0.5`. Se a tag subiu na sexta, só conferir o run | gerente | Actions → "producao — publicar" verde; resumo com `publicado: v1.0.5`, `api.macuxifdv.com.br: v1.0.5 no ar`, `bko.macuxifdv.com.br: ok`; no log, "e-mail: SMTP ligado" | `conferir` vermelho: falta CI ou imagem do commit; rodar "demo — publicar" nele e repetir. "A produção VOLTOU para a versão anterior": nada mudou para o usuário; o engenheiro-software corrige e o Alexandre aprova a `v1.0.5-1` por recado. |
| 07:45 | **3. Saúde.** Abrir `https://api.macuxifdv.com.br/v1/saude`, `https://bko.macuxifdv.com.br/login` e `https://config.macuxifdv.com.br` | engenheiro-software | `"versao":"v1.0.5"`, `"banco":"ok"`, `"alertas":[]`; BKO e portal abrem | 503 `PORTAL_INDISPONIVEL`: falta o `portal.env` na VM; rodar o deploy de novo (Re-run all jobs). Fora do ar: conferir o túnel na Cloudflare. |
| 08:00 | **4. Super-admin.** Actions → "producao — super-admin" → `criar`, com o e-mail do Alexandre, primeiro com `simular` e depois sem | gerente | Linha JSON sem erro; o Alexandre entra no `config.` com esse e-mail e o `PROD_SUPERADMIN_SENHA`; senha errada responde 401 | Senha recusada pela regra: trocar o secret e repetir. Já existe: usar `redefinir`. |
| 08:15 | **5. Empresa.** Portal `config.` → **Empresas** → **Nova empresa**: código, razão social, fuso, **Módulos e licenças**, **Parâmetros iniciais** (alçadas e validade do orçamento) e **Administrador da empresa** (nome, e-mail, senha inicial) → **Criar empresa** | Alexandre | "Empresa criada" e "Administrador criado: <e-mail>" | Dado errado: corrigir na aba **Empresa**. Código errado não muda: banco-dados inativa à mão e o passo recomeça com outro código. Portal fora: plano B pelo workflow "producao — criar tenant" (`simular` primeiro). |
| 08:30 | **6. Primeiro acesso do admin** no BKO, com o código da empresa, o e-mail e a senha inicial | admin do cliente, com o Alexandre | BKO pede "Crie sua senha"; depois da troca, o menu abre | Senha recusada: **Redefinir senha** no cartão Administradores do portal. |
| 08:45 | **7. Cadastros que não vêm do ERP**, no BKO: **Fotos do PDV** (tipos além da fachada) e **Transportadoras** | admin do cliente | Tipos de foto ativos; transportadoras na lista | Corrigir pela mesma tela. |
| 09:00 | **8. Chave do Conector.** Portal → empresa → **Integração automática** → **Gerar credencial**; copiar a chave (aparece uma vez só) e gravar no servidor do cliente com `segredo definir hub_chave` | Alexandre e modulo-integracao | `testar-conexao` sem erro contra `api.macuxifdv.com.br` | Chave perdida: gerar outra credencial no portal e gravar de novo. |
| 09:15 | **9. Carga inicial.** Iniciar o serviço "Macuxi Conector". O Hub aplica na ordem: filiais e vendedores → clientes → endereços, rotas, títulos e notas; árvore do catálogo e produtos → preços → estoque | modulo-integracao | Monitor da integração: lotes **Aplicado** ou **Aplicado com erros**; contagens batem com o ERP (o TI do cliente confere) | Erro por linha: corrigir na view e deixar o delta reenviar; a referência ausente some ao reenviar a linha depois da entidade que faltava. Conector parado: plano B pelas **Bases** do portal (**Conferir sem gravar** antes de **Importar**). Inativação de mais de 30% parada: só confirmar se a contagem estiver certa. |
| 11:00 | **10. Filiais e formas**, no BKO: completar as filiais com o selo **Incompleta** (CNPJ e endereço) e escolher a **Padrão**; cadastrar **Formas de pagamento e prazos** só se a carga não trouxe | admin do cliente | Nenhuma filial "Incompleta"; cada cliente com filial; forma e prazo aparecem no Novo pedido | Corrigir pela mesma tela. Pedido retido por forma sem de-para: **De-para de códigos** no monitor. |
| 11:30 | **11. Equipe.** Portal → aba **Bases** → cartão **Equipe**: **Conferir sem gravar** e **Importar equipe**; ou BKO → Usuários → **Novo usuário**, um a um | Alexandre ou admin do cliente | Cada usuário recebe o e-mail "Seu acesso ao Macuxi" (caixa de entrada, não spam) | E-mail não chega: conferir SPF e DKIM na Brevo. Sem e-mail, o CSV não grava: criar pelo BKO, que mostra a senha uma vez para o admin repassar. |
| 13:00 | **12. Ponta a ponta** com um vendedor e um supervisor reais: permissões, login no Campo, carga, rota, check-in, foto do PDV, pedido acima da alçada, aprovação no Gestão, pedido na fila do ERP, Conector retira, número do ERP volta ao app, PDF com os dados da filial. Pedido combinado antes com o TI do cliente e cancelado no ERP depois | testes, com o Alexandre no aparelho | Histórico no app: Enviado → Em aprovação → Aprovado → Recebido no ERP | Parou numa etapa: o dono dela corrige (vendedor, gestor ou integracao). Não distribuir APK até passar. |
| 15:00 | **13. Distribuir os APKs** Campo-Oficial-v1.0.5 e Gestao-Oficial-v1.0.5 à equipe, com `docs/manual/vendedor.md` e `docs/manual/supervisor.md`; `docs/manual/admin-bko.md` para o admin. Antes, o gerente tira dos manuais as marcas "(conferir na v1.0.5)" | engenheiro-apps manda os links; Alexandre repassa | Cada usuário passa pela tela Permissões, troca a senha e sincroniza; o Perfil mostra `Campo-Oficial-v1.0.5` ou `Gestao-Oficial-v1.0.5` | APK com defeito: suspender o link e gerar outro build com a correção e uma nova tag aprovada. |
| 17:00 | **14. Fechamento.** Recado `entrega` ao Alexandre: o que entrou, contagens da carga, usuários ativos, pendências | gerente | Backup das 02:15 de domingo (06:15 UTC) agendado; alerta de saúde ligado | — |
| Dom 15/11 | **15. Ensaio de restauração** do primeiro backup: Actions → "producao — ensaio de restauração" (`ultimo`) | banco-dados | `[ensaio] resultado: IGUAL` | `DIFERENTE` ou falha: banco-dados investiga na segunda; a produção segue no ar. |

## 4. Como voltar atrás
Resumo para o dia; os detalhes estão no `docs/status/producao.md` §6.
- **Versão com defeito:** Actions → run da tag anterior → "Re-run all jobs", com o recado de aprovação daquela versão.
- **Tirar tudo do ar na hora:** desligar os hostnames públicos do túnel `macuxi-prod` no painel da Cloudflare. VM e banco ficam como estão.
- **Dado errado na carga:** corrigir no ERP ou na view e deixar o delta reenviar. O Macuxi inativa, não apaga.
- **VM perdida:** recriar com a mesma chave e rodar de novo o run da tag em uso.

## 5. Contatos do dia
| Quem | Para quê |
|---|---|
| gerente-projetos | ordem dos passos, tag, workflows, recados |
| engenheiro-software | deploy, VM, saúde, portal |
| banco-dados | empresa errada, backup, restauração |
| modulo-integracao | Conector, carga, monitor |
| engenheiro-apps | APKs |
| testes | ponta a ponta |
| TI do cliente | servidor do Conector, views, banco do ERP |

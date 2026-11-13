# Produção — roteiro de ligar (T-0086)

Fonte: docs/desenho/T-0086.md §4–§6 (engenheiro-software). Atualizado pelo gerente em 07/11 8h.

**Estado em 07/11 8h:** tudo do lado do código está no `main`. Nada é ligado até o recado do Alexandre dizendo que criou os recursos (R-20261106-182000).

## O que mudou desde 06/11
- **Workflows no `main`, com o ok do Alexandre** (R-20261106-182000, itens 1 e 2): `producao-publicar.yml` (já lê o `PROD_SUPERADMIN_CONVITE`), `producao-tenant.yml`, `producao-ensaio-restauracao.yml` e o job `stack-producao` do CI.
- **Migrações novas que o 1º deploy aplica:**
  - `0037_forma_prazo_escalonada`: formas de pagamento, prazos e tabela escalonada da T-0089. Cada tenant ganha a forma `AVISTA`.
  - `0038_plataforma_papel_portal`: o papel `macuxi_portal` da T-0091, o único que executa as funções de super-admin.
  - As duas são aditivas.
- **Senha do portal (T-0091):** o `preparar-vm.sh` gera a senha do `macuxi_portal` na VM, num arquivo próprio (`/opt/macuxi/portal.env`, modo 600). Só a `api` e o passo de papéis leem esse arquivo. **Não há secret novo para o Alexandre.** Sem o arquivo, o `implantar.sh` para antes de subir.
- **App com SQLite (T-0088):** o APK de produção sai de um commit igual ou mais novo que o `e9a65286`, que já inclui a correção do "+" (`56b89a1`, item 7 do R-20261106-182000).
  - Na 1ª abertura, o app passa os dados do armazenamento antigo para o banco do aparelho, com a tela "Preparando o aparelho". Num aparelho novo, isso é instantâneo.
  - A T-0088 não tem atualização pelo ar (OTA): toda mudança dela exige um APK novo.
- **Pendência antes do 1º cliente real:** a T-0091 está no `main`. Falta o ok do Alexandre nas conferências extras do `stack-isolado.yml` (`docs/desenho/T-0091-stack-isolado.diff`), que estão em ajuste com o engenheiro-software.

## 4. O que o Alexandre faz (quando for ligar)

**1. VM `macuxi-prod-se1`**
- Ubuntu 24.04, br-se1, na **mesma VPC do DBaaS** e com disco de 40 GB ou mais.
- Grupo de segurança só com a porta **22**. O túnel é conexão de saída, então nenhuma outra porta abre.
- Chave SSH **nova, só da produção** (por exemplo `macuxi-prod-deploy`). A pública vai para o `authorized_keys` do usuário `ubuntu`.

**2. DBaaS `macuxi-prod-db`**
- PostgreSQL 16, 2 vCPU e 8 GB, na mesma VPC, com criptografia em repouso.
- Anote três coisas: o **IP privado**, o **usuário admin** e a **senha**.
- Se o console oferecer o **certificado da CA**, baixe o PEM.
- Não crie banco nem papel: o deploy faz isso.

**3. Bucket `macuxi-prod`**
- Bucket privado, em br-se1.
- Crie uma chave de Object Storage com leitura e escrita nele.

**4. Túnel `macuxi-prod` na Cloudflare**
Crie três hostnames públicos:

| Hostname | Serviço |
|---|---|
| `api.macuxifdv.com.br` | `http://api:8100` |
| `bko.macuxifdv.com.br` | `http://bko:3100` |
| `config.macuxifdv.com.br` | `http://bko:3100` |

Copie o **token** do túnel.

**5. Environment `PRODUCAO` no GitHub** (Settings → Environments)
- **Deployment branches and tags:** "Selected", com uma regra do tipo **Tag** (não Branch) e o padrão `v*`. Com regra do tipo Branch, o deploy da tag é recusado (run 43202585068, tentativas 1 e 2; R-20261112-065035).
- **Rotas do túnel conferidas no deploy v1.0.0:** api→`:8100`, bko e config→`:3100` (R-20261112-073908).
- **Aprovação do deploy (R-20261111-213829, opção 2):** o GitHub Pro não oferece "Required reviewers" em repositório privado. A trava é por recado: nenhuma tag `v*` e nenhum run do "producao — publicar" sem um recado do Alexandre com "aprovo deploy vX.Y.Z" para aquela versão exata. O gerente cita o ID desse recado na mensagem da tag.

**6. Secrets do environment `PRODUCAO`** (os nomes são exatos)

| Secret | Obrigatório | Valor |
|---|---|---|
| `PROD_SSH_KEY` | sim | chave **privada** SSH da produção (texto OpenSSH inteiro) |
| `PROD_HOST` | sim | IP público da VM |
| `PROD_USER` | sim | `ubuntu` (o usuário de deploy) |
| `PROD_PG_HOST` | sim | IP **privado** do DBaaS |
| `PROD_PG_ADMIN_USUARIO` | sim | usuário admin do DBaaS |
| `PROD_PG_ADMIN_SENHA` | sim | senha do admin do DBaaS |
| `PROD_S3_KEY_ID` | sim | ID da chave do Object Storage |
| `PROD_S3_SECRET` | sim | segredo da chave do Object Storage |
| `PROD_CLOUDFLARE_TUNNEL_TOKEN` | sim | token do túnel `macuxi-prod` |
| `PROD_PG_PORTA` | não | porta do DBaaS (padrão 5432) |
| `PROD_PG_CA_CERT` | não, recomendado | PEM da CA do DBaaS. Com ele, o TLS confere o certificado (`verify-full`) |
| `PROD_SSH_KNOWN_HOSTS` | não | linha `ssh-ed25519` da VM. Sem ele, vale a 1ª conexão (keyscan) |
| `PROD_ALERTA_WEBHOOK` | não | URL de um tópico do ntfy.sh ou de um webhook do Slack/Discord para os alertas |
| `PROD_SUPERADMIN_SENHA` | sim, para entrar no `config.` | senha do seu 1º acesso de super-admin (ADR 0031; substitui o antigo `PROD_SUPERADMIN_CONVITE`, que **não** deve ser criado). Os segredos de sessão e TOTP do portal são gerados pelo `preparar-vm.sh` na VM. |
| `PROD_SMTP_HOST` | sim, para o e-mail de 1º acesso | Brevo: `smtp-relay.brevo.com` |
| `PROD_SMTP_USUARIO` | sim, com o Brevo | login SMTP do Brevo |
| `PROD_SMTP_SENHA` | sim, com o Brevo | chave SMTP do Brevo |
| `PROD_SMTP_PORTA` | não | padrão 587 |
| `PROD_SMTP_TLS` | não | padrão `starttls` |
| `PROD_SMTP_REMETENTE` | não | ex.: `Macuxi FDV <nao-responda@macuxifdv.com.br>`, com o domínio validado no Brevo |
| `MACUXI_RECADOS_TOKEN_SERVIDOR` | não | token do remetente de sistema `diagnostico` (alerta por recado) |
| `PROD_TENANT_ADMIN_SENHA` | não, plano B | a empresa nasce no `config.` pelo super-admin (RN-CORE-34); o workflow `producao-tenant` é só plano B |

Os `PROD_SMTP_*` só passam a valer quando o patch `docs/desenho/T-0086-smtp-producao.patch` entrar pelo rito (ver o recado do gerente). Lista conferida pelo engenheiro-software em R-20261111-205903.

**7. Avise o gerente** quando terminar. Depois disso, ele só precisa de você para **aprovar** os runs do `PRODUCAO`.

## 5. Depois do aviso: o que o gerente faz

**1. Escolher o commit.** Ele tem de cumprir três condições:
- estar no `main`;
- ter CI verde;
- ter o "demo — publicar" verde, porque é esse workflow que publica a `macuxi-api:<sha>`. O ideal é o commit que está na demo.

**2. Criar e enviar a tag** (o git é só dele):
```
git tag -a v1.0.0 <sha> -m "v1.0.0: primeira produção"
git push origin v1.0.0
```

**3. Acompanhar o run e pedir a aprovação.** Em Actions → "producao — publicar", os jobs `conferir` e `bko` rodam sozinhos. O `deploy` espera a aprovação: peça ao Alexandre.

**4. Conferir o resultado:**
- o resumo do run termina com `publicado: v1.0.0`, `api.macuxifdv.com.br: v1.0.0 no ar` e `bko.macuxifdv.com.br: ok`;
- `https://api.macuxifdv.com.br/v1/saude` mostra `"versao":"v1.0.0"`, `"banco":"ok"` e `"alertas":[]`;
- `https://bko.macuxifdv.com.br/login` e `https://config.macuxifdv.com.br` abrem;
- o portal está no ar com o papel próprio: um login de super-admin com credencial errada responde **401**, nunca 503 `PORTAL_INDISPONIVEL`. O 503 indica que faltam na VM o `portal.env` ou os segredos de sessão e TOTP do portal;
- os avisos (`::warning::`) do log merecem atenção: TLS sem CA, sonda do S3 e backup ainda sem script.

**4.1. Criar o super-admin:** Actions → "producao — super-admin" → Run workflow, com **"Use workflow from" na tag** (por exemplo, `v1.0.0`). O environment PRODUCAO recusa o `main` (run 43233282443).
- Rode primeiro com `simular` marcado (run 43242230426, verde).
- Depois rode sem `simular`, com o e-mail confirmado pelo Alexandre.
- Vale o mesmo para todo workflow do environment PRODUCAO.
- **Feito em 12/11/2026, 12h10 (Manaus):**
  - run 43255786492 verde, a partir da tag v1.0.0, ação `criar`, sem simular;
  - e-mail `superadmin@macuxifdv.com.br`, nome "Super-admin Macuxi", aprovados pelo Alexandre (R-20261112-121130);
  - saída: `resultado: criado`, `sessoes_revogadas: 0`.
- **Depois do 1º acesso:** o Alexandre troca o secret `PROD_SUPERADMIN_SENHA`.

**5. Criar o tenant de teste:** Actions → "producao — criar tenant" → Run workflow. Precisa da aprovação do Alexandre.
- **1ª vez, com `simular` marcado:** o tenant não é gravado. Confira a linha JSON.
- **2ª vez, sem `simular`:** o tenant é criado, e a saída mostra `"resultado":"criado"`. Exemplo de valores: código `teste-macuxi`, módulos `core,catalogo,vendedor,promotor`.

**6. Pedir o APK.** O APK de produção é do engenheiro-apps. Ele usa os perfis EAS `campo-producao` e `gestao-producao` de `apps/mobile/eas.json`, e o pacote tem estas características:
- APK com link de instalação direto;
- assinatura pela EAS, sem keystore no repositório;
- API `https://api.macuxifdv.com.br/v1`, sem o campo Servidor no login.

Os builds rodam a partir do commit da tag, depois de `pnpm install --frozen-lockfile`, em `apps/mobile`:
```
npx eas-cli build --platform android --profile campo-producao  --non-interactive --no-wait
npx eas-cli build --platform android --profile gestao-producao --non-interactive --no-wait
```
Antes de testar, saiba de três coisas:
- **O admin não entra nos apps.** Para provar o APK no tenant de teste, é preciso um vendedor (Campo) e um supervisor (Gestão). O passo a passo de criação está com o engenheiro-software (R-20261105-233818).
- **O APK de produção instala por cima do de preview,** porque os dois têm o mesmo pacote. No mesmo aparelho, não dá para ter a demo e a produção ao mesmo tempo.
- **Os dados locais são separados por usuário,** então os da demo não se misturam com os da produção.

**Formas de pagamento (T-0089, no `main` desde o `5a1848a9`):**
- **Forma padrão:** todo tenant nasce com a forma "À vista", código `AVISTA`, prazo de 0 dias.
- **Tenant que integra ERP:** o ERP precisa mandar as formas e os prazos, ou de-para para `AVISTA`. Sem isso, o pedido com essa forma fica **retido** na fila do ERP.
- **Tenant que não integra:** cadastre as formas e os prazos no BKO, em Parâmetros → Formas de pagamento e prazos.

**7. Ensaiar a restauração** depois do primeiro backup (06:15 UTC do dia seguinte): Actions → "producao — ensaio de restauração". Precisa do script do banco-dados na imagem publicada.

## 6. Como voltar atrás
- **Automático:** se a versão nova não passa na conferência, o `implantar.sh` volta sozinho e o run sai vermelho com "a produção VOLTOU para a versão anterior". Os sinais de falha são:
  - `/v1/saude` sem `banco ok` ou sem a versão da tag;
  - BKO fora do ar.

  Se a falha acontece **antes** de subir (pull, banco, migração), nada da aplicação mudou.
- **Para uma versão anterior, à mão:** Actions → o run da **tag anterior** → "Re-run all jobs" → aprovação. O workflow publica de novo aquela imagem, pelo mesmo digest.
- **Migrações não voltam sozinhas.** Elas são aditivas, e a versão anterior roda sobre o esquema novo. Desfazer uma migração ou restaurar dados é manual: banco-dados com o Alexandre, partindo do ensaio de restauração.
- **Tirar a produção do ar já:** o Alexandre desliga os hostnames públicos do túnel `macuxi-prod` no painel da Cloudflare. A VM e o banco ficam intactos.
- **VM perdida:**
  1. crie a VM de novo com a mesma chave e rode outra vez o run da tag em uso;
  2. o `preparar-vm.sh` gera senhas novas, e o `migrar up` as grava nos papéis (B0);
  3. o JWT novo obriga os usuários a entrar de novo;
  4. o pepper novo exige reemitir as chaves do Conector.

# Produção — roteiro de ligar (T-0086)

Fonte: docs/desenho/T-0086.md §4–§6 (engenheiro-software). Atualizado pelo gerente em 05/11 23h.

## 4. Às 8h de 06/11: o que o Alexandre faz

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
- **Required reviewers:** aloirr.
- **Prevent self-review:** desligado. A tag é enviada pela mesma conta e, ligado, ele não conseguiria aprovar.
- **Deployment branches and tags:** "Selected", com a regra de tag `v*`.

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
| `PROD_TENANT_ADMIN_SENHA` | para o tenant de teste | senha inicial do admin do tenant de teste |
| `PROD_SUPERADMIN_CONVITE` | para o portal `config.` | convite do seu 1º acesso de super-admin (ADR 0029). Só você sabe o valor. O workflow passa a ler esse secret depois do seu ok na mudança do `producao-publicar.yml`. Os segredos de sessão e TOTP do portal são gerados pelo `preparar-vm.sh` na VM. |

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
- os avisos (`::warning::`) do log merecem atenção: TLS sem CA, sonda do S3 e backup ainda sem script.

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

**Formas de pagamento (T-0089, quando ela estiver no main):**
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

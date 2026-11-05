# Demonstração — app novo + API real (T-0026, T-0029, T-0038 e T-0074)

## Ambiente principal: Magalu Cloud, sempre ligado (T-0074, desde 04/11/2026)
A demo e a homologação rodam na VM `macuxi-demo-se1` (177.93.129.233, br-se1) e **não dependem do PC**. O PC fica só com desenvolvimento e com o Postgres de testes (5434).
- Endereços:
  - app: `https://api-demo.macuxifdv.com.br/v1` (já vem nos APKs de preview; não é preciso build nova);
  - BKO: `https://bko-demo.macuxifdv.com.br`.
- Na VM, pelo Docker Compose (`scripts/deploy/demo/compose.yml`):
  - `api` (8100), `worker`, `bko` (3100);
  - `postgres` (`pgvector/pgvector:pg16`), só na rede interna;
  - `cloudflared`, que liga o túnel `macuxi-demo-nuvem` pelo token.
- **Publicar:** todo push no `main` com CI verde dispara o workflow **demo — publicar** (`.github/workflows/demo-publicar.yml`). Ele monta as imagens no GHCR, roda as migrações, sobe o Compose e limpa as imagens velhas. Também dá para rodar manualmente em Actions.
- **Recriar a base demo:** workflow manual **demo — recriar base** (`demo-recriar-base.yml`), que pede para digitar `RECRIAR`.
- **Fotos e arquivos:** bucket privado `macuxi-demo-arquivos` (Object Storage da Magalu), pelo adaptador S3 (ADR 0010, complemento). A chave `macuxi-demo-s3` vale até 31/12/2026; o gerente avisa o dono do produto em 15/12 para renovar.
- **Segredos:** os do GitHub ficam no environment `DEMO_SSH_KEY`. JWT e senhas dos papéis do banco são gerados na própria VM, em `/opt/macuxi/.env` (modo 600). Nenhum fica no repositório.
- **VM endurecida:**
  - SSH só por chave, sem senha e sem root;
  - fail2ban;
  - atualizações de segurança automáticas;
  - fuso UTC;
  - grupo de segurança só com a porta 22.
- **Backup:** `pg_dump` diário no bucket (`backups/`, 7 dias). Está com o banco-dados na T-0074; esta seção é atualizada quando a restauração for testada.
- **Estado em 04/11/2026, 3h30 (Manaus):**
  - ✅ primeiro deploy verde (commit e626d0b, workflow run 41791896334): migrações 0001–0021, seed demo, api/worker/postgres/cloudflared saudáveis;
  - ✅ sonda do S3 ok (gravar, ler e remover no bucket);
  - ✅ `api-demo/v1/saude` responde 200;
  - ✅ às 6h (Manaus), depois do deploy do 297dc60: `bko-demo/login` responde 200 e `tests/scripts/demo-no-ar-dominio.mjs` dá "demo no ar pelo domínio".

## Plano B: recriar a base na VM (não mais o PC)
**Desde 05/11/2026 (R-20261105-053835) não há Docker no PC do dono do produto.** O plano B da demo é recriar a base na VM da Magalu pelo workflow `demo-recriar-base` (GitHub Actions, manual). A seção abaixo é só histórico do tempo em que a demo rodava no PC — **não use**.

## Histórico: demo no PC, só com túnel rápido (APOSENTADO)
Os passos abaixo são do tempo em que a demo rodava no PC, com o **túnel rápido** (trycloudflare, endereço temporário). Os APKs de preview não conectam por ele; só o build de desenvolvimento conecta.
> ⚠️ **Não use `configurar-dominio.ps1`.** Ele sobrescreveria o DNS de `api-demo`/`bko-demo`, que hoje aponta para o túnel da nuvem. O script agora recusa rodar.

## Antes do dia
- Docker Desktop instalado; `pnpm install` na raiz.
- No celular, os APKs de preview:
  - **APKs com domínio fixo (T-0038, commit 0af7c1c; links válidos até 2026-11-15; instale por cima dos anteriores)**. Já vêm com `https://api-demo.macuxifdv.com.br/v1` e não pedem endereço:
    - Macuxi Campo: https://expo.dev/artifacts/eas/-j2R1plt2fqk25BX9CUV6aJfA4dW-W7RmaIGbRkU9JM.apk
    - Macuxi Gestão: https://expo.dev/artifacts/eas/85bpIEGyrlCzhwxIusKIaFS9xbBzBtMIFWzDnwLIA00.apk
    - Enquanto o "Uma vez só" não estiver feito, eles mostram "Servidor indisponível — tente mais tarde" (esperado).
  - APKs anteriores, com o campo Servidor (commit 8cf1021), só se precisar de um endereço diferente:
    - Macuxi Campo: https://expo.dev/artifacts/eas/anwJjMiIGmI7LStvx08GO99bXMmuLljTwqxQ9fjAxyg.apk
    - Macuxi Gestão: https://expo.dev/artifacts/eas/gjm--rEMuK31MOc1MRNEuuDNCGvczjRpPyc8o1Ms2xg.apk
    - Neles, digite `https://api-demo.macuxifdv.com.br/v1` em Servidor → Testar e salvar (ou o endereço do túnel rápido).
- Recomendado: `MACUXI_JWT_SEGREDO` (32+ caracteres) no .env da raiz. Sem ele, cada subida usa um segredo temporário.

## Uma vez só (por PC): domínio fixo — APOSENTADO desde 04/11/2026 (não rode; ver o aviso acima)
1. `cloudflared tunnel login` (o navegador abre; escolha **macuxifdv.com.br**). A autorização fica em `%USERPROFILE%\.cloudflared`, fora do repositório e fora do alcance dos agentes (doc 07).
2. `powershell -ExecutionPolicy Bypass -File scripts\demo\configurar-dominio.ps1`: cria o túnel `macuxi-demo`, aponta `api-demo` e `bko-demo` e grava o config. Pode rodar de novo sem duplicar nada. Se um nome já apontar para outro lugar, use `-SobrescreverDns`.

## Subir (uma janela só)
- Duplo clique em `_instalar\subir-demo.cmd` (ou `powershell -ExecutionPolicy Bypass -File scripts\demo\subir-demo.ps1`).
- Leva de 2 a 4 minutos; a parte longa é o build do BKO. O script sobe o banco, a base de demo, a API, o worker e o BKO, e abre o túnel do domínio fixo.
- Ele só diz "Pronto para a demonstração" depois de conferir a API (`/v1/saude`) e o BKO, no PC e pela internet.
- Endereços fixos:
  - app: `https://api-demo.macuxifdv.com.br/v1` (já vem nos APKs novos);
  - BKO: `https://bko-demo.macuxifdv.com.br`.
- Sem o "Uma vez só" feito neste PC, ou se o túnel nomeado não conectar, o script avisa em amarelo e usa o túnel rápido (trycloudflare), com endereço temporário. Os APKs de preview novos **não** conectam por ele; só o build de desenvolvimento conecta (login > Avançado > Servidor).
- Opções: `-Manter`, `-Reiniciar`, `-SemTunel`, `-SemWorker`, `-SemBko`, `-TunelRapido`, `-Portatil`, `-Porta`, `-PortaBko`.

## No celular
1. Abra o app (APK de preview novo). Não há endereço para digitar.
2. Código da empresa `demo`, senha `demo-macuxi`.
   - Campo: vendedor@exemplo.com.br (Lucas, rota de hoje com 6 paradas), vendedor2@exemplo.com.br (Camila, 4 paradas), promotor@exemplo.com.br (Joana, 4 paradas, não faz pedido).
   - Gestão: supervisor@exemplo.com.br (Renata, Equipe Manaus, 2 pedidos para aprovar).
   - Outros: analista@ e admin@exemplo.com.br (servem também para o BKO).
- "Servidor indisponível — tente mais tarde": a demo não está no ar ou o túnel caiu.
- Licenciados no tenant demo: core, catálogo, vendedor e promotor (gestor não).

## Roteiro do pedido para apresentar (T-0029)
Alçadas da base: 5% vendedor, 10% supervisora, 15% gerente; acima disso, o analista.
1. **Campo (vendedor@)** → Clientes → um cliente do Varejo → **Novo pedido**: 2 produtos, desconto 3% → Enviar. O pedido aparece como **Aprovado** (dentro da alçada) com o próximo número.
2. Novo pedido com **8%** → o app avisa que vai para aprovação → **Aguardando aprovação**. Abra o pedido → **Exportar PDF → PDF do cliente → Compartilhar → WhatsApp**. O PDF do cliente não mostra nenhum %; o PDF interno mostra o desconto e a alçada.
3. **Gestão (supervisor@)** → aba **Pedidos** → chip **Para aprovar** → abra o de 8% → **Aprovar** (1 toque). No Campo, depois do Sincronizar, o pedido aparece Aprovado. Para rejeitar, é obrigatório informar um motivo, e o vendedor vê esse motivo.
4. **Offline**: com o celular em modo avião, faça um pedido de 3% no Campo. Ele fica "Na fila". Ao voltar o sinal, o pedido sobe uma vez só. No Gestão, aprovar exige internet.
5. **BKO** em `https://bko-demo.macuxifdv.com.br` (admin@ ou supervisor@) → **Pedidos**: o status novo aparece, com filtros e busca pelo número. Abra um pedido → **PDF do cliente** → no diálogo de impressão, "Salvar como PDF".
- Extras: um pedido de 12% vai para o gerente (gerente@, Marcelo). No Supermercado Bom Preço, o açaí aparece "Sem preço para este cliente". O promotor@ não vê pedidos.
- Cada rodada do e2e automático deixa na base um pedido "e2e testes", primeiro aprovado e depois cancelado. Para começar limpo, use `-Reiniciar`.
- Roteiro completo, com o resultado esperado de cada passo: `tests/plano/demo-matriz.md` (M-D01 a M-D12b).

## Encerrar
`_instalar\derrubar-demo.cmd` (ou `scripts\demo\derrubar-demo.ps1`; `-PararBanco` também para o Postgres). O túnel nomeado e o DNS continuam configurados: na próxima vez é só subir.

## Se der problema
- "Porta 8100 (ou 3100) em uso": feche o `pnpm dev` (API ou BKO).
- "Já há uma demonstração no ar": use `-Reiniciar` ou derrube antes.
- "No ar, mas SEM confirmação pelo endereço público": teste `https://api-demo.macuxifdv.com.br/v1/saude` no navegador do celular.
- "O túnel nomeado não conectou": veja `.dados\demo\tunel.erro.log` (sem internet? PC sem o "Uma vez só"?).
- Logs em `.dados\demo\`.
- Segurança: o túnel expõe a API e o BKO deste PC. Use só com a base de demo e derrube ao terminar.

Detalhes: scripts/demo/LEIA-ME.md e docs/desenho/T-0038.md

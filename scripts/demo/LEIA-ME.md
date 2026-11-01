# Demonstração do Macuxi FDV (T-0026)

App novo (APK de preview) falando com a API real deste PC por um túnel HTTPS. A Fase M fica de reserva.

## Antes do dia
- **Docker Desktop** instalado (o script abre se estiver parado).
- **APKs de preview** instalados nos celulares: `campo-preview` (Macuxi Campo) e `gestao-preview` (Macuxi Gestão).
  São APKs sem Metro: não precisam do PC na mesma rede, só do endereço https do túnel.
- `pnpm install` feito na raiz.
- No `.env` da raiz: `MACUXI_JWT_SEGREDO` com 32+ caracteres. Sem ele, o script usa um segredo aleatório só daquela
  subida (funciona, mas ao derrubar todos fazem login de novo).
- O **cloudflared** é instalado pelo próprio script com `winget` na primeira vez (pede confirmação do Windows).

## Subir
```
powershell -ExecutionPolicy Bypass -File scripts\demo\subir-demo.ps1
```
Etapas: (1) confere o Docker; (2) `banco subir` (Postgres do `db/docker-compose.yml` + migrações); (3) `banco seed demo
--recriar` (base de demo do zero); (4) API na porta 8100 e worker da outbox, com `MACUXI_TRUST_PROXY=loopback`; (5) túnel
`cloudflared tunnel --url http://127.0.0.1:8100`; (6) imprime o endereço https e os logins. Leva ~1 min (a 1ª vez, mais).

Opções: `-Manter` (não apaga a base: upsert; visitas e pedidos do ensaio ficam) · `-Reiniciar` (derruba a demo no ar e
sobe de novo; o endereço muda) · `-SemWorker` · `-SemTunel` (só API local) · `-Portatil` (pula o winget e usa o
cloudflared portátil) · `-Porta 8200`.

**Uma demo por vez neste PC**: com outra no ar (ou subindo), o script recusa (saída 2) e mostra o endereço atual.
Sem administrador para o MSI do winget (UAC negado), o script baixa o `cloudflared.exe` oficial para `.dados\demo\bin`
e só usa se a assinatura digital da Cloudflare for válida.

## No celular
1. Abra o app. Na tela de login, em **Servidor**, digite o endereço que o script imprimiu
   (`https://<nome>.trycloudflare.com`; o app completa o `/v1`) e toque em **Testar e salvar**.
2. Código da empresa **`demo`**, senha **`demo-macuxi`** (ou a de `MACUXI_SENHA_DEMO`, se estiver no `.env`).

| App | E-mail | Quem |
|---|---|---|
| Campo | `vendedor@exemplo.com.br` | Lucas Andrade, vendedor, rota de hoje com 6 paradas |
| Campo | `vendedor2@exemplo.com.br` | Camila Freitas, vendedora, 4 paradas |
| Campo | `promotor@exemplo.com.br` | Joana Prado, promotora, 4 paradas (não faz pedido, RN-PRO-01) |
| Gestão | `supervisor@exemplo.com.br` | Renata Barros, Equipe Manaus, 30 clientes, 2 pedidos para aprovar |
| — | `analista@exemplo.com.br` / `admin@exemplo.com.br` | analista e administrador |

Módulos licenciados no tenant demo: core, catálogo, vendedor e promotor (o gestor não; para licenciar é uma linha em
`db/seeds/demo/demo.ts`, dono banco-dados).

## Derrubar
```
powershell -ExecutionPolicy Bypass -File scripts\demo\derrubar-demo.ps1            # túnel, worker e API
powershell -ExecutionPolicy Bypass -File scripts\demo\derrubar-demo.ps1 -PararBanco  # + para o Postgres (dados ficam)
```

## Problemas comuns
- **O endereço muda a cada subida** (túnel rápido da Cloudflare, sem conta): digite o novo no app.
- **"porta 8100 em uso"**: há outra API rodando (`pnpm dev`). Feche ou use `-Porta`. O derrubar encerra também a API
  (servidor.ts) que estiver escutando a porta da demo e o worker sem `watch`, mesmo órfãos.
- **Cloudflared demora na 1ª vez** (antivírus examinando o exe novo): o script espera até 3 min pelo endereço.
- **Túnel abriu mas `/v1/saude` não respondeu do PC**: o DNS do nome novo leva alguns segundos; teste no celular
  (`<endereço>/v1/saude` no navegador deve mostrar `{"ok":true,...}`).
- **429 `MUITAS_TENTATIVAS` no login**: com `MACUXI_TRUST_PROXY=loopback` cada aparelho conta pelo próprio IP (o do
  `X-Forwarded-For` que a Cloudflare acrescenta), mas aparelhos na mesma rede Wi-Fi saem com o mesmo IP público.
- Logs e PIDs: `.dados\demo\` (`api.log`, `worker.log`, `tunel.erro.log`, `processos.json`), fora do git.

## Segurança
O túnel expõe a API deste PC na internet enquanto estiver no ar: use só com a base de demo (dados fictícios), derrube
ao terminar e não suba com dados reais. O Postgres continua só em `127.0.0.1`.

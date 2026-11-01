# Demonstração do Macuxi FDV (T-0026, T-0038)

App novo (APK de preview) e BKO falando com a API real deste PC por um túnel HTTPS da Cloudflare, no domínio fixo
`macuxifdv.com.br`. A Fase M fica de reserva.

| Endereço | O que é |
|---|---|
| `https://api-demo.macuxifdv.com.br/v1` | API da demo (já vem nos APKs de preview; ninguém digita) |
| `https://bko-demo.macuxifdv.com.br` | BKO da demo |

Os dois passam pelo túnel nomeado `macuxi-demo` deste PC: API em `127.0.0.1:8100`, BKO em `127.0.0.1:3100`. O resto do
domínio responde 404. `api`, `bko` e `app.macuxifdv.com.br` são de produção (reservados, doc 04).

## Uma vez só (por PC): o domínio fixo
1. `cloudflared tunnel login`: abre o navegador; entre na conta da Cloudflare e escolha **macuxifdv.com.br**. A
   autorização fica em `%USERPROFILE%\.cloudflared`, fora do repositório. Nenhum script nem agente lê, copia ou commita
   essa pasta (doc 07, "Credenciais da Cloudflare"). Se o `cloudflared` ainda não existir, rode antes o passo 2 (ele
   instala e para pedindo o login) ou `winget install Cloudflare.cloudflared`.
2. ```
   powershell -ExecutionPolicy Bypass -File scripts\demo\configurar-dominio.ps1
   ```
   Cria o túnel `macuxi-demo` (se não existir), aponta `api-demo` e `bko-demo` para ele (`cloudflared tunnel route dns`)
   e grava `.dados\demo\cloudflared\config.yml` (ingress) e o marcador `tunel.json`. **Pode rodar de novo**: reaproveita
   o túnel, não duplica DNS e só regrava o config se mudou.
   - "Já existe um registro DNS para ... que aponta para outro lugar": confira o DNS no painel da Cloudflare; se puder
     trocar, rode de novo com `-SobrescreverDns`.
   - Opções: `-PortaApi 8100` · `-PortaBko 3100` · `-Portatil` (cloudflared portátil, sem winget).

Sem esse passo, a demo sobe do mesmo jeito pelo túnel rápido (veja "Reserva" abaixo).

## Antes do dia
- **Docker Desktop** instalado (o script abre se estiver parado).
- **APKs de preview** instalados nos celulares: `campo-preview` (Macuxi Campo) e `gestao-preview` (Macuxi Gestão). Já
  vêm com `https://api-demo.macuxifdv.com.br/v1` e não têm o campo Servidor. Também não precisam do PC na mesma rede.
- `pnpm install` feito na raiz.
- No `.env` da raiz: `MACUXI_JWT_SEGREDO` com 32+ caracteres. Sem ele, o script usa um segredo aleatório só daquela
  subida (funciona, mas ao derrubar todos fazem login de novo).

## Subir
`_instalar\subir-demo.cmd` (clique duas vezes) ou:
```
powershell -ExecutionPolicy Bypass -File scripts\demo\subir-demo.ps1
```
Etapas (de 2 a 4 min; o build do BKO é a mais longa):
1. confere o Docker;
2. `banco subir` (Postgres do `db/docker-compose.yml` + migrações);
3. `banco seed demo --recriar` (base de demo do zero);
4. API na porta 8100 e worker da outbox, com `MACUXI_TRUST_PROXY=loopback`;
5. `next build` do BKO (`NEXT_PUBLIC_API_URL=http://127.0.0.1:8100/v1`: o BKO chama a API pelo proxy do próprio Next);
6. túnel: o **nomeado** (`cloudflared tunnel run`, domínio fixo), se o `configurar-dominio.ps1` já rodou neste PC;
7. `next start` do BKO na porta 3100 (só no loopback) e conferência.

Só diz **"Pronto para a demonstração"** depois de conferir, no PC, `/v1/saude` da API, a página `/login` do BKO e o
proxy do BKO até a API (`/api-proxy/saude`), e, pela internet, `https://api-demo.macuxifdv.com.br/v1/saude` e
`https://bko-demo.macuxifdv.com.br/login`. Se a parte pela internet falhar, ele mostra "No ar, mas SEM confirmação
pelo endereço público", deixa tudo rodando e sai com código 3. Nesse caso, teste no celular antes de começar.

Opções: `-Manter` (não apaga a base: upsert; visitas e pedidos do ensaio ficam) · `-Reiniciar` (derruba a demo no ar e
sobe de novo) · `-SemWorker` · `-SemBko` · `-SemTunel` (só API e BKO locais) · `-TunelRapido` (força o trycloudflare)
· `-Portatil` (cloudflared portátil) · `-Porta 8200` · `-PortaBko 3200` (o config.yml do túnel acompanha as portas).

**Uma demo por vez neste PC**: com outra no ar (ou subindo), o script recusa (saída 2) e mostra os endereços atuais.

### Reserva: túnel rápido (trycloudflare)
Sem o domínio configurado neste PC, com `-TunelRapido`, ou se o túnel nomeado não conectar em 2 min (sem internet,
credencial do túnel ausente), o script avisa em amarelo e abre dois túneis rápidos: um para a API e outro para o BKO.
Os endereços são aleatórios (`https://<nome>.trycloudflare.com`) e mudam a cada subida. **Os APKs de preview não
conectam por eles**: só o build de desenvolvimento, em login > Avançado > Servidor, com o endereço que o script imprime
(com `/v1` no fim; ele também copia para a área de transferência).

## No celular
1. Abra o app (APK de preview). Não há endereço para digitar.
2. Código da empresa **`demo`**, senha **`demo-macuxi`** (ou a de `MACUXI_SENHA_DEMO`, se estiver no `.env`).
3. Se aparecer "Servidor indisponível — tente mais tarde": a demo não está no ar (ou o túnel caiu). Suba ou reinicie.

| App | E-mail | Quem |
|---|---|---|
| Campo | `vendedor@exemplo.com.br` | Lucas Andrade, vendedor, rota de hoje com 6 paradas |
| Campo | `vendedor2@exemplo.com.br` | Camila Freitas, vendedora, 4 paradas |
| Campo | `promotor@exemplo.com.br` | Joana Prado, promotora, 4 paradas (não faz pedido, RN-PRO-01) |
| Gestão | `supervisor@exemplo.com.br` | Renata Barros, Equipe Manaus, 30 clientes, 2 pedidos para aprovar |
| BKO | `analista@exemplo.com.br` / `admin@exemplo.com.br` | analista e administrador |

Módulos licenciados no tenant demo: core, catálogo, vendedor e promotor (o gestor não; para licenciar é uma linha em
`db/seeds/demo/demo.ts`, dono banco-dados).

## Derrubar
`_instalar\derrubar-demo.cmd` ou:
```
powershell -ExecutionPolicy Bypass -File scripts\demo\derrubar-demo.ps1            # túnel(is), BKO, worker e API
powershell -ExecutionPolicy Bypass -File scripts\demo\derrubar-demo.ps1 -PararBanco  # + para o Postgres (dados ficam)
```
O túnel nomeado e o DNS continuam configurados (não precisa rodar o `configurar-dominio.ps1` de novo). Com a demo
derrubada, `api-demo` e `bko-demo` respondem erro da Cloudflare (1033) e o app mostra "Servidor indisponível".

## Problemas comuns
- **"porta 8100 em uso"** / **"porta 3100 em uso"**: há outra API ou BKO rodando (`pnpm dev`?). Feche ou use `-Porta`
  / `-PortaBko`. O derrubar encerra também a API (servidor.ts), o BKO (`next start`) e o cloudflared da demo que
  ficarem órfãos, e o worker sem `watch`.
- **next build do BKO falhou**: o script mostra o fim do log; o completo fica em `.dados\demo\bko-build.log`.
- **"O túnel nomeado não conectou"**: veja `.dados\demo\tunel.erro.log`. Em outro PC, rode o `cloudflared tunnel login`
  e o `configurar-dominio.ps1` lá (a credencial do túnel não sai do PC em que ele foi criado).
- **Cloudflared demora na 1ª vez** (antivírus examinando o exe novo): o script espera até 2 min (nomeado) ou 3 min
  (rápido).
- **"Servidor indisponível — tente mais tarde" no app**: demo fora do ar, túnel caído ou celular sem internet. No
  navegador do celular, `https://api-demo.macuxifdv.com.br/v1/saude` deve mostrar `{"ok":true,"servico":"macuxi-api",...}`.
- **429 `MUITAS_TENTATIVAS` no login**: com `MACUXI_TRUST_PROXY=loopback` cada aparelho (e cada navegador do BKO)
  conta pelo próprio IP, mas aparelhos na mesma rede Wi-Fi saem com o mesmo IP público.
- Logs e PIDs: `.dados\demo\` (`api.log`, `worker.log`, `bko.log`, `bko-build.log`, `tunel.erro.log`,
  `tunel-rapido*.erro.log`, `processos.json`), fora do git. O `config.yml` e o `tunel.json` ficam em
  `.dados\demo\cloudflared\` e não têm segredo. Se forem apagados, rode o `configurar-dominio.ps1` de novo.
- **"já existe" no `configurar-dominio.ps1`**: o script reaproveita o `macuxi-demo` pelo nome. Ele só para quando a
  Cloudflare diz que o túnel existe e o `cloudflared tunnel list --name macuxi-demo` não o mostra como ativo.
  Nesse caso, esperar não resolve: confira `cloudflared tunnel list` e `cloudflared tunnel info macuxi-demo`.
  Para o script, `deleted_at` igual a `0001-01-01T00:00:00Z` (o tempo zero do Go) quer dizer túnel ativo.
- Testes dos scripts do túnel, com um cloudflared simulado que não fala com a Cloudflare:
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo\teste\tunel.test.ps1`. Também rodam no `pwsh`.

## Segurança
O túnel expõe a API e o BKO deste PC na internet enquanto estiver no ar: use só com a base de demo (dados fictícios),
derrube ao terminar e não suba com dados reais. O Postgres continua só em `127.0.0.1`, e a API e o BKO escutam só no
loopback. A API não tem CORS nem cookie: o navegador fala só com o BKO, que repassa para a API. As credenciais da
Cloudflare ficam em `%USERPROFILE%\.cloudflared`, fora do repositório; nunca as copie para cá.

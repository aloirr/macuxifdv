# ADR 0070 — Atualização obrigatória do APK: aviso no sininho por 24 h, depois só a tela de reinstalar, sem perder nada digitado

- **Status**: proposta (número 0070 conferido livre no `origin/main` 79e5c6c; o gerente-projetos confere no `.coord/quadro.md`).
- **Data**: 2026-11-24 (Manaus)
- **Versão**: v1.0.33 (sessão I). Regra nova: **RN-CORE-80** (texto pronto no fim, para o gerente-projetos levar ao doc 03).
  Referências: RN-CORE-67 e ADR 0065 (APK por link temporário), ADR 0037 (porta de pacotes), RN-CORE-23 (fila do motor).
- **Autor**: engenheiro-software
- **Origem**: T-0195. Pedido do dono do produto R-20261123-200746 e o ponto principal R-20261123-201347: nenhum orçamento, pedido
  ou pré-cadastro digitado se perde antes, durante ou depois da atualização, nem se o usuário **desinstalar** (no Android a
  desinstalação apaga os dados do app). O bloqueio não impede guardar nem enviar a fila.

## Contexto

Hoje o app só sabe que há versão nova pelo `GET /v1/app/versao?contrato=2` (item 19, ADR 0065) e o APK só sai pelo link temporário
que o administrador gera no portal. Nada obriga o vendedor a atualizar, e a API aceita qualquer versão. O pedido é: nas primeiras
24 h depois da publicação de um APK (Campo ou Gestão), o app antigo recebe só um aviso no sininho com o link; depois delas, o app
antigo abre só com "Versão desatualizada, reinstale para continuar." e o link, e a API recusa a versão antiga.

O risco central é a palavra "reinstale": quem desinstala para instalar de novo apaga a fila do motor, os rascunhos e as fotos não
enviadas. O desenho tem de tornar esse caminho seguro, não só desaconselhá-lo.

## Decisão

### D1 — A hora das 24 h é o `publicado_em` do manifesto `ultimo.json`

- O `publicar-pacote` (CLI chamada pelo `apk-publicar.yml`) já grava `<prefixo><produto>/ultimo.json` com `versao` e
  `publicado_em` (UTC, hora da publicação), depois do APK. Agora o tipo de retorno (`ManifestoPublicado`) garante o campo e o teste
  do S3 falso confere. Republicar a mesma versão regrava o manifesto e **reinicia** as 24 h (só adia o bloqueio, nunca antecipa).
- A porta de pacotes ganha `manifestoDoUltimo(produto)` (opcional na interface `ServicoPacotes`; o adaptador S3 e a porta de
  memória implementam): lê e valida o manifesto **sem assinar link**.
- A API monta uma fonte única por processo, `criarFonteVersoesApp` (`apps/api/src/app-versao.ts`), com cache por variante de 5 min
  (`CACHE_FONTE_VERSOES_MS`). Ordem: manifesto do S3; sem S3, sem manifesto ou com versão fora de X.Y.Z, o ambiente
  (`APP_<CAMPO|GESTAO>_VERSAO` e `_PUBLICADA_EM`, como hoje, para dev e CI); falha do armazenamento = o último valor bom, senão o
  ambiente, com um `warn` só com variante e código. Ela nunca derruba a requisição.
- **Sem `publicado_em` conhecido, não há bloqueio** (só aviso). A mesma fonte alimenta `GET /v1/app/versao`, o 426 (D4) e a porta
  `ctx.versaoApp` (D7). Nenhuma infraestrutura nova.

### D2 — O app se identifica em toda chamada

`CABECALHO_APP = 'x-macuxi-app'`, valor `<campo|gestao>/<X.Y.Z>` (`valorCabecalhoApp`, `lerCabecalhoApp` no SDK). Cabeçalho
ausente, repetido ou fora do formato = `null` = nada muda. O BKO, o portal e os apps até a v1.0.32 não mandam o cabeçalho e não são
bloqueados pela API (os apps antigos continuam sendo avisados pela própria verificação de atualização que já têm).

### D3 — Uma função pura decide a situação (RN-CORE-80)

`situacaoDaVersao({ atual, publicada, publicadaEm, agora })` → `{ situacao: 'atual' | 'aviso' | 'bloqueada', prazoAte }`, com
`PRAZO_ATUALIZACAO_APP_MS` = 24 h exatas. Às 24h00 em ponto já é `bloqueada`. Versão inválida (qualquer uma), nenhuma publicada ou
instalada maior ou igual à publicada = `atual`. Hora da publicação desconhecida ou inválida = `aviso` sem prazo. Publicação "no
futuro" (relógio do aparelho atrasado) = `aviso`. É a mesma função no app (tela de entrada, inclusive offline com a última resposta
guardada), na API (426) e no Core (sininho). Testes de borda em `packages/platform-sdk/src/app-versao.test.ts`.

### D4 — A API recusa o app bloqueado, menos o que salva o que foi digitado

Hook `onRequest` global (`registrarBloqueioVersaoApp`), registrado em `createApp` logo depois da porta de pacotes. App com
`situacao = 'bloqueada'` recebe **426 `APP_DESATUALIZADO`** (`STATUS_APP_DESATUALIZADO`, `CODIGO_APP_DESATUALIZADO`), mensagem
`MENSAGEM_APP_DESATUALIZADO` ("Versão desatualizada, reinstale para continuar.") e `detalhes` `{ variante, versao_publicada,
publicada_em, prazo_ate }` (`ErroAppDesatualizadoSchema`, compatível com o `ErroApiSchema`).

Liberadas mesmo bloqueadas (`ROTAS_LIBERADAS_APP_DESATUALIZADO`, por método e padrão da rota do Fastify):

| Para quê | Rotas |
|---|---|
| Sessão (sem ela não há envio) | qualquer método em `/v1/auth/*` (login, refresh, logout, troca e recuperação de senha) |
| Envio da fila do motor | `POST /v1/sync/push` |
| Envio dos arquivos da fila (fotos, assinaturas) | `PUT /v1/arquivos/:id`, `PUT /v1/arquivos/:id/partes/:n`, `GET /v1/arquivos/:id/partes/:n/url-envio`, `POST /v1/arquivos/:id/concluir` |
| Saber a versão e o servidor | `GET /v1/app/versao`, `GET /v1/app/atualizar`, `GET /v1/saude` |
| Baixar o APK novo (D6) | `POST /v1/core/app/apk` (`ROTA_CORE_APP_APK`) |

Todo o resto recusa, inclusive `GET /v1/sync/pull`, `/v1/sync/novidades`, `/v1/sync/pacotes`, o download de arquivos e as rotas dos
módulos. Os arquivos entraram na lista porque a fila do motor também leva arquivos (`enfileirarArquivo`: foto de fachada, foto do
PDV, fotos do promotor); sem eles o push do comando seria aceito e a foto ficaria presa no aparelho. Testes em
`apps/api/test/app-versao.test.ts` (push aceito, pull e rota de módulo recusados, sem cabeçalho nada muda, 23h59 não bloqueia,
manifesto sem hora ou S3 fora não bloqueiam).

### D5 — `GET /v1/app/versao?contrato=2` não muda

O `AppVersaoPublicadaV2Schema` é `.strict()`: um campo novo (ex.: `prazo_ate`) quebraria o parse dos apps v1.0.19 a v1.0.32. Não é
preciso: o app calcula o prazo com `situacaoDaVersao` a partir do `publicada_em` que a rota já devolve. Muda só a fonte do
`publicada_em` (D1). Sem contrato novo.

### D6 — O link do APK do próprio app (rota do Core, feita pelo modulo-core)

O app não recebe `apk_url` (ADR 0065). Rota nova do Core, **`POST /v1/core/app/apk`** (`caminho: 'app/apk'`), para o usuário logado
no app pedir o link temporário da **própria** variante:
- variante = `varianteDoPerfil(ctx.usuario.perfil)` (SDK, `perfis.ts`: vendedor e promotor → `campo`; supervisor e gerente →
  `gestao`; perfis só do BKO → 403). Nunca o que o cliente manda; sem corpo (`{}` estrito).
- link pela porta `ctx.pacotes.linkDoUltimo(variante)`; sem pacote = 404 próprio do Core; sem S3 = 503 da porta. Auditoria sem a
  URL (como `POST /v1/core/apps/download`), `semCache: true`, sem licença de módulo além do `core`, `carteira: 'nao_se_aplica'`.
- resposta: o `LinkPacoteSchema` do SDK com `variante` (o modulo-core define o schema em `modules/core/contracts`, com `.extend`,
  como já faz no download do portal). O link vale minutos e nunca é guardado no aparelho: cada toque pede outro.

### D7 — O aviso do sininho (rota do Core, feita pelo modulo-core)

- O SDK entrega às rotas de módulo a porta **`ctx.versaoApp`** (`PortaVersaoApp`): `doCliente` (o cabeçalho desta requisição) e
  `publicada(variante)` (a mesma fonte do D1). A API preenche em toda rota de módulo; teste usa `criarPortaVersaoAppMemoria`.
- Rota nova do Core, **`POST /v1/core/app/aviso-versao`** (`ROTA_CORE_APP_AVISO_VERSAO`), sem corpo. O app chama ao abrir e ao
  voltar ao primeiro plano (com sinal). O Core lê `ctx.versaoApp.doCliente` (sem cabeçalho = 204, nada a fazer), confere
  `varianteDoPerfil` igual à variante do cabeçalho, calcula `situacaoDaVersao` com `ctx.versaoApp.publicada(variante)` e, **só na
  situação `aviso`**, cria a notificação do sininho do usuário com chave de idempotência **(usuário, variante, versão publicada)**:
  chamar de novo não duplica. A notificação leva o texto do designer-ux e a ação "Atualizar" que abre a tela de atualização do app
  (D8), não um link direto. Fora do `aviso` não cria nada; a rota não é liberada no 426 (com o app bloqueado ela não tem o que fazer).
- Por que pela chamada do app e não por um job: só o app sabe a versão instalada (o servidor não guarda a versão de cada aparelho),
  e a chamada já vem com o cabeçalho. A notificação chega pelo pull normal das notificações; o app ainda mostra a faixa local a
  partir da própria `situacaoDaVersao` mesmo offline.

### D8 — Nada se perde, nem desinstalando

**Inventário do que é digitado e só local** (lido em `modules/vendedor/app` e `modules/core/app`, `origin/main` 79e5c6c):

| O quê | Onde fica | Entra na fila do motor? |
|---|---|---|
| Pedido e orçamento novos ("Salvar e enviar") | `motor.enfileirar({ entidade: 'pedido' })`, `tipo: 'orcamento'` no orçamento (`use-vendedor.ts` `enviarPedido`) | **sim** |
| Edição de pedido ainda na fila e "transformar orçamento em pedido" | `motor.alterar`/`enfileirar` (`use-vendedor.ts`) | **sim** |
| Pré-cadastro de cliente e a correção dele | `motor.enfileirar({ entidade: 'cliente_pre_cadastro' })` (`pre-cadastro-local.ts`) | **sim** |
| Check-in, check-out, foto da fachada e do PDV, conclusão de tarefa, leitura de aviso | `motor.enfileirar` / `enfileirarArquivo` (`acoes-visita.ts`, `enviar-foto-pdv.ts`, …) | **sim** (arquivos pela fila de arquivos) |
| Item "Não aceito" (422) | fica na fila como `falhou`, com o motivo, até o vendedor corrigir ou descartar | **sim, mas não sai sozinho** |
| **Rascunho** ("Apenas salvar", pedido ou orçamento não enviado, e a edição em andamento de orçamento já recebido) | `mod:vendedor:rascunhos` no armazenamento do módulo, vive 24 h (RN-VEN-38/39) | **não** |
| Formulário aberto e não salvo (pré-cadastro, pedido) | estado da tela | não (como hoje: não é guardado) |
| Edição de orçamento já recebido | `PUT /vendedor/orcamentos/:id` direto, só com sinal; sem sinal o vendedor fica no rascunho | não (vira rascunho) |

Desenho (para o engenheiro-apps, o designer-ux e o modulo-vendedor):

- **(a) A tela de bloqueio esvazia a fila antes de mostrar o link.** Ao entrar (abrir o app, voltar ao primeiro plano ou receber
  426), ela chama `motor.enviar({ incluirFalhos: false })` sozinha e conta três coisas: itens pendentes da fila (comandos e
  arquivos), itens "Não aceito" e rascunhos do Vendedor. O botão do link (D6) **só aparece com as três contagens em zero**.
  - Pendentes: "Enviando N…" e "Enviar agora"; sem sinal, pede conexão.
  - "Não aceito" e rascunhos não saem sozinhos (o primeiro precisa de correção; o segundo nunca foi enviado). A tela mostra a
    contagem e a ação de abrir **só** as telas que os resolvem: Rascunhos → pedido, item "Não aceito" → corrigir, pré-cadastro
    recusado → corrigir. Lá o vendedor envia (o push é liberado; as telas leem do aparelho, offline-first) ou descarta de propósito.
    Descartar é decisão dele, não perda. Nada mais do app abre.
  - O pull fica recusado: o envio de um pedido pode voltar "Não aceito" por preço desatualizado, e o caminho é o mesmo.
  - Por isso o link nunca aparece com algo digitado só no aparelho, e desinstalar depois dele não apaga nada que não esteja no
    servidor. O mesmo portão vale para a ação "Atualizar" do aviso das primeiras 24 h.
  - O formulário aberto não é arrancado no meio: a troca para a tela de bloqueio acontece na entrada. Um 426 no meio do uso só
    marca o estado; o salvar continua indo para a fila, cujo envio é liberado.
- **(b) O texto orienta instalar por cima, sem desinstalar** (o designer-ux escreve). Conferido que instalar por cima funciona e
  preserva os dados:
  - mesma assinatura: o `android-build.yml` assina cada variante com a mesma keystore, por secret (`ANDROID_KEYSTORE_*_<VARIANTE>`),
    e confere o SHA-256 do certificado quando `ANDROID_CERT_SHA256_<VARIANTE>` existe;
  - versionCode crescente: derivado da versão (`MAIOR*1000000 + MENOR*1000 + CORRECAO`, `scripts/ci/android-build.mjs`).
  - Duas ressalvas, sem mudança nesta ADR: o input manual `version_code` pode sobrescrever o derivado (quem publica não deve usá-lo
    para um número menor), e a conferência do certificado só acontece com a variável preenchida. Recomendação ao gerente: manter as
    duas variáveis `ANDROID_CERT_SHA256_*` preenchidas. Assinatura diferente faz o Android recusar a instalação por cima, e aí o
    usuário é levado a desinstalar.
- **(c) Cópia da fila fora do app: descartada.**
  - Um arquivo em Downloads/armazenamento compartilhado levaria CNPJ, CPF, preços e pedidos em claro, fora do controle do app e da
    remoção por módulo desativado (RN-CORE-02), e exigiria importar, deduplicar e revalidar.
  - O backup automático do Android não serve de garantia: roda quando quer, depende de conta Google e Wi-Fi, e restaura dado de outro
    aparelho e de outra sessão.
  - A garantia escolhida é mais forte e mais simples: **a cópia fora do app é o servidor**, e o link só aparece quando não resta
    nada só no aparelho (a). O `id` gerado no aparelho torna o reenvio idempotente se o envio cair no meio.
- **Apps até a v1.0.32** não mandam o cabeçalho e não são bloqueados pela API; seguem com o aviso de versão nova que já têm. O
  bloqueio passa a valer para quem instalar a v1.0.33 ou mais nova, quando sair a versão seguinte.

## Alternativas consideradas

- **Versão mínima por variável de ambiente** (`APP_*_VERSAO_MINIMA`): exige deploy da API a cada APK e não dá a janela de 24 h
  amarrada à publicação. Descartada; o ambiente fica só como reserva sem S3.
- **Bloquear também o push**: protege contra payload de versão velha, mas prende o que foi digitado no aparelho, contra o ponto
  principal. O push já é validado pelo schema atual e pelo `domain` (a API sempre revalida); um payload que a versão nova não aceite
  volta "Não aceito" e cai no portão (a).
- **`contrato=3` com `prazo_ate`**: desnecessário (D5).
- **Job no servidor para criar os avisos**: o servidor não sabe a versão instalada em cada aparelho; precisaria de uma tabela nova
  de aparelhos e versões. Descartado (D7).
- **Mostrar o link sempre e só avisar da fila**: o usuário que desinstala perde o que está no aparelho. Descartado (D8 a).

## Consequências

- O app passa a mandar `x-macuxi-app` em toda chamada. O motor precisa tratar 426 como "bloqueado" (sem retentativa em laço) e
  continuar tentando o push.
- A fonte de versão pode atrasar até 5 min (cache do servidor) mais 5 min (`cache-control` da rota) para enxergar um APK novo; para
  uma janela de 24 h, isso não pesa.
- Um APK publicado por engano bloqueia a versão anterior em 24 h. O remédio é publicar de novo a versão certa: com a versão
  publicada menor ou igual à instalada, a situação volta a `atual`.
- Sem `publicado_em` (manifesto antigo, ambiente sem data), nunca há bloqueio, só aviso.

## Pendências por dono

- **modulo-core**:
  - `POST /v1/core/app/apk` (D6) e `POST /v1/core/app/aviso-versao` (D7), com os schemas em `modules/core/contracts`;
  - a notificação idempotente por (usuário, variante, versão);
  - a ação do item no sininho.
- **engenheiro-apps**:
  - o cabeçalho em toda chamada (`valorCabecalhoApp` com a versão do build);
  - guardar a última resposta de `GET /v1/app/versao` para o offline;
  - a tela de bloqueio com o portão do D8 (a), o tratamento do 426 no motor e no cliente HTTP;
  - a chamada do aviso ao abrir e ao voltar ao primeiro plano.
- **modulo-vendedor**: a contagem dos rascunhos (`mod:vendedor:rascunhos`) e dos itens "Não aceito" exposta ao shell (extensão ou
  função do módulo), para a tela de bloqueio.
- **designer-ux**: os textos da tela (instalar por cima, sem desinstalar; "Enviando N…"; "Enviar agora"; sem sinal) e do aviso.
- **gerente-projetos**: a RN-CORE-80 no doc 03 (texto abaixo).

## RN-CORE-80 (texto para o doc 03)

> **RN-CORE-80 — Atualização obrigatória do app (T-0195, ADR 0070).** A hora de referência é o `publicado_em` do último APK
> publicado de cada variante (Campo, Gestão). Nas primeiras 24 h depois dela, o app com versão menor que a publicada segue
> funcionando e recebe uma notificação no sininho, uma por usuário e versão. A partir de 24 h exatas, o app com versão menor mostra
> só a tela de reinstalar, inclusive offline com a última versão que recebeu, e a API recusa as chamadas dele com 426
> `APP_DESATUALIZADO`. Ficam liberados o login e a sessão, o envio da fila e dos arquivos dela, a consulta da versão e o link do
> APK do próprio app. O link só aparece quando não resta no aparelho nada digitado e não enviado (fila, itens não aceitos e
> rascunhos). O texto orienta instalar por cima, sem desinstalar. Sem a hora da publicação, não há bloqueio. Função:
> `situacaoDaVersao` (`@macuxi/platform-sdk`).

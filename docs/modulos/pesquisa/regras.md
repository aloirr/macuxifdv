# Pesquisa — regras (domain)

Implementação: `modules/pesquisa/domain/` (funções puras, sem I/O; rodam no app offline, na web e na API). Cada arquivo tem um `*.test.ts` com os casos abaixo (`it('RN-PES-xx: ...')`, `RF-PES-xx`). Contratos Zod: `modules/pesquisa/contracts/` (os tipos do domain vêm daqui; a API sempre revalida). Manifesto: `modules/pesquisa/manifest.ts`. Tarefa: T-0012 (domínio, sem banco e sem telas).

Convenções: instantes em UTC (ISO com `Z`); **dia/semana/mês = no fuso do tenant** (`America/Manaus` por padrão, `localDate` de `@macuxi/comum`, ADR 0002); ids UUID gerados no aparelho; percentuais com 2 casas (meio para cima); "sem dados" devolve `null`, nunca divide por zero; mensagens em português com a ação seguinte. Não há dinheiro neste módulo. As decisões do Alexandre (R-20261031-125833) estão no doc 03 §6 (RN-PES-01..07) e na RN-CORE-14; o que ainda não tem texto nos docs 02/03 está marcado **premissa T-0012** (lista no fim).

## Origem das regras
| ID | Texto (doc 02/03) | Onde está implementada |
|---|---|---|
| RF-PES-01 | Construtor: 9 tipos de pergunta, obrigatória/opcional, lógica condicional simples | `resposta-item.ts`, `condicional.ts`, `questionario.ts` |
| RF-PES-02 | Público-alvo (perfis, equipes, segmentos, regiões, lista de clientes), vigência, frequência | `publico.ts` |
| RF-PES-03 | Avulsa (aba "Pesquisas") ou etapa obrigatória do checkout | `checkout.ts` |
| RF-PES-04 | Responder offline, fotos comprimidas, rascunho automático | `idempotencia.ts`, `resposta.ts` (modo `rascunho`) |
| RF-PES-05 | Questionário publicado não muda; editar cria nova versão | `questionario.ts` |
| RF-PES-06 | Resultados: taxa de resposta, gráfico por pergunta, filtros, galeria, Excel/CSV | `resultados.ts` |
| RN-PES-01 | Publicada é imutável; respostas guardam a versão | `questionario.ts`, `resposta.ts` |
| RN-PES-02 | Frequência por **cliente**, em períodos civis (semana/mês) no fuso do tenant | `publico.ts` (`frequenciaPermite`) |
| RN-PES-03 | Obrigatória no checkout bloqueia o checkout até responder, exceto cliente fechado (RN-CORE-14) | `checkout.ts` (`avaliarEtapaCheckout`, `clienteFechadoNoContexto`) |
| RN-PES-04 | Hora do aparelho + `recebida_em` do servidor; relógio adiantado > [24 h] ou fora da vigência: **aceita e sinalizada** | `resposta.ts` (`avaliarRecebimentoDaResposta`), contrato `suspeita`/`motivos_suspeita` |
| RN-PES-05 | "Mostrar" em OU, "ocultar" vence; lista de clientes soma aos segmentos; sem "canal" | `condicional.ts`, `publico.ts` |
| RN-PES-06 | GS1 inválido = aviso; foto até [1600 px], JPEG [80] | `resposta-item.ts` (`avisarItem`, `dimensoesDaFoto`) |
| RN-PES-07 | Limites do construtor como parâmetros do tenant | `parametros.ts`, `questionario.ts` |
| RN-CORE-14 | Cliente fechado dispensa as etapas obrigatórias | `checkout.ts` |
| RN-CORE-12 | Checkout exige as etapas obrigatórias dos módulos ativos | `checkout.ts` (`concluida`) |
| RN-AUD-01 | Publicação de pesquisa é auditada | a API grava (antes/depois); `publicarVersao` devolve quem/quando |
| Doc 03 §2 | Responder: vendedor, promotor, supervisor/gerente. Criar pesquisa: analista, admin | `manifest.ts` (`acoes`) |

## Parâmetros do tenant (`parametros.ts`, `resolverParametros(parcial)`)
O padrão e a validação vêm de `ParametrosPesquisaSchema` (contracts), para app, web e API usarem os mesmos valores.

| Parâmetro | Padrão | Onde entra | Origem |
|---|---|---|---|
| `tolerancia_vigencia_h` | 24 | `avaliarRecebimentoDaResposta` (as duas pontas da vigência e o relógio do aparelho; só sinaliza) | RN-PES-04 |
| `fuso` | `America/Manaus` | dia, semana e mês da frequência; dia dos filtros de período | doc 03, tabela de parâmetros |
| `max_perguntas` | 50 | `validarVersao` (`LIMITE_PERGUNTAS`) | RN-PES-07 |
| `max_opcoes_por_pergunta` | 20 | `validarVersao` (`LIMITE_OPCOES`) | RN-PES-07 |
| `max_fotos_por_pergunta` | 10 | `validarVersao` e `validarItem` (o menor entre a pergunta e o tenant) | RN-PES-07 |
| `texto_max_caracteres` | 2000 | `validarItem` quando a pergunta não define máximo; teto do que a pergunta pode definir | RN-PES-07 |
| `foto_max_lado_px` | 1600 | `validarItem` (`FOTO_GRANDE_DEMAIS`, se a foto informa largura/altura); `dimensoesDaFoto` para o app | RN-PES-06 |
| `foto_jpeg_qualidade` | 80 | o app ao comprimir (mesma regra do Promotor) | RN-PES-06 |
| `escala_amplitude_max` | 10 | `validarVersao` (`ESCALA_AMPLITUDE`: fim − início) | premissa T-0012 |

`resolverParametros` recusa valores inválidos (tolerância negativa/fracionada ou > 168 h, fuso inexistente, limites < 1).

## 1. Questionário versionado — RF-PES-05, RN-PES-01 (`questionario.ts`)
- **Cabeçalho** (`Questionario`: id, tenant, `arquivado_em`) é estável. **Tudo que o respondente vê mora na VERSÃO**: título, perguntas, regras, público-alvo, vigência, frequência e modo. Versões: `rascunho` (editável) ou `publicada` (imutável). Numeração 1, 2, 3… por questionário.
- **Rascunho editável** (`editarRascunho`): devolve uma cópia com as alterações. Em versão publicada devolve `VERSAO_PUBLICADA_IMUTAVEL` ("Esta versão já foi publicada e não pode mudar. Crie uma nova versão…"). `podeAlterarVersao` é o guarda que a API chama antes de qualquer UPDATE.
- **Publicar congela** (`publicarVersao`): valida (§3 e §5), grava `publicada_em` e `publicada_por` e devolve o objeto **congelado em profundidade** (`Object.freeze`). Recusas: `VERSAO_PUBLICADA_IMUTAVEL` (já publicada), `VERSAO_ANTIGA` (existe publicada mais nova), `VERSAO_INVALIDA` (com a lista de problemas em `detalhes`), incluindo `VIGENCIA_ENCERRADA` (fim no passado). Avisos não impedem.
- **Editar cria nova versão** (`iniciarEdicao`): com rascunho aberto, continua nele (um rascunho por vez); senão copia a versão de maior número para um rascunho `numero + 1`. **Os ids de pergunta e de opção são mantidos** na cópia (permite comparar resultados entre versões). Exemplo: v1 publicada → editar → rascunho v2; publicar v2 → v1 continua guardada, v2 é a vigente.
- **Versão vigente** (`versaoVigente`): a publicada de maior número; questionário arquivado ou sem publicada → `null`. Rascunho nunca é oferecido.
- **Respostas guardam a versão** (`versaoDaResposta`, `validarResposta`): a resposta cita `versao_id`; é validada contra **essa** versão, mesmo que já exista uma mais nova. Exemplo: v2 passou a exigir a pergunta P2; uma resposta feita offline na v1 sem P2 continua válida. Versão inexistente/de outro questionário → `VERSAO_INEXISTENTE`; rascunho → `VERSAO_NAO_PUBLICADA`.
- **Auditoria** (RN-AUD-01): a API grava a publicação (quem, quando, antes/depois); o domain devolve os dados.

## 2. Tipos de pergunta e validação da resposta — RF-PES-01 (`resposta-item.ts`, `resposta.ts`)
Nove tipos (união discriminada `tipo` nos contracts). A resposta de cada pergunta é um `ItemResposta` do mesmo tipo.

| Tipo | Configuração da pergunta | Resposta válida | Exemplo |
|---|---|---|---|
| `sim_nao` | — | booleano | "Tem ponto extra?" → sim |
| `unica` | ≥ 2 opções | 1 opção da própria pergunta | "Qual marca lidera?" → opção B |
| `multipla` | ≥ 2 opções; `min_selecoes` (padrão 1), `max_selecoes` (padrão todas) | opções da pergunta, sem repetir, dentro de min..max | min 2 / max 2: marcar 1 ou 3 → `SELECOES_FORA_DO_LIMITE` |
| `numero` | `minimo`, `maximo` (inclusivos), `inteiro`, `unidade` | número finito dentro dos limites | faixa 0–100: 100 ok, 100,5 → `VALOR_FORA_DO_LIMITE`; `inteiro`: 3,5 → `VALOR_INVALIDO` |
| `texto` | `min_caracteres`, `max_caracteres` (padrão = parâmetro do tenant) | texto (aparado) entre min e max | máx. 10: 11 caracteres → `TEXTO_FORA_DO_LIMITE` |
| `escala` | `minimo` (1), `maximo` (5), rótulos das pontas | inteiro de mínimo a máximo | 1–5: 0 e 6 recusados, 2,5 → `VALOR_INVALIDO` |
| `data` | `minima`, `maxima` (data civil) | data que existe no calendário e dentro dos limites | 30/02/2026 → `VALOR_INVALIDO` |
| `foto` | `min_fotos` (1), `max_fotos` (5) | fotos com **referência** não vazia, sem repetir id, entre min e max (e ≤ limite do tenant); se informar largura/altura, maior lado ≤ 1600 px (`FOTO_GRANDE_DEMAIS`) | referência vazia → `FOTO_SEM_REFERENCIA` |
| `codigo_barras` | — | 3 a 48 caracteres, sem espaço; dígito GS1 errado só gera **aviso** (RN-PES-06) | `4006381333932` vale, com aviso `CODIGO_GS1_INVALIDO`; `AB` → `CODIGO_INVALIDO` |

- **Item de outro tipo** que a pergunta → `TIPO_DIFERENTE`; **pergunta que não é da versão** → `PERGUNTA_DESCONHECIDA`; **mesma pergunta duas vezes** → `PERGUNTA_REPETIDA`.
- **Item em branco** (texto só com espaços, múltipla sem opção, foto sem arquivo, código vazio) **conta como não respondido** (`itemRespondido`), para o app poder manter o campo vazio no rascunho.
- **Obrigatoriedade** (`validarResposta`, modo `final`): toda pergunta **visível** e obrigatória precisa de resposta (`OBRIGATORIA`: "Responda a pergunta obrigatória …"). **Obrigatória oculta pelas regras condicionais não é exigida.** Resposta guardada para pergunta oculta → `PERGUNTA_OCULTA` (o app usa `descartarRespostasOcultas` antes de salvar). Resposta sem nenhuma pergunta respondida → `SEM_RESPOSTAS`.
- **Rascunho** (RF-PES-04, modo `rascunho`): não exige obrigatórias nem pelo menos uma resposta, mas valida o que foi preenchido. Premissa: o rascunho é só local (não sobe ao servidor, não vai no sync).
- **Código de barras (RN-PES-06)**: só dígitos com 8, 12, 13 ou 14 posições são EAN-8, UPC-A, EAN-13 e DUN-14 e têm o dígito GS1 conferido (soma ponderada 3-1-3… da direita para a esquerda, `gs1Confere`). Dígito errado **não bloqueia**: `validarResposta` devolve `avisos` com `CODIGO_GS1_INVALIDO` ("confira a leitura; se estiver certo, pode seguir"). Qualquer outro código (ex.: Code 128 interno) vale com 3 a 48 caracteres sem espaço.
- **Fotos comprimidas** (RF-PES-04, RN-PES-06): o app reduz para no máximo **1600 px no maior lado** (`dimensoesDaFoto`) e grava JPEG qualidade **80**, mesma regra do Promotor. O domain exige referência e quantidade e, se a foto informar `largura_px`/`altura_px`, recusa maior lado acima do parâmetro. O tamanho em bytes não é validado.

## 3. Regras condicionais — RF-PES-01 (`condicional.ts`)
Regra = `{ pergunta_id (alvo), acao: mostrar | ocultar, origem_id, operador, valor }`. "Pular" uma pergunta = **ocultá-la**.

- **Operadores por tipo da origem**: sim/não e única → `igual`, `diferente`; múltipla → `contem`, `nao_contem`; número, escala e data → `igual`, `diferente`, `maior_que`, `maior_ou_igual`, `menor_que`, `menor_ou_igual`; texto e código → `igual`, `diferente` (sem diferenciar maiúsculas nem espaços nas pontas); foto → só `respondida`/`nao_respondida`. Todos têm `respondida` e `nao_respondida` (sem valor). O valor precisa ser do tipo certo (opção da origem, número, data real, booleano).
- **Referência só para pergunta anterior** (`REGRA_ORIGEM_NAO_ANTERIOR`): "A regra de "Y" olha "X", que vem depois…". Origem/alvo inexistente → `REGRA_ORIGEM_INEXISTENTE` / `REGRA_ALVO_INEXISTENTE`.
- **Ciclo** (`REGRA_CICLO`): detecta por busca em profundidade (inclui a pergunta que depende de si mesma) e mostra o caminho: "As regras formam um ciclo: "A" → "B" → "A"". Cada ciclo é reportado uma vez.
- **Aviso de pergunta inalcançável** (`PERGUNTA_INALCANCAVEL`, não impede publicar): a pergunta nunca aparece porque (a) nenhuma regra "mostrar" pode ser verdadeira — ex.: "mostrar se escala = 7" numa escala 1–5, "maior que 5" na 1–5, "igual a 150" num número 0–100, "não respondida" sobre pergunta obrigatória sempre visível; (b) a origem é inalcançável (propaga); ou (c) há regra "ocultar" sempre verdadeira ("respondida" sobre obrigatória sempre visível).
- **Perguntas visíveis** (`calcularVisiveis`, `perguntasVisiveis`): percorre na ordem do questionário. Toda pergunta é visível por padrão; com regras "mostrar", aparece se **qualquer uma** for verdadeira (OU, RN-PES-05); regra "ocultar" verdadeira **vence**. Resposta de pergunta oculta é tratada como sem resposta nas regras seguintes (cascata). Sem resposta, só `nao_respondida` é verdadeira (as comparações dão falso).
- Exemplo: P1 "Tem ponto extra?" (sim/não); P2 "Descreva" obrigatória com a regra "mostrar se P1 = sim". Com P1 = não, P2 não é exigida; com P1 = sim, P2 é exigida (`OBRIGATORIA`); P1 = não com P2 preenchida → `PERGUNTA_OCULTA`.

## 4. Público-alvo, vigência e frequência — RF-PES-02, RN-PES-02, RN-PES-04 (`publico.ts`)
- **Público do usuário**: `perfis` (apenas vendedor, promotor, supervisor, gerente, que são quem responde, doc 03 §2) e `equipes`. Lista vazia = sem restrição; perfil e equipe preenchidos valem juntos (E). A equipe vale pela **lista de equipes do usuário (a dele e as acima na árvore)**, que o Core informa (premissa).
- **Público do cliente** (RN-PES-05): `segmentos` e `regioes` valem juntos (E; comparação sem diferenciar maiúsculas); a lista `clientes` **soma** (OU). **Não há "canal"** no público-alvo até o Core ter esse campo (o contrato recusa `canais`). Sem nenhum critério de cliente vale para qualquer cliente e também sem cliente (pesquisa avulsa sem cliente). Com critério e sem cliente em contexto não se aplica ("Escolha o cliente para responder").
- **Vigência** (`vigenteEm`): `inicio` e `fim` em UTC, **inclusivos**; `fim = null` = sem prazo. Exemplo (Manaus, UTC−4): vigência 01/10 00:00 a 30/10 23:59:59 locais = `2026-10-01T04:00:00Z` a `2026-10-31T03:59:59Z`.
- **Frequência** (`frequenciaPermite`, RN-PES-02) — controla a **oferta**, nunca recusa resposta já recebida. Chave = o **cliente** quando há cliente em contexto (qualquer usuário conta; RN-PES-02, decidido) e o **usuário** quando não há (premissa: a regra não fala de resposta sem cliente).

| Frequência | Reaparece | Exemplo (hoje = sáb. 31/10/2026) |
|---|---|---|
| `uma_vez_por_cliente` | nunca para o mesmo cliente | respondida em 20/10 → não oferece |
| `a_cada_visita` (padrão) | em toda visita nova; some na visita que já respondeu; sem visita em contexto não limita | resposta da visita 71 não impede a visita 70 |
| `semanal` | semana civil **segunda a domingo** no fuso do tenant (RN-PES-02) | respondida seg. 26/10 → `liberada_em` 02/11 |
| `mensal` | mês civil no fuso do tenant (RN-PES-02) | respondida 02/10 → `liberada_em` 01/11 (dezembro → 01/01 do ano seguinte) |

  O "dia" da resposta é o do fuso do tenant: 26/10 02:00Z é domingo 25/10 22:00 em Manaus, ainda na semana anterior.
- **Aplicável** (`pesquisaAplicavel(questionario, versoes, contexto)`): avalia a **versão vigente** e recusa com motivo, nesta ordem: `QUESTIONARIO_ARQUIVADO`, `SEM_VERSAO_PUBLICADA`, `FORA_DA_VIGENCIA`, `PERFIL_FORA_DO_PUBLICO`, `EQUIPE_FORA_DO_PUBLICO`, `CLIENTE_FORA_DO_PUBLICO`, `FREQUENCIA` (com `liberada_em`). Mensagens em português para a aba "Pesquisas".

## 5. Validação do questionário para publicar — RF-PES-01, RF-PES-02 (`validarVersao`)
Erros (impedem publicar): `SEM_PERGUNTAS`, `LIMITE_PERGUNTAS`, `IDS_REPETIDOS` (pergunta ou opção), `LIMITE_OPCOES`, `SELECOES_INVALIDAS` (min > max ou além das opções), `ESCALA_AMPLITUDE`, `FOTOS_ACIMA_DO_LIMITE`, `TEXTO_ACIMA_DO_LIMITE`, `VIGENCIA_INVALIDA` (fim antes do início), e os erros de regra do §3. Avisos: `PERGUNTA_INALCANCAVEL`, `ROTULOS_REPETIDOS` (opções com o mesmo texto), `PUBLICO_ABERTO` (sem nenhum critério: vale para todos os perfis de campo do tenant).

## 6. Pesquisa obrigatória no checkout — RF-PES-03, RN-PES-03, RN-CORE-12 (`checkout.ts`)
- **Modo** da versão: `avulsa` (aba "Pesquisas", nunca entra no checkout) ou `checkout_obrigatoria` (etapa do checkout, ponto de extensão `visita.etapas_checkout` do Core).
- `avaliarEtapaCheckout` recebe as pesquisas do tenant, usuário, cliente, `visita_id`, `agora`, as respostas já feitas (sincronizadas **e** da outbox) e `cliente_fechado`. Para cada pesquisa cuja **versão vigente** é `checkout_obrigatoria`:
  - já existe resposta **desta visita** → `concluida`;
  - senão, se é aplicável (§4, inclusive frequência) → `pendente`; se `cliente_fechado` → `dispensada` (**exceção da RN-PES-03 / RN-CORE-14**: não bloqueia);
  - não aplicável (fora do público, da vigência, frequência cumprida em outra visita) → fora da etapa.
- `bloqueia_checkout` = existe `pendente`. `concluida = !bloqueia_checkout` é o valor para `EtapaCheckout.concluida` do Core. `mensagem`: "Responda a pesquisa "Gôndola do mês" para concluir o checkout." (ou lista, se forem várias). A API também recusa o checkout (RN-CORE-12).
- Exemplo: pesquisa mensal obrigatória, respondida na visita de 05/10; na visita de 20/10 não bloqueia (frequência cumprida no mês).
- **Cliente fechado (RN-CORE-14)**: o `ContextoCheckout` do Core traz `clienteFechado` e `motivoClienteFechado` (`loja_fechada` | `acesso_negado`) desde o recado R-20261031-131419-modulo-core. `clienteFechadoNoContexto(ctx)` converte para a entrada `cliente_fechado`; o `concluida()` da etapa (app, ainda por fazer) deve usá-lo. O core também oculta as etapas na folha.
- O Core só tem ponto de extensão no **checkout**; "check-in" não bloqueia nada (premissa).

## 7. Offline: só inserção e idempotência — RF-PES-04, doc 04 "Conflitos" (`idempotencia.ts`)
- O aparelho gera o UUID da resposta. `decidirInsercao(existente, nova)`: id novo → `inserir`; mesmo id **e mesmo conteúdo** → `duplicada` (no-op; reenviar o lote não muda nada); mesmo id com conteúdo diferente → `conflito` (`CONFLITO_DE_CONTEUDO`) e **nunca sobrescreve**.
- "Mesmo conteúdo" = id, questionário, versão, cliente, visita, hora do aparelho e itens; a **ordem** dos itens, das opções marcadas e das fotos não importa; campos do servidor (tenant, usuário, `recebida_em`) ficam de fora (`impressaoDaResposta`).
- `processarLote` processa na ordem recebida; o mesmo id repetido no lote vale uma vez (a 2ª igual é `duplicada`, a 2ª diferente é `conflito`).
- **Hora do aparelho e de recebimento** (RN-PES-04, `avaliarRecebimentoDaResposta`): o aparelho guarda `respondida_em`; o **servidor grava `recebida_em`**. A vigência usa a hora do **aparelho** (resposta feita offline no prazo vale mesmo sincronizada depois), com tolerância de [24 h] nas duas pontas. **Nada é recusado**: relógio do aparelho mais de 24 h **adiantado** em relação ao servidor (`RELOGIO_ADIANTADO`) ou resposta fora da vigência (`ANTES_DA_VIGENCIA` / `APOS_A_VIGENCIA`) é **aceita e sinalizada** (`suspeita = true` e `motivos_suspeita` na resposta, `suspeita` no evento, contagem `respostas_suspeitas` no resultado). Exemplo: fim 31/10 03:59:59Z; resposta do aparelho em 01/11 03:59:59Z não é suspeita (+24 h); 01/11 04:00:00Z entra com `APOS_A_VIGENCIA`. Tolerância 0 vale exatamente o fim.
- A vigência checada é a da **versão que a resposta cita**; publicar a v2 não encerra a v1 (resposta offline na v1 continua aceita).

## 8. Resultados — RF-PES-06 (`resultados.ts`, `agregarResultados`)
- **Entrada**: uma versão, as respostas, `filtro` (`de`/`ate` em dia civil do fuso do tenant, inclusivo, sobre `respondida_em`; `equipe_ids` contra o `equipe_id` da resposta, já expandidos para subequipes se for o caso), `universo` (quem deveria responder: usuários ou clientes do público) e `base` (`usuario` padrão | `cliente`).
- **Por versão**: respostas de outras versões ficam de fora e contam em `ignoradas_outra_versao`. Respostas com o mesmo id contam uma vez. `respostas_suspeitas` conta as aceitas com flag (RN-PES-04), para o BKO exibir/filtrar.
- **Entre versões** (RN-PES-01, `consolidarEntreVersoes`): consolida só perguntas com o **mesmo identificador estável** (`id` e `tipo`) presentes em 2 ou mais versões publicadas; opções entram pela união (por id da opção, rótulo da versão mais recente) e a escala pela união das pontas. Pergunta nova, removida, com outro id ou outro tipo aparece **por versão**; nunca se junta por texto do enunciado.
- **Taxa de resposta** = alvos do universo que responderam ao menos uma vez ÷ tamanho do universo × 100 (universo filtrado por equipe). Quem respondeu e saiu do público não infla a taxa; sem universo ou universo vazio → `null`. Exemplo: público de 4 usuários, 2 responderam (3 respostas) → 50%, `respondentes_distintos` 2.
- **Por pergunta**: `respondentes` e `pct_das_respostas` (respondentes ÷ total de respostas; perguntas condicionais têm menos).
  - sim/não, única e múltipla: contagem por opção (inclusive 0) e `pct` = contagem ÷ respondentes da pergunta (na múltipla a soma passa de 100%). Ex.: 3 respondentes, opções 2/1/0 → 66,67% / 33,33% / 0%.
  - número e escala: média (2 casas), mínimo e máximo; escala também traz a distribuição por ponto (inclui pontos com 0). Ex.: 5, 4, 4, 1 → média 3,5.
  - texto: só `respondentes` (o texto em si vem por listagem da API); data: mais antiga/mais recente; foto: `total_fotos` (a galeria é listagem da API, com a referência de cada foto); código de barras: `codigos_distintos`.
- Escopo (RN-CORE-04): quem filtra a lista de respostas por carteira/equipe é a API; o domain só apura o que recebe. Exportar CSV/Excel é a API/web, sobre esta apuração e a listagem.

## 9. Permissões (`manifest.ts`, doc 03 §2, ADR 0004)
| Ação | Perfis |
|---|---|
| `pesquisa.responder` | vendedor, promotor, supervisor, gerente |
| `questionario.criar` / `.editar` / `.publicar` / `.arquivar` | analista, admin |
| `resultado.ver` / `resultado.exportar` | supervisor, gerente (escopo da equipe), analista, admin |

Assistente não responde nem cria (doc 03 §2). Ver resultados: o doc 03 não traz linha na matriz; seguimos o padrão do Treinamento (gestão e BKO, sem assistente) — premissa. O escopo do dado fica no domain + API.

## 10. Eventos
- Publica `pesquisa.resposta.registrada@1` (doc 02): `resposta_id`, `tenant_id`, `questionario_id`, `versao_id`, `usuario_id`, `equipe_id`, `cliente_id`, `visita_id`, `modo`, `respondida_em`, `recebida_em`, `total_itens`, `suspeita` (RN-PES-04; campo novo com padrão `false`, compatível). Sem o conteúdo das respostas (LGPD e tamanho); o consumidor lê o detalhe pela API da Pesquisa.
- Não publica evento de questionário publicado (o doc 02 só lista o de resposta); a publicação é auditada pela API (RN-AUD-01). Se algum consumidor precisar, nasce `pesquisa.questionario.publicado@1`.
- Consome `core.visita.checkout@1` (já no manifesto) e usa `visita.etapas_checkout` e `cliente.abas`.

## Decididas (Alexandre, R-20261031-125833) — saíram das premissas
Frequência por cliente em períodos civis (RN-PES-02) · "mostrar" em OU e "ocultar" vence, lista de clientes soma aos segmentos, sem "canal" (RN-PES-05) · relógio adiantado e fora da vigência aceitos com suspeita (RN-PES-04) · GS1 inválido só avisa e foto 1600 px/JPEG 80 (RN-PES-06) · limites 50/20/10/2000 como parâmetros do tenant (RN-PES-07) · consolidação entre versões só por id estável (RN-PES-01) · cliente fechado dispensa a pesquisa (RN-PES-03, RN-CORE-14).

## Premissas T-0012 que continuam (a decidir pelo Alexandre)
1. **Sem cliente em contexto** (pesquisa avulsa): a chave da frequência é o usuário.
2. **Equipe**: o Core informa a equipe do usuário e as equipes acima dela; o filtro de equipe nos resultados vem expandido.
3. **Escala**: amplitude máxima de 10 pontos (parâmetro `escala_amplitude_max`).
4. **Rascunho** de resposta só no aparelho; publicar nova versão **não** encerra respostas offline na anterior.
5. **Ver/exportar resultados**: supervisor, gerente, analista, admin (sem assistente).
6. **Checkout**: só há bloqueio no checkout (não no check-in).
7. **Formato de código** que não é EAN/UPC: 3 a 48 caracteres sem espaço.

## Regras acrescentadas na T-0057
| Regra | Onde |
|---|---|
| RF-PES-04 / RN-PES-01/04: recebimento no servidor — idempotência, versão citada, perfil no público, validação completa e suspeita; monta o payload do evento sem o conteúdo | `recebimento.ts` (`receberResposta`) |
| RF-PES-03 / RN-PES-02: pesquisas do aparelho a partir do pull, oferta da aba (só avulsas) e respostas conhecidas (pull + fila) | `oferta.ts` |
| RN-CORE-04: escopo das respostas nos resultados e no pull do aparelho; resumo e filtros da lista do BKO | `bko.ts` |
| RF-PES-06: CSV para Excel pt-BR (BOM, `;`, colunas por id estável, fórmula neutralizada) | `exportacao.ts` |
| RF-PES-06: filtro de respostas exportado (`respostaDentroDoFiltro`) | `resultados.ts` |

API, sync e telas: `api-e-telas.md`.

## Pendências
- Limite de armazenamento de foto (bytes): definir com o app/storage (dimensões e qualidade já decididas, RN-PES-06).
- Migração 0016 (schema `pesquisa`) e implementação SQL do `RepositorioPesquisa` (hoje em memória) — ver `api-e-telas.md`.
- Equipe do usuário e universo do público (Core) para o público por equipe, o filtro por equipe e a taxa de resposta.
- "Canal" volta ao público-alvo quando o Core tiver o campo (RN-PES-05).
- Pesquisa que ofereça "Pesquisas" no Cliente 360 (`cliente.abas`) e o cartão na Gestão: telas e API, fora da T-0012.
- Tabelas: banco-dados decide como gravar perguntas/opções/regras (o contrato aninha tudo na versão); o `sync` do manifesto pode ganhar `opcao`/`regra_condicional` se virarem tabelas próprias.

# Catálogo → Fotos em lote (BKO) — especificação visual (designer-ux)

> 2026-11-15 (Manaus) · designer-ux · T-0174 · RN-CAT-14, RF-CAT-07 · desenho `docs/desenho/T-0174.md` (§0, §1.3, §3.4, §5)
> Tela de `modules/catalogo/web/pages/fotos-lote` (dono: modulo-catalogo). Kit: `packages/ui/src/web/`.
> Regras transversais: revisão do BKO (`docs/design/telas/bko-revisao.md` §P1 a §P9): uma informação num lugar só,
> só o texto que o usuário usa para agir, um botão principal por tela.
>
> **Simulação aprovada pelo dono do produto:** `recados/anexos/R-20261115-071800-upload-fotos.png` (repositório
> `aloirr/macuxifdv-recados`). **Não abriu nesta sessão (403).** Esta spec saiu do desenho e da RN-CAT-14. Os pontos
> marcados **[conferir simulação]** são de layout e precisam ser conferidos contra a imagem antes do print para a marca;
> se divergirem, **vale a simulação** e esta spec é corrigida.

---

## 1. Menu, rotas e quem vê

| Item | Valor |
|---|---|
| Menu | grupo **Produtos**, item **Fotos em lote** (ordem alfabética: Catálogo, Fotos em lote, Marcas concorrentes, Preço e custo, Tabelas de preço) |
| Rotas | `/catalogo/fotos-lote` (envio e lotes recentes) · `/catalogo/fotos-lote/:id` (um lote: andamento e relatório) |
| Ação | `produto.enriquecer`; sem a ação, o item não aparece no menu e a URL mostra o erro padrão de acesso do shell |
| Título da página (`titulo`/`navegacao`) | `Fotos em lote` |

## 2. Página de envio — `/catalogo/fotos-lote`

Ordem de cima para baixo:

1. **Cabeçalho** (`PageHeader`): título `Fotos em lote`. Sem subtítulo, sem botão no cabeçalho (o principal está na área de envio).
2. **Avisos** (`Notice`, um só por vez, logo abaixo do cabeçalho): erros da seção 6.1. É o único lugar de aviso da página.
3. **Área de envio** (seção 2.1).
4. **Lotes recentes** (`Panel` com título, seção 2.2). Some quando não há lote.

### 2.1 Área de envio [conferir simulação]
Quadro tracejado do tamanho da largura útil, 200 px de altura mínima (mesmas classes do `EstadoVazio`:
`rounded-2xl border border-dashed border-field`, fundo `bg-surface`), conteúdo centralizado:

| Ordem | Elemento | Texto exato | Componente / estilo |
|---|---|---|---|
| 1 | Linha principal | `Arraste o ZIP aqui ou` | IBM Plex 600, 14 px, `text-ink-2` |
| 2 | Botão principal (o único da página) | `Escolher ZIP` | `Button variant="primary"` (42 px), sem ícone; abre `<input type="file" accept=".zip,application/zip">` escondido |
| 3 | Como nomear | `Nome da foto = código ou EAN do produto. A1.jpg é a 1ª foto; A1_2.jpg, a 2ª.` | 13 px, `text-ink-2` |
| 4 | Limites | `JPEG, PNG ou WEBP · até 8 MB por foto · até 10.000 fotos · ZIP até 500 MB` | 12 px, `text-ink-2`, algarismos `tabular-nums` |

- **Arrastando por cima:** borda contínua de 2 px `border-accent` e fundo `bg-accent-soft`; a linha 1 vira `Solte o ZIP aqui`.
- O quadro inteiro aceita soltar; só o botão recebe foco e clique (Tab chega nele; `aria-describedby` aponta para as linhas 3 e 4).
- Mais de um arquivo solto: usa o primeiro `.zip` e ignora o resto (sem aviso).
- **Com 2 lotes em processamento** (`FOTO_LOTE_ATIVOS_MAX`): o botão fica desligado e a linha 1 vira
  `Espere um dos lotes em processamento terminar para enviar outro.` (a mesma frase do 409 `LOTE_EM_ANDAMENTO`).
- Ao escolher um arquivo válido, a página vai na hora para `/catalogo/fotos-lote/:id` (seção 3) e o envio começa lá.

### 2.2 Lotes recentes
`Panel title="Lotes recentes"` + `TabelaDados` (rótulo `Lotes recentes`), os 20 de `GET fotos-lote`, mais novo em cima.
Clique na linha abre `/catalogo/fotos-lote/:id`.

| Coluna | Prioridade / largura | Conteúdo |
|---|---|---|
| Arquivo | 1, 36% | `nome_arquivo` (reticências; nome inteiro no `title`) |
| Enviado em | 2, 140 px, número | `formatDateTime(criado_em)` no fuso do tenant (`15/11 09:12`) |
| Fotos | 2, 88 px, número | `total` com `formatInt`; `—` enquanto `total` é nulo |
| Ligadas | 1, 88 px, número | `totais.ligado` |
| Situação | 1, 150 px | um selo (`SeloSituacao`), rótulos e tons da seção 5.1 |
| ⋯ | 52 px | `Baixar CSV` (só `concluido`) |

- Sem lote: o quadro **não aparece** (a área de envio já é o estado vazio da página; nada de "Nenhum lote ainda").
- Carregando: `LoadingBlock` dentro do quadro. Erro: `ErrorBlock` com `Tentar de novo`.

## 3. Página do lote — `/catalogo/fotos-lote/:id`

### 3.1 Cabeçalho
`PageHeader` com `eyebrow` `‹ Fotos em lote` (volta para a seção 2), título = `nome_arquivo`, `badge` = selo da
situação do lote (seção 5.1). Ações à direita, conforme o estado:

| Estado do lote | Secundário | Principal |
|---|---|---|
| enviando (`aguardando_envio`, envio nesta aba) | `Cancelar envio` | — |
| `enfileirado`, `conferindo`, `processando` | — | — |
| `concluido` | `Baixar CSV` (`IconDownload`) | `Enviar outro ZIP` |
| `recusado`, `falhou` | — | `Enviar outro ZIP` |

`Enviar outro ZIP` volta para `/catalogo/fotos-lote` e abre o seletor de arquivo. `Baixar CSV` baixa
`GET fotos-lote/:id/relatorio.csv` (nome do arquivo vem da API); enquanto baixa, `Baixando…` e o botão desligado.

### 3.2 Avisos (um lugar só, abaixo do cabeçalho)
`Notice` único; textos na seção 6. Casos: erro do envio, lote recusado, lote que falhou, ZIP repetido (abre o lote
existente, seção 3.6). Nenhum outro aviso na página.

### 3.3 Andamento (até sair de `enfileirado | conferindo | processando`) [conferir simulação]
`Panel` sem título, acima dos cartões. Um elemento por vez:

| Fase | O que aparece | Texto exato |
|---|---|---|
| Enviando (partes de 8 MiB, `File.slice`) | `Progresso` (tom `destaque`) por bytes | rótulo `Enviando`; valor `120 de 340 MB` (MB inteiros, `formatInt`) |
| | linha abaixo, 13 px `text-ink-2` | `Mantenha esta aba aberta até o envio terminar.` |
| `enfileirado` | `LoadingBlock` | `Na fila…` |
| `conferindo` | `LoadingBlock` | `Conferindo o ZIP…` |
| `processando` | `Progresso` (tom `destaque`); `valor` = total − `totais.pendente`, `maximo` = `total` | rótulo `Processando`; valor `1.240 de 3.000 fotos` |

- O quadro some quando o lote termina; os cartões e a tabela ficam.
- A página consulta `GET fotos-lote/:id` a cada 2 s só nessas fases (desenho §3.4). Sem animação extra: a barra anda
  com `transition: width 240ms`, desligada com `prefers-reduced-motion`.
- "Mantenha esta aba aberta" é a única linha de orientação e só existe durante o envio: fechar a aba para o envio,
  então é texto para agir. No processamento não há texto: o lote continua em Lotes recentes.

### 3.4 Cartões do relatório (aparecem a partir de `processando`, contando ao vivo) [conferir simulação]
`KpiGrid min={200}` com `KpiCard`, cada cartão é um **botão de filtro** da tabela (regra §P4.6 da revisão do BKO:
o cartão filtra, sem select de situação repetido).

| # | Rótulo | Valor | Cor do número | Filtra por | Quando aparece |
|---|---|---|---|---|---|
| 1 | `Ligadas` | `totais.ligado` | `text-success` | `ligado` | sempre |
| 2 | `Sem produto ou ambíguas` | `sem_produto + ambiguo` | `text-warning` (0 → `text-ink`) | `sem_produto` e `ambiguo` | sempre |
| 3 | `Recusadas` | `totais.recusado` | `text-danger` (0 → `text-ink`) | `recusado` | sempre |
| 4 | `Repetidas` | `totais.repetido` | `text-ink-2` | `repetido` | **só com 1 ou mais** |

**Decisão — "repetido" é o 4º cartão, e só aparece quando há repetida:** repetida não é foto nova no app (não cabe em
"Ligadas") nem problema a corrigir (não cabe em "Recusadas"); misturar faria o analista contar foto nova que não entrou
ou procurar erro que não existe, e o cartão com zero não leva a nenhuma ação.

- O cartão 2 filtra duas situações: `FotoLoteItensQuery.situacao` precisa aceitar uma lista
  (`situacao=sem_produto,ambiguo`) — pedido ao modulo-catalogo (contrato dele). Na tabela, o selo separa as duas.
- Cartão marcado: traço de 2 px `border-accent` e fundo `bg-accent-soft`, `aria-pressed="true"`; outro clique no mesmo
  desmarca. Botão inteiro com alvo ≥ 44 px, foco visível (`outline-accent`).
- Com um cartão marcado, aparece `Limpar filtro` (`Button size="sm"`, secundário) à direita, acima da tabela. Só ali.
- Os números dos cartões são a contagem do relatório: a tabela não leva título nem contagem própria (§P6).
- Cor nunca sozinha: o rótulo diz a situação; o número com zero fica em `text-ink` (não pinta de vermelho um zero).

### 3.5 Tabela por arquivo
`TabelaDados` sem título (rótulo `Fotos do lote`), `GET fotos-lote/:id/itens` com o filtro do cartão, ordem do ZIP
(`indice`), 100 por página e o botão secundário `Mostrar mais` no fim (some quando `proximo` é nulo).
Durante o processamento, mostra só os itens já resolvidos (sem `pendente`); a lista se atualiza junto com os cartões.

| Coluna | Prioridade / largura | Conteúdo |
|---|---|---|
| Arquivo | 1, 30% | `arquivo` (caminho no ZIP; reticências no começo da pasta, nome inteiro no `title`) |
| Situação | 1, 130 px | um selo (seção 5.2) |
| Produto | 2, 22% | `produto_codigo` em `ligado` e `repetido`; `—` nos demais |
| Ordem | 2, 72 px, número | `ordem` em `ligado` e `repetido` (`1`, `2`…); `—` nos demais |
| Motivo | 1 | texto da seção 5.3; vazio quando a situação já diz tudo |

- Sem "⋯" (nenhuma ação por linha) e sem clique na linha.
- Vazio com filtro: `EstadoVazio` `Nenhuma foto com esse filtro.` (sem botão; o `Limpar filtro` já está acima).
- Lote sem nenhuma foto considerada (ZIP só com pastas, `__MACOSX` ou ocultos; `total = 0`):
  `EstadoVazio` `Nenhuma foto no ZIP.`, sem botão (o `Enviar outro ZIP` do cabeçalho já leva ao envio); os cartões
  não aparecem.
- Carregando: `LoadingBlock`. Erro: `ErrorBlock` com `Tentar de novo`.

### 3.6 Lote repetido (mesmo ZIP enviado de novo)
Quando o lote novo termina como `duplicado`, a página troca para `/catalogo/fotos-lote/<duplicado_de>` (substitui o
endereço; o Voltar do navegador não volta ao lote `duplicado`) e mostra o aviso `info`:
`Este ZIP já foi enviado em 15/11 às 09:12. O resultado está abaixo.` (data `criado_em` do lote existente, fuso do tenant).
O lote `duplicado` não aparece em Lotes recentes (a API já o tira).

## 4. Estados da página do lote (resumo)

| Situação do lote | Cabeçalho (selo · ações) | Aviso | Andamento | Cartões e tabela |
|---|---|---|---|---|
| enviando | `Enviando` · Cancelar envio | — (ou erro do envio) | barra por bytes | não |
| `aguardando_envio` aberto em outra aba ou depois de fechar | `Envio interrompido` · Enviar outro ZIP | — | não | não |
| `enfileirado` | `Na fila` | — | `Na fila…` | não |
| `conferindo` | `Conferindo` | — | `Conferindo o ZIP…` | não |
| `processando` | `Processando` | — | barra por fotos | sim, ao vivo |
| `concluido` | `Concluído` · Baixar CSV, Enviar outro ZIP | — | não | sim |
| `recusado` | `Recusado` · Enviar outro ZIP | motivo do lote (5.4), `danger` | não | não |
| `falhou` | `Falhou` · Enviar outro ZIP | `Não foi possível processar o ZIP. Envie de novo.`, `danger` | não | sim, se houver item resolvido |
| `duplicado` | (troca para o lote existente, 3.6) | `info` da 3.6 | — | do lote existente |

"Envio interrompido" vale para `aguardando_envio` sem envio em andamento nesta aba (não há como retomar o arquivo
local depois de fechar a aba).

## 5. Rótulos (para `contracts` do Catálogo: `ROTULO_SITUACAO_LOTE`, `ROTULO_SITUACAO_ITEM`, `ROTULO_MOTIVO_LOTE`, `ROTULO_MOTIVO_ITEM`)

### 5.1 `SituacaoLote` (selo `Badge`)
| Valor | Rótulo | Tom |
|---|---|---|
| `aguardando_envio` | `Enviando` (com envio nesta aba) · `Envio interrompido` (sem) | `pending` · `warning` |
| `enfileirado` | `Na fila` | `neutral` |
| `conferindo` | `Conferindo` | `pending` |
| `processando` | `Processando` | `pending` |
| `concluido` | `Concluído` | `success` |
| `recusado` | `Recusado` | `danger` |
| `falhou` | `Falhou` | `danger` |
| `duplicado` | `Já enviado` | `neutral` (não aparece em lista; só para o CSV e a auditoria) |

### 5.2 `SituacaoItem` (selo na tabela; mesma palavra na coluna do CSV)
| Valor | Rótulo | Tom |
|---|---|---|
| `pendente` | `Na fila` | `neutral` |
| `ligado` | `Ligada` | `success` |
| `sem_produto` | `Sem produto` | `warning` |
| `ambiguo` | `Ambígua` | `warning` |
| `recusado` | `Recusada` | `danger` |
| `repetido` | `Repetida` | `neutral` |

### 5.3 Coluna Motivo (texto da tabela e do CSV)
| Situação / `MotivoItem` | Texto exato |
|---|---|
| `ligado`, `repetido`, `sem_produto` | (vazio: a situação e o nome do arquivo já dizem) |
| `ambiguo` | `Serve para {códigos}` — `codigos_candidatos` separados por vírgula e o último por "e" (`Serve para AB e ab`) |
| `caminho_invalido` | `Caminho inválido no ZIP` |
| `criptografado` | `Arquivo com senha` |
| `compressao_nao_suportada` | `Compactação não aceita` |
| `arquivo_vazio` | `Arquivo vazio` |
| `foto_grande` | `Foto acima de 8 MB` |
| `compressao_suspeita` | `Compactação suspeita` |
| `entrada_corrompida` | `Arquivo corrompido` |
| `tipo_nao_aceito` | `Não é JPEG, PNG nem WEBP` |
| `foto_ilegivel` | `Foto não abre` |
| `nome_invalido` | `Nome não é código nem EAN` |
| `ordem_repetida_no_lote` | `Outra foto do ZIP tem a mesma ordem` |

Nota: `tipo_detectado` não aparece na tela (não muda a ação: trocar o arquivo). Pode ir no CSV numa coluna própria, se o
modulo-catalogo quiser manter; sem texto explicativo.

### 5.4 `MotivoLote` (aviso `danger` do lote recusado; os dois primeiros também valem no navegador, antes do envio)
| Valor | Texto exato |
|---|---|
| `zip_grande` | `O ZIP passa de 500 MB. Divida as fotos em mais de um ZIP.` |
| `muitos_arquivos` | `O ZIP passa de 10.000 arquivos. Divida as fotos em mais de um ZIP.` |
| `descompactado_grande` | `As fotos passam de 1 GB descompactadas. Divida em mais de um ZIP.` |
| `zip_invalido` | `O arquivo não abre como ZIP. Compacte as fotos de novo.` |
| `zip64_nao_suportado` | `Formato de ZIP não aceito. Compacte de novo sem a opção ZIP64.` |
| `zip_incompleto` | `O ZIP chegou incompleto. Envie de novo.` |

Os números (500 MB, 10.000, 8 MB) saem dos limites efetivos do tenant (`PARAMETROS_FOTO_LOTE`), não fixos no texto.

## 6. Mensagens do envio (navegador e API)

### 6.1 Antes de criar o lote (aviso na página de envio, `danger`)
| Caso | Texto exato |
|---|---|
| arquivo sem `.zip` | `Escolha um arquivo .zip.` |
| tamanho > limite (navegador ou 422 `RN-CAT-14`) | o de `zip_grande` (5.4) |
| 409 `LOTE_EM_ANDAMENTO` | `Espere um dos lotes em processamento terminar para enviar outro.` |
| sem `produto.enriquecer` (403) ou outro erro | `ErrorBlock` padrão (`MENSAGEM_ERRO_PADRAO`) |

### 6.2 Durante o envio (aviso na página do lote, `danger`, com a ação dentro)
| Caso | Texto exato | Ação |
|---|---|---|
| parte falhou 3 vezes | `O envio parou. Confira a internet e tente de novo.` | `Tentar de novo` (link do `ErrorBlock`; recomeça da parte que falhou) |
| 409 `ENVIO_INCOMPLETO` no `concluir` | o mesmo texto | `Tentar de novo` |
| `Cancelar envio` | pergunta no `Dialog`: título `Cancelar o envio?`; botões `Continuar enviando` (secundário) e `Cancelar envio` (perigo) | volta para a seção 2, sem aviso |

Ao fechar ou recarregar a aba durante o envio, o navegador pede confirmação (`beforeunload`, texto padrão do navegador).

## 7. Componentes

| Uso | Componente (`@macuxi/ui/web`) |
|---|---|
| Cabeçalho, eyebrow, selo | `PageHeader`, `Badge`/`SeloSituacao` |
| Botões | `Button` (`primary`, `secondary`, `danger`, `size="sm"`) |
| Avisos | `Notice`, `ErrorBlock`, `LoadingBlock` |
| Barra de envio e de processamento | `Progresso` (**exportado agora** em `packages/ui/src/web/index.ts`; já existia em `progresso.tsx`, só não saía no índice) |
| Cartões | `KpiGrid`, `KpiCard` (o cartão-filtro é o `KpiCard` dentro de um `<button aria-pressed>`, como o Farol §P4.6) |
| Tabelas | `TabelaDados`, `EstadoVazio`, `MenuAcoes` (⋯ dos lotes recentes) |
| Confirmar cancelamento | `Dialog` |
| Datas e números | `formatDateTime`, `formatInt` (fuso do tenant) |

**Componente novo: nenhum agora.** A área de envio é composta na página com o `Button` e o `<input type="file">`
escondido, nas classes da seção 2.1. Se uma segunda tela pedir arrastar e soltar (Carga por arquivo, Fotos do PDV),
vira `AreaDeEnvio` no kit, numa tarefa própria.

## 8. Acessibilidade e conferência
- Alvo de toque e clique ≥ 44 px nos cartões-filtro; botões de 42/38 px dentro de linhas de 44 px.
- Contraste: textos `text-ink-2` (12 px e 13 px) e números `text-success`/`text-warning`/`text-danger` no branco já
  passam de 4,5:1 (tons do kit, MC-0057).
- `Progresso` com `aria-valuetext` igual ao texto visível; ao terminar, o selo do cabeçalho muda e um `role="status"`
  (o do `Notice`/`LoadingBlock`) anuncia.
- Imprimir para corretor e marca (1366×768): envio vazio, enviando, processando, concluído com as 4 situações e o
  filtro "Recusadas" marcado, lote repetido, lote recusado por `zip_grande`.

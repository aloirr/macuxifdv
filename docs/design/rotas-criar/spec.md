# BKO → Operação → Rotas: criar a rota do vendedor por proximidade (R0 da v1.0.19)

Pedido do Alexandre (R-20261120-183536): "Aqui deve ter uma opção de eu cadastrar a rota do mes do vendedor. clico em criar rota e ai filtro qual dia,
semana ou mes quero criar rota. e ai aperto o botao criar por proximidade. o vendedor deve ter o endereço dele no cadastro, pois será usado como
referencia base para a rota do vendedor. esse endereço irá aparecer na rota, com o lapis para cadastrar um novo endereço base para ele, caso nao
queira usar a casa como referencia."

Esta R0 é **só especificação e simulação**: nada muda no sistema (sem código, migração ou contrato). Escrita pelo designer-ux em 20/11/2026, 18h50 (Manaus).
Tela de referência: 1366×768, menu lateral aberto, sem rolagem lateral. Regras do corretor: uma informação, um lugar; só o texto que a pessoa usa para agir;
aviso só na área "Alertas" quando a tela tem uma. Um só botão principal por tela.

Decidido no pedido:
1. Botão **Criar rota** na tela Rotas: escolhe vendedor e período (dia, semana ou mês) com o mesmo seletor da tela.
2. Botão **Criar por proximidade**: monta a rota com os clientes da carteira em ordem de proximidade a partir do endereço base do vendedor. O algoritmo é o
   que já existe (`modules/core/domain/route.ts`: vizinho mais próximo + 2-opt); muda só o ponto de partida.
3. O vendedor ganha **endereço no cadastro** (Usuários), usado como referência base.
4. Na rota, o endereço base aparece **no lugar do "CD Saída"**, com um **lápis** para cadastrar outro endereço base.

## 0. O que já existe no código (conferido em 20/11/2026)

| Assunto | O que achei | Onde |
|---|---|---|
| Ponto "CD Saída" | **Não vem de cadastro**: é um ponto fixo no código (`{ lat: -3.125, lng: -59.97 }`, Manaus), com o comentário "sem endereço de CD no cadastro nesta sprint". O popup do mapa diz "CD Manaus" para todo tenant. | `modules/core/web/lib/rotas-api.ts:9-10`; `modules/core/web/lib/queries.ts` (`useRoutes` devolve `start: INICIO_PADRAO`); `modules/core/web/components/routes/route-map.tsx:37-39,133-137` |
| Filial | Tem endereço em texto (logradouro, número, bairro, CEP, cidade, UF), **sem latitude/longitude**. | `db/migrations/0056_core_filial.up.sql`, `0059_core_filial_dados_fiscais.up.sql` |
| Usuário (vendedor) | `core.usuario` **não tem endereço** nem coordenada. | `db/migrations/0002_core.up.sql:43` e as `alter table core.usuario` seguintes (0004, 0036, 0040, 0063, 0077, 0080, 0084) |
| vendedor.csv do Conector | `external_id;nome;alterado_em;ativo;email;telefone;filial_external_id` — sem endereço. O contrato `VendedorPayload` também não tem. | `modules/integracao/kit-thathyany/modelos/vendedor.csv`; `modules/integracao/contracts/entidades.ts` (`VendedorPayload`) |
| Lat/long do cliente | `core.cliente.latitude/longitude` e `core.cliente_endereco.latitude/longitude`. Origem 1: **ERP pelo Conector** (`ClientePayload.latitude/longitude`, colunas `latitude;longitude` do `cliente.csv`, opcionais — o modelo vem vazio). Origem 2: **1º check-in** de cliente sem coordenada sugere a posição; o analista aprova em **Coordenadas sugeridas** (RN-CORE-10, `PUT /v1/core/clientes/:id/coordenada`). Não há digitação de coordenada no cadastro do cliente. | `db/migrations/0002_core.up.sql:134`; `0013_catalogo_vendedor_prevenda.up.sql:95-121`; `modules/core/api/consumidores-erp.ts:30`; `modules/core/web/components/coordenadas/coordenadas-page.tsx` |
| Geocodificação | **Não existe**: nenhuma chamada a Google, Mapbox, Nominatim, OpenCage ou HERE no repositório. O mapa do BKO usa tiles do OpenStreetMap (Leaflet), só para desenhar. | busca em todo o repositório; `route-map.tsx:112` |
| Frequência de visita | **Existe**: `core.carteira.frequencia_semanas` (1, 2 ou 4) e `dia_semana` (1 a 7), editáveis no BKO em **Carteira**. O ERP não manda (o `ClientePayload` não tem frequência; a entidade `rota` do ERP manda dia da semana por rota). | `db/migrations/0006_core_lote_a.up.sql:18-21`; `modules/core/web/components/carteira/carteira-page.tsx:14-28,151-178`; `modules/core/api/clientes.ts:224-234` |
| Geração por frequência | **Existe no servidor e não está ligada a nenhuma tela**: `POST /v1/core/rotas/gerar` (semana, usuários) usa `gerarParadasPorFrequencia` e **nunca sobrescreve** rota existente (conta `ignoradas`). Não ordena por proximidade nem olha feriado. A página Carteira diz "A frequência gera a rota da semana", mas nenhum botão chama a rota. | `modules/core/api/rotas.ts:290-328`; `modules/core/domain/agenda.ts:81-102`; só o teste `modules/core/api/visita.db.test.ts:528` chama |
| Rota por dia | Uma rota por vendedor e dia; `origem` = `bko`, `frequencia` ou `erp`. A rota do ERP não sobrescreve dia que já tem rota de outra origem. | `db/migrations/0006_core_lote_a.up.sql:224`; `modules/core/api/consumidores-erp-rota.ts:1-8` |
| Editor do dia | Já tem **Ordenar por proximidade** (a partir da última visitada ou do CD), Adicionar cliente, Refazer horários (40 min a cada 45 min), Copiar este dia para… e o botão "Criar rota" por dia vazio na lista. | `modules/core/web/components/routes/route-editor.tsx:183-196,300-320`; `routes-page.tsx:482-489` |
| Feriados e dias úteis | **Existem**: feriados nacionais (`@macuxi/comum/calendar`) e do tenant (Parâmetros → Calendário, parâmetro `metas.feriados`); semana útil do tenant `metas.dias_uteis_semana` (padrão segunda a sábado no Gestor). A tela Rotas **ignora feriado** hoje: `isBusinessDay` só tira sábado e domingo. | `packages/comum/src/calendar.ts:133-160`; `modules/core/web/components/calendario/`; `modules/core/api/consultas.ts:154-163`; `modules/core/web/lib/routes.ts:32,117-121` |
| Limite de visitas por dia | Não há limite na rota. Há a **meta de produtividade** `visitas_dia` (padrão 11,0 visitas/dia, por tenant, equipe ou usuário). | `modules/core/contracts/performance.ts:36,101` |

Achado de texto na tela atual (corrigir na R1): o vazio aparece duas vezes, "Sem rotas no período." na legenda do mapa (`routes-page.tsx:335`) e
"Nenhuma rota no período com esses filtros." na lista (`routes-page.tsx:460`). Fica só o da lista.

## 1. Fluxo

```
Rotas ── [Criar rota] ──► diálogo "Criar rota": Vendedor + Período (Dia | Semana | Mês, ‹ período ›)
                              └─ [Criar por proximidade] ──► prévia no quadro da direita (mapa mostra a prévia)
                                                                ├─ lápis do endereço base ──► diálogo "Endereço base" ──► a prévia refaz
                                                                ├─ linha do dia ──► editor do dia (o mesmo de hoje, sobre a prévia)
                                                                ├─ [Salvar rotas] ──► grava, toast "19 rotas salvas.", volta à lista do período
                                                                └─ [Descartar] ──► volta à lista sem gravar
```

Quem vê: a ação `rota.editar` (analista e gestor, como hoje). Sem ela, o botão **Criar rota** não aparece.

## 2. Tela Rotas com o botão (`simulacoes/rotas.png`)

Ordem:
1. `PageHeader` **Rotas**, **sem subtítulo** (período e vendedor já estão na `FilterBar`). Ações à direita: `Button` **Atualizar** (secundário) e
   `Button variant="primary"` **Criar rota** com `IconPlus` — o único principal da tela.
2. `FilterBar` igual à de hoje (Período, navegação, Equipe, Vendedor).
3. `KpiGrid` igual quando há rota no período; o subtítulo do Km total passa de "saída do CD, sem volta" para **"a partir da base, sem volta"**.
   **Sem rota no período, o `KpiGrid` não aparece**: o vazio fica só na lista (item 5) e nenhum KPI mostra valor ou subtítulo zerado.
4. Mapa: a legenda troca **CD Saída** por **Base** (ícone de casa, fundo grafite #16202A, borda branca — o mesmo `.fv-start` de hoje com o desenho da casa).
   Sem vendedor no filtro, o mapa mostra a base de cada vendedor com rota no período, na cor do vendedor. **Some o ponto fixo de Manaus**: vendedor sem base
   não tem marcador de saída, e o km conta a partir do 1º cliente.
5. Lista "Rotas do período": vazio = **"Nenhuma rota no período."** (sai o "0 com visitas" quando é zero e sai a frase repetida da legenda).

Os botões "Criar rota" de cada dia vazio na lista continuam (criam a rota de um dia à mão, no editor).

## 3. Diálogo "Criar rota" (`simulacoes/criar.png`)

`Dialog` do kit (`packages/ui/src/web/overlay.tsx`), 540 px.
- Título: **Criar rota**.
- `SelectField` **Vendedor**: os vendedores visíveis (escopo RN-CORE-04). Vem preenchido com o vendedor do filtro, se houver. Foco inicial aqui.
- **Período**: o mesmo `Segmented` (Dia | Semana | Mês) e a mesma navegação ‹ período › da tela, em 44 px. Vem com o período da tela.
- Rodapé: **Cancelar** (secundário) e **Criar por proximidade** (principal, `IconRoute`).
- Sem texto explicativo: o nome do botão diz o que acontece.

Ao clicar em Criar por proximidade: o botão vira **"Criando…"** desabilitado (o diálogo continua aberto até a prévia chegar); com a prévia pronta o diálogo fecha
e o quadro da direita mostra a prévia.

### 3.1 Estados do diálogo
| Estado | O que aparece | Simulação |
|---|---|---|
| Carregando o vendedor (endereço, carteira, rotas do período) | `Criar por proximidade` desabilitado com "Carregando…"; os campos ficam usáveis | — |
| Vendedor sem endereço base | `Notice tone="warning"`: **"Sem endereço base."** com o link **Cadastrar** (abre o diálogo do lápis, seção 5). Criar por proximidade desabilitado. | `criar-sem-base.png` |
| Período com rota existente | `Notice tone="warning"` **"Já tem rota em 6 dias."** e duas opções (`radio` de 52 px): **Criar só nos dias sem rota** (marcada, sem linha de apoio) e **Substituir N rotas**, com N = quantas rotas de fato serão trocadas (tira as protegidas da D4). A linha de apoio só aparece quando N é menor que o total, ex.: **Substituir 4 rotas** · "2 com visita feita ou do ERP ficam."; com N igual ao total, sem linha de apoio. Ver dúvida D4. No modo Dia, o texto vira "Este dia já tem rota." e as opções "Manter a rota" / "Substituir a rota". | `criar-conflito.png` |
| Carteira vazia | `Notice tone="warning"` **"Sem clientes na carteira."** com o link **Abrir Carteira**. Botão desabilitado. | — |
| Período todo no passado | `Notice tone="warning"` **"Esse período já passou."** Botão desabilitado (rota de dia passado só pelo editor do dia, como hoje). | — |
| Erro da API | `Notice tone="danger"` com a mensagem de `errorMessage` e o botão volta a ficar ativo. | — |

## 4. Prévia da rota gerada (`simulacoes/previa.png`)

A prévia **não grava nada**. Ela ocupa o quadro da direita (onde hoje abre o editor) e o mapa desenha as rotas da prévia, cor por dia da semana (`WEEKDAY_COLORS`).
**Legenda do mapa na prévia: só os dias e a Base** (sem Visitada, Em atendimento e Pendente: a prévia não tem visita). Os dias que dividem cor (MC-0014 A: 4 cores
de série, a 5ª e a 6ª repetem — Seg e Sex em Azul noite #1E3350, Ter e Sáb em Sol laranja #C2540A) se distinguem pelo **traço**: o 1º dia da cor em linha
contínua, o 2º (Sex, Sáb) **tracejado** (`dashArray "10 7"` no Leaflet), na linha do mapa, na legenda e na barra da lista de dias; o rótulo do dia na legenda e na lista confirma.
Exemplo das simulações: tenant com semana útil **seg–sex** (`metas.dias_uteis_semana`); novembro de 2026 = 21 dias úteis − 02/11 (Finados) − 20/11
(Consciência Negra) = **19 rotas** × 11 visitas (`visitas_dia`) = 209 visitas. Com o padrão seg–sáb seriam 23 rotas.
O filtro da tela passa para o vendedor e o período da prévia; os KPIs **somem** durante a prévia (os números da prévia ficam no cabeçalho do quadro: uma informação, um lugar)
e o botão **Criar rota** do cabeçalho some (o principal da tela passa a ser **Salvar rotas**).

Ordem no quadro:
1. Título **Prévia** (20 px) e a linha **"19 rotas · 209 visitas · 988 km"**. Vendedor e período não se repetem (estão na `FilterBar`). Sem X no cabeçalho: sair é pelo **Descartar** do rodapé.
2. **Endereço base** — no lugar do "CD Saída": cartão com o ícone da casa (o mesmo marcador do mapa), o rótulo em negrito (**Casa** ou **Outro endereço**) e o endereço
   em uma linha (`Rua das Palmeiras, 100 · Centro`, corta com reticências; o endereço inteiro no `title`). À direita o **lápis** (40 px, `aria-label="Trocar o endereço base"`).
3. **Alertas** (`Panel` só quando há alerta; nenhum aviso fora dele):
   - **"3 clientes sem localização ficaram fora."** · link **Ver clientes** (abre a lista dos clientes, com o atalho para Coordenadas sugeridas).
   - **"8 clientes não couberam no limite do dia."** · link **Ver clientes** (só se a dúvida D2 decidir por limite).
4. **Lista dos dias** (rolagem própria): uma linha por dia do período, 46 px, barra na cor do dia, **"Ter 03/11"** e **"11 visitas · 54 km"**, chevron. Clicar abre o
   editor do dia sobre a prévia (reordenar, tirar, incluir, refazer horários; o "Salvar" do editor vira **"Aplicar"** e volta à prévia). Dia sem rota por feriado:
   linha cinza, **"Feriado"**, sem chevron. Dia mantido (opção "Criar só nos dias sem rota"): **"Mantida · 9 visitas"** em cinza, sem chevron.
5. Rodapé fixo: **Salvar rotas** (principal) e **Descartar**. Salvar grava todas as rotas da prévia de uma vez (idempotente, UUID do lado do cliente).
   Descartar pede confirmação quando há alteração na prévia (como o editor faz hoje).

Estados da prévia:
| Estado | O que aparece |
|---|---|
| Carregando | `LoadingBlock` "Montando a rota…" no quadro; o mapa fica com o marcador da base |
| Nenhum cliente com localização | Sem lista; no lugar, o vazio **"Nenhum cliente da carteira tem localização."** com o link **Abrir Coordenadas sugeridas**. Salvar desabilitado. |
| Parte da carteira sem localização | Alerta do item 3 |
| Endereço base trocado no lápis | A prévia refaz na hora com a nova base (mantém os dias, refaz a ordem e o km) |
| Erro ao salvar | `Notice tone="danger"` no topo do quadro; a prévia continua aberta |

## 5. Lápis do endereço base (`simulacoes/lapis.png`)

`Dialog` do kit, 560 px, título **Endereço base**.
- Duas opções (`radio`, 52 px):
  - **Casa** — o endereço do cadastro do vendedor (Usuários), em uma linha. Só leitura aqui; se o vendedor não tem casa cadastrada, a opção fica desabilitada com "Sem endereço no cadastro".
  - **Outro endereço** — abre os campos.
- Campos (só com "Outro endereço"): **CEP** · **Logradouro** · **Número** / **Bairro** · **Cidade** · **UF** (44 px, mesmas regras de formato do endereço do cliente: CEP 8 dígitos, UF 2 letras).
- **Ponto no mapa**: mapa pequeno (150 px) com um marcador arrastável (`Marker draggable` com `divIcon` próprio: pino grafite #16202A, `var(--color-ink)`,
  borda branca de 2,5 px e furo branco; nunca o ícone padrão do Leaflet); abaixo, **"Arraste o marcador até a porta."**. O mapa abre no centro dos clientes da carteira
  que têm localização (sem geocodificação; ver seção 8). Clicar no mapa também move o marcador. Sem ponto marcado, **Salvar** fica desabilitado.
- Rodapé: **Cancelar** e **Salvar** (principal).
- Salvar grava a base **no vendedor** (vale para as próximas rotas criadas por proximidade e para o marcador e o km da tela Rotas), audita (RN-AUD-01) e,
  se veio da prévia, refaz a prévia (rotas já salvas: ver D7).

O mesmo bloco "Endereço" (campos + ponto no mapa) entra no `Drawer` **Editar usuário** (Usuários), seção **Endereço**, para os perfis vendedor e promotor:
é o endereço da casa. Componente único, usado nos dois lugares (`modules/core/web`).

## 6. Componentes

| Peça | Componente | Observação |
|---|---|---|
| Cabeçalho, filtros, KPIs, quadros | `PageHeader`, `FilterBar`, `SelectField`, `KpiGrid`/`KpiCard`, `Panel` (`@macuxi/ui/web`) | sem mudança |
| Diálogos | `Dialog` (`packages/ui/src/web/overlay.tsx`) | foco no 1º campo, Esc fecha |
| Avisos | `Notice` (`warning`, `danger`) | dentro do diálogo; na prévia, só a área Alertas |
| Botões | `Button` primary/secondary, `size="sm"` nas linhas | um principal por tela |
| Ícones novos | `IconCasa` e `IconLapis` em `packages/ui/src/web/icons.tsx` (traço 2, 24×24, como os outros) | designer-ux na R1; a casa (com porta) é um desenho só no cartão da base, na legenda e no marcador do mapa |
| Marcador da base no mapa | `.fv-start` de `apps/web/app/globals.css` com o desenho da casa no lugar de "CD" | pedido ao engenheiro-apps (globals.css é do shell) |
| Mapa com marcador arrastável | `react-leaflet` (já no `modules/core/package.json`), `Marker draggable` com `divIcon` próprio | pino grafite #16202A (`var(--color-ink)`), borda branca 2,5 px e furo branco; nunca o ícone padrão do Leaflet; sem dependência nova |
| Opções exclusivas | `radio` com cartão de 52 px | se não houver no kit, entra como `OpcaoCartao` em `packages/ui` na R2 |

Alvos de toque ≥ 44 px no diálogo; o lápis tem 40 px como os botões de ícone do editor de hoje (BKO, mouse). Contraste: textos em #16202A e #4A5562 sobre branco
(≥ 7:1); aviso #7A4F00 sobre #FFF1D6 (≥ 6:1); botão principal branco sobre #1E3350.

## 7. Dúvidas de regra para o Alexandre

| # | Dúvida | Recomendação | Impacto |
|---|---|---|---|
| D1 | **Frequência de visita**: de onde vem? | Usar a que **já existe** na Carteira (`frequencia_semanas` 1, 2 ou 4 e `dia_semana`, editada no BKO). Cliente com dia da semana fica nesse dia; cliente **sem frequência** entra como **semanal**, no dia que a proximidade escolher. | Sem regra nova de cadastro. Um mês com 60 clientes semanais = ~240 visitas. Se preferir "sem frequência = 1 vez no período", o mês fica com poucas visitas por dia. |
| D2 | **Limite de visitas por dia** | Limite = a meta de produtividade `visitas_dia` do vendedor (padrão 11, já cadastrada por tenant, equipe ou usuário). O que não couber aparece no alerta "não couberam no limite do dia". | Sem parâmetro novo. Alternativa: parâmetro próprio da rota (Parâmetros) — mais um cadastro. Sem limite, a proximidade pode encher um dia com 30 clientes. |
| D3 | **Dias sem rota** | Usar o calendário que já existe: semana útil do tenant (`metas.dias_uteis_semana`) + feriados nacionais + feriados do tenant (Parâmetros → Calendário). Domingo nunca. | A tela Rotas hoje só tira sábado e domingo e mostra feriado como dia útil; passa a usar o mesmo calendário (corrige também a lista de dias). |
| D4 | **Rota existente no período**: sobrescreve? | Padrão **"Criar só nos dias sem rota"**, com a opção **"Substituir"** no diálogo. Dia com visita feita ou em atendimento nunca muda; rota que veio do ERP (`origem = erp`) também não é substituída. | O mesmo princípio do `rotas/gerar` (nunca sobrescreve) e do consumidor do ERP. Se não quiser a opção Substituir, o diálogo fica mais curto e a troca é dia a dia pelo editor. |
| D5 | **Origem do endereço base** | R1: **só BKO** (casa no cadastro do usuário + outro endereço pelo lápis). R4 opcional: a casa também pelo ERP (colunas novas no `vendedor.csv`), com o BKO vencendo quando alguém marcou outro endereço base. | O vendedor.csv e o contrato `VendedorPayload` não têm endereço hoje; a R4 mexe no contrato (aditivo), no Hub e no kit do Conector. |
| D6 | **Cliente sem latitude/longitude** | Fica **fora** da prévia, no alerta "N clientes sem localização ficaram fora" com **Ver clientes**; o 1º check-in sugere a coordenada (RN-CORE-10) e a próxima criação já o inclui. | Alternativa: incluir no fim do dia sem ordem (como o editor faz hoje) — enche o dia de visitas sem km. Com a recomendação, a cobertura da carteira pode ficar menor até as coordenadas chegarem. |
| D7 | **Trocar a base muda as rotas já salvas?** | Não: muda o marcador e o km mostrados; a ordem das rotas salvas fica. Só a próxima criação usa a base nova. | Evita refazer rota que o vendedor já recebeu no app. |
| D8 | **"Casa" no lugar do CD também para quem não usa o Criar rota?** | Sim: vendedor com base mostra a base no mapa e conta o km dela em todas as rotas; sem base, nada de ponto fixo de Manaus. | O km das rotas atuais muda de número (hoje conta de um ponto fixo errado para quem não está em Manaus). |

## 8. Localização do endereço base

O que achei antes de comparar: **não há geocodificação no sistema**; a coordenada do cliente vem do ERP (opcional no `cliente.csv`) ou do 1º check-in aprovado no BKO;
filial e usuário não têm coordenada (seção 0).

| | (a) Geocodificação por API externa | (b) Ponto marcado no mapa pelo usuário no BKO |
|---|---|---|
| Como funciona | Digita o endereço; o servidor pergunta a um serviço (Google Geocoding, Mapbox, HERE, OpenCage) e grava lat/long | Digita o endereço (para mostrar) e arrasta o marcador no mapa até a porta; grava o ponto marcado |
| Chave e segredo | Exige conta e chave que **só o Alexandre cria**, guardada como secret do servidor; o engenheiro-software liga o serviço | Nenhuma |
| Custo | Por consulta. Ordem de grandeza: Google ~US$ 5 por 1.000 depois da cota gratuita mensal; Mapbox e HERE têm faixa gratuita e depois cobram por mil. Para o endereço base (poucas consultas por vendedor) cabe na cota gratuita; vira custo se for usado também nos clientes. Conferir o preço vigente antes de contratar. O Nominatim público (OpenStreetMap) não serve para produção (limite de 1 por segundo e proíbe uso em volume). | Zero |
| Precisão | Boa em capital; em bairro novo, zona rural e "S/N" erra ou cai no centro da rua ou do CEP — precisa conferir no mapa do mesmo jeito | A que a pessoa marcar; erro só se marcar mal |
| Esforço | Integração com serviço externo, tratamento de falha, limite, auditoria do envio de endereço (dado pessoal do vendedor saindo para terceiro: LGPD, precisa de base legal e registro) | Só tela: Leaflet já está no BKO |
| Dependência | Rede e serviço externo no fluxo de cadastro | Só os tiles do OSM (já usados) |
| Uso futuro | Serve para geocodificar clientes sem coordenada em lote | Não ajuda os clientes |

**Recomendação:** **(b) na R1** — custo zero, sem segredo, sem dado pessoal saindo para terceiro, e a pessoa confere o ponto de qualquer jeito. O mapa abre no
centro dos clientes da carteira com localização, então marcar leva poucos segundos. **(a) fica como opção futura**, só se o Alexandre quiser geocodificar
os **clientes** sem coordenada (aí o volume justifica a chave e o custo), e com o marcador continuando arrastável para corrigir.

## 9. Estimativa por entrega (horas reais, + 15 % de folga)

- **R1 — Endereço do vendedor e base no mapa**: migração aditiva em `core.usuario` (endereço da casa + base: tipo, endereço, lat/long); contrato e API do endereço
  e da base; seção Endereço no Editar usuário; lápis e diálogo; marcador da base no lugar do CD; fim do ponto fixo; km a partir da base; vazio único na lista.
- **R2 — Criar rota por proximidade**: domínio puro (distribuir a carteira pelos dias do período por frequência, dia da semana e proximidade à base, limite do dia,
  calendário; ordenar cada dia com `optimizeRoute` a partir da base), API de prévia (não grava) e de gravação em lote idempotente, diálogo, prévia e salvar.
- **R3 — Estados e acabamento**: conflito com rota existente (manter/substituir, ERP e visita feita protegidos), carteira sem coordenadas e o atalho para
  Coordenadas sugeridas, feriados na lista de dias da tela, editor do dia sobre a prévia ("Aplicar"), roteiro do testes e build.
- **R4 (opcional) — Endereço da casa pelo ERP**: colunas novas no `vendedor.csv` e no `VendedorPayload` (aditivo, v1), Hub, kit do Conector, consumidor do Core.

| Dono | R1 | R2 | R3 | R4 (opc.) |
|---|---|---|---|---|
| banco-dados | 4,0 → **4,6** | 1,0 → **1,2** | 0,5 → **0,6** | 2,0 → **2,3** |
| modulo-core | 14,0 → **16,1** | 20,0 → **23,0** | 8,0 → **9,2** | 3,0 → **3,5** |
| modulo-integracao | 0 | 0 | 0 | 8,0 → **9,2** |
| designer-ux | 3,0 → **3,5** | 2,5 → **2,9** | 1,5 → **1,7** | 0,5 → **0,6** |
| engenheiro-apps | 1,5 → **1,7** | 1,5 → **1,7** | 1,0 → **1,2** | 0 |
| testes | 4,0 → **4,6** | 5,0 → **5,8** | 4,0 → **4,6** | 3,0 → **3,5** |
| corretor-redundancias | 1,5 → **1,7** | 1,5 → **1,7** | 1,0 → **1,2** | 1,0 → **1,2** |
| design-de-marca | 1,0 → **1,2** | 0,5 → **0,6** | 0,5 → **0,6** | 0 |
| **Total** | 29,5 → **33,4** | 32,0 → **36,9** | 16,5 → **19,1** | 17,5 → **20,3** |

R1 a R3: **89,4 h** com folga; com a R4: **109,7 h**. Não inclui geocodificação (seção 8, opção a): se for escolhida, somar ~6 h do engenheiro-software
(serviço, secret, limite) e ~3 h do modulo-core, mais o custo por consulta.
Premissas: o engenheiro-apps só revisa e liga o marcador em `apps/web/app/globals.css`; o design-de-marca valida o marcador novo (casa) e as telas; sem dependência nova.

## 10. Simulações

`simulacoes/` (HTML + PNG 2×, 1366×768, tokens de `apps/web/app/globals.css` e do kit `packages/ui/src/web`; gerador `simulacoes/gerar.mjs`):
`rotas` (tela com o botão), `criar` (diálogo), `criar-conflito` (rota existente no período), `criar-sem-base` (vendedor sem endereço base),
`previa` (rota gerada com a base no lugar do "CD Saída" e o lápis), `lapis` (diálogo do endereço base).

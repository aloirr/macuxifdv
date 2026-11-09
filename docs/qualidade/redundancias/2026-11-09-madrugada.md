# Redundâncias — madrugada de 09/11/2026: reteste do Início e do lote, T-0140, Novo pedido v2 e necessidade diária

**Auditor:** corretor-redundancias · **Pedido:** gerente-projetos, rodada da madrugada (R-20261108-220117)
**Achados novos:** RD-0032 a RD-0041 (10) · **Retestes:** RD-0002 a RD-0031
**Escopo:** só excessos, duplicidades e redundâncias. Os defeitos funcionais foram ao testes (§7) e não viraram RD.

## 1. Como foi conferido
- **Código lido na árvore atual** (09/11, entre 1h e 2h30), com os donos pela `node scripts/coord.mjs dono`.
- **jscpd 5.4.2** (`node_modules/.bin/jscpd --config .jscpd.json`, mínimo de 50 tokens). A saída ficou fora do repositório, no
  scratchpad da sessão. Pastas: `modules/vendedor/{app,domain}`, `apps/mobile/src`, `apps/web/{lib,components}`,
  `modules/core/{app,contracts,domain,web}`, `packages/{platform-sdk,comum,ui}/src`, `modules/gestor` e `modules/catalogo/{domain,api}`.
  Resultado: 113 clones em 1.003 arquivos (0,89% das linhas). Os pares que tocam esta rodada estão citados em cada achado.
- **Textos repetidos:** um script de leitura (também no scratchpad) listou os literais com espaço ou acento que aparecem 2 vezes
  ou mais em `modules/vendedor/{app,domain}`, fora dos testes.
- **Leitura manual** do que o jscpd não pega: a mesma regra escrita com outro texto, as listas fixas e as decisões tomadas pelo texto.

## 2. Reteste do Início (RD-0002 a RD-0013)
Arquivos: `apps/mobile/src/lib/inicio.ts`, `apps/mobile/src/components/inicio.tsx`, `apps/mobile/src/app/(tabs)/index.tsx`,
`modules/core/contracts/inicio.ts`, `modules/core/domain/meta-do-dia.ts`, `modules/vendedor/app/{components/cards-inicio.tsx,lib/resumo-inicio.ts}`,
`packages/ui/src/mobile/sincronizacao.tsx` e `db/seeds/demo/demo.ts`. O print do APK antes e depois sai do build v1.0.1 (4h30),
e a evidência abaixo é o código e os testes de tela do dono (`inicio-tela.test.tsx`, que renderiza o domingo e o dia útil).

| RD | Resultado | Evidência |
|---|---|---|
| RD-0002 | **corrigido** | O cartão tem 3 representações (`0,3%` no topo, `R$ 553 de R$ 180.000`, barra), como na proposta. A última linha é `Meta de hoje R$ X` no dia útil e `Faltam R$ X · R$ Y por dia útil (N dias)` no dia não útil, com os números prontos do Core (`meta_hoje.faltam_mes`, `por_dia_util`, `dias_uteis_por_dia` em `modules/core/contracts/inicio.ts:183-188`). O shell não faz conta (`apps/mobile/src/lib/inicio.ts:216-255`) |
| RD-0003 | **corrigido** | `Recados` (`components/inicio.tsx:73`). O seed diz `Prioridade` (`db/seeds/demo/demo.ts:983`, banco-dados). Fica no máximo 1 "hoje" por cartão: `6 visitas hoje` nas boas-vindas e `Meta de hoje` no cartão Meta |
| RD-0004 | **corrigido** | "mês" só no título (`lib/inicio.ts:258-261`). O estado sem meta repete a palavra e virou o RD-0040 |
| RD-0005 | **corrigido** | `xDeY` (`lib/inicio.ts:162-166`): `1 de 15 clientes` · `0 de 90` · `0% de 90%` |
| RD-0006 | **corrigido** | `Sem rota hoje · não é dia útil` só nas boas-vindas (`lib/inicio.ts:32-36`). O cartão Meta não repete o fato (`:237-239`) |
| RD-0007 | **corrigido** (formato) | `Cobertura 0% de 90%`. A fusão de Visitas com Cobertura continua `manter?` com o gerente: as duas ficam, e não há proposta nova |
| RD-0008 | **corrigido** | Há um aviso só, na prop `avisoDados` do `BotaoSincronizar` (`(tabs)/index.tsx:88`; kit `packages/ui/src/mobile/sincronizacao.tsx:49-67`). O texto é `avisoDosDados` (`lib/inicio.ts:286-294`), e o "N na fila" continua. Grep sem `Vendas até` nem `inicio.aviso-dados` no código |
| RD-0009 | **corrigido** | Texto em 2 linhas, ponto só com mais de 1 item, `Ver todos` só com `total > itens` e o topo abrindo a central (`components/inicio.tsx:66-111`; `lib/inicio.ts:122-129`) |
| RD-0010 | **corrigido** | Orçamentos `nenhum` (`modules/vendedor/app/lib/resumo-inicio.ts:55-57`). As linhas Positivação, Visitas e Cobertura ficam sem barra (`components/inicio.tsx:155-165`) |
| RD-0011 | **corrigido** | Um cartão com 2 linhas de 56 dp (`modules/vendedor/app/components/cards-inicio.tsx:37-40`). O `plural` com o mesmo texto 2 vezes saiu (`resumo-inicio.ts:60-64`) |
| RD-0012 | **corrigido** | Grep sem `saudacao(`, `quandoCurto` e `horaRelogio` em `apps/mobile/src`. `saudacao`, `recados_hoje`, `meta_hoje` e `sem_realizado` são obrigatórios no contrato (`contracts/inicio.ts:149-194`) |
| RD-0013 | **reaberto** (só o resto) | `sincronizacao` saiu. Ficaram sem leitor fora dos testes `recado` (`contracts/inicio.ts:103-111`) e `notificacoes` (`:115-131`). `notificacoes.nao_lidas` é o mesmo número de `recados_hoje.novos` (`modules/core/domain/inicio.ts:126` × `modules/core/app/lib/inicio-local.ts:172`), e `notificacoes.ultimas` é a mesma caixa de `recados_hoje.itens`. O engenheiro-apps já avisou que o shell não lê os dois |

## 3. Reteste do lote (RD-0014 a RD-0031)

| RD | Resultado | Evidência |
|---|---|---|
| RD-0014 | **reaberto** | O SDK e o Core estão certos: fonte única em `packages/comum/src/perfis.ts`, o `ROTULO_PERFIL` do SDK reexporta e o `ROTULO_BASE` usa o mapa. O Core usa `rotuloDoPerfil` e o `ROLE_LABEL` saiu. **Faltam três mapas.** (1) O kit ainda tem a cópia `packages/ui/src/comum/perfis.ts:18-41`, igual a `packages/comum/src/perfis.ts:12-35` (jscpd, 24 linhas): falta a reexportação que o designer-ux combinou (R-20261109-002123). (2) `modules/treinamento/web/lib/csv.ts:26-34` tem o próprio `ROTULO_PERFIL`, com **`admin: 'Administrador'`**, o texto que o RD tirou. (3) `modules/pesquisa/web/pages/construtor-page.tsx:24` tem o próprio `ROTULO_PERFIL` (4 perfis) |
| RD-0015 | **corrigido** | A tela usa `travaDaChave(base, 'acesso.bko')` (`modules/core/web/components/perfis/perfis-page.tsx:260`), e a lista literal saiu. O `PERFIS_DO_APP` ficou, com teste de paridade com a fábrica do motor (`packages/platform-sdk/src/acesso-sessao.test.ts:39-43`). É redundância útil travada por teste: `manter` |
| RD-0016 | **reaberto** | O SDK publicou `acesso-sessao.ts`, mas os shells ainda não trocaram. Hoje são **3 cópias**: `apps/mobile/src/lib/acesso.ts:9-37` ≡ `apps/web/lib/acesso.ts:9-37` (jscpd, 29 linhas) ≡ `packages/platform-sdk/src/acesso-sessao.ts:11-30` (20 linhas). O `NOME_DO_LUGAR` continua em `apps/mobile/src/lib/acesso.ts:39`. O engenheiro-apps marcou a troca para a próxima rodada (R-20261109-005726), porque o texto da lista da demonstração muda ("o Macuxi Campo" → "o app Macuxi Campo") e precisa do designer-ux |
| RD-0017 | **reaberto** (só o resto) | As constantes estão nos contratos (`modules/core/contracts/perfis.ts:20-21`), e a tela decide pelo `CODIGO_REPETIDO` (`perfis-page.tsx:256-258`). **Falta** "Escolha pelo menos um perfil.", ainda em 3 lugares: `modules/core/api/usuarios.ts:285`, `modules/core/web/lib/usuarios.ts:35` e `packages/ui/src/web/perfis.ts:156` (`ERRO_SEM_PERFIL`) |
| RD-0018 | **corrigido** | `NIVEIS_ESCOPO` do SDK (`modules/core/web/lib/perfis.ts:15,181`), `mesmosAlvos` do domain (`:16,245`) e `NOME_PERFIL_MAX` (`modules/core/domain/perfis.ts:23`). O caminho morto saiu |
| RD-0019 | **reaberto** (só o resto) | Os textos e as funções puras foram para `modules/core/contracts/ciclo-senha.ts`, e o BKO importa de lá. **Falta** o mapa erro → ação da troca, ainda em 2 versões: `modules/core/app/lib/senha.ts:43-65` (`erroDaTroca`: `ficar`, `voltar_ao_login`) × `apps/web/lib/ciclo-senha.ts:50-62` (`resultadoDoErroDaTroca`: `fica`, `login`). Os nomes das ações e o texto de reserva do 422 RN-CORE-32 já são diferentes. O contrato só tem o tipo `AcaoAposErroDaTroca` (`contracts/ciclo-senha.ts:52`). O engenheiro-apps já pediu a função ao Core (R-20261108-212515) |
| RD-0020 | **reaberto** (só o resto) | Das 7 regex de e-mail sobraram 2: `EMAIL_FORMATO` (`modules/core/contracts/ciclo-senha.ts:11`) e `EMAIL_RE`/`ehEmail` (`packages/comum/src/email.ts:5-9`, já com o limite de 254). `modules/core/domain/usuarios.ts:52` e `equipe-importacao.ts:219` repetem `|| email.length > 254` por fora. A validação do login e o `CODIGO_RE` do BKO saíram (`apps/web/lib/login.ts`) |
| RD-0021 | **reaberto** (2ª etapa) | A 1ª etapa está pronta: a página Perfis usa `REGRA_DA_SENHA`, e os 5 chamadores passam `minimo` (core: `usuarios-page.tsx:459,559` e `tela-crie-sua-senha.tsx`; shell: `apps/web/components/ciclo-senha.tsx:157` e `portal/passo-empresa.tsx:399`). **Falta** o kit tornar `minimo`/`resumo` obrigatórios e apagar `resumoDaSenha` e `MINIMO_DA_SENHA_SEM_TELA` (`packages/ui/src/comum/senha.ts:25,89`). Nenhum chamador depende mais deles |
| RD-0022 | **corrigido** | Um arquivo de estilos (`modules/core/app/components/estilos-de-acesso.ts`), usado pelas três telas. O link "Voltar ao login" continua escrito em 2 telas, mas com o estilo comum, e isso fica abaixo do limiar |
| RD-0023 | **corrigido** | `chaveDoNomeMarca` (`modules/catalogo/domain/marcas-cadastro.ts:22`) e `filtrarMarcas` no domain (`api/rotas.ts:79,478`). O `semAcentoMarca` saiu. O padrão "sem acento" que se repete no resto do Catálogo virou o RD-0041 |
| RD-0024 | **reaberto** | `domain/marcas.ts:1-5` e a mensagem estão certos. Ainda dizem "cadastro de concorrentes do Promotor": `modules/catalogo/api/rotas.ts:422-423` (com "sem a licença do Promotor"), `contracts/eventos.ts:45`, `contracts/sync-conteudo.ts:69-70`, `api/repositorio.ts:93` e `domain/marcas.test.ts:1` |
| RD-0025 | **aberto** (sem entrega) | `validarConcorrente` (`modules/promotor/contracts/cadastros-bko.ts:14,59`), `ConcorrenteEdicao` (`:59-60`) e o `case 'concorrente'` (`modules/promotor/web/lib/cadastros.ts:126,177`) continuam |
| RD-0026 | **corrigido** | Frase única (`modules/integracao/domain/monitor.ts:140`). O painel Alertas mostra uma linha curta e manda para Pedidos no ERP (`web/components/alertas-panel.tsx:22`) |
| RD-0027 | **corrigido** | `aceiteDoTenant` (`modules/integracao/api/aceite-cancelamento.ts:9`), usado por `consulta-cancelamento.ts:9` e `consumidores-pedido.ts:146` |
| RD-0028 | **corrigido** | Os apelidos ficam só no `ALIAS_STATUS`, e as listas comparam `OrderStatus` (`modules/vendedor/domain/order.ts:269-279`) |
| RD-0029 | **corrigido** | "Antes do envio ao ERP. Depois, só se a integração aceitar devolver o cancelamento ao ERP." (`modules/core/web/lib/perfis.ts:60`) |
| RD-0030 | **corrigido** | O índice chama `soCasaExato`, `toleranciaDaPalavra`, `casaComCodigo`, `casaComFiltros` e `entraNaVitrine` (`modules/catalogo/domain/indice-busca.ts:11-13,112-113,189,208,219-221`) |
| RD-0031 | **corrigido** | `docDeBusca(p, null)` (`modules/catalogo/domain/busca-consulta.ts:35`). O jscpd não acha mais o par |

## 4. T-0140 — revisão de redundância dos 4 pontos pedidos

### RD-0032 — a regra do link interno `/m/<caminho>` está no shell e no Core, e o Início a aplica 3 vezes
| Campo | Conteúdo |
|---|---|
| Onde | `apps/mobile/src/lib/inicio.ts:50-53` (`caminhoDoLink`) e `:60-64` (`destinoDaNotificacao`) × `modules/core/app/lib/notificacoes.ts:52-56` (`linkNavegavel`). Caminho do Início: `modules/core/app/lib/inicio-local.ts:181` (Core filtra) → `apps/mobile/src/lib/inicio.ts:116` (shell filtra de novo) → `apps/mobile/src/app/(tabs)/index.tsx:71` (shell filtra pela 3ª vez, agora com `telaExiste`) |
| Tipo | código |
| O que se repete | O mesmo regex `/^\/m\/[a-z0-9-]+/` e o mesmo corte `link.slice(3).split(/[?#]/)[0]` em 2 arquivos de donos diferentes. O relato da T-0140 nasceu exatamente disso: só uma das cópias olhava se a tela existia. A convenção `/m/<caminho>` é da plataforma (`packages/platform-sdk/src/shell.ts:29`) |
| Impacto | manutenção: a próxima regra do link (ex.: aceitar `/m/a/b`) precisa mudar em 2 lugares e pode divergir de novo |
| Severidade | média |
| Proposta | **Fonte única no SDK, como o engenheiro-software ofereceu (R-20261108-220002).** Escolhi o SDK, e não os contratos do Core (pedido do engenheiro-apps em R-20261108-212515), porque o formato `/m/<caminho>` é do shell: qualquer módulo que gravar link usa a mesma regra. **SDK** (`shell.ts`, com teste): `export function caminhoDoLinkInterno(link: string \| null \| undefined): string \| null` (o regex e o corte de hoje) e `export function linkInternoNavegavel(link, telaExiste?): string \| null` (o corpo atual do `linkNavegavel`). **Core:** `linkNavegavel` passa a ser `export { linkInternoNavegavel as linkNavegavel } from '@macuxi/platform-sdk'` ou sai, e os 3 usos importam do SDK. **Shell:** apaga `caminhoDoLink`. Fica `destinoDaNotificacao = (link, telaExiste) => linkInternoNavegavel(link, telaExiste) ?? '/m/notificacoes'`. Em `recadosDoInicio`, `destino: r.link ?? '/m/notificacoes'`, porque o Core já filtrou o formato. A decisão pela tela fica só no toque (`index.tsx:71`) |
| Dono | engenheiro-software (SDK) · modulo-core (`notificacoes.ts`) · engenheiro-apps (shell) |

### Tela de erro: o kit × o shell. Sem RD
O kit tem os textos (`packages/ui/src/mobile/tela-de-erro.ts`) e o desenho (`tela-de-erro-rn.tsx`). O shell só liga a tela ao
roteador (`ErrorBoundary`), à gravação e ao compartilhar (`apps/mobile/src/components/tela-de-erro.tsx`). Não existe outro
`ErrorBoundary` nem outra tela de erro no repositório (grep). A abertura "O que você registrou continua guardado neste aparelho."
igual à da tela de erro do armazenamento é consistência de propósito: `manter`.

### Registro de erro: `erros.ts` × `erro-de-tela.ts`. Sem RD
A divisão é a regra do shell: `lib/erro-de-tela.ts` é puro e testado em Node (montar, limpar e decidir se grava), e
`services/erros.ts` é a entrada e saída (AsyncStorage e `ErrorUtils`). Não há regra repetida entre os dois. Fica uma
observação **`manter?`, sem RD**, para o engenheiro-software decidir: a limpeza de dado pessoal do texto existe em 2 versões, com
regras e marcadores diferentes. Uma é `limparDadoPessoal` (`apps/mobile/src/lib/erro-de-tela.ts:65-73`, `[e-mail]`/`[número]`).
A outra é `mascararTexto` do Conector (`apps/conector/src/log/mascara.ts:23-38`, `[email]`/`[cpf]`/`[cnpj]`/`[telefone]` e segredos).
As duas aplicam a regra 8. Um `mascararDadoPessoal` em `packages/comum` serviria às duas, mas o Conector roda no cliente e hoje
não depende do `comum`.

### RD-0033 — duas travas para o mesmo fato: "a tarefa sem tela está sincronizando"
| Campo | Conteúdo |
|---|---|
| Onde | `apps/mobile/src/lib/trava-sync.ts:31-62` (`criarTravaSync`, T-0140) × `apps/mobile/src/lib/segundo-plano.ts:27-48` (`sync:lease`, ADR 0017). O app consulta as duas em sequência em `apps/mobile/src/state/plataforma.tsx:486-504`, e a tarefa também (`lib/segundo-plano.ts:148-175`) |
| Tipo | rotina · código |
| O que se repete | Ao sincronizar, o app pergunta primeiro à trava (`segundoPlanoAtivo` → espera → `m.carregar()`) e depois ao lease (`leaseOcupado` → espera a passada → `m.carregar()`). As duas respondem à mesma pergunta, com a mesma reação, no mesmo processo: o WorkManager acorda o JS no processo do app, e o app aberto depois usa o mesmo processo. Além delas, o motor do SDK tem o próprio `syncEmCurso` (`packages/platform-sdk/src/motor-sync.ts:608`, por instância), e o app tem o `syncEmCursoRef` (`plataforma.tsx:479`). Esses dois são justificados, porque cobrem coisas diferentes: o motor, a passada; o app, o lease e os módulos. A **trava e o lease** são o par redundante |
| Impacto | manutenção e risco. São 2 regras para o mesmo fato, a ordem das duas importa, e os tempos são diferentes (a trava é liberada no fim da passada; o lease vence em 2 min). O efeito do lease que sobra está no §7 (testes) |
| Severidade | média |
| Proposta | Uma porta só. Se não houver caso de 2 processos JS no Android (o engenheiro-apps confirma), a `TravaSync` passa a ser a única: saem o `CHAVE_LEASE`, o `leaseOcupado`, o `novoLease`, a leitura em `plataforma.tsx:494-504` e a gravação e remoção na tarefa. Se houver, o lease vira o "persistido" da trava: a `TravaSync` lê e grava o lease por dentro, e `plataforma.tsx` pergunta só a ela. **`manter?`** só se o engenheiro-apps mostrar o caso de 2 processos. Mesmo assim, a pergunta fica num lugar só |
| Dono | engenheiro-apps |

## 5. Novo pedido v2 (T-0131) e o detalhe — `modules/vendedor/{app,domain}`
O jscpd não acha clone de código relevante no Novo pedido. Achou só pares pequenos dentro do mesmo arquivo:
`components/novo-pedido.tsx:47-55` × `:88-96` (campo % × campo R$, mesma lógica de foco) e `components/order-sheets.tsx:27-35` × `:185-193`.
O que se repete é **regra de quais botões aparecem, escrita 3 vezes**, a **tradução de mensagem pelo texto** e alguns textos.

### RD-0036 — quais botões de salvar aparecem: a mesma regra em 3 funções, com os rótulos em 2 mapas
| Campo | Conteúdo |
|---|---|
| Onde | `modules/vendedor/domain/botoes-resumo.ts:66-112` (`botoesDoResumo`) · `modules/vendedor/domain/sair-do-pedido.ts:32-39,78-82` (`TEXTOS_DA_SAIDA`, `opcoesDaSaida`) · `modules/vendedor/domain/orcamento.ts:441-461` (`opcoesDoSalvar`, sobra da folha "Salvar pedido" do desenho antigo §3.2) · `modules/vendedor/app/screens/new-order-screen.tsx:547,557` (`rotuloEdicao`) |
| Tipo | código · texto |
| O que se repete | **(1) Regra RN-VEN-13/38 em 3 funções.** "Cliente só de orçamento → sem enviar", "orçamento visível com pré-venda ou só orçamento" e "Apenas salvar sempre" estão em `botoesDoResumo` e de novo em `opcoesDaSaida`. A parte "só orçamento" está também em `opcoesDoSalvar`. Hoje a tela usa da `opcoesDoSalvar` só o `motivo_so_orcamento` (`new-order-screen.tsx:485,784`), e `textos-pedido.ts:185` a chama com um cliente fictício só para pegar o subtítulo. **(2) Rótulos em 2 mapas.** "Salvar e enviar pedido" (5×), "Apenas salvar" (9×), "Salvar como orçamento" (4×) e "Salvar orçamento" (5×) estão escritos em `botoes-resumo.ts` e em `sair-do-pedido.ts`. **(3) O rótulo da edição é decidido na tela** (`rotuloEdicao`: "Salvar alterações no aparelho", "Salvar orçamento", "Salvar e enviar para aprovação", "Salvar alterações"), por cima do rótulo que o domain já devolve. **(4) O destino em 2 mapas com pontuação diferente.** `DESTINO_POR_NIVEL` dá "Vai para o supervisor" (`botoes-resumo.ts:14-23`), e `SUBTITULO_ENVIAR` dá "Vai para o supervisor." (`orcamento.ts:441-445`). **(5) "Válido até dd/mm" montado 4 vezes:** `dataCurta` (`botoes-resumo.ts:115`), o `split` em linha (`sair-do-pedido.ts:80-81`), `dataDaValidade` (`orcamento.ts:71,458`) e o `split` em linha (`app/lib/textos-pedido.ts:164`) |
| Impacto | manutenção e consistência. Se o Resumo e a folha "Sair do pedido?" mudarem em tempos diferentes, mostram botões ou nomes diferentes para a mesma situação. Isso já acontece com o destino ("supervisor" × "supervisor.") |
| Severidade | média |
| Proposta | **Uma fonte por coisa, no domain.** (a) `botoesDoResumo` é a regra, e `opcoesDaSaida` deriva dela: `const b = botoesDoResumo({ ...e, editando: null, pendencias: 0, nivel })`, e então `salvar: b.enviar.visivel`, `apenasSalvar: b.apenasSalvar.visivel` e `orcamento: b.orcamento.visivel`. (b) Uma constante `ROTULOS_DO_SALVAR = { enviar: 'Salvar e enviar pedido', apenasSalvar: 'Apenas salvar', orcamento: 'Salvar como orçamento', salvarOrcamento: 'Salvar orçamento', transformar: 'Transformar em pedido', alteracoes: 'Salvar alterações' }` em `botoes-resumo.ts`, usada por `TEXTOS_DA_SAIDA`, `opcoesDaSaidaEdicao` e a tela. (c) O rótulo da edição entra em `botoesDoResumo` (entradas `editandoNoServidor` e `vaiParaAprovacao`), e o `rotuloEdicao` sai da tela. (d) `opcoesDoSalvar` sai: a tela usa `motivoSoOrcamento`, e `folhaDoTransformar` usa `destinoDoEnvio(c.nivel)`. Com isso o `SUBTITULO_ENVIAR` some, e o destino fica "Vai para o supervisor" (sem ponto, guia de UX). (e) `textoValidoAte(aaaaMmDd)` em `domain/orcamento.ts` (sobre `dataDaValidade`), usado nos 4 lugares |
| Dono | modulo-vendedor |

### RD-0037 — o "Falta para salvar" traduz as pendências comparando o texto da mensagem
| Campo | Conteúdo |
|---|---|
| Onde | `modules/vendedor/domain/pendencias-preenchimento.ts:32-48` (`textoDaPendencia`, 11 `match`/`startsWith` sobre o texto), `:51-53` (`abaDoErroDeCalculo`, pelo prefixo `Pedido:`/`Desconto efetivo`) · `modules/vendedor/app/lib/novo-pedido.ts:388-392` (`situacaoDoFrete`, por `msg.startsWith('CNPJ')`) · as mensagens nascem em `domain/preco-pedido.ts`, `domain/pagamento.ts:123` e `app/lib/novo-pedido.ts` |
| Tipo | código · texto |
| O que se repete | Cada pendência está descrita duas vezes: como frase de ordem no cálculo ("Este cliente não aceita esta forma…") e como substantivo no bloco ("Forma de pagamento aceita pelo cliente"). A ligação entre as duas é o próprio texto. É o mesmo padrão do RD-0017 (a tela decidia comparando a mensagem) |
| Impacto | manutenção. Basta mudar uma vírgula na mensagem do cálculo para a pendência cair no texto de reserva, ou para a aba da correção mudar, sem nenhum teste de tipo acusar |
| Severidade | média |
| Proposta | As mensagens do cálculo e do pagamento passam a ter código: `{ codigo: 'sem_preco' \| 'medida_indisponivel' \| 'desconto_e_acrescimo' \| 'desconto_acima_total' \| 'desconto_acima_tabela' \| 'acima_alcada' \| 'forma_indisponivel' \| 'prazo_indisponivel' \| 'forma_nao_aceita' \| 'prazo_acima_medio', alvo: 'pedido' \| { item: string }, mensagem }`. O `pendenciasDePreenchimento` mapeia código → texto e aba por tabela (`PENDENCIA_POR_CODIGO`), sem regex. O `situacaoDoFrete` lê o código do `freteValido` (`MSG_RECUSA_FRETE` já é indexado por código) |
| Dono | modulo-vendedor |

### RD-0038 — recusa da API: a mesma frase montada 3 vezes e um selo calculado que ninguém lê
| Campo | Conteúdo |
|---|---|
| Onde | "Não foi aceito: …" em `modules/vendedor/app/lib/salvar-na-fila.ts:57`, `app/lib/order-status.ts:93-95` (`textoDaRecusaCurto`) e `app/lib/textos-pedido.ts:212-214` (`textoNaoFoiAceito`, exportada e **sem uso**) · `EstadoNaFila.chip` (`salvar-na-fila.ts:44,56,64`), que o detalhe calcula (`screens/order-detail-screen.tsx:149`) e não mostra: o selo vem de `statusBadgeDaLinha` (`:150,483`), e "Não aceito" fica escrito 2 vezes (`order-status.ts:99` e `salvar-na-fila.ts:56`) · `ROTULO_CORRIGIR_PEDIDO` (`salvar-na-fila.ts:10`, **sem uso**) × `CORRIGIR` (`app/lib/detalhe-pedido.ts:98`) |
| Tipo | código · texto |
| O que se repete | 3 montagens da mesma frase, 2 fontes do mesmo selo e 2 constantes do mesmo botão |
| Impacto | manutenção (a frase da lista e a faixa do detalhe podem divergir) e código morto |
| Severidade | baixa |
| Proposta | `textoNaoFoiAceito(motivo)` fica como a única montagem, em `textos-pedido.ts`, usada por `estadoNaFila` e `order-status.ts`. Sai o campo `chip` do `EstadoNaFila`, porque o selo é o `statusBadgeDaLinha`. `ROTULO_CORRIGIR_PEDIDO` sai, ou o `CORRIGIR` do detalhe passa a usá-lo, mas fica um só. **`manter?`**: a faixa "Não foi aceito: <motivo>. Corrija e salve de novo." aparece logo acima do botão "Corrigir pedido". É texto da spec (`docs/design/formulario-pendencias.md:226`) e o leitor de tela anuncia a faixa sozinha, por isso fica |
| Dono | modulo-vendedor |

### RD-0039 — miúdos do Vendedor: mensagem 5 vezes, botões do kit refeitos e a trava do promotor escrita 2 vezes
| Campo | Conteúdo |
|---|---|
| Onde | `modules/vendedor/app/state/use-vendedor.ts:438,460,510,576,642` ("Aplicativo ainda carregando. Aguarde um instante e tente de novo.") · `modules/vendedor/app/components/order-sheets.tsx:27-40` (`SheetButton`) e `:185-200` (`PdfOption`) × kit `Botao` (`packages/ui/src/mobile/base.tsx:23`) e `OpcaoFolha` (`packages/ui/src/mobile/folha.tsx:214`), que o próprio detalhe já usa (`order-detail-screen.tsx:659`) · `modules/vendedor/domain/aprovacao.ts:293-298` (`revalidarPedido` testa o promotor e depois chama `recusaDePerfil`, que testa o promotor de novo em `:601`) |
| Tipo | texto · layout · código |
| O que se repete | A mesma frase 5 vezes no mesmo arquivo. Dois componentes locais que refazem os do kit, com outra altura e outro estado de toque. A recusa RN-PRO-01 escrita 2 vezes, com a mesma mensagem |
| Impacto | manutenção. As folhas de cancelar, rejeitar e PDF ficam com aparência diferente das folhas do Novo pedido |
| Severidade | baixa |
| Proposta | `const MSG_APP_CARREGANDO = 'Aplicativo ainda carregando. Aguarde um instante e tente de novo.'` no topo de `use-vendedor.ts`. As folhas de `order-sheets.tsx` passam a usar `Botao` (nível `perigo`/`secundario`) e `OpcaoFolha` do kit, e `SheetButton` e `PdfOption` saem. Em `revalidarPedido`, o `if (e.perfil === 'promotor')` sai: `const recusa = recusaDePerfil(e.perfil, e.em_nome === true); if (recusa) return { ok: false, ...recusa }` |
| Dono | modulo-vendedor |

## 6. Necessidade diária — uma fonte só?
**No Gestor, sim.** `modules/gestor/domain/painel.ts:7,261` importa `necessidadeDiaria` de `@macuxi/core/contracts`, e não há
outra conta da necessidade no Gestor (grep por `necessidade` e `Math.ceil` em `modules/gestor/domain`). O shell também não
faz a conta, porque lê `por_dia_util` pronto.
**No Core, não.** A mesma fórmula ainda está escrita à mão 2 vezes, ao lado da função única (RD-0035). E o Gestor tem a sua
própria lista de feriados nacionais, que já diverge da lista comum (RD-0034).

### RD-0035 — RN-CORE-22 escrita 3 vezes no Core: a função dos contratos e 2 contas em linha
| Campo | Conteúdo |
|---|---|
| Onde | `modules/core/contracts/necessidade-diaria.ts:6-9` (`necessidadeDiaria`, a fonte) × `modules/core/domain/meta-do-dia.ts:64` (`metaDia = Math.ceil((e.meta_mes - e.realizado_ate_ontem) / dias)`) e `:123` (`porDia = … Math.ceil(faltamMes / m.dias_uteis_restantes)`). O comentário em `:113` diz "a mesma conta de `necessidadeDiaria` de Metas" |
| Tipo | código |
| O que se repete | ⌈(meta − realizado) ÷ dias úteis restantes⌉ escrito 3 vezes. A meta do dia (RN-CORE-26) é a mesma conta com o realizado até ontem |
| Impacto | manutenção. Se a regra de arredondamento ou de "nunca negativa" mudar na função, o Início e a meta do dia não acompanham |
| Severidade | média |
| Proposta | `meta-do-dia.ts:64` → `const metaDia = necessidadeDiaria(e.meta_mes, e.realizado_ate_ontem, dias)!` (o ramo de cima já garante `dias > 0` e meta não batida). `:123` → `const porDia = m.indicador === 'cobertura_pct' \|\| faltamMes === null \|\| faltamMes === 0 ? null : necessidadeDiaria(m.meta_mes, realizadoMes, m.dias_uteis_restantes)`. O teste de `meta-do-dia.test.ts` continua igual |
| Dono | modulo-core |

### RD-0034 — o Gestor tem cópia própria dos feriados nacionais e das datas civis, e a cópia já diverge da comum
| Campo | Conteúdo |
|---|---|
| Onde | `modules/gestor/domain/feriados.ts:15-46` (`FIXOS`, `pascoa`, `feriadosNacionais`, `ehFeriadoNacional`) ≡ `packages/comum/src/feriados.ts:31-48,95-158` (jscpd: `pascoa`, 15 linhas). `modules/gestor/domain/numeros.ts:24,31` (`ehDataCivil`, `somarDias`) × `packages/comum/src/feriados.ts:62,81`. Uso: `modules/gestor/domain/horario-comercial.ts:13` (prazo da aprovação em dias úteis, RN-GES-03) |
| Tipo | código |
| O que se repete | A Páscoa, os feriados fixos e as datas civis escritos de novo. O próprio arquivo diz: "PROVISÓRIO … até o suporte a feriados nacionais ir para `packages/comum` … depois o Gestor passa a importar de lá e este arquivo some". O `comum` já tem esse suporte. **As listas já divergem:** a do `comum` traz Carnaval (segunda e terça) e Corpus Christi, e conta o 20/11 só desde 2024; a do Gestor não traz os móveis além da Sexta-feira Santa e conta o 20/11 em todo ano |
| Impacto | manutenção e consistência: o prazo de aprovação do Gestor e as metas do Core contam dias úteis com feriados diferentes |
| Severidade | média |
| Proposta | Apagar `modules/gestor/domain/feriados.ts` e o teste. `horario-comercial.ts` passa a usar `import { feriadosNacionais } from '@macuxi/comum'`, e `numeros.ts` reexporta `ehDataCivil` e `somarDias` do `comum`, ou os usos importam direto. Se o Gestor **não** deve contar Carnaval e Corpus Christi no prazo, isso é regra de produto (RN-GES-03 × RN-CORE-26): a decisão foi ao testes e ao gerente (§7), e o `comum` ganharia um parâmetro (`{ facultativos: false }`), em vez de a cópia continuar |
| Dono | modulo-gestor |

## 7. Outros achados de texto e código

### RD-0040 — "Nenhuma meta cadastrada para este mês." embaixo de "META DO MÊS"
| Campo | Conteúdo |
|---|---|
| Onde | `apps/mobile/src/components/inicio.tsx:126-128` · spec `docs/design/inicio.md:98,171` |
| Tipo | texto |
| O que se repete | "meta" e "mês" 2 vezes no mesmo cartão, com o título logo acima |
| Impacto | leitura |
| Severidade | baixa |
| Proposta | `META DO MÊS` / `Nenhuma meta cadastrada.` (na Gestão, `META DO MÊS DA EQUIPE` / `Nenhuma meta cadastrada.`). O designer-ux troca na spec, e o engenheiro-apps no componente e no `inicio-tela.test.tsx:377` |
| Dono | designer-ux (spec) · engenheiro-apps (shell) |

### RD-0041 — "sem acento e minúsculas" reimplementado 5 vezes no Catálogo, com 2 regex diferentes
| Campo | Conteúdo |
|---|---|
| Onde | `modules/catalogo/domain/texto.ts:61-63` (`semAcento`, privada) · `domain/marcas-cadastro.ts:22` (`chaveDoNomeMarca`, `\p{M}`) · `domain/ranking.ts:492` (`nomeChave`) · `domain/pergunte.ts:136` (`semAcentoMin`) · `app/lib/lista-por-linha.ts:99` (`\p{M}`) |
| Tipo | código |
| O que se repete | `normalize('NFD').replace(<marcas>, '').toLowerCase()` escrito 5 vezes. Três usam a faixa `[̀-ͯ]` e duas usam `\p{M}`, que pega mais marcas |
| Impacto | manutenção: a busca, a pergunta e a marca podem casar textos de formas diferentes |
| Severidade | baixa |
| Proposta | `domain/texto.ts` exporta `semAcento(s)` (com `\p{M}`) e `chaveSemAcento(s) = semAcento(s).trim().toLowerCase()`, e os 4 outros lugares importam. `chaveDoNomeMarca` vira `chaveSemAcento`, porque a RN-CAT-13 é exatamente isso |
| Dono | modulo-catalogo |

## 8. Encaminhados ao testes (defeito funcional possível, sem número RD)
1. **T-0140, lease órfão segura o Sincronizar do app por até 2 min.** Em `apps/mobile/src/state/plataforma.tsx:497-501`, se a
   tarefa sem tela morreu no meio (processo encerrado), o lease fica gravado até vencer (2 min). O app aberto nesse intervalo
   vê `leaseOcupado`, `passadaEmSegundoPlano()` volta `null` e a sincronização devolve `false` sem sincronizar e sem mensagem.
   Conferir se isso acontece no aparelho (relatos 1 e 6) e se é o esperado.
2. **RN-GES-03 × RN-CORE-26, feriados diferentes.** O prazo da aprovação do Gestor
   (`modules/gestor/domain/horario-comercial.ts`, lista do Gestor, sem Carnaval nem Corpus Christi) e os dias úteis das metas do
   Core (`@macuxi/comum`, com Carnaval e Corpus Christi) contam dias úteis diferentes na mesma semana. Conferir qual é o certo
   pelas RN e se o 20/11 antes de 2024 importa.

## 9. Recados enviados (cc gerente-projetos)
| Para | Achados | Tarefa |
|---|---|---|
| engenheiro-software | RD-0032 (SDK: `caminhoDoLinkInterno` e `linkInternoNavegavel`) · observação da máscara de dado pessoal (`manter?`) | T-0140 |
| engenheiro-apps | RD-0032 (shell) · RD-0033 · RD-0040 (shell) · RD-0016 e RD-0019 (resto) | T-0140 |
| modulo-core | RD-0032 (Core) · RD-0035 · RD-0013, RD-0017, RD-0019 e RD-0020 (resto) | T-0140 |
| modulo-vendedor | RD-0036 a RD-0039 | T-0131 |
| modulo-gestor | RD-0034 | T-0131 |
| designer-ux | RD-0014 (kit reexporta) · RD-0021 (2ª etapa) · RD-0040 (spec) | T-0111 |
| modulo-treinamento | RD-0014 (CSV com "Administrador") | T-0111 |
| modulo-pesquisa | RD-0014 (mapa próprio no construtor) | T-0111 |
| modulo-catalogo | RD-0024 (resto) · RD-0041 | T-0113 |
| modulo-promotor | RD-0025 (lembrete, sem entrega) | T-0113 |
| testes | §8 (2 itens, sem RD) | T-0140 |

Os números dos recados estão no `catalogo.md`. **Reteste:** quando cada dono entregar, com o grep ou o teste que mostra a cópia
removida e o jscpd de novo nas mesmas pastas.

**Critério 1 da T-0140 ("corretor sem achado alto"):** atendido. Os 2 achados da T-0140 (RD-0032 e RD-0033) são de severidade média.

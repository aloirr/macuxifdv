# Perfis de acesso — página do BKO e campo "Perfis" do usuário (T-0111)

> 2026-11-07 · designer-ux · desenho aprovado pelo dono do produto (R-20261107-195349) em `.coord/tarefas/T-0111.md` ·
> modelo: ADR 0033 e `.coord/contratos/permissoes.md` · regras: RN-CORE-01, RN-CORE-04, RN-CORE-32, RN-CORE-33, RN-CORE-35,
> RN-PRO-01, RN-AUD-01. Para: **modulo-core** (página e formulário em `modules/core/web`). Kit novo: `packages/ui/src/web/permissoes.tsx`
> e `packages/ui/src/web/perfis.ts` (§12).
>
> **Tom (pedido do dono do produto): simples e direto.** Uma frase por aviso; o erro diz o que fazer. Na tela não aparecem
> "chave", "sobreposição", "tenant", "fábrica", "matriz" nem o código do perfil. Falamos **"perfil padrão"** (os 7 que vêm prontos,
> com o selo "Padrão"), **"perfil base"** e **"empresa"**. Nesta página, que só o admin vê, "BKO" pode aparecer (o desenho aprovado
> usa "BKO" nos cadeados e na seção 12).

## 0.1 Nome dos 7 perfis padrão — um só em todas as telas (RD-0014, 08/11/2026)
Fixado pelo designer-ux (R-20261108-173629-corretor-redundancias). Vale igual no BKO (Perfis de acesso, Usuários, Licenças,
menu do shell), no portal `config.`, no login (web e app), nos apps e no CSV de usuários. Constante no kit:
`packages/ui/src/comum/perfis.ts` (`ROTULO_PERFIL_CURTO`, `ROTULO_PERFIL_LONGO`, `ORDEM_PERFIL_PADRAO`, `rotuloDoPerfil`),
exportada por `@macuxi/ui/web`, `@macuxi/ui/mobile` e `@macuxi/ui/mobile/puro`.

| Código | Curto (toda tela) | Longo (só para apresentar) |
|---|---|---|
| `vendedor` | Vendedor | Vendedor de campo |
| `promotor` | Promotor | Promotor de trade marketing |
| `supervisor` | Supervisor | Supervisor de vendas |
| `gerente` | Gerente | Gerente comercial |
| `analista` | Analista | Analista comercial |
| `assistente` | Assistente | Assistente de backoffice |
| `admin` | Admin | Administrador da empresa |

- **Curto** em chip, coluna, seletor, "Perfil base: X", cadeado, mensagem do login ("O perfil assistente não usa o app Macuxi
  Campo."), histórico, CSV e cabeçalho do shell. Saem "Administrador" (Usuários) e "Assistente de BKO" (SDK, login e seed).
- **Longo** só onde o perfil é apresentado uma vez, com espaço: o cabeçalho do Perfil no app (embaixo do nome), a dica
  (`title`/leitor) do chip do perfil e o convite por e-mail. O título "Administrador da empresa" do passo Empresa do portal já é
  o longo do admin. Nunca o longo numa lista ou numa mensagem curta.
- Perfil **padrão**: a tela mostra o texto fixo acima, mesmo que o banco traga outro `nome` (`rotuloDoPerfil(codigo, { nome })`).
  Perfil **criado pela empresa**: o `nome` que ela deu. O código nunca aparece.
- Fonte única (proposta ao engenheiro-software): o `ROTULO_PERFIL` do platform-sdk (hoje "Assistente de BKO") passa a estes
  textos, com `ROTULO_PERFIL_LONGO` ao lado, e o kit reexporta quando depender do SDK; o motor (`ROTULO_BASE` de
  `permissoes-perfil.ts`) usa o mesmo mapa. O seed (`plataforma.semear_perfis_fabrica`) grava os nomes curtos.

## 1. Onde fica e quem vê
- Menu do BKO → grupo **Administração** → **Perfis de acesso** (logo depois de "Usuários"). Rotas: `/core/perfis` (lista) e
  `/core/perfis/<codigo>` (edição).
- Aparece só para quem tem `perfil.gerir` (no padrão, só o admin). Quem abre a URL sem a permissão vê o `Notice tone="info"`:
  **"O seu perfil não gerencia perfis de acesso. Fale com o admin da sua empresa."** e nada mais.
- A permissão é conferida a cada requisição: se o admin perder `perfil.gerir` com a página aberta, a próxima ação recebe 403 e a
  tela mostra o mesmo aviso (as mudanças não salvas se perdem; não há como guardá-las sem a permissão).

## 2. Lista de perfis (`/core/perfis`)
**Cabeçalho** (`PageHeader`):
- título **"Perfis de acesso"**;
- subtítulo: **"O que cada perfil pode fazer e onde entra. Mudanças valem na próxima ação de quem usa o perfil, sem sair e entrar de novo."**;
- ação: botão **principal** **"Novo perfil"** (o único principal da página).

**Tabela** (`Panel` + `TableScroll minWidth={760}`), uma linha por perfil. Ordem: os 7 padrão na ordem Vendedor, Promotor,
Supervisor, Gerente, Analista, Assistente, Admin (`ORDEM_PERFIL_BASE`); depois os personalizados por nome (A→Z); os inativos no fim.

| Coluna | O que mostra |
|---|---|
| **Nome** | nome do perfil (14/600, link para a edição) e, nos de fábrica, o selo **"Padrão"** (`Badge tone="neutral"`, `SELO_PADRAO`). Embaixo, em 12 `ink-2`, a descrição, se houver (1 linha, corta com "…") |
| **Perfil base** | o rótulo da base (`ROTULO_PERFIL_BASE`). Nos padrão, igual ao nome |
| **Onde entra** | um `Badge tone="neutral"` por lugar concedido, na ordem Campo, Gestão, BKO, Portal (`ROTULO_LUGAR`). Nenhum: "Nenhum" em `ink-2` |
| **Usuários** | quantidade (número, alinhado à direita); link para "Usuários" filtrada pelo perfil. Zero: "0" em `ink-2`, sem link |
| **Situação** | `Badge tone="success"` **"Ativo"** ou `Badge tone="neutral"` **"Inativo"** |
| **Ações** | botões link: **"Editar"** · **"Novo a partir deste"** · **"Desativar"** (só personalizado ativo) ou **"Reativar"** (só personalizado inativo) |

**Ações da linha**
- **Editar** → `/core/perfis/<codigo>`.
- **Novo a partir deste** → diálogo do §3, com o perfil base fixo e as permissões copiadas.
- **Desativar** (personalizado):
  - sem usuários: diálogo **"Desativar este perfil?"**, texto **"<Nome> deixa de aparecer no cadastro de usuários. Dá para reativar
    depois. Fica registrado no histórico."**, botões "Cancelar" e **"Desativar"** (`variant="danger"`);
  - com usuários: o mesmo diálogo explica e não desativa: **"<Nome> tem 3 usuários. Troque o perfil deles em Usuários antes de
    desativar."**, botões "Fechar" e **"Ver os usuários"** (vai a Usuários filtrada pelo perfil).
- **Reativar**: diálogo **"Reativar este perfil?"**, **"<Nome> volta a aparecer no cadastro de usuários."**, botões "Cancelar" e
  **"Reativar"** (`variant="primary"`; no diálogo é o único principal).
- Perfis padrão não têm Desativar (RN-CORE-35); nada de botão desabilitado nem cadeado na lista, a ação simplesmente não existe.

**Estados da lista**
- Carregando: `LoadingBlock label="Carregando perfis…"`.
- Erro: `ErrorBlock` com "Tentar de novo" (texto padrão do kit).
- Só os 7 padrão (nenhum personalizado): embaixo da tabela, `Notice tone="info"`: **"Os 7 perfis padrão já vêm prontos. Para
  ajustar as permissões de um grupo de pessoas, crie um perfil a partir de um deles."** Some quando houver um personalizado.
- Sem internet: o erro do `ErrorBlock` com **"Sem conexão. Confira a internet e tente de novo."**

## 3. "Novo perfil" e "Novo a partir deste" (diálogo)
`Dialog` com título **"Novo perfil"** ou **"Novo a partir de <Nome>"**. Campos, de cima para baixo:
1. **Nome** (obrigatório, até 40 caracteres, foco inicial). No "a partir de", já vem **"<Nome> (cópia)"** com o texto selecionado.
2. **Perfil base** (`SelectField`, obrigatório, sem opção pré-escolhida: "Escolha…"), com os 7 na ordem padrão. No "a partir de",
   não é campo: linha de texto **"Perfil base: Vendedor"** (a base não muda).
   Ajuda embaixo (12, `ink-2`), muda com a base escolhida, a partir de `textoOndeEntra` da fábrica da base:
   **"Começa com as permissões do <Base>. Entra em: Campo."** E, nas bases vendedor, promotor e supervisor, a segunda frase:
   **"Este perfil nunca entra no BKO nem no portal (RN-CORE-33)."**
3. **Descrição** (opcional, até 200 caracteres, 2 linhas): ajuda **"Para quem é este perfil. Aparece na lista."**

Rodapé: "Cancelar" e **"Criar e editar"** (principal; enviando: **"Criando…"**). Sucesso: vai à edição do perfil novo, com o
aviso no rodapé (`useToast`) **"Perfil criado. Ajuste as permissões e salve."** O código do perfil é gerado pela tela a partir
do nome (minúsculas, sem acento, `_`), nunca aparece.

Erros (embaixo do campo, 12, `text-danger`): nome vazio **"Dê um nome ao perfil."** · base vazia **"Escolha o perfil base."** ·
422 `CODIGO_REPETIDO` ou nome igual a um existente **"Já existe um perfil com este nome."** · outro erro: `Notice tone="danger"`
**"Não foi possível criar agora. Tente de novo."**

## 4. Edição do perfil (`/core/perfis/<codigo>`): moldura
**Cabeçalho** (`PageHeader`):
- `eyebrow`: link **"‹ Perfis de acesso"** (volta à lista; com mudanças, pergunta antes, §7.4);
- título: o nome; `badge`: selo "Padrão" nos de fábrica e `Badge tone="neutral"` "Inativo" se inativo;
- subtítulo: **"Perfil base: Vendedor · 12 usuários"** (`textoDosAfetados` não entra aqui; é só o número);
- ações (secundárias): **"Histórico"** (§8) e, se o perfil tem algo diferente do padrão, **"Restaurar o padrão"** (§7.5).

**Corpo**: em telas ≥ 1024 px, duas colunas.
- **Índice** à esquerda (200 px, fixo ao rolar): os títulos das seções (`SECOES_DO_PERFIL`) como links de âncora; ao lado de cada
  um, quantas mudanças não salvas ela tem (`Badge tone="pending"` com o número; nada se zero). A seção visível fica em negrito.
  Abaixo de 1024 px o índice some.
- **Seções** à direita, cada uma num `Panel` com `title` = título da seção e `label` igual. Linhas com `LinhaDePermissao`.
  Seção de módulo **não contratado** pela empresa: não aparece (nem no índice). As 12 seções vêm na ordem aprovada; depois delas,
  o bloco **"Outras permissões"** (§5.13), fechado.

**Rodapé fixo** (barra `bg-surface`, borda de cima `line`, sombra leve, presa ao pé da janela):
- à esquerda, **`contagemNaoSalva(n)`** ("Nenhuma mudança", "3 mudanças não salvas"), 13/600, região viva educada;
- à direita: **"Descartar"** (secundário, desabilitado sem mudança) e **"Salvar"** (principal, desabilitado sem mudança). "Salvar"
  abre o resumo (§7.1); nada é gravado antes dele.

**Linha "Padrão: X"**: em toda linha cujo valor difere do padrão de fábrica da base, a `LinhaDePermissao` mostra
`textoDoPadrao(<valor de fábrica>)` embaixo do rótulo ("Padrão: Equipe"). Serve para os perfis padrão e para os personalizados (o
padrão de um personalizado é o da base).

**Valores na tela** (são os mesmos textos do resumo e do histórico): liga/desliga **"Sim"/"Não"**; níveis pelos rótulos de cada
linha (§5); perfis-alvo por `resumoDosAlvos`.

## 5. As seções, linha por linha
Controles: **Interruptor** (liga/desliga, com "Sim"/"Não" escrito), **Nível** (`SeletorDeNivel`, botões lado a lado; "Não" é
sempre a primeira opção quando existe) e **Perfis** (`SeletorDePerfis`). Toda a página usa o interruptor para liga/desliga (onde o
desenho dizia "caixas" também), para um só gesto e o "Sim/Não" sempre escrito; caixa de seleção fica para as listas de perfis.
Níveis de escopo nunca passam o do perfil base: a opção acima aparece com cadeado e desabilitada (`CADEADO.escopoAcimaDaBase`,
RN-CORE-04). A opção **"Equipes abaixo"** só aparece nos perfis de base gerente (o único que tem esse alcance).
"Linha agrupada" = um controle que grava o mesmo valor em várias chaves; se elas estiverem diferentes, o interruptor mostra
**"Em parte"** e o toque liga todas.

### 5.1 Identificação
| Linha | Controle | Notas |
|---|---|---|
| **Nome** | campo de texto, até 40 | nos perfis padrão, só leitura (texto, sem campo): o nome "Vendedor" aparece nas mensagens dos apps |
| **Perfil base** | texto só leitura + cadeado `CADEADO.baseImutavel` | |
| **Descrição** | área de texto, até 200, opcional | |
| **Ativo** | Interruptor | perfis padrão: ligado, travado, cadeado `CADEADO.padraoNaoDesativa`. Personalizado com usuários: desabilitado, ajuda **"Tem 3 usuários. Troque o perfil deles em Usuários antes de desativar."** |

### 5.2 Onde entra
Ajuda da seção (13, `ink-2`, embaixo do título): **"Em quais apps e sites quem tem este perfil consegue entrar."**
| Linha | Chave | Controle | Cadeado |
|---|---|---|---|
| **App Campo** | `acesso.campo` | Interruptor | — |
| **App Gestão** | `acesso.gestao` | Interruptor | — |
| **BKO** | `acesso.bko` | Interruptor | bases vendedor, promotor, supervisor: "Não" travado, texto do `travaDaChave` (RN-CORE-33) |
| **Portal de implantação** | `acesso.portal` | Interruptor | base não admin: "Não" travado, "O portal é só do admin (RN-CORE-33)." |
Em perfil de base admin que o próprio usuário tem: **BKO** travado em "Sim" com `CADEADO.autogestao` (§6).

### 5.3 Escopo de dados
| Linha | Chave | Controle |
|---|---|---|
| **Quais clientes e números vê** | `dados.escopo` | Nível: **Carteira própria · Equipe · [Equipes abaixo] · Toda a empresa** |
Ajuda da linha: **"O perfil começa com o escopo do perfil base e pode ter menos, nunca mais."** As opções acima da base vêm
desabilitadas com cadeado (`CADEADO.escopoAcimaDaBase`).

### 5.4 Módulos
Ajuda da seção: **"Os módulos que quem tem este perfil usa. Só aparecem os contratados pela empresa. Para tirar um módulo de uma
pessoa só, use Usuários e módulos."**
- Uma linha por módulo contratado, na ordem do menu, com Interruptor (padrão de módulos do perfil, `perfil_modulo`, RF-CORE-03).
- **Core**: "Sim" travado, `CADEADO.coreSempreLigado`.
- Módulo desligado aqui: as seções dele continuam editáveis, com um `Notice tone="info"` no topo da seção: **"O módulo <Nome>
  está desligado neste perfil. Estas permissões só valem para quem recebe o módulo por outro perfil."**

### 5.5 Usuários e senhas
| Linha | Chave | Controle | Notas |
|---|---|---|---|
| **Ver os usuários** | `usuario.ver` | Interruptor | |
| **Criar usuário** | `usuario.criar` | Interruptor | |
| **Editar usuário** | `usuario.editar` | Interruptor | ajuda **"Nome, e-mail, equipe e perfis."** |
| **Desativar usuário** | `usuario.desativar` | Interruptor | ajuda **"Nunca o próprio."** |
| **Redefinir senha** | `senha.redefinir` | Interruptor; ligado, abre embaixo (`abaixo`) o `SeletorDePerfis` | ver abaixo |
| **Gerenciar perfis de acesso** | `perfil.gerir` | Interruptor | |
| **Regra da senha** | — | texto só leitura **"8 caracteres ou mais, com letra, número e caractere especial."** + cadeado `CADEADO.senhaSempreComRegra` | RN-CORE-32: nenhum perfil desliga |

**Redefinir senha → "De quais perfis"** (`SeletorDePerfis`, `legenda="De quais perfis"`):
- no topo, a opção **`ROTULO_ALVO_TODOS`** ("Todos os perfis, menos admin (inclusive os criados depois)"), valor `*`;
- depois, os perfis ativos da empresa (padrão primeiro, com o selo; personalizados com `detalhe="Base: <Base>"`);
- perfis de base admin: na lista, desabilitados, com `motivo={CADEADO.senhaDeAdmin}`;
- ajuda: **"Ninguém redefine a própria senha por aqui: use "Esqueci a senha" no login."**;
- ligado sem nenhum perfil marcado: ao salvar, erro na linha **"Marque pelo menos um perfil ou desligue a redefinição de senha."**
  (a tela não deixa salvar);
- o valor no resumo: `resumoDosAlvos` ("Todos, menos admin", "Vendedor, Supervisor").

**Autogestão** (RN-CORE-35): em perfil de base admin **que o próprio usuário tem**, as linhas Criar, Editar, Desativar usuário e
Gerenciar perfis ficam em "Sim", travadas, com `CADEADO.autogestao`. Nos outros casos, a API confere ao salvar (§7.2).

### 5.6 Clientes
| Linha | Chave | Controle |
|---|---|---|
| **Ver o Cliente 360** | (segue `dados.escopo`) | texto só leitura com o nível da seção 3 ("Equipe") e o link **"Mudar em Escopo de dados"** (âncora). O Cliente 360 mostra o que o escopo deixa ver; uma escolha só, num lugar só |
| **Transferir cliente de carteira** | `carteira.editar` | Interruptor; ajuda **"Vincular e desvincular clientes de vendedor ou promotor."** |
Mais permissões (§5.13): `cliente.pagamento_editar`, `cliente.aprovar_coordenada`.

### 5.7 Pedidos
| Linha | Chave | Controle |
|---|---|---|
| **Criar e editar pedido** | `pedido.criar` + `pedido.editar` (nível) | Nível: **Não · Próprio · Em nome da equipe · Qualquer** |
| **Cancelar pedido** | `pedido.cancelar` (nível) | Nível: **Não · Próprio · Equipe · Toda a empresa**; ajuda **"Antes do envio ao ERP. Depois, só no ERP."** |
| **Excluir rascunho** | `pedido.excluir` | Interruptor |
| **Ver pedidos** | `pedido.ver` (nível) | Nível: **Não · Próprios · Carteira · Equipe · Toda a empresa** |
| **Aprovar desconto e crédito** | `pedido.aprovar` (nível alçada) | Nível: **Não · Até a alçada · Acima da alçada** |

**Perfis de base promotor (RN-PRO-01):** "Criar e editar pedido", "Cancelar pedido" e "Excluir rascunho" ficam em "Não", travados,
com o texto do `travaDaChave` ("Promotor nunca cria, edita, cancela ou exclui pedido (RN-PRO-01)."). "Aprovar desconto e crédito"
também ("Não", mesmo cadeado). E a linha "Ver pedidos" vira o Interruptor **"Vê os pedidos da carteira"** com ajuda **"Só
leitura. Desligado, o promotor não vê pedido em lugar nenhum, nem no Cliente 360."** (`promotor_ve_pedidos`: `pedido.ver` com
nível carteira; o padrão é "Sim").
Mais permissões: `pedido.criar_em_nome` (se continuar separado), `transportadora.*`, `forma_pagamento.*`.

### 5.8 Catálogo
| Linha | Chave | Controle |
|---|---|---|
| **Consultar o catálogo** | `produto.consultar` + `produto.perguntar` e `produto.ver_preco_estoque` | Nível: **Não · Sem preço e estoque · Com preço e estoque** (`promotor_ve_preco_estoque`) |
| **Conteúdo, sinônimos e destaques** | agrupada: `produto.enriquecer`, `sinonimo.gerenciar`, `destaque.gerenciar`, `busca.ver_sem_resultado` | Interruptor |
| **Exportar o catálogo** | `catalogo.exportar` (a criar, §13) | Interruptor |
Mais permissões: `tabela_preco.gerenciar`.

### 5.9 Trade (Promotor)
| Linha | Chave | Controle |
|---|---|---|
| **Fazer coletas** | agrupada: as 10 de coleta do promotor (`coleta.registrar`, `checklist_loja.responder`, `gondola.registrar`, `share.registrar`, `preco.registrar`, `ruptura.registrar`, `validade.registrar`, `ponto_extra.registrar`, `concorrencia.registrar`, `tarefa_trade.concluir`) | Interruptor; ajuda **"Gôndola, share, preço, ruptura, validade, pontos extras, concorrência, checklist e tarefas."** |
| **Cadastros de trade** | agrupada: as 8 `*.gerenciar` do promotor | Interruptor; ajuda **"Mix, metas de share, marcas e concorrentes, planogramas, checklists e tarefas."** |

### 5.10 Pesquisa e Treinamento
Cada linha só aparece se o módulo dela for contratado; sem os dois, a seção some.
| Linha | Chave | Controle |
|---|---|---|
| **Responder pesquisas** | `pesquisa.responder` | Interruptor |
| **Fazer os treinamentos** | agrupada: `trilha.baixar_offline`, `licao.concluir`, `quiz.responder` | Interruptor |
| **Criar pesquisas** | agrupada: `questionario.criar`, `questionario.editar`, `questionario.publicar`, `questionario.arquivar` | Interruptor |
| **Criar trilhas** | agrupada: `trilha.criar`, `trilha.editar`, `trilha.publicar`, `quiz.gerenciar`, `desafio.gerenciar`, `medalha.gerenciar` | Interruptor |
| **Ver resultados das pesquisas** | agrupada: `resultado.ver`, `resultado.exportar` | Interruptor |
| **Ver adesão e notas dos treinamentos** | agrupada: `adesao.ver`, `notas.ver` | Interruptor |
Mais permissões: `ranking.ver`.

### 5.11 Metas e remuneração
| Linha | Chave | Controle |
|---|---|---|
| **Metas do mês** | `meta.ver` + `meta.editar` (nível) | Nível: **Não · Só leitura · Equipe · Toda a empresa**. "Só leitura" = vê sem editar |
| **Fechar e reabrir o mês** | `meta.fechar_periodo` | Interruptor |
| **Ver a remuneração variável** | `rv.ver` | Interruptor |
| **Ver o plano de RV** | `plano_rv.ver` | Interruptor |
| **Editar o plano de RV** | `plano_rv.editar` | Interruptor |

### 5.12 Integração (BKO)
| Linha | Chave | Controle |
|---|---|---|
| **Ver o monitor** | `monitor.ver` | Interruptor |
| **Carga por arquivo e modelos CSV** | `carga.arquivo` | Interruptor; ajuda **"Enviar arquivos CSV e baixar os modelos."** |
Mais permissões: `lote.reprocessar`, `mapeamento.editar`, `conector.gerenciar`, `inativacao.decidir`.

### 5.13 "Mais permissões" e "Outras permissões"
Nenhuma chave do catálogo (`catalogoDePermissoes`) fica sem lugar na tela:
- No fim de cada seção, as chaves da área dela que não estão numa linha acima ficam num grupo fechado: botão link **"Mais
  permissões (3)"** / **"Menos permissões"** (`aria-expanded`), e dentro, uma `LinhaDePermissao` com Interruptor por chave.
- Depois da seção 12, o bloco **"Outras permissões"**, fechado, com dois grupos: **"Gestão da equipe"** (área `gestao`) e
  **"Administração do BKO"** (área `administracao`).
- Rótulo de cada uma: o da tabela abaixo (curto, sem código de RN nem nome técnico). Chave nova sem rótulo aqui: a tela usa a
  `descricao` do manifesto até o primeiro " (" ou ";" e o modulo-core me avisa para eu incluir o rótulo.
- **Não aparecem** (ficam sempre como no padrão, para não quebrar os apps): `notificacao.ler`, `dispositivo.registrar_push`.

| Chave | Rótulo | Grupo |
|---|---|---|
| `cliente.pagamento_editar` | Editar prazo e formas de pagamento do cliente | Clientes |
| `cliente.aprovar_coordenada` | Aprovar a localização do cliente | Clientes |
| `pedido.criar_em_nome` | Criar pedido em nome do vendedor | Pedidos |
| `transportadora.ver` / `transportadora.gerenciar` | Ver transportadoras / Cadastrar transportadoras | Pedidos |
| `forma_pagamento.ver` / `forma_pagamento.gerenciar` | Ver formas de pagamento / Cadastrar formas de pagamento | Pedidos |
| `tabela_preco.gerenciar` | Cadastrar tabelas de preço | Catálogo |
| `ranking.ver` | Ver o ranking dos treinamentos | Pesquisa e Treinamento |
| `lote.reprocessar` | Reprocessar lote | Integração |
| `mapeamento.editar` | Editar o de-para de códigos | Integração |
| `conector.gerenciar` | Cadastrar o Conector e a chave de acesso | Integração |
| `inativacao.decidir` | Confirmar inativação em massa | Integração |
| `painel_equipe.ver` | Ver o painel da equipe | Gestão da equipe |
| `ranking_equipe.ver` | Ver o ranking da equipe | Gestão da equipe |
| `fila_aprovacao.ver` / `fila_aprovacao.decidir` | Ver a fila de aprovações / Aprovar ou rejeitar na fila | Gestão da equipe |
| `alerta_equipe.ver` / `alerta_equipe.dispensar` | Ver os alertas da equipe / Dispensar alerta | Gestão da equipe |
| `painel_tenant.ver` | Ver os painéis da empresa (só leitura) | Gestão da equipe |
| `alerta_regra.gerenciar` | Ajustar as regras de alerta | Gestão da equipe |
| `rota.editar` | Montar a rota da semana | Administração do BKO |
| `modulo.gerir_licencas` | Ligar e desligar módulos (Usuários e módulos) | Administração do BKO |
| `dispositivo.bloquear` | Bloquear aparelho | Administração do BKO |
| `motivo.editar` | Cadastrar motivos de não venda | Administração do BKO |
| `produto.editar_preco` | Ver custo e editar preço do produto | Administração do BKO |
| `produto.parametros` | Definir o desconto máximo padrão | Administração do BKO |
| `medida.gerenciar` | Cadastrar medidas e embalagens | Administração do BKO |
| `parametro.promotor_ve_pedidos` | (sai da tela: vira a linha "Vê os pedidos da carteira" do §5.7) | — |
| `notificacao.enviar` | Enviar recado à equipe | Administração do BKO |
| `notificacao.recado_do_dia` | Marcar o recado do dia | Administração do BKO |
| `inicio.ver` | Ver o Início do app | Administração do BKO |
| `farol.ver` / `parametro.farol` | Ver o farol de clientes / Ajustar o farol | Administração do BKO |
| `parametro.inicio` | Ajustar o Início | Administração do BKO |
| `visita.dispensar_etapa` | Dispensar etapa pendente da visita | Administração do BKO |
| `parametro.checkout_pendencia` | Ajustar o prazo do alerta de checkout | Administração do BKO |

## 6. Cadeados
O cadeado (`Cadeado`, dentro da `LinhaDePermissao` com `trava`) fica logo depois do rótulo. **Mostra o texto da regra ao passar o
mouse, ao focar com o teclado ou ao tocar**; o controle da linha vem desabilitado no valor que a regra obriga. Texto: o do
`travaDaChave` do SDK quando a trava é de chave; senão, o `CADEADO` do kit. Sempre com a regra entre parênteses.

| Situação | Onde | Texto |
|---|---|---|
| Base vendedor, promotor ou supervisor (e derivados) e o BKO | 5.2 BKO | `travaDaChave`: "Vendedor nunca entra no BKO (RN-CORE-33)." (com o nome da base) |
| Portal fora da base admin | 5.2 Portal | `travaDaChave`: "O portal é só do admin (RN-CORE-33)." |
| Base promotor e escrita de pedido | 5.7 | `travaDaChave`: "Promotor nunca cria, edita, cancela ou exclui pedido (RN-PRO-01)." |
| Escopo acima da base | 5.3 e níveis de escopo | `CADEADO.escopoAcimaDaBase(base)`: "Acima do perfil base Supervisor (RN-CORE-04)." (na opção) |
| Autogestão do admin | 5.2 BKO, 5.5 gestão | `CADEADO.autogestao`: "Você não pode tirar isto de si mesmo. Peça a outro admin (RN-CORE-35)." |
| Senha de admin na lista de alvos | 5.5 lista | `CADEADO.senhaDeAdmin` (na opção) |
| Regra da senha | 5.5 | `CADEADO.senhaSempreComRegra`: "Toda senha segue a regra de segurança (RN-CORE-32)." |
| Perfil base | 5.1 | `CADEADO.baseImutavel` |
| Ativo dos perfis padrão | 5.1 | `CADEADO.padraoNaoDesativa` |
| Core | 5.4 | `CADEADO.coreSempreLigado` |
O **último admin** não tem cadeado (depende de todos os usuários): a API recusa ao salvar e a tela explica (§7.2).

## 7. Salvar
### 7.1 Resumo "o que mudou" (antes de gravar)
"Salvar" abre o `Dialog` **"Confira antes de salvar"**:
1. `ResumoDasMudancas` com `afetados` = usuários do perfil: "3 mudanças · Afeta 12 usuários." e, por seção, "Cancelar pedido:
   Equipe → Próprio".
2. Nota (12, `ink-2`): `NOTA_DO_RESUMO` — **"Vale na próxima ação de quem usa este perfil, sem precisar sair e entrar de novo.
   Fica registrado no histórico."**
3. Rodapé: **"Voltar e ajustar"** (secundário) e **"Salvar"** (principal; enviando **"Salvando…"**, desabilitado).
Mudanças de identificação (nome, descrição, ativo) entram no resumo na seção "Identificação". Se a pessoa desfaz tudo à mão, o
contador volta a "Nenhuma mudança" e "Salvar" desabilita.

### 7.2 Recusas da API (422 com a RN) e outros erros
O diálogo do resumo **fica aberto**, com `Notice tone="danger"` no topo; a linha da chave recusada ganha o `erro` (texto em
vermelho) e, ao clicar "Voltar e ajustar", o foco vai para a primeira linha com erro (rolando até ela).
| Resposta | Texto no topo do resumo |
|---|---|
| `ULTIMO_ADMIN` (RN-CORE-35) | **"A empresa ficaria sem admin. Mantenha pelo menos um admin ativo que entre no BKO e gerencie usuários e perfis."** |
| `AUTOGESTAO` (RN-CORE-35) | **"Você não pode tirar de si mesmo a gestão de usuários e perfis. Peça a outro admin."** |
| `TRAVA_DO_PERFIL` (RN-CORE-33, RN-PRO-01) | a `mensagem` da API (é a do cadeado) |
| `ESCOPO_ACIMA_DA_BASE` (RN-CORE-04) | a `mensagem` da API |
| `SENHA_ALVO_INVALIDO` | **"Um dos perfis da redefinição de senha não existe mais ou é de admin. Revise a lista."** |
| `CODIGO_REPETIDO` | **"Já existe um perfil com este nome."** (erro no campo Nome) |
| `PERFIL_FABRICA_AUSENTE`, `BASE_ALTERADA` | a `mensagem` da API |
| `USUARIO_SEM_PERFIL` (desativar) | **"Este perfil é o único de alguns usuários. Dê outro perfil a eles antes de desativar."** |
| 403 (perdeu `perfil.gerir`) | fecha o diálogo; a página mostra o aviso do §1 |
| 409 (outra pessoa salvou antes, se a API conferir versão) | **"Outra pessoa mudou este perfil enquanto você editava. Recarregue a página para ver a versão atual."** com o botão **"Recarregar"** |
| sem internet | **"Sem conexão. Suas mudanças continuam na tela. Tente de novo."** |
| 5xx / outro | **"Não foi possível salvar agora. Suas mudanças continuam na tela. Tente de novo."** |
Nunca se mostra JSON, código interno nem a lista bruta de violações; se vierem várias, uma frase por violação, no máximo 3, e
"e mais N" depois.

### 7.3 Sucesso
Fecha o diálogo, o contador volta a "Nenhuma mudança", as linhas "Padrão: X" se recalculam e aparece o aviso no rodapé
(`useToast`): **"Perfil salvo. Vale na próxima ação de quem o usa."** Fica na página.

### 7.4 Sair com mudanças
Link de volta, item do menu ou fechar a aba com mudanças: `Dialog` **"Sair sem salvar?"**, texto **"As 3 mudanças não salvas se
perdem."**, botões **"Continuar editando"** (secundário) e **"Sair sem salvar"** (`danger`). Fechar a aba usa o aviso do navegador
(`beforeunload`). "Descartar" no rodapé pede o mesmo, com o título **"Descartar as mudanças?"** e o botão **"Descartar"**.

### 7.5 Restaurar o padrão
Botão do cabeçalho, só se o perfil tem algo diferente do padrão. `Dialog` **"Voltar ao padrão?"**:
- perfil padrão: **"As permissões de <Nome> voltam a ser as que vêm prontas. Confira e salve para valer."**
- personalizado: **"As permissões voltam a ser as do perfil base <Base>. Confira e salve para valer."**
Botões "Cancelar" e **"Voltar ao padrão"** (principal). Não grava: marca as linhas com os valores padrão (as mudanças aparecem no
contador e no resumo) e a pessoa salva pelo caminho normal. Nome, descrição e situação não mudam.

## 8. Histórico (auditoria, RN-AUD-01)
"Histórico" abre um `Drawer` **"Histórico de <Nome>"**, do mais novo para o mais antigo:
- cada registro: **"07/11/2026 às 21:40 · Ana Souza"** (data e hora no fuso da empresa; nome de quem mudou), e embaixo o
  `ResumoDasMudancas` sem `afetados`, com os valores antes e depois;
- criação: **"Perfil criado a partir de <Base>."**; desativação e reativação: **"Perfil desativado."** / **"Perfil reativado."**;
- vazio: **"Nada mudou neste perfil desde que foi criado."**; carregando e erro: `LoadingBlock` e `ErrorBlock`;
- 20 por vez, com o botão secundário **"Mostrar mais"** no fim.

## 9. Teclado e leitor de tela
- Uma `h1` (título da página), uma `h2` por seção (`Panel title`), `h3` dentro do resumo. O índice é um `nav` com
  `aria-label="Seções do perfil"`; a seção atual tem `aria-current="true"`.
- Cada controle se liga ao rótulo da linha (`rotuloId` = `idsDaLinha(id).rotulo`) e à ajuda e ao cadeado pelo
  `descricaoDaLinha(id, { ajuda, travada })`. Exemplo do que se ouve: "BKO, interruptor, desligado, indisponível. Vendedor nunca
  entra no BKO (RN-CORE-33)."
- Interruptor: `role="switch"`, Espaço/Enter. Nível: rádios nativos num `radiogroup` (Tab entra no marcado, setas trocam); opção
  travada fala "Toda a empresa, travado: Acima do perfil base Supervisor (RN-CORE-04)". Perfis: caixas num `fieldset` com `legend`.
- O cadeado é um botão com o nome "Travado"; o texto da regra é a descrição dele (`role="tooltip"`), lido também sem abrir.
- O contador do rodapé é região viva educada ("3 mudanças não salvas"), anunciada a cada mudança.
- O resumo fala "Cancelar pedido, de Equipe para Próprio" (sem a seta). Recusa e erro de linha: `role="alert"`.
- Diálogos: foco no primeiro campo ou, no resumo, no título; Esc fecha (menos durante "Salvando…"); ao fechar, o foco volta ao botão
  que abriu. "Mais permissões" com `aria-expanded`.
- Alvos de toque ≥ 44 px (interruptor, opções de nível, caixas, cadeado). Cor nunca sozinha: "Sim/Não", cadeado com texto, selo com
  texto. Contraste: textos em `ink`/`ink-2` sobre `surface` (≥ 7:1 e 7,5:1); a opção marcada é branco sobre `ink`.
- "Reduzir movimento": o interruptor e o índice não animam.

## 10. Usuários: campo "Perfis" e a prévia (`modules/core/web/components/usuarios/usuarios-page.tsx`)
**No formulário (Novo e Editar usuário)**, o seletor "Perfil" vira o campo **"Perfis"**, no mesmo lugar:
- `SeletorDePerfis` com `legenda={ROTULO_CAMPO_PERFIS}` ("Perfis"), `ajuda={AJUDA_CAMPO_PERFIS}` (**"Marque um ou mais. Quem
  acumula funções, como vendedor e promotor, fica com os dois."**), sem a opção "todos";
- opções: os perfis **ativos** da empresa, padrão primeiro (com o selo "Padrão"), depois os personalizados (A→Z, `detalhe="Base:
  <Base>"`); com mais de 10, a lista rola dentro de uma caixa de 280 px de altura;
- nenhum marcado ao salvar: `erro={ERRO_SEM_PERFIL}` (**"Escolha pelo menos um perfil."**) e não envia (RN-CORE-01);
- 422 `PERFIL_INDISPONIVEL`: **"Um dos perfis escolhidos foi desativado. Feche e abra o formulário de novo."**
- editando a si mesmo, sem nenhum perfil de base admin marcado (tirando a própria gestão): a API recusa com `AUTOGESTAO` e a tela
  mostra o texto do §7.2 no `Notice` do formulário.

**Prévia**, logo abaixo do campo, num quadro `bg-ground` com borda `line`, raio 10, 12 px de respiro; atualiza ao marcar:
1. **`TITULO_PREVIA_MODULOS`** ("Módulos que esta pessoa vai usar", 12/600 `ink-2`) e os módulos como `Badge tone="neutral"`, na
   ordem do menu. Calculado pelo Core (RN-CORE-01: união dos módulos dos perfis ∩ contratados − exceções desta pessoa).
2. `AJUDA_PREVIA_MODULOS` (12, `ink-2`): **"Soma dos módulos dos perfis marcados, só os contratados pela empresa, menos as
   exceções desta pessoa."**
3. Editando, com exceções: **"Tirados desta pessoa: Treinamento."**
4. Onde entra: `textoOndeEntra(lugares)` ("Entra em: Campo.") pelo `podeEntrar` dos perfis combinados. Se a regra mais restritiva
   fechar o BKO ou o portal que outro perfil daria (RN-CORE-35), uma linha com o cadeado: **"Não entra no BKO: um dos perfis é de
   base Vendedor (RN-CORE-33)."**
5. Nenhum perfil marcado: só **"Marque um perfil para ver os módulos."**
A prévia é região viva educada (lê a frase de onde entra e a lista quando mudam).

**Na lista de usuários**: a coluna "Perfil" vira **"Perfis"** (nomes separados por vírgula; mais de 2: "Vendedor, Promotor +1",
com o nome completo no `title`). O filtro "Perfil" lista todos os perfis ativos (padrão e personalizados).

## 11. Estados da edição
- Carregando: `LoadingBlock label="Carregando o perfil…"` no lugar das seções.
- Erro ao abrir: `ErrorBlock` com "Tentar de novo"; perfil que não existe: **"Este perfil não existe mais."** e o link "‹ Perfis de
  acesso".
- Perfil inativo: `Notice tone="info"` no topo: **"Este perfil está inativo: não aparece no cadastro de usuários. Ligue "Ativo" em
  Identificação para usar de novo."** (as permissões continuam editáveis).
- Sem internet ao abrir: `ErrorBlock` com o texto de sem conexão. Sem internet ao salvar: §7.2.

## 12. Kit (`@macuxi/ui/web`, feito nesta tarefa, com teste)
Arquivos: `packages/ui/src/web/permissoes.tsx` (componentes), `packages/ui/src/web/perfis.ts` (textos e arrumação), testes em
`permissoes.test.ts` e `perfis.test.ts`. Sem hooks e sem regra: a tela decide valor, trava e desabilitado.
| Peça | Uso |
|---|---|
| `LinhaDePermissao({ id, rotulo, ajuda?, padrao?, trava?, erro?, abaixo?, children })` | linha de toda seção; `idsDaLinha(id)` e `descricaoDaLinha(id, {ajuda, travada})` ligam o controle |
| `Interruptor({ ligado, onChange, misto?, rotuloId \| rotulo, descricaoId?, desabilitado? })` | liga/desliga com "Sim/Não/Em parte" |
| `SeletorDeNivel({ nome, opcoes: {valor, rotulo, desabilitada?, motivo?}[], valor, onChange, rotuloId \| rotulo, descricaoId?, desabilitado? })` | níveis (escopo, alçada, metas, catálogo) |
| `SeletorDePerfis({ nome, legenda, ajuda?, opcoes: {valor, rotulo, detalhe?, selo?, desabilitada?, motivo?}[], marcados, onChange(valor, marcar), todos?, erro? })` | alvos da senha e campo "Perfis"; a tela monta a lista com `alternarMarcado` |
| `Cadeado({ id, mensagem })` | já vem dentro da `LinhaDePermissao`; solto, para o "Perfil base" e a prévia |
| `ResumoDasMudancas({ mudancas, afetados? })` + `resumoEmTexto` | resumo antes de salvar e histórico |
| Textos | `TITULO_PERFIS`, `SELO_PADRAO`, `ROTULO_PERFIL_BASE`, `ORDEM_PERFIL_BASE`, `ROTULO_LUGAR`, `SECOES_DO_PERFIL`, `CADEADO`, `ROTULO_ALVO_TODOS`, `ALVO_TODOS_PERFIS` (`*`), `NOTA_DO_RESUMO`, `textoDoPadrao`, `contagemNaoSalva`, `textoDosAfetados`, `resumoDosAlvos`, `textoOndeEntra`, `ROTULO_CAMPO_PERFIS`, `AJUDA_CAMPO_PERFIS`, `ERRO_SEM_PERFIL`, `TITULO_PREVIA_MODULOS`, `AJUDA_PREVIA_MODULOS` |

## 13. Chaves que a página pede e ainda não existem (para o modulo-core repassar)
O ADR 0033 §1 prevê que, aprovado o desenho, os módulos acrescentam as chaves e os níveis. Até cada uma chegar, a linha
correspondente **não aparece** (sem linha quebrada na demo); a página vale com o que existe.
| Linha | Precisa de | Dono |
|---|---|---|
| Criar e editar pedido | nível escopo em `pedido.criar` e `pedido.editar` (`proprio`, `equipe`, `tenant`); decidir se `pedido.criar_em_nome` vira o nível `equipe` | modulo-vendedor |
| Cancelar pedido · Ver pedidos | nível escopo em `pedido.cancelar` e `pedido.ver` | modulo-vendedor |
| Aprovar desconto e crédito | nível alçada em `pedido.aprovar` (e se `fila_aprovacao.decidir` segue junto) | modulo-vendedor, modulo-gestor |
| Vê os pedidos da carteira (promotor) | `pedido.ver` no lugar do parâmetro `promotor_ve_pedidos` (e a migração do valor atual) | modulo-core, banco-dados |
| Exportar o catálogo | `catalogo.exportar` | modulo-catalogo |
| Metas do mês | nível escopo em `meta.editar` | modulo-core |
| Escopo acima da base nos níveis de ação | a API recusar nível de ação acima do escopo da base (hoje só `dados.escopo`) | engenheiro-software |
| Chaves básicas fora da tela | marcar `notificacao.ler` e `dispositivo.registrar_push` como não editáveis no motor | engenheiro-software |

## 14. testIDs
Lista: `perfis.lista`, `perfis.novo`, `perfis.linha.<codigo>`, `perfis.editar.<codigo>`, `perfis.copiar.<codigo>`,
`perfis.desativar.<codigo>`, `perfis.reativar.<codigo>`, `perfis.vazio`. Diálogo novo: `perfis.novo.nome`, `perfis.novo.base`,
`perfis.novo.descricao`, `perfis.novo.criar`, `perfis.novo.erro`.
Edição: `perfil.indice`, `perfil.secao.<secao>`, `permissao.<id>` (id = a chave com "." trocado por "-", ex.
`permissao.pedido-cancelar`; linha agrupada: `permissao.grupo-<nome>`, ex. `permissao.grupo-coletas`), e dentro, os do kit
(`.cadeado`, `.padrao`, `.erro`; `nivel.<valor>`; `perfis.<codigo>`, `perfis.todos`), `perfil.mais.<secao>`, `perfil.outras`,
`perfil.contagem`, `perfil.descartar`, `perfil.salvar`, `perfil.resumo`, `perfil.resumo.erro`, `perfil.resumo.salvar`,
`perfil.resumo.voltar`, `perfil.restaurar`, `perfil.historico`.
Usuários: `usuarios.campo-perfis` (testId do `SeletorDePerfis`), `usuarios.previa`, `usuarios.previa.modulos`,
`usuarios.previa.onde-entra`.

## 15. Notas da revisão de UX (2026-11-08, R-20261108-071919)
Desvios aceitos para o build Demo v1.0.0 (voltam ao desenho quando a peça que falta chegar):
- Edição em `/core/perfis?perfil=<codigo>` (o shell não tem rota dinâmica); os testIDs não mudam.
- "Mais permissões" por seção vira um bloco único **"Outras permissões"**, agrupado por área, com o botão "Mais permissões (N)".
- **Módulos** só leitura (selos com o nome do módulo; Core com o cadeado); ligar e desligar fica em Usuários e módulos até a edição por
  perfil personalizado.
- Autogestão: sem cadeado na tela (ela não sabe os perfis de quem edita); a API recusa com `AUTOGESTAO` e o texto do §7.2.
- Linhas com nível ainda sem a chave do §13 (Pedidos, Metas): interruptores simples na própria seção, com os mesmos rótulos.
- Prévia do formulário de usuário: só "Entra em", com o título "Onde esta pessoa entra", até os módulos efetivos virem do Core.
- Item do menu do shell com mudanças não salvas não pergunta antes de sair (só o link de volta e o fechar a aba).

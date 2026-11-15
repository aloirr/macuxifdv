# Parecer do lote da noite: T-0173 (revisão do BKO por módulo), cabeçalho do Início, e-mails de senha, kit da thathyany, ações da empresa e rodapé legal (15/11/2026)

Feito pelo corretor-redundancias, a pedido do dono do produto (R-20261114-221000-alexandre; regra R-20261110-062506: toda
entrega passa por aqui).
O `coord.mjs` responde HTTP 403 nesta nuvem. Por isso o parecer e os pedidos aos donos ficam só neste relatório e no
catálogo. Os recados aos donos (cc `gerente-projetos`), o encaminhamento ao `testes` e a `entrega` saem quando a caixa
voltar.
Base: `main` mesclado no branch do corretor. Cada lote foi lido com `git diff origin/main...origin/<branch>`. Em todos os
lotes, o head conferido é o SHA pedido: nenhum avançou. A numeração segue a partir do RD-0398.
Critérios: os da definição de pronto do `CLAUDE.md` e a regra de exceção R-20261111-190159. Achado baixo que está só em
teste ou comentário não segura o lote.

## Resumo

| # | Branch | SHA lido | Parecer | Achados (dono) |
|---|---|---|---|---|
| 8 | `nuvem/inicio-cabecalho-modulo-core` | `6f04e77e` | **segura** | RD-0398 **corrigido**; RD-0399 baixa (modulo-core) |
| 10 | `nuvem/kit-thathyany-modulo-integracao` | `1783f3a1` | **segura** | RD-0400 média, RD-0401 baixa (modulo-integracao); RD-0402 baixa, só teste, não segura |
| 1 | `nuvem/bko-revisao-modulo-vendedor` | `1a151258` | **segura** | RD-0408 baixa (modulo-vendedor) |
| 2 | `nuvem/bko-revisao-modulo-gestor` | `2a2b5151` | **sem achado em aberto** | — |
| 3 | `nuvem/bko-revisao-modulo-integracao` | `d42516c9` | **segura** | RD-0409 média, RD-0410 média (modulo-integracao) |
| 4 | `nuvem/bko-revisao-modulo-pesquisa` | `bf81b42b` | **segura** | RD-0411 baixa (modulo-pesquisa) |
| 5 | `nuvem/bko-revisao-modulo-promotor` | `e4d71be3` | **segura** | RD-0412 baixa (modulo-promotor) |
| 6 | `nuvem/bko-revisao-modulo-treinamento` | `0d9178c2` | **segura** | RD-0413 baixa (modulo-treinamento) |
| 7 | `nuvem/inicio-cabecalho-designer-ux` | `a7d6bbdf` | **sem achado em aberto** | RD-0396 e RD-0397 **corrigidos** |
| 9 | `nuvem/email-senha-engenheiro-software` | `d679a1a7` | **segura** | RD-0403 baixa, doc (engenheiro-software) |
| 11a | `nuvem/empresa-acoes-banco-dados` | `60a31e44` | **sem achado em aberto** | — (há uma observação para o testes) |
| 11b | `nuvem/empresa-acoes-engenheiro-software` | `71ea347f` | **segura** | RD-0405, RD-0406 e RD-0407, todos média (engenheiro-software; o RD-0406 com o modulo-core e o RD-0407 com o engenheiro-apps) |
| 11c | `nuvem/empresa-acoes-engenheiro-apps` | `3dec04a5` | **segura** | RD-0407 média (engenheiro-apps, com o engenheiro-software) |
| 12 | `nuvem/rodape-legal-engenheiro-software` | `a9965d78` | **segura** | RD-0404 média, RD-0405 média (engenheiro-software) |

Prints: os lotes do T-0173 não trazem prints. O parecer deles foi feito pelo código das telas, contra a spec
`docs/design/telas/bko-revisao.md`. O lote 8 traz 2 prints, e os dois foram abertos.

---

## Lote 8: `nuvem/inicio-cabecalho-modulo-core` @ `6f04e77e` (reteste do RD-0398 e da foto do perfil)

### Reteste do RD-0398: **corrigido**
- `escala-inicio.ts:101` `linhasDeTexto(caracteres, corpo, fontScale, largura, reserva = 40)` é agora a única conta de
  linhas. A data (`:120`) e a frase (`:121`) passam por ela, e `linhasDaFrase` saiu.
- `escala-inicio.ts:107` `alturaDeLinha(corpo, fontScale, n)` é a única conta de altura. Os dois `linha` locais (`:118` e
  `:129`) só fixam o `fs` e chamam essa função.
- O teste `escala-inicio.test.ts` cobre as duas funções, nos casos "texto longo vale 2 linhas…" e "altura de linha…".

### Foto do perfil
`usar-inicio-campo.ts:80-91` lê `usuario_avatar`. `foto-perfil.ts` chama `escolhaAtual` (do domain) e o resolvedor
injetável. A tela troca as iniciais pela `<Image>` (`tela-inicio-campo.tsx:52`). Nos prints
`inicio-cabecalho-390x844-fonte-1-nome-{curto-com-foto,longo-sem-foto}.png`:
- a foto e as iniciais ocupam o mesmo quadro;
- a saudação, a data · DU e a frase aparecem uma vez cada;
- o sino fica na linha da saudação;
- nada do painel se repete no meio da tela.
**Observação para o testes (funcional, não é RD):** nenhum caminho do shell chama `definirResolvedorFotoPerfil`
(`git grep` em `apps/`). Sem essa chamada, `fotoDoPerfil` devolve `null` e o app continua só com as iniciais. A ligação
é do engenheiro-apps.

### Achado novo

| Campo | RD-0399 |
|---|---|
| Onde | `modules/core/app/telas/inicio/escala-inicio.ts:52` e `:151`; `modules/core/app/telas/inicio/index.ts:4`; `foto-perfil.ts:10` × `apps/mobile/src/lib/sync-t0170.ts:25` |
| Tipo | código |
| O que se repete | (1) O campo `painelAltura` de `EscalaInicio` é calculado em todo `escalaInicio` (`:151`), mas só o teste lê (`escala-inicio.test.ts:58-59`). Nenhuma tela usa, e o teste pode chamar `alturaDoPainel` direto, que já é exportada. (2) `index.ts:4` reexporta `fotoDoPerfil` e `ENTIDADE_USUARIO_AVATAR`, e ninguém importa os dois pelo índice (o hook importa de `./foto-perfil`). (3) `ENTIDADE_USUARIO_AVATAR = 'usuario_avatar'` é a segunda constante para o nome que o shell já tem em `ENTIDADE_AVATAR` (`sync-t0170.ts:25`) |
| Impacto | manutenção: campo calculado sem uso, e dois nomes para a mesma entidade de sync |
| Severidade | baixa (código de produção: segura) |
| Proposta | Tirar `painelAltura` da interface (`:52`), do `Omit` (`:79`) e do retorno (`:151`). No teste: `expect(alturaDoPainel(tamanhosParaFator(1, 1, KIT), { largura: 390, fontScale: 1, frase })).toBeGreaterThanOrEqual(96)`. Em `index.ts:4`, ficar só `export { definirResolvedorFotoPerfil, type ResolvedorFotoPerfil } from './foto-perfil';`. Pedir ao engenheiro-apps que `sync-t0170.ts` passe a importar a constante do Core: `ENTIDADE_USUARIO_AVATAR` exportada em `modules/core/app/index.ts`, no lugar de `ENTIDADE_AVATAR` |
| Dono | modulo-core (item 3 com o engenheiro-apps) |

**Parecer do lote 8: segura (RD-0399, baixa, código de produção).**

---

## Lote 10: `nuvem/kit-thathyany-modulo-integracao` @ `1783f3a1` (kit da thathyany, T-0174)

Conferidos o `ROTEIRO.md`, o `carga_csv.py`, `testes/test_carga_csv.py`, `kit-thathyany.test.ts`, `scripts/gerar.ts`, o
instalador `.ps1`, os 16 modelos CSV e as trocas `api-demo` → `api` na documentação da API.
- `contrato.json`, os modelos, `criar-banco.sql` e `conector.json` são gerados por `gerar.ts` a partir do dicionário do
  BKO (`dicionarioDaEntidade`), e o teste confere que estão em dia. As regras do Python vêm desse contrato: não há regra
  copiada à mão.
- Os modelos têm só o cabeçalho e uma linha fictícia, cada um com um cabeçalho só. Os 16 nomes batem com
  `ENTIDADES_ORDEM_CARGA`.
- Os 25 testes unittest cobrem casos diferentes. `test_os_16_modelos_passam_na_validacao` (função) e
  `test_validar_os_modelos_sai_com_zero` (linha de comando e código de saída) cobrem camadas diferentes: `manter`.

### Achados novos

| Campo | RD-0400 |
|---|---|
| Onde | `modules/integracao/kit-thathyany/ROTEIRO.md:14-15` × `:23-24` (Fase 1, passos 1 e 2) e `:58` (Fase 2, passo 2) |
| Tipo | doc |
| O que se repete | "O que ter em mãos" pede as duas chaves geradas no portal (l.14) e o `conector-1.4.0.zip` baixado pelo **Baixar o Conector** (l.15). Os passos 1 e 2 da Fase 1 e o passo 2 da Fase 2 mandam fazer as mesmas três coisas, no momento certo. A mesma ação aparece **2×**, em dois momentos diferentes. A chave da fase 2 só deve ser gerada depois de desativar o Conector (Fase 2, passos 1-2) |
| Impacto | leitura e decisão: quem segue a lista de cima gera a chave da API e baixa o zip antes da hora, e depois repete nos passos |
| Severidade | média |
| Proposta | Tirar as l.14 e 15. A l.14 diz "Cada chave aparece uma vez só e começa com `mxc_`": essa frase vai para o passo 1 da Fase 1: "… marque **Recebe pedidos** e gere. Copie a chave (ela aparece uma vez só)." No teste, `kit-thathyany.test.ts:163-170` deixa de esperar "chaves geradas no portal" e "Baixar o Conector" na seção "O que ter em mãos" |
| Dono | modulo-integracao |

| Campo | RD-0401 |
|---|---|
| Onde | `ROTEIRO.md:37`, `:60`, `:61`; `carga_csv.py:447` |
| Tipo | texto |
| O que se repete | Texto do que o sistema faz por trás e texto de garantia (R-20261110-192153): l.37 "… Corrija o CSV e rode de novo: **o que já entrou não duplica**."; l.60 "**O instalador para e desativa o serviço do Conector e liga a tarefa Macuxi ERP via API (a cada minuto).**"; l.61 "**Pela API vão vendedores, filiais, formas e prazos de pagamento, produtos, clientes, preços, estoque e títulos.**". A mesma garantia aparece de novo no relatório do Python (`carga_csv.py:447`): "Recusadas (corrija o CSV e rode de novo; o que já entrou não duplica):" |
| Impacto | leitura: a thathyany lê três frases que não mudam o próximo passo |
| Severidade | baixa (texto do kit: segura) |
| Proposta | l.37: "O relatório mostra, por tabela, as linhas lidas, inseridas, atualizadas, sem mudança e recusadas, com a linha e o motivo da recusa. Corrija o CSV e rode de novo." l.60: "Quando pedir, cole a chave nova." l.61: "… Em 2 a 6 minutos a mudança aparece no Backoffice." `carga_csv.py:447`: `"Recusadas (corrija o CSV e rode de novo):"`. Também na l.36 do `roteiro-ensaio-conector-1.4.0.md`: "Preparar no app  dois pedidos" tem espaço duplo, que sobrou do "(ou na demo)" |
| Dono | modulo-integracao |

| Campo | RD-0402 |
|---|---|
| Onde | `kit-thathyany.test.ts:68-75` × `:172-176` |
| Tipo | teste |
| O que se repete | "nenhum endereço da demo" no `ROTEIRO.md` é conferido **2×**. O teste da l.68 passa por todas as entradas do zip (o `ROTEIRO.md` é uma delas) com `/demo\.macuxifdv\|macuxifdv-demo\|api-demo/i`. O da l.172 confere o mesmo arquivo de novo com `/demo/i` |
| Impacto | manutenção |
| Severidade | baixa (só teste: **não segura**, entra no lote seguinte) |
| Proposta | l.172: `it('chave gerada no portal, nunca "no BKO"', …)`, sem o `expect(ROTEIRO).not.toMatch(/demo/i)`. A l.68 já cobre |
| Dono | modulo-integracao |

**Parecer do lote 10: segura (RD-0400, média; RD-0401, baixa, em texto do kit).**

---

## Lote 1: `nuvem/bko-revisao-modulo-vendedor` @ `1a151258`

Conferidos Pedidos, o quadro de aprovação, Alçadas, Formas de pagamento e Transportadoras.
- Pedidos ficou como a §P6 pede:
  - a contagem e a soma vêm do filtro inteiro (`total_filtro` da API, sem os pendentes);
  - o quadro "Aguardando aprovação · N" só aparece quando há pendente, e o select "Situação" já não oferece "Aguardando aprovação";
  - o vazio aparece uma vez;
  - o selo é único (`seloDoPedido`).
- Saíram os toasts com "registrado na auditoria" e "o vendedor vê o motivo no app".
- O PDF da linha e o da gaveta usam o mesmo `exportarPdfDoPedido`. Isso tira uma duplicação.
- A soma da API usa a mesma `STATUS_FORA_DO_TOTAL` do domain.

### Achado novo

| Campo | RD-0408 |
|---|---|
| Onde | `modules/vendedor/domain/totais.ts:14`; `web/components/orders/orders-page.tsx:70` × `order-drawer.tsx:85` |
| Tipo | código · texto |
| O que se repete | (1) Depois deste lote, ninguém mais chama `totalDoPeriodo`. O único uso era o `orders-page`, e agora só `totais.test.ts` usa (`git grep` em `apps/` e `modules/`). (2) A mensagem "Não deu para abrir a impressão: … Tente de novo ou permita pop-ups deste site." está escrita **2×**, no toast da linha (`orders-page.tsx:70`) e no `Notice` da gaveta (`order-drawer.tsx:85`) |
| Impacto | manutenção: função morta no domain, e duas cópias do mesmo texto |
| Severidade | baixa (código de produção: segura) |
| Proposta | (1) Tirar `totalDoPeriodo` e o caso dela do teste. A regra fica em `STATUS_FORA_DO_TOTAL`, que a API usa. Se o app precisar da função, manter e citar o uso. (2) Em `exportar-pdf.ts`: `export const ERRO_IMPRESSAO = (detalhe: string) => \`Não deu para abrir a impressão: ${detalhe} Tente de novo ou permita pop-ups deste site.\`;`, usada nos dois lugares |
| Dono | modulo-vendedor |

**Parecer do lote 1: segura (RD-0408, baixa, código de produção).**

---

## Lote 2: `nuvem/bko-revisao-modulo-gestor` @ `2a2b5151`

Conferidos Painel, Aprovações, Alertas, Ranking e Regras.
- Nenhum `subtitle` sobrou.
- A contagem fica no `h1` (`rotuloComContagem`, que tira o zero) e o vazio aparece uma vez.
- Cada linha tem um selo, e Atualizar e Exportar ficam no "⋯".
- Os KPIs de Aprovações (Para você decidir, Vencidos, Vencendo) não repetem o total do título.
- O "Equipes · N" do Painel é um segundo quadro, com outra lista.
- No Ranking, o selo com as datas do período mostra as datas que o select "Período" escolhe por nome (ex.: "Mês"):
  `manter`.

Nota de conformidade (não é RD; vai para o testes ou o designer-ux): a §P8 manda Regras de alerta para a gaveta, e o lote
mantém a edição na linha (`regras-page.tsx:69-100`).

**Parecer do lote 2: sem achado em aberto.**

---

## Lote 3: `nuvem/bko-revisao-modulo-integracao` @ `d42516c9`

Conferidos Monitor, Carga por arquivo, Conectores, Inativações, Lotes, a gaveta do lote e o De-para. Os subtítulos
saíram, as tabelas passaram para `TabelaDados` e os vazios para `EstadoVazio`.

### Achados novos

| Campo | RD-0409 |
|---|---|
| Onde | `modules/integracao/web/components/carga-arquivo-page.tsx:78` × `:196-197` |
| Tipo | texto |
| O que se repete | Depois do envio, o mesmo fato aparece **2×**. O toast diz "Arquivo recebido: N linhas. **O Macuxi confere cada linha e grava em segundo plano.**" e, na mesma tela, a caixa do resultado diz "**Recebido.** N linhas em X partes; M com erro de leitura (aparecem com a linha do arquivo). Acompanhe o resultado e baixe os erros em Integração ERP." "Grava em segundo plano", "em X partes" e "(aparecem com a linha do arquivo)" contam como o sistema funciona (§P9) |
| Impacto | leitura: duas mensagens de sucesso para um envio |
| Severidade | média |
| Proposta | Tirar o toast do `onSuccess` (`:78`), porque a caixa fica na tela. Caixa: "**Recebido:** {N} linhas{M > 0 ? `; ${M} com erro de leitura` : ''}. Resultado e erros em <a>Integração ERP</a>." |
| Dono | modulo-integracao |

| Campo | RD-0410 |
|---|---|
| Onde | `monitor-page.tsx:80`, `:99-101` × `pedidos-panel.tsx:32-37`, `lotes-panel.tsx:42`, `alertas-panel.tsx:11` |
| Tipo | indicador |
| O que se repete | Na mesma página do Monitor, contra a §P6 regra 7 ("KPI não repete número que já está no título… da mesma tela"): (1) o KPI "Pedidos presos ou retidos" mostra presos + retidos, e o quadro "Pedidos no ERP" mostra "Presos sem retorno" e "Retidos sem mapeamento" em separado; (2) o sub "dos N mais recentes" do KPI "Lotes com erro" repete o "Lotes recentes · N" do quadro (sem filtro, o N é o mesmo); (3) o selo "N crítico(s)" do cabeçalho repete o quadro Alertas, que já põe os críticos primeiro. Os subs "sinal há menos de 3 min" e "fila do ERP" explicam o cálculo (§P9) |
| Impacto | leitura: o mesmo número em dois lugares da página |
| Severidade | média |
| Proposta | Os KPIs ficam "Conectores no ar" ("X de Y", sem sub) e "Lotes com erro" (sem sub). Sai o KPI "Pedidos presos ou retidos": o quadro "Pedidos no ERP" já mostra os dois. Sai o `badge` dos críticos do `PageHeader`: o quadro Alertas logo abaixo dos KPIs já mostra cada crítico com a ação |
| Dono | modulo-integracao |

Mantido: na gaveta do lote, "O lote falhou e nada foi aplicado." fica. Essa frase guia a decisão de reenviar, e o
"O Conector reenvia sozinho" já saiu no lote. `manter`.

**Parecer do lote 3: segura (RD-0409 e RD-0410, média).**

---

## Lote 4: `nuvem/bko-revisao-modulo-pesquisa` @ `bf81b42b`

Conferidos Questionários, Resultados e o Construtor:
- a contagem fica no título;
- a gaveta "Novo questionário" segue a §P8;
- o vazio aparece uma vez, com e sem filtro;
- cada linha tem um selo.

### Achado novo

| Campo | RD-0411 |
|---|---|
| Onde | `modules/pesquisa/web/pages/construtor-page.tsx:165`; `resultados-page.tsx:169-170` |
| Tipo | texto |
| O que se repete | (1) O diálogo "Arquivar este questionário?" diz: "Some do app. **As respostas continuam nos resultados.**". A segunda frase é texto de garantia (R-20261110-192153). (2) Sem versão escolhida, os KPIs "Respondentes" e "Taxa de resposta" mostram "—" e o mesmo sub "Escolha uma versão", **2×** lado a lado. O select "Versão" já está na barra de filtros |
| Impacto | leitura: dois cartões vazios com a mesma frase |
| Severidade | baixa (tela: segura) |
| Proposta | (1) `<p>Some do app.</p>`. (2) Os dois KPIs só aparecem com `dados.tipo === 'versao'`. No consolidado, o grid fica com "Respostas" e "Suspeitas" |
| Dono | modulo-pesquisa |

Observação para o testes (rótulo × número): o título "Galeria de fotos · N" (`resultados-page.tsx:190`) conta todas
as fotos, e a galeria desenha só as 60 primeiras (`fotos.slice(0, 60)`).

**Parecer do lote 4: segura (RD-0411, baixa, tela).**

---

## Lote 5: `nuvem/bko-revisao-modulo-promotor` @ `e4d71be3`

Conferidos Cadastros de trade e Trade marketing:
- o menu "Trade" está no grupo Conteúdo de campo (§M7);
- cada cadastro abre na gaveta, com o erro embaixo do campo (`errosDoForm`);
- cada linha tem um selo;
- os textos de cada cadastro vêm de uma tabela só (`textosDoCadastro`), o que tira uma duplicação.

O aviso das marcas é o `Notice` info, que leva ao Catálogo: `manter?` (ele dá a ação).

### Achado novo

| Campo | RD-0412 |
|---|---|
| Onde | `modules/promotor/web/pages/trade-page.tsx:110` × `:116`; `cadastros-page.tsx:485` |
| Tipo | indicador · texto |
| O que se repete | (1) O título do quadro, "Share de gôndola × meta · N" (as linhas por categoria), que o lote acrescentou, e o sub do KPI "Share médio", "N categoria(s) medida(s)", trazem a mesma contagem. Quando toda categoria da lista tem medição, os dois números são iguais. (2) A legenda "Etapas (a primeira é a primeira que a promotora vê)" explica o óbvio, e os botões ↑ ↓ já dizem que a ordem conta |
| Impacto | leitura |
| Severidade | baixa (tela: segura) |
| Proposta | (1) O KPI fica sem o sub (`<KpiCard label="Share médio" value={…} />`). (2) `<legend …>Etapas</legend>` |
| Dono | modulo-promotor |

Nota de conformidade (não é RD): Trade marketing ainda usa "De" e "Até" em dois campos. A §P4 regra 3 pede um campo só,
"Período".

**Parecer do lote 5: segura (RD-0412, baixa, tela).**

---

## Lote 6: `nuvem/bko-revisao-modulo-treinamento` @ `0d9178c2`

Conferidos Trilhas (abas, busca, Adesão, Pessoas) e Editar trilha:
- o erro aparece embaixo do campo (`errosDoFormulario`);
- `mensagemDoProblema` tira a duplicação das duas mensagens técnicas;
- no Público-alvo, a segunda frase de explicação saiu.

### Achado novo

| Campo | RD-0413 |
|---|---|
| Onde | `modules/treinamento/web/pages/trilha-editar-page.tsx:131` × `:135`; `trilhas-page.tsx:213-215` |
| Tipo | texto |
| O que se repete | (1) O `badge` do cabeçalho mostra "Publicada" ou "Arquivada" (`:131`), e o `Notice` logo abaixo repete: "**Trilha publicada**: só leitura. Para mudar o conteúdo, arquive e crie uma nova trilha." ou "**Trilha arquivada**: só leitura." (`:135`). (2) No grid de Adesão, "mês" aparece **3×**: "Adesão em {Novembro}", com o sub "concluíram ao menos uma lição **no mês**", e "Ativos **no mês**". O filtro "Mês" fica logo acima |
| Impacto | leitura |
| Severidade | baixa (tela: segura) |
| Proposta | (1) `'Só leitura. Para mudar o conteúdo, arquive e crie uma nova trilha.'` e `'Só leitura.'`. (2) Sub: "concluíram ao menos uma lição". Rótulo "Ativos" |
| Dono | modulo-treinamento |

**Parecer do lote 6: segura (RD-0413, baixa, tela).**

---

## Lote 7: `nuvem/inicio-cabecalho-designer-ux` @ `a7d6bbdf` (reteste do RD-0396 e do RD-0397)

| RD | Reteste | Status |
|---|---|---|
| RD-0396 | A decisão fica só na nota das l.3-4. l.11: sem "(A e B: histórico)" e sem "(a escolhida; …)". l.26: só `## 2. Variações`. l.33: "**Por que a C:** é a que tem…". Ficam o "Escolhida (C)" da coluna (l.15) e o negrito da linha C (l.31), como a proposta previa | **corrigido** |
| RD-0397 | l.43: "Foto/iniciais: medidas da C (§2); …". "31 dp mais baixo" só na l.22; a l.33 já não traz o número | **corrigido** |

Achado novo: nenhum. **Parecer do lote 7: sem achado em aberto.**

---

## Lote 9: `nuvem/email-senha-engenheiro-software` @ `d679a1a7` (e-mails de senha)

Conferidos `modelos.ts` (o layout novo), a configuração `MACUXI_EMAIL_URL_*`, o despachante e o adendo da ADR 0032.
- Os textos batem com a spec `docs/design/emails/redefinir-senha.md`:
  - título "Crie a sua senha {destino}";
  - uma linha de contexto;
  - Código da empresa, E-mail e Senha temporária, cada um numa linha;
  - "Vale por 72 horas.";
  - o botão só com o backoffice;
  - a assinatura A.
- No caso `esqueci`, saiu a garantia "a sua senha atual continua valendo".
- Um layout serve os três casos (`montar`), e as três renderizações usam as mesmas opções.
- O 429 das rotas públicas ganhou `detalhes.retry_after_s` (ver o RD-0404 no lote 12).
- Já existia: `MENSAGEM_SESSAO` (`sessao-web.ts:42`) é cópia do texto do Core. O comentário diz que passa a vir do
  `contracts` com o PR #285. Fica anotado, sem RD novo.

### Achado novo

| Campo | RD-0403 |
|---|---|
| Onde | `docs/decisoes/0032-ciclo-de-senha-dos-usuarios.md:83-84` × `:91-92` |
| Tipo | doc |
| O que se repete | No mesmo adendo, a falta de `MACUXI_EMAIL_URL_ATIVOS` está escrita **2×**. Na Decisão: "Sem ela, o e-mail sai só com o texto alternativo do logo ('Macuxi Força de Vendas'), e a subida avisa." Nas Consequências: "Sem isso, **nada quebra**: o e-mail sai completo, sem a imagem." A segunda frase repete a primeira e é texto de garantia |
| Impacto | leitura |
| Severidade | baixa (doc: segura) |
| Proposta | l.91-92: "**Para o e-mail ter logo em produção (e na demo), `MACUXI_EMAIL_URL_ATIVOS` precisa estar configurada** no ambiente da API e do worker (hoje o `email.env` do `producao-publicar.yml` só leva as `MACUXI_SMTP_*`), e os dois PNG precisam estar publicados." |
| Dono | engenheiro-software |

**Parecer do lote 9: segura (RD-0403, baixa, doc).**

---

## Lote 11: ações da empresa (ADR 0052)

### 11a: `nuvem/empresa-acoes-banco-dados` @ `60a31e44`
Conferidos a 0072 (o motivo da inativação ficou opcional e pode ser nulo, RD-0380), `docs/banco/plataforma.md` e o
README. Os commits mesclados do engenheiro-software (ADR e desenho) já passaram pelo corretor (RD-0345..0353,
RD-0380, RD-0387). O README resume e manda ao `plataforma.md`, como nas migrações anteriores. Achado novo: nenhum.
**Observação para o testes (contrato, não é RD):** a 0072 usa o hint e o retorno `EMPRESA_NAO_ENCONTRADA`
(`0072…up.sql:343`, `:515`, `:563`, `:622`, `:664`, `:713`). O SDK, depois do RD-0345..0353, chama o mesmo caso de
`TENANT_NAO_ENCONTRADO` (`empresa-acoes.ts:46`), e `EMPRESA_NAO_ENCONTRADA` não está em `CODIGOS_ACOES_EMPRESA`. Se
`exclusao_bloqueada` devolver esse valor dentro de `sa_acoes_das_empresas`, a conferência do contrato na API falha.
**Parecer do 11a: sem achado em aberto.**

### 11b: `nuvem/empresa-acoes-engenheiro-software` @ `71ea347f`

| Campo | RD-0405 |
|---|---|
| Onde | `apps/api/src/empresa-acoes-portal.ts:151-163`, `:172-176`, `:198-204`; `apps/api/src/dados-legais.ts:77-90`, `:138-144` (lote 12); `apps/api/src/app.ts:599/619/632/640/652` (11b) e `:592/608/620/627/639` (12); `apps/api/src/config.ts:56` |
| Tipo | código |
| O que se repete | O encanamento das rotas do portal já estava copiado em `plataforma.ts`, `planos-portal.ts`, `diagnosticos-portal.ts` e `consulta-cnpj.ts`, e os dois lotes acrescentam a 5ª e a 6ª cópia: (1) `exigir`/`exigirSuperAdmin` (401 "Entre no portal para continuar." + `marcarPortal` + 403 `PERFIL_SEM_ACESSO`), **6×**; (2) a tradução do SQLSTATE das `sa_*` (28000 → 401 "Sua sessão do portal expirou. Entre de novo.", 42501 → 403…), **6×**; (3) `conferir(schema, bruto, funcao)` com "devolveu formato diferente do combinado", em 9 lugares; (4) `autenticar: async (req) => (bancoPortal ? autenticarPortal(cabecalhos(req), acessoPortal) : semPortal())`, **5×** em `app.ts` em cada branch, 6× depois dos dois merges; (5) a leitura de flag `['1', 'true', 'sim'].includes(String(env.X ?? '').trim().toLowerCase())`, **4×** em `config.ts` (o 11b acrescenta `empresaAcoesLigadas`) |
| Impacto | manutenção: o texto do 401 e do 403 e a tradução do SQLSTATE mudam em 6 arquivos |
| Severidade | média (código de produção: segura o 11b e o 12) |
| Proposta | Criar `apps/api/src/portal-comum.ts` com `exigirSuperAdmin(dep, req, tenantId, mensagem403)`, `traduzirErroSa(e, extras?: (code, hint) => never \| void): never` (28000, 42501 e 22023 comuns; os casos próprios entram por `extras`) e `conferirRetorno(schema, bruto, funcao)`. Em `app.ts`: `const autenticarDoPortal = async (req: FastifyRequest) => (bancoPortal ? autenticarPortal(cabecalhos(req), acessoPortal) : semPortal());`, passado a todos. Em `config.ts`: `const ligado = (env, nome) => ['1', 'true', 'sim'].includes(String(env[nome] ?? '').trim().toLowerCase());`. Os dois arquivos novos (`empresa-acoes-portal.ts` e `dados-legais.ts`) já usam o comum. Os 4 antigos podem passar no lote seguinte |
| Dono | engenheiro-software |

| Campo | RD-0406 |
|---|---|
| Onde | `apps/api/src/empresa-acoes-portal.ts:107-108` × `modules/core/api/seguranca-plataforma.ts:29-30` |
| Tipo | código |
| O que se repete | `chaveDeTentativaDoPortal` é a cópia de `chaveDeTentativa` do Core: o HMAC-SHA256 de `portal.login:<e-mail normalizado>`. O próprio comentário avisa: "O Core não exporta a função; mudou lá, muda aqui". É regra de segurança (o limite de tentativas do login do portal) copiada para fora do dono |
| Impacto | manutenção e segurança: se a chave mudar só no Core, a senha errada na exclusão deixa de contar no mesmo limite do login (ADR 0052 §3.2) |
| Severidade | média |
| Proposta | O Core exporta a função pelo seu `contracts` (ou pelo `platform-sdk`, se for da plataforma): `export const chaveDeTentativaDoPortal = (segredo: string, email: string) => …`, com a normalização dentro. `seguranca-plataforma.ts` e `empresa-acoes-portal.ts` importam dali. O teste do valor fixo fica no dono |
| Dono | engenheiro-software · modulo-core |

| Campo | RD-0407 |
|---|---|
| Onde | `apps/api/src/empresa-acoes-portal.ts:137-146` (`MENSAGENS`) × `apps/web/lib/portal-empresa-acoes.ts:44-48` (`MOTIVO_DO_BLOQUEIO`) e `:117-127` (`erroDoExcluir`) |
| Tipo | texto · código |
| O que se repete | Os mesmos códigos de recusa têm duas tabelas de frases que não batem. Na API: `EXCLUSAO_SEM_BACKUP` "Faça o backup da empresa antes de excluir.", `EXCLUSAO_BACKUP_ANTES_DA_INATIVACAO` "Faça um backup novo, com a empresa inativa.", `EXCLUSAO_BACKUP_VENCIDO` "O backup passou do prazo. Faça um backup novo.", `EXCLUSAO_CODIGO_NAO_CONFERE` "O código digitado não é o da empresa.". Na tela: "Faça o backup antes de excluir." (para os três primeiros) e "Código não confere.". A API marca as dela como "Texto provisório (o final é do designer-ux…); a tela decide pelo código" |
| Impacto | manutenção: a correção de texto é feita em dois lugares, e o BKO e a API dizem frases diferentes para a mesma recusa |
| Severidade | média |
| Proposta | Uma tabela só, no SDK, ao lado de `CODIGOS_ACOES_EMPRESA`: `export const MENSAGENS_ACOES_EMPRESA: Readonly<Record<CodigoAcaoEmpresa, string>>`, com o texto final da spec §15.2 ("Faça o backup antes de excluir.", "Inative a empresa antes de excluir.", "Código não confere.", "Senha incorreta." …). A API usa essa tabela em `ErroHttp`, e `erroDoExcluir` devolve `e.message` (fica só o mapa do `senha: true`). O `MOTIVO_DO_BLOQUEIO` (as frases curtas da coluna) fica na tela, porque é outro lugar com outro texto |
| Dono | engenheiro-software · engenheiro-apps |

**Parecer do 11b: segura (RD-0405, RD-0406 e RD-0407, média, código de produção).**

### 11c: `nuvem/empresa-acoes-engenheiro-apps` @ `3dec04a5`
Conferidos a lista de Empresas (coluna Backup, menu "⋯"), os diálogos Inativar e Excluir e `portal-empresa-acoes.ts`.
- `rotuloDoStatus` e `tomDoStatus` passaram para um lugar só, e a página da empresa usa os mesmos. Isso tira uma
  duplicação, e o rótulo passa a vir do SDK (`ROTULO_STATUS_EMPRESA`).
- O backup que falhou aparece só no aviso do topo.
- Os diálogos destrutivos ("Todos os acessos ficam bloqueados.", "Não dá para desfazer.") são confirmação útil: `manter`.

O RD-0407 vale para este branch também.
**Parecer do 11c: segura (RD-0407, média).**

---

## Lote 12: `nuvem/rodape-legal-engenheiro-software` @ `a9965d78` (rota pública do rodapé)

Conferidos `dados-legais.ts`, o contrato no SDK (`plataforma.ts:256-326`) e os testes.
- Há um cache só, o `Cache-Control` público sem ETag (o RD-0382 continua corrigido).
- A normalização e a validação do site e do CNPJ ficam só no `GravarDadosLegaisSchema`.
- O teste do SDK cobre o schema, e o teste da API cobre a rota: `manter`.

### Achado novo

| Campo | RD-0404 |
|---|---|
| Onde | `apps/api/src/dados-legais.ts:122-125` × `apps/api/src/app.ts:803-807` (`montarRotaPublica`) |
| Tipo | código |
| O que se repete | O 429 da rota pública é a cópia do 429 do `montarRotaPublica`: o cabeçalho `retry-after` + `ErroHttp(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um pouco e tente de novo.')`. O lote 9 muda o original para mandar também `detalhes.retry_after_s` ("mesmo formato do 429 do módulo: o app mostra a espera real"). Depois dos dois merges, as duas cópias passam a dar respostas diferentes |
| Impacto | manutenção, e o formato do 429 diverge entre as rotas públicas |
| Severidade | média (código de produção: segura) |
| Proposta | Em `limitador.ts`: `export function recusarPorLimite(reply: FastifyReply, esperaS: number): never { reply.header('retry-after', String(esperaS)); throw new ErroHttp(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde um pouco e tente de novo.', { retry_after_s: esperaS }); }`, usada em `app.ts` e em `dados-legais.ts` (`if (!limitador.tentar(req.ip)) recusarPorLimite(reply, limitador.esperaSegundos(req.ip));`). Quem fizer o merge do segundo dos dois lotes faz a junção |
| Dono | engenheiro-software |

O RD-0405 vale para este branch também (itens 1 a 4).
**Parecer do lote 12: segura (RD-0404 e RD-0405, média).**

---

## Encaminhados ao testes (sem RD)
- Lote 8: `definirResolvedorFotoPerfil` não tem chamador no shell, e a foto nunca aparece no app.
- Lote 4: "Galeria de fotos · N" conta todas as fotos e desenha 60.
- Lote 11a: o hint `EMPRESA_NAO_ENCONTRADA` (0072) × `TENANT_NAO_ENCONTRADO` (SDK), fora de `CODIGOS_ACOES_EMPRESA`.

---

# Lote da noite, parte 2 (15/11/2026)

Antes desta parte, o `origin/main` (b09fc152, #293) foi mesclado no branch do corretor, sem rebase. Cada lote foi lido com
`git diff origin/main...origin/<branch>`. Nenhum head avançou além do SHA pedido. A numeração continua no RD-0414.
Os critérios são os da parte 1. O `coord.mjs` continua com 403, então os recados aos donos e ao `testes` ficam
pendentes e o pedido vale por este relatório e pelo catálogo.

## Resumo da parte 2

| # | Branch | SHA lido | Parecer | Achados (dono) |
|---|---|---|---|---|
| 13 | `nuvem/acesso-bko-modulo-core` (PR #250) | `1ecb5fce` | **segura** | RD-0394 e RD-0395 **corrigidos**; RD-0414 média, RD-0415 baixa (modulo-core) |
| 17 | `nuvem/logo-cliente-designer-ux` | `184319e4` | **sem achado em aberto** | — |
| 14 | `nuvem/bko-revisao-modulo-core` | `0c276eb5` | **segura** | RD-0416 média (designer-ux, modulo-core, modulo-catalogo); RD-0417 baixa (modulo-core, modulo-catalogo); RD-0418, RD-0419, RD-0420 e RD-0421 média, RD-0422 baixa (modulo-core) |
| 15 | `nuvem/bko-revisao-modulo-catalogo` | `5df48729` | **segura** | RD-0416 e RD-0417 (os mesmos do lote 14); RD-0423 baixa (modulo-catalogo) |
| 16 | `nuvem/chave-conector-modulo-integracao` | `3352c984` | **sem achado que segure** | RD-0424 baixa, só teste, não segura (modulo-integracao) |

---

## Lote 13: `nuvem/acesso-bko-modulo-core` @ `1ecb5fce` (PR #250, reteste e Desbloquear)

Lido o commit `1ecb5fce` sobre o `e6453f5b` da parte anterior (reteste-5-lotes, lote 4). Prints conferidos:
`docs/modulos/core/telas/acesso/*-1366x768.png` (11) e `modules/core/web/docs/prints/acesso/*-1366x768.png` (4).

### Retestes

| Item | Resultado | Evidência |
|---|---|---|
| RD-0394 (sobras do multiperfil) | **corrigido** | O `describe` "editar e desativar olham todos os perfis do alvo" saiu de `api/usuarios.test.ts`. Os três comentários estão com o texto proposto: `contracts/usuarios.ts` ("O perfil do usuário (RN-CORE-54: lista de um item)"), `api/usuario-perfis.ts` e `api/usuarios.ts` ("o perfil real do alvo") |
| RD-0395 (mapa próprio de ícone e nome) | **corrigido** | `web/components/acesso/icones-modulo.tsx` foi apagado e `NOME_DO_MODULO_ACESSO` saiu. `lib/acesso.ts` usa `modulosContrataveis` e `nomeDoModulo`, e as telas usam `IconeModulo` de `@macuxi/ui/web` (`modulos.tsx`, §P10). No print, os ícones da coluna Módulos são os do kit |
| MC-0061 (menu da linha) | conforme, no que toca à redundância | `menu-linha.tsx` foi apagado, e Usuários e Perfis usam o `MenuAcoes` do kit. Quem fecha a MC é o design-de-marca |
| MC-0062 (ícones dos módulos) | conforme, no que toca à redundância | É o mesmo ponto do RD-0395 |
| MC-0063 (prints) | **parcial** | Os 1920×1080 foram apagados e os 1366×768 refeitos em `docs/modulos/core/telas/acesso/`. Ficaram 4 prints antigos em outra pasta: é o RD-0414 |
| "perfis" no plural | **corrigido** | `web/lib/perfis.ts:54` diz "Nome, e-mail, equipe e perfil." e `MENSAGEM_PERFIL_INDISPONIVEL` diz "O perfil escolhido foi desativado. Feche e abra o formulário de novo." |
| Desbloquear (novo) | sem redundância | Cada linha tem um selo só (Inativo > Bloqueado > "Bloqueado até 20h55"). "Desbloquear" é o 1º item do "⋯" e só aparece com bloqueio. A gaveta tem uma faixa com o selo e o botão. Não há toast nem aviso, só o anúncio para leitor de tela. A regra do bloqueio vem de `estadoDoLogin` (domain), a mesma do login (`bloqueioDaLinha`), sem cópia. O selo da gaveta repete o da linha, mas a gaveta cobre a lista e o botão age sobre ele: `manter` |

### Achados novos

| Campo | RD-0414 |
|---|---|
| Onde | `modules/core/web/docs/prints/acesso/{usuarios-lista,usuarios-novo-vendedor,perfis-lista,perfis-novo}-1366x768.png` (do commit `e6453f5`) × `docs/modulos/core/telas/acesso/{usuarios,usuarios-novo-vendedor,perfis,perfil-novo}-1366x768.png` (refeitos no `1ecb5fce`) |
| Tipo | doc |
| O que se repete | As 4 telas têm print em duas pastas do mesmo PR. As cópias antigas já não batem com a tela: não têm o selo Bloqueado nem o Desbloquear, têm outra empresa ("Demo Distribuidora") e outros usuários, e o ícone de Gestor aparece em todo mundo. O diário (`.coord/diario/modulo-core.md:168`) ainda aponta a pasta antiga |
| Impacto | leitura: quem confere o PR (testes, marca, corretor) pode olhar o print velho. Manutenção: duas pastas para a mesma tela |
| Severidade | média (doc que contradiz a tela; segura) |
| Proposta | Apagar a pasta `modules/core/web/docs/prints/acesso/` (4 arquivos). A fonte única passa a ser `docs/modulos/core/telas/acesso/`. Uma linha nova no diário: "prints do Acesso só em docs/modulos/core/telas/acesso" |
| Dono | modulo-core |

| Campo | RD-0415 |
|---|---|
| Onde | `modules/core/web/lib/usuarios.ts:205-212` (`horaNoFuso`, novo) e `:145-152` (`diaEHora`) × `packages/ui/src/web/format.ts:66-77` (`formatTime`, `formatDateTime`) |
| Tipo | código |
| O que se repete | Mais um `Intl.DateTimeFormat(...).formatToParts` no mesmo arquivo, para a hora no fuso. O kit já faz a mesma conta (`parts`, `hourCycle: 'h23'`). O `diaEHora` devolve exatamente o que o `formatDateTime` devolve ("dd/mm às HH:MM") |
| Impacto | manutenção: são 3 formatadores de data e hora no fuso para o mesmo fim (kit + 2 no arquivo) |
| Severidade | baixa (código de produção: segura, R-20261111-190159) |
| Proposta | `import { formatDateTime, formatTime } from '@macuxi/ui/web';` e apagar as duas funções. No `seloDoUsuario`, `` `Bloqueado até ${formatTime(u.bloqueio_ate, fuso).replace(':', 'h')}` ``. No `etiquetaDeSenha`, `` `Troca de senha pendente · vence em ${formatDateTime(u.senha_expira_em, fuso)}` `` |
| Dono | modulo-core |

### Para o testes (sem RD)
- Prints `usuarios-gaveta-bloqueado` e `usuarios-gaveta-desbloqueado`: o corpo da gaveta aparece **abaixo** do rodapé fixo
  (a linha "Pesquisa" da lista de módulos sai embaixo de Cancelar/Salvar, em y≈750). Conferir o `Drawer` do kit (rodapé
  fixo × corpo rolando) a 1366×768.

**Parecer do lote 13 (PR #250): segura (RD-0414, média; RD-0415, baixa em código de produção).**

---

## Lote 17: `nuvem/logo-cliente-designer-ux` @ `184319e4` (simulação da logo do cliente)

Lidos `docs/design/telas/logo-cliente.md` e os 8 PNGs: portal (tela e 6 estados), carga e login no Campo e no Gestão,
fim do Mais e os 3 PDFs.

- **Frase combinada:** o Mais traz "Licenciado para Exemplo Norte" (nome fantasia), com a regra da razão social quando o
  nome fantasia está vazio (§5). Confere com R-20261114-223500.
- **Mais com logo:** a frase e a logo mostram o mesmo nome. A frase foi pedida pelo dono do produto, e a logo é a
  identidade visual. A spec já tira a logo do leitor de tela para o nome não ser lido duas vezes: `manter`.
- **Portal:** um cartão só, sem texto de explicação, e uma frase de erro com a ação. A linha dos limites ("PNG ou JPG ·
  até 1 MB · pelo menos 200 px de altura") aparece em todos os estados e serve à ação ao lado (Enviar ou Trocar): `manter`.
  A remoção abre um diálogo sem texto de corpo.
- **Carga e login:** só a placa entra, o resto da tela não muda. No login, a placa fica no formulário e não repete a
  faixa da Macuxi.
- **PDF:** só muda a caixa da `.logo`. A logo ao lado da razão social é identidade + dado fiscal: `manter`. Os rótulos
  em branco ("Entrega", "Observação do pedido/da entrega") já são do PDF de hoje (T-0159) e ficam fora deste lote.
- Os HTML da pasta são a fonte dos PNG: `manter`.

**Parecer do lote 17: sem achado em aberto.**

---

## Lote 14: `nuvem/bko-revisao-modulo-core` @ `0c276eb5` (T-0173 do Core)

Lidos os commits `ae798c8a`, `8f01c1d0` e `0c276eb5` e as 32 imagens de
`modules/core/web/docs/prints/bko-revisao/{antes,depois}/`, contra a spec `docs/design/telas/bko-revisao.md` (§P1–§P11).
O que passa:
- não há mais subtítulo;
- a contagem fica no h1;
- as ações extras foram para o "⋯";
- o farol tem selo único e coluna "Dias sem compra" só com o número (RD-0360);
- Licenças usa `CartaoDeModulo` e `modulosContrataveis` do kit;
- Usuários e Perfis ficaram fora, como deve ser (#250).

### Achados novos

| Campo | RD-0416 |
|---|---|
| Onde | busca com espera de 300 ms em 4 implementações: `modules/core/web/lib/lista-bko.tsx:11-31` (`ESPERA_BUSCA_MS`, `useBuscaComEspera`), `modules/core/web/components/aparelhos/aparelhos-page.tsx:72` e `farol/farol-page.tsx:147` (`setTimeout(..., 300)` na página) e, no lote 15, `modules/catalogo/web/lib/busca-com-espera.ts` (mesmo nome `useBuscaComEspera`, mesma constante `ESPERA_BUSCA_MS = 300`, outra assinatura) |
| Tipo | código |
| O que se repete | O mesmo comportamento da §P4 ("busca ao digitar, espera de 300 ms e Enter") foi escrito 4 vezes. São duas versões com o mesmo nome em dois módulos, e só a do catálogo acompanha o valor externo (Limpar filtros, voltar do navegador) |
| Impacto | manutenção: mudar a espera ou o Enter pede 4 alterações. Comportamento: Limpar filtros e Voltar já respondem diferente de uma lista para outra |
| Severidade | média (código de produção copiado entre módulos; segura os lotes 14 e 15) |
| Proposta | O kit (`packages/ui/src/web`, ao lado do `CampoBusca`) ganha `export const ESPERA_BUSCA_MS = 300` e o `useBuscaComEspera(valor, aoMudar, espera?)`, que é a versão do catálogo e devolve `{ value, onChange, onKeyDown }`. O Core apaga `useBuscaComEspera` e `ESPERA_BUSCA_MS` de `lista-bko.tsx` e os dois `setTimeout` de Aparelhos e Farol. O Catálogo apaga `web/lib/busca-com-espera.ts`. Todos usam `<CampoBusca rotulo=… {...useBuscaComEspera(filtros.q, (q) => mudar({ q }))} />` |
| Dono | designer-ux (kit), depois modulo-core e modulo-catalogo |

| Campo | RD-0417 |
|---|---|
| Onde | `LimparFiltros` (`modules/core/web/lib/lista-bko.tsx:33-41`) é usado em 4 páginas (filiais, fotos-pdv, motivos, tarefas). O mesmo `<Button size="sm" …>Limpar filtros</Button>` com a condição foi escrito à mão em 6 páginas do Core (`aparelhos-page.tsx:~140`, `carteira-page.tsx:202`, `farol-page.tsx:281`, `indicadores-page.tsx:110`, `metas-page.tsx:168`, `routes-page.tsx:303`) e em 4 lugares do Catálogo (`catalogo-page.tsx`, `marcas-page.tsx`, `tabelas-preco-page.tsx` 2×) |
| Tipo | código |
| O que se repete | 10 cópias do botão da §P4 ao lado do componente que existe para isso |
| Impacto | manutenção: o texto, o tamanho e o `data-testid` divergem (`lista.limpar-filtros` × `<tela>.limpar-filtros`) |
| Severidade | baixa (código de produção: segura) |
| Proposta | Com o RD-0416, `LimparFiltros` vai para o kit com `testId` opcional: `export function LimparFiltros({ ligado, onLimpar, testId = 'lista.limpar-filtros' })`. As 14 telas usam `<LimparFiltros ligado={…} onLimpar={…} testId="<tela>.limpar-filtros" />`, e o Core apaga a cópia de `lista-bko.tsx` |
| Dono | modulo-core e modulo-catalogo (designer-ux, se for para o kit) |

| Campo | RD-0418 |
|---|---|
| Onde | `modules/core/web/docs/prints/bko-revisao/antes/` × `depois/`: `filiais`, `fotos-pdv`, `motivos`, `preco-e-custo`, `recados` e `visitas` (`-1366x768.png`) |
| Tipo | doc |
| O que se repete | Nos 6 pares, o "antes" e o "depois" são o mesmo arquivo, byte a byte (mesmo MD5). O "antes" não é o `main`. No `main`, Visitas tem o subtítulo "Check-ins e checkouts da equipe. As fora do raio…" (`visitas-page.tsx:85`). O print "antes" já mostra "Visitas · 12" e o "⋯", que só existem depois do `ae798c8a` |
| Impacto | leitura: 6 arquivos repetidos, e a comparação antes/depois que a §P11 pede para o corretor e a marca não existe nessas 6 telas |
| Severidade | média (doc que engana; segura) |
| Proposta | Gerar os 6 "antes" de novo a partir do `origin/main`, com os mesmos dados. Se uma tela não mudou mesmo, apagar o par e dizer no PR "sem mudança visual: <tela>" |
| Dono | modulo-core |

| Campo | RD-0419 |
|---|---|
| Onde | BKO › Indicadores, coluna "Necessidade diária" (`modules/core/web/lib/indicadores.ts:25`, `textoNecessidadeDiaria` de `app/lib/metas-formato.ts:33`) |
| Tipo | texto |
| O que se repete | Cada linha repete a frase inteira: "Precisa de R$ 3.125 por dia útil (12 restantes)." Nas 6 linhas aparecem "Precisa de", "por dia útil" e "(12 restantes)", e os 12 dias úteis são os mesmos para todos. Depois da revisão, a coluna ficou estreita e trunca o título ("Necessidade…") e o valor ("Precisa de R…"), e o número que guia a ação some (no "antes" cabia) |
| Impacto | leitura e decisão: o valor por dia não aparece sem passar o mouse |
| Severidade | média (polui e esconde o número; segura) |
| Proposta | Só no BKO (o app continua com a frase de `metas-formato.ts`): título da coluna `` `Por dia útil (${dias} restantes)` ``, que vem do primeiro item. A célula traz só o valor ("R$ 3.125"), ou "Batida" quando a meta foi atingida, ou "—" sem meta. O CSV pode manter a frase longa |
| Dono | modulo-core |

| Campo | RD-0420 |
|---|---|
| Onde | BKO › Indicadores: botão principal "Definir meta de venda" e gaveta (`indicadores-page.tsx:84-90` e o `Drawer`, `PUT /core/metas/:usuario/:periodo` com `venda_cents`) × BKO › Metas e RV: "Editar" na linha "Vendas · Faturamento" de cada pessoa |
| Tipo | layout |
| O que se repete | A mesma ação, definir a meta de venda da pessoa no mês, tem dois lugares em duas telas vizinhas do grupo Análise. A revisão subiu a de Indicadores para botão principal do cabeçalho |
| Impacto | toques e manutenção: duas gavetas e dois textos de erro para o mesmo `PUT`. Leitura: em Indicadores, o botão principal é de cadastro numa tela de análise |
| Severidade | média (uma informação, um lugar; segura) |
| Proposta | Tirar de Indicadores o botão "Definir meta de venda", a gaveta e o `useMutation` `salvar`. A meta se define só em Metas e RV. Se o dono do produto quiser o atalho, que seja o item "Metas do mês" no "⋯", levando para `/metas?periodo=…`, sem uma segunda gaveta |
| Dono | modulo-core |

| Campo | RD-0421 |
|---|---|
| Onde | BKO › Rotas, cartões do topo (print `depois/rotas-1366x768.png`): "Visitas planejadas 24 · média de 4 por rota", "Visitadas 8 · 33% do planejado", "Em atendimento 0", "Pendentes 16" |
| Tipo | indicador |
| O que se repete | O mesmo fato (quanto da rota do dia foi feito) aparece em 4 representações em 3 cartões: o total planejado, as visitadas, o % e as pendentes. As pendentes são a conta 24 − 8 − 0, e a lista da direita já dá "N feitas · N pend." por pessoa |
| Impacto | leitura: 3 cartões para uma decisão, contra o limite de 2 representações (número + barra ou %) |
| Severidade | média (polui; segura) |
| Proposta | Juntar em um cartão: "Visitadas" com "8 de 24" e a linha "33%". Saem os cartões "Visitas planejadas" e "Pendentes". Ficam "Visitadas", "Em atendimento" e "Km total" |
| Dono | modulo-core |

| Campo | RD-0422 |
|---|---|
| Onde | BKO › Visitas, coluna Check-in (`visitas-page.tsx:85`, largura 120 px), e BKO › Coordenadas sugeridas, coluna Check-in (data, hora e nome na mesma célula) |
| Tipo | texto |
| O que se repete | O ano "2026" se repete em todas as linhas, e o filtro De/Até já fixa o período. Por causa dele, a hora some ("14/11/2026, 0…") e o nome é cortado ("12/11/2026, 09:45 · Raimu…") |
| Impacto | leitura: a hora do check-in só aparece passando o mouse |
| Severidade | baixa (código de produção: segura) |
| Proposta | Usar o `formatDateTime(iso, fuso)` do kit ("14/11 às 09:12"), que cabe nos 120 px. Em Coordenadas, o nome do vendedor vai para a linha de baixo da célula ou para uma coluna própria |
| Dono | modulo-core |

### Para o testes (sem RD)
- Cliente 360: "Última compra" aparece como "2026-11-10" (ISO), e o resto do BKO usa dd/mm/aaaa.
- Carteira: o select de Frequência corta "A cada 2 semanas" e "A cada 4 semanas".
- A §P11 pede print antes/depois de toda tela, e Tarefas e Calendário (mudaram no `ae798c8a` e no `8f01c1d0`) não têm.

**Parecer do lote 14: segura (RD-0416, RD-0418, RD-0419, RD-0420 e RD-0421, média; RD-0417 e RD-0422, baixa em código).**

---

## Lote 15: `nuvem/bko-revisao-modulo-catalogo` @ `5df48729` (T-0173 do Catálogo)

Lido o commit `5df48729` (9 arquivos). O que passa:
- a exportação virou dois itens do "⋯" ("Catálogo em PDF" e "Catálogo em Excel"), e saíram o painel e o select de
  sistema;
- cada estado vazio tem uma frase;
- "Limpar filtros" só aparece com filtro ligado (`filtrosMarcasLigados`, `filtrosTabelasLigados`, com teste);
- a vigência cabe numa célula (`textoVigencia`).

**O branch não traz prints.** O parecer é só de código e texto, e o de tela fica pendente até os prints 1366×768
antes/depois que a §P11 pede.

### Achados
RD-0416 e RD-0417 (lote 14) também valem aqui: `web/lib/busca-com-espera.ts` e as 4 cópias do botão "Limpar filtros".

| Campo | RD-0423 |
|---|---|
| Onde | `modules/catalogo/web/pages/catalogo-page.tsx:207`, `marcas-page.tsx:140`, `tabelas-preco-page.tsx:117` e `:265` |
| Tipo | código |
| O que se repete | `rotulo="Mais ações"` foi passado 4 vezes, e esse já é o padrão do `MenuAcoes` (`packages/ui/src/web/menu-acoes.tsx:31`, `rotulo = 'Mais ações'`) |
| Impacto | manutenção: se o kit trocar o rótulo, o Catálogo fica com o antigo |
| Severidade | baixa (código de produção: segura) |
| Proposta | Tirar a prop: `<MenuAcoes acoes={acoesPagina} />` (e o mesmo nos outros 3) |
| Dono | modulo-catalogo |

### Para o testes e o gerente (sem RD)
- Sem prints antes/depois (§P11): o parecer de tela do Catálogo ainda não foi dado.

**Parecer do lote 15: segura (RD-0416, média; RD-0417 e RD-0423, baixa em código).**

---

## Lote 16: `nuvem/chave-conector-modulo-integracao` @ `3352c984` (chave pública macuxi-2026)

Lidos `apps/conector/src/atualizacao/chaves.ts`, `scripts/pacote.mjs` e `test/atualizacao/chaves.test.ts`.
- A chave entra numa entrada só do mapa, e o comentário foi atualizado (sai o "VAZIO DE PROPÓSITO").
- O `CHAVE_PUBLICA_ID = 'macuxi-2026'` de `pacote.mjs` repete o id do mapa de `chaves.ts`. O script `.mjs` não importa
  o `.ts` em tempo de execução, então a cópia é necessária: `manter?`. Sugestão: um teste que confira
  `CHAVE_PUBLICA_ID in CHAVES_PUBLICAS_PACOTE`, para a rotação não esquecer um dos dois.

| Campo | RD-0424 |
|---|---|
| Onde | `apps/conector/test/atualizacao/chaves.test.ts`: 2º caso ("com um par de teste RSA 3072: aceita a assinatura certa e recusa a adulterada e a de outra chave") e 4º ("id desconhecido continua recusado") × `test/atualizacao/assinatura.test.ts:19-49` e `:51-71` |
| Tipo | teste |
| O que se repete | O 2º caso repete três casos de `assinatura.test.ts`: o RSA 3072 aceito, a outra chave dando `assinatura_invalida` e o adulterado dando `sha256_diferente`. O 4º repete o `chave_desconhecida` (`chave_publica_id: 'outra'`). Nenhum dos dois usa a chave `macuxi-2026` |
| Impacto | manutenção: o mesmo caso em dois arquivos |
| Severidade | baixa: só teste, **não segura** (R-20261111-190159); entra no lote seguinte |
| Proposta | Apagar o 2º e o 4º casos. Ficam o 1º (a chave carrega como RSA ≥ 3072) e o 3º (pacote de outro par anunciado como `macuxi-2026` é recusado), que são os únicos sobre a chave nova |
| Dono | modulo-integracao |

**Parecer do lote 16: sem achado que segure (RD-0424 é só teste).**

---

## Encaminhados ao testes na parte 2 (sem RD)
- Lote 13: o corpo da gaveta de Usuários aparece abaixo do rodapé fixo nos prints 1366×768 (`Drawer` do kit).
- Lote 14: "Última compra" em ISO no Cliente 360. O select de Frequência da Carteira corta o texto. Tarefas e
  Calendário estão sem print.
- Lote 15: o branch está sem prints (§P11).

Os recados não saíram (caixa 403). Ficam pendentes para quando a caixa voltar.

---
# Lote da noite, parte 3: reteste dos RD corrigidos (15/11/2026)

Antes desta parte, o `origin/main` (03926f1c, #295) foi mesclado no branch do corretor, sem rebase. Para cada lote foram
lidos dois diffs: `git diff origin/main...origin/<branch>`, o lote inteiro, e `git diff <SHA da parte 1>..<head>`, a
correção. Nenhum head passou do SHA pedido. O `nuvem/acesso-bko-modulo-core` (PR #250) continua em `1ecb5fce`: a correção
do timer no lint ainda não chegou ao remoto. A numeração continua no RD-0425. O `coord.mjs` continua com 403, então o pedido
vale por este relatório e pelo catálogo.

Também foi conferido se as correções de branches diferentes conversam entre si. O `git merge-tree` entre os lotes 9 e 10
dá conflito *add/add* em `apps/api/src/portal-comum.ts` e em `apps/api/test/portal-comum.test.ts`, e conflito de conteúdo
em `app.ts` (RD-0428). Entre os dois branches de empresa-acoes há uma terceira tabela de frases (RD-0429).

## Resumo da parte 3

| # | Branch | SHA lido (parte 1 → agora) | Parecer | RD retestados | RD novos (gravidade, dono) |
|---|---|---|---|---|---|
| 1 | `nuvem/inicio-cabecalho-modulo-core` | `6f04e77e` → `e0ac4444` | **sem achado que segure** | RD-0399 **corrigido** no Core (itens 1 e 2; item 3 do lado do Core). A parte do shell fica com o engenheiro-apps depois do merge | RD-0425 baixa, só comentário, não segura (modulo-core) |
| 2 | `nuvem/kit-thathyany-modulo-integracao` | `1783f3a1` → `65154ee8` | **segura** | RD-0400, RD-0401 e RD-0402 **corrigidos** | RD-0426 baixa, texto do kit (modulo-integracao) |
| 3 | `nuvem/bko-revisao-modulo-vendedor` | `1a151258` → `540196f5` | **sem achado em aberto** | RD-0408 **corrigido** | — |
| 4 | `nuvem/bko-revisao-modulo-integracao` | `d42516c9` → `49558a3f` | **sem achado em aberto** | RD-0409 e RD-0410 **corrigidos** | — |
| 5 | `nuvem/bko-revisao-modulo-pesquisa` | `bf81b42b` → `f7a0b2fe` | **sem achado em aberto** | RD-0411 **corrigido** | — |
| 6 | `nuvem/bko-revisao-modulo-promotor` | `e4d71be3` → `e7e84ffa` | **sem achado em aberto** | RD-0412 **corrigido** | — |
| 7 | `nuvem/bko-revisao-modulo-treinamento` | `0d9178c2` → `d5b5f523` | **segura** | RD-0413 **corrigido** | RD-0427 baixa, código de produção (modulo-treinamento) |
| 8 | `nuvem/email-senha-engenheiro-software` | `d679a1a7` → `da106be2` | **sem achado em aberto** | RD-0403 **corrigido** | — |
| 9 | `nuvem/rodape-legal-engenheiro-software` | `a9965d78` → `788cc483` | **segura** | RD-0404 **corrigido**; RD-0405 **corrigido** (itens 1 a 4) | RD-0428 média (engenheiro-software) |
| 10 | `nuvem/empresa-acoes-engenheiro-software` | `71ea347f` → `b9e9c577` | **segura** | RD-0405 **corrigido** (itens 1 a 5); RD-0406 **em correção** (SDK e API feitos, falta o Core); RD-0407 **corrigido** (API e SDK) | RD-0428 média (engenheiro-software) |
| 11 | `nuvem/empresa-acoes-engenheiro-apps` | `3dec04a5` → `d807bcf0` | **segura** | RD-0407 **corrigido** no `erroDoExcluir` | RD-0429 média (engenheiro-apps) |
| 13 | `nuvem/acesso-bko-modulo-core` (PR #250) | `1ecb5fce` (sem SHA novo) | **segura** (como na parte 2) | RD-0414 e RD-0415 continuam **abertos** | — |

---

## Lote 1: `nuvem/inicio-cabecalho-modulo-core` @ `e0ac4444` (lido na parte 1 em `6f04e77e`)

A correção está no commit `e0ac4444`. O `cfe3efbf` só mescla o `main` (#293, CI).

### Reteste do RD-0399: **corrigido no Core**
1. `painelAltura` saiu da interface, do `Omit` de `tamanhosParaFator` e do retorno de `escalaInicio`. O teste da variação C
   chama `alturaDoPainel(tamanhosParaFator(e.fator, 1, KIT), …)` direto (`escala-inicio.test.ts:58`).
2. `telas/inicio/index.ts:4` ficou só com `definirResolvedorFotoPerfil` e `ResolvedorFotoPerfil`.
3. Lado do Core: `modules/core/app/index.ts:27` exporta `ENTIDADE_USUARIO_AVATAR`. O shell ainda tem
   `ENTIDADE_AVATAR = 'usuario_avatar'` (`apps/mobile/src/lib/sync-t0170.ts:25`, também no `main`). O shell só consegue
   importar a constante do Core depois do merge deste lote, então essa parte **não segura o lote do Core**. Fica em aberto
   com o engenheiro-apps para o lote seguinte: `import { ENTIDADE_USUARIO_AVATAR } from '@macuxi/core/app'` no lugar de
   `ENTIDADE_AVATAR` (l.25, 32 e 58).

### Achado novo

| Campo | RD-0425 |
|---|---|
| Onde | `modules/core/app/telas/inicio/escala-inicio.ts:51` |
| Tipo | código (comentário) |
| O que se repete | O campo saiu, mas o JSDoc dele ficou: "/** Altura do painel sem a área segura: respiro de cima + max(foto, textos) + respiro de baixo, em dp. */". Agora ele está em cima de `fonte:` e descreve o campo errado |
| Impacto | manutenção: o comentário diz que `fonte` é uma altura |
| Severidade | baixa. Está **só em comentário**, então **não segura** (R-20261111-190159) e entra no lote seguinte |
| Proposta | Apagar a l.51. A descrição já está no JSDoc de `alturaDoPainel` |
| Dono | modulo-core |

**Parecer do lote 1: sem achado que segure (RD-0425 só em comentário; o item 3 do RD-0399 fica com o engenheiro-apps).**

---

## Lote 2: `nuvem/kit-thathyany-modulo-integracao` @ `65154ee8` (lido na parte 1 em `1783f3a1`)

### Retestes
| RD | Reteste | Status |
|---|---|---|
| RD-0400 | Saíram as l.14-15 de "O que ter em mãos". "(ela aparece uma vez só)" foi para o passo 1 da Fase 1 (l.21). O teste já não espera chave nem "Baixar o Conector" nessa seção | **corrigido** |
| RD-0401 | l.35: "… Corrija o CSV e rode de novo." l.58: "Quando pedir, cole a chave nova." l.59 terminou em "… aparece no Backoffice." `carga_csv.py:447`: "Recusadas (corrija o CSV e rode de novo):". O espaço duplo do `roteiro-ensaio-conector-1.4.0.md:36` saiu | **corrigido** |
| RD-0402 | O caso "chave gerada no portal, nunca 'no BKO'" já não confere `/demo/i`. O teste da l.68 continua cobrindo | **corrigido** |

### Achado novo
O lote também mudou a Fase 2, passo 1 (l.51), e o "Para voltar à fase 1" (l.65), porque o portal não tem o botão de
desativar o Conector.

| Campo | RD-0426 |
|---|---|
| Onde | `modules/integracao/kit-thathyany/ROTEIRO.md:51` e `:65`; `kit-thathyany.test.ts:160` |
| Tipo | texto |
| O que se repete | Explicação e funcionamento por trás (R-20261110-192153). Quem segue o roteiro só faz uma coisa: pedir ao gerente-projetos. l.51: "**o portal e o BKO não têm esse botão.** Peça ao gerente-projetos, **que desativa pela rota `PATCH /integracao/conectores/<id>` com `{"ativo": false}`**." l.65: "… desativar o `thathyany-api` **(a mesma rota)** …". A rota é para o gerente fazer, não para quem lê |
| Impacto | leitura: duas frases e um trecho técnico num passo que é só um pedido |
| Severidade | baixa. É texto do kit, então **segura** |
| Proposta | l.51: "1. **Desative o `thathyany-conector`:** peça ao gerente-projetos." l.65: "Para voltar à fase 1: peça ao gerente-projetos para reativar o `thathyany-conector` e desativar o `thathyany-api`, e rode `.\Instalar-Thathyany.ps1 -Fase Conector`." Teste da l.160: `` expect(ROTEIRO.slice(f2)).toMatch(/Desative o `thathyany-conector`:\*\* peça ao gerente-projetos/) ``. A rota fica no material do gerente, onde ela é usada |
| Dono | modulo-integracao |

Observação para o testes (funcional, não é RD): a Fase 2 depende de o gerente desativar o Conector por chamada à API. O
portal e o BKO não oferecem essa ação, e o ensaio da thathyany precisa desse passo.

**Parecer do lote 2: segura (RD-0426, baixa, texto do kit).**

---

## Lote 3: `nuvem/bko-revisao-modulo-vendedor` @ `540196f5` (lido na parte 1 em `1a151258`)

Reteste do RD-0408: **corrigido**.
1. `totalDoPeriodo` saiu de `domain/totais.ts` e o caso dela saiu de `totais.test.ts`. `STATUS_FORA_DO_TOTAL` continua,
   e `api/pedidos.ts:30` usa a constante.
2. `exportar-pdf.ts:6` tem `ERRO_IMPRESSAO(detalhe)`, e os dois lugares usam a função: o toast em `orders-page.tsx:70` e o
   `Notice` em `order-drawer.tsx:85`.

Nota sem RD (já estava no `main`, fora do que mudou): `quantidadeNaoCancelada` (`totais.ts:14`) também só tem uso no
teste. Vai para o próximo lote do modulo-vendedor, junto com a limpeza de `totais.ts`.

**Parecer do lote 3: sem achado em aberto.**

---

## Lote 4: `nuvem/bko-revisao-modulo-integracao` @ `49558a3f` (lido na parte 1 em `d42516c9`)

| RD | Reteste | Status |
|---|---|---|
| RD-0409 | O `onSuccess` com o toast saiu (`carga-arquivo-page.tsx:78`). Ficou a caixa: "**Recebido:** N linhas; M com erro de leitura. Resultado e erros em Integração ERP." Saíram "em X partes" e "(aparecem com a linha do arquivo)" | **corrigido** |
| RD-0410 | Ficaram os KPIs "Conectores no ar" (X de Y) e "Lotes com erro", os dois sem sub. Saiu o KPI "Pedidos presos ou retidos", e saiu o `badge` de críticos do `PageHeader` | **corrigido** |

**Parecer do lote 4: sem achado em aberto.**

---

## Lote 5: `nuvem/bko-revisao-modulo-pesquisa` @ `f7a0b2fe` (lido na parte 1 em `bf81b42b`)

Reteste do RD-0411: **corrigido**.
1. O diálogo de arquivar diz só "Some do app." (`construtor-page.tsx:165`).
2. "Respondentes" e "Taxa de resposta" só aparecem com `dados.tipo === 'versao'`. No consolidado ficam "Respostas" e
   "Suspeitas", e não há mais "—" nem "Escolha uma versão".

A observação da parte 1 para o testes ("Galeria de fotos · N" conta todas as fotos e desenha 60) continua valendo.

**Parecer do lote 5: sem achado em aberto.**

---

## Lote 6: `nuvem/bko-revisao-modulo-promotor` @ `e7e84ffa` (lido na parte 1 em `e4d71be3`)

Reteste do RD-0412: **corrigido**.
1. O KPI "Share médio" ficou sem o sub (`trade-page.tsx:116`).
2. A legenda ficou "Etapas" (`cadastros-page.tsx:485`).

**Parecer do lote 6: sem achado em aberto.**

---

## Lote 7: `nuvem/bko-revisao-modulo-treinamento` @ `d5b5f523` (lido na parte 1 em `0d9178c2`)

Reteste do RD-0413: **corrigido**.
1. O `Notice` diz "Só leitura. Para mudar o conteúdo, arquive e crie uma nova trilha." ou "Só leitura." O selo do
   cabeçalho fica com o status.
2. O sub do KPI ficou "concluíram ao menos uma lição", e o rótulo ficou "Ativos".

O mesmo commit traz o MC-0065: o "Nova trilha" passou de `bg-ink` para `bg-accent`. Por ser mudança de cor, precisa da
validação do design-de-marca (definição de pronto). Fica anotado para o gerente.

### Achado novo

| Campo | RD-0427 |
|---|---|
| Onde | `modules/treinamento/web/pages/trilhas-page.tsx:91` × `:357`; `packages/ui/src/web/ui.tsx:264-275` (`Button`) |
| Tipo | código |
| O que se repete | O link "Nova trilha" está escrito **2×** com a mesma `className` longa (`inline-flex h-[42px] items-center gap-1.5 rounded-xl bg-accent px-4 text-[14px] font-semibold text-white no-underline hover:bg-accent/90`), e essa classe copia à mão o `Button` `primary` `md` do kit. O próprio MC-0065 mostra o custo: uma troca de cor precisou ser feita nas duas cópias |
| Impacto | manutenção: a próxima mudança do botão principal do kit não chega a esses dois links |
| Severidade | baixa. É código de produção, então **segura** |
| Proposta | No módulo: `function LinkNovaTrilha({ testId }: { testId?: string }) { return <Link href={hrefEditarTrilha()} data-testid={testId} className={CLASSE_LINK_PRINCIPAL}><IconPlus size={15} /> Nova trilha</Link>; }`, usado na l.91 (`testId="treinamento.nova-trilha"`) e na l.357. `CLASSE_LINK_PRINCIPAL` deve vir do kit: pedir ao designer-ux que exporte de `ui.tsx` a classe do `Button` (`classeDoBotao('primary', 'md')`), que serve também ao link de `construtor-page.tsx:134` da Pesquisa. Até o kit ter essa classe, uma constante local no módulo já tira a cópia |
| Dono | modulo-treinamento (classe do kit: designer-ux) |

**Parecer do lote 7: segura (RD-0427, baixa, código de produção).**

---

## Lote 8: `nuvem/email-senha-engenheiro-software` @ `da106be2` (lido na parte 1 em `d679a1a7`)

Reteste do RD-0403: **corrigido**. As Consequências do adendo da ADR 0032 terminam em "… e os dois PNG precisam estar
publicados." A frase "Sem isso, nada quebra…" saiu, e a falta da variável fica dita uma vez, na Decisão.

O 429 deste lote (`app.ts:789-796`) manda `retry-after` e `detalhes.retry_after_s`, no mesmo formato do
`recusarPorLimite` do lote 9. Os dois mexem nas mesmas linhas do `montarRotaPublica`. Quem fizer o merge do segundo fica
com `recusarPorLimite(reply, limitador.esperaSegundos(chave))`.

**Parecer do lote 8: sem achado em aberto.**

---

## Lote 9: `nuvem/rodape-legal-engenheiro-software` @ `788cc483` (lido na parte 1 em `a9965d78`)

### Retestes
| RD | Reteste | Status |
|---|---|---|
| RD-0404 | `limitador.ts:79-83` traz `recusarPorLimite(reply, esperaS)`, com o cabeçalho `retry-after` e `ErroHttp(429, 'MUITAS_TENTATIVAS', …, { retry_after_s })`. É o mesmo formato do lote 8 e do 429 do Core (`autenticacao.ts:161`). Usam a função `app.ts:806` (`montarRotaPublica`) e `dados-legais.ts:118`. O teste fica em `portal-comum.test.ts:73-80` | **corrigido** |
| RD-0405 | Este branch criou `apps/api/src/portal-comum.ts` com `exigirSuperAdmin`, `traduzirErroSa` e `conferirRetorno`, e `dados-legais.ts` passou a usar os três. Em `app.ts`, `autenticarDoPortal` é passado nas 5 rotas (itens 1 a 4). O item 5 (`config.ts`) é do lote 10. Os 4 arquivos antigos ficam para o lote seguinte, como a proposta previa | **corrigido** |

### Achado novo: RD-0428 (comum aos lotes 9 e 10)

| Campo | RD-0428 |
|---|---|
| Onde | `apps/api/src/portal-comum.ts` e `apps/api/test/portal-comum.test.ts` em `nuvem/rodape-legal-engenheiro-software` (788cc483) × os mesmos dois arquivos em `nuvem/empresa-acoes-engenheiro-software` (b9e9c577) |
| Tipo | código |
| O que se repete | Cada branch criou a **sua** versão do mesmo arquivo comum, que nasceu do RD-0405. As assinaturas não batem. (1) `exigirSuperAdmin(dep: AutenticacaoDoPortal, …)`, que recebe um objeto com `autenticar`, × `exigirSuperAdmin(autenticar: AutenticarPortal, …)`, que recebe a função, mais o `exigirPortal` só no lote 10. (2) `traduzirErroSa(e, extras?: (code: string \| null, hint: string \| null) => never \| void)`, com 22023 → 400 "Dados inválidos." comum, × `(code: string, hint: string) => void`, sem o 22023. (3) `conferirRetorno` devolve `z.infer` num e `z.output` no outro. Os testes são dois, com casos diferentes. `git merge-tree` dá conflito *add/add* nos dois arquivos e conflito em `app.ts` |
| Impacto | manutenção: depois do segundo merge sobra uma versão, e uma das rotas (`dados-legais.ts` ou `empresa-acoes-portal.ts`) quebra no typecheck ou muda de comportamento sem aviso |
| Severidade | média. Segura os lotes 9 e 10 |
| Proposta | Uma versão só, feita no branch que entra primeiro. O segundo **mescla esse branch** (merge, sem rebase) e adapta a sua rota. Versão sugerida: `export type AutenticarPortal = (req) => Promise<AcessoPortalAutenticado \| null>`; `exigirPortal(autenticar, req, tenantId)`, que o `consulta-cnpj` vai usar no lote dos antigos; `exigirSuperAdmin(autenticar, req, tenantId, mensagem403)`; `traduzirErroSa(e, extras?: (code: string, hint: string) => void)`, com 28000, 42501 e 22023 → 400 `VALIDACAO` "Dados inválidos." comuns (as duas rotas trocam o 22023 pelo `extras`); `conferirRetorno(...): z.output<S>`. Em `dados-legais.ts:131`: `exigirSuperAdminDoPortal(dep.autenticar, req, null, SO_A_MACUXI)`. Um teste só, com a união dos casos (o 401 sem marca do lote 9, o `exigirPortal` do lote 10 e o `recusarPorLimite`) |
| Dono | engenheiro-software |

**Parecer do lote 9: segura (RD-0428, média).**

---

## Lote 10: `nuvem/empresa-acoes-engenheiro-software` @ `b9e9c577` (lido na parte 1 em `71ea347f`)

### Retestes
| RD | Reteste | Status |
|---|---|---|
| RD-0405 | `empresa-acoes-portal.ts` usa `exigirSuperAdmin`, `traduzirErroSa` (só os casos próprios no `extras`: P0002, 55000, 22023 com hint, 23505) e `conferirRetorno`. `app.ts` usa `autenticarDoPortal` 5×. `config.ts` tem `ligado(env, nome)` nas 4 flags (item 5) | **corrigido** (a versão do comum diverge da do lote 9: RD-0428) |
| RD-0406 | A função foi para `packages/platform-sdk/src/tentativas-portal.ts`, pelo subcaminho `@macuxi/platform-sdk/tentativas-portal` (sem `node:crypto` no index). A API importa dali, e o teste do valor fixo está no SDK. Falta a outra metade: o Core ainda tem a sua `chaveDeTentativa` (`modules/core/api/seguranca-plataforma.ts:29-30`), usada em `super-admin.ts:109`. A conta continua em dois lugares, SDK e Core. O Core só consegue importar depois do merge deste lote, então a parte dele **não segura o lote 10** | **em correção**: falta o modulo-core trocar `chaveDeTentativa` pelo `chaveDeTentativaDoPortal` do SDK (a normalização fica no SDK, e `super-admin.ts:109` passa o e-mail como vem) |
| RD-0407 | `MENSAGENS_ACOES_EMPRESA` no SDK (`empresa-acoes.ts:67-82`), com o texto da §15.2. A API usa `erroDaAcao(status, codigo)` em todas as recusas, e a tabela `MENSAGENS` saiu. O teste do SDK confere que cada código tem uma frase | **corrigido** (lado da API e do SDK) |

O RD-0428 vale para este branch também.
**Parecer do lote 10: segura (RD-0428, média).**

---

## Lote 11: `nuvem/empresa-acoes-engenheiro-apps` @ `d807bcf0` (lido na parte 1 em `3dec04a5`)

O branch mesclou o `71ea347f` do engenheiro-software, mas não o `b9e9c577`, que traz a tabela do SDK.

Reteste do RD-0407 na tela: **corrigido**. `erroDoExcluir` (`portal-empresa-acoes.ts:116-133`) não tem mais frases: mostra
`mensagemDoErro(e)` (a frase da API) e decide só entre linha e bloco e se marca o campo senha (`RECUSAS_EM_LINHA`). O
`MOTIVO_DO_BLOQUEIO` da coluna fica, como a proposta previa.

### Achado novo

| Campo | RD-0429 |
|---|---|
| Onde | `apps/web/lib/portal-falso.ts:196-210` (`MENSAGENS_DA_API`, `fraseDaApi`) × `packages/platform-sdk/src/empresa-acoes.ts:67-82` (`MENSAGENS_ACOES_EMPRESA`, lote 10) |
| Tipo | texto · código |
| O que se repete | Para o modo falso, o lote criou **uma terceira tabela** das frases de recusa, copiada da `MENSAGENS` antiga da API, que o lote 10 apagou. As frases já não batem com a tabela do SDK: "Faça o backup da empresa antes de excluir." × "Faça o backup antes de excluir."; "O código digitado não é o da empresa." × "Código não confere."; "A senha não confere." × "Senha incorreta."; "A exclusão desta empresa já está em andamento." igual. O comentário já diz: "Sai quando o SDK tiver `MENSAGENS_ACOES_EMPRESA` (RD-0407)". O SDK já tem, no branch irmão. O teste `empresas-acoes.test.tsx:131-135` fixa "A senha não confere." |
| Impacto | manutenção e leitura: o modo falso e a API real mostram frases diferentes para a mesma recusa, e a tabela volta a ficar em dois lugares |
| Severidade | média. Segura o lote 11 |
| Proposta | Mesclar `nuvem/empresa-acoes-engenheiro-software` (merge, sem rebase). Apagar `MENSAGENS_DA_API` e trocar `fraseDaApi(c)` por `MENSAGENS_ACOES_EMPRESA[c]`, importado de `@macuxi/platform-sdk`. Os códigos já são `CodigoAcaoEmpresa`, então o `?? 'Ação recusada.'` sai. No teste do diálogo: `texto: MENSAGENS_ACOES_EMPRESA[C.reautenticacaoFalhou]` |
| Dono | engenheiro-apps |

**Parecer do lote 11: segura (RD-0429, média).**

---

## PR #250: `nuvem/acesso-bko-modulo-core`
O head no remoto continua `1ecb5fce`, o mesmo lido na parte 2. A correção do timer no lint ainda não foi enviada.
**RD-0414 e RD-0415 continuam abertos**, e o PR continua segurado. O reteste fica para quando chegar o SHA novo.

---

## Para o testes (sem RD)
- Lote 2 (kit): a Fase 2 depende de o gerente desativar o `thathyany-conector` com `PATCH /integracao/conectores/<id>`.
  O portal e o BKO não têm essa ação.
- Lote 1 (Início): continua sem chamador o `definirResolvedorFotoPerfil` (anotado na parte 1).
- Lote 5 (Pesquisa): "Galeria de fotos · N" conta todas as fotos e desenha 60 (anotado na parte 1).

## Para o gerente
- Lote 7: o MC-0065 muda a cor do "Nova trilha" e precisa da validação do design-de-marca antes do lote.
- Merge dos lotes 8, 9 e 10: os três mexem no `montarRotaPublica` e no bloco do portal em `app.ts`. A ordem que menos
  conflita é 9 → 10 (resolvendo o RD-0428) → 8 (o 8 fica com `recusarPorLimite`).

---

# Lote da noite, parte 4 (14/11/2026, ~23h de Manaus)

Base: `main` em `551ebd0d`, mesclado no branch do corretor (merge, sem rebase). Em todos os lotes, o head no remoto é o SHA
pedido; nenhum avançou. Os retestes leram o diff entre o SHA da parte anterior e o head novo. A numeração segue a partir
do RD-0430. O `coord.mjs` continua com HTTP 403: os pedidos aos donos (cc `gerente-projetos`) ficam neste relatório e no
catálogo até a caixa voltar.

## Resumo da parte 4

| # | Branch | SHA lido | Parecer | RD retestados | RD novos (gravidade, dono) |
|---|---|---|---|---|---|
| 1 | `nuvem/login-v109-modulo-core` | `7ed7b240` | **segura** | — | RD-0430 baixa, texto e código (modulo-core; regex da CLI: engenheiro-software); RD-0431 baixa, código (modulo-core); RD-0432 baixa, só teste, não segura (modulo-core) |
| 2 | `agente/engenheiro-apps-login-v109` | `0e3292de` (contra o item 1) | **sem achado em aberto** | — | — (o web usa `validarLogin` e `CODIGO_EMPRESA_TAMANHO` do Core, sem regra própria) |
| 3a | `nuvem/rodape-shell-engenheiro-apps` | `155bc0d4` | **segura** | RD-0417 ampliado (Auditoria) | RD-0433 média, código (engenheiro-apps; kit: designer-ux); RD-0434 média, texto (engenheiro-apps); RD-0435 baixa, código (engenheiro-apps); RD-0436 baixa, código do Core, não segura o shell (modulo-core) |
| 3b | `nuvem/rodape-legal-engenheiro-software` | `788cc483` → `16e6eb4a` | **sem achado em aberto neste branch** | RD-0428 **em correção**: o rodapé fez a parte dele; falta o branch das ações da empresa | — |
| 4 | `nuvem/kit-thathyany-modulo-integracao` | `65154ee8` → `665c5c06` | **sem achado em aberto** | RD-0426 **corrigido** | — |
| 5 | `nuvem/bko-revisao-modulo-treinamento` | `d5b5f523` → `1d1436eb` | **segura** | RD-0427 **corrigido**; RD-0416 ampliado (5ª cópia) | RD-0437 baixa, código (modulo-treinamento; pesquisa e promotor no próximo lote) |
| 6 | `nuvem/bko-revisao-modulo-core` | `0c276eb5` → `6bf52819` | **segura** | RD-0418 **corrigido**; RD-0416, RD-0417, RD-0419, RD-0420, RD-0421 e RD-0422 continuam **abertos** | — |
| 7 | `nuvem/bko-revisao-modulo-catalogo` | `5df48729` → `a058713b` | **segura** | RD-0416, RD-0417 e RD-0423 continuam **abertos** | RD-0438 baixa, texto; RD-0439 média, texto (modulo-catalogo) |
| 8 | `nuvem/acesso-bko-modulo-core` (PR #250) | `1ecb5fce` → `2ff1f685` | **sem achado em aberto** | RD-0414 e RD-0415 **corrigidos** | — |
| 9 | `nuvem/logo-cliente-designer-ux` | `184319e4` → `64a18b97` | **segura** | — | RD-0440 baixa, doc (designer-ux) |

---

## Lote 1: `nuvem/login-v109-modulo-core` @ `7ed7b240` (login da v1.0.9)

Lido o commit `7ed7b240` (14 arquivos). A D-01 é o defeito de `docs/testes/esqueci-senha-r20261114.md` (branch
`nuvem/esqueci-senha-testes`): dois pedidos juntos no "Esqueci a senha" geravam duas senhas.

O que passa:
- **D-01:** `usuarioPorEmail(email, { travar: true })` acrescenta `for update` dentro do mesmo `comTenant`. É uma opção
  na função que já existe, sem consulta nova. O teste novo (`esqueci-travar.test.ts`) cobre a chamada e o SQL.
- **Campo UF+4:** `propsDoCampoCodigoEmpresa` (app) serve ao login e ao Esqueci, com `CODIGO_EMPRESA_TAMANHO` do contrato.
- **Senha sem espaço nas pontas:** a frase é a constante única `MENSAGEM_SENHA_ESPACO_NAS_PONTAS`, usada pela criação, pela
  troca e pelo aviso do login.

| Campo | RD-0430 |
|---|---|
| Onde | `modules/core/contracts/auth.ts:26-33` (`CODIGO_EMPRESA_REGEX`, `CodigoEmpresaFormatoSchema`) × `contracts/ciclo-senha.ts:146-152` (`erroDoCodigoEmpresa`); `apps/api/src/cli/codigo-licenca.ts:78` (`CODIGO_LICENCA`) |
| Tipo | texto · código |
| O que se repete | (1) Quatro frases para o mesmo erro do código. O schema traz "Use duas letras da UF e quatro números, como AM4821.", que nenhuma tela mostra (só se usa o `.success`). `erroDoCodigoEmpresa` escreve outras três: "O código da empresa tem 6 caracteres…", "O código da empresa tem no máximo 6 caracteres…" e "O código da empresa tem duas letras da UF e quatro números, como AM4821…". As duas primeiras se contradizem ("tem 6" × "no máximo 6"), e a ação das três é a mesma: conferir no e-mail e digitar de novo. (2) O `.length(6)` repete o que a regex já exige, porque UF + 4 dígitos sempre tem 6. (3) A regex UF+4 está escrita 2×: `CODIGO_EMPRESA_REGEX` (contrato, com `i`) e `CODIGO_LICENCA` da CLI da API (sem `i`). `CODIGO_EMPRESA_REGEX` é exportada sem uso fora de `auth.ts` |
| Impacto | leitura: a pessoa recebe frases diferentes para o mesmo erro. Manutenção: a frase do schema fica morta, e a regra do código da licença vive em dois lugares |
| Severidade | baixa. É texto de tela e código de produção, então **segura** |
| Proposta | Uma frase só, no schema: `export const MENSAGEM_CODIGO_EMPRESA = 'O código da empresa tem duas letras da UF e quatro números, como AM4821. Confira no e-mail e digite de novo.';` e `CodigoEmpresaFormatoSchema = z.string().trim().regex(CODIGO_EMPRESA_REGEX, MENSAGEM_CODIGO_EMPRESA)`, sem o `.length`. `erroDoCodigoEmpresa(v) => CodigoEmpresaFormatoSchema.safeParse(v).success ? null : MENSAGEM_CODIGO_EMPRESA`. A regex sem flag fica num lugar só: a CLI importa a do contrato (`new RegExp(CODIGO_EMPRESA_REGEX.source)`, para continuar exigindo maiúsculas) ou as duas importam do SDK. Os testes de `login.test.ts` passam a esperar a frase única |
| Dono | modulo-core (regex da CLI: engenheiro-software) |

| Campo | RD-0431 |
|---|---|
| Onde | `modules/core/contracts/senha-regra.ts:27` (`senha !== senha.trim()` em `faltasNaSenha`) × `contracts/ciclo-senha.ts:172` (`c.senha !== c.senha.trim()` em `validarLogin`) |
| Tipo | código |
| O que se repete | A regra nova do espaço nas pontas está escrita 2× no contrato |
| Impacto | manutenção: se a regra mudar (por exemplo, tabulação), o login e a criação ficam diferentes |
| Severidade | baixa. É código de produção, então **segura** |
| Proposta | Em `senha-regra.ts`: `export const temEspacoNasPontas = (s: string): boolean => s !== s.trim();`, usado por `faltasNaSenha` e por `validarLogin` (`else if (temEspacoNasPontas(c.senha)) erros.senha = MENSAGEM_SENHA_ESPACO_NAS_PONTAS;`). O comentário do topo de `senha-regra.ts` ("O login aceita qualquer senha já gravada") precisa bater com a decisão: ver a observação 1 para o testes |
| Dono | modulo-core |

| Campo | RD-0432 |
|---|---|
| Onde | `modules/core/domain/senha.test.ts`: o caso "não há trim (espaços do meio contam no tamanho; nas pontas invalidam)" × o `describe` novo "espaço no começo ou no fim invalida a senha" |
| Tipo | teste |
| O que se repete | O caso antigo passou a conferir `faltasNaSenha('  a1!   ')` → `['espaco']` e `'a  1!   b'` → `[]`. O `describe` novo confere o mesmo, com `' Abcdef1!'` → `['espaco']` e `'Abc def1!'` → `[]` |
| Impacto | manutenção: dois lugares para a mesma regra no mesmo arquivo |
| Severidade | baixa. Está **só em teste**, então **não segura** (R-20261111-190159) e entra no lote seguinte |
| Proposta | Voltar o caso antigo ao que ele cobre (espaço no meio conta no tamanho: `faltasNaSenha('a  1!   b')` → `[]`) e deixar o espaço nas pontas só no `describe` novo |
| Dono | modulo-core |

**Parecer do lote 1: segura (RD-0430 e RD-0431, baixa; RD-0432 só em teste, não segura).**

---

## Lote 2: `agente/engenheiro-apps-login-v109` @ `0e3292de` (web, sobre o item 1)

Lido `git diff origin/nuvem/login-v109-modulo-core...origin/agente/engenheiro-apps-login-v109` (5 arquivos):
- O BKO não repete nenhuma regra. O login usa `validarLogin` do Core (com o UF+4 e o espaço nas pontas), e o Esqueci usa
  `validarEsqueci` do Core. O `maxLength` dos dois campos vem de `CODIGO_EMPRESA_TAMANHO` do contrato.
- O app usa o objeto `propsDoCampoCodigoEmpresa`, e o web passa só o `maxLength`. As props do celular (`autoCapitalize`,
  `autoCorrect`) não se aplicam igual no navegador, e o número vem do mesmo lugar: `manter`.
- Os testes do web mudaram só os dados de exemplo (`alfa` → `AM4821`). O caso novo de `validarCampos('alfa')` confere a
  integração da tela com o Core, e não a regra: `manter`.

**Parecer do lote 2: sem achado em aberto.**

---

## Lote 3a: `nuvem/rodape-shell-engenheiro-apps` @ `155bc0d4` (rodapé legal nas telas Entrar e T-0173 do shell)

Lidos os commits `a3b5b1c1` (rodapé) e `155bc0d4` (Auditoria e Início), contra `docs/design/telas/rodape-legal.md` e
`bko-revisao.md`. O branch mesclou a rota em `788cc483`, e não em `16e6eb4a`. **Não há prints** do shell (nem antes/depois da
§P11 para Auditoria e Início).

O que passa:
- O rodapé substitui a frase da variante ("Macuxi Campo · vendedores e promotores") e não repete o nome do produto.
- No BKO, a linha "Vendedores e promotores usam…" fica, como a spec pede (é ação).
- Razão social, CNPJ e site vêm da rota pública, sem constante no código. O site padrão e as funções `normalizarSite` e
  `siteValido` vêm do SDK.
- O rodapé some com o teclado aberto.
- Início sem subtítulo nem eyebrow, com o `EstadoVazio` uma vez. `later-page.tsx`, que não tinha uso, saiu.

| Campo | RD-0433 |
|---|---|
| Onde | `apps/mobile/src/lib/rodape-legal.ts` × `apps/web/lib/rodape-legal.ts` (mais `apps/mobile/src/lib/rodape-legal.test.ts` e os casos de linhas de `apps/web/components/rodape-legal.test.tsx`); `mascaraCnpj` nos dois × `formatarDocumento` de `@macuxi/comum/documento` |
| Tipo | código |
| O que se repete | (1) A montagem das linhas (`linhasDoRodapeLegal`, `siteDoRodape`, `mascaraCnpj`, `DadosDoRodape`) foi escrita 2×, igual linha a linha. Só o comentário muda, e ele mesmo diz "hoje há uma cópia igual". A spec põe essa função no kit (`packages/ui/src/comum/legal.ts`, §5, designer-ux). (2) `mascaraCnpj` reimplementa o `formatarDocumento` que já está em `packages/comum` |
| Impacto | manutenção: o texto legal ("© ano · Todos os direitos reservados", "Versão X") muda em dois lugares e pode divergir entre o celular e o BKO |
| Severidade | média (código de produção copiado entre shells; segura) |
| Proposta | Uma cópia só. O designer-ux cria `packages/ui/src/comum/legal.ts` com o conteúdo de `apps/web/lib/rodape-legal.ts`, trocando o `mascaraCnpj` por `formatarDocumento(digitos)` de `@macuxi/comum/documento` (o kit não importa o SDK: `siteDoRodape` recebe o site já normalizado, ou o padrão entra por parâmetro). Os dois shells importam de `@macuxi/ui/comum` e apagam os seus `rodape-legal.ts` e o teste das linhas. Se o kit não entrar neste lote, o engenheiro-apps põe a função num lugar só que os dois shells já importam e tira a cópia |
| Dono | engenheiro-apps (função no kit: designer-ux) |

| Campo | RD-0434 |
|---|---|
| Onde | `apps/web/components/audit/audit-page.tsx`: `<Panel label="Trilha de auditoria">` em volta da lista principal, debaixo do `h1` "Auditoria · 300+" |
| Tipo | texto |
| O que se repete | O quadro da lista principal tem título, e ele repete o `h1` ("Auditoria" × "Trilha de auditoria"). A §P6, regra 1 (RD-0364), pede: "O quadro da lista principal fica sem título: o `h1` já diz o que a lista é" |
| Impacto | leitura: dois títulos para a mesma lista |
| Severidade | média (contra a regra da spec; segura) |
| Proposta | `<Panel>` sem `label` (ou a `TabelaDados` direto, como nas outras listas revisadas). O `rotulo="Trilha de auditoria"` da `TabelaDados` fica, porque é o nome para o leitor de tela |
| Dono | engenheiro-apps |

| Campo | RD-0435 |
|---|---|
| Onde | `apps/web/components/audit/audit-page.tsx:36` (`export const LIMITE_AUDITORIA = 300`) × `apps/web/lib/queries.ts:108` (`limite: 300` no `useAuditoria`) |
| Tipo | código |
| O que se repete | O limite da página foi escrito 2×. O "300+" do título depende de os dois números serem iguais |
| Impacto | manutenção: se a consulta mudar para 500, o título mostra "300+" com 500 linhas |
| Severidade | baixa. É código de produção, então **segura** |
| Proposta | `export const LIMITE_AUDITORIA = 300` em `lib/queries.ts`, usado no `useAuditoria` (`limite: LIMITE_AUDITORIA`). A página importa de lá |
| Dono | engenheiro-apps |

O "Limpar filtros" da Auditoria também foi escrito à mão (`audit-page.tsx`, `auditoria.limpar-filtros`). Entra no
RD-0417, que fica ampliado ao shell: quando o `LimparFiltros` for para o kit, a Auditoria usa o dele.

| Campo | RD-0436 |
|---|---|
| Onde | `modules/core/app/components/tela-login.tsx:24`, `:31` e `:118` (prop `rodape` da `TelaLogin`) |
| Tipo | código |
| O que se repete | Depois deste lote, nenhum chamador passa `rodape` (o `login.tsx` do shell era o único). A prop e o `<Text>` ficam mortos, ao lado do rodapé legal novo |
| Impacto | manutenção: dois caminhos para "texto embaixo do login" |
| Severidade | baixa. É código do Core e só pode sair depois do merge deste lote, então **não segura o lote do shell** e entra no lote seguinte do modulo-core (pode ser o da v1.0.9, se este entrar antes) |
| Proposta | Apagar `rodape?: string` da interface, o `rodape` da desestruturação e a l.118 |
| Dono | modulo-core |

**Parecer do lote 3a: segura (RD-0433 e RD-0434, média; RD-0435, baixa em código; RD-0417 ampliado).** O rodapé é
layout novo nas quatro telas Entrar e precisa da validação do design-de-marca.

---

## Lote 3b: `nuvem/rodape-legal-engenheiro-software` @ `16e6eb4a` (reteste do RD-0428)

Lido o commit `16e6eb4a` sobre o `788cc483`. Há um `portal-comum.ts` só neste branch, com `AutenticarPortal` (função),
`exigirPortal`, `exigirSuperAdmin(autenticar, …)`, `traduzirErroSa(e, extras?: (code: string, hint: string) => void)` com
28000, 42501 e 22023 comuns e `conferirRetorno(): z.output<S>`. O teste é a união dos casos. `dados-legais.ts` passa
`dep.autenticar`. É a forma proposta no RD-0428.

**`git merge-tree`:** o conflito add/add sumiu. O `nuvem/empresa-acoes-engenheiro-software` (agora em `f75cc7dc`) mesclou o
`788cc483`, e os dois branches passaram a ter base comum: `git merge-tree --write-tree` de `16e6eb4a` com `f75cc7dc` sai
sem conflito.

**Mas o resultado não compila.** Os dois branches trocaram de forma. O rodapé adotou a função `AutenticarPortal`, e o das
ações da empresa ficou com a forma antiga do rodapé (`788cc483`). Lá, `empresa-acoes-portal.ts:43` importa
`type AutenticacaoDoPortal`, que o `16e6eb4a` apagou, e `:172` chama `exigirSuperAdmin(dep, …)` com o objeto. A árvore
mesclada fica com o `portal-comum.ts` do rodapé e com essas chamadas: o typecheck da API quebra no segundo merge.

| RD | Reteste | Status |
|---|---|---|
| RD-0428 | Do lado do rodapé, feito: uma versão, na forma proposta, e o add/add sumiu. Falta o branch das ações da empresa mesclar o `16e6eb4a` e adaptar a rota: `DepsAcoesEmpresa { autenticar: AutenticarPortal; … }` no lugar de `extends AutenticacaoDoPortal`, `exigirSuperAdmin(dep.autenticar, req, tenantId, '…')` e, no `extras` do `traduzir`, `hint` como `string` (`''` quando falta) | **em correção** (engenheiro-software, branch `nuvem/empresa-acoes-engenheiro-software`) |

**Parecer do lote 3b: sem achado em aberto neste branch.** O RD-0428 segura o lote das ações da empresa até o merge do
`16e6eb4a` lá. O lote 3a (shell) mesclou o `788cc483` e não toca no `portal-comum.ts`, então entra limpo depois do 3b.

A rota já entrega a razão social, o CNPJ só com dígitos e o site normalizado. As telas não repetem nenhum desses dados como
constante. A máscara do CNPJ e o "© ano" são montados na tela, como a spec manda (§2). A cópia da montagem é o RD-0433.

---

## Lote 4: `nuvem/kit-thathyany-modulo-integracao` @ `665c5c06` (lido na parte 3 em `65154ee8`)

Reteste do RD-0426: **corrigido**. A l.51 diz "**Desative o `thathyany-conector`:** peça ao gerente-projetos." Na l.65,
saiu "(a mesma rota)". O teste da l.160 confere a frase nova.

**Parecer do lote 4: sem achado em aberto.**

---

## Lote 5: `nuvem/bko-revisao-modulo-treinamento` @ `1d1436eb` (lido na parte 3 em `d5b5f523`)

Reteste do RD-0427: **corrigido**. Os dois "Nova trilha" usam o `Button variant="primary"` do kit, com
`router.push(hrefEditarTrilha())`, e a classe à mão saiu. `AbaTrilhas` tem o seu `useRouter` (l.277).

Achados que as partes 1 e 3 não pegaram:
- **RD-0416 ampliado:** `function BuscaComEspera` (`trilhas-page.tsx:157`) é a 5ª cópia da busca com espera de 300 ms, com
  o seu próprio `setTimeout(…, 300)`. Ela entra na proposta do RD-0416 (hook do kit). Pela mesma regra do Core e do
  Catálogo, o RD-0416 passa a segurar também o Treinamento.

| Campo | RD-0437 |
|---|---|
| Onde | `modules/treinamento/web/pages/trilhas-page.tsx:95` (`<MenuAcoes acoes={acoes} rotulo="Mais ações" />`). Já no `main`: `modules/pesquisa/web/pages/construtor-page.tsx:144`, `resultados-page.tsx:134`, `modules/promotor/web/pages/cadastros-page.tsx:149` e `trade-page.tsx:99` |
| Tipo | código |
| O que se repete | O mesmo do RD-0423 (Catálogo): `rotulo="Mais ações"` passado à mão, e esse já é o padrão do `MenuAcoes` (`packages/ui/src/web/menu-acoes.tsx:31`). São 5 lugares em 3 módulos, fora os 4 do Catálogo |
| Impacto | manutenção: se o kit trocar o rótulo, esses menus ficam com o antigo |
| Severidade | baixa. É código de produção: **segura o Treinamento**. A Pesquisa e o Promotor já estão no `main` e corrigem no próximo lote de cada um |
| Proposta | Tirar a prop: `<MenuAcoes acoes={acoes} />` (e o mesmo nos outros 4) |
| Dono | modulo-treinamento (Pesquisa: modulo-pesquisa; Promotor: modulo-promotor) |

**Parecer do lote 5: segura (RD-0416 ampliado, média; RD-0437, baixa em código).** O MC-0065 (cor do "Nova trilha")
continua precisando da validação do design-de-marca.

---

## Lote 6: `nuvem/bko-revisao-modulo-core` @ `6bf52819` (lido na parte 2 em `0c276eb5`)

O commit `6bf52819` só traz a MC-0069 e os prints "antes" refeitos. A MC-0069 é do design-de-marca (parecer
`docs/marca/pareceres/2026-11-15-lote-noite.md`, parte 2): a aba ativa de Usuários e módulos estava em grafite e foi para
`border-accent bg-accent` (`licencas-page.tsx:122`).

| RD | Reteste | Status |
|---|---|---|
| RD-0418 | Os 6 "antes" foram refeitos e agora diferem do "depois" (MD5 diferentes). O "antes" de Visitas é o do `main`: subtítulo "Check-ins e checkouts da equipe…", "Atualizar" e "Exportar CSV" soltos e o quadro "12 visitas · 2 fora do raio". Rotas e Licenças também foram refeitos | **corrigido** |
| RD-0416, RD-0417 | Nenhum arquivo de lista mudou | **aberto** |
| RD-0419, RD-0420, RD-0421 | `indicadores-page.tsx`, `indicadores.ts` e `routes-page.tsx` não mudaram | **aberto** |
| RD-0422 | No print "depois" de Visitas, a coluna Check-in continua cortando a hora ("14/11/2026, 0…") | **aberto** |

`manter?` (sem RD): a faixa Empresa / Perfil / Usuário é um `role="tablist"` escrito à mão, e o kit tem `Abas`
(`packages/ui/src/web/abas.tsx`, com setas, Home e End). O desenho é outro (pílula cheia × sublinhado). Fica para o
designer-ux e o design-de-marca dizerem se é o mesmo componente. A MC-0069 mexeu na cor desse controle, por isso precisa da
validação do design-de-marca.

**Parecer do lote 6: segura (RD-0416, RD-0419, RD-0420 e RD-0421, média; RD-0417 e RD-0422, baixa em código).**

---

## Lote 7: `nuvem/bko-revisao-modulo-catalogo` @ `a058713b` (lido na parte 2 em `5df48729`)

O commit `a058713b` traz a MC-0071 (selo Destaque em `pending`), a MC-0072 (link de Marcas em `text-accent-ink`) e 13
prints 1366×768 "depois", com um README. Todos foram abertos. O README diz "Não há prints 'antes'", e a §P11 continua sem
a comparação.

| RD | Reteste | Status |
|---|---|---|
| RD-0416 | `web/lib/busca-com-espera.ts` não mudou | **aberto** |
| RD-0417 | As 4 cópias do "Limpar filtros" não mudaram | **aberto** |
| RD-0423 | `rotulo="Mais ações"` continua nos 4 lugares | **aberto** |

O que passa nas telas:
- a contagem fica num lugar só ("Produtos · 1.784" na aba, "Marcas concorrentes · 7" no `h1`);
- o "⋯" fica no cabeçalho;
- o vazio de Marcas aparece uma vez;
- a gaveta do produto tem um título só e Cancelar/Salvar fixos;
- a vigência cabe numa célula.

| Campo | RD-0438 |
|---|---|
| Onde | BKO › Catálogo, lista de produtos, coluna "Destaque" (`catalogo-page.tsx:191`; print `catalogo-produtos-depois-1366x768.png`) |
| Tipo | texto |
| O que se repete | A coluna se chama "Destaque", e a célula traz o selo "Destaque" (ou "—"). A mesma palavra aparece no título e em cada linha marcada |
| Impacto | leitura: um selo inteiro para dizer "sim" numa coluna que já diz o quê |
| Severidade | baixa (polui; segura) |
| Proposta | Tirar a coluna "Destaque" e pôr o selo `pending` "Destaque" ao lado do nome do produto, na célula Produto (só nos marcados). Se a coluna ficar para ordenar, a célula diz "Sim" sem selo, e o "—" continua para os outros |
| Dono | modulo-catalogo |

| Campo | RD-0439 |
|---|---|
| Onde | BKO › Marcas concorrentes, coluna "Situação" (`marcas-page.tsx:51`) com o filtro "Situação" (`:152`); print `marcas-depois-1366x768.png` |
| Tipo | texto |
| O que se repete | O filtro só tem "Ativas" ou "Inativas", então toda linha da lista tem a mesma situação. Com "Ativas", o selo "Ativa" aparece em todas as 7 linhas e repete o filtro que está logo acima |
| Impacto | leitura: uma coluna inteira que não muda de linha para linha e não leva a nenhuma ação |
| Severidade | média (o mesmo fato 7×; segura) |
| Proposta | Tirar a coluna "Situação" (o filtro já diz qual lista é). Na lista de inativas, o "⋯" de cada linha já oferece "Reativar" |
| Dono | modulo-catalogo |

**Parecer do lote 7: segura (RD-0416 e RD-0439, média; RD-0417, RD-0423 e RD-0438, baixa).** A MC-0071 e a MC-0072 mudam
cor e precisam da validação do design-de-marca.

---

## Lote 8: `nuvem/acesso-bko-modulo-core` @ `2ff1f685` (PR #250; lido na parte 2 em `1ecb5fce`)

| RD | Reteste | Status |
|---|---|---|
| RD-0414 | A pasta `modules/core/web/docs/prints/acesso/` foi apagada (4 arquivos). Nenhum arquivo do branch aponta para ela, fora a linha antiga do diário (l.168), que é histórico e tem a correção na l.169 | **corrigido** |
| RD-0415 | `horaNoFuso` e `diaEHora` saíram. `seloDoUsuario` usa `formatTime(…).replace(':', 'h')`, e `etiquetaDeSenha` usa `formatDateTime`, os dois de `@macuxi/ui/web` | **corrigido** |

O commit `a01db393` trocou o relógio de 1 min por um `setTimeout` único, no fim do bloqueio mais próximo. Não há cópia de
regra: o fim vem do `bloqueio_ate` da lista. A observação da parte 2 para o testes (o corpo da gaveta passava por baixo do
rodapé) foi resolvida: no print `usuarios-gaveta-bloqueado`, o rodapé Cancelar/Salvar cobre o fim do corpo.

**Parecer do lote 8 (PR #250): sem achado em aberto.**

---

## Lote 9: `nuvem/logo-cliente-designer-ux` @ `64a18b97` (lido na parte 2 em `184319e4`)

Lido o commit `64a18b97` (MC-0066 e MC-0067). Os PNG `carga-campo-a`, `carga-gestao-b`, `login-campo` e `mais` foram
abertos.
- A placa única de 52/36 serve ao login e ao Mais. A da carga (64/48) é outra de propósito, e a spec diz por quê.
- O Mais continua com "Licenciado para Exemplo Norte" + a logo (`manter`, como na parte 2).
- No login, a placa fica no formulário e o rodapé legal não muda.
- `carga-login.html` foi dividido em `carga.html` e `login.html`, e os PNG antigos saíram (nenhuma imagem órfã).

| Campo | RD-0440 |
|---|---|
| Onde | `docs/design/telas/logo-cliente.md` §3 (parágrafo "Decisão pendente do dono do produto: variação A ou B (MC-0066)…" e a tabela A × B, linha "Leitura") × §8, item 1 |
| Tipo | doc |
| O que se repete | A decisão pendente está descrita 2×. As duas trazem a proibição do manual §2.4, a recomendação da A pelo design-de-marca e o "ao lado" do pedido. O §8.1 ainda conta a história da primeira versão (placa de 84 dp, filete a 22 dp), que saiu da spec |
| Impacto | leitura: o dono do produto lê a mesma escolha em dois lugares com textos diferentes |
| Severidade | baixa. É doc de produto, então **segura** |
| Proposta | §8, item 1: "1. **Carga com logo: escolher A ou B** (§3, MC-0066). A regra da placa branca única (52/36, sempre menor que o logo Macuxi da tela e fora da área de proteção) só entra no manual com o "aprovo" do dono do produto." O resto fica só no §3 |
| Dono | designer-ux |

**Parecer do lote 9: segura (RD-0440, baixa, doc).** É mudança de layout: precisa da validação do design-de-marca e da
escolha A/B do dono do produto.

---

## Para o testes (parte 4, sem RD)
1. **Lote 1, senha antiga com espaço nas pontas:** até este lote, a senha podia começar ou terminar com espaço. O teste
   antigo esperava `faltasNaSenha('  a1!   ')` → `[]`, e `senha-regra.ts` diz "O login aceita qualquer senha já gravada".
   Agora o `validarLogin` (app e BKO) recusa no aparelho a senha com espaço nas pontas, antes de ir ao servidor. Quem gravou
   uma senha assim não entra mais pelo app nem pelo BKO. Conferir com o dono se isso é o esperado, e o caminho dessa
   pessoa (só o "Esqueci a senha").
2. **Lotes 1 e 2, código legado:** o campo recusa os códigos antigos (`docs/banco/plataforma.md:11`: thathyany, demo,
   teste-macuxi) e o servidor aceita. A thathyany não entra pelo app v1.0.9 nem pelo BKO até a migração do código dela. O
   `codigoSalvo` antigo vem preenchido e já aparece com erro. O "Esqueci a senha" não confere o formato (`validarEsqueci`
   só olha o vazio), e o login confere.
3. **Lote 3b × ações da empresa:** depois do segundo merge (`16e6eb4a` e `f75cc7dc`), o typecheck da API quebra
   (`AutenticacaoDoPortal` e `exigirSuperAdmin(dep, …)` em `empresa-acoes-portal.ts`). O `merge-tree` não acusa porque o
   conflito não é de texto.
4. **Lote 3a:** sem prints do rodapé no aparelho e no BKO, nem antes/depois de Auditoria e Início (§P11).
5. **Lote 7:** no print `catalogo-produtos-depois`, o caminho diz "Catálogo › Freios › Pastilhas", e a lista traz produtos
   de Suspensão, Ignição, Filtros e outras categorias. Conferir se o filtro do caminho chega à lista ou se é só o mock do
   print. Continua sem prints "antes" (§P11).

## Para o gerente (parte 4)
- **Ordem de merge da API:** primeiro o lote 3b (`16e6eb4a`). Depois, o `nuvem/empresa-acoes-engenheiro-software` mescla o
  3b e adapta a rota (RD-0428), e só então entra. O lote 3a (shell) entra depois do 3b.
- **Precisam da validação do design-de-marca:** rodapé legal (3a), MC-0065 (5), MC-0069 (6), MC-0071 e MC-0072 (7) e a logo
  do cliente (9). O lote 9 também precisa da escolha A/B do dono do produto.
- **O RD-0416 agora segura 3 lotes** (Core, Catálogo e Treinamento) e depende do hook no kit. Se o designer-ux pegar o
  `useBuscaComEspera` e o `LimparFiltros` (RD-0416 e RD-0417) primeiro, os três módulos fecham juntos.

---

# Lote da noite, parte 5 — reteste rápido (14/11/2026, ~23h45 de Manaus)

Base: `main` em `21ab3b20`, mesclado no branch do corretor (merge, sem rebase). Os dois heads conferidos no remoto depois do
fetch: `f93f44cd` (vendedor) e `d955b035` (core), sem avanço. O `coord.mjs` continua com HTTP 403: os pedidos aos donos (cc
`gerente-projetos`) ficam neste relatório e no catálogo. A numeração segue a partir do RD-0441.

## Resumo da parte 5

| # | Branch | SHA lido | Parecer | RD retestados | RD novos (gravidade, dono) |
|---|---|---|---|---|---|
| 1 | `nuvem/bko-revisao-modulo-vendedor` (PR #298) | `540196f5` → `f93f44cd` | **segura** | — | RD-0441 média, código (modulo-vendedor; teste FB-1: testes) |
| 2 | `nuvem/login-v109-modulo-core` | `7ed7b240` → `d955b035` | **sem achado em aberto neste branch** | RD-0430 **em correção** (Core feito; falta a regex da CLI, engenheiro-software); RD-0431 **corrigido**; RD-0432 aberto e ampliado (só teste, não segura) | — |

---

## Lote 1: `nuvem/bko-revisao-modulo-vendedor` @ `f93f44cd` (PR #298; lido na parte 3 em `540196f5`)

Lido `git diff 540196f5 f93f44cd`: um arquivo, `modules/vendedor/api/pedidos.ts` (+2 −3). Não há prints novos; a tela não
mudou. O filtro "Filial" da tela (`orders-page.tsx`) não foi tocado: um `SelectField` "Filial" com "Todas", sem chip nem
resumo que o repita, e o "Limpar filtros" zera a filial. O motivo da mudança é o teste FB-1
(`tests/modulos/filial-filtro-reserva-t0149.test.ts:63-68`), que lê o código-fonte e procura o array de parâmetros escrito
logo depois de `limit $9\``. A constante `valores` (criada em `1a151258`) fazia o teste falhar.

| Campo | RD-0441 |
|---|---|
| Onde | `modules/vendedor/api/pedidos.ts:202` (parâmetros da lista) × `:214` (parâmetros do total do filtro, §P6) |
| Tipo | código |
| O que se repete | O array de 17 parâmetros do mesmo `filtro` (`e.vendedores, e.clientes, status…, q.branch_id ?? null, q.sem_pendentes === '1'`) está escrito 2×, inteiro, a uma dúzia de linhas um do outro. As cópias já diferem: a lista passa `cursor?.createdAt ?? null, cursor?.id ?? null` e o total passa `null, null` (hoje dá no mesmo, porque o total só roda sem cursor). Antes de `f93f44cd`, era uma constante só (`valores`, e o total usava `[...valores, [...STATUS_FORA_DO_TOTAL]]`) |
| Impacto | manutenção: um filtro novo (como foi a Filial, `$16`) precisa entrar nos dois arrays na mesma posição; se entrar só na lista, o título "Pedidos · N · R$ X" passa a contar outro conjunto |
| Severidade | média (código de produção copiado; segura) |
| Proposta | Voltar a constante única: `const valores = [e.vendedores, …, q.sem_pendentes === '1'];`, a lista com `valores` e o total com `[...valores, [...STATUS_FORA_DO_TOTAL]]`. O testes ajusta o FB-1 para ler o array da constante: `const params = /const valores = \[([^\]]+)\]/.exec(api)?.[1] ?? '';` (o resto do caso fica igual; `lista[15]` continua `q.branch_id ?? null`). Os dois commits entram juntos, para o FB-1 não ficar vermelho no meio |
| Dono | modulo-vendedor (teste FB-1: testes) |

O que passa: o filtro é um só (tela → `paraQuery` → contrato → `$16`); nenhum rótulo, chip ou texto novo.

**Parecer do lote 1: segura (RD-0441, média, código de produção).**

---

## Lote 2: `nuvem/login-v109-modulo-core` @ `d955b035` (lido na parte 4 em `7ed7b240`)

Lido `git diff 7ed7b240 d955b035` (12 arquivos): `f709b530` (PE-02), o merge `0e4c28c3` do web (`0e3292de`, já lido na
parte 4, lote 2) e `d955b035` (RD-0430 e RD-0431).

| RD | Reteste | Status |
|---|---|---|
| RD-0430 | Uma frase só: `MENSAGEM_CODIGO_EMPRESA` em `contracts/auth.ts:29`, usada pelo schema (`:31`) e por `erroDoCodigoEmpresa` (`ciclo-senha.ts:147`, uma linha). O `.length(6)` saiu. As frases "tem 6" e "no máximo 6" saíram, e os testes do app esperam a frase única. **Falta** a regex da CLI: `apps/api/src/cli/codigo-licenca.ts:78` (`CODIGO_LICENCA`) continua com a sua cópia, igual no `main` (`21ab3b20`), e `CODIGO_EMPRESA_REGEX` segue sem uso fora de `auth.ts` (passa a ter quando a CLI importar). Proposta, a mesma da parte 4: `const CODIGO_LICENCA = new RegExp(CODIGO_EMPRESA_REGEX.source);` (sem a flag `i`, a CLI continua exigindo maiúsculas) | **em correção** (parte do Core corrigida; resto com o engenheiro-software, fora deste branch) |
| RD-0431 | `temEspacoNasPontas` (`senha-regra.ts:18`) é a regra única, usada por `faltasNaSenha` (`:30`) e por `validarLogin` (`ciclo-senha.ts:168`), e reexportada em `senha.ts`. O comentário do topo de `senha-regra.ts` agora diz o que o login faz | **corrigido** |
| RD-0432 | O caso antigo "não há trim" continua conferindo `'  a1!   '` → `['espaco']`. A PE-02 acrescentou um terceiro caso para o mesmo: "espaço na ponta só vale com algum caractere que não é espaço" confere `' Abc123!x'` e `'Abc123!x '` → `['espaco']`, como o caso seguinte faz com `' Abcdef1!'` e `'Abcdef1! '`. O que esse caso traz de novo é só `'Abc 123!x'` → `[]` | **aberto, ampliado** (só teste, não segura; R-20261111-190159). Proposta: o caso novo fica só com o `[]` do espaço no meio (ou entra no caso seguinte), e o "não há trim" volta ao espaço no meio |

O que passa:
- **PE-02** (`f709b530`): uma condição a mais dentro de `faltasNaSenha` (`senha.trim() !== '' && …`); a frase da falta
  continua a constante única. Os dois casos de "vazia ou só de espaços" no teste são novos.
- **Merge do web** (`0e4c28c3`): os dois campos do código usam `CODIGO_EMPRESA_TAMANHO` do contrato e a validação do Core;
  os testes do web só trocaram os dados de exemplo. Sem regra nem frase própria.
- Não há tela nova nem texto novo além da frase única; sem prints a conferir.

**Parecer do lote 2: sem achado em aberto neste branch.** O resto do RD-0430 (CLI) é do engenheiro-software e segura o lote
dele que tocar `codigo-licenca.ts`, como o RD-0428 fez na parte 4.

---

## Para o testes (parte 5, sem RD)
1. **Lote 2, senha só de espaços:** a PE-02 tirou a falta "espaço" de senha vazia ou só de espaços na criação e na troca
   (`faltasNaSenha`), mas `validarLogin` chama `temEspacoNasPontas` direto: no login, `'        '` mostra "A senha não pode
   começar nem terminar com espaço.", e na criação mostra "Faltam uma letra, um número e um caractere especial.". Conferir
   se a PE-02 vale também para o login. Se valer, a condição `trim() !== ''` vai para dentro de `temEspacoNasPontas`, e as
   duas telas ficam iguais.
2. **Lote 1:** o FB-1 lê o código-fonte com regex; qualquer refatoração dos parâmetros quebra o caso sem mudar o
   comportamento. O caso com banco (`tests/integracao/demo/filial-demo-t0149.test.ts`) já cobre o filtro de verdade.

## Para o gerente (parte 5)
- **PR #298 segura** pelo RD-0441: o modulo-vendedor e o testes precisam entrar juntos (constante de volta + regex do FB-1).
- **Login v1.0.9 do Core liberado** pelo corretor. O engenheiro-software precisa pegar a regex da CLI (resto do RD-0430).

---

# Lote da noite, parte 6 — todos os lotes abertos (v1.0.10)

Feita em 15/11/2026, madrugada de Manaus (~1h–1h50), a pedido do dono do produto (R-20261115-010000-alexandre), para a
v1.0.10. Três corretores leram os lotes em paralelo (rascunhos A, B e C) e este texto os consolida, sem reavaliar.
Base: `origin/main` em `b536b829` (#310), mesclado no branch do corretor (merge, sem rebase). Cada lote foi lido por
`origin/<branch>`, só leitura: diff completo `origin/main...origin/<branch>` na primeira avaliação e diff entre o SHA da
parte anterior e o head nos retestes. Todos os heads conferidos no remoto batem com o SHA pedido. O `coord.mjs` continua
com HTTP 403: os pedidos aos donos (cc `gerente-projetos`) ficam neste relatório e no catálogo. A numeração segue a partir
do RD-0441 (novos: RD-0442 a RD-0459).

**Login fora desta parte:** o login (`nuvem/login-v109-modulo-core` e o web dele) ficou de fora pela exceção do dono do
produto (R-20261115-002000-alexandre). O parecer dele é o da parte 5.

## Resumo da parte 6

| # | Branch | SHA lido | Parecer | RD retestados | RD novos (gravidade, dono) |
|---|---|---|---|---|---|
| 1 | `nuvem/bko-revisao-modulo-vendedor` (PR #298) | `f93f44cd` (sem push novo) | **segura, sem mudança** | RD-0441 aberto | — |
| 2 | `nuvem/bko-revisao-modulo-core` | `6bf52819` → `da495ed0` | **segura** | RD-0419, RD-0420, RD-0421, RD-0422 **corrigidos**; RD-0416 e RD-0417 **em correção** (Core feito; passam ao lote do kit, decisão a) | RD-0448 baixa, código; RD-0449 baixa, código (modulo-core) |
| 3 | `nuvem/bko-revisao-modulo-catalogo` | `a058713b` → `364ac40a` | **sem achado em aberto** (decisão a) | RD-0423, RD-0438, RD-0439 **corrigidos**; RD-0416 e RD-0417 **em correção** (Catálogo feito; passam ao lote do kit) | — |
| 4 | `nuvem/bko-revisao-modulo-treinamento` | `1d1436eb` → `cf22a7a6` | **sem achado em aberto** (decisão a) | RD-0437 **corrigido no Treinamento** (Pesquisa e Promotor seguem no `main`); RD-0416 e RD-0417 (ampliado) passam ao lote do kit | — |
| 5 | `nuvem/rodape-shell-engenheiro-apps` | `155bc0d4` → `474164cb` | **sem achado em aberto** (decisão b; faltam os prints da §P11: observação para o testes) | RD-0433 **em correção** (CNPJ pelo `formatarDocumento`; a cópia única passa ao kit, decisão b); RD-0434 e RD-0435 **corrigidos**; RD-0436 aberto (Core, não segura o shell) | — |
| 6a | `nuvem/rodape-legal-engenheiro-software` | `16e6eb4a` (sem avanço) | **sem achado em aberto** | — | — |
| 6b | `nuvem/rodape-legal-banco-dados` | `c2db8450` (1ª avaliação) | **segura** | — | RD-0452 baixa, código (banco-dados); RD-0453 baixa, só teste, não segura (banco-dados) |
| 7a | `nuvem/empresa-acoes-banco-dados` | `60a31e44` → `a298381f` | **sem achado em aberto** (o RD-0453 cita o `qsp` novo; só teste) | — | (RD-0453) |
| 7b | `nuvem/empresa-acoes-engenheiro-software` | `f75cc7dc` (sem avanço desde a parte 4) | **segura** | RD-0428 **em correção, sem mudança**; RD-0406 **em correção** (falta o Core; não segura este lote) | — |
| 7c | `nuvem/empresa-acoes-engenheiro-apps` | `d807bcf0` → `8705f496` | **segura** | RD-0429 **corrigido** | RD-0454 baixa, texto (engenheiro-apps; constante no SDK e uso na API: engenheiro-software) |
| 8a | `nuvem/email-senha-engenheiro-software` | `da106be2` (sem avanço) | **sem achado em aberto** | — | — |
| 8b | `nuvem/email-senha-testes` | `32bb52c8` (1ª avaliação) | **sem achado em aberto** | — | — |
| 9a | `nuvem/kit-thathyany-modulo-integracao` | `665c5c06` → `f3619bc4` (kit 1.0.3) | **segura** | — | RD-0455 baixa, código; RD-0456 baixa, código; RD-0457 baixa, doc · texto; RD-0459 baixa, só teste, não segura (todos modulo-integracao) |
| 9b | `nuvem/kit-ps1-parse-testes` | `75609a4d` (1ª avaliação) | **sem achado em aberto neste branch** | — | RD-0458 baixa, só teste, não segura (o caso a tirar é do modulo-integracao) |
| 10 | `nuvem/chave-conector-modulo-integracao` | `3352c984` (sem SHA novo) | **sem achado que segure** | RD-0424 aberto (só teste, não segura) | — |
| 11 | `nuvem/logo-cliente-designer-ux` | `64a18b97` → `c6d5a4b4` | **segura** | RD-0440 **corrigido** | RD-0450 baixa, doc; RD-0451 média, texto da simulação (designer-ux) |
| 12 | `nuvem/inicio-cabecalho-engenheiro-apps` | `b227367e` | **segura** | RD-0399 item 3 **corrigido** no shell; resolvedor da foto agora ligado | RD-0445 baixa, código; RD-0446 baixa, só teste, não segura (engenheiro-apps) |
| 13a | `nuvem/push-fcm-v2-engenheiro-software` (PR #311, governança) | `46b8c6b3` | **sem achado em aberto** | — | — |
| 13b | `nuvem/push-fcm-v2-modulo-core` (PR #312) | `1efb8e69` | **segura** | — | RD-0443 baixa, código (modulo-core) |
| 13c | `nuvem/push-fcm-engenheiro-apps` | `9334bf0e` | **segura** | — | RD-0442 média, código (engenheiro-apps; contrato: modulo-core; ADR: engenheiro-software); RD-0444 baixa, só teste, não segura (engenheiro-apps) |
| 14 | `nuvem/android-build-disco-engenheiro-software` (governança) | `7440ea9f` | **segura** | — | RD-0447 baixa, workflow (engenheiro-software) |

**Seguram (11):** 1 (RD-0441), 2 (RD-0448, RD-0449), 6b (RD-0452), 7b (RD-0428), 7c (RD-0454), 9a (RD-0455, RD-0456,
RD-0457), 11 (RD-0450, RD-0451), 12 (RD-0445), 13b (RD-0443), 13c (RD-0442), 14 (RD-0447).
**Sem achado em aberto (10):** 3, 4, 5, 6a, 7a, 8a, 8b, 9b, 10 (só RD-0424, de teste), 13a.
**Só teste, não seguram (R-20261111-190159):** RD-0444, RD-0446, RD-0453, RD-0458, RD-0459 e o RD-0424.

### Numeração (provisório → definitivo)

| Rascunho | Definitivo |
|---|---|
| `RD-A1` | RD-0442 |
| `RD-A2` | RD-0443 |
| `RD-A3` | RD-0444 |
| `RD-A4` | RD-0445 |
| `RD-A5` | RD-0446 |
| `RD-A6` | RD-0447 |
| `RD-B1` | RD-0448 |
| `RD-B2` | RD-0449 |
| `RD-B3` | RD-0450 |
| `RD-B4` | RD-0451 |
| `RD-C1` | RD-0452 |
| `RD-C2` | RD-0453 |
| `RD-C3` | RD-0454 |
| `RD-C4` | RD-0455 |
| `RD-C5` | RD-0456 |
| `RD-C6` | RD-0457 |
| `RD-C7` | RD-0458 |
| `RD-C8` | RD-0459 |

## Decisões do gerente-projetos (sessão do corretor, 15/11/2026, madrugada de Manaus)

No mesmo critério do RD-0430 (parte 5): quando o resto de um RD depende de um lugar que o dono do lote não pode alterar,
o RD deixa de segurar esse lote e passa a segurar o lote de quem pode fazer o resto. **As duas decisões são reversíveis
pelo dono do produto.**

a. **RD-0416 e RD-0417** deixam de segurar Core, Catálogo e Treinamento e passam a segurar o **lote do kit do
   designer-ux**: pôr em `packages/ui` (`src/web`) a versão de `modules/catalogo/web/lib/lista.tsx` (`ESPERA_BUSCA_MS`,
   `useBuscaComEspera` e `LimparFiltros`). Cada módulo (Core, Catálogo, Treinamento e o shell na Auditoria) troca o import
   no lote seguinte ao merge do kit. Com isso, Catálogo (3) e Treinamento (4) ficam **sem achado em aberto**; o Core (2)
   continua segurando pelos RD-0448 e RD-0449.
b. **RD-0433** (os dois `rodape-legal.ts` iguais no app e no BKO): dono = **designer-ux**, no kit (`packages/ui`), como a
   spec §5 pede. Deixa de segurar o lote 5 (`rodape-shell-engenheiro-apps`) e passa a segurar o lote do kit; o
   engenheiro-apps troca o import no lote seguinte. Com isso, o lote 5 fica **sem achado em aberto** (o RD-0436 não segura
   o shell). A falta dos prints da §P11 é observação para o testes, não RD.

---

## Rascunho A: push pelo FCM, build Android, foto do perfil no shell e chave do Conector (itens 13, 14, 12 e 10)

Os três branches do push mesclam entre si sem conflito, e cada um mescla limpo no `main` (`git merge-tree`). O push dos
apps também mescla limpo com o build Android e com o cabeçalho. O `nuvem/inicio-cabecalho-engenheiro-apps` conflita com o
`main` em `.coord/diario/modulo-core.md` (veja "Para o gerente").

### Lote 13: push pelo FCM (ADR 0053)

#### Os três branches entre si
- **Contrato**: um só. `REGEX_TOKEN_EXPO` e `tipoDoToken` nascem em `modules/core/contracts/notificacao.ts` (13b) e o
  `push.ts` do Core importa de lá; a regex que estava escrita dentro de `montarMensagemExpo` saiu. O `PushTokenSchema` não
  mudou, e ninguém criou contrato `@v2`.
- **Registro do token**: o app usa o mesmo `PUT /v1/dispositivos/atual/push` e a mesma chave local (`chaveRegistroPush`);
  não há rota nem fila nova.
- **Config**: os nomes `FCM_SERVICE_ACCOUNT_JSON`, `FCM_PROJECT_ID` e `MACUXI_PUSH_ATIVO` existem só no `push.env` (13a); o
  Core lê `env.FCM_*` sem redefinir. O `google-services.json` do app (13c) usa o secret `GOOGLE_SERVICES_JSON_BASE64` que o
  `android-build.yml` do `main` já decodifica; o app não refaz a decodificação.
- **Texto de notificação**: canal `avisos`, cortes 120/178 e silencioso continuam nascendo só no servidor; o app só lê
  `title`/`body`. Dentro do servidor há a cópia do RD-0443.
- **Regra do formato do token**: o app não usa o `tipoDoToken` do contrato e escreve outra regra (RD-0442).
- **Arquivos repetidos**: o 13b traz o commit `46b8c6b3` inteiro (empilhado sobre o 13a). Não é cópia de conteúdo: é o
  mesmo commit. Veja "Para o gerente".

#### 13a: `nuvem/push-fcm-v2-engenheiro-software` @ `46b8c6b3`
Lidos a ADR 0053, a linha do índice, os dois passos do `producao-publicar.yml`, `compose.yml`, `env.modelo`,
`preparar-vm.sh` e `scripts/ci/producao-push.test.mjs`.
- O par "os dois ou nenhum" é conferido uma vez, no passo dos secrets. O passo de gravar repete só o `[ -n … ] && [ -n … ]`
  que decide se escreve, e o comentário diz isso. Segue o desenho do `email.env` e do `recados.env`.
- `push.env` entra no `for f in …` do `preparar-vm.sh` e no `env_file` só do worker. O teste confere os quatro arquivos sem
  repetir caso.
- A ADR não repete o inventário do Expo: ela aponta os itens.

**Parecer do 13a: sem achado em aberto.**

#### 13b: `nuvem/push-fcm-v2-modulo-core` @ `1efb8e69`
Lidos `push.ts`, `consumidores.ts`, `contracts/notificacao.ts` e os casos novos de `push.test.ts` (tipo do token,
mensagem, silencioso, JWT, cache, 401, limpeza, 5xx/429/rede, paralelo de 5 e falha segura). Cada caso cobre um item
diferente da ADR; os casos de Expo continuam até o §7.

| Campo | RD-0443 |
|---|---|
| Onde | `modules/core/api/push.ts` (1efb8e69): `montarMensagemExpo` (`:36-47`) × `montarMensagemFcm` (novo) |
| Tipo | código |
| O que se repete | A regra da bandeja está escrita 2×, igual: o silencioso `d.titulo.trim() === '' && d.corpo.trim() === ''`, o título `d.titulo.slice(0, 120)` e o corpo `d.corpo.length > 178 ? \`${d.corpo.slice(0, 177)}…\` : d.corpo`. A ADR 0053 §2 manda os dois caminhos usarem "os mesmos cortes de hoje" |
| Impacto | manutenção: mudar o corte ou a regra do silencioso num caminho só deixa Expo e FCM com bandejas diferentes (durante a convivência, aparelhos v1.0.9 e v1.0.10 mostram textos diferentes) |
| Severidade | baixa (código de produção; segura) |
| Proposta | Três auxiliares no topo de `push.ts`, usados pelos dois montadores: `const silencioso = (d: DestinoPush) => d.titulo.trim() === '' && d.corpo.trim() === '';` · `const tituloDaBandeja = (t: string) => t.slice(0, 120);` · `const corpoDaBandeja = (c: string) => (c.length > 178 ? \`${c.slice(0, 177)}…\` : c);`. Quando o §7 tirar o Expo, os três ficam só com o FCM |
| Dono | modulo-core |

**Parecer do 13b: segura (RD-0443).**

#### 13c: `nuvem/push-fcm-engenheiro-apps` @ `9334bf0e`
Lidos `app.config.ts`, `lib/push.ts`, `services/push.ts` e os dois testes. O `dadosDoPush` reaproveita `entidadesDoPush` e
`rotaDoPush`, e o `dadosDe` do serviço passou a chamá-lo. Não há texto novo de tela.

| Campo | RD-0442 |
|---|---|
| Onde | `apps/mobile/src/lib/push.ts` (9334bf0e): `TOKEN_FCM = /^[A-Za-z0-9_:-]{20,300}$/` e `tokenFcmValido` × `modules/core/contracts/notificacao.ts` (1efb8e69): `REGEX_TOKEN_EXPO`/`tipoDoToken`, e `PushTokenSchema.token` (`min(1).max(300)`) |
| Tipo | código |
| O que se repete | A regra "o que é um token FCM aceito" tem 2 definições, em 2 donos, e elas já divergem. O contrato diz: FCM é tudo o que não é Expo, de 1 a 300. O app diz: FCM é texto `[A-Za-z0-9_:-]` de 20 a 300, e o Expo é recusado. O "300" está escrito nos dois. A ADR 0053 §1 diz que `tipoDoToken` está no contrato porque "o app e a API usam a mesma" e que o app troca o `tokenExpoValido` "por uma validação que aceita os dois (ou usa `tipoDoToken`)". O app já importa `@macuxi/core/contracts` em outras telas |
| Impacto | manutenção e regra: quando o formato mudar, o servidor e o app aceitam conjuntos diferentes; a ADR descreve um código que não existe |
| Severidade | média (regra escrita fora do dono; segura) |
| Proposta | Uma regra só, no contrato do Core. O modulo-core acrescenta em `contracts/notificacao.ts`: `export const tokenPushFcmValido = (t: unknown): t is string => typeof t === 'string' && PushTokenSchema.shape.token.safeParse(t).success && tipoDoToken(t) === 'fcm';` (se quiser o filtro de caracteres, ele entra aqui, uma vez). O app apaga `TOKEN_FCM` e `tokenFcmValido` e importa `tokenPushFcmValido` de `@macuxi/core/contracts`. O engenheiro-software ajusta a frase da ADR §1 ao que ficar (o app aceita só FCM) |
| Dono | engenheiro-apps (com o modulo-core no contrato e o engenheiro-software na ADR) |

| Campo | RD-0444 |
|---|---|
| Onde | `apps/mobile/src/lib/push.test.ts` (9334bf0e): 1º caso de "FCM direto: data como mapa de textos" × caso "aceita lista, texto JSON e texto separado por vírgula" (`:23-29`) |
| Tipo | teste |
| O que se repete | `entidadesDoPush(... '["pedido","meta"]')` → `['pedido','meta']` e a lista separada por vírgula já estão no caso antigo. O `dadosDoPush` de um mapa sem `dataString` devolve o próprio mapa, então o caso novo não acrescenta nada além do `rotaDoPush`, que o `describe('rotaDoPush')` já cobre |
| Impacto | manutenção |
| Severidade | baixa: só teste, **não segura** (R-20261111-190159); entra no lote seguinte |
| Proposta | Apagar o 1º caso. O 2º (formato Expo com `dataString`), o 3º e o 4º ficam: são os únicos sobre `dadosDoPush` e `mensagemDaTarefaPush` |
| Dono | engenheiro-apps |

**Parecer do 13c: segura (RD-0442). O RD-0444 não segura.**

---

### Lote 14: `nuvem/android-build-disco-engenheiro-software` @ `7440ea9f` (build Android sem disco)

Lidos o diff do `android-build.yml` (passo "liberar disco", "gradle.properties (ABIs e memória)", `--no-daemon`) e o caso
novo de `scripts/ci/android-build.test.mjs`. Nenhum outro workflow do repositório limpa o disco do runner nem mexe no
`gradle.properties`. O cache continua um só por coisa: o `setup-gradle` cuida do `~/.gradle` e o `actions/cache` do Metro;
o PR não acrescenta cache. O `df -h /` antes e depois é o que mostra quanto foi liberado: `manter`.

| Campo | RD-0447 |
|---|---|
| Onde | `.github/workflows/android-build.yml` (7440ea9f): `NDK_VERSAO: '27.1.12297006'` no `env` do job × `node_modules/react-native/gradle/libs.versions.toml` (`ndkVersion = "27.1.12297006"`); guarda em `scripts/ci/android-build.test.mjs` (caso novo, bloco `try { toml = ler(...) } catch {}`) |
| Tipo | rotina (CI) |
| O que se repete | A versão do NDK está copiada à mão no workflow. O teste que deveria pegar a divergência só compara quando há `node_modules`. O job do CI que roda `node --test scripts/ci/*.test.mjs` (`ci.yml`, "guardas do CI") não faz `pnpm install` ("Sem pnpm install: tudo aqui é node puro"), então no CI a comparação nunca roda e o caso passa calado |
| Impacto | manutenção: ao atualizar o react-native, a limpeza apaga o NDK novo; o Gradle baixa de novo (~1 GB, mais tempo e o mesmo disco que o passo quer poupar), e nada fica vermelho |
| Severidade | baixa (workflow; segura) |
| Proposta | Ler a versão de onde ela nasce, sem a cópia. Mover o passo "liberar disco" para logo depois de "instalar dependências" (o disco acabou no `assembleRelease`, não no install) e trocar a linha do env por: `NDK_VERSAO=$(sed -n 's/^ndkVersion = "\(.*\)"/\1/p' node_modules/react-native/gradle/libs.versions.toml)` · `[ -n "$NDK_VERSAO" ] \|\| { echo '::error title=NDK::ndkVersion não encontrado no react-native'; exit 1; }`. Saem `NDK_VERSAO:` do `env`, o `try/catch` e a comparação do teste; o teste passa a conferir o `sed` e que a limpeza vem depois do install. Se a limpeza precisar mesmo vir antes do checkout, então `manter?` a cópia, mas a comparação precisa rodar num job com `node_modules` (pedir ao testes) em vez de pular calada |
| Dono | engenheiro-software |

**Parecer do lote 14: segura (RD-0447).**

---

### Lote 12: `nuvem/inicio-cabecalho-engenheiro-apps` @ `b227367e` (foto do perfil pelo shell)

O branch empilha os commits do Core (`d6a36237`…`e0ac4444`). O `main` já tem esse conteúdo pelo #297, em squash: os arquivos
de `modules/core/app/telas/inicio`, `modules/core/app/index.ts` e `docs/modulos/core/prints/inicio-enquadrado` do branch são
iguais aos do `main`. O delta real é o do shell: `apps/mobile/src/lib/foto-perfil-endereco.ts` (+ teste),
`lib/sync-t0170.ts` (+ teste), `services/miniaturas.ts`, `state/plataforma.tsx` e o diário.

#### Reteste

| RD | Reteste | Status |
|---|---|---|
| RD-0399 item 3 | `export const ENTIDADE_AVATAR = 'usuario_avatar'` saiu de `sync-t0170.ts`. A definição da entidade e o `itemTrocaDeAvatar` usam `ENTIDADE_USUARIO_AVATAR` de `@macuxi/core/app` (a constante do Core, `foto-perfil.ts:10`) | **corrigido** |
| Observação da parte 3 (resolvedor sem quem chame) | `plataforma.tsx:331` chama `ligarResolvedorFotoPerfil`, que chama `definirResolvedorFotoPerfil` do Core e desliga com `null` na saída. O download e a pasta são os da miniatura do Catálogo: `dependencias()` foi extraída e serve aos dois resolvedores; nada de rede ou cache foi refeito | **resolvido** |

#### Achados novos

| Campo | RD-0445 |
|---|---|
| Onde | `apps/mobile/src/state/plataforma.tsx` (b227367e): `:310`, `:329`, `:331` (nova), `:333` e `:1007` |
| Tipo | código |
| O que se repete | A regra "pode baixar agora" `() => !offlineRef.current && sessaoRef.current !== null` está escrita 5× no mesmo arquivo; este lote acrescenta a 5ª, para a foto do perfil |
| Impacto | manutenção: uma condição nova (por exemplo, sessão expirada) precisa entrar nas 5 linhas; esquecer uma deixa um único download (miniatura, foto do perfil, foto do PDV) tentando sem sessão |
| Severidade | baixa (código de produção; segura) |
| Proposta | Uma função só, perto das refs: `const podeBaixar = useCallback(() => !offlineRef.current && sessaoRef.current !== null, []);`. As 5 linhas passam a `podeBaixar` (`online: podeBaixar`, `ligarResolvedorMiniatura(api, podeBaixar)`, `ligarResolvedorFotoPerfil(api, podeBaixar)`, `ligarFonteFotoPdv(api, podeBaixar)`) |
| Dono | engenheiro-apps |

| Campo | RD-0446 |
|---|---|
| Onde | `apps/mobile/src/lib/foto-perfil-endereco.test.ts` (b227367e): casos 2 ("sem sinal e sem cache devolve null") e 3 ("falha no download ou foto acima do teto devolve null") × `lib/miniatura-endereco.test.ts:60-76` ("sem sinal, acima do teto, em erro ou com arquivo_id divergente: null e nada gravado") |
| Tipo | teste |
| O que se repete | O `criarResolvedorFotoPerfil` só repassa ao `criarResolvedorMiniatura`. Os casos 2 e 3 repetem, pelo invólucro, o sem sinal, o acima do teto (`baixar` → `null`) e o erro que o teste da miniatura já cobre |
| Impacto | manutenção |
| Severidade | baixa: só teste, **não segura** (R-20261111-190159); entra no lote seguinte |
| Proposta | Apagar os casos 2 e 3. Ficam o 1º (rota `/arquivos/<id>` com `AVATAR_FOTO_MAX_BYTES` e cache) e o 4º (id que não é UUID), que são o que o invólucro acrescenta |
| Dono | engenheiro-apps |

Sem texto de tela novo. Os 2 prints (`…nome-curto-com-foto.png`, `…nome-longo-sem-foto.png`) são os do #297, iguais aos
do `main`: não mudou cor nem layout neste delta, então não precisa do design-de-marca.

**Parecer do lote 12: segura (RD-0445). O RD-0446 não segura.**

---

### Lote 10: `nuvem/chave-conector-modulo-integracao` @ `3352c984` (lido na parte 2 no mesmo SHA)

O branch não avançou. O diff refeito contra o `main` novo (`b536b829`) dá os mesmos 3 arquivos (+57 −8), e o merge-tree é
limpo. Os 12 commits que o `main` ganhou desde a base (`a073edf1`) não tocam `apps/conector`, e nenhum outro lugar do `main`
usa `macuxi-2026` nem `CHAVE_PUBLICA_ID`. O parecer não muda:
- RD-0424 (2º e 4º casos de `chaves.test.ts` repetem `assinatura.test.ts`): **aberto**, só teste, não segura.
- `CHAVE_PUBLICA_ID` de `pacote.mjs` × o id do mapa de `chaves.ts`: continua `manter?`, com a mesma sugestão de teste
  (`CHAVE_PUBLICA_ID in CHAVES_PUBLICAS_PACOTE`).

**Parecer do lote 10: sem achado que segure.**

---

## Rascunho B: revisão do BKO (Vendedor, Core, Catálogo, Treinamento) e logo do cliente (itens 1, 2, 3, 4 e 11)

Os 5 branches mesclam no `main` sem conflito (`git merge-tree`). Spec: `docs/design/telas/bko-revisao.md`.

### Lote 1: `nuvem/bko-revisao-modulo-vendedor` @ `f93f44cd` (PR #298; lido na parte 5)

O head continua `f93f44cd`. O `main` (`b536b829`) não mexeu em `modules/vendedor/api/pedidos.ts` nem no teste FB-1
(`tests/modulos/filial-filtro-reserva-t0149.test.ts`).

| RD | Reteste | Status |
|---|---|---|
| RD-0441 | Os dois arrays de 17 parâmetros continuam em `pedidos.ts:202` e `:214` | **aberto** |

**Parecer do lote 1: segura, sem mudança (RD-0441, média, código de produção; modulo-vendedor e testes juntos).**

---

### Lote 2: `nuvem/bko-revisao-modulo-core` @ `da495ed0` (lido na parte 4 em `6bf52819`)

Lido `git diff 6bf52819 da495ed0` (28 arquivos, um commit). Abertos os prints "depois" de Indicadores, Rotas, Visitas,
Coordenadas e Filiais.

| RD | Reteste | Status |
|---|---|---|
| RD-0416 | `useBuscaComEspera(valor, aoMudar, espera?)` fica só em `web/lib/lista-bko.tsx:17-52`, e os `setTimeout` de Aparelhos e Farol saíram (`aparelhos-page.tsx:70` e `farol-page.tsx:145` usam o hook). Produtos e Medidas passaram para a mesma assinatura. O hook é igual, linha a linha, ao do Catálogo (`catalogo/web/lib/lista.tsx:14-50`): mudam só os comentários e a ordem dos imports | **em correção**: Core feito; falta o kit (designer-ux) |
| RD-0417 | `LimparFiltros({ ligado, onLimpar, testId? })` em `lista-bko.tsx:55` é usado em todas as listas do Core (aparelhos, carteira, farol, indicadores, metas, rotas, visitas, produtos, medidas, tarefas). Nenhum botão "Limpar filtros" à mão sobrou no Core. O componente é igual ao do Catálogo (`lista.tsx:53`) | **em correção**: Core feito; falta o kit |
| RD-0419 | Coluna "Por dia útil (12 restantes)" (`indicadores.ts:31-34`), e a célula traz só "R$ 3.125", "Batida" ou "—" (`:37-42`). No print, o valor aparece inteiro nas 6 linhas. O CSV mantém a frase (teste `indicadores.test.ts:39`) | **corrigido** |
| RD-0420 | Saíram de Indicadores o botão "Definir meta de venda", a gaveta, o `useMutation` e o `Notice`. A meta se define só em Metas e RV | **corrigido** (sobra: RD-0448) |
| RD-0421 | Três cartões em Rotas: "Visitadas 8 de 24 · 33%", "Em atendimento 0" e "Km total". Saíram "Visitas planejadas" e "Pendentes" | **corrigido** (sobra: RD-0449) |
| RD-0422 | Visitas: "14/11 às 08:05" (`formatDateTime` do kit), sem corte no print. Coordenadas: data e hora numa linha e o vendedor embaixo, os dois inteiros | **corrigido** |

O que passa:
- **MC-0073**: o selo de inativo foi para `neutral` em Filiais, Fotos do PDV, Motivos e Medidas. Não há texto novo. Em
  Filiais, "Ativa" e "Inativa" ficam no mesmo tom, e a linha inativa fica esmaecida. É cor: precisa da validação do
  design-de-marca.
- **Cliente 360**: "Última compra" em dd/mm/aaaa. **Carteira**: a coluna Frequência foi de 170 para 210 px. As duas
  observações da parte 2 para o testes foram resolvidas.
- `quando` (`web/lib/visitas.ts:23`) continua em uso no CSV de Visitas e no Cliente 360; não ficou morto.

#### Achados novos

| Campo | RD-0448 |
|---|---|
| Onde | `modules/core/web/lib/indicadores.ts:51-56` (`centavosDoTexto`) × `modules/core/web/lib/plano-rv.ts:112-117` (`centavosDoTexto`); único chamador da primeira: `web/lib/metas.ts:9` |
| Tipo | código |
| O que se repete | A mesma função, com o mesmo corpo, está em 2 arquivos do Core. A cópia de `indicadores.ts` ficou sem uso em Indicadores depois do RD-0420, e o branch trocou o comentário para "Usado pela tela Metas e RV" em vez de tirá-la de lá. O teste dela também saiu (`indicadores.test.ts`); o de `plano-rv.test.ts:56-58` cobre o mesmo |
| Impacto | manutenção: uma regra de parse de dinheiro em dois lugares do mesmo módulo, e uma delas sem teste |
| Severidade | baixa. É código de produção num arquivo que o branch mudou: **segura o Core** |
| Proposta | Apagar `centavosDoTexto` de `indicadores.ts`. `metas.ts:9` passa a ler `import { centavosDoTexto } from './plano-rv';`. Para depois, sem segurar: o Catálogo tem uma 3ª versão, mais rígida (`catalogo/web/lib/tabelas-preco.ts:41`), e o kit tem `parseDecimalInput` (`packages/ui/src/web/format.ts:111`). A versão única de reais → centavos é candidata ao kit |
| Dono | modulo-core |

| Campo | RD-0449 |
|---|---|
| Onde | `modules/core/web/lib/routes.ts:284-285` e `:308-309` (`RouteKpis.pending`, `RouteKpis.avgPerRoute`); `routes.test.ts:229-230` |
| Tipo | código |
| O que se repete | Depois do RD-0421, nenhum lugar lê `kpis.pending` nem `kpis.avgPerRoute`: a tela usa `routes`, `planned`, `done`, `inProgress` e `km` (`routes-page.tsx:263,313-315`). Os dois campos continuam calculados e conferidos no teste. A lista da direita calcula as pendentes de cada pessoa por conta própria (`routes-page.tsx:458`) |
| Impacto | manutenção: dois números calculados e testados que nenhuma tela mostra |
| Severidade | baixa. É código de produção: **segura o Core** |
| Proposta | Tirar `pending` e `avgPerRoute` de `RouteKpis` e de `routeKpis`. Os dois `expect` do teste ficam `{ routes: 2, planned: 4, km: 21, done: 1, inProgress: 1 }` e `{ routes: 0, planned: 0, km: 0, done: 0, inProgress: 0 }` |
| Dono | modulo-core |

**Parecer do lote 2: segura (RD-0448 e RD-0449, baixa, código de produção).** O RD-0416 e o RD-0417 não seguram mais o Core
(decisão do gerente-projetos, 15/11, madrugada; veja "Decisões do gerente-projetos"). A MC-0073 é cor e precisa da validação do design-de-marca.

---

### Lote 3: `nuvem/bko-revisao-modulo-catalogo` @ `364ac40a` (lido na parte 4 em `a058713b`)

Lido `git diff a058713b 364ac40a` (9 arquivos). Abertos os prints `catalogo-produtos-depois` e `marcas-depois`.

| RD | Reteste | Status |
|---|---|---|
| RD-0416 | `web/lib/busca-com-espera.ts` virou `web/lib/lista.tsx`, com o hook na assinatura do kit, usado em `catalogo-page.tsx:148`, `marcas-page.tsx:61` e `tabelas-preco-page.tsx:92,169`. É igual ao do Core (lote 2). O arquivo diz "Vai para o kit (packages/ui) pelo RD-0416 e RD-0417; então só muda o import." | **em correção**: Catálogo feito; falta o kit |
| RD-0417 | As 4 cópias do botão saíram; os 4 lugares usam `LimparFiltros` de `lista.tsx:53` | **em correção**: Catálogo feito; falta o kit |
| RD-0423 | Nenhum `rotulo="Mais ações"` no módulo | **corrigido** |
| RD-0438 | Saiu a coluna "Destaque". O selo `pending` "Destaque" fica ao lado do nome, só nos 3 marcados. Os outros não levam "—" | **corrigido** |
| RD-0439 | Saiu a coluna "Situação" de Marcas. O filtro "Situação: Ativas" fica, e a lista mostra Marca, Referências e Código no ERP | **corrigido** |

O README dos prints diz a origem nova. Continua sem prints "antes" (§P11), o que já estava anotado para o testes na
parte 4.

**Parecer do lote 3: sem achado em aberto.** O RD-0416 e o RD-0417 passaram a segurar o lote do kit
(decisão do gerente-projetos, 15/11, madrugada; veja "Decisões do gerente-projetos"). A MC-0071 e a MC-0072 (parte 4) continuam com o design-de-marca.

---

### Lote 4: `nuvem/bko-revisao-modulo-treinamento` @ `cf22a7a6` (lido na parte 4 em `1d1436eb`)

Lido `git diff 1d1436eb cf22a7a6` (2 arquivos, 2 linhas).

| RD | Reteste | Status |
|---|---|---|
| RD-0437 | `<MenuAcoes acoes={acoes} />` em `trilhas-page.tsx` e também em `trilha-editar-page.tsx`, que a parte 4 não tinha listado. Nenhum `rotulo="Mais ações"` no módulo. Pesquisa (`construtor-page.tsx:144`, `resultados-page.tsx:134`) e Promotor (`cadastros-page.tsx:149`, `trade-page.tsx:99`) continuam no `main` e corrigem no próximo lote de cada um | **corrigido no Treinamento**; aberto em Pesquisa e Promotor |
| RD-0416 | `function BuscaComEspera` (`trilhas-page.tsx:157-164`) não mudou: é a 3ª versão entre módulos, com outra forma (componente com `key` para limpar) | **em correção**: depende do kit; o Treinamento troca no lote seguinte ao kit |
| RD-0417 (ampliado) | O botão "Limpar filtros" está escrito à mão em `trilhas-page.tsx:140-144`; a parte 4 não pegou. Entra na mesma troca do kit | **em correção**: depende do kit |

**Parecer do lote 4: sem achado em aberto.** O RD-0416 e o RD-0417 passaram a segurar o lote do kit
(decisão do gerente-projetos, 15/11, madrugada; veja "Decisões do gerente-projetos"). O MC-0065
continua com o design-de-marca.

---

### Lote 11: `nuvem/logo-cliente-designer-ux` @ `c6d5a4b4` (lido na parte 4 em `64a18b97`)

Lidos `147ce5cf` (RD-0440) e `c6d5a4b4` (decisão do dono do produto R-20261114-234500: carga A, login sem logo). Abertos
`carga-campo.png` e o antigo `carga-campo-a.png`.

| RD | Reteste | Status |
|---|---|---|
| RD-0440 | A decisão A/B foi fechada pelo dono do produto e saiu da spec: §3 descreve só a carga com a logo ao lado; a tabela A × B, a opção C e o histórico da placa de 84 dp saíram; o §8.1 ficou só com a regra do manual. Saíram `login.html`, os PNG do login e os de B, e nenhum arquivo aponta para eles | **corrigido** |

O que passa:
- A frase do Mais é "Licenciado para <nome fantasia>" (§5, l.133), como foi combinado, e `mais.html:43` mostra
  "Licenciado para Exemplo Norte". Sem nome fantasia, vale a razão social (l.139).
- §4 diz numa linha que o login e as telas de senha ficam sem a logo. A tabela "Quem faz" tirou o login do engenheiro-apps,
  e a placa do kit ficou só com 52/36 do Mais e 64/48 da carga.

#### Achados novos

| Campo | RD-0450 |
|---|---|
| Onde | `docs/design/telas/logo-cliente.md:5`, `:17-18` e `:20-21` (as notas do topo) × §3, §4 e §5 |
| Tipo | doc |
| O que se repete | O topo traz 3 notas de decisão sobre o que o corpo já diz. A l.5 ("Frase do Mais com o **nome fantasia** (decisão…, R-20261114-223500)") repete o §5, l.139 ("**Nome:** o **nome fantasia** da empresa (R-20261114-223500)"). A "Revisão de 2026-11-15" (l.17-18: "MC-0066, carga com logo (§3)") e a "Decisão do dono do produto" (l.20-21: "fecha a carga (§3, MC-0066 decidida)") dizem 2× que a carga está no §3 com a MC-0066 |
| Impacto | leitura: quem implementa lê três notas antes da spec, e duas dizem a mesma coisa |
| Severidade | baixa. É doc de produto: **segura** |
| Proposta | Trocar a l.5 e as duas notas (l.17-21) por uma só: "> **Decisões** (R-20261114-223500 e R-20261114-234500-alexandre; MC-0066 e MC-0067, parecer do design-de-marca `docs/marca/pareceres/2026-11-15-lote-noite.md`, parte 2, lote 13): carga com a logo ao lado (§3), login e telas de senha sem logo (§4), placa 52/36 e nome fantasia no Mais (§5). O portal e os PDFs ficam como nesta simulação." |
| Dono | designer-ux |

| Campo | RD-0451 |
|---|---|
| Onde | `docs/design/telas/logo-cliente/carga.html:61` e os PNG `carga-campo.png` e `carga-gestao.png` (as duas telas, sem e com logo) |
| Tipo | texto (simulação de tela) |
| O que se repete | A linha da barra mostra "Etapa 2 de 5 · Clientes e rota", e logo abaixo a lista de etapas destaca "Clientes e rota". O mesmo fato aparece 2×, e "2 de 5" é a 3ª forma do progresso, com "38%" e a barra. É a repetição do RD-0239, corrigido no app: com a lista na tela, o rótulo "Etapa n de N · nome" vai só ao leitor de tela (`apps/mobile/src/lib/entrada.ts:78-82`, `tela-entrada.tsx:147`; teste `tela-carga.test.tsx:213`: `not.toMatch(/Etapa \d de \d/)`). A spec diz "Sem logo: igual a hoje", e a tela sem logo da simulação não é igual a hoje |
| Impacto | leitura e risco de volta: é a imagem que vai ao dono do produto, ao design-de-marca e ao engenheiro-apps como referência da carga, e ela traz de volta uma redundância já tirada |
| Severidade | média (o mesmo fato 2× na tela de referência; segura) |
| Proposta | `carga.html:61`: a linha mostra só o percentual, `<div class="linha" …><span></span><b>38%</b></div>` (ou a mesma linha do app de hoje), com `aria-label="Etapa 2 de 5 · Clientes e rota"`. Gerar de novo `carga-campo.png` e `carga-gestao.png` |
| Dono | designer-ux |

**Parecer do lote 11: segura (RD-0451, média; RD-0450, baixa, doc).** É layout: o design-de-marca valida os prints da carga,
e eles precisam ser refeitos pelo RD-0451.

---

## Rascunho C: rodapé legal, ações da empresa, e-mails de senha e kit da thathyany (itens 5 a 9)

### Lote 5: `nuvem/rodape-shell-engenheiro-apps` @ `474164cb` (lido na parte 4 em `155bc0d4`)

Lido `git diff 155bc0d4 474164cb` (um commit, 9 arquivos). **Não há prints** no branch: nem do rodapé no aparelho e no BKO,
nem o antes/depois de Auditoria e Início pedido na §P11 (segue para o testes e o gerente, abaixo).

| RD | Reteste | Status |
|---|---|---|
| RD-0433 | Item (2) feito: `mascaraCnpj` saiu dos dois shells, e os dois usam `somenteDigitos` e `formatarDocumento` de `@macuxi/comum/documento` (14 dígitos dão a mesma máscara). O teste das linhas ficou só no app (`apps/web/components/rodape-legal.test.tsx` perdeu o caso "a montagem é a mesma do app"). **Falta o item (1):** `apps/mobile/src/lib/rodape-legal.ts` e `apps/web/lib/rodape-legal.ts` continuam iguais linha a linha (`DadosDoRodape`, `LinhasDoRodapeLegal`, `NBSP`, `siteDoRodape`, `linhasDoRodapeLegal`); o comentário dos dois chama a cópia de "Pendência (RD-0433)". Nenhum branch no remoto tem `packages/ui/src/comum/legal.ts`. O engenheiro-apps não pode criar a cópia única sozinho (os dois lugares possíveis são de outro dono) | **em correção**. A cópia única fica no kit (`packages/ui`), com o designer-ux, como a spec §5 pede; o RD-0433 deixa de segurar este lote e segura o lote do kit; o engenheiro-apps troca o import no lote seguinte (decisão do gerente-projetos, 15/11, madrugada; veja "Decisões do gerente-projetos") |
| RD-0434 | `<Panel>` sem `label`; o `rotulo="Trilha de auditoria"` ficou só na `TabelaDados` (leitor de tela). O teste confere 1 ocorrência | **corrigido** |
| RD-0435 | `LIMITE_AUDITORIA = 300` só em `apps/web/lib/queries.ts:99`, usado no `useAuditoria` (`:111`) e importado pela página; o teste lê a mesma constante | **corrigido** |
| RD-0436 | `modules/core/app/components/tela-login.tsx:24,31,118` igual no `main`, no `login-v109-modulo-core` (`d955b035`) e aqui. Nenhum chamador passa `rodape` à `TelaLogin` (os `rodape=` do grep são da `Folha`/`BottomSheet`) | **aberto** (modulo-core; não segura o shell, entra no próximo lote do Core) |

O que passa:
- MC-0074: `accent-color: var(--color-accent)` nas caixas nativas, uma regra só em `globals.css` (sem outra cópia no repo).
  É **cor**: precisa da validação do design-de-marca.
- O RD-0417 (Limpar filtros à mão na Auditoria) segue ampliado, como na parte 4.
- `git merge-tree` com o `main` e com `16e6eb4a` sai limpo. O branch ainda mescla o `788cc483`, e não o `16e6eb4a`; não toca
  no `portal-comum.ts`.

**Parecer do lote 5: sem achado em aberto.** O RD-0433 passou a segurar o lote do kit (decisão do gerente-projetos, 15/11, madrugada; veja "Decisões do gerente-projetos"); o RD-0436 é do Core
e não segura o shell. Faltam os prints da §P11: é observação para o testes, não RD. Rodapé e MC-0074 precisam do
design-de-marca.

---

### Lote 6a: `nuvem/rodape-legal-engenheiro-software` @ `16e6eb4a` (sem avanço desde a parte 4)

Head igual ao da parte 4. `git merge-tree` com o `main` (`b536b829`) sai limpo. A rota não repete nenhum dado legal como
constante: o padrão do site vem de `SITE_PADRAO` do SDK, a forma do CNPJ e do site fica no `GravarDadosLegaisSchema`, e a
frase do 403 (`SO_A_MACUXI`) é uma só para as duas rotas do portal.

**Parecer do lote 6a: sem achado em aberto.** (A ordem de merge com as ações da empresa continua a do RD-0428, lote 7b.)

---

### Lote 6b: `nuvem/rodape-legal-banco-dados` @ `c2db8450` (primeira avaliação)

O branch está sobre o `a9965d78` (API antiga do rodapé). O commit do banco-dados é só o `c2db8450` (9 arquivos): migração
0073 (up/down), espelho Drizzle, `conferir-rls.sql`, `excecoes.ts`, `funcoes-sa.ts`, `estatico.test.ts`,
`diagnostico.test.ts` e o teste novo `dados-legais.db.test.ts`.

O que passa:
- O banco não repete a validação da API além da defesa em profundidade que a regra 2 pede: os CHECKs conferem a forma (razão
  social, 14 dígitos, domínio), e o dígito verificador fica só no contrato e na API. `manter`.
- A leitura do portal (`sa_dados_legais`) devolve `dados_legais_publicos()`, sem montar o jsonb de novo.
- As listas de exceção (`excecoes.ts` × `conferir-rls.sql`) já são espelho conferido por teste; a 0073 só acrescenta a linha.
- O teste estático (texto do SQL, roda na sessão) e o de banco (comportamento, roda no CI) cobrem coisas diferentes.

| Campo | RD-0452 |
|---|---|
| Onde | `db/migrations/0073_plataforma_dados_legais.up.sql`: l.41 (`default` da coluna), l.66 (`insert … values (null, null, 'macuxifdv.com.br')`), l.81 (o padrão da `dados_legais_publicos`), l.154 e l.162 (`v_antes` na `sa_gravar_dados_legais`) |
| Tipo | código |
| O que se repete | O jsonb "sem dados" `jsonb_build_object('razao_social', null, 'cnpj', null, 'site', 'macuxifdv.com.br')` está escrito 3× (padrão da leitura pública e os dois ramos do `v_antes`), e o site padrão aparece 5× no SQL (o `default` da coluna, o `insert` e os três jsonb). O `v_antes` dos três casos (sem linha, linha apagada, linha viva) é exatamente o que `plataforma.dados_legais_publicos()` devolve antes da gravação |
| Impacto | manutenção: se o padrão mudar, são 5 lugares numa função que audita o "antes"; um esquecido grava na auditoria um "antes" diferente do que a tela mostrava |
| Severidade | baixa. É código de produção (migração ainda não aplicada; depois do merge não muda mais), então **segura** |
| Proposta | Na `sa_gravar_dados_legais`, logo depois do `select … for update`: `v_antes := plataforma.dados_legais_publicos();`. O ramo `if not found` fica só com o `insert`, e o `else` só com o `update` (sai o `case`). Na linha da migração: `insert into plataforma.dados_legais default values;` (usa o `default` da coluna). O literal fica em 2 lugares (o `default` da coluna e o padrão da leitura pública). Os testes estáticos que procuram o texto antigo acompanham |
| Dono | banco-dados |

| Campo | RD-0453 |
|---|---|
| Onde | `db/testes/dados-legais.db.test.ts:132` (`como`, 12ª cópia) e `db/testes/plano-assinatura.db.test.ts:163-174` (`qsp`, novo em `a298381f`, branch `nuvem/empresa-acoes-banco-dados`) × `db/testes/empresa-acoes.db.test.ts:219-224` (`erroDoAdmin`) |
| Tipo | teste |
| O que se repete | (1) O `como(papel, sql, params, tenant?)` com `savepoint`/`set local role`/`rollback to savepoint` está escrito em 10 arquivos no `main` (cargo-hierarquia, diagnostico, papel-portal, perfis-acesso, portal-admin-multiperfil, portal-email-senha, portal-multiperfil, portal-redefinir-senha, senha-email-saida, super-admin) e ganhou mais 2 (empresa-acoes, dados-legais). (2) O `qsp` (comando do admin num savepoint, para o erro esperado não abortar o caso) é o mesmo `erroDoAdmin` do `empresa-acoes.db.test.ts`, no mesmo branch |
| Impacto | manutenção: um ajuste no padrão do savepoint (como o 25P02 que motivou o `qsp`) tem de ser repetido em 12 arquivos |
| Severidade | baixa. Está **só em teste**, então **não segura** (R-20261111-190159) e entra no lote seguinte |
| Proposta | Em `db/testes/util.ts`, ao lado do `erroDe`: `export async function comoPapel<T>(admin, papel, sql, params = [], tenant?)` e `export async function erroNoSavepoint(admin, sql, params = [])` (o corpo do `erroDoAdmin`). O `plano-assinatura` usa `erroNoSavepoint` no lugar do `qsp`; os arquivos novos (empresa-acoes, dados-legais) usam `comoPapel`; os 10 antigos migram quando forem tocados |
| Dono | banco-dados |

**Parecer do lote 6b: segura (RD-0452, baixa, código de produção; RD-0453 só teste, não segura).**

---

### Lote 7a: `nuvem/empresa-acoes-banco-dados` @ `a298381f` (lido na parte 1 em `60a31e44`)

Lido `git diff 60a31e44 a298381f`: um arquivo, `db/testes/plano-assinatura.db.test.ts` (+14 −2), o `qsp` em savepoint para os
dois CHECKs esperados (23514 e 23505). A cópia do `erroDoAdmin` entra no RD-0453 (só teste). `merge-tree` com o `main` limpo.

**Parecer do lote 7a: sem achado em aberto** (o RD-0453 é só de teste e não segura).

---

### Lote 7b: `nuvem/empresa-acoes-engenheiro-software` @ `f75cc7dc` (sem avanço desde a parte 4)

O head é o mesmo que a parte 4 usou no `merge-tree`. Histórico conferido:
- `b9e9c577` (parte 3) já tinha a forma nova: `type AutenticarPortal`, `exigirSuperAdmin(dep.autenticar, …)`.
- `c002ecd5` mesclou o **`788cc483`** (rodapé antigo), e o `f75cc7dc` voltou a rota para a forma antiga
  (`extends AutenticacaoDoPortal`, `exigirSuperAdmin(dep, …)`, l.43, l.105 e l.172).
- O `16e6eb4a` (rodapé) adotou a forma do `b9e9c577`. Os dois trocaram de lado.

| RD | Reteste | Status |
|---|---|---|
| RD-0428 | Sem mudança. `merge-tree` de `16e6eb4a` com `f75cc7dc` sai sem conflito de texto, mas a árvore fica com o `portal-comum.ts` sem `AutenticacaoDoPortal` e com `empresa-acoes-portal.ts` importando esse tipo e chamando `exigirSuperAdmin(dep, …)`: o typecheck da API quebra. Proposta, a mesma: mesclar o `16e6eb4a` e voltar a rota à forma do próprio `b9e9c577` (`DepsAcoesEmpresa { autenticar: AutenticarPortal; … }`, `exigirSuperAdmin(dep.autenticar, …)`, `hint` como `string`) | **em correção** (segura este lote) |
| RD-0406 | A API usa `chaveDeTentativaDoPortal` do SDK (`@macuxi/platform-sdk/tentativas-portal`). O Core continua com `chaveDeTentativa` (`modules/core/api/seguranca-plataforma.ts:29`) em todos os branches do Core no remoto | **em correção** (falta o modulo-core depois do merge; não segura este lote) |

O commit `f75cc7dc` também acrescenta a `sa_gravar_assinatura` e as 8 da 0072 em `apps/api/test/funcoes-sa.ts` (`SA_PORTAL`,
25) e no espelho de `scripts/deploy/producao/banco-dbaas.sh`. As três listas (banco, API e script de deploy) já eram espelhos
conferidos por teste; o `.sh` precisa da lista em texto. `manter`. Ver a observação 7 para o testes (parte 6) (as 2 `sa_*` da 0073).

**Parecer do lote 7b: segura (RD-0428).**

---

### Lote 7c: `nuvem/empresa-acoes-engenheiro-apps` @ `8705f496` (lido na parte 3 em `d807bcf0`)

Lido `git diff d807bcf0 8705f496`: o merge do `b9e9c577` (já lido na parte 3) e o `8705f496` (RD-0429).

| RD | Reteste | Status |
|---|---|---|
| RD-0429 | `MENSAGENS_DA_API` saiu de `apps/web/lib/portal-falso.ts`. `fraseDaApi(codigo: CodigoAcaoEmpresa)` lê `MENSAGENS_ACOES_EMPRESA` do SDK, também no 404 `naoEncontrada`. Os testes comparam com a constante do SDK, e não com a frase escrita à mão | **corrigido** |

| Campo | RD-0454 |
|---|---|
| Onde | `apps/web/lib/portal-falso.ts:205` (`'Só o time da Macuxi usa estas ações.'`) × `apps/api/src/empresa-acoes-portal.ts:175` (`'Só o time da Macuxi faz esta ação.'`, literal sem constante) |
| Tipo | texto |
| O que se repete | O 403 das ações da empresa tem duas frases: a da API e a do modo falso. É a última recusa das ações que o `portal-falso.ts` ainda escreve à mão, depois do RD-0429 |
| Impacto | leitura: o print e a demonstração no modo falso mostram uma frase que a API não manda |
| Severidade | baixa. É texto de código de produção, então **segura** |
| Proposta | No SDK (`packages/platform-sdk/src/empresa-acoes.ts`): `export const MENSAGEM_SO_SUPER_ADMIN_ACOES = 'Só o time da Macuxi faz esta ação.';`. A API usa em `exigirSuperAdmin(…, MENSAGEM_SO_SUPER_ADMIN_ACOES)`, e o modo falso em `erro(403, 'PERFIL_SEM_ACESSO', MENSAGEM_SO_SUPER_ADMIN_ACOES)` |
| Dono | engenheiro-apps (constante no SDK e uso na API: engenheiro-software) |

Merge: este branch carrega o `portal-comum.ts` do `b9e9c577`. `merge-tree` com o `f75cc7dc` sai limpo, mas com o `16e6eb4a`
dá **add/add** em `apps/api/src/portal-comum.ts` e conflito em `apps/api/src/app.ts`. Depois que o 7b mesclar o `16e6eb4a`
(RD-0428), este branch mescla o 7b corrigido antes de entrar.

**Parecer do lote 7c: segura (RD-0454, baixa; ordem de merge do RD-0428).**

---

### Lote 8a: `nuvem/email-senha-engenheiro-software` @ `da106be2` (lido na parte 3; o `main` avançou)

O head não mudou. O `main` foi de `a073edf1` (base do branch) a `b536b829` (12 PRs). Conferido o que o `main` trouxe perto do
branch: `modules/core/api/email.ts` (só um comentário), `contracts/senha-regra.ts` (`temEspacoNasPontas`, RD-0431) e o código
UF+4. O `DadosMensagemEmailSchema` do SDK tem o seu `.refine((s) => s === s.trim())`, mas essa linha já está no `main`
(`modelos.ts:58`) e não é do branch; o SDK não pode importar do Core. O modelo mostra `codigo_empresa` como veio, sem regra
própria de formato. `merge-tree` com o `main` limpo.

**Parecer do lote 8a: sem achado em aberto.**

### Lote 8b: `nuvem/email-senha-testes` @ `32bb52c8` (primeira avaliação)

Diff completo = o lote 8a + o `32bb52c8`, que só ajusta as duas asserções de assunto do CS-09
(`tests/integracao/api/ciclo-senha-t0094.test.ts:1124` e `:1131`) para `Subject: ${codificarCabecalho(ASSUNTOS_EMAIL[…])}\r\n`.
Não é caso novo: troca o esperado de duas linhas que já existiam. Os testes de unidade do `mime.test.ts` e do
`arquivo.test.ts` conferem a codificação com um assunto fixo; o CS-09 confere o assunto de cada modelo no fluxo de ponta a
ponta. `manter`. `merge-tree` com o `main` limpo.

**Parecer do lote 8b: sem achado em aberto.**

---

### Lote 9a: `nuvem/kit-thathyany-modulo-integracao` @ `f3619bc4` (kit 1.0.3; lido na parte 4 em `665c5c06`)

Lidos os 6 commits (`98fafdd5` a `f3619bc4`, 9 arquivos): ROTEIRO, `Instalar-Thathyany.ps1`, `carga_csv.py` e o teste dele,
`contrato.json`, `gerar.ts`, `gerar-zip.mjs`, `criar-banco.sql` e `kit-thathyany.test.ts`.

O que passa:
- As regras do Hub entram no contrato do kit por uma tabela só (`OBRIGATORIOS_EXTRA`, `REGRA_EXTRA_DO_CAMPO`,
  `REGRAS_ENTIDADE` em `gerar.ts`), e os obrigatórios da filial vêm de `CAMPOS_OBRIGATORIOS_FILIAL` do Core, sem cópia. A sonda
  contra o Zod real confere que kit e Hub não divergem.
- O dígito verificador do CNPJ em Python repete o `packages/comum/src/documento.ts`, mas o kit roda sozinho no notebook, sem
  Node do repositório: `manter`.
- `servidor.txt` grava o servidor uma vez (instalador) e o `carga_csv.py` lê.
- A versão do zip (`VERSAO_KIT = '1.0.3'`) e o nome no ROTEIRO batem.

| Campo | RD-0455 |
|---|---|
| Onde | `modules/integracao/kit-thathyany/carga_csv.py:88-106` (`_dv_cpf`, `cpf_valido`), `:242-245` (regras `cpf` e `cpf_cnpj` em `converter_celula`), `:73-75` (`_so_digitos`) × `:236` (`re.sub(r"\D", "", texto)`), `:54-60` (`r".\SQLEXPRESS"` 2×); `testes/test_carga_csv.py:213-227` |
| Tipo | código |
| O que se repete | (1) Código morto: o contrato só emite a regra `cnpj` (`Regra` de `gerar.ts` não tem `cpf` nem `cpf_cnpj`; `contrato.json` só tem `"cnpj": true`). O próprio `gerar.ts` diz que o dígito do documento do cliente não entra, porque o Hub o trata como ausente (RN-INT-14). Mesmo assim, o Python traz `cpf_valido`, `_dv_cpf` e os ramos `cpf` e `cpf_cnpj`, com 2 testes só para eles. (2) O "só dígitos" está em `_so_digitos` e de novo, à mão, na l.236. (3) O padrão `.\SQLEXPRESS` está 2× em `servidor_padrao` |
| Impacto | manutenção: regra que o contrato nunca liga; se alguém ligar `cpf_cnpj` no cliente, o kit passa a recusar o que o Hub aceita (contra a RN-INT-14) |
| Severidade | baixa. É código de produção do kit, então **segura** |
| Proposta | Apagar `_dv_cpf`, `cpf_valido`, os dois `if regra.get("cpf…")` e os testes `test_cpf_valido_e_invalido` e `test_regras_cpf_e_cpf_cnpj_na_celula`. Na l.236: `so_digitos = _so_digitos(texto) if campo["campo"] != "ean" else texto`. Em `servidor_padrao`: `SERVIDOR_PADRAO = r".\SQLEXPRESS"` no topo, usado nos dois `return` e no `help` do `--servidor` |
| Dono | modulo-integracao |

| Campo | RD-0456 |
|---|---|
| Onde | `modules/integracao/kit-thathyany/Instalar-Thathyany.ps1:407-409` (`Passo-Api`) × `:204-210` (`Achar-Node`) |
| Tipo | código |
| O que se repete | `Passo-Api` procura o `npm.cmd` com a mesma lógica do `Achar-Node` (primeiro `Program Files\nodejs\npm.cmd`, depois `Get-Command npm.cmd`), escrita de novo |
| Impacto | manutenção: se a busca do Node mudar (como mudou neste lote), o passo 1 acha e o passo da API não |
| Severidade | baixa. É código de produção do kit, então **segura** |
| Proposta | Em `Passo-Api`: `$npm = Achar-Node` e `if (-not $npm) { Falha 'Nao achei o Node.js (npm.cmd). Feche e abra o PowerShell como administrador e rode de novo.' }` |
| Dono | modulo-integracao |

| Campo | RD-0457 |
|---|---|
| Onde | `modules/integracao/kit-thathyany/ROTEIRO.md:11` ("O que ter em mãos", item SQL Server Express) × `Instalar-Thathyany.ps1` `Detectar-Instancia` (as duas `Falha` com o link e com `-Instancia <nome>`) |
| Tipo | doc · texto |
| O que se repete | O item conta o que o instalador faz ("o instalador usa o que já está instalado. Se não houver, ele mostra o link…") e repete a instrução `-Instancia <nome>`, que o instalador já dá na hora em que ela é preciso (só com mais de uma instância) |
| Impacto | leitura: o item de preparo vira explicação de funcionamento (R-20261110-192153); a mesma instrução fica em dois lugares |
| Severidade | baixa. É doc do kit, então **segura** |
| Proposta | "- **SQL Server Express instalado no notebook:** se ainda não houver, instale o SQL Server 2022 Express (instalação Básica) no idioma do Windows. O banco é o `ERP_THATHYANY`." |
| Dono | modulo-integracao |

| Campo | RD-0459 |
|---|---|
| Onde | `modules/integracao/kit-thathyany/kit-thathyany.test.ts`, `describe('T-0174 defeito 4…')`: casos "filial: o contrato do kit exige CNPJ (DV), logradouro…" e a parte do `carga_csv.py` do caso "negativo: filial sem logradouro ou com CNPJ de DV errado…" × `testes/test_carga_csv.py:234-245` e o caso "sonda" do mesmo `describe` |
| Tipo | teste |
| O que se repete | (1) O caso "negativo" roda o `carga_csv.py --validar` com filial sem logradouro e com CNPJ de DV errado e confere a recusa sem citar o valor: é o `test_filial_sem_logradouro_ou_com_cnpj_de_dv_errado_e_recusada_sem_citar_o_valor` do Python. (2) O caso "filial: o contrato exige…" confere os obrigatórios da filial, que a sonda já confere campo a campo contra o Zod real (e o Python, na l.241) |
| Impacto | manutenção: a mesma regra em três testes |
| Severidade | baixa. Está **só em teste**, então **não segura** (R-20261111-190159) e entra no lote seguinte |
| Proposta | O caso "negativo" fica só com o lado do Hub (`SCHEMA_REGISTRO.filial.safeParse(...)` falha com o CNPJ de DV errado) e com `expect(filial.campos.find((c) => c.campo === 'cnpj')?.regra).toMatchObject({ cnpj: true })`; sai o `spawnSync` do Python e sai o caso "filial: o contrato exige…" |
| Dono | modulo-integracao |

**Parecer do lote 9a: segura (RD-0455, RD-0456 e RD-0457, baixa; RD-0459 só teste, não segura).**

### Lote 9b: `nuvem/kit-ps1-parse-testes` @ `75609a4d` (primeira avaliação)

Lido o commit `75609a4d` (2 arquivos novos em `tests/integracao/`): camada 1 (parser real com `pwsh`) e camada 2
(`checarPs1`, varredura de `$nome:` em string de aspas duplas, here-string e `$(...)`), sobre todo `.ps1` de
`modules/integracao/kit-*`. Os casos sintéticos provam acusação e não acusação. `merge-tree` com o `main` e com o 9a limpo.

| Campo | RD-0458 |
|---|---|
| Onde | `modules/integracao/kit-thathyany/kit-thathyany.test.ts` (9a), caso "nenhum .ps1 do zip tem $var: em string (PowerShell 5.1 lê como variável de unidade)" × `tests/integracao/kits-ps1-parse.test.ts` "camada 2" e `tests/integracao/apoio/ps1-estatico.ts` (9b) |
| Tipo | teste |
| O que se repete | A mesma regra (o defeito do 1.0.0, `"Conector $versao: …"`) conferida 2×, com duas listas iguais dos 8 escopos válidos (`ok` × `ESCOPOS_VALIDOS`). A do 9b cobre mais (todos os `kit-*`, here-strings, `$(...)`, comentário de bloco e o parser real); a do kit é uma regex por linha sobre os `.ps1` do zip |
| Impacto | manutenção: um escopo novo (ou um falso positivo) tem de ser ajustado em dois lugares, de dois donos |
| Severidade | baixa. Está **só em teste**, então **não segura** (R-20261111-190159) e entra no lote seguinte |
| Proposta | Sai o caso do `kit-thathyany.test.ts`; fica o do testes, que já lê os `.ps1` do `kit-piloto/erp-via-api` (a origem dos que o `gerar-zip.mjs` adapta) |
| Dono | modulo-integracao (o caso a tirar é do kit; o do testes fica) |

**Parecer do lote 9b: sem achado em aberto neste branch** (o RD-0458 se resolve no 9a).

---

## Para o testes (parte 6, sem RD)
1. **Lote 13c × ADR 0053 §1**: o app v1.0.10 recusa token Expo (`tokenFcmValido`), mas a ADR fala em "validação que aceita
   os dois". Conferir com o engenheiro-software qual é o comportamento certo; o RD-0442 cuida só de ter uma regra.
2. **Lote 14**: o caso novo do `android-build.test.mjs` passa no CI sem comparar o NDK (o job não tem `node_modules`).
   Se o RD-0447 ficar como `manter?`, a comparação precisa rodar num job que tenha o install.
3. **Lote 4, busca do Treinamento sem Enter:** a §P4 pede "busca ao digitar, espera de 300 ms e Enter". A
   `BuscaComEspera` do Treinamento (`trilhas-page.tsx:157-164`) só tem o `setTimeout`, sem `onKeyDown`. As listas do
   Core e do Catálogo aplicam no Enter. O hook do kit (RD-0416) resolve; até lá, conferir se é aceito.
4. **Lote 2, prints:** os campos de data dos prints (Indicadores "November 2026", Visitas "11/08/2026") saem no formato
   do navegador do Playwright, que não está em pt-BR. Conferir se o BKO de verdade mostra mês e data em português, ou
   gerar os prints com `locale: 'pt-BR'`.
5. **Lote 5:** continuam sem prints o rodapé no aparelho e no BKO e o antes/depois de Auditoria e Início (§P11).
6. **Lotes 6b × 7a (banco):** a 0073 depende da 0070–0072 ("o migrador recusa buraco na numeração"), mas o
   `rodape-legal-banco-dados` não mescla o `empresa-acoes-banco-dados`. O `merge-tree` dos dois dá conflito em 6 arquivos
   (`plataforma.ts` do Drizzle, `conferir-rls.sql`, `excecoes.ts`, `diagnostico.test.ts`, `estatico.test.ts`,
   `funcoes-sa.ts`). Os dois criam `FUNCOES_SA_ATE_0069` e mudam `FUNCOES_SA_ATUAIS` (25 × 18; junto: 27).
7. **Lotes 6a/6b × 7b (listas de `sa_*`):** nenhum branch da API acrescenta `sa_dados_legais(uuid)` e
   `sa_gravar_dados_legais(uuid, jsonb)` em `apps/api/test/funcoes-sa.ts` (`SA_PORTAL`) e no espelho do
   `scripts/deploy/producao/banco-dbaas.sh`. Com a 0073 no `main`, o `funcoes-sa.test.ts` da API e a conferência do deploy
   ("sa_* do catálogo fora das duas listas = erro") devem falhar. Conferir também onde entra a `dados_legais_publicos()`
   (EXECUTE do `macuxi_app`).
8. **Lote 7b:** o typecheck da API quebra no segundo merge (`16e6eb4a` + `f75cc7dc`), como na parte 4; o `merge-tree` não
   acusa porque o conflito não é de texto.

## Para o gerente (parte 6)
- **Decisões a e b** (acima): o designer-ux precisa de tarefa para o lote do kit em `packages/ui` com
  `ESPERA_BUSCA_MS`, `useBuscaComEspera` e `LimparFiltros` (cópia de `modules/catalogo/web/lib/lista.tsx`) e com o
  `rodape-legal` (cópia de `apps/web/lib/rodape-legal.ts`). Depois, Core, Catálogo, Treinamento e o shell (Auditoria e
  rodapé) trocam o import. Os botões "Limpar filtros" à mão que já estão no `main` (Integração `lotes-panel.tsx:73`,
  Pesquisa `questionarios-page.tsx:127`, Promotor `trade-page.tsx:105`, Vendedor `orders-page.tsx:118`,
  `formas-pagamento-page.tsx:164` e `transportadoras-page.tsx:139`) entram no próximo lote de cada um.
- **PR #298 continua preso** pelo RD-0441 (sem push novo; modulo-vendedor e testes juntos).
- **Ordem do push**: o PR #312 (Core) traz o commit `46b8c6b3` do #311 (governança) empilhado. Mergear o #311 primeiro (com a
  autorização do dono do produto) e só depois o #312, para o #312 não levar governança sem a autorização.
- **#311 liberado** pelo corretor. O **#312** espera o RD-0443; o **branch dos apps** espera o RD-0442 (com o contrato do
  Core; se a função entrar no #312, o app depende dele).
- **Cabeçalho do shell** (`b227367e`): conflito com o `main` em `.coord/diario/modulo-core.md`, porque os commits do Core
  entraram em squash pelo #297. O engenheiro-apps mescla o `main` no branch (sem rebase); o diário do Core deve ficar como
  está no `main`. Do contrário, o PR leva linhas de diário de outro dono.
- **Ordem de merge da API e do portal:** 6a (`16e6eb4a`) → 7b mescla o 6a e volta à forma do `b9e9c577` (RD-0428) → 7c
  mescla o 7b corrigido. Hoje o 7c dá add/add com o 6a.
- **Ordem do banco:** 7a (0070–0072) antes do 6b (0073), com o 6b mesclando o 7a.

## Para o design-de-marca (parte 6)
- **Lote 2 (Core):** MC-0073, selo de inativo em `neutral` em Filiais, Fotos do PDV, Motivos e Medidas (cor).
- **Lote 3 (Catálogo):** MC-0071 e MC-0072 (parte 4) continuam pendentes.
- **Lote 4 (Treinamento):** MC-0065 continua pendente.
- **Lote 5 (shell):** rodapé legal e MC-0074 (`accent-color: var(--color-accent)` nas caixas nativas, `globals.css`).
- **Lote 11 (logo do cliente):** os prints da carga (`carga-campo.png` e `carga-gestao.png`) precisam ser refeitos pelo
  RD-0451 e validados depois.
- **Lote 12 (cabeçalho):** sem mudança de cor nem de layout neste delta (os 2 prints são os do #297); não precisa.

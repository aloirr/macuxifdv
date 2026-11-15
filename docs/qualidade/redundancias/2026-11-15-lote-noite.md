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

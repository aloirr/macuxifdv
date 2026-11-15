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

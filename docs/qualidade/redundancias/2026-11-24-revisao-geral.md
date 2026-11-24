# Revisão geral das telas: redundâncias e excessos (24/11/2026, ~18h de Manaus)

Pedido do dono do produto: R-20261124-091113 e R-20261124-094002, item 3. Auditor: corretor-redundancias (sessão S5). Esta rodada só audita: nada foi corrigido.

**Material.** Prints em 1366 px do stack local com o seed de demonstração (tenant fictício "Distribuidora Exemplo"), na subpasta [`2026-11-24-revisao-geral/`](2026-11-24-revisao-geral/), e os textos extraídos dessas telas. O app Campo e o app Gestão não rodam na web, então foram revistos pelo código (`modules/*/app`, `apps/mobile/src`) e pelos prints em `docs/`. O PDF do pedido e os e-mails foram revistos pelo código (`modules/vendedor/domain/pdf-pedido.ts`, `packages/platform-sdk/src/email/modelos.ts`) e pelas imagens em `docs/design/telas/T-0159-*` e `docs/design/emails/`.

**Critérios.** Repetição na mesma tela ("uma informação, um lugar"), aviso fora de Alertas (RN-VEN-42) e "só o que o usuário usa para agir". Por este último sai o texto que explica o funcionamento, o que o sistema faz por trás e o texto de garantia (R-20261110-192153). Também entram rótulo e número que não batem, estado vazio repetido e códigos internos visíveis ao cliente (RN-, RF-, T-, ADR, RD-).

**Fora deste relatório:**
- **Parâmetros** fica de fora, porque a S3 já corrige.
- **Itens já na fila do gerente** só aparecem como "já na fila" no §4.
- **Defeitos funcionais** vão ao `testes` (§3) e não recebem número RD.

Numeração: RD-2753 a RD-2789. O maior número anterior era o RD-2752.

## 1. Achados por tela

Gravidade: **alta** (confunde ou contradiz) · **média** (polui) · **baixa** (estética).

### BKO › Início ([bko-inicio.png](2026-11-24-revisao-geral/bko-inicio.png))
1. **RD-2753 (média).** O cartão **HOJE** traz "Positivação no mês 20% · meta 83%", o que contradiz o título do cartão. Dono: modulo-core, `modules/core/web/components/inicio/inicio-bko-page.tsx:179-183`. Proposta: tirar "Positivação no mês" do cartão Hoje. Ela já está em Metas e em Clientes; se ficar no Início, vira linha do cartão "Equipe no mês".
2. **RD-2754 (média).** O mesmo zero aparece em três representações:
   - Vendas: "R$ 0", a barra vazia e "0% da meta do dia";
   - Visitas: "0 de 14", a barra e "14 ainda na rota" (14 = 14 − 0, a mesma conta).

   Dono: modulo-core, `inicio-bko-page.tsx:165-170` e `:184-190`. Proposta: Vendas "R$ 0", com a barra só quando houver venda; Visitas "0 de 14" com a barra, sem "ainda na rota".
3. **RD-2755 (média).** Em "Equipe no mês", as linhas mostram "R$ 1.604 1%", com um percentual sem rótulo (é o atingimento da meta). Dono: modulo-core, `inicio-bko-page.tsx:213`. Proposta: "R$ 1.604 · 1% da meta", ou um cabeçalho "% da meta" na coluna.
4. **RD-2756 (baixa).** A mesma fila de aprovações aparece em duas unidades: no Início, "o mais antigo há 3 d"; em Aprovações, "Vencido há 10 h úteis". Donos: modulo-core (`inicio-bko-page.tsx`, linha "Precisa de você") e modulo-gestor. Proposta: uma unidade só nas duas telas: "vencido há 10 h úteis".

### BKO › Painel da equipe ([bko-equipe.png](2026-11-24-revisao-geral/bko-equipe.png))
5. **RD-2757 (alta).** O cartão "**Meta do mês** 1%" traz embaixo "meta R$ 300.000": o rótulo diz meta e o número grande é o atingimento. Dono: modulo-gestor, `modules/gestor/web/pages/painel-page.tsx:60`. Proposta: rótulo "Atingimento do mês"; embaixo, "de R$ 300.000".

### BKO › Aprovações ([bko-aprovacoes.png](2026-11-24-revisao-geral/bko-aprovacoes.png))
6. **RD-2758 (alta).** O cartão "Para você decidir **0**" aparece em cima de uma fila com 3 pedidos. "Vencidos 3" repete o "· 3" do título e o selo "Vencido há…" de cada linha, e "Vencendo 0" é outro zero. Dono: modulo-gestor, `modules/gestor/web/pages/aprovacoes-page.tsx:39-43`. Proposta: tirar os 3 cartões. O título fica "Aprovações da equipe · 3", e a linha fora da alçada de quem vê ganha o selo "Fora da sua alçada".
7. **RD-2759 (baixa).** A coluna Motivo diz "Desconto" e a coluna ao lado traz "Desconto 12,0%". Na lista de Pedidos o motivo já sai "Desconto 12%". Dono: modulo-gestor, `aprovacoes-page.tsx`, colunas da fila. Proposta: Motivo "Desconto 12,0%"; a coluna Desconto sai.

### BKO › Pedidos ([bko-pedidos.png](2026-11-24-revisao-geral/bko-pedidos.png))
8. **RD-2760 (alta).** O título "Pedidos · **11** R$ 5.581,50" mistura duas bases sem rótulo. O 11 conta todos os pedidos, e o valor deixa de fora o rejeitado e o cancelado: a soma dos 11 dá R$ 6.223,58, e sem esses dois dá R$ 5.581,50. Dono: modulo-vendedor, `modules/vendedor/web/components/orders/orders-page.tsx:66,81`. Proposta: o valor sai do título. Se ficar, que conte os mesmos pedidos do número, com rótulo: "11 pedidos · R$ 6.223,58".
9. **RD-2761 (média).** Os cinco cartões da fila do ERP (Na fila, Entregue ao Conector, Rejeitado pelo ERP, Presos sem retorno, Retidos sem mapeamento) mostram "0" ao mesmo tempo: o estado zero aparece 5 vezes. Dono: modulo-vendedor, `modules/vendedor/web/lib/cards-erp.ts:24-30`. Proposta: mostrar só o cartão com valor maior que 0; com tudo em zero, nenhum cartão.
10. **RD-2762 (média).** A tabela tem 13 colunas:
    - "Código do cliente" e "Cliente" ficam separados;
    - "UF" e "Cidade" também ("AM", "Manaus" em todas as linhas);
    - "Supervisor" está vazio em todas.

    Com isso, Recebido, Valor e Motivo ficam fora da vista em 1366 px. Dono: modulo-vendedor, `modules/vendedor/web/lib/tabela-pedidos.ts:27-33`. Proposta: o código vai embaixo do nome do cliente, "Cidade/UF" vira uma coluna só, e Supervisor só aparece quando algum pedido tiver.

### BKO › Pedido, gaveta de detalhe ([bko-pedidos-detalhe.png](2026-11-24-revisao-geral/bko-pedidos-detalhe.png))
11. **RD-2763 (média).** A caixa "**Faturamento e devolução**" aparece só com o título, sem nota nem devolução: a condição aceita o objeto `faturamento` vazio. Dono: modulo-vendedor, `modules/vendedor/web/components/orders/order-drawer.tsx:140-142`. Proposta: mostrar a caixa só com `situacao_faturamento` ou com `notas + devolucoes > 0`.
12. **RD-2764 (baixa).** "Feito sem sinal 23/11 às 13:40" repete a hora de "Recebido 23/11 às 13:40", e mostra "Não" quando o pedido foi feito com sinal. Dono: modulo-vendedor, `order-drawer.tsx:88`. Proposta: só o selo "Feito sem sinal", quando for o caso; sem a linha "Não".
13. **RD-2765 (baixa).** O documento do cliente aparece sem máscara ("72469154000138") e com um formato diferente do resto do BKO. Dono: modulo-vendedor, `order-drawer.tsx:93`. Proposta: usar `formatarDocumento` do `@macuxi/comum`.

### BKO › Indicadores e Metas ([bko-indicadores.png](2026-11-24-revisao-geral/bko-indicadores.png), [bko-metas.png](2026-11-24-revisao-geral/bko-metas.png))
14. **RD-2766 (média).** Indicadores repete Realizado, Meta de venda e Atingimento, que Metas já mostra por pessoa. O painel "**Definir vendas do mês**" é um segundo lugar para definir a meta (Metas já tem "Definir/Editar"), e o título diz "vendas" para um campo de meta. Dono: modulo-core, `modules/core/web/components/indicadores/indicadores-page.tsx:95,131-146` e `modules/core/web/lib/indicadores.ts:27`. Proposta:
    - o painel sai;
    - Indicadores fica com Visitados, Cobertura, Positivados e Necessidade diária;
    - meta e atingimento ficam só em Metas.
15. **RD-2767 (baixa).** A coluna "Necessidade diária" repete em cada linha a frase "Precisa de R$ 19.880 por dia útil (6 restantes).", que diz de novo o cabeçalho. Dono: modulo-core, `indicadores.ts:23` (que usa `modules/core/app/lib/metas-formato.ts:33`). Proposta: na tabela do BKO, "R$ 19.880 · 6 dias úteis"; sem meta, "—".
16. **RD-2768 (média).** Em Metas, o título "15 linhas · base de apuração: aprovado" já diz a base, e a coluna **Tipo** repete "Pedido aprovado" nas linhas de Vendas e "—" nas demais. "15 linhas" é só a contagem da tabela. Dono: modulo-core, `modules/core/web/components/metas/metas-page.tsx:175-182` (`CABECALHO_METAS`). Proposta: a coluna Tipo sai; o título fica "Base de apuração: aprovado".

### BKO › Rotas ([bko-rotas.png](2026-11-24-revisao-geral/bko-rotas.png))
17. **RD-2769 (média).** O mesmo fato está em quatro cartões: Visitas planejadas 14, Visitadas 0 ("0% do planejado"), Em atendimento 0 e Pendentes 14. A lista ao lado ainda diz "4 pend." por pessoa. O "Km total" explica a conta ("a partir do 1º cliente, sem volta"). Dono: modulo-core, `modules/core/web/components/routes/routes-page.tsx:415-421` e `modules/core/web/lib/routes.ts:342-343`. Proposta: três cartões, "Rotas 3", "Visitas 0 de 14 · 0 em atendimento" e "Km 58", sem o subtítulo do km.

### BKO › Recados ([bko-recados.png](2026-11-24-revisao-geral/bko-recados.png))
18. **RD-2770 (média).** "Enviados e leitura" mostra o mesmo envio em duas tabelas seguidas: "Envio / Pessoas / Enviado em / Lidas" e "Recado / Para / Enviado em / Leitura". O título "Prioridade" e a data aparecem duas vezes. Dono: modulo-core, `modules/core/web/components/recados/recados-page.tsx:141-214`. Proposta: uma tabela por envio; quem leu abre no clique da linha.

### BKO › Alertas ([bko-alertas.png](2026-11-24-revisao-geral/bko-alertas.png)) e Gestão › Alertas
19. **RD-2771 (média).** A coluna Tipo e a mensagem dizem a mesma coisa, e a mensagem é cortada antes do que importa:
    - "Cliente sem visita" + "Cliente está sem visita há 67 dias (frequên…";
    - "Pedido aguardando apr…" + "Pedido aguardando aprovação além do pr…";
    - "Ritmo abaixo da meta" + "Lucas Andrade está com…", com o Responsável "Lucas Andrade" na coluna ao lado.

    A coluna Situação diz "Aberto" em todas as linhas, com o filtro "Ativos" ligado. O app Gestão repete o padrão, com o tipo no título e a mensagem embaixo. Donos: modulo-gestor, `modules/gestor/domain/alertas.ts:171,212,239`, `modules/gestor/web/pages/alertas-page.tsx:72-75` e `modules/gestor/app/screens/alertas-screen.tsx:72-79`. Proposta: a mensagem diz só o que o tipo não diz:
    - "Mercadinho São Jorge · 67 dias (quinzenal, limite 21)";
    - "Pedido 000011 · 16 h úteis (prazo 1 dia útil)";
    - "1% do ritmo (mínimo 80%)".

    A coluna Situação só aparece com o filtro "Todos".

### BKO › Treinamento ([bko-trilhas.png](2026-11-24-revisao-geral/bko-trilhas.png))
20. **RD-2772 (baixa).** "Adesão em Novembro 2026" repete o filtro Mês, logo acima. "Público 7" repete a aba "Pessoas (7)". "Ativos 3" não diz de quê (são pessoas ativas no mês) e fica ao lado da aba "Trilhas (3)", que se lê como o mesmo número. Dono: modulo-treinamento, `modules/treinamento/web/pages/trilhas-page.tsx:213-215`. Proposta: rótulos "Adesão" e "Pessoas ativas no mês"; o cartão Público sai.

### BKO › Ranking ([bko-ranking.png](2026-11-24-revisao-geral/bko-ranking.png))
21. **RD-2773 (baixa).** O período aparece em ISO ("2026-11-01 a 2026-11-30") ao lado do filtro Período "Mês": é o mesmo período, duas vezes. Dono: modulo-gestor, `modules/gestor/web/pages/ranking-page.tsx:27`. Proposta: "Novembro 2026" (mês) ou "18/11 a 24/11" (semana); com o dia, só a data.

### BKO › Preço e custo ([bko-produtos-detalhe.png](2026-11-24-revisao-geral/bko-produtos-detalhe.png))
22. **RD-2774 (média).** Quatro repetições na mesma tabela:
    - "Medida" ("UN · FD c/ 6") e "Unidades de venda" ("UN · padrão", "FD c/ 6") dizem o mesmo, lado a lado;
    - "15,00% padrão" se repete nas 40 linhas, e o título já diz "desconto máximo padrão 15,00%";
    - Margem, Markup e Lucro são três formas da mesma relação;
    - a tabela passa de 1366 px, e "Margem no mínimo" e "Ações" ficam fora da vista.

    Dono: modulo-core, `modules/core/web/components/produtos/produtos-page.tsx:108-122`. Proposta: fica só "Unidades de venda"; "Desc. máx." só aparece quando difere do padrão; Markup sai.

### BKO › Tabelas de preço ([bko-tabelas-preco.png](2026-11-24-revisao-geral/bko-tabelas-preco.png))
23. **RD-2775 (baixa).** A coluna Vigência traz "Desde 01/10/2026" igual nas 37 linhas. O código sai cortado ("OLE-4T-SE…"), enquanto a coluna Produto sobra. Dono: modulo-catalogo, `modules/catalogo/web/pages/tabelas-preco-page.tsx:107`. Proposta: quando a vigência é a mesma para todos, ela vai uma vez no título e a célula só mostra a exceção; o código sai inteiro.

### BKO › Trade marketing ([bko-trade.png](2026-11-24-revisao-geral/bko-trade.png))
24. **RD-2776 (alta).** A coluna Loja sai cortada ("Supermercado …") em todas as linhas de share e de ruptura. As duas lojas (Bom Preço e Família) ficam iguais na tela, e não dá para saber qual linha é de qual. Dono: modulo-promotor, `modules/promotor/web/pages/trade-page.tsx:79,88`. Proposta: o nome inteiro, em até 2 linhas.
25. **RD-2777 (baixa).** A coluna Situação ("Atingiu" / "Abaixo da meta") repete o Atingimento (100% / 83,33%) da coluna ao lado. Dono: modulo-promotor, `trade-page.tsx:84`. Proposta: o tom vermelho ou verde vai no próprio %; a coluna Situação sai.

### BKO › Integração ERP ([bko-integracao.png](2026-11-24-revisao-geral/bko-integracao.png))
26. **RD-2778 (baixa).** A linha de Estoque diz "24/11 às 17:19 · falhou 17:19", com a mesma hora duas vezes e o selo "Com falha" ao lado. O cabeçalho "última carga recebida 24/11 às 17:19" repete a primeira linha. Dono: modulo-integracao, `modules/integracao/web/lib/entidades.ts:70`. Proposta: "falhou hh:mm" só quando a hora difere da carga; o cabeçalho fica "erp-matriz · v1.2.1".

### BKO › Auditoria ([bko-auditoria.png](2026-11-24-revisao-geral/bko-auditoria.png))
27. **RD-2779 (média).** O estado vazio aparece duas vezes, "0 registros mais recentes" e "Nada registrado para esta entidade.", e a segunda frase está errada: o filtro é "Todas". O subtítulo "toda gravação do sistema entra aqui" explica o funcionamento. Dono: engenheiro-apps, `apps/web/components/audit/audit-page.tsx:29`. Proposta: uma linha só, "Nenhum registro."; o subtítulo fica "Quem alterou o quê e quando".

### BKO › subtítulos que explicam o funcionamento
28. **RD-2780 (média).** Sete subtítulos descrevem o que o sistema faz, em vez do que o usuário faz. Dono: modulo-core. Proposta em cada caso:
    - Filiais ([bko-filiais.png](2026-11-24-revisao-geral/bko-filiais.png)), `modules/core/web/components/filiais/filiais-page.tsx:89`: "Unidades de onde saem as entregas. O cliente tem uma filial; sem informação, fica na padrão. Estoque e preço do pedido saem da filial do cliente." O subtítulo sai.
    - Visitas ([bko-visitas.png](2026-11-24-revisao-geral/bko-visitas.png)), `visitas/visitas-page.tsx:86`: "…As fora do raio do cliente ficam sinalizadas com a justificativa do vendedor." Fica "Check-ins e checkouts da equipe."
    - Recados, `recados/recados-page.tsx:88`: "…Ele aparece na caixa de notificações do app." Fica "Envie um aviso para a sua equipe."
    - Preço e custo, `produtos/produtos-page.tsx:87`: "O custo é interno: nunca aparece no app nem no PDF do cliente." (texto de garantia). Fica "Custo, preço de venda e desconto máximo."
    - Metas, `metas/metas-page.tsx:124`: "…com a mesma apuração do aplicativo." Fica "Meta × realizado por pessoa e indicador."
    - Carteira, `carteira/carteira-page.tsx:88`: "A frequência gera a rota da semana." A frase sai.
    - Coordenadas sugeridas, `coordenadas/coordenadas-page.tsx:40`: "Clientes sem coordenada que já receberam um check-in." Fica "Confira no mapa e aprove a posição correta."

    O de Aparelhos ("O bloqueio vale para todos os usuários da empresa naquele aparelho.") é `manter?`: diz a consequência da ação. O melhor lugar para ele é a confirmação do bloqueio.
29. **RD-2781 (baixa).** Em Visitas, a coluna se chama "Vendedor" mas mostra a promotora (Joana Prado), e o filtro diz "Vendedor ou promotor". Dono: modulo-core, `visitas-page.tsx`, cabeçalho da tabela. Proposta: "Pessoa".

### BKO › Pesquisas ([bko-pesquisas.png](2026-11-24-revisao-geral/bko-pesquisas.png), [bko-pesquisas-detalhe.png](2026-11-24-revisao-geral/bko-pesquisas-detalhe.png))
30. **RD-2782 (média).** "Equipes (opcional)" e "Clientes específicos (opcional)" pedem "**Um id por linha**": o usuário teria de digitar o identificador interno. Dono: modulo-pesquisa, `modules/pesquisa/web/pages/construtor-page.tsx:244,247`. Proposta: escolher por nome (busca com seleção); para clientes, aceitar o código do cliente.
31. **RD-2783 (baixa).** A mesma coisa tem dois nomes: o título diz "Pesquisas · 2", e o botão "Novo questionário" e o painel "Questionários". Dono: modulo-pesquisa, página da lista. Proposta: um nome só, "Pesquisa" ("Nova pesquisa").

### BKO › Login ([bko-login-codigo-invalido.png](2026-11-24-revisao-geral/bko-login-codigo-invalido.png))
32. **RD-2784 (baixa).** O subtítulo "Use o código da sua empresa, o seu e-mail e a sua senha." repete os três rótulos logo abaixo. Dono: engenheiro-apps, `apps/web/components/login-screen.tsx:230`. Proposta: o subtítulo sai. A nota do rodapé (Campo e Gestão) é `manter?`: leva quem entrou no lugar errado ao app certo.

### Códigos internos visíveis ao cliente
33. **RD-2785 (média).** Gestão › Ficha da pessoa, ao tentar o pedido em nome de uma promotora: "O promotor não faz pedido (**RN-PRO-01**). Escolha um vendedor." Dono: modulo-gestor, `modules/gestor/domain/pedido-em-nome.ts:30` (mostrado em `modules/gestor/app/screens/ficha-screen.tsx:86`). Proposta: "O promotor não faz pedido. Escolha um vendedor."
34. **RD-2786 (média).** O erro 422 do orçamento fechado leva o código na mensagem: `${texto} (RN-VEN-18)`. Dono: modulo-vendedor, `modules/vendedor/api/orcamentos.ts:57`. Proposta: a mensagem fica só com `texto`; o código continua no campo `code`.
35. **RD-2787 (baixa).** A recusa do sync do treinamento diz "Progresso não é apagado nem editado (**RN-TRE-04**)." e aparece na fila do aparelho como motivo da recusa. Dono: modulo-treinamento, `modules/treinamento/api/sync.ts:35`. Proposta: tirar o "(RN-TRE-04)".
36. **RD-2788 (baixa).** Avisos dos lotes do ERP levam o código da regra no texto:
    - "Aplicação com N caracteres foi cortada em 500 (**RN-CAT-11**)." e outros três avisos (`modules/integracao/domain/catalogo-produto.ts:33,41,47,52`);
    - "…O Macuxi usa 45 (**RN-VEN-24**); confira o cadastro no ERP." (`modules/integracao/domain/pagamento.ts:23`).

    Esses textos aparecem para a TI do cliente no detalhe do lote e no retorno. Dono: modulo-integracao. Proposta: tirar o "(RN-…)"; o `codigo` do aviso já identifica a regra.

### App Gestão e app Campo (pelo código)
37. **RD-2789 (baixa).** Há dois problemas, os dois de texto:
    - **Estados vazios que explicam o funcionamento:**
      - "Quando um vendedor da sua equipe pedir, o pedido aparece aqui." (`modules/gestor/app/screens/aprovacoes-screen.tsx:38`);
      - "Quando houver vendedores ou promotores sob você, eles aparecem aqui." (`equipe-screen.tsx:56`);
      - "Os alertas novos aparecem aqui quando houver algo para ver." (`alertas-screen.tsx:64`);
      - no Campo › Minha RV, "O último cálculo recebido fica guardado aqui." (`modules/core/app/lib/minha-rv.ts:98`).
    - **A mesma instrução de sincronizar em sete redações**, sem um texto comum: "Puxe para baixo para sincronizar." (Gestão e Pesquisa), "Conecte-se à internet e puxe para baixo para sincronizar." (`equipe-screen.tsx:40`), "Volte e puxe para atualizar." (`modules/treinamento/app/screens/licao-screen.tsx:55`, `quiz-screen.tsx:53`, `trilha-screen.tsx:42`), "Puxe para atualizar com sinal." (`treinar-screen.tsx:137`), "Sincronize e tente de novo." (`modules/pesquisa/app/screens/responder-screen.tsx:117`), "Sincronize com sinal para atualizar a carteira." (`modules/vendedor/app/screens/new-order-screen.tsx:568`) e "Conecte-se à internet e escolha esta combinação de novo." (`modules/gestor/app/screens/ranking-screen.tsx:40`).

    Donos: modulo-gestor e modulo-core (estados vazios); designer-ux (texto comum no `packages/ui`), com modulo-treinamento, modulo-pesquisa e modulo-vendedor aplicando. Proposta:
    - os estados vazios ficam só com o título ("Nada aguardando aprovação"); Minha RV fica "Conecte-se à internet e toque em Sincronizar.";
    - uma constante `TEXTO_PUXAR_PARA_SINCRONIZAR = 'Puxe para baixo para sincronizar.'`, usada pelas sete telas.

### PDF do pedido e e-mails
Sem achado novo. O PDF (A4 paisagem, versões do cliente e do escritório) segue o `pdf-pedido.md` aprovado. Os dois modelos de e-mail (`acesso_inicial` e `nova_senha`) dizem só o motivo, os três dados de acesso, a validade e o botão; o botão copiar já está na fila.

### Portal de implantação (config)
Sem achado novo de redundância. O "Rota não encontrada" de Diagnósticos e o código em minúsculas da Nova empresa vão ao `testes` (§3). A aba Integração/Dados e a aba Empresa já estão na fila.

## 2. Registro para a S3 (Parâmetros, fora deste lote)
- `packages/ui/src/web/perfis.ts:61-66` mostra códigos internos nos cadeados da tela de perfis: "(RN-CORE-04)", "(RN-CORE-35)" 4 vezes e "(RN-CORE-32)". Uso em `modules/core/web/components/perfis/perfis-page.tsx:383,514`. Proposta: tirar os parênteses com o código.
- `modules/gestor/domain/alertas.ts:68,73`: as mensagens de validação dos parâmetros de alerta citam "(RN-GES-01)" e "(RN-GES-03)" e nomes de chave (`pct_tolerancia_frequencia`, `prazo_aprovacao_dias_uteis`).

## 3. Encaminhados ao `testes` (defeito funcional, sem número RD)
1. **Vendas do mês com dois valores.** Para Lucas Andrade, Início › Equipe no mês e Ranking mostram R$ 1.604, e Indicadores e Metas mostram R$ 3.223. Nenhuma das telas diz a base. Prints: bko-inicio, bko-ranking, bko-indicadores, bko-metas.
2. **Alertas.** Três problemas:
   - números com ponto decimal: "15.82 horas úteis", "1.17%" (`modules/gestor/domain/alertas.ts:212,239`);
   - a coluna "Desde" mostra a hora da geração (24/11 às 17:42) em todas as linhas;
   - o nome do cliente não chega à mensagem, que cai no "Cliente" padrão (`alertas.ts:161`).
3. **Recados.** "Enviado em 24/11/2026, 21:39:08" sai no fuso do navegador, com segundos (`toLocaleString`, `recados-page.tsx:168,207-208`), enquanto as outras telas mostram o horário de Manaus.
4. **Portal › Diagnósticos.** "Rota não encontrada. Tentar de novo" ao abrir ([config-diagnosticos.png](2026-11-24-revisao-geral/config-diagnosticos.png)).
5. **Portal › Nova empresa.** A ajuda diz "Letras minúsculas, números e hífen", e o campo converte o código para minúsculas (`apps/web/components/portal/passo-empresa-legado.tsx:313,317`). O login novo usa o formato AM0000 ([config-empresas-nova.png](2026-11-24-revisao-geral/config-empresas-nova.png)).
6. **Trade › Ruptura.** "Ruptura 40% · Falha de reposição 20% · Ruptura total 20%": o total é menor que uma das partes ([bko-trade.png](2026-11-24-revisao-geral/bko-trade.png)).
7. **Login com código inválido.** O print não mostra mensagem de erro ([bko-login-codigo-invalido.png](2026-11-24-revisao-geral/bko-login-codigo-invalido.png)).

## 4. Já na fila (só citados)
- Coluna "Fachada" vazia em Visitas (foto da fachada).
- Farol de Clientes.
- Coluna de código em Usuários.
- Formas e prazos.
- Códigos `referencia_ausente, valor_fora_da_faixa` em "Dados no Hub" (aba Integração/Dados do config).
- Menu do usuário.
- Aviso de obrigatórios nas gavetas.

## 5. Resumo por dono
| Dono | Achados | Alta | Média | Baixa |
|---|---|---|---|---|
| modulo-core | RD-2753, 2754, 2755, 2756 (com modulo-gestor), 2766, 2767, 2768, 2769, 2770, 2774, 2780, 2781, 2789 (Minha RV) | — | 9 | 4 |
| modulo-gestor | RD-2756, 2757, 2758, 2759, 2771, 2773, 2785, 2789 (estados vazios) | 2 | 2 | 4 |
| modulo-vendedor | RD-2760, 2761, 2762, 2763, 2764, 2765, 2786, 2789 (texto comum) | 1 | 4 | 3 |
| modulo-promotor | RD-2776, 2777 | 1 | — | 1 |
| modulo-treinamento | RD-2772, 2787, 2789 (texto comum) | — | — | 3 |
| modulo-pesquisa | RD-2782, 2783, 2789 (texto comum) | — | 1 | 2 |
| modulo-catalogo | RD-2775 | — | — | 1 |
| modulo-integracao | RD-2778, 2788 | — | — | 2 |
| engenheiro-apps | RD-2779, 2784 | — | 1 | 1 |
| designer-ux | RD-2789 (constante comum no `packages/ui`) | — | — | 1 |

São 37 achados (RD-2753 a RD-2789): 4 altos, 17 médios e 16 baixos. Por superfície: BKO 32, códigos internos (BKO, apps e API) 4, apps Campo e Gestão 1 (mais o RD-2771, que também vale para a Gestão). PDF, e-mails e portal ficaram sem achado novo. A tabela acima conta uma vez por dono, por isso a soma das linhas passa de 37.

Ao `testes` vão 7 encaminhamentos (§3); à S3, 2 registros (§2).

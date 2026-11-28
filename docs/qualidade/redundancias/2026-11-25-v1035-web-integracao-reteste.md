# Parecer de redundâncias — v1.0.35, reteste da aba Integração/Dados do portal (RD-3550 a RD-3552)

Data: 25/11/2026 (Manaus). Rodada por SHA. Recados não enviados (repositório de recados com 403); achados relatados ao gerente-projetos.
Prints conferidos: aba Integração e aba Dados (modo falso, time da Macuxi, v2).

## A) `nuvem/v1035-web-modulo-integracao` @ b9e8b06 (modulo-integracao) — LIBERADO no SHA b9e8b06

- `reprocessarLote` (`modules/integracao/web/lib/reprocessar-lote.ts`) é a única chamada do `POST /integracao/lotes/:id/reprocessar`;
  `useReprocessarLote` (`queries.ts:207`) passa a usá-la e o import de `ReprocessarLoteResposta` saiu. Export usado pelo shell (B).
- Teste novo cobre só a função (corpo vazio, autorizador + senha, contrato); o `index.test.ts` acrescenta o export. Sem achado.
- A diferença em `tests/modulos/v1034-fachada.test.ts` no diff contra `origin/main` é do `main` que andou (b78ad1f → 10cb2c3), não do branch.

## B) `nuvem/v1035-web-engenheiro-apps-dados` @ 0b826a6 (engenheiro-apps, sobre b9e8b06) — NÃO LIBERADO

Reteste:
- **RD-3550 corrigido**: uma tabela "Conectores" no topo (Identificador · Situação · Versão · Último sinal · Fila · Pedidos · ⋯),
  `secao-monitor.tsx` e o teste apagados, sem h2 duplo. No print, o `erp` aparece uma vez só; a saúde vem da lista e só a Fila vem do
  detalhe do monitor (sem segunda fonte para o mesmo dado). O modo falso passa a montar o detalhe com os Conectores da lista.
- **RD-3551 corrigido**: `apps/web/lib/portal-monitor.ts:94` chama `reprocessarLote`; o POST e o parse não se repetem mais.
- **RD-3552 corrigido**: comentário do topo de `aba-integracao.tsx` dentro de 140 colunas; `SELO` de `aba-dados.tsx` em uma linha, sem px.
- Aba Dados (print): uma linha por entidade, sem aviso fora do lugar e sem número repetido. Sem achado.

Achados novos:

| ID | Grav. | Onde | O que se repete | Proposta | Dono |
|---|---|---|---|---|---|
| RD-3562 | média | `apps/web/components/portal/aba-integracao.tsx:421-514` (`ListaConectores`) × `:519-528` (`acoesDoConector`) | As mesmas ações da linha (Bases, Gerar nova chave, Desativar, Reativar, com os mesmos testIDs `integracao.bases-*`, `nova-chave-*`, `desativar-*`, `reativar-*`) implementadas duas vezes: em botões numa segunda linha na tabela "Credenciais" e no "⋯" da tabela "Conectores". Na mesma tela, a linha de Conector age pelo "⋯" e a de credencial por fileira de botões. Depois do RD-3550, `ListaConectores` só recebe `tipo: 'nuvem'` (`:742`), e os ramos de `arquivo` (`:461`, `:475`, `:480`) e o "lado estreito e celular" do JSDoc (`:422`) ficaram mortos | "Credenciais" pela mesma `TabelaDados` com `acoes={(c) => acoesDoConector(c, agindo, aoAgir, aoBases)}`, colunas Identificador · Pedidos · Situação, vazio "Nenhuma credencial.", `Credencial` da chave nova abaixo da tabela (como em `TabelaConectores`); apagar `ListaConectores`, o `lista` (`:673-685`), o `Fragment` e o `td.replace` | engenheiro-apps |
| RD-3563 | baixa (só comentário, não segura) | `aba-integracao.tsx:5-6` × `:532-534` | As colunas da tabela "Conectores" (Situação, Versão, Último sinal, Fila "só para o time da Macuxi", Pedidos, ⋯) descritas duas vezes: no comentário do topo do arquivo e no JSDoc de `TabelaConectores` | No topo, só "No topo, a tabela Conectores (`TabelaConectores`)."; as colunas ficam no JSDoc da função | engenheiro-apps |

Sem defeito funcional para encaminhar ao testes.

## C) `nuvem/v1035-web-engenheiro-apps-dados` @ 46fd1b2 (engenheiro-apps) — LIBERADO no SHA 46fd1b2

Diff conferido: `git diff 0b826a6 46fd1b2` (8 arquivos). Prints: aba Integração (v4, 1280), aba Dados (v4, 1280 e 390).

Reteste:
- **RD-3562 corrigido**: `ListaConectores`, o `lista`, o `Fragment`, o `td.replace` e os imports `TableScroll`/`td`/`th` saíram.
  "Conectores" e "Credenciais" usam o mesmo `CorpoDaTabela` (`TabelaDados` + `acoesDoConector`), com `colunaIdentificador` e
  `colunaPedidos` em comum. No print, as duas tabelas agem pelo "⋯"; nenhuma fileira de botões. Sem uso restante de `ListaConectores`.
- **RD-3563 corrigido**: o topo de `aba-integracao.tsx` remete ao JSDoc de `TabelaConectores`; as colunas ficam descritas só lá.
- Correções de UX do designer-ux conferidas:
  - "Sem dados" vira selo neutro na Situação; `celulasDaEntidade` deixa Registros vazio. No print, Filiais diz "Sem dados" uma vez só,
    também a 390 px (antes a coluna Registros sumia no celular). Uma informação, um lugar.
  - "Corrigir no ERP" com prioridade 2; o comentário do e2e (`portal-zerar.spec.ts:115`) acompanha.
  - "Credenciais" na ordem Identificador · Situação · Pedidos, a mesma dos Conectores; Pedidos "Sim"/"Não" nas duas tabelas
    (antes "Sim"/"—"). Rótulo e valor batem.
  - Vazio da aba Dados: "Nenhuma entidade no Hub.", uma frase.
  - Selos com `px-[5px]!`: "Sem dados" e "Com falha" inteiros a 390 px no print.
- "Com falha" com erro a corrigir no ERP (Produtos, Preços) e a coluna "Corrigir no ERP" com a contagem e o código: não é repetição;
  o selo dá o estado (única coluna visível no celular) e a coluna diz o que corrigir.
- Títulos e comentários dos testes alterados conferem com o código.

Achados novos: nenhum. Sem defeito funcional para encaminhar ao testes.

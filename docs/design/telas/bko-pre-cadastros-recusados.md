# BKO — Pré-cadastros recusados (v1.0.30)

> 2026-11-23 · designer-ux · sessão D da v1.0.30. Decisões do dono do produto: R-20261123-141413 e R-20261123-142306.
> Regras: RN-CORE-78 (pré-cadastro, ERP aprova ou recusa) e RN-CORE-79 (campos obrigatórios). Campo: `campo-cliente-pre-cadastro.md`.
> Códigos do cliente (ADR 0069, item 10): `codigos-do-cliente.md`.
> Simulações (1366×768, escala 2): `pre-cadastro-v1030/01` a `04` (gerador `pre-cadastro-v1030/gerar.mjs`). Sem cor nem token novos.

Dono da tela: `modulo-core` (`modules/core/web`). Kit: `@macuxi/ui/web` (`Abas`, `CampoBusca`, `SelectField`, `TabelaDados`,
`Badge`, `Drawer`, `Notice`, `Button`, `EstadoVazio`, `LoadingBlock`, `ErrorBlock`, `useToast`). Nenhum componente novo.
Regras de texto: só o que o usuário usa para agir (R-20261110-192153); uma informação, um lugar; avisos só na área de alertas
(no BKO, o `Notice` do topo da gaveta ou da página; RN-VEN-42, R-20261110-093124).

## 1. Onde fica
- **Cadastros › Clientes**, numa aba. A página (hoje "Farol de clientes") passa a ter o título **Clientes** e as abas
  **Farol** | **Pré-cadastros recusados**. O Farol não muda (o `⋯` dele só aparece na aba Farol).
- Por que aba e não item de menu: com o grupo Cadastros aberto, o menu já usa 562 dos 571 px livres em 1366×768
  (`docs/design/menu-parametros/spec.md` §3); um sétimo item faria o menu rolar.
- Endereço: `/clientes?aba=pre-cadastros` (a aba Farol fica em `/clientes`).
- Contador na aba: `rotuloDaAba('Pré-cadastros recusados', n)` com **n = pré-cadastros na situação Recusado** (o mesmo número
  que a lista mostra com o filtro padrão). Com n = 0, sem número.

## 2. Lista (`01-bko-recusados-lista.png`)
Ordem na aba:
1. **Filtros**, numa linha:
   - `CampoBusca` 340 px, placeholder `ROTULO_BUSCA_CLIENTE` (**Código, CNPJ ou nome**), regra `clienteCasaBusca` (códigos ERP e
     FDV, razão social, fantasia e documento por dígitos, sem precisar da máscara).
   - `SelectField` **Situação**: Recusado (padrão) · Reenviado · Aceito · Todas.
   - Sem filtro de vendedor.
   - Os filtros vão na URL (`?situacao=&q=`), como nas outras listas.
2. **Tabela** (`TabelaDados`, sem rolagem lateral), da data mais nova para a mais antiga:

| Coluna | Conteúdo | Largura |
|---|---|---|
| Código | `FDV 00018`; sigla 12/500 `text-ink-2`, valor mono 13 (`codigos-do-cliente.md` §2). `ERP …` em cima só se a consulta trouxer o código ERP (hoje não traz) | 92 |
| CPF/CNPJ | `formatarDocumento` (máscara de exibição: 00.000.000/0000-00 ou 000.000.000-00), `tabular-nums` | 190 |
| Razão social | 600, uma linha, reticências; texto inteiro no `title` | resto |
| Vendedor | quem fez o pré-cadastro (nome do usuário do BKO, se veio do BKO) | 128 |
| Recusado em | data e hora da última recusa, `dd/mm/aaaa hh:mm` no fuso do tenant | 168 |
| Motivo da recusa | motivo da última recusa, uma linha, reticências; inteiro no `title` e na gaveta | 220 |
| Situação | `Badge`: **Recusado** (`danger`), **Reenviado** (`warning`), **Aceito** (`success`) | 118 |

- A linha toda abre a gaveta (§3); `cursor-pointer`, foco por teclado e `Enter`. Sem menu `⋯` na linha (a única ação está na gaveta).
- Sem total acima da tabela (o número já está na aba). Paginação: a padrão da `TabelaDados`.
- "Aceito" sai da lista depois de 30 dias do aceite (premissa; ver §7).

## 3. Histórico (gaveta, `02-bko-recusados-historico.png`)
`Drawer` (560 px, a largura padrão da gaveta; sem prop) com:
- **Título:** a razão social. **Subtítulo:** `FDV 00031 · CPF/CNPJ · Vendedor` e o `Badge` da situação.
- **Corpo:** rótulo de seção **Tentativas** e um cartão por revisão, da mais nova para a mais antiga:
  - **Revisão N** (600).
  - Quem e quando: revisão 1 = **Enviada por <nome>, no Campo|no BKO, em dd/mm/aaaa hh:mm**; da 2 em diante = **Corrigida por <nome>, no Campo|no BKO, em …**.
  - O que o ERP fez: **Recusada pelo ERP em …** · **Aceita pelo ERP em …** · **Aguardando o ERP** (revisão ainda sem resposta).
    `· Código ERP <código>` (em mono) no aceite só quando a API trouxer o código; hoje não traz, e a linha fica sem ele.
  - Na recusa: o motivo, numa linha `danger` com ícone de alerta; abaixo, os erros por campo, um por linha:
    **<Rótulo do campo>:** <mensagem>. Rótulos de `ROTULOS_CAMPOS_PRE_CADASTRO` (e Logradouro, Número, Bairro, Cidade, UF, CEP).
  - Sem selo por cartão: a situação do pré-cadastro fica só no subtítulo.
- **Rodapé:** `Button variant="primary"` **Editar e reenviar**, só quando a situação é **Recusado** e o usuário pode reenviar.
  Fora disso, sem rodapé (fecha no ×, `Esc` ou clique fora).

## 4. Editar e reenviar (mesma gaveta, `03-bko-recusados-editar.png`)
O toque em **Editar e reenviar** troca o conteúdo da gaveta (sem abrir outra):
- **Título:** **Editar e reenviar**. **Subtítulo:** `FDV 00031` (o código não é campo do formulário; a razão social já está nele).
- **Topo do corpo:** `Notice tone="danger"` com o motivo da última recusa (texto literal). É o único aviso da gaveta.
- **Formulário**, preenchido com a última revisão, na ordem do Campo (`campo-cliente-pre-cadastro.md` §2), em grade de 6 colunas:
  CPF/CNPJ (3) · Inscrição estadual (3) / Razão social (6) / Nome fantasia (6) / Telefone (3) · E-mail (3) /
  rótulo **ENDEREÇO** / CEP (3) · Bairro (3) / Logradouro (4) · Número (2) / Cidade (4) · UF (2).
  - Campo não usado pela empresa: não aparece. Campo não obrigatório (Parâmetros › Clientes › Campos obrigatórios): rótulo com
    **(opcional)** na mesma linha, em `text-ink-2`. Obrigatório não leva marca.
  - Máscaras ao digitar iguais às do Campo: `aplicarMascara('documento' | 'cep' | 'telefone', valor)` e as props do `<input>` em
    `propsDoInputComMascara(mascara)` (`@macuxi/ui/web`); o envio vai só com dígitos.
  - Campos 44 px, borda `#7A8593`, raio 10.
- **Erros por campo:** cada campo citado na última recusa já abre com borda `danger` 2 px e a mensagem embaixo (13/600 `danger`,
  ícone de alerta), e a gaveta rola até o primeiro. A marca sai quando o valor do campo muda. Campo marcado e não mudado não
  bloqueia o envio.
- **Validação local** (igual ao Campo, §3): obrigatório vazio mostra **Obrigatório** ao tocar em Reenviar; inválido mostra
  "CNPJ inválido", "CEP inválido" etc. ao sair do campo; nada de resumo no topo.
- **Rodapé:** **Cancelar** (secundário; volta ao histórico sem perguntar se nada mudou, e com `Dialog` **Descartar as
  alterações?** · **Descartar** (perigo) / **Continuar** se mudou) e **Reenviar** (principal, único; enquanto grava:
  **Reenviando…**, desabilitado).
- **Reenviou:** fecha a gaveta, toast `success` **Pré-cadastro reenviado.** e a linha passa a **Reenviado** (com o filtro
  padrão, ela sai da lista e o número da aba cai 1).
- **Erro ao reenviar:** o `Notice` do topo passa a mostrar `errorMessage(erro)` (no lugar do motivo); 422 com erros por campo
  marca os campos como acima.
- **Alguém reenviou antes** (o vendedor pelo Campo ou outro usuário): `Notice tone="danger"` **<nome> já corrigiu este
  pré-cadastro em dd/mm hh:mm.** com o botão **Ver histórico**, que volta ao §3 recarregado; os dados digitados se perdem.

## 5. Estados da aba

| Estado | O que aparece |
|---|---|
| Carregando | filtros à vista; `LoadingBlock label="Carregando os pré-cadastros…"` no lugar da tabela |
| Vazio, filtro padrão (`04-bko-recusados-vazio.png`) | `EstadoVazio titulo="Nenhum pré-cadastro recusado."` |
| Vazio com outros filtros | `EstadoVazio titulo="Nenhum pré-cadastro com estes filtros."` e `Button` secundário **Limpar filtros** |
| Erro ao carregar | `ErrorBlock` com `errorMessage(erro)` e **Tentar de novo** |
| Gaveta carregando / com erro | `LoadingBlock label="Carregando o histórico…"` / `ErrorBlock` com **Tentar de novo**, no corpo da gaveta |
| Sem permissão de ver | a aba **Pré-cadastros recusados** não aparece; a página fica só com o Farol e sem a barra de abas; o endereço direto cai na aba Farol |
| Pode ver, não pode reenviar | lista e histórico iguais, sem o botão **Editar e reenviar** |
| Licença | o Core é sempre licenciado: não há estado de cadeado |

## 6. Fora da tela (excesso, regra do corretor)
Nenhum texto sobre o que acontece depois do reenvio ("vai para o ERP", "o vendedor é avisado"), nenhuma explicação de
revisão, nenhuma contagem repetida (o número fica só na aba), nenhum aviso fora do `Notice` do topo, nenhum "revisão N" no
título da gaveta de edição.

## 7. Premissas sobre a API (sessão C) — confirmar com o `modulo-core`
- Consulta da lista: `GET` paginado com `situacao` (`recusado` | `reenviado` | `aceito`; sem filtro = todas) e `q` (sem filtro
  de vendedor); cada item: `id`, `documento`, `razao_social`, `vendedor { id, nome }`, `situacao`, `recusado_em` (UTC),
  `motivo` (da última recusa), `revisao` (atual), `codigo_fdv`. Pré-cadastro nunca recusado não entra. Aceito fica 30 dias.
- Contador da aba: `total` da consulta com `situacao=recusado` (ou um campo `recusados` na mesma resposta).
- Histórico: `tentativas[]` com `revisao`, `origem` (`campo` | `bko`), `enviada_por { nome }`, `enviada_em`, `resultado`
  (`recusada` | `aceita` | `aguardando`), `respondida_em`, `motivo` e `erros[] { campo, mensagem }`.
  `campo` é a coluna do formulário (`documento`, `razao_social`, `nome_fantasia`, `inscricao_estadual`, `telefone`, `email`,
  `logradouro`, `numero`, `bairro`, `cidade`, `uf`, `cep`), para marcar o campo exato.
- Reenvio: grava revisão nova no **mesmo id**, com a `revisao` em que a edição se baseou; revisão desatualizada = 409 com
  `corrigida_por { nome }` e `corrigida_em`. 422 de validação traz `erros[]` no mesmo formato.
- Permissões (nomes sugeridos): ver = `cliente.pre_cadastro.ver` (supervisor, gerente, analista, admin, no escopo da carteira);
  reenviar = `cliente.pre_cadastro.reenviar` (analista, admin). Mostrar o motivo no BKO é decisão nova do dono do produto
  (antes, RN-CORE-78 dizia "só ao vendedor"); a RN precisa ser atualizada pelo `modulo-core`.

## 8. testIDs
`core.pre_cadastros.aba` · `.filtro.busca` · `.filtro.situacao` · `.linha.<id>` · `.vazio` ·
`.linha.<id>.codigo` · `.historico` · `.tentativa.<revisao>` · `.editar` · `.form.campo.<coluna>` · `.form.aviso` · `.reenviar` · `.cancelar`.

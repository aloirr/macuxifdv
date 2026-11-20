# Rota, check-in/checkout, Catálogo e Perfil · revisão T-0153

> 2026-11-10 · designer-ux · Origem: R-20261110-062240-alexandre (revisão de todas as telas, "uma informação, um lugar",
> nenhum aviso solto fora de uma área Alertas, textos curtos). **Em aprovação**: nada daqui se implementa antes do "aprovado"
> do dono do produto. Imagens: `docs/design/telas/T-0153-rota.png`, `T-0153-visita.png`, `T-0153-catalogo.png`,
> `T-0153-perfil.png` (cada uma com o quadro "O que muda"). Mesmo padrão do Início/Pedidos (`T-0153-inicio-pedidos.png`) e do
> pedido (`pedido-v4.md` §0.1: área Alertas, tabelas brancas com título por fora).

## 0. Regras que valem para as quatro telas
- **Atualização:** sem rodapé "Atualizado às…", sem faixa de sinal, sem hora repetida em cartão (`componentes.md` §5, listas).
- **Alertas:** problema que pede ação ou explica um bloqueio fica na área Alertas (título "ALERTAS" em danger, cartão branco,
  uma linha por alerta, ação curta à direita). Hoje o componente é `AreaAlertas` do Vendedor; com a aprovação, ele vai para o
  kit (`packages/ui`, designer-ux) e o Core e o shell passam a usar o mesmo.
- **Seções:** título por fora (`secao-t`, 12 px caixa alta) e tabela branca (`kv` rótulo | valor, ou linhas 48 dp). Sem cartão com
  título dentro.
- **Aviso passageiro** depois de uma ação: `AvisoRodape` do kit (escuro, rodapé, 4 s). Nada de aviso colorido no topo.

## 1. Rota de hoje (`modules/core/app/telas/rota.tsx`) · imagem T-0153-rota, quadros 1 a 4
Ordem: título "Rota de hoje" · subtítulo · mapa (com "Ir para a parada N", secundário 44) · lista.

| Elemento | Texto |
|---|---|
| Subtítulo | `6 visitas · 2 feitas · 38 km · Centro-Sul` ("1 feita" no singular; sem região, sem o último ` · `) |
| Parada feita, com pedido | `Pedido R$ 812` |
| Parada feita, sem pedido | `Sem pedido: Preço alto` (motivo como cadastrado) |
| Parada feita, fechada na virada | `Fechada na virada do dia` |
| Etapa pendente (direita) | selo aviso `Etapa pendente` (sem mudança, `checkout-pendencia.md` §1.1) |
| Próxima | `09:00` |
| Aberta | `10:30` |
| Em atendimento | `Check-in 09:02` (accentInk, semibold); fundo accentTint; nome do cliente em até 2 linhas (`numberOfLines={2}`), nunca cortado pelo botão `Checkout` (RD-0097) |
| Vazio | título `Nenhuma rota hoje`, apoio `Puxe a tela para atualizar.` |
| Depois do checkout | `AvisoRodape`: `Checkout feito · <cliente>` |

Ação à direita da linha: aberta sem atendimento → texto `Check-in` (accentInk, 44 dp, sem borda); em atendimento → botão
secundário `Checkout`; com atendimento aberto em outro cliente → só a seta (sem cadeado); feita → seta ou selo.
`OpenVisitBar` **não** aparece na Rota.

**Faixa do atendimento** (`OpenVisitBar`, no Início, Clientes e ficha de outro cliente): linha 1 `EM ATENDIMENTO` + tempo à
direita (`18 min`); nome; com pedido na visita, `Nº 000016 nesta visita` (2 ou mais: `2 pedidos nesta visita`); botões
`Checkout` (secundário sobre escuro) e `Ver cliente` (neutro sobre escuro). Saem `desde 09:02` e `Check-in às 09:02 · …`.

## 2. Check-in e checkout (`components/checkin-sheet.tsx`, `components/visit-sheets.tsx`) · imagem T-0153-visita
| Folha | Título | Linha de apoio | Principal | Texto (rodapé) |
|---|---|---|---|---|
| Registrando | — | `Pegando a localização…` (com indicador) | — | — |
| Check-in feito | `Check-in às 09:02` (com ícone de visto) | `<cliente>`; só o diferente: `<cliente> · sem GPS`, `· fora do raio, justificado`, `· posição sugerida ao supervisor` | `Novo pedido` (slot `cliente.acoes`) | `Agora não` |
| Fora do raio | `Fora do raio do cliente` | `Você está a 850 m. O limite é 300 m.` | `Registrar check-in` | `Cancelar` |
| Check-in em aberto | `Check-in em aberto` | `<cliente aberto>, desde 09:02. Um check-in por vez; o pedido continua liberado.` (RD-0095: o botão já diz a ação) | `Fazer checkout` | `Voltar` |
| Recusa do check-in | `Check-in não aceito` | `<mensagem do servidor>` | — | `Voltar` |
| Checkout | `Checkout` | `<cliente> · 25 min` | `Concluir checkout` | `Continuar no atendimento` |

Fora do raio: rótulo do campo `Por que o atendimento é aqui?`, exemplo `Ex.: atendeu no depósito ao lado`, ajuda `O supervisor vê
este texto.` + contador `0/500`; com menos de 3 letras, abaixo do botão desligado: `Escreva pelo menos 3 letras.`

Checkout, em ordem: Alertas (só com recusa do servidor ou erro ao salvar cujo motivo **não tem lugar na folha**: `O servidor
não aceitou o checkout: <motivo>`, ex.: `a hora do aparelho está 12 min diferente. Acerte a hora e tente de novo.`; quando
o motivo da recusa é uma etapa, ex.: pesquisa obrigatória sem resposta, **só a etapa** fica com `Falta`, sem alerta, RD-0094) ·
`COMO TERMINOU?` com `OpcaoFolha` em rádio: `Com pedido` + `Nº 000016 · R$ 812,40` (sem pedido: desligada, `Nenhum pedido
nesta visita`) e `Sem pedido`; os motivos em chips de 44 dp logo abaixo · cliente fechado: linha `Foto da fachada` + selo
`Falta`/`Feita` + `Tirar foto`/`Refazer`, e `As etapas ficam dispensadas.` (o chip já diz "Cliente fechado", RD-0096) · `ETAPAS`: uma linha por etapa com o rótulo,
selo `Feita` (sucesso), `Obrigatória` (neutro, antes da tentativa) ou `Opcional` (neutro) e o conteúdo/ação do módulo
dono; **depois do toque em Concluir checkout** com etapa pendente, a obrigatória não feita vira `Falta` (erro) com borda
`danger` na linha e a folha rola até ela (T-0166, RD-0182; `formulario-pendencias.md` §0.0). Sai `Falta concluir: …`. Promotor: em vez dos rádios, `Atendimento concluído` como hoje.

## 3. Catálogo (`modules/catalogo/app/telas/catalogo.tsx`, `comum.tsx`, `produto.tsx`) · imagem T-0153-catalogo
Lista e busca, em ordem: título · com cliente: `Preços de <cliente>` · busca (`Produto, código ou
aplicação`) · trilha (sem busca; termina no nível atual, **sem** o título repetido; com a aprovação desta imagem, o título
abaixo da trilha da imagem T-0142 deixa de valer) · níveis (`ListaNiveis`, sem a linha "N
produtos ativos em X") ou chips + contagem + cartões.

| Elemento | Texto |
|---|---|
| Contagem | `5 produtos`; sem internet ou com falha da busca inteligente: `3 produtos · busca simples`; índice refazendo: `· organizando o catálogo`; estoque antigo: `· estoque de 09/11` |
| Mostrar mais | T-0167: no fim da lista, `Mostrando 20 de 87` e o botão `+ Mostrar mais` (`MostrarMais`; imagem `telas/T-0167-mostrar-mais.png`); a contagem fica num lugar só: no topo (`5 produtos`) quando tudo está à vista; com mais de 20, só no fim da lista (`Mostrando 20 de 87`; RD-0194). Nada encontrado: `NadaEncontrado` com `Você quis dizer “água”?` |
| Estoque no cartão | selo na cor da faixa: `24 JG` (neutro), `Baixo · 3 JG` (aviso), `Sem estoque` (erro); sem hora |
| Adicionar | botão `+` 44 dp com borda, TalkBack `Adicionar <produto> ao pedido`; só com o slot `produto.acoes` |

Ficha, em ordem: BackLink (nível de onde veio) · `código · marca` (mono) · nome (`t.h1Small`, 22/700) · etiquetas · tabela `Preço`
(`R$ 89,90 / JG`, riscado quando promoção) e `Estoque` (selo + `24 JG na filial Centro`; uma linha por filial quando há mais de
uma) · principal `Adicionar ao pedido` · seções: Aplicação (3 linhas + `Ver mais`), Equivale a (marca | código), Oferece junto
(linhas com código; offline sem a ficha: uma linha `Ainda não está no aparelho` embaixo), Ficha técnica (`kv`, com Unidade e
EAN), Sobre o produto, Perguntas frequentes. Promotor: sem preço, estoque, `+` e botão (RN-PRO-01).

## 4. Perfil (`apps/mobile/src/app/profile.tsx`) · imagem T-0153-perfil
Ordem: BackLink · avatar + nome + `Vendedor de campo · Equipe Norte` · Alertas · `CONTA` (`kv`: E-mail, Empresa, Desconto máx.)
· `SINCRONIZAÇÃO` (`BotaoSincronizar`, a linha dele é o único lugar da última sincronização e da fila) + lista da fila só com
itens · `APARELHO` (linhas: `Meus módulos`, telas do slot de menu, `Simular sem sinal` com chave) · `DIAGNÓSTICO` (mostrar)
· `Enviar diagnóstico` e `Últimos envios` (T-0158) · `Sair / trocar usuário` · versão.

| Alerta | Texto | Ação |
|---|---|---|
| Módulo desativado com itens | `<Módulo> desativado: 2 itens não enviados` | `Apagar` → `Dialogo` `Apagar 2 itens de <Módulo>?` / `Eles não chegaram ao servidor e saem deste aparelho.` / `Apagar` (perigo) · `Cancelar` |
| Entidade sem provedor | `<Rótulo> ainda não chega do servidor` | — |
| Falha da sincronização | a frase do `mensagemDeErroDaCarga` (sem "O detalhe fica em Diagnóstico…") | — |

Fila: linha = `<rótulo do item> · <cliente>` / `Hoje 09:21`; selo `Na fila` (destaque) para pendente e enviando; recusado: motivo
em danger no lugar da data e `Descartar` (danger, 44 dp); módulo desativado: selo erro `Não enviado`. Fotos na mesma lista.
Sai o botão `Enviar agora` (premissa: o Sincronizar envia a fila com os itens que falharam; o engenheiro-apps confirma).

Diagnóstico aberto: uma tabela (Servidor, Build, Última falha, Segundo plano, Último erro, Saídas do app, Armazenamento,
Módulos) com `Copiar`. No build de desenvolvimento, o campo do servidor (`Testar e salvar`, `Padrão`) fica aqui.

Sair com fila: `Dialogo` `Sair com 3 itens na fila?` / `Eles ficam neste aparelho e vão quando você entrar de novo.` /
`Sair mesmo assim` (perigo) · `Cancelar`.

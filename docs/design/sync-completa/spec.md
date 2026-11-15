# Sincronizar: toque normal e sincronização completa ao segurar (simulação)

> 2026-11-15 · designer-ux · origem: R-20261115-100000-alexandre. **Simulação para o dono do produto**; nada vai a PR antes do ok.
> Fonte: `sync.html` (`?v=repouso|toque|segurando|completa`) e `sync.css`, com os tokens de `../catalogo-campo-v2/simulacao.css`.
> PNGs 360 × 800 (escala 2). Dados fictícios; o Início está simplificado (o desenho dele é o de `../inicio.md`).
> Onde fica hoje: o `BotaoSincronizar` do kit (`packages/ui/src/mobile/sincronizacao.tsx`) no pé do **Início** (`../inicio.md` §1.5)
> e na seção `SINCRONIZAÇÃO` do **Perfil**, pelo Mais (`../rota-catalogo-perfil.md` §4). A regra vale para os dois lugares, no Campo e no Gestão.

| PNG | O que mostra |
|---|---|
| `01-inicio-repouso.png` | o botão, a situação e a dica de segurar |
| `02-toque-normal.png` | depois do toque: o botão com o indicador e `Atualizando pedidos e clientes`, sem a dica |
| `03-segurando.png` | segurando há 4 s: anel no lugar do ícone, `Continue segurando · 6 s` |
| `04-popup-completa.png` | aos 10 s: o popup da sincronização completa, com a barra da tela de carga |

## 1. Toque normal (`02`)
- Envia o que está na fila e **atualiza só pedidos e clientes** (R-20261115-100000). Premissa do designer: a fila sempre vai, porque
  é o que o vendedor fez no aparelho.
- O botão mostra o indicador e fica sem toque (como hoje). A linha de situação vira `Atualizando pedidos e clientes`; no fim,
  `Atualizado há instantes`.
- O puxar para baixo e o selo `↻ 07:28` das listas fazem o mesmo que o toque normal.

## 2. Como o usuário sabe que pode segurar (`01`)
- Abaixo da situação, uma segunda linha, `small` `ink2`, centralizada: `Segure 10 s para a sincronização completa`. Ela só
  aparece com o botão livre: sai enquanto sincroniza e com `Sem sinal`.
- Leitor de tela: o botão tem a ação `Sincronização completa` (`accessibilityActions`), porque o TalkBack não segura 10 s.
  Rótulo: `Sincronizar. Toque para pedidos e clientes; ação: sincronização completa`.

## 3. Segurando (`03`)
- Depois de 500 ms segurando (para não confundir com o toque), o ícone `sync` dá lugar a um **anel de progresso** de 22 dp (traço 3,
  trilho branco a 30%, progresso branco) que se completa em 10 s, e o rótulo vira `Continue segurando · N s`, contando para baixo.
- Vibração leve no início do anel e média aos 10 s. Com "reduzir movimento", o anel não anima: só a contagem muda.
- A dica vira `Solte antes para atualizar só pedidos e clientes`: soltar antes dos 10 s faz o toque normal (§1).
- Aos 10 s, abre o popup (§4) na hora, mesmo com o dedo ainda no botão.
- Sem sinal: o botão já está desabilitado (`Sem sinal`, `../inicio.md` §1.5); segurar não faz nada.

## 4. Popup da sincronização completa (`04`)
- Janela no meio da tela, sobre o fundo escurecido (`scrim`), raio 20, margem de 24 dp. **Sem botão e sem ✕**: o toque fora e o
  Voltar do Android não fecham (o Voltar não faz nada). A tela não apaga enquanto ele está aberto.
- Texto (R-20261115-100000): título `Realizando a sincronização completa` (Archivo 800 19) e, embaixo,
  `Aguarde e não saia desta tela.` (15 `ink2`).
- **Barra e etapas iguais às da tela de carga** (`../entrada-sync.md` §2, itens 2 a 4, tema pérola), sem a lista de etapas.
- **Pronto:** `Pronto` e `100%`; o popup fecha sozinho depois de 600 ms, e a situação mostra `Atualizado há instantes`.
- **Parou:** a linha de erro da carga (`../entrada-sync.md` §3, item 1) e os botões `Tentar de novo` (principal) e `Fechar` (neutro).
  Só aí o Voltar fecha.
- Leitor de tela: o popup é modal; anuncia o título e cada troca de etapa; a barra é `progressbar` (`Sincronização`, 0 a 100).

## 5. Componentes
- `BotaoSincronizar` do kit ganha o segurar (anel, contagem, vibração, ação do leitor) e duas ações vindas do shell: rápida e completa.
- Popup da completa: o `Dialogo` do kit (`folha.tsx`) ganha a forma sem botões. Sem `cancelar` e `confirmar`, o conteúdo vai por
  `children`, e o Voltar não faz nada. A linha da etapa com a barra sai da `TelaEntrada` (`Barra`, `tela-entrada.tsx`) e vai para o kit,
  e a carga e o popup usam a mesma. Nenhum componente novo.
- O que cada sincronização baixa e a tela que não apaga ficam com o `engenheiro-apps` (shell e agendador, `apps/mobile/src/state/plataforma.tsx`).

# Sincronizar: toque normal e sincronização completa ao segurar

> **Tipografia substituída** pela fonte do sistema (R-20261115-110600, 15/11/2026): ver o [manual da marca §5](../../marca/manual.md#5-tipografia).

> 2026-11-15 · designer-ux · origem: R-20261115-100000-alexandre. **Aprovado pelo dono do produto em R-20261115-104500 (simulação de 09:27); atualizado com R-20261115-125500 e R-20261115-130000. Os PNGs são os da aprovação.**
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

## 1. Toque normal: sincronização parcial (`02`)
- O toque faz a **sincronização parcial** (RD-0736): envia o que está na fila e **atualiza só pedidos e clientes** (R-20261115-100000). Premissa do designer: a fila sempre vai, porque
  é o que o vendedor fez no aparelho.
- O botão mostra o indicador e fica sem toque (como hoje). A linha de situação vira `Atualizando pedidos e clientes`; no fim,
  volta à situação normal.
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
- É o `Dialogo` do kit, sem botões e `bloqueado`, com a `BarraProgresso` nas cores `TEMAS_ENTRADA.perola`, RD-0635.
  Título 22/700, mensagem 16 e raio 20: o padrão único de diálogo (parecer da marca), na escala da fonte do sistema (manual da marca §5).
- Janela no meio da tela, sobre o fundo escurecido (`scrim`), margem de 24 dp. A tela não apaga enquanto ele está aberto.
- Texto (R-20261115-100000): título `Realizando a sincronização completa` e, embaixo,
  `Aguarde e não saia desta tela.`.
- **Barra e etapas iguais às da tela de carga** (`../entrada-sync.md` §2, itens 2 a 4), sem a lista de etapas.
- **Pronto:** `Pronto` e `100%`; o popup fecha sozinho depois de 600 ms.
- **Parou:** a linha de erro da carga (`../entrada-sync.md` §3, item 1) e os botões `Tentar de novo` (principal) e `Fechar` (neutro).
  Só aí o Voltar fecha.
- Leitor de tela: o popup é modal; anuncia o título e cada troca de etapa; a barra é `progressbar` (`Sincronização`, 0 a 100).

## 5. Intervalo mínimo
- Toque, puxar e selo disparam no máximo 1 vez a cada 30 s (`INTERVALO_MIN_SYNC_MANUAL_MS`); os toques repetidos são ignorados
  em silêncio (R-20261115-125500).
- A completa (segurar 10 s ou ação do leitor) também respeita os 30 s. Bloqueada, não abre o popup e mostra, na linha abaixo do botão,
  `Dados atualizados agora há pouco. Aguarde alguns segundos e tente novamente.` (padrão da linha `Sem sinal`, `warningInk`),
  que some em 5 s (R-20261115-130000).
- O limite do servidor é silencioso e fica com o `engenheiro-software`.

## 6. Componentes
- `BotaoSincronizar` do kit ganha o segurar (anel, contagem, vibração, ação do leitor) e duas ações vindas do shell: parcial e completa.
- Popup da completa: o `Dialogo` do kit (`folha.tsx`), conteúdo por `children`.
- O que cada sincronização baixa e a tela que não apaga ficam com o `engenheiro-apps` (shell e agendador, `apps/mobile/src/state/plataforma.tsx`).

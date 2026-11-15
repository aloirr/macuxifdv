# Botão "Sincronizar": toque e segurar 10 s, popup da sincronização completa e hora do estoque (estoque diário, parte F)

> 2026-11-15 · designer-ux · decisões do Alexandre: R-20261115-100000-alexandre (decisão 4) e R-20261115-121000-alexandre (o toque
> não faz a carga diária). Base: ADR 0057 (`docs/decisoes/0057-estoque-diario-e-sincronizacao-parcial.md`) e o desenho
> `docs/desenho/T-estoque-diario.md` (§2, §7-F, §9). Referência visual da barra: `apps/mobile/src/components/tela-entrada.tsx`
> (barra da tela de carga) e `docs/design/entrada-sync.md` §2 e §3.
> Simulação: `docs/design/telas/T-estoque-diario-sincronizar.html` → `T-estoque-diario-sincronizar.png` (deviceScaleFactor 2).
> Quem faz: engenheiro-apps (botão no kit pedido abaixo, popup e ligação com `motor.sincronizar({ modo })`), modulo-catalogo
> (textos da hora do estoque, RN-CAT-07), modulo-vendedor (aviso do estoque no Alertas do Novo pedido, RN-VEN-42).
> Pareceres: corretor-redundancias (textos), design-de-marca (botão e popup, layout novo).

## 1. Botão "Sincronizar" (Início e Perfil, Campo e Gestão)
O botão continua o mesmo do kit (`BotaoSincronizar`: 52 dp, largura toda, Grafite `ink` com texto branco, ícone sync 20,
raio 14), com a linha de situação centralizada embaixo ("Última sincronização hh:mm · N na fila"). Nada novo aparece em repouso:
nenhuma dica de "segure" na tela (o vendedor usa a completa só para recuperar; a dica fica no leitor de tela, §1.4).

| # | Gesto | O que a tela mostra | O que o app faz |
|---|---|---|---|
| 1 | Toque (solta antes de 600 ms) | o de hoje: indicador de carregando no botão, depois "Atualizado há instantes" na linha de situação | `sincronizar({ modo: 'parcial' })`: fila + pedidos e clientes. Sem popup |
| 2 | Segura de 600 ms a 10 s | o rótulo vira **"Sincronização completa em N s"** (N de 9 a 1, conta a cada segundo) e uma faixa de 4 dp `graficoEscuro` (#F59A52) cresce da esquerda para a direita no pé do botão, de 0 a 100 % em 10 s contados do toque (aos 600 ms já está em 6 %). Vibração leve aos 600 ms | nada ainda |
| 3 | Solta antes dos 10 s | o rótulo volta a "Sincronizar" e a faixa some (sem animação de volta) | **= toque** (linha 1): parcial |
| 4 | Chega aos 10 s (ainda segurando) | vibração de confirmação, o botão volta ao repouso e o **popup** abre por cima (§2); soltar depois não faz nada | `sincronizar({ modo: 'completa' })` |

Detalhes:
1. **Por que 600 ms:** o toque normal de quem está com pressa não pode piscar a contagem. Antes disso o botão só faz a escala de
   0,97 do kit (toque). A faixa e a contagem aparecem juntas aos 600 ms.
2. **Linha de situação** não muda enquanto segura (o retorno está todo no botão: uma informação, um lugar).
3. **Reduzir movimento** ligado: a faixa avança aos saltos de 10 % a cada segundo, sem animar entre eles; o resto é igual.
4. **Leitor de tela:** dica do botão "Toque para atualizar pedidos e clientes. Segure 10 segundos para a sincronização completa."
   e uma ação personalizada "Sincronização completa" (menu de ações do TalkBack), que abre o popup direto. Aos 600 ms o leitor
   anuncia "Sincronização completa em 9 segundos" uma vez (não a cada segundo).
5. **Ocupado** (outra sincronização em curso, indicador no botão): o toque não faz nada como hoje; segurar 10 s **funciona** e o
   popup abre na hora mostrando "Etapa 1 de N" a 0 % até a sincronização em curso terminar (ADR 0057: a completa espera e roda
   depois).
6. **Sem sinal** (modo sem sinal ligado): o botão continua "Sem sinal" desabilitado; nem toque nem segurar fazem algo.
7. **Rótulo:** "Sincronização completa em 9 s" cabe numa linha em 320 dp (IBM Plex Sans SemiBold 16). Na largura menor do Perfil,
   se não couber, o ícone sai antes do texto quebrar.

## 2. Popup da sincronização completa
Diálogo do kit (fundo `scrim`, cartão `surface`, raio 18, 24 dp de margem lateral, preenchimento 20 dp), **centralizado** e
**sem fechar** até terminar: sem toque fora, sem "Voltar" do Android (ignorado), sem X.

### 2.1 Em andamento
De cima para baixo, alinhado à esquerda:
1. **Texto** (literal do Alexandre): **"Realizando a sincronização completa, aguarde e não saia dessa tela"** — IBM Plex Sans
   SemiBold 16/22, `ink`. É a única frase do popup.
2. **Linha da barra**, a mesma da tela de carga no modo sem lista (tela baixa): à esquerda **"Etapa {n} de {N} · {nome}"** (Plex
   Sans 13, `ink`), à direita o percentual (Plex Sans Bold 13, números tabulares). Mesmas etapas e mesmo cálculo da carga
   (`progressoDaEntrada` + `percentualDaCarga`, RN-CORE-48: a etapa nunca volta; ADR 0017: o percentual nunca volta).
3. **Barra:** 6 dp, raio 3, anima a largura em 240 ms (sem animar com "reduzir movimento").

Cores: o popup é claro nos dois apps, então usa o tema Pérola da entrada (`temaDaEntrada('gestao')`, já no kit): trilho
`#DFE2E6`, preenchimento `#C2540A` (3,54:1 no trilho e 4,60:1 no branco, mínimo de gráfico 3:1), textos da barra `#1E3350` (12,77:1). Sem lista de etapas, sem ícone, sem botão.

### 2.2 Pronto
O rótulo vira **"Pronto"** e **"100%"**; depois de 600 ms (`ESPERA_PRONTO_MS`, o mesmo da tela de carga) o popup fecha sozinho
(esmaecer de 240 ms). A linha de situação do botão mostra "Atualizado há instantes" (o de hoje). Sem aviso no rodapé (a linha
de situação já diz).

### 2.3 Parou (erro)
No lugar da linha da barra e da barra (o texto do item 1 sai, porque deixou de ser verdade):
1. **Linha do erro:** ícone de alerta 16 e o texto em `danger` (#A8261B, 7,10:1 no branco), Plex Sans SemiBold 15, os mesmos
   textos da tela de carga sem lista (`textoDoErro`):
   - sem sinal: **"Sem internet na etapa {n} de {N}"**;
   - outro erro: **"Parou na etapa {n} de {N}"**.
   O detalhe técnico vai só para o Diagnóstico (como na carga).
2. **"Tentar de novo"** — principal, 52 dp, largura toda: roda `sincronizar({ modo: 'completa' })` de novo (retoma da página em
   curso) e o popup volta ao 2.1.
3. **"Fechar"** — neutro, 44 dp, largura toda: fecha o popup. O "Voltar" do Android faz o mesmo neste estado. Sem texto
   explicando a retomada (a próxima sincronização retoma sozinha; o usuário não age sobre isso).

### 2.4 App em segundo plano e volta
Se o vendedor sair do app no meio, ao voltar com a completa ainda em curso o popup reaparece no estado atual; se ela terminou,
nada aparece; se parou, aparece o 2.3.

## 3. Hora do estoque (RN-CAT-07 revista, `carga_diaria_em` no fuso do tenant)
| Situação da carga diária | Texto |
|---|---|
| Carga de hoje | **"Atualizado às 06:12"** |
| Carga de ontem e ainda antes da hora da carga de hoje (06:00) | **"Atualizado ontem às 06:12"** |
| Carga de antes de ontem e ainda antes da hora da carga de hoje | **"Atualizado em 13/11 às 06:12"** (outro ano: "em 13/11/2025 às 06:12") |
| Desatualizado (a hora da carga de hoje passou e ela não aconteceu) | **"Estoque desatualizado · ontem às 06:12"** ou **"Estoque desatualizado · 13/11 às 06:12"**, `warningInk` SemiBold |
| Sem carga nenhuma | "Estoque sem informação" (o de hoje) |

- "Hoje" e "ontem" são dias do calendário no fuso do tenant. Hora sempre `HH:MM` 24 h. Uma função pura do Catálogo gera o texto
  (modulo-catalogo), com teste de virada de dia e de ano.
- No desatualizado a palavra "Atualizado" sai (seria "desatualizado · atualizado"): fica o aviso e o quando.
- **Uma informação, um lugar:** a hora da carga é a mesma para todos os itens, então **não** vai em cada cartão de lista
  (Catálogo, itens do Novo pedido). Vai uma vez:
  - na **ficha do produto** e no **popup do item**, embaixo do bloco de estoque (Plex Sans 13, `ink2`);
  - no **Catálogo** desatualizado, numa linha só acima da lista (faixa de aviso), com o texto da tabela;
  - no **Novo pedido** desatualizado, **só na área Alertas** (RN-VEN-42), um alerta "Estoque desatualizado · ontem às 06:12";
    nenhum aviso de estoque fora dela.
- O BKO não muda (hora do ERP e as [24] h).

## 4. O que o engenheiro-apps precisa (tokens e componentes)
- **Tokens: nenhum novo.** Usa `colors.ink`, `colors.graficoEscuro` (#F59A52 no Grafite: 7,56:1), `colors.danger`,
  `colors.scrim`, `radius.xxl`, `ALTURA.principal`/`secundario` e `temaDaEntrada('gestao')` (trilho, preenchimento, texto).
  Movimento: `duracaoMovimento('dialogo')`, 240 ms da barra, `vibrarLeve`; vibração de confirmação aos 10 s.
- **Mudança no kit (designer-ux, `packages/ui/src/mobile/sincronizacao.tsx`)**: o `BotaoSincronizar` hoje só tem `onPress`. Ele
  precisa ganhar o segurar com a faixa e a contagem (§1) e uma prop `onSegurar` (ou um `puxarCompleta` no
  `ValorSincronizacao`), com o tempo de 10 s e o limiar de 600 ms como constantes testadas. Não foi feito nesta tarefa (escopo só
  `docs/design/**`); vira tarefa do designer-ux em `packages/ui` antes da parte E.
- **Componente novo:** o popup (§2). Proposta: `PopupSincronizacaoCompleta` no kit (`packages/ui/src/mobile/`), recebendo
  `{ visivel, rotulo, pct, erro: string | null, onTentarDeNovo, onFechar }` já prontos do shell (o kit não depende do
  platform-sdk); a barra é extraída da `Barra` da `tela-entrada.tsx` para o kit e usada nos dois lugares (uma barra só). O
  shell (engenheiro-apps) monta o popup com `estado.carga`/`estado.progresso`/`estado.erro` e os textos de `lib/entrada.ts`.

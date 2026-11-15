# Tela de carga: aviso acima da barra e frase sorteada; cadastro das frases no portal `config.`

> 2026-11-15 · designer-ux · **simulação, sem implementação** até a aprovação do dono do produto (R-20261115-070000-alexandre).
> Pareceres aplicados: corretor RD-0468 a RD-0476; marca MC-0077, MC-0079 e MC-0080 (a MC-0078, tokens do aviso, fica para a
> implementação). Base: `docs/design/entrada-sync.md` (T-0172), que continua a fonte da verdade da tela de carga; esta spec
> descreve só o que entra. Na aprovação, a §2 da `entrada-sync.md` recebe a mudança do "Fora da tela" (§5 abaixo).
> Simulação: `carga-campo.png`, `carga-gestao.png` (360 × 800), `carga-campo-640.png` (360 × 640 com 48 dp de navegação),
> `config-frases.png`, `config-editar.png`. Fontes: os `.html` e o `app.css` desta pasta.

## 1. Tela de carga (Campo e Gestão, rota `/sync`, estados 4 e 5 da entrada-sync)
De cima para baixo:
1. **Logo** empilhado, parado no centro (sem mudança).
2. **"Olá, {primeiro nome}"** (sem mudança).
3. **Frase sorteada (nova):** 12 dp abaixo do "Olá"; IBM Plex Sans 14/20, `textoClaro` (Campo `#C9CED5` 8,07:1; Gestão `#4A5562`
   7,03:1), centralizada, largura máxima 280 dp, até 2 linhas. Sem aspas, sem rótulo, sem ícone.
4. **Aviso (novo)**, na área de baixo, 18 dp acima da linha da barra, texto do dono do produto:
   "Baixando os dados do servidor. Isso pode demorar alguns minutos. **Não saia desta tela!**"
   - Plex Sans 14/20 em `texto`; a última frase em SemiBold e sem quebra no meio. Sem ícone.
   - Caixa com raio 12, borda 1 dp `#C9CED5`, 12 × 14 dp de respiro. Campo: sem fundo. Gestão: fundo branco.
   - Só durante a carga (estados 4 e 5). No erro (estado 6) sai: no lugar entram a linha do erro e as ações.
   - Leitor de tela: lido uma vez, na ordem da tela, antes da barra; não é região viva.
5. **Linha da barra e barra** (sem mudança).

### 1.1 Respiro (MC-0077)
- **Prioridade:** logo, "Olá", aviso e barra. Depois a frase; por último a lista de etapas. O logo nunca se move, e nada entra na
  área de proteção dele (a altura do "M" em volta).
- **Frase:** precisa de 24 dp livres entre o pé dela e o topo do aviso. Sem isso, cai para 1 linha (só se a frase couber inteira
  em 1 linha); se ainda não couber, não aparece naquela carga. Sem reticências.
- **Aviso:** precisa de 16 dp livres abaixo do "Olá". Sem isso, perde a caixa (sem borda, sem fundo e sem respiro interno) e fica
  só o texto, com a mesma tipografia.
- **Lista de etapas:** sai antes da frase (`cabeLista` passa a contar o aviso e a frase). Uma função `cabeFrase(janela, inset)` ao
  lado do `cabeLista` decide 2 linhas, 1 linha ou nada.
- **Conferência na simulação:** 360 × 800 sem navegação: 71 dp entre a frase e o aviso, tudo aparece. 360 × 800 com 48 dp de
  navegação: 23 dp, a frase cai para 1 linha. 360 × 640 com 48 dp de navegação (`carga-campo-640.png`): a frase sai e o aviso
  fica sem a caixa, a 41 dp do "Olá".

Sem cor nova e sem movimento novo (a área de baixo já esmaece em 240 ms; com "reduzir movimento", nada anima).

## 2. Sorteio (offline)
- Uma frase por carga, sorteada quando a tela monta, entre as **ativas** do público do usuário (§4). Não troca durante a carga.
- Não repete a última mostrada no aparelho (guarda só o id dela).
- A lista vem no sync e fica no aparelho. Na primeira carga, antes de qualquer sync, o app usa as 30 iniciais que vão no
  bundle (`frases.md`). Sem nenhuma ativa, a frase não aparece.

## 3. Portal `config.` · Frases da carga (só o time Macuxi, super-admin)
- **Menu:** novo item "Frases da carga" depois de "Diagnósticos" (`MENU_TIME_MACUXI`), na `MolduraPortal`.
- **Título:** `PageHeader` "Frases da carga", sem subtítulo; ação principal (única da tela) **"Incluir frase"** (`Button primary`).
- **`Panel`** com a tabela (`th`/`td` do kit): **Nº** · **Frase** · **Para** (Vendedor, Promotor, Gestão, Todos) ·
  **Situação** (`Badge` success "Ativa" / neutral "Inativa") · links "Editar" e "Desativar" / "Ativar". As ativas vêm primeiro,
  pelo Nº; as inativas no fim. Ativar e desativar são imediatos e reversíveis, sem confirmação; a situação muda só por esse link.
- **Incluir / Editar** (`Dialog` do kit): título "Incluir frase" ou "Editar frase {nº}"; campo **Frase** (área de texto que
  para em 90 caracteres, contador "n de 90"); **Para** (lista); "Cancelar" e **"Salvar"**. A frase incluída nasce ativa.
  Erros na linha do campo: "Escreva a frase." · "Essa frase já está na lista."
- Sem excluir (desativar basta); não foi pedido.

## 4. Para o dono do produto decidir
- **Frase 25 (MC-0080):** A. "Sol, chuva ou poeira do lavrado: quem está na rua faz a venda acontecer." (sinal da origem em
  Roraima) ou B. "Sol, chuva ou poeira da estrada: quem está na rua faz a venda acontecer." (qualquer vendedor se reconhece).
  A marca recomenda a **B**, que está no `frases.md`.
- **Coluna "Para" (público):** o Campo é usado pelo vendedor e pelo promotor (o promotor nunca faz pedido, regra 7), e o Gestão
  pelo supervisor. Sem o público, o promotor veria frase de pedido. Se preferir uma lista só, a coluna sai e as frases de pedido
  e de gôndola são reescritas para servir a todos.
- As frases valem para todas as empresas (cadastro do super-admin); frase por empresa não foi pedida.

## 5. Na aprovação
- `docs/design/entrada-sync.md` §2 (RD-0476): sai "dica" do "Fora da tela" e a lista da tela ganha "frase sorteada, uma por
  carga, parada" e o aviso, com remissão a esta spec.
- Implementação, sem segurar a v1.0.10: banco e API (modulo-core / banco-dados), portal e tela do app, `cabeLista` e
  `cabeFrase` (engenheiro-apps), tokens `avisoBorda` e `avisoFundo` no `TemaEntrada` (designer-ux, MC-0078), parecer da marca e
  do corretor no print do aparelho.

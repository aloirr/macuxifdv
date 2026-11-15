# Tela de carga: aviso acima da barra e frase sorteada; cadastro das frases no portal `config.`

> 2026-11-15 · designer-ux · **simulação, sem implementação** até a aprovação do dono do produto (R-20261115-070000-alexandre).
> Base: `docs/design/entrada-sync.md` (T-0172) e manual da marca §3 a §5. Esta spec muda o item "Fora da tela" da §2 dela: a
> frase sorteada passa a entrar (a frase que se **alternava** continua fora: uma frase por carga, parada).
> Simulação: `carga-campo.png`, `carga-gestao.png`, `config-frases.png`, `config-editar.png` (fontes: os `.html` desta pasta).

## 1. Tela de carga (Campo e Gestão, rota `/sync`, estados 4 e 5 da entrada-sync)
De cima para baixo:
1. **Logo** empilhado, parado no centro (sem mudança).
2. **"Olá, {primeiro nome}"** (sem mudança).
3. **Frase sorteada (nova):** 12 dp abaixo do "Olá"; IBM Plex Sans 14/20, `textoClaro` (Campo `#C9CED5` 8,07:1; Gestão `#4A5562`
   7,03:1), centralizada, largura máxima 280 dp, até 2 linhas. Sem aspas, sem rótulo ("Dica"), sem ícone.
4. **Aviso (novo)**, na área de baixo, 18 dp acima da linha da barra, texto do dono do produto:
   "Baixando os dados do servidor. Isso pode demorar alguns minutos. **Não saia desta tela!**"
   - Plex Sans 14/20 em `texto`; a última frase em SemiBold e sem quebra no meio.
   - Caixa com raio 12, borda 1 dp `#C9CED5` (borda forte do manual), 12 × 14 dp de respiro; ícone de alerta (círculo com "!")
     de 18 dp em `texto`. Campo: sem fundo (sobre o Azul noite). Gestão: fundo branco (sobre o Pérola).
   - Só durante a carga (estados 4 e 5). No erro (estado 6) sai: no lugar entram a linha do erro e as ações.
   - Leitor de tela: lido uma vez, na ordem da tela, antes da barra; não é região viva.
5. **Linha da barra e barra** (sem mudança).
6. **Lista de etapas:** a frase e o aviso têm prioridade sobre ela. `cabeLista` passa a contar a frase (até 2 linhas = 52 dp
   com o espaço) e o aviso (~84 dp + 18). Na tela de 800 dp a lista sai e fica "Etapa n de N · nome" na linha da barra, como no
   print do dono do produto (v1.0.9).

Sem cor nova: só tokens de `TEMAS_ENTRADA` e a borda forte `#C9CED5` do manual. Sem movimento novo (a área de baixo já esmaece
em 240 ms; com "reduzir movimento", nada anima).

## 2. Sorteio (offline)
- Uma frase por carga, sorteada quando a tela monta, entre as **ativas** do público do usuário (§4). Não troca durante a carga.
- Não repete a última mostrada no aparelho (guarda só o id dela).
- A lista vem no sync e fica no aparelho. Na primeira carga, antes de qualquer sync, o app usa as 30 iniciais que vão no
  bundle (`frases.md`). Sem nenhuma ativa, a linha da frase não aparece (o espaço fica vazio, sem texto substituto).

## 3. Portal `config.` · Frases da carga (só o time Macuxi, super-admin)
- **Menu:** novo item "Frases da carga" depois de "Diagnósticos" (`MENU_TIME_MACUXI`), na `MolduraPortal`.
- **Título:** `PageHeader` "Frases da carga", sem subtítulo; ação principal (única da tela) **"Incluir frase"** (`Button primary`).
- **`Panel`** com:
  - filtro de situação em chips: "Todas 30" · "Ativas 27" · "Inativas 3" (alvo ≥ 36 px na linha, 44 px com a área de toque);
  - tabela (`th`/`td` do kit): **Nº** · **Frase** · **Para** (Vendedor, Promotor, Gestão, Todos) · **Situação** (`Badge`
    success "Ativa" / neutral "Inativa"; a inativa também tem o texto da frase em `ink-2`) · ações em link: "Editar" e
    "Desativar" / "Ativar". Ativar e desativar são imediatos e reversíveis, sem confirmação; o retorno é o próprio selo.
- **Incluir / Editar** (`Dialog` do kit): título "Incluir frase" ou "Editar frase {nº}"; campo **Frase** (área de texto,
  contador "n de 90", não passa de 90); **Para** (lista); chave **Ativa** (ligada ao incluir); "Cancelar" e **"Salvar"**.
  Erros na linha do campo: "Escreva a frase." · "Use até 90 caracteres." · "Essa frase já está na lista."
- Sem excluir (desativar basta e guarda o histórico); não foi pedido.

## 4. Premissas (para o dono do produto confirmar)
- **"Para" (público):** o Campo é usado pelo vendedor e pelo promotor (o promotor nunca faz pedido, regra 7), e o Gestão pelo
  supervisor. Sem o público, o promotor veria "Confira o pedido no resumo". Se preferir uma lista só, a coluna sai e as frases
  de pedido e de gôndola são reescritas para servir a todos.
- A frase fica embaixo do "Olá", não entre o logo e o "Olá", para não mexer no layout aprovado em 12/11.
- As frases valem para todas as empresas (cadastro do super-admin); frase por empresa não foi pedida.
- Implementação (depois da aprovação, sem segurar a v1.0.10): banco e API (modulo-core / banco-dados), portal e tela do app
  (engenheiro-apps), `cabeLista` e textos (engenheiro-apps), tokens (designer-ux), parecer da marca e do corretor.

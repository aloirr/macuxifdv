# Tela de entrada: splash e sincronização numa tela só (T-0172)

> 2026-11-12 · designer-ux · base: `docs/marca/propostas/2026-11-12-entrada-sync/` (proposta e `entrada-sync.png`), aprovada pelo
> dono do produto em 12/11/2026 ("Aprovado. Quero na 1.0.5"); manual da marca §4 e §6.
> Código: tokens em `packages/ui/src/mobile/entrada.ts` (`TEMAS_ENTRADA`, `temaDaEntrada`, `MEDIDAS_FRASE_CARGA`), testados em `entrada.test.ts`.
> Quem faz: engenheiro-apps (tela, splash, rota `/sync`), modulo-core (etapas: contrato `ProgressoEntrada`, RN-CORE-40),
> design-de-marca (parecer no print do aparelho).

## 1. Estados
A tela é sempre a mesma: o logo parado e, embaixo, a área de sincronização. Só a área de baixo muda.

| # | Quando | Área de baixo |
|---|---|---|
| 1 | Abertura sem nada a fazer | vazia, com o nome do app no rodapé ("Macuxi Campo" / "Macuxi Gestão"). Segue para o login, ou para o Início se a sessão vale |
| 2 | Antes do login, com o que fazer sem usuário | a barra com "Atualizando o app" ou "Conferindo o servidor" e o percentual. Conferir o servidor só mostra a barra depois de 400 ms |
| 3 | Login | é a tela de login (fora desta spec): logo negativo na faixa Azul noite e formulário no Pérola |
| 4 | Depois do login | "Olá, Lucas", a barra do total e a lista de etapas |
| 5 | Pronto | "Pronto", 100% e todas as etapas com ✓. O Início abre sozinho, sem botão, depois de 600 ms (o bastante para ver o 100%) |
| 6 | Parou | a etapa que parou marcada, a linha do erro e as ações (§3) |

## 2. Área de baixo (estados 2, 4, 5 e 6)
De cima para baixo, alinhada à margem lateral de 32 dp:
1. **"Olá, {primeiro nome}"** (só depois do login): IBM Plex Sans 15, `textoClaro`, centralizado, logo abaixo do logo.
   - **"Você sabia?" e frase sorteada** (estados 4 e 5), 20 dp abaixo do "Olá", centralizados: lâmpada de 16 dp
     (`<Icon name="lampada">`, cor `preenchimento`, gráfico) e, 6 dp depois, "Você sabia?" em Plex Sans SemiBold 13/18, `texto`;
     6 dp abaixo, a frase em Plex Sans 14/20, `textoClaro`, largura máxima 280 dp, até 2 linhas, sem aspas e sem itálico. Uma
     frase por carga, parada. Precisa de 24 dp livres até o aviso; sem isso, a frase cai para 1 linha (se couber inteira) ou o
     bloco inteiro sai. O título nunca aparece sozinho.
   - **Aviso** (estados 4 e 5), 10 dp acima da linha da barra, alinhado à esquerda: "Baixando os dados do servidor. Não
     desligue.", Plex Sans 13/18, `textoClaro`, 1 linha na escala de fonte 1,0; com fonte grande pode quebrar em 2, nunca é
     cortado. Sem caixa, sem borda, sem negrito e sem ícone. No erro (estado 6) sai.
   - Medidas em `MEDIDAS_FRASE_CARGA` (`packages/ui/src/mobile/entrada.ts`); sorteio, respiro e cadastro em
     `docs/design/carga-aviso-frases/spec.md` (T-0181).
2. **Linha da barra:** à esquerda "Etapa {n} de {N} · {nome da etapa}" (Plex Sans 13, `texto`); à direita o percentual (Plex Sans
   Bold 13, `texto`, números tabulares). Antes do login, o nome da tarefa no lugar da etapa. Pronto: "Pronto" e "100%".
3. **Barra:** 6 dp de altura, raio 3, trilho `trilho`, preenchimento `preenchimento`. É o percentual do total (ADR 0017), de 0 a
   100, nunca volta. Anima a largura em 240 ms; com "reduzir movimento", troca sem animar.
4. **Lista de etapas:** uma linha de 32 dp por etapa, só as dos módulos ativos no perfil, na ordem do contrato:

   | Situação | Marcador (20 dp) | Nome |
   |---|---|---|
   | feita | círculo `feita` com ✓ | `texto`, Plex Sans 14 |
   | atual | anel `preenchimento` com ponto no meio | `texto`, Plex Sans SemiBold 14 |
   | falta | anel `trilho` | `textoClaro`, Plex Sans 14 |
   | parou | círculo `erro` com "!" | `texto`, Plex Sans SemiBold 14 |

   - **Campo:** Envio do que ficou no aparelho · Clientes e rota · Catálogo e preços · Pedidos e metas · Fotos e materiais.
   - **Gestão:** Envio do que ficou no aparelho · Equipe · Aprovações · Metas · Alertas.
   - Os nomes e a divisão vêm do modulo-core.

   **Tela baixa:** se a lista não cabe entre o logo e a borda de baixo, ela sai e ficam só a linha da barra e a barra. Na carga,
   a lista sai antes do bloco "Você sabia?" (`cabeLista` conta o aviso e o bloco); logo, "Olá", aviso e barra ficam sempre.

**Fora da tela:**
- frase que se alterna durante a carga, texto sobre o que o app faz por trás, nome de tabela, de entidade ou de módulo;
- percentual por etapa e contagem de registros.

## 3. Parou (estado 6)
No lugar da linha da barra e da barra, de cima para baixo (a lista continua, com a etapa marcada):
1. **Linha do erro:** ícone de alerta 16 dp e o texto em `erro`, Plex Sans SemiBold 14:
   - sem sinal: **"Sem internet na etapa {n} de {N}"**;
   - outro erro: **"Parou na etapa {n} de {N}"**.

   O detalhe técnico vai só para o Diagnóstico (a etapa em que parou entra no registro, contrato `ParadaDiagnostico`).
2. **"Tentar de novo"**: o principal da tela, 52 dp, largura total, fundo `botaoFundo`, texto `botaoTexto`
   (`<Botao nivel="principal" sobreEscuro>` no Campo; `<Botao nivel="principal">` no Gestão).
3. **"Continuar sem sincronizar"**: secundário de contorno, 52 dp, largura total (`contorno`, `contornoTexto`). Só aparece se já
   houver uma carga anterior no aparelho. Na primeira carga, só "Tentar de novo".
4. **"Trocar usuário"**: link centralizado, Plex Sans SemiBold 14, `textoClaro`, alvo de 48 dp. Leva ao login.

## 4. Cores (`TEMAS_ENTRADA`)
Cada app usa o fundo da própria splash nativa (manual §6), para a passagem da splash para a tela não ter corte.

| Token | Campo (`faixa`) | Gestão (`perola`) |
|---|---|---|
| `fundo` / logo | `#1E3350` / empilhado negativo | `#F8F6F1` / empilhado positivo |
| barra de status | ícones claros | ícones escuros |
| `texto` | `#FFFFFF` (12,77:1) | `#1E3350` (11,82:1) |
| `textoClaro` | `#C9CED5` (8,07:1) | `#4A5562` (7,03:1) |
| `trilho` / `preenchimento` | `#3A4D68` / `#F59A52` (5,85:1 no fundo) | `#DFE2E6` / `#C2540A` (4,26:1 no fundo, 3,54:1 no trilho) |
| `feita` | `#7FD1A8` (7,05:1) | `#1D6B4F` (5,95:1) |
| `erro` | `#F7A59C` (6,58:1) | `#A8261B` (6,57:1) |
| `botaoFundo` / `botaoTexto` | `#FFFFFF` / `#1E3350` | `#1E3350` / `#FFFFFF` |
| `contorno` / `contornoTexto` | `#C9CED5` / `#FFFFFF` | `#16202A` / `#16202A` |

Use os tokens de `@macuxi/ui/mobile`, sem hex na tela.

## 5. Logo e posição
- **Arquivo:** empilhado, negativo no Campo e positivo no Gestão (`docs/marca/ativos/2026-11-12-v1/`).
- **Posição:** o tamanho e o centro são os da splash nativa (`app.config.ts`).
- **Área de baixo:** presa à borda de baixo (32 dp + área segura). Ela nunca cobre o logo.

## 6. Movimento e acessibilidade
- **Movimento:**
  - a área de baixo aparece com esmaecer de 240 ms;
  - com "reduzir movimento", não há animação nenhuma.
- **Barra:** `accessibilityRole="progressbar"`, nome "Sincronização", `accessibilityValue` { min 0, max 100, now }.
- **Leitor de tela:** anuncia só a troca de etapa ("Etapa 3 de 5, Catálogo e preços") e o erro, que é região viva assertiva.
  O percentual não é anunciado a cada passo.
- **Lista:** cada linha é lida como "{nome}, feita" / "em andamento" / "falta" / "parou".
- **Alvos:** botões de 52 dp e "Trocar usuário" com 48 dp.

## 7. Premissas
- O Gestão usa o Pérola, como a splash dele (manual §6). A proposta diz "o Gestão é igual" sobre o fluxo. Se o design-de-marca
  quiser o Azul noite também no Gestão, muda só o fundo da splash nativa dele e o `temaDaEntrada`.
- "Parou na etapa n de N" para erro que não é falta de sinal: a proposta só desenha o "Sem internet".

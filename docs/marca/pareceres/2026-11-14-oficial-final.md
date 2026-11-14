# Parecer de marca · Oficial (Campo-Oficial / Gestao-Oficial) · validação final

> 2026-11-14 · design-de-marca · pedido do recado R-20261114-043038 (alexandre → gerente-projetos, cc design-de-marca).
> **Base:** `main` `2fdad4d`, diff de `b59e2f7^` a `2fdad4d` (PRs #167 a #184), contra `docs/marca/manual.md` v1 e `decisoes.md`.
> **Sem print do aparelho:** validado pelo código, pelas pranchas de `docs/design/telas/` e pelo contraste calculado (WCAG). A pasta indicada pelo manual e pela rotina do agente é `pareceres/`, e não `validacoes/`.
> **Recados:** a CLI de recados não tem acesso ao GitHub nesta sessão (HTTP 403 na API GraphQL). Os recados aos donos ficam neste parecer e na entrega ao gerente.

## Veredito: **NÃO VALIDADO**
A regra do Oficial é **nenhum achado aberto**. No código de produção das telas do Campo e do Gestão a marca está conforme: não há achado médio ou alto, e o laranja aprovado pelo Alexandre está no lugar certo (veja abaixo). Seguram o veredito **três achados baixos com correção pronta** (MC-0018, MC-0019 e MC-0020, de 1 a 3 linhas cada) e **dois achados que dependem do Alexandre** (MC-0004 e MC-0014).

**Para virar VALIDADO:**
1. o designer-ux corrige a MC-0018 e a MC-0019, e o modulo-core corrige a MC-0020;
2. o Alexandre decide a MC-0004 e a MC-0014 (opções abaixo);
3. MC-0001 e MC-0009 fecham no print do build do Oficial: splash, entrada e sino com 1 e com 9+.

### Depende de decisão do Alexandre
| MC | Pergunta | Opções | Recomendação |
|---|---|---|---|
| MC-0004 | Os neutros de linha, campo, chip e menu ficam como estão? (`#E1E4DE`, `#ECEEE9`, `#E6E9E2`, `#C9CEC6`, `#2B3743` e `#8B96A3`, nos tokens e no `globals.css`) | **A)** aprovar como estão e registrar no manual §3 como "neutros de interface", sem mudar nenhuma tela. **B)** trocar os quatro esverdeados por neutros do Azul suave (`#DFE2E6` e derivados): muda linha, campo e chip em todas as telas, e o Oficial precisa de reteste completo | **A**: não muda nada visível antes do Oficial. Os seis neutros já passam no contraste em que são usados, e a troca B pode ficar para depois do Oficial, se ele quiser |
| MC-0014 | Qual paleta usar nas séries dos gráficos do BKO (mapa de rotas, `routes.ts:134-135`)? Hoje são 8 cores fora da marca, entre elas um roxo (`#6250D6`) e um laranja "quase igual" (`#EB6834`) | **A)** 4 séries da marca: Azul noite `#1E3350`, Sol laranja `#C2540A`, Texto secundário `#4A5562` e um azul médio novo `#5B7FA6` (4,17:1 no branco, 3,06:1 contra o Azul noite), e "outros" em `#8B96A3` (3,00:1). **B)** manter as 8 cores como paleta técnica de dados, só no mapa do BKO, registrada no manual como exceção | **A**: o mapa passa a falar a mesma língua do app. O `#5B7FA6` é cor nova e só entra com o "aprovo" dele. Com mais de 4 vendedores no mapa, as séries repetem com o número no marcador, que já existe |

## O que foi conferido e está conforme
- **Laranja (decisão do Alexandre, R-20261113-212123, e manual §3):** o Sol laranja `#C2540A` fica só em gráfico, na barra de meta, no marcador e no contador do sino no Pérola. Não há laranja como texto sobre claro nem como cor de erro em nenhuma tela tocada. A prancha `T-0170-inicio-codigo.png` mostra as quatro barras de meta em `grafico`, o percentual em `ink` ou `danger` (situação, com texto) e o ponto do almoço em laranja (marcador).
- **Kit `packages/ui` (#174 e #177):**
  - o tom `roxo` saiu de `TomEstado` e de `TONS_ESTADO` (`tokens.ts:193-200`). Nenhum `roxo`, `violet` ou `purple` sobra em `packages`, `modules` ou `apps`, fora o teste que garante isso. A MC-0005 segue fechada;
  - a prop `erro` saiu da `ListaSuspensa` (RD-0235). A UF do endereço usa `falta`, com borda `danger` e texto (situação, conforme);
  - o `CartaoCredito` e o `leituraDoSalvar` saíram (RD-0253). Não havia cor de marca neles.
- **Rótulos dos indicadores (RD-0250):** `docs/design/rotulos-indicadores.md` e `ROTULO_INDICADOR_META` (`modules/core/contracts/sync.ts`) dão um nome por indicador ("Vendas", "Positivação", "Cobertura de rota", "Visitas" e "Itens por pedido"), igual no Campo, no Gestão e no BKO. A exceção "Faturamento" (D6) está num lugar só, em `rotuloDoIndicadorMeta`. É consistência de nome em todas as superfícies: está conforme.
- **Telas tocadas:**
  - **Perfil** (`apps/mobile/src/app/profile.tsx`): selo "Na fila" em `accent` (`#1E3350` sobre `#DFE2E6`, 9,83:1) e "Não enviado" em `danger`, os dois com texto, e o erro em `danger`. Conforme;
  - **Catálogo** (#168 e #179): sem foto, a caixa fica vazia em `neutralBg`, e a inicial em Archivo saiu. Não há hex solto. O tom do neutro é o da MC-0004;
  - **Pedidos, Novo pedido e endereço** (#169 e #176): só texto e estrutura, sem cor nova;
  - **Core** (#171 e #175): rota, notificações, Cliente 360, check-in e Metas e Plano de RV no BKO, sem cor nova. Os chips "Não lida" e "Leitura não enviada" saíram. O selo do editor de rotas (`route-editor.tsx`) usa `danger` (situação, com texto) ou `pending` (Azul noite sobre o Azul suave);
  - **Gestor** (#184) e **Treinamento** (#180): só rótulo e texto.
- **Pranchas:**
  - `T-0170-inicio-codigo.png` é o Início implementado, nos tokens v1: painel Azul noite, fundo Pérola, cartões brancos, sino no Pérola com contador `#C2540A` e número branco (4,60:1), aba ativa em Azul noite e o Sincronizar em grafite (§3). Com ela, a parte da T-0170 da **MC-0013 fecha**;
  - na `T-0170-inicio-opcao-b.html:66`, o ícone de "pedido" passou a Azul noite. A MC-0012 está conforme também na prancha;
  - em `T-0168-bko-1/2/3.png`, o "M" saiu e entrou o símbolo negativo da v1 direto no grafite. O texto do menu está em `#C9CED5` e o grupo em `#9AA3B0`, e a aba "Parâmetros" e o "Editar" estão em Azul noite. Com isso, a **MC-0007 fecha**. O que sobra na prancha é a MC-0018.

## Achados novos
### MC-0018 · prancha do BKO com o botão principal e o interruptor em grafite · baixa
| Campo | Conteúdo |
|---|---|
| Onde | `docs/design/telas/T-0168-bko.html:59` (`.bw.pri`) e `:50` (`.sw.on .tr`); as imagens `T-0168-bko-1/2/3.png` |
| Tipo | cor · aplicação |
| Fere | §3: o Azul noite é a cor do **botão principal**, e o grafite fica para texto, Sincronizar e menu. O BKO de verdade já usa o Azul noite (`packages/ui/src/web/ui.tsx:143`, `primary: 'bg-accent'`): a prancha, que é a referência do testes e do corretor, mostra outra cor |
| Correção | `:59` `.bw.pri { background: var(--ink); … border-color: var(--ink); }` → `background: var(--accent); … border-color: var(--accent);`. Em `:50`, `.sw.on .tr { background: var(--ink); }` → `var(--accent)`, se o interruptor do BKO for Azul noite; se o componente real for grafite (`permissoes.tsx:117`), mantenha e registre no `componentes.md`. Depois, regerar as três PNG |
| Dono | designer-ux |

### MC-0019 · `BotaoLink` principal do kit web em grafite, com hex solto no hover · baixa
| Campo | Conteúdo |
|---|---|
| Onde | `packages/ui/src/web/botao-link.tsx:27` e `:29` |
| Tipo | cor |
| Fere | §3 e checklist A: o botão principal é Azul noite, e não se usa hex solto nem cor "quase igual" (`#0B1218` ≈ grafite; `#8D1F16` ≈ erro). O próprio comentário da linha 25 diz "mesma cara do `<Button>`", e o `<Button>` é `bg-accent` |
| Correção | `:27` `'bg-ink text-white hover:bg-[#0b1218]'` → `'bg-accent text-white hover:bg-accent/90'`; `:29` `hover:bg-[#8d1f16]` → `hover:bg-danger/90`; e acertar o `botao-link.test.ts:16` (`bg-accent`). Nenhuma tela usa o componente hoje: se ele não tiver uso previsto, apagar o arquivo também fecha o achado (o corretor confirma se é código morto) |
| Dono | designer-ux |

### MC-0020 · fundo do carregamento do mapa de rotas com hex solto fora da paleta · baixa
| Campo | Conteúdo |
|---|---|
| Onde | `modules/core/web/components/routes/routes-page.tsx:41` (`bg-[#e9ece6]`) |
| Tipo | cor |
| Fere | §3 e checklist A: cor pelo token, nunca hex solto; `#E9ECE6` não existe nem entre os neutros de hoje |
| Correção | `bg-[#e9ece6]` → `bg-neutral-soft` (`--color-neutral-soft: #e6e9e2`, que é o mesmo neutro do resto do BKO e fica coberto pela decisão da MC-0004) |
| Dono | modulo-core |

## Situação de todos os achados
| ID | Situação no `2fdad4d` |
|---|---|
| MC-0001 | **fecha no print** do build do Oficial (logo da splash e da entrada com 136 dp) |
| MC-0002, 0003, 0005, 0006, 0008, 0010, 0011, 0012, 0015, 0016, 0017 | fechadas; nada no diff as reabre |
| MC-0004 | **aberta**: depende da decisão do Alexandre (acima) |
| MC-0007 | **fechada** (prancha do BKO na v1) |
| MC-0009 | **fecha no print** (sino com 1 e com 9+, na faixa e no Pérola) |
| MC-0013 | **fechada** (`T-0170-inicio-codigo.png`) |
| MC-0014 | **aberta**: `STATUS_FILL` fechado; as séries dependem da decisão do Alexandre (acima) |
| MC-0018, MC-0019 e MC-0020 | **abertas**, com a correção pronta |

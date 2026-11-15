# Parecer de marca · simulação do aviso e das frases na carga · cadastro no `config.`

> 2026-11-15 · design-de-marca · pedido R-20261115-070000-alexandre (simulação, só docs).
> **Base:** branch `nuvem/carga-frases-designer-ux`, commit `01b1231124a065447770b4e2edec7d57a19e6059` (reteste no `ed7b6bc7e2cd092384c27ff03e561f9db97c575c`), pasta `docs/design/carga-aviso-frases/` (`spec.md`, `frases.md`, `carga-campo.png`, `carga-gestao.png`, `config-frases.png`, `config-editar.png` e as fontes `.html`/`app.css`), contra `docs/marca/manual.md` v1 e `decisoes.md` do `main` `06505049b`.
> **Como:** leitura dos quatro PNGs, da spec, das 30 frases (todas) e dos hex do `app.css` e do `config-frases.html`; contas de altura da tela de carga com as medidas do `app.css` e o `posicaoDoLogo` (logo empilhado de 126 dp no centro).
> **Numeração:** MC-0077 a MC-0080 (a última em uso nos branches da marca é MC-0076). O `catalogo.md` recebe estas linhas na consolidação do catálogo, junto com os branches de reteste ainda abertos, para não gerar conflito.

## Reteste (2026-11-15, commit `ed7b6bc7e2cd092384c27ff03e561f9db97c575c`): **liberado**
**Escopo deste reteste: só o layout e a regra de respiro.** O Alexandre mudou o tema das 30 frases (aviso do gerente-projetos, 15/11): agora são sobre a história e o folclore de Roraima, com pelo menos 24 sobre o povo Macuxi, o Monte Roraima e Makunaimã, e 6 sobre outros aspectos de Roraima. O tom da lista nova vem para a marca depois, junto com as fontes. O layout da tela de carga, o aviso e o portal estão liberados para ir ao Alexandre. Só ele aprova a marca.

| Achado | Situação | Conferido em |
|---|---|---|
| MC-0077 | **fechado** | `spec.md` §1.1: prioridade do logo, do "Olá", do aviso e da barra; 24 dp entre a frase e o aviso, com a frase em 1 linha ou fora; o logo não se move; `cabeFrase`. `carga-campo-640.png` (360 × 640 com 48 dp de navegação): a frase sai, o aviso fica a ~41 dp do "Olá" e a área de proteção do logo está livre. As contas da spec (71 dp e 23 dp em 800) batem com as minhas |
| MC-0079 | **cancelado** (tema novo) | a lista de dicas de venda sai; a frase 20 deixa de existir |
| MC-0080 | **cancelado** (tema novo) | a pergunta A/B sobre "lavrado" perde o objeto: o tema agora é Roraima |
| MC-0078 | aberto, **para a implementação** | `spec.md` §5 manda os tokens `avisoBorda` e `avisoFundo` para o `TemaEntrada`. Não segura a simulação: as cores são as mesmas |

**Regra nova do designer-ux, validada:** sem 16 dp livres abaixo do "Olá", o aviso perde a caixa e fica só o texto, na mesma tipografia e na cor `texto` (branco no Azul noite, 12,77:1). Não entra cor nem peso novo, o "Não saia desta tela!" continua em SemiBold e o texto do Alexandre fica inteiro. Em tela baixa, a mensagem dele pesa mais que a moldura: a regra está certa para a marca.

**O que mudou e também está conforme:**
- **Aviso sem ícone:** fica mais limpo e não disputa com o logo. O texto e o SemiBold bastam.
- **Portal:** sem os chips e sem o texto cinza na inativa; os hex do `config-frases.html` continuam todos na paleta.
- **Frases:** fora deste reteste (tema novo). O layout vale para qualquer frase de até 2 linhas e 90 caracteres.

**O que a marca vai conferir na lista nova** (para o designer-ux já escrever assim; base no manual §1 e §8 e no checklist D):
1. **Fonte de cada frase** sobre o povo Macuxi e Makunaimã registrada (publicação, organização ou pessoa), na própria lista.
2. **Narrativa como narrativa:** "segundo a tradição" (ou "conta a tradição macuxi"), nunca como fato nem como lenda exótica. Sem "mito" no sentido de mentira, sem "índio", sem tempo passado para um povo que existe hoje.
3. **Nada sagrado ou ritual** como curiosidade; nenhuma frase liga Makunaimã ou o povo Macuxi à venda, à meta ou ao produto (seria usar a cultura como enfeite, o que o §1 proíbe).
4. **Validação de pessoa ou organização macuxi** antes do "aprovo" do Alexandre para as frases sobre o povo e as narrativas (checklist D; o manual §8 exige artista ou organização macuxi para padrão cultural, e a marca recomenda o mesmo cuidado no texto). Sem essa validação, a marca libera só as frases de paisagem e de história documentada de Roraima.
5. Grafia: "Macuxi" sempre inteiro e com inicial maiúscula; "Makunaimã" com a grafia que a fonte usar, a mesma em todas.

**Observação para a implementação (não é achado):** a nota "(A/B a decidir)" na célula da frase 25 do `frases.md` some com a lista nova; nenhuma anotação pode ir no bundle das 30 iniciais.

## Primeira análise (commit `01b1231`)
### Veredito: liberado com ajustes
Nada fere o manual aprovado: sem cor nova, sem fonte nova, logo certo para cada fundo e o texto do Alexandre mantido. Há um ajuste de layout que precisa entrar na spec antes de ir ao Alexandre (MC-0077), uma troca de frase (MC-0079), um ajuste de token para a implementação (MC-0078) e uma escolha que é do Alexandre (MC-0080).

**Para mandar ao Alexandre:** o designer-ux corrige a MC-0077 (regra na spec e um print 360 × 640 com barra de navegação de 48 dp) e troca a frase 20 (MC-0079). A MC-0080 vai como pergunta, com as duas opções. A MC-0078 pode entrar na spec agora ou na implementação.

## O que está conforme
- **Cor:** todos os hex dos PNGs e das fontes estão na paleta da §3 ou nos tokens aprovados da entrada (§4): `#1E3350`, `#F8F6F1`, `#FFFFFF`, `#C9CED5`, `#4A5562`, `#3A4D68`, `#F59A52`, `#C2540A`, `#DFE2E6`, `#ECEEF1`, `#16202A`, `#34404D`, `#1D6B4F`/`#E2F1EA` (selo "Ativa", situação com texto). Nenhuma cor "quase igual". O laranja continua só na barra (gráfico).
- **Contraste:** frase em `textoClaro`: Campo `#C9CED5` no Azul noite 8,07:1; Gestão `#4A5562` no Pérola 7,03:1. Aviso: branco no Azul noite 12,77:1 (Campo); Azul noite no branco 12,77:1 (Gestão). Todos acima de 4,5:1.
- **Ícone do aviso** na cor do texto, e não no âmbar de aviso: certo. O `#7A4F00` não lê sobre o Azul noite, e a carga é uma espera normal, não uma situação de erro.
- **Tipografia:** IBM Plex Sans 14/20 na frase e no aviso, SemiBold (600) só em "Não saia desta tela!", percentual em Bold com algarismo tabular. No portal, título em Archivo ExtraBold e texto em Plex Sans. Tudo dentro do §5.
- **Logo:** empilhado negativo no Campo (Azul noite) e empilhado positivo no Gestão (Pérola), arquivos prontos da `ativos/2026-11-12-v1/`, parado no centro, sem mudança do layout aprovado em 12/11. O "Olá" fica a 28 dp do logo, acima da altura do "M" (~25 dp): a área de proteção está livre na tela de 800 dp. A frase entra embaixo do "Olá", e não entre o logo e o "Olá": certo.
- **Aviso:** o texto é o do Alexandre ("Baixando os dados do servidor. Isso pode demorar alguns minutos. Não saia desta tela!"), com o ajuste só de pontuação, que ele autorizou. A caixa com raio 12 conversa com os cartões do app.
- **Frase:** sem aspas, sem rótulo e sem ícone, uma por carga e parada. É discreta e não disputa com a marca.
- **Portal `config.`:** item "Frases da carga" no menu do time Macuxi, `PageHeader`, botão principal "Incluir frase" em Azul noite, filtro em chips, selo de situação com texto, diálogo do kit. Mesma identidade das outras telas do portal.
- **Tom de voz das 30 frases (todas lidas):** direto, confiante e de quem conhece a rua. Imperativo curto, vocabulário do campo (giro, ponto, gôndola, ruptura, encarregado, balconista, repositor), sem jargão técnico, sem promessa do produto, sem cliente real, sem marca de terceiros, e o nome Macuxi não aparece em nenhuma (nada a errar na grafia). Todas abaixo de 90 caracteres (a maior tem 72). A separação por público (Vendedor, Promotor, Gestão, Todos) protege a marca: o promotor não lê frase de pedido.

## Achados
### MC-0077 · frase e aviso se encostam em tela baixa · média
| Campo | Conteúdo |
|---|---|
| Onde | Tela de carga do Campo e do Gestão; `spec.md` §1, itens 3, 4 e 6 |
| Tipo | aplicação (respiro da tela de marca) |
| Fere | §4 (entrada aprovada: logo parado no centro com respiro) e §2.3 no limite. A spec só prevê que a **lista de etapas** sai quando falta espaço; não diz o que acontece com a frase |
| Conta | Com as medidas do `app.css`, o pé da frase (2 linhas) fica em `H/2 + 163` e o topo do aviso em `H − 167 − inset de baixo`. Com 3 botões de navegação (inset 48 dp): em 800 dp sobram 22 dp; em 720 dp a frase invade o aviso em 18 dp; em 640 dp (altura que o `cabeLista` já testa) invade o aviso e chega perto do logo |
| Correção | Na spec: **(1)** o logo, o "Olá", o aviso e a barra têm prioridade; **(2)** respiro mínimo de **24 dp** entre o pé da frase e o topo do aviso; **(3)** sem esse respiro, a frase cai para **1 linha**, e, se ainda não couber, **não aparece** naquela carga (sem reticências e sem mover o logo); **(4)** nada entra na área de proteção do logo (altura do "M" em volta). Uma função `cabeFrase(janela, insets.bottom)` ao lado do `cabeLista`. Mandar o print 360 × 640 com inset de 48 dp junto com os de 800 dp |
| Dono | designer-ux (spec e simulação); engenheiro-apps na implementação |

### MC-0078 · borda e fundo do aviso por hex, sem token · baixa
| Campo | Conteúdo |
|---|---|
| Onde | `spec.md` §1, item 4 ("borda 1 dp `#C9CED5`", "fundo branco"); `app.css` `.campo .aviso` e `.gestao .aviso` |
| Tipo | cor |
| Fere | Checklist A: cor pelo token, nunca hex solto. No tema `perola` o `contorno` é o grafite, então o `#C9CED5` do Gestão sairia como hex na tela |
| Correção | Dois campos novos no `TemaEntrada` (`packages/ui/src/mobile/entrada.ts`): `avisoBorda` e `avisoFundo`. `faixa`: `avisoBorda: FAIXA.subtitulo` (`#C9CED5`), `avisoFundo: FAIXA.fundo` (sem caixa preenchida). `perola`: `avisoBorda` = o token da borda forte (`#C9CED5`), `avisoFundo: MARCA.branco`. Os pares do aviso entram no `paresDaEntrada` (texto no `avisoFundo`). A spec cita os tokens no lugar dos hex. São as mesmas cores: nada muda no visual |
| Dono | designer-ux |

### MC-0079 · frase 20 contraria a meta que o cliente define · baixa
| Campo | Conteúdo |
|---|---|
| Onde | `frases.md`, nº 20 (Gestão): "Meta clara para a equipe vale mais que meta alta." |
| Tipo | voz |
| Fere | Tom de voz (§9) e a regra de não competir com o cliente (§2.4, último item, aplicado à voz): quem define a meta é a distribuidora. A marca não opina se a meta dela é alta; ela ajuda a equipe a cumprir. Lida pelo supervisor, a frase pode virar argumento contra a diretoria do cliente |
| Correção | "Meta clara para a equipe vale mais que meta alta." → **"Meta clara: cada vendedor sabe quanto falta e onde buscar."** (58 caracteres; mesmo público, mesma ideia de clareza, sem julgar o tamanho da meta) |
| Dono | designer-ux |

### MC-0080 · frase 25 usa "lavrado", palavra de Roraima · baixa · decisão do Alexandre
| Campo | Conteúdo |
|---|---|
| Onde | `frases.md`, nº 25 (Todos): "Sol, chuva ou poeira do lavrado: quem está na rua faz a venda acontecer." |
| Tipo | voz |
| Fere | Nada no manual: o lavrado é paisagem, faz parte do símbolo (§1) e não é grafismo nem símbolo cultural (§8). A questão é de negócio: a plataforma é vendida a distribuidores de qualquer estado, e o vendedor de fora de Roraima pode não conhecer a palavra |
| Opções | **A.** manter "do lavrado": sinal de origem da marca, que nasce em Roraima. **B.** "Sol, chuva ou poeira da estrada: quem está na rua faz a venda acontecer." (todo vendedor se reconhece) |
| Recomendação | **B.** A origem em Roraima já está no logo (a serra e a linha do lavrado), que aparece em toda carga; a frase serve melhor ao vendedor de qualquer lugar. Se o Alexandre quiser o toque regional, a A não fere nada |
| Dono | designer-ux leva a pergunta ao Alexandre junto com a simulação |

## Fora deste parecer
- **Portal `config.`, logo da faixa:** a simulação reproduz a `MarcaNaFaixa` atual (logo a 130 px, folga de 10 a 14 px). É a **MC-0022**, ainda aberta com o engenheiro-apps; a tela nova herda a correção quando ela entrar. Não é achado novo.
- Repetição entre frases (1 e 2 falam da última visita) e a exatidão da frase 29 sobre a sincronização: escopo do corretor-redundancias e do testes.
- A premissa do público ("Para") e a decisão de não haver frase por empresa são do Alexandre (spec §4); a marca não se opõe.

## Para o Alexandre
Só ele aprova. A marca libera a simulação para ir a ele depois da MC-0077 e da MC-0079, com a pergunta da MC-0080. Depois do "aprovo", o texto das 30 frases não entra no manual (é conteúdo editável no `config.`); entra em `decisoes.md` o registro da tela de carga com aviso e frase, e o §4 do manual (Entrada no app) ganha uma linha com a posição da frase e do aviso.

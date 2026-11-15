# Tela de carga: aviso acima da barra e "Você sabia?" com frase sorteada; cadastro das frases no portal `config.`

> 2026-11-15 · designer-ux · **aprovada** pelo dono do produto (R-20261115-070000, R-20261115-071500 e R-20261115-075500, com o
> ajuste R-20261115-080500) e **implementada na T-0181**.
> Pareceres aplicados: corretor RD-0468 a RD-0476; marca MC-0077, MC-0079 e MC-0080 (a MC-0078, tokens da caixa do aviso, deixou de
> existir: o aviso ficou sem caixa em R-20261115-080500-alexandre). Base: `docs/design/entrada-sync.md` (T-0172), que continua a fonte da verdade da tela de carga; esta spec
> descreve só o que entra. A §2 da `entrada-sync.md` já traz o aviso e a frase.
> Simulação: `carga-campo.png`, `carga-gestao.png` (360 × 800), `carga-campo-640.png` (360 × 640 com 48 dp de navegação),
> `config-frases.png`, `config-editar.png`. Frases: `frases.md` (tema de Roraima, com as fontes na §5). Fontes: os `.html` e o `app.css` desta pasta.

## 1. Tela de carga (Campo e Gestão, rota `/sync`, estados 4 e 5 da entrada-sync)
Ajuste do dono do produto em R-20261115-080500-alexandre (referência `recados/anexos/R-20261115-080500-carga-ajuste.png` no
repositório de recados). De cima para baixo:
1. **Logo** empilhado, parado no centro (sem mudança).
2. **"Olá, {primeiro nome}"** (sem mudança).
3. **"Você sabia?" (novo):** 20 dp abaixo do "Olá", centralizado: ícone de lâmpada de 16 dp e, 6 dp depois, "Você sabia?" em
   14/20 peso 600 (fonte do sistema), cor `texto` (Campo branco 12,77:1; Gestão Azul noite 11,82:1). A lâmpada usa a cor
   `preenchimento` da barra (Campo sol claro `#F59A52`, 5,85:1; Gestão sol laranja `#C2540A`, 4,26:1): é gráfico, não texto, e
   fica dentro da regra do manual §3. A referência do dono do produto pinta também o texto de laranja; isso pede exceção da marca
   (sol como texto) e fica para o design-de-marca decidir.
   - **Lâmpada:** não existe no kit (`packages/ui/src/mobile/icon.tsx`). Desenhada no traço da família (grade 24, traço 2, pontas
     redondas, sem preenchimento): `M9 18h6` · `M10 21h4` · `M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.6
     1.1-2.1A6 6 0 0 0 12 3z`. Entra no kit como `lampada` na implementação (designer-ux), com o teste do `icon.test.ts`.
   - Decorativa para o leitor de tela; o rótulo e a frase são lidos juntos: "Você sabia? {frase}".
4. **Frase sorteada:** 6 dp abaixo do "Você sabia?"; 14/20 peso 400 (fonte do sistema), `textoClaro` (Campo `#C9CED5` 8,07:1; Gestão `#4A5562`
   7,03:1), centralizada, largura máxima 280 dp, até 2 linhas. Sem aspas e sem itálico.
5. **Aviso**, na área de baixo, 10 dp acima da linha da barra: "Baixando os dados do servidor. Não desligue."
   - Sem destaque: 14/20 peso 400 (fonte do sistema), `textoClaro`, alinhado à esquerda como a linha da barra. Sem caixa, sem borda,
     sem negrito, sem ícone. 1 linha na escala 1,0; com fonte grande pode quebrar em 2, nunca é cortado.
   - Só durante a carga (estados 4 e 5). No erro (estado 6) sai: no lugar entram a linha do erro e as ações.
   - Leitor de tela: lido uma vez, na ordem da tela, antes da barra; não é região viva.
6. **Linha da barra e barra** (sem mudança).

### 1.1 Respiro (MC-0077)
- **Prioridade:** logo, "Olá", aviso e barra. Depois o bloco "Você sabia?" com a frase; por último a lista de etapas. O logo nunca
  se move, e nada entra na área de proteção dele (a altura do "M" em volta).
- **Bloco "Você sabia?":** precisa de 24 dp livres entre o pé da frase e o topo do aviso. Sem isso, a frase cai para 1 linha (só
  se couber inteira em 1 linha); se ainda não couber, o bloco inteiro (lâmpada, rótulo e frase) não aparece naquela carga. O
  rótulo nunca aparece sozinho. Sem reticências.
- **Aviso:** 1 linha na escala 1,0; com fonte grande pode quebrar em 2, nunca é cortado. Sem caixa; não muda com a altura da tela.
- **Lista de etapas:** sai antes do bloco (`cabeLista` passa a contar o aviso e o bloco). Uma função `cabeFrase(janela, inset)`
  ao lado do `cabeLista` decide 2 linhas, 1 linha ou nada.
- **Conferência na simulação:** o bloco ocupa 86 dp com a frase em 2 linhas (20 + 20 + 6 + 40) e 66 dp com 1 linha.
  - 360 × 800 sem navegação: 111 dp entre a frase e o aviso, tudo aparece (`carga-campo.png`, `carga-gestao.png`).
  - 360 × 800 com 48 dp de navegação: 63 dp, tudo aparece.
  - 360 × 640 com 48 dp de navegação (`carga-campo-640.png`): 69 dp livres entre o "Olá" e o aviso, menos que os 90 dp do bloco
    com 1 linha e o respiro; o bloco sai e ficam o logo, o "Olá", o aviso e a barra.

Sem cor nova (a lâmpada usa o `preenchimento` que já existe) e sem movimento novo (a área de baixo já esmaece em 240 ms; com
"reduzir movimento", nada anima).

## 2. Sorteio (offline)
- Uma frase por carga, sorteada quando a tela monta, entre as **ativas**. Não troca durante a carga.
- Não repete a última mostrada no aparelho (guarda só o id dela).
- A lista vem no sync e fica no aparelho. Na primeira carga, antes de qualquer sync, o app usa as ativas das 30 iniciais que
  vão no bundle (`frases.md`, coluna Situação inicial). Sem nenhuma ativa, a frase não aparece.

## 3. Portal `config.` · Frases da carga (só o time Macuxi, super-admin)
- **Menu:** novo item "Frases da carga" depois de "Diagnósticos" (`MENU_TIME_MACUXI`), na `MolduraPortal`.
- **Título:** `PageHeader` "Frases da carga", sem subtítulo; ação principal (única da tela) **"Incluir frase"** (`Button primary`).
- **`Panel`** com a tabela (`th`/`td` do kit): **Nº** · **Frase** · **Situação** (`Badge` success "Ativa" / neutral "Inativa") · links "Editar" e "Desativar" / "Ativar". As ativas vêm primeiro,
  pelo Nº; as inativas no fim. Ativar e desativar são imediatos e reversíveis, sem confirmação; a situação muda só por esse link.
- **Frase inativa** (estado que o PNG não mostra, porque as 30 iniciais entram ativas): selo neutral "Inativa", link "Ativar"
  no lugar de "Desativar", texto da frase na mesma cor das ativas, linha no fim da lista. Não entra no sorteio do app.
- **Incluir / Editar** (`Dialog` do kit): título "Incluir frase" ou "Editar frase {nº}"; campo **Frase** (área de texto que
  para em 90 caracteres, contador "n de 90"); "Cancelar" e **"Salvar"**. A frase incluída nasce ativa.
  Erros na linha do campo: "Escreva a frase." · "Essa frase já está na lista."
- Sem excluir (desativar basta); não foi pedido.

## 4. Tema e premissas
- **Tema (R-20261115-071500-alexandre):** as 30 frases são sobre a história e a tradição de Roraima: 8 sobre o povo Macuxi,
  8 sobre o Monte Roraima, 8 sobre Makunaimã e 6 sobre outros aspectos do estado (80% nos três temas principais).
- **Situação inicial:** decisão do dono do produto em R-20261115-075500-alexandre (coluna Situação inicial do `frases.md`).
- As frases valem para todas as empresas (cadastro do super-admin); frase por empresa não foi pedida.

## 5. Fontes
Cada fato foi conferido na fonte citada (pesquisa de 15/11/2026). Nº da pesquisa = número da candidata na lista de 40
(R = reserva). A fonte não vai no texto da tela; quando o número depende do ano, a frase traz o ano (RD-0483, MC-0084).
Nome de povo sempre com inicial maiúscula (MC-0081). Regras de redação (parecer da marca `docs/marca/pareceres/2026-11-15-carga-frases.md`): narrativa com
"Segundo a tradição {povo},"; sem "mito" no sentido de mentira, sem "índio", sem passado para um povo que existe hoje; nada
sagrado ou ritual como curiosidade; nenhuma ligação com venda; "Makunaimã" numa grafia só (Macunaíma só para o livro de 1928).
Ficaram de fora: o pajé e o parixara (xamanismo e ritual), o "Pikatënninan" (grafia não conferida) e o "Makunaimë".

| Nº | Tema | Pesquisa | Fonte |
|---|---|---|---|
| 1 | Macuxi | 1 | "Macuxi", Paulo Santilli, Povos Indígenas no Brasil (ISA) · https://pib.socioambiental.org/pt/Povo:Macuxi |
| 2 | Macuxi | 2 | "Macuxi", ISA · https://pib.socioambiental.org/pt/Povo:Macuxi |
| 3 | Macuxi | 3 | "Macuxi", ISA (cabeçalho: RR 37250, Siasi/Sesai 2020) · https://pib.socioambiental.org/pt/Povo:Macuxi |
| 4 | Macuxi | 6 | "Damurida e o Sabor das Transformações Históricas em Roraima", L. L. Martins, REPAM (UnB), 2023 · https://periodicos.unb.br/index.php/repam/article/download/56186/44667/230537 |
| 5 | Macuxi | 8 | "Macuxi", ISA (homologada em abril de 2005) · https://pib.socioambiental.org/pt/Povo:Macuxi |
| 6 | Macuxi | 10 | "Diagnóstico sociolinguístico… Lei 211/2014", J. P. Pereira e A. Machado, Tellus (UCDB) · https://tellus.ucdb.br/tellus/article/download/628/561/2596 |
| 7 | Macuxi | 11 | Obra "Parixara", Carmézia Emiliano, acervo do MASP · https://www.masp.org.br/en/collections/works/parixara |
| 8 | Macuxi | R1 | Resenha de P. C. Albernaz (UFRR), Revista Pesquisa FAPESP nº 327, maio 2023 · https://revistapesquisa.fapesp.br/wp-content/uploads/2023/05/096_resenha_327.pdf |
| 9 | Monte Roraima | 12 | "Pontos mais altos do Brasil – 2024", Anuário Estatístico do Brasil, IBGE · https://anuario.ibge.gov.br/images/aeb/2024/s1/2_pdf/s1t3201.pdf |
| 10 | Monte Roraima | 13 | Mesma tabela do IBGE, notas (2) e (3) · https://anuario.ibge.gov.br/images/aeb/2024/s1/2_pdf/s1t3201.pdf |
| 11 | Monte Roraima | 14 | Relatório da UC, CNUC (MMA) · https://cnuc-backend.mma.gov.br/api/v1/report/uc/174 |
| 12 | Monte Roraima | 16 | N. J. Reis et al., Brazilian Journal of Geology 47(1), 2017 (SciELO) · https://www.scielo.br/j/bjgeo/a/mPdYsxGSsrN6qb4bFs4PzLG/ |
| 13 | Monte Roraima | 17 | "Ingarikó", ISA · https://pib.socioambiental.org/pt/Povo:Ingarik%C3%B3 |
| 14 | Monte Roraima | 18 | C. T. F. Fagundes, Cadernos de Tradução (UFSC), 2024 · https://periodicos.ufsc.br/index.php/traducao/article/view/104170 |
| 15 | Monte Roraima | 19 | ICMBio em Foco nº 548, ICMBio · https://www.gov.br/icmbio/pt-br/centrais-de-conteudo/publicacoes/icmbio-em-foco/pdf/icmbioemfoco548.pdf |
| 16 | Monte Roraima | 20 | "Ingarikó", ISA · https://pib.socioambiental.org/pt/Povo:Ingarik%C3%B3 |
| 17 | Makunaimã | 23 | J. L. Jobim, R. Mibielli et al., "Makunaimã/Macunaíma: a encenação da autoria indígena", Brasil/Brazil (UFRGS) · https://seer.ufrgs.br/index.php/brasilbrazil/article/download/149161/96406/670067 |
| 18 | Makunaimã | 24 | "Macuxi", seção "Cosmogonia", ISA · https://pib.socioambiental.org/pt/Povo:Macuxi |
| 19 | Makunaimã | 25+26 | "Macuxi", seção "Cosmogonia", ISA · https://pib.socioambiental.org/pt/Povo:Macuxi |
| 20 | Makunaimã | 28 | "Taurepang", ISA · https://pib.socioambiental.org/pt/Povo:Taurepang |
| 21 | Makunaimã | 30 | "Ingarikó", ISA · https://pib.socioambiental.org/pt/Povo:Ingarik%C3%B3 |
| 22 | Makunaimã | 31 | "Ingarikó", narrativa da agricultura (registrada em 2017), ISA · https://pib.socioambiental.org/pt/Povo:Ingarik%C3%B3 |
| 23 | Makunaimã | 32 | Resenha de P. C. Albernaz (UFRR), Revista Pesquisa FAPESP nº 327, maio 2023 · https://revistapesquisa.fapesp.br/wp-content/uploads/2023/05/096_resenha_327.pdf |
| 24 | Makunaimã | 33 | Jobim et al., Brasil/Brazil (UFRGS) · https://seer.ufrgs.br/index.php/brasilbrazil/article/download/149161/96406/670067 |
| 25 | Roraima | 34 | Folder "Fique por dentro do patrimônio cultural de Roraima", Iphan-RR · https://www.gov.br/iphan/pt-br/superintendencias/roraima/FOLDERPCRR_PTBRDIGITAL1.pdf |
| 26 | Roraima | 35 | Folder do Iphan-RR · https://www.gov.br/iphan/pt-br/superintendencias/roraima/FOLDERPCRR_PTBRDIGITAL1.pdf |
| 27 | Roraima | 37 | "Boa Vista – Histórico", Biblioteca IBGE · https://biblioteca.ibge.gov.br/visualizacao/dtb/roraima/boavista.pdf |
| 28 | Roraima | 38 | "Cavalo Lavradeiro…", Documentos 65, Embrapa Roraima, 2019 · https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1111745/1/DOCN65.pdf |
| 29 | Roraima | 39 | Brasil em Números v. 31, IBGE, 2023 · https://biblioteca.ibge.gov.br/visualizacao/periodicos/2/bn_2023_v31_art02.pdf |
| 30 | Roraima | 40 | Informativo 013/2023, Seplan-RR, com dados do Censo 2022 (IBGE) · https://seplan.rr.gov.br/wp-content/uploads/2023/11/Informativo-013-2023-POPULACAO-INDIGENA-2023.pdf.pdf |

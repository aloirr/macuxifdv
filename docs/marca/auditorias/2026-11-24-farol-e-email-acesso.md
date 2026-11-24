# Validação de marca: Farol de clientes (simulação) e e-mail de acesso com a senha (24/11/2026)

> design-de-marca · 24/11/2026, noite (Manaus) · sessão S7, rodada única. Base: `docs/marca/manual.md` (v1 e decisões até
> 22/11/2026) e a auditoria [`2026-11-24-revisao-geral.md`](2026-11-24-revisao-geral.md). Só validação: nenhum código alterado.
> Só o Alexandre aprova a marca; este parecer diz se a entrega respeita o manual.

## Entrega A · BKO → Clientes, aba Farol (simulação, designer-ux)

Branch `nuvem/v1034-usuarios-designer-ux-2`, SHA `c44082cfb3aa53efe099ee1b26da8e64931a534e`,
`docs/design/simulacoes/2026-11-24/` (`clientes-farol-atual-1366.png`, `clientes-farol-proposta-1366.png`,
`clientes-farol-proposta-b-1366.png`, `clientes-farol.md`). Pedido: R-20261124-091113, item 1.

**Parecer: VALIDADO** (proposta A, a recomendada; a B também cumpre o manual).

- **Cor:** só paleta (§3): grafite `#16202A`, `#4A5562`, linha `#DFE2E6`, erro `#A8261B`, aviso `#7A4F00`, neutro `#34404D` na
  Névoa `#ECEEF1` (9,09:1). Nenhuma cor nova nem "quase igual". O "0%" em `#A8261B` no branco (7,10:1) vem sempre com o texto
  "abaixo de 50%" (§3, "só para situação, sempre com texto").
- **Padrão executivo:** os 9 selos dos cartões e da legenda viram zero; o selo Verde das tabelas vira neutro; Vermelhos e Amarelos
  só ganham cor quando passam de 0. É a regra "selo colorido só onde a pessoa precisa agir" da auditoria de 24/11 (pergunta ao
  Alexandre ainda aberta: a simulação antecipa a resposta e por isso depende do "aprovo" dele).
- **Coluna Farol da tabela "Por vendedor" com o selo "Vermelho":** coerente. O vendedor vermelho (positivação abaixo de 50%) é o
  ponto em que o supervisor precisa agir, e o selo tem texto. Não é repetição de cor de erro como na MA-08: o cartão mostra a
  equipe e a linha mostra quem. Condição para a implementação: a mesma regra nas duas tabelas (Verde neutro, Amarelo em aviso,
  Vermelho em erro), também na tabela "Por vendedor", que na simulação só tem linhas vermelhas.
- **Tipografia:** fonte do sistema, título 24/700, números de cartão em 600, rótulos 13 px; nada abaixo de 12 px (§5).
- **Fora desta entrega (já catalogado):** o menu lateral em Sol claro (MA-01, MA-02 e a proposta MA-03) continua igual; não segura.
- **Fora do meu escopo (encaminhar):** o campo Mês mostra "November 2026" em inglês (corretor-redundancias / dono da tela).

## Entrega B · e-mail "Seu acesso ao Macuxi" / "Sua senha temporária" (engenheiro-software)

Branch `nuvem/v1034-usuarios-engenheiro-software-2`, SHA `bfdcbf57d891c5abcba54668de723c6eab511819`,
`packages/platform-sdk/src/email/modelos.ts`; print 390 px conferido. Decisão: R-20261124-181507-alexandre, opção B.

**Parecer: VALIDADO**, com 1 ajuste baixo que já estava aberto (MA-28) a levar no mesmo PR.

- **Borda `#7A8593` (Campo):** pode usar. A decisão de 22/11 diz que divisórias, PDFs e e-mails **não mudam**: as linhas que já
  existiam no e-mail (`#DFE2E6` do bloco, filete Azul noite) não migram para o `#7A8593`. O campo da senha é um componente novo,
  e o papel do Campo no §3 é exatamente "borda de componente no fundo claro (campo…)". Contraste 3,75:1 no branco (WCAG 1.4.11).
  Não é cor nova nem mudança de manual.
- **Modo escuro:** campo em Azul noite `#1E3350` dentro do bloco `#3A4D68` (trilho aprovado, §4), contorno `#C9CED5` ("contorno
  sobre o escuro", §3): 8,07:1 no Azul noite e 5,44:1 no `#3A4D68`; senha em branco, 12,77:1. Correto.
- **Senha em mono 24 px, 600:** a senha temporária é código pelo §5.1 (pilha com a reserva `Consolas, "Courier New", monospace`
  do e-mail); 24 está na escala (§5.3) e 600 é o peso do valor em destaque (§5.2). O 22 px antigo saiu: metade da MA-28 fechada.
- **Dica "Toque e segure para copiar":** 13 px, `#5B6673` no Pérola (5,41:1), mesmo estilo dos rótulos. Correto.
- **Ajuste (MA-28, baixa, pré-existente):** `modelos.ts:202`, validade `font-size:14px` → `font-size:13px` (escala web 13/15,
  §5.3). Não foi introduzido por esta entrega.
- **Nota:** o print está sem `urlLogo`, por isso o cabeçalho mostra o texto alternativo. Em produção, o e-mail tem de sair com o
  logo positivo de 30 px (§7); conferir na configuração da API antes do build.

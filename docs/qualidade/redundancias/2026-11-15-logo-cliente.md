# Corretor de redundâncias: simulação "logo do cliente" (designer-ux), reteste

> 2026-11-15 (Manaus, UTC−4) · corretor-redundancias · pedido do gerente-projetos.

## Reteste

**Resultado: sem achado em aberto.** RD-0450 e RD-0451 **corrigidos**; nenhum achado novo (a faixa reservada RD-0600 a
RD-0609 não foi usada).

**Escopo:** branch `origin/nuvem/logo-cliente-designer-ux`, head `d832bc4a` (correções em `fd7dee77` e `d832bc4a`, sobre
`c6d5a4b4`, lido no relatório anterior). Lido o delta inteiro `git diff origin/main...origin/nuvem/logo-cliente-designer-ux`
(18 arquivos): `docs/design/telas/logo-cliente.md`, `carga.html`, `mais.html`, `portal.html`, `pdf-*.html`,
`logo-cliente.css`, o SVG fictício, os 8 PNG (abertos um a um) e a linha do diário do designer-ux. Decisão do dono do
produto conferida: carga só na variação A (logo ao lado) e login sem logo (R-20261114-234500).

### Fechamento

| RD | Severidade | Evidência no `d832bc4a` | Status |
|---|---|---|---|
| RD-0450 | baixa (doc) | `docs/design/telas/logo-cliente.md:16-18`: uma nota só, "**Decisões** (… MC-0066 e MC-0067 …): carga com a logo ao lado (§3), login e telas de senha sem logo (§4), placa 52/36 e nome fantasia no Mais (§5). O portal e os PDFs ficam como nesta simulação." Saíram a l.5 antiga (o nome fantasia segue só no §5, l.136) e as duas notas "Revisão" e "Decisão do dono do produto" | **corrigido** |
| RD-0451 | média (texto da simulação) | `docs/design/telas/logo-cliente/carga.html:61`: `<span aria-label="Etapa 2 de 5 · ${T.etapas[1]}"></span><b>38%</b>`. Nos prints `carga-campo.png` e `carga-gestao.png` (refeitos no `fd7dee77`, sem e com logo), a linha da barra mostra só "38%", e a etapa atual aparece uma vez, na lista ("Clientes e rota" no Campo, "Equipe" no Gestão). O progresso fica em 2 formas (percentual e barra), como no app (RD-0239) | **corrigido** |

### Auditoria do delta (sem achado)

- **Carga (Campo e Gestão, sem e com logo):** a única diferença entre as duas telas é a logo, como diz o §3. Elas mostram
  "Olá, Lucas", "38%", a barra e as 5 etapas, sem frase de explicação junto da logo.
- **Mais:** "Licenciado para Exemplo Norte" e a placa. A logo fica sem rótulo acessível porque a frase já diz o nome (§1),
  então o leitor não lê o nome duas vezes. Sem logo, só a frase.
- **Portal (tela e 6 estados):** um título "Logo", a caixa, os botões e uma linha de baixo (os limites **ou** o erro, nunca
  os dois). O diálogo "Remover a logo?" não tem corpo. Não há "sua marca aqui" nem "Choose File".
- **PDFs (pedido e orçamento, com e sem logo):** só a caixa da logo muda; o resto é o `buildOrderPdfHtml` do `main`.
- **Spec:** as regras de cada superfície ficam num lugar só (§1 a §6); a decisão do dono do produto, só na nota do topo.

Sem defeito funcional para o testes.

---

# Implementação: T-0182 (provisório) · logo do cliente · parecer do corretor-redundancias

> **Reteste em 15/11, 10h34: ver §6.** RD-0700, RD-0702, RD-0703 e RD-0704 corrigidos; RD-0701 aberto; novos RD-0705 a RD-0707.

**Veredito: COM ACHADO (não liberado).** São 5 achados novos, de **RD-0700 a RD-0704**: 1 de gravidade média e 4 de
gravidade baixa. Todos estão em código de produção, então **todos seguram o lote**, pela R-20261110-062506. Os prints do
portal não mostram texto repetido, texto de funcionamento nem rótulo que não bata. As telas do app (carga e Mais) não
repetem nada além do que a marca decidiu (ver §1).

Corretor-redundancias, 15/11/2026, 10h19 em Manaus. Os números RD vêm depois do maior usado em todos os
`origin/nuvem/*`, o RD-0699 (que foi reservado e não usado em `nuvem/catalogo-v2-codigo-corretor-redundancias`). No `main`, o
maior é o RD-0323.

Base da leitura: o diff de cada branch contra o `origin/main` 19d2371a.

| Branch | Head | O que olhei |
|---|---|---|
| `nuvem/logo-cliente-banco-dados` | ed4db815 | migração 0081, esquema, testes, `docs/banco` |
| `nuvem/logo-cliente-engenheiro-software` | 1aefbe6a | SDK (`empresa-logo.ts`, `imagens.ts`, `ambiente.ts`), API (`empresa-logo.ts`, `licencas.ts`, `me-modulos.ts`, `arquivos.ts`), desenho |
| `nuvem/logo-cliente-designer-ux-ui` | 10d973e3 | `packages/ui/src/mobile/placa-logo*.ts(x)` |
| `nuvem/logo-cliente-modulo-vendedor` | e98fec5e | `pdf-pedido.ts` (CSS da `.logo`), detalhe do pedido, `exportar-pdf.ts` |
| `nuvem/logo-cliente-engenheiro-apps` | 32849304 | portal (`cartao-logo.tsx`, `portal-logo.ts`, `portal-api.ts`, `portal-rotas.ts`, `ambiente.ts`), app (`tela-entrada.tsx`, `tela-carga.tsx`, `mais.tsx`, `entrada.ts`, `logo-empresa.ts`, `state/plataforma.tsx`) |

As referências são a spec `docs/design/telas/logo-cliente.md` (`nuvem/logo-cliente-designer-ux`; meu parecer limpo
065ffe10), o desenho `docs/desenho/T-0182-logo-cliente.md` e a tarefa `.coord/tarefas/T-0182.md`
(`nuvem/logo-cliente-gerente-projetos`). Os prints do portal são 12 PNGs da sessão (sem logo, escolhido, salvando, salva,
foco no remover, recusado sem logo e com logo, diálogo, nome fantasia, admin do cliente). Não há prints do app: avaliei o
código das telas.

## 1. Os quatro pontos pedidos

1. **Linha "Etapa n de N · nome" de volta na carga** (`tela-entrada.tsx`, `Barra`): é a **MC-0088 da marca, aprovada pelo
   dono do produto** (T-0182, regra 6). Ela reverte o RD-0239 (corrigido em 13/11). **Fica registrada como decisão
   aprovada, não como achado.** O RD-0239 continua fechado no catálogo, com esta nota. O mesmo vale para o RD-0451 da simulação (reteste acima), que tirou a linha da prancha.
2. **Nome fantasia num cartão próprio, depois do cartão "Logo"** (`cartao-logo.tsx`, `CartaoNomeFantasia`): **não é
   achado.** O nome fantasia é outro dado, com o próprio "Salvar". Dentro do cartão "Logo", haveria dois "Salvar" ou um
   salvar só, misturado com os 6 estados da logo. Ele não aparece em outro lugar da página: o título mostra a razão social,
   que é outro dado. O placeholder do campo vazio repete a razão social do título, mas em cinza: é a única pista de que
   o campo vazio vale a razão social. Por isso fica (`manter`). Para o admin do cliente, o cartão mostra só o valor, sem
   botões (print `8-admin-do-cliente.png`). A spec §2 não descreve esse cartão. É lacuna de doc do designer-ux, não
   redundância.
3. **Códigos e mensagens entre o SDK, a API e `apps/web/lib/portal-logo.ts`:** a base está certa. `CODIGOS_LOGO` e
   `MENSAGENS_LOGO` ficam só no SDK, e a API (`empresa-logo.ts`) e o portal (`portal-logo.ts`) importam de lá. A
   conferência do arquivo (`conferirLogo`) é a mesma no portal, na API e no app. Ainda sobram três repetições:
   - a frase de rota ausente (**RD-0701**);
   - os números dos limites escritos à mão nas frases (**RD-0703**);
   - utilitários copiados dentro da API (**RD-0702**).
4. **Medidas da placa entre `packages/ui` e `apps/mobile/src/lib/entrada.ts`:** **não é achado.** `entrada.ts` não repete
   as medidas da placa: ele chama `caixaDaPlacaLogo('carga', …)` do kit. Ficam ali só as medidas da linha da carga: logo
   Macuxi de 124, folga de 24 e filete de 1 × 64. O 64 do filete coincide com a altura da placa, mas vem de outra regra (a
   altura do "M", spec §3). Juntar os dois amarraria duas regras que mudam por motivos diferentes.

### `imagens.ts` igual ao da T-0174 (pergunta do gerente)
O `packages/platform-sdk/src/imagens.ts` e o `imagens.test.ts` são **o mesmo blob** nos dois branches (d2a03d8f e 0f0db847). O
merge não duplica o arquivo. Dois arquivos, porém, **conflitam** com o `nuvem/T-0174-engenheiro-software` 75c7af3a, e a
resolução precisa evitar a duplicidade. Isto não é RD, é condição de merge (dono: engenheiro-software):
- `packages/platform-sdk/src/index.ts`: os dois branches acrescentam `export * from './imagens';` na mesma linha, e a T-0174
  acrescenta também o `./zip`. Na resolução, fica **uma** linha `./imagens`.
- `apps/api/src/arquivos.ts`: o `CHAVE_ARQUIVO_RE` e o `chaveDoArquivo` mudam nos dois. Fica a versão da T-0174, que
  aceita `.png`, `.webp` e `.pNNN.zip` e tem a mesma assinatura com `tipo`, sem uma segunda regex.

## 2. Achados

### RD-0700 · média · código · rotina · engenheiro-apps · **segura**
- **Onde:** `apps/web/lib/ambiente.ts:35-45` (`logoDaEmpresaWeb`).
- **O que se repete:** um segundo `GET /v1/me/modulos`, sem cache, com o próprio `MeusModulosRespostaSchema.parse`, a cada
  PDF. Só serve para achar o `empresa_logo`. O `lib/queries.ts:50-61` já diz "Uma consulta só a `GET /v1/me/modulos` (cache
  do React Query)" e lê a mesma resposta.
- **Impacto:**
  - é uma requisição a mais por PDF;
  - há dois lugares que leem e conferem a mesma resposta;
  - o 404 de servidor antigo é tratado num lugar e não no outro.
- **Proposta:** o `ModulosDoUsuario` (`queries.ts`) ganha `logo: empresaDosParametros(core.parametros)?.logo ?? null`, e o
  `logoDaEmpresaWeb` lê do cache, com `queryClient.fetchQuery` na mesma chave `qk.modulos`. Outra saída é o shell passar ao
  ambiente um getter do que a consulta já tem. A rota dos bytes (`rotaLogoDoAparelho`) continua igual.

### RD-0701 · baixa · texto · código · engenheiro-apps · **segura**
- **Onde:** `apps/web/lib/portal-logo.ts:28` (`TEXTOS_LOGO.rotaAusente: 'Ainda não disponível neste servidor.'`).
- **O que se repete:** a frase de rota ausente escrita de novo. A spec (§2) e o RD-0288 pedem **a constante única do
  portal**, `TEXTO_INDISPONIVEL` em `lib/portal-api.ts`. Ela já existe em `nuvem/config-enxuto-v2-engenheiro-apps`
  (`portal-api.ts:279`), do mesmo dono, e ainda não está no `main`.
- **Proposta:** `rotaAusente: TEXTO_INDISPONIVEL` (import de `./portal-api`). Se a T-0182 entrar antes do config-enxuto-v2,
  a constante entra neste lote, no `portal-api.ts`, com o mesmo nome e o mesmo texto, para o merge não criar duas.

### RD-0702 · baixa · código · engenheiro-software · **segura**
- **Onde:** `apps/api/src/empresa-logo.ts`, em três trechos:
  - `:105-106`, `indisponivel()`;
  - `:101`, regex do sha256;
  - `:155` e `:288`, prefixo da chave do tenant.
- **O que se repete:**
  - `indisponivel()` é cópia literal de `apps/api/src/arquivos.ts:160-161`: 503 `ARMAZENAMENTO_INDISPONIVEL`, "Armazenamento
    de arquivos indisponível. Tente de novo em instantes.";
  - `z.string().regex(/^[0-9a-f]{64}$/)` repete o `Sha256` de `packages/platform-sdk/src/empresa-logo.ts:74`, que não é
    exportado;
  - a conferência `` startsWith(`${tenant}/plataforma/`) `` aparece duas vezes no mesmo arquivo.
- **Proposta:**
  - exportar de `arquivos.ts` um `erroArmazenamentoIndisponivel()` e usar nos dois arquivos;
  - exportar `Sha256Schema` do SDK e usar em `ParamsLogoAparelho`;
  - criar um `chaveDoTenant(chave, tenantId)` local para as duas conferências.

### RD-0703 · baixa · texto · código · engenheiro-software · engenheiro-apps · **segura**
- **Onde:**
  - `packages/platform-sdk/src/empresa-logo.ts:36-38`: "1 MB", "200 px" e "4096 px" escritos nas `MENSAGENS_LOGO`;
  - `apps/web/lib/portal-logo.ts:17`: `limites: 'PNG ou JPG · até 1 MB · pelo menos 200 px de altura'`.
- **O que se repete:** os três limites de `LIMITES_LOGO` (`empresa-logo.ts:16`) aparecem escritos à mão em 4 frases, e a
  linha dos limites fica fora do SDK, longe das frases dos erros. Se um limite mudar, alguém precisa mudar 5 lugares. O
  CHECK do banco (0081) é revalidação de propósito, e fica.
- **Proposta:** no SDK, as frases interpolam `LIMITES_LOGO`, por exemplo
  `` `O arquivo passa de ${LIMITES_LOGO.bytes / 1_048_576} MB. Envie um menor.` ``. O SDK também exporta
  `TEXTO_LIMITES_LOGO = \`PNG ou JPG · até ${…} MB · pelo menos ${LIMITES_LOGO.alturaMinPx} px de altura\``. O portal usa
  `limites: TEXTO_LIMITES_LOGO`. O texto final na tela não muda.

### RD-0704 · baixa · código · engenheiro-software · designer-ux · engenheiro-apps · **segura**
- **Onde:** `packages/ui/src/mobile/placa-logo.ts:66-70` (`rotuloDaPlacaLogo`) e `apps/web/lib/portal-logo.ts:35-38`
  (`altDaLogo`).
- **O que se repete:** o texto de acessibilidade "Logo da <nome>" (spec §1) é montado em dois lugares, um para o TalkBack e
  outro para o `alt` do portal.
- **Proposta:** o SDK ganha `rotuloDaLogo(nome: string) => \`Logo da ${nome}\``, ao lado de `nomeDaEmpresa`, em
  `empresa-logo.ts`. O `rotuloDaPlacaLogo` passa a chamá-lo e continua devolvendo `null` sem nome, para a placa decorativa
  do Mais. O `altDaLogo` passa a ser `rotuloDaLogo(nomeDaEmpresa(…))`.

## 3. Conferido e sem achado
- **Portal (prints):**
  - um título por cartão;
  - a linha de baixo mostra os limites **ou** o erro, nunca os dois (`5a`, `5b`);
  - o diálogo "Remover a logo?" vem sem corpo;
  - não aparece "Choose File";
  - o admin do cliente não vê botões nem limites.

  `aria-label` igual ao título no `Panel` e no campo é rótulo de acessibilidade, e fica.
- **Carga (código):**
  - sem logo, a tela é a de hoje;
  - com logo, há um rótulo "Macuxi Força de Vendas" e um "Logo da <nome>";
  - "Olá", a barra e as etapas não mudam;
  - a linha "Etapa n de N · nome" é a MC-0088 (§1).
- **Mais (código):** "Licenciado para <nome>" uma vez. A placa fica decorativa, sem rótulo, para o leitor não ler o nome
  duas vezes (spec §1).
- **PDF:** muda só o CSS da `.logo`. O nome da distribuidora no cabeçalho continua a razão social (spec §6), e não é
  repetição do nome fantasia do Mais.
- **Banco (0081):** as 4 `sa_*` seguem o molde da 0073: sessão, perfil, tenant e auditoria. A repetição é o padrão do
  repositório para funções `SECURITY DEFINER`, e fica.
- **Testes:**
  - o "PNG falso" (assinatura + IHDR) aparece nos testes do SDK, da API, do portal e do app. Fica, porque compartilhar
    fixture entre pacotes pede uma exportação nova só para teste;
  - o `portal-logo.test.ts` confere as frases exatas, e o teste do SDK confere só que cada frase existe. Os dois não se
    sobrepõem.

## 4. Encaminhado ao testes (defeito funcional, sem RD)
- **BKO: o PDF do pedido nunca sai com a logo cadastrada.**
  - `modules/vendedor/web/components/orders/order-drawer.tsx:46` e `orders-page.tsx:68` chamam
    `exportarPdfDoPedido(..., { empresa, tz })` sem `logo_src`;
  - o comentário de `exportar-pdf.ts:9` diz "BKO ainda sem fonte da logo", mas o `apps/web/lib/ambiente.ts:64` já entrega
    `logoDaEmpresa`;
  - critério 4 da T-0182 (dono: modulo-vendedor).

## 5. Recados
Pelo protocolo, cada dono recebe um recado `pedido` com cc ao gerente-projetos, e o gerente recebe a `entrega`. **Não foram
enviados.** Nesta sessão os recados dão 403 no repositório `macuxifdv-recados`, conforme o gerente avisou na tarefa. A
coordenação fica no transcript da sessão, e o gerente repassa aos donos:

| Dono | Achados |
|---|---|
| engenheiro-apps | RD-0700, RD-0701, RD-0703 (parte do portal), RD-0704 (parte do portal) |
| engenheiro-software | RD-0702, RD-0703 (SDK), RD-0704 (SDK), condição de merge com a T-0174 (§1) |
| designer-ux | RD-0704 (`placa-logo.ts`); lacuna da spec §2 (cartão "Nome fantasia") |
| testes | §4 (PDF do BKO sem a logo), com cópia ao modulo-vendedor |

O reteste será feito nos próximos heads dos branches `nuvem/logo-cliente-*`. Cada achado é fechado com o arquivo:linha.

## 6. Reteste da implementação (15/11/2026, 10h34 em Manaus)

**Veredito: COM ACHADO (não liberado).**
- **Corrigidos:** 4 dos 5 achados, RD-0700, RD-0702, RD-0703 e RD-0704.
- **Aberto:** o RD-0701, que segura o lote.
- **Novos:** 3 achados, de **RD-0705 a RD-0707**:
  - o RD-0705 está em código de produção e **segura** o lote;
  - o RD-0706 e o RD-0707 estão só em testes e têm gravidade baixa. Entram no lote seguinte (R-20261111-190159).

Heads lidos (diff contra o `origin/main` 19d2371a):

| Branch | Head | Commits do reteste |
|---|---|---|
| `nuvem/logo-cliente-engenheiro-software` | 69ad7d4e | 69ad7d4e |
| `nuvem/logo-cliente-designer-ux-ui` | 4ff50dac | 4ff50dac |
| `nuvem/logo-cliente-engenheiro-apps` | 9cffd4dd | f37a62d2, 9cffd4dd |
| `nuvem/logo-cliente-modulo-vendedor` | d5506130 | d5506130 |
| `nuvem/logo-cliente-designer-ux` | c49b7221 | c49b7221 |
| `nuvem/logo-cliente-testes` | 11cd8d4b | 11cd8d4b |

### 6.1 Fechamento

| RD | Evidência | Status |
|---|---|---|
| RD-0700 | `apps/web/lib/queries.ts`: `consultaMeusModulos(perfil)` (`queryOptions`, chave `[...qk.modulos, perfil]`) guarda `logo: empresaDosParametros(core)?.logo ?? null`. `apps/web/components/app-shell.tsx` passa ao `criarAmbienteWeb` um leitor `qc.fetchQuery(consultaMeusModulos(perfil))`. `apps/web/lib/ambiente.ts:35` não chama mais `/me/modulos` nem importa o `MeusModulosRespostaSchema`. O teste `apps/web/lib/ambiente.test.ts` gera dois PDFs e mostra `chamadas.api` igual a `['/me/modulos']`, uma consulta só. O 404 de servidor antigo é tratado num lugar só, no `queryFn` | **corrigido** (f37a62d2) |
| RD-0701 | `apps/web/lib/portal-logo.ts:37` ainda tem `rotaAusente: 'Ainda não disponível neste servidor.'`. O `TEXTO_INDISPONIVEL` não está no `origin/main`: existe só em `nuvem/config-enxuto-v2-engenheiro-apps` (`apps/web/lib/portal-api.ts:279`) | **aberto**, segura (ver 6.2) |
| RD-0702 | `apps/api/src/arquivos.ts:161` exporta `erroArmazenamentoIndisponivel`, usado em `arquivos.ts` (2×) e em `empresa-logo.ts` (3×), sem cópia. `packages/platform-sdk/src/empresa-logo.ts:81` exporta `Sha256LogoSchema`, usado no contrato e em `ParamsLogoAparelho` (`empresa-logo.ts:102` da API). O `chaveDoTenant` (`empresa-logo.ts:107`) serve às duas conferências (`:155` e `:288`) | **corrigido** (69ad7d4e) |
| RD-0703 | `packages/platform-sdk/src/empresa-logo.ts:21-23` e `:42-44`: as frases e o `TEXTO_LIMITES_LOGO` são montados de `LIMITES_LOGO`. `apps/web/lib/portal-logo.ts:26` usa `limites: TEXTO_LIMITES_LOGO`. O texto da tela não mudou: o teste do SDK confere a frase exata, e o `portal-logo.test.ts:44` também | **corrigido** (69ad7d4e, f37a62d2) |
| RD-0704 | `packages/comum/src/marca.ts` tem o `rotuloDaLogo`, fonte única, que o SDK reexporta (`empresa-logo.ts`, `export { rotuloDaLogo }`). O `packages/ui/src/mobile/placa-logo.ts:72` (`rotuloDaPlacaLogo`) e o `apps/web/lib/portal-logo.ts:46` (`altDaLogo`) chamam a função, sem montar o texto. O `@macuxi/comum` já era dependência do SDK e do kit | **corrigido** (69ad7d4e, 4ff50dac, f37a62d2) |

### 6.2 Como fica o RD-0701

O RD-0701 continua **aberto** e **segura o lote** da T-0182, porque o texto está em código de produção. Há duas saídas, e
quem escolhe é o gerente-projetos, pela ordem dos merges:
1. **O config-enxuto-v2 entra antes (preferida):**
   - o engenheiro-apps traz o `main` novo para o `nuvem/logo-cliente-engenheiro-apps`, com merge e sem rebase;
   - troca a linha 37 por `rotaAusente: TEXTO_INDISPONIVEL`, com import de `./portal-api`;
   - eu fecho o achado no reteste seguinte.
2. **A T-0182 entra antes:**
   - o engenheiro-apps cria agora, no `apps/web/lib/portal-api.ts`, o
     `export const TEXTO_INDISPONIVEL = 'Ainda não disponível neste servidor.';`, com o mesmo nome e o mesmo texto do
     config-enxuto-v2;
   - o `portal-logo.ts` passa a usar a constante;
   - no merge do config-enxuto-v2, a resolução do conflito mantém **uma** declaração. Essa resolução vira condição de
     merge do config-enxuto-v2, e eu confiro no reteste dele.

Se nenhuma das duas saídas acontecer antes do lote, o lote não sai.

### 6.3 Achados novos

#### RD-0705 · baixa · código · modulo-vendedor · **segura**
- **Onde:**
  - `modules/vendedor/web/lib/logo-pdf.ts:4-9` (`logoParaPdf`, novo no d5506130);
  - `modules/vendedor/app/screens/order-detail-screen.tsx:440`;
  - `modules/vendedor/web/components/orders/exportar-pdf.ts:9`.
- **O que se repete:**
  - a regra "a logo vem de `ambiente.logoDaEmpresa`; ausente ou com erro, sai a logo padrão" está escrita **duas vezes no
    mesmo módulo**:
    - no BKO, na função `logoParaPdf`;
    - no app, inline: `Promise.resolve(ambiente.logoDaEmpresa?.()).then((l) => l ?? undefined, () => undefined)`;
  - o comentário do `exportar-pdf.ts:9` ainda diz "(BKO ainda sem fonte da logo)". O d5506130 deu essa fonte ao BKO, e
    agora o comentário contradiz o código.
- **O que não se repete com o shell:**
  - o `logoDaEmpresaWeb` (`apps/web/lib/ambiente.ts`) e o `dataUriDaLogoGuardada` (`apps/mobile/src/services/logo-empresa.ts`)
    já devolvem `null` quando falham;
  - o contrato `AmbienteAparelho.logoDaEmpresa` (`packages/platform-sdk/src/ambiente.ts:108-115`) não promete que a função
    nunca rejeita. Por isso o `try/catch` do módulo é defesa de fronteira e **fica** (`manter`). A repetição está só dentro
    do módulo.
- **Proposta:**
  - uma função só para o app e o BKO: a `logoParaPdf` sai de `web/lib/logo-pdf.ts` para um lugar que os dois importam,
    por exemplo `modules/vendedor/domain/logo-pdf.ts`, só com o tipo do SDK. O teste vai junto;
  - no app, `order-detail-screen.tsx:440` passa a ser `const logo_src = (await logoParaPdf(ambiente)) ?? undefined;`;
  - no `exportar-pdf.ts:9`, o comentário passa a ser `/** data URI da logo da empresa; vazio = logo padrão */`.

#### RD-0706 · baixa · teste · testes · **não segura** (só teste)
- **Onde:** `tests/integracao/api/logo-cliente-t0182.test.ts`, no `it.each` do LC-02 e em `FRASES`.
- **O que se repete:**
  - 5 dos 6 casos do LC-02 são iguais aos do unitário `apps/api/test/empresa-logo.test.ts:158-165`: webp 415, PNG
    declarado como JPEG 422, 1 MiB + 1 byte 413, 199 px e 4097 px;
  - o caso "limite exato de 1 MiB passa" (LC-03/04) repete o unitário `:175`, e o "81 caracteres = 400" (LC-04) repete o
    unitário `:233`;
  - o `conferirLogo` roda antes de qualquer chamada ao banco, e o unitário já prova que o banco não é chamado. Nesses
    casos, o Postgres real não acrescenta nada;
  - as 4 frases escritas em `FRASES` são a **3ª cópia** delas nos testes, junto com o teste do SDK (RD-0707).
- **O que fica:**
  - o que só a integração prova: a sessão real do portal (LC-01), o isolamento A × B com RLS (LC-03), o valor × regra lido
    do banco (LC-04), a idempotência e a auditoria (LC-05);
  - no LC-02, o caso SVG 415, que é novo, e um caso de recusa que prova "nada no armazenamento".
- **Proposta:**
  - o LC-02 fica com 2 linhas: SVG 415 e 199 px 422;
  - o "limite exato" e o "81 = 400" saem do LC-04;
  - a frase esperada passa a ser `MENSAGENS_LOGO[cod]`, porque o teste entra no mesmo lote do SDK. O texto exato da spec
    passa a ser conferido num lugar só, no teste do SDK (RD-0707).

#### RD-0707 · baixa · teste · engenheiro-software · engenheiro-apps · **não segura** (só teste)
- **Onde:**
  - `packages/platform-sdk/src/empresa-logo.test.ts` (testes "frases e linha dos limites…" e "rótulo da logo");
  - `apps/web/lib/portal-logo.test.ts:44`, `:55-56` e `:65-67`;
  - `packages/comum/src/marca.test.ts`.
- **O que se repete:**
  - o texto exato da spec §2 (as 3 frases de limite e a linha dos limites) é conferido em três testes: no do SDK (novo no
    69ad7d4e), no `portal-logo.test.ts` e no `FRASES` da integração (RD-0706). Trocar a frase do lado máximo (6.4) obriga
    a mexer em 2 ou 3 testes;
  - o `rotuloDaLogo` é testado no `@macuxi/comum` (`marca.test.ts`) e de novo no teste do SDK (`'Logo da Mercado Bom'`).
    O typecheck já garante o reexport.
- **Proposta:**
  - o texto literal fica **só** no teste do SDK, que é a fonte;
  - o `portal-logo.test.ts` confere o mapeamento com `MENSAGENS_LOGO[...]` e `TEXTO_LIMITES_LOGO`, sem o literal;
  - a linha do `rotuloDaLogo('Mercado Bom')` sai do teste do SDK, e a do `Sha256LogoSchema` fica.

### 6.4 Pendências (sem RD)
- **Frase do lado máximo:**
  - a spec (c49b7221, §2) diz "A imagem passa de 4096 px de largura ou altura. Envie uma menor.", e o SDK ainda diz "A
    imagem passa de 4096 px. Envie uma menor." (`empresa-logo.ts:44`);
  - é divergência entre spec e código: o dono é o engenheiro-software, e quem confere é o testes;
  - com a troca, mudam também o comentário do `empresa-logo.ts:39` ("proposta do desenho, a confirmar pelo designer-ux") e
    os testes do RD-0706 e do RD-0707;
  - no próximo reteste, confiro que o texto novo está **num lugar só** do código.
- **Ordem de merge:**
  - o `4ff50dac` (designer-ux-ui) e o `f37a62d2` (engenheiro-apps) importam o `@macuxi/comum/marca` e o
    `TEXTO_LIMITES_LOGO`, que só existem no 69ad7d4e (engenheiro-software);
  - os três entram no mesmo lote, e o do engenheiro-software entra primeiro;
  - continua valendo a condição de merge com a T-0174 (§1).

### 6.5 Conferido e sem achado
- **Spec §2 (c49b7221):**
  - "Quem grava e quem vê" aparece uma vez;
  - para o admin do cliente, não há aviso de "só leitura" (R-20261110-192153);
  - as frases de erro aparecem uma vez, na lista;
  - a lacuna de doc do §1, item 2, está **resolvida**.
- **Cartão "Nome fantasia" do admin do cliente (9cffd4dd):**
  - mostra só o nome fantasia, sem a razão social sob o rótulo;
  - sem nome fantasia, mostra a caixa vazia, sem texto;
  - o `aria-label` igual ao título é rótulo de acessibilidade, e fica.
- **PDF do BKO (d5506130):** o dono corrigiu o defeito do §4. A logo vem do ambiente do shell, e o shell não repete o que
  o módulo faz (6.3).
- **`apps/web/lib/ambiente.test.ts` (engenheiro-apps):** é o teste novo que prova "uma consulta só", e não repete outro
  teste.
- **`tests/integracao/banco/conformidade.test.ts`:** as 4 `sa_*` entram na lista `DEFINER_REVISADAS_PORTAL`. É a lista
  única do padrão.
- **`docs/testes/T-0182.md`:** a matriz cita os testes unitários pelo nome e não repete os casos.

### 6.6 Recados
Os recados continuam com erro 403, e o gerente-projetos repassa aos donos:

| Dono | O que fazer |
|---|---|
| engenheiro-apps | RD-0701 (6.2) e a parte do `portal-logo.test.ts` no RD-0707 |
| modulo-vendedor | RD-0705 |
| testes | RD-0706, e conferir a frase do lado máximo (6.4) |
| engenheiro-software | a parte do teste do SDK no RD-0707, e a frase do lado máximo (6.4) |

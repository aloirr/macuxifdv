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

# Filial de cadastro e venda, Sincronizar com a completa e Catálogo na opção A · simulação · parecer do corretor-redundancias

## Reteste — 6966b01d

**Resultado: COM ACHADO.** Dos 6 achados, 5 estão fechados (RD-0635, RD-0636, RD-0638, RD-0639 e RD-0640). O RD-0637 foi
**reaberto** porque falta corrigir o PNG 04. Há 3 achados novos, todos do designer-ux e todos seguram o lote:
- RD-0641 (média): "sua filial" aparece 2 vezes no print 06. Nasceu da troca do rótulo da faixa;
- RD-0642 (baixa): a spec do Catálogo diz 3 vezes na §4 que o preço e o estoque são os da filial escolhida;
- RD-0643 (baixa): a regra `.lateral .op` aparece 2 vezes no `filial.css`.

A troca do rótulo para `Sua filial:` fica, e o rótulo bate com os números em todas as telas (detalhe abaixo).

Corretor-redundancias, 15/11/2026, ~11h de Manaus.

### Escopo
Branch `origin/nuvem/catalogo-campo-designer-ux`, delta `git diff 4d6de8de 6966b01d` (17 arquivos, 1 commit: "simulação da filial
e do Sincronizar com os RD-0635 a RD-0640 e a MC-0089"). Li as 3 specs, o `.html` e o `.css` de cada simulação. Abri como imagem
os 9 PNGs mudados (Catálogo 01, 02, 04, 05 e 06; 14 e 15; sync 02) e mais 3 que não mudaram, para comparar: Catálogo 07 e 08 e
sync 04.

### Fechamento
| RD | Situação | Evidência |
|---|---|---|
| RD-0635 | corrigido | `sync-completa/spec.md:50-52`: o `Dialogo` do kit ganha a forma sem botões, a `Barra` sai da `TelaEntrada` para o kit, e o texto diz "Nenhum componente novo". O comentário de `sync.css:19` foi atualizado |
| RD-0636 | corrigido | `sync-completa/spec.md:42` e `:44` só remetem à `entrada-sync.md` §2 (itens 2 a 4) e §3 (item 1). Saíram as medidas, os hex, a lista de etapas e os 2 exemplos de erro |
| RD-0637 | **reaberto** (segura) | A spec §2 (`spec.md:24-25`, "sai enquanto sincroniza e com `Sem sinal`") e o `02-toque-normal.png` (`sync.html:39`, só `Atualizando pedidos e clientes`) estão corrigidos. **Falta o PNG `04-popup-completa.png`** (`sync.html:73`): durante a completa, atrás do popup, a dica `Segure 10 s para a sincronização completa` continua embaixo do botão. A correção: tirar a linha `<div class="sit dica">…` da tela 04 e refazer o PNG |
| RD-0638 | corrigido | `catalogo-campo-v2/spec.md:97-101` diz só como o Catálogo usa a regra e remete à `filial-cadastro-venda/spec.md` §1. A §1 (`:18`) remete ao Catálogo §4 |
| RD-0639 | corrigido | No cabeçalho de `filial-cadastro-venda/spec.md` ficou só a linha `:8` com a opção A |
| RD-0640 | corrigido | O `14-bko-usuarios-sem-filial.png` não tem mais a coluna `Filial` (`filial.html:42`), e a spec §3 (`:37`) diz por quê |

### A troca para "Sua filial: Boa Vista · …" (avaliação)
- **Rótulo × número.** Nas telas 01, 02, 04, 05 e 06, sem filial escolhida, o preço é o da filial de cadastro
  (`spec.md:105`, RN-VEN-01): R$ 86,40 e R$ 154,90 são de Boa Vista. O `Estoque: 17` é a soma, e o chip `Suas filiais (3)` diz
  isso (17 = 0 + 12 + 5, como na folha 07). Na 08, com `Filial Manaus ✕`, os preços mudaram de tabela (R$ 88,90, R$ 158,50 e
  R$ 37,40 contra R$ 86,40, R$ 154,90 e R$ 36,90 na 02). O `Estoque: 12` é o de Manaus na folha 07. O `1.284 produtos` é o mesmo
  em qualquer filial, porque a filial não esconde produto (`spec.md:112`); na 04, `1 produto` é o resultado da busca. Bate em
  todas as telas.
- **Coerência com o filtro.** `Sua filial` dá nome a um fato fixo, a filial de cadastro. O chip dá o recorte do preço e do
  estoque. Na 08, a faixa (Boa Vista) e o chip (Manaus) dizem coisas diferentes, e o "Sua" tira a leitura de que a faixa é a filial
  do preço. O ponto que mandei ao `testes` na rodada anterior (faixa × Manaus) fica resolvido, do lado do corretor. Quem fecha é o
  `testes`, e o recado de reteste está abaixo.
- **Repetição.** Na grade (01, 02, 04, 05 e 08), "Sua filial" aparece uma vez por tela. Na **06** aparece 2 vezes: na faixa,
  visível acima da folha, e na marca `sua filial` ao lado de Boa Vista na folha "Filtrar". Essa marca tinha ficado na rodada
  anterior porque a faixa só dizia `Filial Boa Vista`. Com o "Sua" na faixa, ela passou a repetir (RD-0641). Na folha 07, que abre
  da ficha e não tem faixa, a marca continua sendo o único lugar que diz qual filial é a de cadastro, e fica.
- **`manter?`: a faixa na 08.** Com Manaus escolhida, o vendedor age sobre o preço de Manaus, e `Sua filial: Boa Vista` não
  muda essa decisão. A faixa fica porque é o contexto fixo da tela, no mesmo lugar em todas as telas, e é curta. Se o dono do
  produto quiser enxugar, a alternativa é a faixa mostrar só `1.284 produtos` quando houver uma filial escolhida.

### Achados novos
| RD | Onde | Fere | Correção | Dono | Gravidade |
|---|---|---|---|---|---|
| RD-0641 | `catalogo-campo-v2/06-folha-filtro.png`, `catalogo-campo-v2.html:147`, spec §4 (`:107`) e §2.1 (`:68`) | uma informação, um lugar: `Sua filial: Boa Vista` na faixa e `Boa Vista  sua filial` na folha "Filtrar", no mesmo print | sai a marca da folha "Filtrar": `html:147` passa a `<span>Boa Vista</span>` e o PNG 06 é refeito. Spec `:107`: "**Filial**: `Suas filiais (3)` (padrão) e as filiais de venda, a de cadastro primeiro;". Spec `:68`: "…com a marca `sua filial` (13 `ink2`), e as outras em ordem alfabética." (sai o "como no `Filtrar`"). A marca da folha 07 fica | designer-ux | média |
| RD-0642 | `catalogo-campo-v2/spec.md` §4, `:100` × `:105` × `:112` | a mesma regra 3 vezes na mesma seção: "o chip diz a filial do preço e do estoque", "Preço: o da tabela da filial escolhida" e "A filial muda o estoque (e o preço) mostrado". A 1ª entrou neste delta | `:99-100` passa a "…Não é filtro e não tem ✕; com outra filial escolhida no filtro, a faixa continua nela (`08`);". As linhas `:105` e `:112` ficam | designer-ux | baixa |
| RD-0643 | `filial-cadastro-venda/filial.css:25` e `:28` | a mesma regra CSS 2 vezes: `.lateral .op { padding: 9px 12px; border-radius: 10px; }` e, 3 linhas abaixo, `.lateral .op { padding-left: 20px; }` | uma regra só na `:25`, `.lateral .op { padding: 9px 12px 9px 20px; border-radius: 10px; }`, e sai a `:28` | designer-ux | baixa |

Os 3 seguram o lote porque estão na simulação e na spec, não em comentário ou título de teste.

### Sem achado (conferido no delta)
- **Marca no menu do BKO (14 e 15, MC-0056 e MC-0089).** O logo com o nome tomou o lugar do símbolo com o texto `Macuxi FDV`, e
  não sobrou o nome 2 vezes. A cor e o layout são do `design-de-marca`. **Observação fora do delta, sem RD:**
  `docs/design/telas/T-0168-bko.html:14-18` e `:74` ainda têm o menu antigo (símbolo e `Macuxi FDV`). Quando a MC-0089 for para
  o shell, as simulações do BKO devem usar o mesmo menu.
- **Legenda 14.** "a coluna Filial sai; o aviso do topo leva a este filtro" está certa: o aviso não aparece com esse filtro (spec §3).
- **Tabela de PNGs das specs** (Catálogo `:20`, filial `:13`, sync `:12`). Descrevem o print sem repetir regra.
- **`sync.css:18` (`.sit.ult`).** É a margem da última linha, agora que a dica saiu da tela 02. Não é regra duplicada.

### Recados pendentes deste reteste
O repositório de recados dá 403 nesta sessão, e nada foi enviado. Os comandos estão na seção "Recados pendentes", no fim do
relatório.

---

## Parecer — 4d6de8de

**Resultado: COM ACHADO.** São 6 achados, do RD-0635 ao RD-0640: 5 de gravidade média e 1 de gravidade baixa. Todos são do
designer-ux (specs da simulação) e todos seguram o lote: nenhum está só em comentário ou título de teste.
- RD-0635 (média): o `DialogoProgresso` novo repete o `Dialogo` do kit e a barra da carga;
- RD-0636 (média): a spec do Sincronizar copia as medidas, as cores, as etapas e os erros da `entrada-sync.md`;
- RD-0637 (média): a dica "Segure 10 s…" continua com o botão sem toque (`02-toque-normal.png`);
- RD-0638 (média): a regra da filial de cadastro e das filiais de venda está em 2 specs;
- RD-0639 (baixa): o cabeçalho da spec da filial diz 2 vezes que o Catálogo fechou na opção A;
- RD-0640 (média): com o filtro `Sem filial`, todas as linhas do BKO mostram o selo `Sem filial` (`14-bko-usuarios-sem-filial.png`).

Um ponto foi para o `testes`, sem RD: na `08-grade-multi-filial.png`, a faixa diz `Filial Boa Vista` e o preço e o estoque são
de Manaus.

Corretor-redundancias, 15/11/2026, ~09h30 de Manaus.

## Escopo
Branch `origin/nuvem/catalogo-campo-designer-ux`, delta `git diff d6f194ac..4d6de8de` (designer-ux):
- **9e0da421** (R-20261115-093000): regra definitiva de filial de cadastro e de venda;
- **4d6de8de** (R-20261115-100000): Catálogo na opção A (soma das filiais de venda) e Sincronizar com a completa ao segurar.

Conferi:
- `docs/design/filial-cadastro-venda/`: spec, `filial.html` e `filial.css`, PNGs 13, 14 e 15;
- `docs/design/sync-completa/`: spec, `sync.html` e `sync.css`, PNGs 01 a 04;
- `docs/design/catalogo-campo-v2/`: spec, `.html` e os PNGs 01 a 08 refeitos.

Abri os 15 PNGs como imagem. Para não repetir achados, li o último reteste limpo do Catálogo v2
(`origin/nuvem/catalogo-campo-corretor-redundancias`, e8fac5f1, contra d6f194ac).

**Fora do delta:**
- `packages/ui` não mudou. O `DialogoProgresso` só existe como proposta na spec (§5), e o RD-0635 olha essa proposta contra o kit.
- Os ícones (`packages/ui/src/mobile/icon.tsx`, `icon.test.ts`, `web/icons.tsx`, `docs/design/telas/icones.js`) não mudaram
  entre d6f194ac e 4d6de8de. Por isso não há achado de ícone duplicado, de export morto ou de teste repetido neste parecer.

## Achados
| RD | Onde | Fere | Correção | Dono | Gravidade |
|---|---|---|---|---|---|
| RD-0635 | `sync-completa/spec.md` §5 ("Componente novo do kit: … `DialogoProgresso`, com a linha e a barra da `entrada-sync`") e `sync.css` (`.dlg`) | componente duplicado: a casca já é o `Dialogo` do kit (`packages/ui/src/mobile/folha.tsx:278`: `Modal`, `scrim`, raio, `accessibilityViewIsModal`). A linha da etapa com a barra já existe na `Barra` privada da `TelaEntrada` (`apps/mobile/src/components/tela-entrada.tsx:150-205`). Há também o `ProgressBar` do kit (`ui.tsx:279`). Um componente novo seria a 3ª barra e o 2º diálogo | texto pronto abaixo (§RD-0635) | designer-ux | média |
| RD-0636 | `sync-completa/spec.md` §4, "Barra igual à da tela de carga" e "Parou" | a mesma regra em 2 docs: copia da `entrada-sync.md` §2 e §3 o tamanho (13, 6 dp, raio 3), as cores em hex (`#1E3350`, `#DFE2E6`, `#C2540A`), a lista de etapas do Campo e as 2 linhas de erro. Se a carga mudar, são 2 lugares para acertar | texto pronto abaixo (§RD-0636) | designer-ux | média |
| RD-0637 | `02-toque-normal.png` e spec §1 e §2 | só o que o usuário usa para agir: com o botão mostrando o indicador e sem toque, a dica `Segure 10 s para a sincronização completa` continua embaixo de `Atualizando pedidos e clientes`. Ela pede uma ação que não dá para fazer agora. O mesmo vale para `Sem sinal` (§3: "segurar não faz nada") | texto pronto abaixo (§RD-0637) | designer-ux | média |
| RD-0638 | `catalogo-campo-v2/spec.md` §4, item "Regra de filial", × `filial-cadastro-venda/spec.md` §1 | uma informação, um lugar: "filial de cadastro, uma e obrigatória" e "filiais de venda, uma ou várias" estão nas 2 specs, e "O Catálogo usa só elas" também (filial §1 × Catálogo §4) | texto pronto abaixo (§RD-0638) | designer-ux | média |
| RD-0639 | `filial-cadastro-venda/spec.md`, cabeçalho | a mesma frase 2 vezes no mesmo bloco: "A regra do Catálogo foi fechada na opção A (R-20261115-100000-alexandre)." e "Catálogo (…; opção A, R-20261115-100000): …" | apagar a linha "> A regra do Catálogo foi fechada na opção A (R-20261115-100000-alexandre)." A outra linha fica | designer-ux | baixa |
| RD-0640 | `14-bko-usuarios-sem-filial.png`, spec da filial §3 | tag igual em todas as linhas repete o filtro (a regra de 12/11 do checklist, como no RD-0500): o filtro `Filial de cadastro: Sem filial` está aplicado, e a coluna `Filial` mostra `Sem filial` nas 2 linhas | texto pronto abaixo (§RD-0640) | designer-ux | média |

### RD-0635: popup sem componente novo
Spec §5, 2º item. Depois:
"- Popup da completa: o `Dialogo` do kit (`folha.tsx`) ganha a forma sem botões. Sem `cancelar` e `confirmar`, o conteúdo vai por
`children`, e o Voltar não faz nada. A linha da etapa com a barra sai da `TelaEntrada` (`Barra`, `tela-entrada.tsx`) e vai para o kit,
e a carga e o popup usam a mesma. Nenhum componente novo."

No `sync.css`, o comentário do `.dlg` passa a ser "popup da completa: `Dialogo` sem botões e a barra da carga (tema pérola)".

### RD-0636: a barra só na `entrada-sync`
Spec §4. Depois:
"- **Barra e etapas iguais às da tela de carga** (`../entrada-sync.md` §2, itens 2 a 4, tema pérola), sem a lista de etapas.
- **Pronto:** `Pronto` e `100%`; o popup fecha sozinho depois de 600 ms, e a situação mostra `Atualizado há instantes`.
- **Parou:** a linha de erro da carga (`../entrada-sync.md` §3, item 1) e os botões `Tentar de novo` (principal) e `Fechar` (neutro).
  Só aí o Voltar fecha."

Saem a linha "13, `#1E3350`; barra de 6 dp, raio 3, trilho `#DFE2E6`, preenchimento `#C2540A`", a lista "As etapas são as da carga
(Campo: …)" e os exemplos `Parou na etapa 3 de 5` e `Sem internet na etapa 3 de 5`. O exemplo `Etapa 3 de 5 · Catálogo e preços`
fica só no PNG 04.

### RD-0637: a dica só quando dá para segurar
Spec §2, 1º item. Depois:
"- Abaixo da situação, uma segunda linha, `small` `ink2`, centralizada: `Segure 10 s para a sincronização completa`. Ela só
aparece com o botão livre: sai enquanto sincroniza e com `Sem sinal`."

No PNG `02-toque-normal.png`, ficam o botão com o indicador e `Atualizando pedidos e clientes`, e a 2ª linha sai.

### RD-0638: a regra da filial num lugar só
A fonte é a `filial-cadastro-venda/spec.md` §1, que trata do cadastro para todo o produto. O Catálogo diz só como usa a regra.
- **Catálogo §4, item "Regra de filial".** Depois:
  "- **Filial** (regra: `../filial-cadastro-venda/spec.md` §1, R-20261115-093000; substitui a regra por perfil de R-20261115-073000,
  R-20261115-090000 e R-20261115-092000):
    - a filial de cadastro aparece **sempre na faixa**, no subtítulo `Filial Boa Vista · 1.284 produtos`. Não é filtro e não tem ✕;
    - o preço, o `Estoque: N` (§3), o filtro e a folha (§2.1) usam só as filiais de venda."
- **Filial §1, 2º item.** Depois: "- **Filiais de venda:** uma ou várias, escolhidas no BKO, para qualquer perfil (uso no Catálogo:
  `../catalogo-campo-v2/spec.md` §4)."

### RD-0640: o selo não repete o filtro
Spec da filial §3, 1º item. Depois:
"- **Coluna `Filial`**, depois de `Perfil`: o nome da filial de cadastro; sem ela, o selo `Sem filial` (`Badge tone="danger"`).
  Com o filtro `Sem filial`, a coluna sai, porque todas as linhas diriam o mesmo. As filiais de venda não entram na lista: ficam na gaveta."

Refazer o `14-bko-usuarios-sem-filial.png` sem a coluna `Filial`.

## Sem achado (conferido)
- **Catálogo 01 a 08 na opção A.** A folha "Estoque por filial" (07) ficou sem a linha de total. O `Estoque: 17` do cartão e da ficha
  é a soma, e a spec §2.1 remete à §3. As telas mostram o número uma vez por cartão. Os achados RD-0496 a RD-0577 continuam
  corrigidos (RD-0574 encerrado), e não houve regressão: a dica da busca diz "Também acha por aplicação e referência cruzada.",
  e o chip `Suas filiais (3)` continua sem ✕.
- **Valor de N (§3).** São 3 casos (com cliente, filial escolhida e soma das filiais de venda), sem repetir a §4.
- **Faixa `Filial Boa Vista` com o chip `Suas filiais (3)`** (02, 04, 05, 06): são fatos diferentes (a de cadastro, que dá o
  preço sem escolha, e o recorte do estoque). Não é repetição. Na 08, a faixa contradiz o preço e o estoque e vai para o `testes` (abaixo).
- **`sua filial` na folha "Filtrar" e na folha "Estoque por filial"** (06, 07): diz qual das 3 é a de cadastro. Fica.
- **Login sem filial (13).** Um aviso só, com o problema e a ação, no lugar do erro do login. Os campos continuam preenchidos.
- **Gaveta (15).** A marca `filial de cadastro` ao lado de Boa Vista, já escolhida no campo de cima, fica como `manter?`: ela explica
  por que a caixa está travada (rótulo de acessibilidade incluído). O aviso `2 usuários sem filial de cadastro não entram no app.`
  com `Ver os 2` diz o fato e a ação, e só aparece quando o filtro não é `Sem filial`. RN-VEN-42 ("Alertas") é do Início do Campo e
  não vale para o BKO.
- **Sincronizar 01 e 03.** No repouso, a dica de segurar é o único jeito de saber da completa (o TalkBack tem a ação própria). Ao
  segurar, o anel e a contagem `6 s` são 2 representações do mesmo tempo, dentro do limite. A dica vira `Solte antes…`, que é ação.
- **Popup 04.** O título e `Aguarde e não saia desta tela.` são texto do dono do produto (R-20261115-100000). A barra com o `43%` são
  2 representações, e `Etapa 3 de 5` é outra medida.
- **Simulações (`sync.css`, `filial.css`).** Usam os tokens de `simulacao.css` sem duplicar o arquivo. As regras novas são das
  telas novas.

## Encaminhado ao testes (sem RD)
- `catalogo-campo-v2/08-grade-multi-filial.png`, com a spec §4 ("Preço: o da tabela da filial escolhida"): com `Filial Manaus ✕`,
  a faixa continua `Filial Boa Vista · 1.284 produtos`, e o preço e o `Estoque: 12` são de Manaus. É rótulo que contradiz o valor.
  Também: o `R$ 86,40` de Manaus é igual ao de Boa Vista nas telas 02 e 03, e não dá para ver no print que o preço mudou de tabela.

## Recados pendentes
O repositório de recados deu 403 nesta sessão (`coord.mjs ler` → HTTP 403). Nada foi enviado. Comandos para o gerente rodar:

```
node scripts/coord.mjs enviar --de corretor-redundancias --para designer-ux --cc gerente-projetos --tipo pedido --assunto "Simulação filial e Sincronizar (4d6de8de): RD-0635 a RD-0640" --corpo "Parecer COM ACHADO, todos seguram o lote: RD-0635 (média) DialogoProgresso duplica o Dialogo do kit e a Barra da TelaEntrada; RD-0636 (média) sync-completa §4 copia a entrada-sync §2/§3; RD-0637 (média) dica 'Segure 10 s' com o botão sem toque (02); RD-0638 (média) regra de filial em 2 specs; RD-0639 (baixa) opção A 2x no cabeçalho da spec da filial; RD-0640 (média) selo 'Sem filial' em todas as linhas com o filtro 'Sem filial' (14). Textos prontos em docs/qualidade/redundancias/2026-11-15-catalogo-filial-sync.md."

node scripts/coord.mjs enviar --de corretor-redundancias --para testes --cc gerente-projetos --tipo pedido --assunto "Catálogo v2 08: faixa 'Filial Boa Vista' com preço e estoque de Manaus" --corpo "Na catalogo-campo-v2/08-grade-multi-filial.png (4d6de8de), com o chip 'Filial Manaus ✕', a faixa diz 'Filial Boa Vista · 1.284 produtos', e o preço (spec §4) e o Estoque: 12 são de Manaus. Rótulo × valor, fora do escopo do corretor. Detalhe no relatório 2026-11-15-catalogo-filial-sync.md."

node scripts/coord.mjs enviar --de corretor-redundancias --para gerente-projetos --tipo entrega --assunto "Parecer filial e Sincronizar (d6f194ac..4d6de8de): COM ACHADO" --corpo "6 achados do designer-ux, RD-0635 a RD-0640 (5 médias, 1 baixa), todos seguram. 1 ponto ao testes (08, faixa × Manaus). Ícones e packages/ui fora do delta. Relatório docs/qualidade/redundancias/2026-11-15-catalogo-filial-sync.md, branch nuvem/catalogo-filial-sync-corretor-redundancias."
```

### Reteste 6966b01d (15/11, ~11h de Manaus)
```
node scripts/coord.mjs enviar --de corretor-redundancias --para designer-ux --cc gerente-projetos --tipo pedido --assunto "Reteste da simulação filial e Sincronizar (6966b01d): RD-0637 reaberto, RD-0641 a RD-0643" --corpo "RD-0635, 0636, 0638, 0639 e 0640 fechados. Seguram: RD-0637 reaberto (média), porque o sync 04-popup-completa.png (sync.html:73) ainda mostra 'Segure 10 s…' atrás do popup e a linha precisa sair; RD-0641 (média): 'sua filial' 2x na 06 (faixa + folha Filtrar), e sai a marca da folha Filtrar (html:147, spec :107 e :68), mas a da folha 07 fica; RD-0642 (baixa): a spec do Catálogo §4 :100 repete :105 e :112, então :100 termina em 'a faixa continua nela (08);'; RD-0643 (baixa): filial.css :25 e :28 com .lateral .op 2x, então fica uma regra só, com padding 9px 12px 9px 20px. A troca para 'Sua filial:' fica. Textos prontos em docs/qualidade/redundancias/2026-11-15-catalogo-filial-sync.md, seção Reteste."

node scripts/coord.mjs enviar --de corretor-redundancias --para testes --cc gerente-projetos --tipo aviso --assunto "Catálogo v2 08 (6966b01d): faixa 'Sua filial: Boa Vista' e preços de Manaus, para reteste" --corpo "O ponto que mandei em 4d6de8de (faixa × Manaus) mudou: a faixa agora é 'Sua filial: Boa Vista' (cadastro) e o chip 'Filial Manaus' dá o preço e o estoque. Na 08, os preços são R$ 88,90, R$ 158,50 e R$ 37,40, diferentes dos da 02, e o Estoque: 12 bate com Manaus na 07. Do lado do corretor, não há mais contradição. Vocês confirmam valor × regra e fecham."

node scripts/coord.mjs enviar --de corretor-redundancias --para gerente-projetos --tipo entrega --assunto "Reteste filial e Sincronizar (6966b01d): COM ACHADO" --corpo "5 fechados (RD-0635, 0636, 0638, 0639, 0640). Seguram, todos do designer-ux: RD-0637 reaberto (média, sync 04), RD-0641 (média, 'sua filial' 2x na 06, vindo da troca do rótulo), RD-0642 (baixa, spec §4) e RD-0643 (baixa, filial.css). A troca para 'Sua filial:' fica: rótulo e números batem em todas as telas. O ponto da 08 vai ao testes para reteste. Relatório docs/qualidade/redundancias/2026-11-15-catalogo-filial-sync.md, branch nuvem/catalogo-filial-sync-corretor-redundancias."
```

Nesta rodada usei os RD-0641 a RD-0643; os RD-0644 a RD-0649 continuam livres.

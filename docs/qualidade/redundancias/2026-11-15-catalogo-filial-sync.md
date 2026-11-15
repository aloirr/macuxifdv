# Filial de cadastro e venda, Sincronizar com a completa e Catálogo na opção A · simulação · parecer do corretor-redundancias

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

Os RD-0641 a RD-0649 não foram usados.

# Parecer de redundâncias — simulação "Planos e assinatura" do portal `config.` (2026-11-15)

**Escopo:** branch `nuvem/planos-assinatura-designer-ux`, commit `4294af5`, `docs/design/planos-assinatura/` (`spec.md` e PNG 01 a 06, 1366 × 768), comparado com `docs/design/telas/portal-config-enxuto.md` §11 (aprovado em 14/11).
**Recados:** `node scripts/coord.mjs caixa corretor-redundancias` respondeu HTTP 403 nesta sessão; caixa não lida e recados aos donos não enviados. O gerente-projetos repassa os achados abaixo.
**Resultado:** 4 achados (2 médios, 2 baixos). Nenhum defeito funcional para o `testes`.

## Achados

| ID | Onde | Tipo | O que se repete | Impacto | Severidade | Proposta (antes → depois) | Dono |
|---|---|---|---|---|---|---|---|
| RD-0323 | `06-trocar-abaixo-do-uso.png` (erro embaixo dos planos); texto vem de `packages/platform-sdk/src/planos.ts:291` e do §11.4 | texto | "O plano Light tem" 2× em duas linhas seguidas; "10 vendedores" e "1 gestor" já estão no cartão Light selecionado logo acima ("10 licenças de vendedor", "1 licença de gestor") | leitura; texto além do problema; a ação (quantos inativar) não aparece | média | "O plano Light tem 10 licenças de vendedor e a empresa usa 14." / "O plano Light tem 1 licença de gestor e a empresa usa 2." → **"Vendedores: 14 em uso. Inative 4 antes de trocar."** / **"Gestores: 2 em uso. Inative 1 antes de trocar."** (problema + ação; o limite fica só no cartão). Mensagem no contrato (engenheiro-software) e §11.4 (designer-ux) | engenheiro-software · designer-ux |
| RD-0324 | `portal-config-enxuto.md` §11.4 (cita `depois-06c`, `depois-06d`), §11.5 ("Sem simulação nova"), §13 "Simulações vigentes" × `planos-assinatura/spec.md` §2 | doc | duas séries de simulação para as mesmas 4 telas (aba Empresa, cliente, diálogo, Empresas), sem dizer qual vale; §11.5 diz que não há simulação e a spec traz a 01 | decisão (engenheiro-apps não sabe qual PNG seguir); manutenção | média | Depois da aprovação: §11.4, §11.5 e §13 apontam para `planos-assinatura/01..06` e marcam `depois-03b`, `depois-06b`, `depois-06c` e `depois-06d` como substituídos (uma linha no §14). Até lá, a spec diz numa linha: "Ao aprovar, estas substituem `depois-03b/06b/06c/06d`." | designer-ux |
| RD-0325 | `spec.md` §2, item "Tela 6 (nova)" | doc | "O erro fica embaixo dos planos, uma linha por item, e o principal desabilitado" repete a regra do §11.4 (que a própria spec diz não repetir) | manutenção (dois textos da mesma regra) | baixa | → "**Tela 6 (nova):** Light escolhido para a empresa da ficha (14 vendedores e 2 gestores em uso). O principal desabilitado usa o `.btn.off` do portal (MC-0041)." | designer-ux |
| RD-0326 | `spec.md` §1 ("Conclusão") × §1 tabela × §2 coluna "Depende de" × §3 | doc | a dependência do banco (3 funções, histórico, seed) dita 4 vezes; "RN-PLA-01..06 no doc 03" e "trava RN-PLA-04" ditas na tabela e de novo no §3 | leitura | baixa | Sai o parágrafo "Conclusão" (a coluna "Depende de" do §2 já diz que só a tela 1 sai com o `main` de hoje); saem as linhas "Regras (doc 03)" e "Trava no BKO" da tabela do §1 (ficam só no §3, itens 4 e 5) | designer-ux |

## Conferido sem achado
- Telas 1 a 5: título, valor, selo de teste, blocos "x de y" com selo "no limite" único (RD-a), "Atual" sem rádio extra, rodapé só com Total + 2 botões, selo "2 meses grátis" só no alternador. Nenhum texto sobre cobrança, funcionamento ou garantia.
- "Promotor Avulso" + "por licença/mês": "avulso" dito uma vez (mapa único §11.10).
- `spec.md` não copia textos de tela, tabela de preços nem testIDs do §11; §5 (premissas) e §4 (perguntas) não repetem o §11.7.

## Reteste 1 (15/11, commit `34908b1`, branch `nuvem/planos-assinatura-designer-ux`)

| ID | Resultado | Evidência |
|---|---|---|
| RD-0323 | **corrigido na simulação; aguarda aval do dono do produto para o SDK e o §11.4** | `06-trocar-abaixo-do-uso.png` e `.html` (`data-testid="empresa-plano.erro"`): "Vendedores: 14 em uso. Inative 4 antes de trocar." / "Gestores: 2 em uso. Inative 1 antes de trocar.". "O plano Light tem" saiu; o limite fica só no cartão Light. A troca do texto aprovado em 14/11 virou a pergunta 4 do `spec.md` §4. Segue o texto antigo em `packages/platform-sdk/src/planos.ts:291` e no §11.4 do `portal-config-enxuto.md`; só mudam se o dono do produto aprovar (aí, reteste do SDK e do §11.4). |
| RD-0324 | **corrigido** | `spec.md` §2: "Ao aprovar, estas substituem `depois-03b`, `depois-06b`, `depois-06c` e `depois-06d` do `portal-config-enxuto.md`, e as §11.4, §11.5 e §13 passam a apontar para cá." A troca no §11.4/§11.5/§13 é passo pós-aprovação. |
| RD-0325 | **corrigido** | `spec.md` §2, "Tela 6 (nova)": só o cenário e o `.btn.off` (MC-0041); a regra do erro não se repete. |
| RD-0326 | **corrigido** | `spec.md` §1: sem "Conclusão" e sem as linhas "Regras (doc 03)" e "Trava no BKO"; RN-PLA-01..06 e RN-PLA-04 ficam só no §3, itens 4 e 5. |

Sem achado novo no `spec.md` nem no PNG 06 (erro em 2 linhas, sem repetir o limite; rodapé só Total + 2 botões). Nenhum defeito funcional para o `testes`.
**Resultado:** nenhum achado em aberto na simulação. O RD-0323 volta a reteste no SDK e no §11.4 se o dono do produto aprovar a pergunta 4.

## Reteste 2 (15/11, commit `0320e0e`, branch `nuvem/planos-assinatura-designer-ux`; SDK no `ba89662`)

| ID | Resultado | Evidência |
|---|---|---|
| RD-0323 | **corrigido** | A pergunta 4 da `spec.md` foi respondida ("Sim: o texto novo vale, uma linha por item"). O §11.4 do `portal-config-enxuto.md` diz: "Texto (aprovado em 15/11, R-20261115-123000; já no contrato): **Vendedores: 14 em uso. Inative 4 antes de trocar.**", e o pedido ao engenheiro-software saiu. O SDK diz o mesmo (`planos.ts:295`, no `565d1b0`/`ba89662`). O `recados-pendentes.md` marca o item (1) como resolvido. |
| RD-0324 | **corrigido** | O §11.4 aponta para `../planos-assinatura/03` a `06`, o §11.5 para a `01` e o §13 traz uma nota e a lista "Simulações vigentes" com `01` a `06`. `depois-03b`, `-06b`, `-06c` e `-06d` estão marcadas como substituídas (notas no §8 e no §11.3). |

### Achado novo

| ID | Onde | Tipo | O que se repete | Impacto | Severidade | Proposta (antes → depois) | Dono |
|---|---|---|---|---|---|---|---|
| RD-0956 | `docs/design/telas/portal-config-enxuto.md` §4 (l. 56) e §11.4 (l. 236) | doc | (1) O §4 ainda diz "Simulação nova: `depois-03b-nova-empresa.png`", que o §11.3 marca como substituída. Para a mesma tela, há dois PNG sem dizer qual vale (é a sobra do RD-0324 fora do §11.4/§11.5/§13). (2) O §11.4 diz "substituem `depois-06b`, `depois-06c` e `depois-06d`", o que repete a nota do §8 (l. 106). | decisão (o engenheiro-apps pode abrir o PNG antigo pelo §4); manutenção | baixa | (1) l. 56: "Simulação nova: `depois-03b-nova-empresa.png`." → "Simulação: `../planos-assinatura/02-nova-empresa.png`." (2) l. 236: sai "; substituem `depois-06b`, `depois-06c` e `depois-06d`" (a nota do §8 já diz). | designer-ux |

Sem defeito funcional para o `testes`.
**Resultado:** RD-0323 a RD-0326 fechados. O RD-0956 fica aberto: é baixo, mas está em doc, e por isso segura o lote (R-20261111-190159).

## Reteste 3 (15/11, commits `dde11a3` e `4b4fcac`, branch `nuvem/planos-assinatura-designer-ux`)

| ID | Resultado | Evidência |
|---|---|---|
| RD-0956 | **corrigido** | (1) l. 56: "Simulação: `../planos-assinatura/02-nova-empresa.png`." (2) l. 236: sai "; substituem `depois-06b`, `depois-06c` e `depois-06d`". O `4b4fcac` troca também as imagens das tabelas: l. 69 e l. 231 mostram `../planos-assinatura/02`, l. 104 mostra `03`, `04` e `05`. Nenhuma tabela de imagem cita mais `depois-03b`/`06b`/`06c`/`06d` (`grep`); os 6 PNG de `docs/design/planos-assinatura/` existem. |

### Achados novos

| ID | Onde | Tipo | O que se repete | Impacto | Severidade | Proposta (antes → depois) | Dono |
|---|---|---|---|---|---|---|---|
| RD-0957 | `docs/design/telas/portal-config-enxuto.md` l. 56 × l. 69; l. 106 × l. 104; l. 233 × l. 231; todos × l. 422 (§13) | doc | Depois do `4b4fcac`, as tabelas já mostram as imagens novas, e o texto em volta repete: (1) o §4 diz "Simulação: `../planos-assinatura/02-nova-empresa.png`" (l. 56) e a tabela do mesmo §4 mostra a mesma imagem 13 linhas abaixo (l. 69); (2) a nota "Substituídas em 15/11 … dão lugar a `03`, `04` e `05`" (l. 106) vem logo abaixo da tabela que já mostra `03`, `04` e `05` (l. 104); (3) a nota "Substituída em 15/11: `depois-03b` dá lugar a `02` … A `depois-03c` continua vigente" (l. 233) vem logo abaixo da tabela que mostra `02` e `03c` (l. 231). A substituição é dita 4 vezes (l. 106, 233, 305 e 422); a lista "Simulações vigentes … Substituídas: …" do §13 (l. 422) é a fonte. | manutenção; leitura | baixa | (1) l. 56: sai a frase "Simulação: `../planos-assinatura/02-nova-empresa.png`." (a tabela do §4 mostra). (2) l. 106: sai a nota inteira. (3) l. 233: sai a nota inteira. Ficam a nota do §13 (l. 305), que diz como ler as tabelas de histórico, e a lista da l. 422. | designer-ux |
| RD-0958 | `docs/design/telas/portal-config-enxuto.md` §5 (l. 75) e §8, tabela antes × depois, linha 4 (l. 91) | doc | Duas referências às simulações substituídas ficaram fora das tabelas de imagem, como se valessem: "O cabeçalho "depois" aparece no topo de `depois-05b-integracao.png` e `depois-06b-aba-empresa.png`" (l. 75) e "**diálogo** aberto pelo botão (`depois-06d-trocar-plano`)" (l. 91). É a mesma sobra do RD-0956 (1), em outras linhas. | decisão (o engenheiro-apps pode abrir o PNG antigo); manutenção | baixa | l. 75: "`depois-06b-aba-empresa.png`" → "`../planos-assinatura/03-aba-empresa.png`" (a 03 traz o mesmo cabeçalho: "Código AM4821 · CNPJ … · Manaus (UTC−4)"). l. 91: "(`depois-06d-trocar-plano`)" → "(`../planos-assinatura/05-trocar-plano.png`)". | designer-ux |

Conferido sem achado: a l. 236 (§11.4) sem a nota repetida; a l. 298 (§12, adendo de 14/11) cita `depois-03b`/`06b`/`06c`/`06d` como o que existia naquele dia, e o histórico fica; as tabelas do §13 (l. 402 a 433) seguem cobertas pela nota da l. 305. Sem defeito funcional para o `testes`.
**Resultado:** RD-0956 fechado. RD-0957 e RD-0958 abertos (baixos, em doc): seguram o lote (R-20261111-190159).

## Reteste 4 (15/11, commit `4404843`, branch `nuvem/planos-assinatura-designer-ux`)

| ID | Resultado | Evidência |
|---|---|---|
| RD-0957 | **corrigido** | (1) §4 (l. 55): sai "Simulação: `../planos-assinatura/02-nova-empresa.png`."; a tabela do §4 mostra a imagem. (2) Sai a nota "Substituídas em 15/11" abaixo da tabela do §8 (l. 102–104). (3) Sai a nota "Substituída em 15/11" abaixo da tabela do §11.3 (l. 227–229). A substituição fica nos 2 lugares que a proposta mantinha: a nota do §13 (l. 301), chave de leitura das tabelas de histórico, e a lista "Simulações vigentes … Substituídas" do §13.5 (l. 418), inventário dos arquivos. |
| RD-0958 | **corrigido** | §5 (l. 75): "`../planos-assinatura/03-aba-empresa.png`"; §8, linha 4 (l. 91): "(`../planos-assinatura/05-trocar-plano.png`)". |

Conferido sem achado:
- `grep 03b|06b|06c|06d` acha só registro histórico datado ou a chave de leitura: o adendo do §12 (l. 294, o que existia em 14/11), a nota do §13 (l. 301), o nome do achado P1 e a resposta do MC-0039 no §13.5 (l. 398 e 411, texto da resposta de 14/11; a coluna "Onde ficou" já usa `02` e `03`), a lista do §13.5 (l. 418) e a tabela do §13.6 (l. 423–429, coberta pela nota da l. 301). Registro histórico não é repetição.
- §8, l. 84, mudada pelo designer-ux: "(o "antes" é a simulação da aba Empresa da manhã de 14/11, no git até `9b4dd17`)". Tira o nome antigo (`06b`) sem repetir nada da seção.

**Resultado:** RD-0957 e RD-0958 fechados. Nenhum achado em aberto no `portal-config-enxuto.md`: o parecer não segura o lote.

# `CampoSenha` com olho no kit (app e web) · parecer do corretor-redundancias

**Veredito: COM ACHADO (não liberado).** São 4 achados, do RD-0477 ao RD-0480: 1 de gravidade alta e 3 de gravidade baixa. Todos estão em código de produção ou em doc, então todos seguram o PR.

Corretor-redundancias, 15/11/2026 (Manaus). Conferi o PR #323, branch `nuvem/campo-senha-designer-ux`, commit **63b85a1** (o diff contra o `origin/main` 0650504):
- `packages/ui/src/{comum/senha.ts, mobile/campo-senha*.ts(x), mobile/icon.tsx, mobile/senha.tsx, mobile/index.ts, mobile/puro.ts, web/campo-senha*.ts(x), web/senha.tsx, web/index.ts, web/icons.tsx}`;
- `docs/design/campo-senha/{spec.md, inventario.md}`, `ciclo-de-senha.md`, `portal-entrar.md` e `componentes.md`.

O pedido é do dono do produto (R-20261115-071000): "Padrão da senha é o olho para mostrar e ocultar. Revise todo o app e web e padronize".

## 1. O que foi pedido para conferir
| Ponto | Resultado |
|---|---|
| Código duplicado entre mobile, web e `comum/senha.ts` | O rótulo do olho tem uma fonte só: `rotuloDoOlhoDaSenha` em `comum`, usada pelos dois kits. Sobram 2 duplicações: o tipo da finalidade (**RD-0477**) e a classe do campo, que fica com uma 3ª cópia (**RD-0478**). O `autoComplete` não é duplicação: o valor muda por plataforma (`password` × `current-password`). |
| `ESCONDER_SENHA` deprecated ao lado do `OCULTAR_SENHA` | São 2 constantes, 2 funções e 2 palavras para o mesmo botão enquanto as telas não migram. A docs já diz "Ocultar" e as telas ainda dizem "Esconder" (**RD-0479**). |
| Item "As duas senhas iguais" (spec §4), no lugar de "As senhas não conferem." | **Sem achado.** Reduz 3 textos (`TEXTO_REPETICAO_SENHA.igual/diferente/vazia`) a 1, no formato das outras regras, e a marca diz o estado (○ ✓ ✕). O "senhas" do item não repete o título "A senha precisa ter": o item fala dos 2 campos. O leitor de tela segue o padrão das regras (": falta" / ": ok"). |
| Rótulo "Mostrar senha"/"Ocultar senha" | **Sem achado.** O rótulo fica só no `aria-label` / `accessibilityLabel` (redundância útil: acessibilidade), sem texto visível ao lado do ícone. O campo tem o próprio nome ("Senha"), e o botão diz a ação, então um não repete o outro. Os testes conferem que não há "Mostrar", "Esconder" nem "Ocultar" na tela (`campo-senha.test.ts`, mobile `:64-68`, web `:47-53`). |

## 2. Achados
### RD-0477 · baixa · código · designer-ux
- **Onde:** `packages/ui/src/mobile/campo-senha.ts:26` (`FinalidadeSenha`) × `packages/ui/src/web/campo-senha.tsx:18` (`FinalidadeSenhaWeb`).
- **O que se repete:** o mesmo tipo `'login' | 'criacao'`, declarado 2 vezes com 2 nomes.
- **Proposta:** declarar uma vez só em `packages/ui/src/comum/senha.ts`, `export type FinalidadeSenha = 'login' | 'criacao';`, e reexportar pelos 2 `senha.tsx`. Os 2 `campo-senha` importam de `../comum/senha`, e `FinalidadeSenhaWeb` sai.

### RD-0478 · baixa · código · designer-ux (kit) · engenheiro-apps (telas)
- **Onde:** `packages/ui/src/web/campo-senha.tsx:21-22` (`CAMPO_SENHA_CSS`), `apps/web/components/portal/base.tsx:45-46` (`campoCss`) e `apps/web/components/ciclo-senha.tsx:30` (`campoCss`).
- **O que se repete:** a mesma classe da caixa do campo ("h-11 w-full rounded-xl border border-field bg-surface px-3 text-[15px] …"), agora em 3 cópias. O comentário do kit diz: "Mesma caixa do campo do portal e do BKO". A cópia do `base.tsx` serve também a campos que não são de senha (`:109`) e continua mesmo depois da migração do inventário.
- **Proposta:** o kit exporta a classe com nome genérico, por exemplo `CAMPO_CSS` em `web/ui`, e o `CampoSenha` usa essa classe. O engenheiro-apps troca os 2 `campoCss` pelo import do kit, junto com a migração do inventário.

### RD-0479 · baixa · código · texto · designer-ux · modulo-core · engenheiro-apps
- **Onde:**
  - a constante `ESCONDER_SENHA` em `packages/ui/src/comum/senha.ts:46-50` (`@deprecated`), reexportada em `mobile/senha.tsx:28` e `web/senha.tsx:28`;
  - a função `rotuloOlhoSenha` em `modules/core/app/lib/login.ts:64-65`.
- **O que se repete:** 2 constantes ("Esconder senha" × "Ocultar senha") e 2 funções (`rotuloOlhoSenha` × `rotuloDoOlhoDaSenha`) para o mesmo botão. Hoje, `ciclo-de-senha.md` e `portal-entrar.md` já dizem "Ocultar senha", e as telas (`ciclo-senha.tsx:141`, `portal/base.tsx:160`, `login.ts:65`) ainda falam "Esconder senha".
- **Proposta:** a migração das 7 telas do inventário e a retirada da `ESCONDER_SENHA` entram no **mesmo lote** (não no "lote seguinte", como diz o comentário `@deprecated`). Assim, o produto nunca tem as 2 palavras ao mesmo tempo.
  - modulo-core: apaga a `rotuloOlhoSenha`, o teste dela (`login.test.ts:78-79`) e os estilos `olho`/`olhoTexto` (`estilos-de-acesso.ts:8-9`).
  - engenheiro-apps: o `CampoSenha` local de `portal/base.tsx` e o `CampoDeSenha` de `ciclo-senha.tsx` saem.
  - designer-ux: apaga a `ESCONDER_SENHA` e os 2 reexports.
  - O achado fecha quando `git grep ESCONDER_SENHA` não achar nada fora do histórico.

### RD-0480 · alta · doc · designer-ux
- **Onde:** `docs/design/componentes.md` §4.3, item `CampoSenha` ("18 px na web e 22 no app, `text-ink-2`, botão de 44 × 44 dentro do campo") × `docs/design/campo-senha/spec.md` §1 ("Área de toque: **48 × 48 dp** no app (campo de 52 dp), **44 × 44 px** na web").
- **O que se repete:** a mesma regra está em 2 docs, com números diferentes: o `componentes.md` dá 44 × 44 também para o app, e o código usa 48 (`CAMPO_SENHA.olho = ALVO_TOQUE`). O `componentes.md` também repete o resto da spec (ícones, cor, tamanhos).
- **Proposta:** a fonte da verdade é a `campo-senha/spec.md`. No `componentes.md`, o item fica só com a remissão:
  - Antes: "`CampoSenha` (…): o campo de senha único. Olho só em ícone (…) 18 px na web e 22 no app, `text-ink-2`, botão de 44 × 44 dentro do campo, à direita. Vale no login (…)"
  - Depois: "`CampoSenha` (web `@macuxi/ui/web` e mobile `@macuxi/ui/mobile`): o campo de senha único, com o olho só em ícone. Medidas, textos e comportamento: `campo-senha/spec.md`. Vale também no login; a lista de regras não entra no login."

## 3. Conferido sem achado
- **Ícones:** os ícones `olho`/`olhoRiscado` do app têm o mesmo desenho do `IconEye`/`IconEyeOff` da web, e cada plataforma tem o seu conjunto de ícones. Não é duplicação.
- **"Repita a senha":** é um `CampoSenha` sem olho, que segue o olho do "Senha nova". O olho aparece uma vez só, e um toque mostra os 2 campos.
- **Testes:** o teste mobile confere a função pura e a fonte do componente; o teste web confere a árvore do componente. Não há caso repetido com outro nome.
- **`inventario.md`:** cada lugar aparece uma vez só, com o dono de cada um.

## 4. Reteste (15/11/2026, commit 1826f04 do designer-ux)
**Veredito:**
- **3 corrigidos:** RD-0477, RD-0478 e RD-0480.
- **1 continua aberto:** RD-0479, que o designer-ux adiou para o lote da migração (v1.0.10).
- **1 achado novo, só em comentário:** RD-0481, de gravidade baixa. Pela R-20261111-190159, ele não segura.

| RD | Situação | Evidência |
|---|---|---|
| RD-0477 | **corrigido** | `FinalidadeSenha` está declarada uma vez só, em `comum/senha.ts:52-53`, e é reexportada pelos 2 `senha.tsx`. `git grep FinalidadeSenhaWeb` não acha nada. |
| RD-0478 | **corrigido** | `CAMPO_SENHA_CSS` saiu. A classe agora é a `CLASSE_CAMPO_ACESSO`, em `web/ui.tsx:137`, que o `CampoSenha` usa. O `inventario.md` manda os 2 `campoCss` do `apps/web` importarem essa classe na migração; o engenheiro-apps faz isso. |
| RD-0479 | **aberto** (adiado) | `ESCONDER_SENHA` continua em `comum/senha.ts:50` e nos 2 reexports, agora com "Sai no lote da v1.0.10, com a migração das telas". Nenhuma tela usa o `CampoSenha` ainda, então o produto ainda não mostra as 2 palavras ao mesmo tempo. O achado fecha quando as 7 telas do inventário migrarem e o `git grep ESCONDER_SENHA` não achar nada. **Segura o lote da v1.0.10**, que é onde ele tem de fechar. |
| RD-0480 | **corrigido** | No `componentes.md`, o item `CampoSenha` agora só remete a `campo-senha/spec.md`, sem medidas. A divergência 44 × 48 sumiu. |

### `CLASSE_CAMPO_ACESSO` × `CLASSE_CAMPO` / `CLASSE_CAMPO_BASE` (pedido do coordenador)
**Não é duplicação.** A `CLASSE_CAMPO_BASE` (`ui.tsx:58`) e a `CLASSE_CAMPO_ACESSO` (`ui.tsx:137`) só têm em comum `border border-field bg-surface text-ink`. Nas outras propriedades, elas são 2 variantes visuais diferentes:

| Propriedade | `CLASSE_CAMPO_BASE` | `CLASSE_CAMPO_ACESSO` |
|---|---|---|
| Raio | 10 px | `rounded-xl` |
| Texto | 14, medium | 15, regular |
| Foco | `CLASSES_DESTAQUE.foco` (offset 2) | borda `ink` + offset 1 |
| Desabilitado | `opacity-60` | `bg-ground` / `text-ink-2` |
| Altura | 42 px (na `CLASSE_CAMPO`) | 44 px |

O `cx` só junta as classes e não resolve conflito. Por isso, montar a de acesso a partir da base deixaria 2 raios e 2 tamanhos de texto na mesma classe. Juntar as duas mudaria o visual das telas de acesso, e essa decisão é do design-de-marca, não minha. Fica uma classe por variante, e as 3 cópias viram 1 depois da migração.

### RD-0481 · baixa · comentário · designer-ux · **não segura** (só comentário)
- **Onde:** `packages/ui/src/web/ui.tsx:55`, no comentário da `CLASSE_CAMPO_BASE`: "Traço, cor, texto e foco de **todo campo do kit**".
- **O que se repete:** o comentário diz que essa é a base de todos os campos. Com a `CLASSE_CAMPO_ACESSO`, há outra base no mesmo arquivo, e quem ler o comentário pode montar uma 3ª.
- **Proposta:** "Traço, cor, texto e foco dos campos do kit (filtros, busca e formulário; RD-0368). Telas de acesso: `CLASSE_CAMPO_ACESSO`. Cada campo só acrescenta a altura, a largura e o respiro."

## 5. "As duas senhas iguais" no checklist de "Crie sua senha" (15/11/2026, commit fe57995 do designer-ux)
**Veredito: COM ACHADO.** Há 1 achado de gravidade baixa, o RD-0507, em código de produção, que **segura**. O texto em si está sem achado.

Conferi o branch `nuvem/senhas-iguais-designer-ux`, commit **fe57995**, pelo diff contra o `origin/main`:
- o código: `comum/senha.ts`, `web/senha.tsx` e `mobile/senha.tsx`, com os testes;
- os docs: `campo-senha/spec.md` §4, `ciclo-de-senha.md` §4 e `portal-entrar.md` §5.

O texto foi aprovado pelo dono do produto (R-20261115-080000-alexandre, item 2), e não o conto como achado.

| Ponto | Resultado |
|---|---|
| Texto | Um texto só, "As duas senhas iguais", no lugar de 3 ("As senhas conferem.", "As senhas não conferem." e "Repita a senha nova."). O estado vem da marca (○ ✓ ✕) e do "ok"/"falta" falado, como nas regras. Nada se repete na tela. |
| Docs | A `campo-senha/spec.md` §4 agora só remete ao `ciclo-de-senha.md` §4, que é a fonte única dos estados. O `portal-entrar.md` §5 cita o item e remete ao `ciclo-de-senha.md` §7. Os estados não aparecem em 2 docs. |
| `ESCONDER_SENHA` | Continua até o modulo-core migrar. O RD-0479 segue **aberto**, como combinado. |

### RD-0507 · baixa · código · designer-ux · segura
- **Onde:** a mesma conta, estado → "ok"/"falta" falado (`estado === 'ok' ? ESTADO_FALADO_REGRA.ok : ESTADO_FALADO_REGRA.falta`), está em 4 lugares:
  - `comum/senha.ts`: `itensDasRegras` (`cumprida ? ok : falta`) e a nova `itemDaRepeticao` (`confere ? ok : falta`);
  - `web/senha.tsx:110`: o `sr-only` das regras;
  - `web/senha.tsx:125`: o `sr-only` novo da conferência. Ele refaz a conta mesmo com o `rotuloAcessivel` que a `itemDaRepeticao` acabou de calcular.
- **O que se repete:** a mesma decisão está escrita 4 vezes, e 2 delas são deste commit. Se o falado mudar, por exemplo "pendente" no lugar de "falta", é preciso lembrar de mudar os 4.
- **Proposta:** uma função pura em `comum/senha.ts`:
  ```ts
  export function estadoFalado(estado: EstadoRegraSenha): string {
    return estado === 'ok' ? ESTADO_FALADO_REGRA.ok : ESTADO_FALADO_REGRA.falta;
  }
  ```
  - `itensDasRegras` e `itemDaRepeticao` montam o `rotuloAcessivel` com `estadoFalado(estado)`.
  - Na web, os 2 `sr-only` passam a usar `` `: ${estadoFalado(i.estado)}` `` e `` `: ${estadoFalado(conferencia.estado)}` ``.

  Uma alternativa é o item já trazer o `falado` pronto e a web só ler `i.falado`.

**Observação sem RD:** no cabeçalho de `web/senha.tsx`, a frase nova termina em "(R-20261115-080000-alexandre)" sem ponto, e a linha seguinte começa com "(id `<id>-repeticao`…". A frase ficou quebrada. É só um comentário; corrija junto com o RD-0507.

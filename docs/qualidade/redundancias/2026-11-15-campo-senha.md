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

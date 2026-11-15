# Campo de senha (R-20261115-071000)

Pedido do dono do produto (15/11/2026, ~7h10): "Padrão da senha é o olho para mostrar e ocultar. Revise todo o app e web e
padronize". Um componente só, `CampoSenha`, no app (Campo e Gestão) e na web (BKO e portal). Onde ele entra: `inventario.md`.

## 1. O que aparece

```
Senha                                   ← rótulo (13, semibold, ink)
[ ••••••••                      (olho) ] ← campo; olho só em ícone, dentro do campo, à direita
```

- **Olho só em ícone**, sem texto "Mostrar"/"Esconder"/"Ocultar" na tela. Mostra o que o toque faz:
  - senha oculta → olho aberto (`olho` no app, `IconEye` na web); leitor de tela: **"Mostrar senha"**;
  - senha visível → olho riscado (`olhoRiscado` / `IconEyeOff`); leitor de tela: **"Ocultar senha"**.
  - Textos: `MOSTRAR_SENHA` / `OCULTAR_SENHA` e `rotuloDoOlhoDaSenha(visivel)` (`packages/ui/src/comum/senha.ts`).
- Cor do ícone `ink2` (web `text-ink-2`, `hover:text-ink`); sem fundo nem borda própria.
- Área de toque: **48 × 48 dp** no app (campo de 52 dp), **44 × 44 px** na web (campo de 44 px). O texto do campo recua para
  não passar por baixo do olho.
- Erro: borda `danger` no campo (app `erro`; web `erro` em texto abaixo, ligado por `aria-describedby`).

## 2. Comportamento
- **Controlado**: a tela guarda `visivel` e troca no toque. Em "Crie sua senha" **um olho só** (no "Senha nova") mostra os dois
  campos; o "Repita a senha" é um `CampoSenha` sem `aoAlternar`/`onAlternar` (sem olho) com o mesmo `visivel`.
- Começa oculta; ao sair da tela o estado some com ela.
- Teclado (app, `propsDeTecladoDaSenha`; a tela não sobrescreve): `autoCorrect={false}`, `autoCapitalize="none"`,
  `spellCheck={false}`, `autoComplete` `password` (login) ou `new-password` (`finalidade="criacao"`), `textContentType`
  `password` / `newPassword`, `secureTextEntry` quando oculta e `keyboardType="visible-password"` quando visível no Android
  (sem sugestões nem espaço automático; R-20261115-064000).
- Web: `type` `password`/`text`, `autoComplete` `current-password` ou `new-password`, `spellCheck={false}`,
  `autoCapitalize="none"`, `autoCorrect="off"`; o olho é `<button type="button">` (não envia o formulário).
- Movimento: no app o olho usa `Pressionavel` (escala 0,97 em 120 ms; respeita "reduzir movimento").

## 3. API

App — `import { CampoSenha } from '@macuxi/ui/mobile'` (partes puras em `@macuxi/ui/mobile/puro`):

| Prop | Tipo | Observação |
|---|---|---|
| `rotulo` | string | rótulo visível e nome falado do campo |
| `valor`, `aoMudar` | string, (t) => void | |
| `visivel` | boolean | estado da tela |
| `aoAlternar` | () => void, opcional | sem ela, sem olho |
| `finalidade` | `'login'` (padrão) \| `'criacao'` | |
| `erro` | boolean | borda vermelha |
| `inputRef` | Ref<TextInput> | foco no próximo campo |
| `testID`, `testIDOlho` | string | olho: padrão `<testID>.olho` (o login usa `login.senha-olho`) |
| demais | `TextInputProps` | `returnKeyType`, `onSubmitEditing`, `autoFocus`… (menos as de teclado) |

Web — `import { CampoSenha } from '@macuxi/ui/web'`: `id` (obrigatório), `rotulo`, `visivel`, `onAlternar?`,
`finalidade?`, `erro?` (texto), `descrito?` (id das `RegrasDaSenha`), `testId?` (olho: `<testId>.olho`), `className?` e os
atributos de `<input>` (menos `type`, `autoComplete` e os de corretor).

## 4. Checklist de "Crie sua senha": o item da repetição (aprovado)
Aprovado pelo dono do produto em R-20261115-080000-alexandre (item 2): o último item passa a ser **"As duas senhas iguais"**,
no padrão das regras, no lugar de "As senhas conferem." / "As senhas não conferem." / "Repita a senha nova.". Estados e leitura:
[`ciclo-de-senha.md`](../ciclo-de-senha.md) §4. Código: `TEXTO_REPETICAO_SENHA` e `itemDaRepeticao` em
`packages/ui/src/comum/senha.ts` (designer-ux); as telas não mudam, só passam `repeticao`.

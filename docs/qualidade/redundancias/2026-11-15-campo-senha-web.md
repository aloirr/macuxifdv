# PR #328 · campos de senha da web no `CampoSenha` do kit · parecer do corretor-redundancias

**Veredito: COM ACHADO.** São 2 achados de gravidade baixa, o RD-0505 e o RD-0506, ambos do **engenheiro-apps**. Os 2 estão em código de produção e seguram pela regra.
- **RD-0505:** os 2 lugares já tinham esse problema com o `campoCss`, mas o PR reescreveu essas mesmas linhas.
- **RD-0506:** é herdado; o PR mexeu nos 3 lugares. Se o gerente preferir, ele entra no lote seguinte, como os herdados da v1.0.8.

Corretor-redundancias, 15/11/2026 (Manaus). Conferi o PR #328, branch `nuvem/campo-senha-engenheiro-apps`, commit **f324573**, pelo diff contra o `origin/main` (o #323 já está nele):
- `apps/web/components/ciclo-senha.tsx` e `login-screen.tsx`;
- `portal/base.tsx`, `portal/passo-empresa.tsx`, `portal/tela-diagnosticos.tsx` e `portal/tela-entrar.tsx`;
- `campo-senha-telas.test.tsx`.

## 1. O que o PR fecha
| Item | Resultado |
|---|---|
| **RD-0478** (classe do campo em 3 cópias) | **Parte web fechada.** Os 2 `campoCss` (`portal/base.tsx`, `ciclo-senha.tsx`) e o do `login-screen.tsx` saíram. Todos usam `CLASSE_CAMPO_ACESSO` do kit. `git grep campoCss` no `apps/web` não acha nada. |
| **RD-0479** (2 palavras e 2 funções para o olho), parte web | **Parte web fechada.** `ESCONDER_SENHA`, `IconEye`/`IconEyeOff` e os botões locais saíram de `ciclo-senha.tsx` e de `portal/base.tsx`. O `CampoSenha` local do portal saiu, e o login do BKO ganhou o olho. Falta a parte do modulo-core (`rotuloOlhoSenha`, `login.ts`) e a retirada da `ESCONDER_SENHA` no kit, no lote da v1.0.10. Até lá, o RD-0479 continua **aberto** no catálogo. |
| Textos | O olho é só ícone, com "Mostrar senha"/"Ocultar senha" no leitor de tela. O teste novo confere que não há "Esconder senha" nas 3 telas. Nenhum texto se repete. Em "Crie sua senha" há um olho só, no "Senha nova", para os 2 campos. |

## 2. Achados
### RD-0505 · baixa · código · engenheiro-apps · segura
- **Onde:**
  - `portal/tela-diagnosticos.tsx:245`: `cx(CLASSE_CAMPO_ACESSO, 'h-[38px] w-[170px] rounded-[10px] text-[14px]')`;
  - `portal/passo-empresa.tsx:446`: `` `${CLASSE_CAMPO_ACESSO} h-9 w-24` ``.
- **O que se repete:** o `cx` só junta as classes, sem resolver conflito, e cada campo fica com 2 alturas, 2 raios e 2 tamanhos de texto (`h-11` e `h-[38px]`/`h-9`, `rounded-xl` e `rounded-[10px]`, `text-[15px]` e `text-[14px]`). O que vale depende da ordem do CSS gerado. O filtro do Diagnósticos (38 px, raio 10, texto 14) refaz à mão a `CLASSE_CAMPO_BASE` do kit, que o `SelectField` do lado já usa.
- **Proposta:**
  - Diagnósticos: `className={cx(CLASSE_CAMPO_BASE, 'h-[38px] w-[170px] px-2.5')}`, igual aos filtros do kit (`SelectField`, busca).
  - Licenças do Passo Empresa: `className={cx(CLASSE_CAMPO_BASE, 'h-9 w-24 px-2.5 aria-[invalid=true]:border-danger')}`. Se o design quiser a caixa de acesso nesse lugar, o certo é `CLASSE_CAMPO_ACESSO` sem trocar a altura.
  - Os 2 tiram o `CLASSE_CAMPO_ACESSO` do import, onde ele deixar de ser usado.

### RD-0506 · baixa · código · engenheiro-apps · herdado (o PR mexe nos 3)
- **Onde:** há 3 versões do mesmo "campo de acesso com rótulo e erro" no `apps/web`:
  - `login-screen.tsx:184`, a função local `campo()`, com `<label>`, `<span>` 13/600, `input` com `CLASSE_CAMPO_ACESSO` e o erro com `aria-describedby`;
  - `portal/base.tsx:92`, o componente `Campo`, com o mesmo `<label>`, `<span>` e erro;
  - `ciclo-senha.tsx:227-234`: o "Esqueci a senha" monta 2 vezes o mesmo `<label>`, `<span>` e `input` à mão.
- **O que se repete:** a mesma caixa, o mesmo rótulo e a mesma ligação do erro, escritos 3 vezes, ao lado do `CampoSenha` do kit, que já faz isso para a senha. Quem mudar o rótulo ou o erro num lugar deixa os outros 2 diferentes.
- **Proposta:** um `Campo` só, para as telas de acesso. Pode ser o `Campo` do `portal/base.tsx` levado para `apps/web/components/campo-acesso.tsx`, ou um `CampoAcesso` no kit, ao lado do `CampoSenha` (fala com o designer-ux). O login (`campo('codigo_empresa'…)` e `campo('email'…)`) e o "Esqueci a senha" passam a usá-lo, e a função `campo()` sai.

## 3. Conferido sem achado
- **Estado do olho:** o `useState` + `onAlternar` se repete em 4 telas (login, Entrar, Passo Empresa, Crie sua senha). É o modo "controlado" da spec do `CampoSenha` (§2), em que cada tela guarda o próprio estado e "Crie sua senha" divide um estado só entre os 2 campos. Não conto como duplicação.
- **Foco no campo:** o `document.getElementById(ID_SENHA…)` substitui o `ref`, porque o kit não repassa o `ref`. Aparece uma vez por tela.
- **Testes:** o `campo-senha-telas.test.tsx` confere as telas (`testId`, um olho só, `new-password`, sem "Esconder senha"), e o teste do kit confere o componente. Nenhum caso se repete.

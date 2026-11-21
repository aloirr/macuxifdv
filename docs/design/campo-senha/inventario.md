# Campo de senha: inventário (R-20261115-071000)

Levantamento por grep em `origin/main` @ 06505049b (15/11/2026, ~7h de Manaus), em `apps/` e `modules/`, procurando
`secureTextEntry`, `type="password"` / `'password'`, `autoComplete` e `textContentType` de senha, `'Mostrar'`, `'Esconder'`,
`IconEye`, `MOSTRAR_SENHA` / `ESCONDER_SENHA` e "senha". Dono conferido com `node scripts/coord.mjs dono <caminho>`.
Componente que substitui todos: `CampoSenha` do kit (spec: `spec.md`, nesta pasta).

Legenda: **Texto** = o olho é texto "Mostrar"/"Esconder" (fora do padrão); **Ícone local** = ícone certo, mas componente
próprio e rótulo "Esconder senha"; **Sem olho** = campo sem o botão.

## App Campo e Gestão (React Native)

| Arquivo:linha | Tela / campo | Situação | Dono |
|---|---|---|---|
| `modules/core/app/components/tela-login.tsx:137` (`TextInput` do `Campo`), `:92-104` (props da senha), `:146-156` (olho) | Login: "Senha" | **Texto** ("Mostrar"/"Esconder", `:155`) | modulo-core |
| `modules/core/app/components/tela-crie-sua-senha.tsx:94-109` (campo), `:111-113` (olho) | Crie sua senha: "Senha nova" | **Texto** ("Mostrar"/"Esconder", `:112`) — o print da v1.0.9 | modulo-core |
| `modules/core/app/components/tela-crie-sua-senha.tsx:119-131` | Crie sua senha: "Repita a senha" | sem olho próprio (segue o de cima; certo) — vira `CampoSenha` sem `aoAlternar` | modulo-core |
| `modules/core/app/components/estilos-de-acesso.ts:8-9` | estilos `olho` / `olhoTexto` | saem com a troca (o olho passa a ser do kit) | modulo-core |
| `modules/core/app/lib/login.ts:9`, `:64-65` (`rotuloOlhoSenha`) e `modules/core/app/lib/login.test.ts:78-79` | rótulo falado do olho ("Esconder senha") | trocar por `rotuloDoOlhoDaSenha` do kit ("Ocultar senha") ou apagar | modulo-core |
| `apps/mobile/src/app/login.tsx` | shell: monta `TelaLogin`, `TelaCrieSuaSenha`, `TelaEsqueciSenha` do Core | nenhum campo de senha próprio | engenheiro-apps |

"Troca de senha" no app é a mesma `TelaCrieSuaSenha` (motivo `senha_temporaria` / troca no 1º uso); "Esqueci a senha"
(`tela-esqueci-senha.tsx`) não tem campo de senha.

## BKO (web)

| Arquivo:linha | Tela / campo | Situação | Dono |
|---|---|---|---|
| `apps/web/components/login-screen.tsx:249` (via `campo()` em `:181`) | Login do BKO: "Senha" | **Sem olho** | engenheiro-apps |
| `apps/web/components/ciclo-senha.tsx:50-55` (`CampoDeSenha`), `:127-147` (nova + olho), `:150` (repita) | Crie sua senha (web) | **Ícone local** (`aria-label` "Esconder senha", `:141`) | engenheiro-apps |
| `modules/core/web/components/usuarios/usuarios-page.tsx:636-643` (campo), `:658-660` (botão) | Usuários → Redefinir senha: "Senha nova" | **Texto** ("Mostrar senha"/"Esconder senha" em botão de linha ao lado do "Gerar senha") | modulo-core |

## Portal config. (web, `/config`)

| Arquivo:linha | Tela / campo | Situação | Dono |
|---|---|---|---|
| `apps/web/components/portal/base.tsx:128-171` (`CampoSenha` local; olho `:158-165`) | componente do portal | **Ícone local** ("Esconder senha", `:160`) — trocar pelo `CampoSenha` do kit | engenheiro-apps |
| `apps/web/components/portal/tela-entrar.tsx:125` | Entrar: "Senha" | usa o local de `base.tsx` | engenheiro-apps |
| `apps/web/components/portal/passo-empresa.tsx:383-391` | Passo Empresa: "Senha inicial" | usa o local de `base.tsx` | engenheiro-apps |

## Sem campo de senha na tela (conferidos)
`apps/web/app/config/entrar/page.tsx`, `portal/cartao-admins.tsx` (redefinir senha do admin: senha temporária por e-mail),
`portal/cartao-equipe.tsx`, `portal/tela-empresa.tsx`, `portal/tela-escolher-empresa.tsx`, `modules/core/web/components/perfis/perfis-page.tsx`,
`modules/core/app/components/tela-esqueci-senha.tsx`, `apps/conector` (sem interface) e `apps/api` (CLI).

## Kit e docs (designer-ux, feitos neste lote)
`packages/ui/src/comum/senha.ts` (`OCULTAR_SENHA`, `rotuloDoOlhoDaSenha`; `ESCONDER_SENHA` saiu do kit na v1.0.18, sem uso fora dele; RD-0479), `CLASSE_CAMPO_ACESSO` em `packages/ui/src/web/ui.tsx` (RD-0478), `packages/ui/src/mobile/campo-senha.ts`, `campo-senha-rn.tsx`, `icon.tsx` (`olho`, `olhoRiscado`),
`packages/ui/src/web/campo-senha.tsx`; `docs/design/ciclo-de-senha.md`, `portal-entrar.md` e `componentes.md` passam a dizer
"Ocultar senha".

## Resumo por dono
- **modulo-core** (4 lugares): login do app, "Crie sua senha" do app (2 campos), `estilos-de-acesso.ts` / `rotuloOlhoSenha`,
  redefinir senha em Usuários (BKO). Juntar com `nuvem/login-teclado-modulo-core` (R-20261115-064000), que mexe no mesmo login.
- **engenheiro-apps** (3 lugares): login do BKO (ganha o olho), "Crie sua senha" web (`ciclo-senha.tsx`), `CampoSenha` local do
  portal (`base.tsx`, usado em Entrar e Passo Empresa). Na mesma troca, os `campoCss` de `portal/base.tsx:45` e `ciclo-senha.tsx`
  passam a importar `CLASSE_CAMPO_ACESSO` do kit (RD-0478).

# Ciclo de senha — Crie sua senha, Esqueci a senha, Usuários do BKO, mensagens e e-mails (T-0094)

> 2026-11-07 · designer-ux · fatia U do desenho [`docs/desenho/T-0094.md`](../desenho/T-0094.md) (§3 a §10) · ADR 0032 ·
> regras: RN-CORE-32, RN-CORE-33, RN-CORE-34. Para: **engenheiro-apps** (fatia W: telas do BKO, navegação do app, portal) e
> **modulo-core** (fatia C: `TelaCrieSuaSenha` e `TelaEsqueciSenha` em `modules/core/app`, tela Usuários do BKO, mensagens da API).
> Kit: `RegrasDaSenha` (web `packages/ui/src/web/senha.tsx`, mobile `packages/ui/src/mobile/senha.tsx`, textos em
> `packages/ui/src/comum/senha.ts`), agora com a linha **"Repita a senha"** (§4). Base: [`portal-entrar.md`](portal-entrar.md) §5.
>
> **Tom (pedido do dono do produto): simples e direto.** Uma frase por aviso; o erro diz o que fazer. Na tela não aparecem
> "token", "sessão revogada", "hash", "convite", "TOTP" nem "superfície". Falamos **"senha temporária"** (a que chega por e-mail ou
> que o admin define) e **"sua senha"** (a que a pessoa cria). "Backoffice" por extenso na tela; "BKO" só nos docs.

## 1. Mensagens do login (app Campo, app Gestão e BKO)
A API manda a `mensagem` abaixo; o shell novo mostra a do quadro (a mesma) e, nos casos marcados, navega.

| Código | Quando | O que a tela faz | Texto |
|---|---|---|---|
| 403 `PERFIL_FORA_DO_APP` | senha certa, perfil de outro app | fica no login, erro no lugar de sempre | `mensagemPerfilForaDoApp(perfil, app)` do SDK, sem mudança (ver abaixo) |
| 403 `SENHA_A_TROCAR` | senha certa e temporária (ou master do admin) | **app e BKO novos:** vão direto à "Crie sua senha" (§2), sem mostrar texto | API (para o APK antigo): **"Você precisa criar uma senha nova. Atualize o app para continuar."** |
| 410 `SENHA_TEMPORARIA_VENCIDA` | senha temporária certa, mas passou de 72 h | fica no login; erro; o link "Esqueci a senha" logo abaixo | **"Esta senha temporária venceu. Peça outra em "Esqueci a senha" ou fale com o administrador da sua empresa."** |
| 403 `PERFIL_SEM_BKO` | BKO em uso e o perfil perdeu o acesso | o BKO encerra a sessão e volta ao Entrar com aviso `Notice tone="info"` | `mensagemPerfilForaDoApp(perfil, 'web')` com o perfil da sessão; sem perfil: **"Seu perfil não tem acesso ao backoffice."** (é também a `mensagem` da API) |

**`mensagemPerfilForaDoApp`, com o supervisor fora do BKO** (fatia S muda só `PERFIS_DO_APP.web`; o texto sai assim, aprovado):
- vendedor no BKO: "O perfil vendedor não usa o backoffice (web). Entre pelo app Macuxi Campo."
- supervisor no BKO: "O perfil supervisor não usa o backoffice (web). Entre pelo app Macuxi Gestão."
- supervisor no Campo: "O perfil supervisor não usa o app Macuxi Campo. Entre pelo app Macuxi Gestão."
- gerente no Campo: "O perfil gerente não usa o app Macuxi Campo. Entre pelo app Macuxi Gestão ou pelo backoffice (web)."
- admin no Campo: "O perfil admin não usa o app Macuxi Campo. Entre pelo backoffice (web)."

Por que trocar o texto proposto do `SENHA_A_TROCAR` ("Crie uma senha nova para continuar. Se esta tela não aparecer, atualize o
app."): o APK antigo mostra a frase **na tela de login**, onde "esta tela" não existe; a pessoa precisa só saber que deve atualizar.

**Link "Esqueci a senha"** no login do app e do BKO: botão link (texto `accent`, 14/600) logo abaixo do botão "Entrar", alvo
≥ 44 px, `testID`/`data-testid` `login.esqueci`. Leva o código da empresa e o e-mail já digitados para a tela do §3. Os outros
erros do login não mudam (`modules/core/app/lib/login.ts`, `apps/web/lib/login.ts`).

## 2. "Crie sua senha" (troca obrigatória no 1º uso) — app Campo, app Gestão e BKO
Mesma tela nos três; no app é a `TelaCrieSuaSenha` (`modules/core/app`), no BKO a página do engenheiro-apps na moldura do login.
**Nada mais abre antes**: sem abas, sem menu, sem voltar por gesto para dentro do app.

De cima para baixo:
1. Título **"Crie sua senha"** (Archivo, 24/800 no app; 28/800 no BKO).
2. Subtítulo (14, `ink-2`) pelo `detalhes.motivo`:
   - `primeiro_acesso`: **"É o seu primeiro acesso. Crie uma senha só sua para continuar."**
   - `senha_temporaria`: **"Você entrou com uma senha temporária. Crie uma senha nova para continuar."**
3. Linha de quem está entrando (13, `ink-2`): **"<e-mail> · <código da empresa>"**. Sem campo de e-mail nem de senha atual: a
   senha usada no login fica só na memória da tela (nunca em storage, URL ou log) e some ao sair dela.
4. Campo **"Senha nova"** (`CAMPO_SENHA_NOVA`; `autoComplete="new-password"`, foco inicial) com o olho **"Mostrar senha"** /
   **"Esconder senha"** à direita, dentro do campo, alvo ≥ 44 px. **O olho mostra os dois campos** (um só toque).
5. Campo **"Repita a senha"** (`CAMPO_REPITA_A_SENHA`; `autoComplete="new-password"`).
6. `RegrasDaSenha` logo abaixo dos dois campos, ao vivo, com `repeticao` (§4). No BKO: `id="senha-regras"`; o campo "Senha
   nova" com `aria-describedby="senha-regras"` e o "Repita a senha" com `aria-describedby="senha-regras-repeticao"`.
7. Botão principal **"Salvar e entrar"** (enviando: **"Salvando…"**, desabilitado). Um só principal.
8. Botão link **"Voltar ao login"** (descarta a senha da memória; o código da empresa e o e-mail continuam no login).

**Antes de enviar (na tela, sem chamar a API):** com falta na regra ou senhas diferentes, liga `destacar` (as faltas e a linha de
conferência ficam vermelhas) e não envia. Nada de texto extra no topo: a lista já diz o que falta.

**Respostas da API (aviso no topo da tela, `Notice tone="danger"` no BKO, `Banner tone="danger"` no app):**
| Resposta | Texto | Depois |
|---|---|---|
| 422 `RN-CORE-32` | a frase de `mensagemDaSenha(detalhes.faltas)` (portal-entrar.md §5), ou **"A senha não pode ser igual ao e-mail."** | `destacar` ligado; os campos ficam como estão, para a pessoa corrigir |
| 422 `RN-CORE-34` | **"A senha nova precisa ser diferente da senha que você recebeu."** | limpa os dois campos, foco no primeiro |
| 401 `CREDENCIAIS_INVALIDAS` (a senha usada mudou nesse meio-tempo) | **"Esta senha não vale mais. Entre de novo."** | volta ao login com o texto lá |
| 410 `SENHA_TEMPORARIA_VENCIDA` | o texto do §1 | volta ao login com o texto lá |
| 423 / 429 / 403 `PERFIL_FORA_DO_APP` | os textos do login, iguais | volta ao login com o texto lá |
| sem internet | **"Conecte-se à internet para criar a sua senha."** | fica; o botão continua ativo e tenta de novo |

Sem internet já ao abrir (o app sabe): o mesmo texto em `Banner tone="warning"` (ícone `wifiOff`) no topo, antes do título.
O botão não fica desabilitado por isso (se a detecção errar, a pessoa não fica presa).

**Sucesso:** entra direto (a resposta já é a sessão) e vai à tela inicial do perfil, com o aviso no rodapé **"Senha criada."**
(`AvisoRodape` no app, `useToast` no BKO; sem Desfazer). Vibração leve de confirmação no app.

## 3. "Esqueci a senha" — app e BKO
No app é a `TelaEsqueciSenha` (`modules/core/app`); no BKO, a página do engenheiro-apps na moldura do login.

**Pedido** (de cima para baixo):
1. Título **"Esqueci a senha"**.
2. Instrução (14, `ink-2`): **"Informe o código da empresa e o seu e-mail. Vamos mandar uma senha temporária para o seu e-mail."**
3. Campo **"Código da empresa"** e campo **"E-mail"** (`type="email"`, `autoComplete="username"`), já preenchidos com o que veio
   do login. Foco no primeiro vazio.
4. Botão principal **"Enviar senha temporária"** (enviando: **"Enviando…"**).
5. Botão link **"Voltar ao login"**.

**Confirmação** (a mesma tela troca de estado; vale para 202, exista ou não o e-mail):
1. Título **"Esqueci a senha"** (igual).
2. Aviso `Notice tone="info"` (BKO) / `Banner tone="info"` (app), com ícone de envelope ou informação, região viva educada:
   **"Se o e-mail estiver cadastrado nesta empresa, você vai receber uma senha temporária em alguns minutos. Ela vale por 72
   horas."**
3. Linha (13, `ink-2`): **"Não chegou? Confira o spam ou fale com o administrador da sua empresa."**
4. Botão principal **"Voltar ao login"** (único botão; o login volta com o código e o e-mail preenchidos).
Nunca "Enviamos para <e-mail>", nunca verde de sucesso: o texto e o tom são os mesmos em todos os casos.

**Erros** (embaixo do botão, como no login):
| Quando | Texto |
|---|---|
| campo vazio | **"Informe o código da empresa e o e-mail."** |
| e-mail sem formato | **"Informe um e-mail válido, como nome@empresa.com.br."** |
| 429 `MUITAS_TENTATIVAS` | **"Muitos pedidos seguidos. Tente de novo em <n> minutos."** (`n = ceil(retry_after_s / 60)`, mínimo 1; com 1: **"em 1 minuto"**) |
| sem internet | **"Conecte-se à internet para pedir uma senha temporária."** |
| 5xx / outro | **"Não foi possível pedir agora. Tente de novo em alguns minutos."** |

## 4. Kit: `RegrasDaSenha` com "Repita a senha" (feito, T-0094)
Nova prop opcional **`repeticao: 'vazia' | 'igual' | 'diferente'`** (web e mobile; tipo `RepeticaoSenha`). **A tela compara**; o
kit continua sem receber senha nenhuma:
```ts
const repeticao = repetida === '' ? 'vazia' : repetida === senhaNova ? 'igual' : 'diferente';
<RegrasDaSenha faltas={faltas} minimo={SENHA_MIN_CARACTERES} resumo={mensagemDaSenha(faltas)} repeticao={repeticao} destacar={tentouSalvar} id="senha-regras" />
```
- Uma linha **fora** da lista "A senha precisa ter", logo abaixo dela, com a mesma marca de forma:
  - `igual` → ✓ verde **"As senhas conferem."**
  - `diferente` → círculo vazio, `ink-2`, **"As senhas não conferem."** enquanto digita; ✕ vermelho, semibold, depois de tentar
    salvar (`destacar`);
  - `vazia` → nada enquanto digita; ✕ vermelho **"Repita a senha nova."** depois de tentar salvar.
- Sem `repeticao` (portal, formulário de Usuários) o componente fica como era.
- Leitor de tela: a região viva (web) e o rótulo falado (TalkBack) juntam as duas frases: "Falta um número. As senhas não
  conferem." No web a linha tem `id="<id>-repeticao"` para o `aria-describedby` do campo "Repita a senha".
- Exportados também: `CAMPO_SENHA_NOVA`, `CAMPO_REPITA_A_SENHA`, `TEXTO_REPETICAO_SENHA`, `itemDaRepeticao`,
  `resumoComRepeticao`. Testes: `packages/ui/src/comum/senha.test.ts` e `packages/ui/src/web/senha.test.ts`.

## 5. BKO · Usuários (`modules/core/web/components/usuarios/usuarios-page.tsx`)
**Formulário "Novo usuário"**
- O campo "Senha inicial (8+ caracteres, com letras e números)" vira **"Senha inicial"** (`type="password"`,
  `autoComplete="new-password"`, olho "Mostrar senha"/"Esconder senha").
- Ao lado do campo, botão secundário pequeno **"Gerar senha"**: preenche o campo (`crypto.getRandomValues`, mesma regra do
  `gerarSenhaTemporaria`) e liga o "Mostrar senha" para o admin ver o que foi gerado.
- `RegrasDaSenha` logo abaixo (sem `repeticao`), `destacar` depois de tentar salvar com falta.
- Ajuda (12, `ink-2`) embaixo da lista: **"Ela vai para o e-mail da pessoa, que cria a dela no primeiro acesso. Vale por 72
  horas."**
- "Editar usuário" não tem campo de senha (a senha muda só por "Redefinir senha").

**Depois de salvar** (`email_acesso`):
- `enfileirado` → aviso no rodapé (`useToast`): **"Usuário criado. O acesso vai para <e-mail> em alguns minutos."**
- `indisponivel` → `Notice tone="warning"` fixo no topo da lista (fecha no X), mostrando a senha **uma vez**:
  **"Usuário criado, mas não conseguimos enviar o e-mail. Passe a senha à pessoa: <senha>. Ela cria a dela no primeiro
  acesso."** com botão secundário pequeno **"Copiar senha"**. A senha vem da memória do formulário, some ao fechar o aviso ou sair
  da página, nunca vai a storage, URL ou log.

**Etiquetas na lista** (`Badge`, coluna de situação, depois de "Ativo"/"Inativo"; sempre com texto):
| Estado (`UsuarioItem`) | Etiqueta | Tom |
|---|---|---|
| `trocar_senha` e `senha_expira_em` futura | **"Troca de senha pendente · vence em 09/11 às 14:30"** (fuso do tenant) | `warning` |
| `trocar_senha` e `senha_expira_em` passada | **"Senha temporária vencida"** | `danger` |
| `trocar_senha` sem `senha_expira_em` (admin inicial, P5) | **"Troca de senha pendente"** | `warning` |
| `sem_senha` | **"Sem senha"** | `neutral` |

**Ações da linha** (no menu da linha de hoje; o botão "Senha" atual sai):
- **"Redefinir senha"**: para todos, **menos** admin e o próprio usuário (P7). Também para "pendente" e "vencida" (é como
  reenviar).
- **"Enviar acesso"**: no lugar do "Redefinir senha" quando `sem_senha`.

**Diálogo "Redefinir senha"** (`Dialog`):
- Título **"Redefinir a senha de <nome>?"**
- Texto (14): **"A pessoa recebe a senha nova por e-mail e cria a dela no próximo acesso. Ela sai do Macuxi agora em todos os
  aparelhos."**
- Campo **"Senha nova"** com olho, **"Gerar senha"** e `RegrasDaSenha` (como no formulário).
- Botões: **"Cancelar"** (secundário) e **"Redefinir senha"** (principal; enviando: **"Redefinindo…"**).
- Resultado: `enfileirado` → toast **"Senha redefinida. A senha nova vai para <e-mail> em alguns minutos."**; `indisponivel` →
  o mesmo `Notice` do criar: **"Senha redefinida, mas não conseguimos enviar o e-mail. Passe a senha à pessoa: <senha>. Ela cria a
  dela no próximo acesso."** + "Copiar senha".
- Sai o texto atual "Senha redefinida e sessões encerradas. Passe a nova senha ao usuário por um canal seguro."
- Erros da API: 422 `RN-CORE-32` → a frase do §5 do portal-entrar.md embaixo do campo; 403 (alvo admin ou o próprio, se chegar)
  → **"Esta senha não pode ser redefinida aqui. O administrador usa "Esqueci a senha"."**

**Diálogo "Enviar acesso"** (pessoa "Sem senha"; corpo sem senha, o servidor gera):
- Título **"Enviar acesso para <nome>?"**
- Texto: **"O Macuxi gera uma senha temporária e manda para <e-mail>. A pessoa cria a dela no primeiro acesso."**
- Botões: **"Cancelar"** e **"Enviar acesso"** (principal; enviando: **"Enviando…"**).
- `enfileirado` → toast **"Acesso enviado para <e-mail>."**; `indisponivel` → `Notice tone="warning"`: **"Não conseguimos enviar o
  e-mail. Use "Redefinir senha" para definir uma senha e passá-la à pessoa."**

## 6. Equipe por CSV (T-0087 E, sem convite)
> **Revisto em 14/11/2026:** onde conflitar, vale `docs/design/telas/portal-config-enxuto.md` §12: a Equipe por CSV saiu do portal inteira (RD-0275 a RD-0278); esta seção fica só como registro.

- Resultado do "Gravar": **"<n> acessos enviados por e-mail."** (1: **"1 acesso enviado por e-mail."**; 0: a linha não aparece).
  Saem a lista e o CSV de convites.
- 503 `EMAIL_INDISPONIVEL` (antes de gravar): **"O envio de e-mail não está configurado, e nada foi gravado. Fale com o suporte
  da Macuxi."** (`Notice tone="danger"`; o "Conferir" continua funcionando).

## 7. Portal `config.`
> **Revisto em 14/11/2026:** onde conflitar, vale `docs/design/telas/portal-config-enxuto.md` §1, §4 e §12: senha a trocar = só "Crie a sua senha no backoffice antes de entrar aqui." (RD-0264); passo Empresa = só "Passe esta senha ao administrador."; o cartão Equipe saiu (RD-0275); Redefinir senha dos admins: sucesso "Senha temporária enviada para {e-mail}." (RD-0291).

- 403 `SENHA_A_TROCAR` no Entrar (`entrar.erro`): **"Crie a sua senha no backoffice antes de entrar aqui. Use o código da
  empresa, o e-mail e a senha que você recebeu."**
- Linha do Entrar (portal-entrar.md §1, item 8): passa a **"Esqueceu a senha? Use "Esqueci a senha" no backoffice."**
- Passo Empresa (portal-entrar.md §6, item 5): **"Passe esta senha ao administrador. No primeiro acesso ao backoffice, ele cria a
  dele."**
- Cartão Equipe: sai a lista de convites. Cabeçalho (aprovado na revisão da W, 08/11): "Usuários do app e do backoffice, uma
  pessoa por linha: … Ninguém recebe senha no arquivo: cada pessoa nova recebe uma senha temporária por e-mail e cria a dela no
  primeiro acesso." ("backoffice" por extenso, nunca "BKO" na tela).
- Links de convite antigos (`/convite`, aprovado na revisão da W, 08/11): título **"Este link não vale mais"**; `Notice
  tone="info"` **"Agora o acesso chega por e-mail, com uma senha temporária. Se ela não chegou, use "Esqueci a senha" na tela de
  entrada ou fale com o administrador da sua empresa."**; botão principal **"Ir para o login"** (igual ao "Voltar ao login").

**Notas da revisão da W (08/11):**
- No app, o `Banner` do kit não tem o tom `info`: a confirmação do "Esqueci a senha" usa a caixa no tom `accent` (`accentSoft` /
  `accentInk`, ícone `send`, região viva educada). Aceito; nunca verde.
- Contraste do link de texto: `accent` (#C2540A) sobre o fundo `ground` (#F3F4F1) dá 4,17:1, abaixo de 4,5:1 para 14/600 (sobre
  branco dá 4,60:1). Pendência do designer-ux depois do build: links de texto sobre `ground` passam a `accent-ink` (#8F3D06,
  6,70:1) no kit (web `Button variant="link"` e um `LinkTexto` mobile), sem mudar a identidade.
  **Feito em 08/11 (T-0094):** `Button variant="link"` e `LinkTexto` no kit em `accentInk`; regra e razões em
  `docs/design/componentes.md` §1.1. As telas de senha do Core (`tela-login.tsx`, `tela-esqueci-senha.tsx`,
  `tela-crie-sua-senha.tsx`) e o `login.tsx` do shell ainda escrevem `colors.accent` em texto: lista entregue ao gerente-projetos para despacho aos donos.

## 8. E-mails (modelos da N5, `packages/platform-sdk/src/email/**`)
Texto puro obrigatório; HTML opcional com **o mesmo texto**, uma coluna de até 560 px, fundo branco, Archivo no título e
IBM Plex Sans (com Arial de reserva) no corpo, a senha em monoespaçada 18 px num quadro `#F3F4F1` (fácil de copiar, sem espaço
antes ou depois). Sem imagem obrigatória, sem botão que dependa de imagem. Remetente: **"Macuxi FDV"**.

**"Onde entrar"**, montado de `dados.apps` na ordem campo, gestão, web, unido com " ou ":
- `campo` → "no app Macuxi Campo"; `gestao` → "no app Macuxi Gestão"; `web` → "no backoffice do Macuxi, pelo navegador".
- Se a N5 souber o endereço do backoffice (variável de ambiente), o `web` vira "no backoffice do Macuxi: <endereço>". Opcional.
- Com `campo` ou `gestao` na lista, acrescenta a linha: "Ainda não tem o app? Peça ao administrador da sua empresa."

### 8.1 "Seu acesso ao Macuxi" (`acesso_inicial`)
Assunto: **Seu acesso ao Macuxi**
```
Olá, {nome}.

Seu acesso ao Macuxi na {empresa_nome} está pronto.

Código da empresa: {codigo_empresa}
E-mail: {login}
Senha temporária: {senha}

Entre {onde_entrar}.
[Ainda não tem o app? Peça ao administrador da sua empresa.]

No primeiro acesso, você cria a sua senha. A senha temporária vale por {validade_horas} horas.
Se ela vencer, use "Esqueci a senha" na tela de entrada.

Macuxi FDV · e-mail automático, não responda.
```
`validade_horas = null` (não vence): sai a frase da validade e a do "Se ela vencer"; fica "No primeiro acesso, você cria a sua
senha."

### 8.2 "Sua nova senha" (`nova_senha`)
Assunto: **Sua nova senha do Macuxi**
```
Olá, {nome}.

{abertura}

Código da empresa: {codigo_empresa}
E-mail: {login}
Senha temporária: {senha}

Entre {onde_entrar} e crie a sua senha. A senha temporária vale por {validade_horas} horas.

{fecho}

Macuxi FDV · e-mail automático, não responda.
```
| `motivo` | `{abertura}` | `{fecho}` |
|---|---|---|
| `esqueci` | "Recebemos um pedido de senha nova para o seu acesso na {empresa_nome}." | "Se não foi você, ignore este e-mail: a sua senha atual continua valendo." |
| `redefinida` | "O administrador da {empresa_nome} definiu uma senha nova para você." | "A senha anterior não vale mais." |
| `redefinida`, pelo portal (`redefinida_por = 'macuxi'`) | "O suporte da Macuxi definiu uma senha nova para o seu acesso na {empresa_nome}." | "A senha anterior não vale mais." |

Variante do portal aprovada em 08/11 (R-20261108-071559, `packages/platform-sdk/src/email/modelos.ts`). Admin que entra só pelo
app (RN-CORE-35, `entra_no_portal = false`): `dados.apps` sem `web`, e `{onde_entrar}` sai só com o app ("no app Macuxi Campo").

Regras dos dois: nunca o hash, o id nem o link com a senha; a senha aparece **uma vez**, só no corpo. Nada de "Clique aqui".
Sem `nome` (vazio): "Olá." Valores de `dados` escapados no HTML.

## 9. Checklist da revisão (fatias W e C)
- "Crie sua senha": nada abre antes; um só principal ("Salvar e entrar"); olho mostra os dois campos; `RegrasDaSenha` com
  `repeticao`; a senha usada no login só na memória da tela.
- "Esqueci a senha": confirmação sempre igual, em `info`, nunca com o e-mail digitado; 429 com minutos.
- Login: link "Esqueci a senha" ≥ 44 px; `SENHA_A_TROCAR` navega, não mostra texto; vencida com o texto do §1.
- Usuários: "Gerar senha", etiquetas com texto e tom do §5, "Redefinir senha" escondido para admin e para o próprio, senha
  exibida só no aviso de e-mail indisponível.
- Alvos ≥ 44 px, contraste ≥ 4,5:1, foco visível, os textos acima sem variação.

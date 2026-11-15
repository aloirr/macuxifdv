# Portal `config.` — Entrar, Escolha a empresa, admin inicial e regras da senha (T-0093)

> 2026-11-07 · designer-ux · fatia U do desenho [`docs/desenho/T-0093.md`](../desenho/T-0093.md) (§2, §6, §8) · regras: RN-CORE-32,
> RN-CORE-33, RN-CORE-34 · ADR 0031. Telas: `apps/web/components/portal/*` (engenheiro-apps, fatia W). Kit: `RegrasDaSenha` em
> `packages/ui/src/web/senha.tsx` e `packages/ui/src/mobile/senha.tsx` (parte pura em `packages/ui/src/comum/senha.ts`).
>
> **Tom (pedido do dono do produto): simples, sem explicação longa.** Nada de "convite", "código", "aplicativo autenticador",
> "super-admin" ou "2º fator" na tela. Uma frase por aviso; o erro diz o que fazer.

## 1. Entrar (`/entrar`)
> **Revisto em 14/11/2026:** onde conflitar, vale `docs/design/telas/portal-config-enxuto.md` §1 (RD-0264: senha a trocar = só "Crie a sua senha no backoffice antes de entrar aqui.").

De cima para baixo, na `MolduraEstreita` de hoje:
1. Título **"Entrar"** (28/800, Archivo).
2. ~~Subtítulo "Portal de implantação Macuxi"~~ — **sai** (revisão da fatia W, 07/11): a marca logo acima do cartão já diz
   "Portal de implantação · Macuxi FDV"; repetir é ruído.
3. Aviso de sessão terminada, quando a guarda mandou para cá (`Notice tone="info"`): **"Sua sessão terminou. Entre de novo."**
4. Erro (`Notice tone="danger"`, `data-testid="entrar.erro"`), só depois de tentar.
5. Campo **"E-mail"** (`type="email"`, `autoComplete="username"`, foco inicial).
6. Campo **"Senha"** (`type="password"`, `autoComplete="current-password"`) com o botão do olho à direita, dentro do campo:
   `aria-label` **"Mostrar senha"** / **"Ocultar senha"** (`MOSTRAR_SENHA`/`OCULTAR_SENHA` do kit; campo único: `CampoSenha`, docs/design/campo-senha/spec.md), alvo ≥ 44 px.
   **Sem** a lista de regras aqui: o login aceita a senha já gravada (RN-CORE-32 vale só ao criar e trocar).
7. Botão principal **"Entrar"** (enviando: **"Entrando…"**, desabilitado). Um só principal.
8. Linha pequena (12, `text-ink-2`): **"Esqueceu a senha? Fale com a Macuxi."** (sem link; não há recuperação no portal nesta tarefa).

**Sai:** "Continuar", "Primeiro acesso", o link do convite, as telas do código de 6 dígitos e de recuperação, o QR e o texto
"Acesso só do super-admin…". O e-mail fica no campo depois do erro; a senha é limpa.

## 2. Escolha a empresa (admin do cliente com 2+ empresas)
> **Revisto em 14/11/2026:** onde conflitar, vale `docs/design/telas/portal-config-enxuto.md` §2 (RD-0265: sai a instrução "Seu acesso vale para estas empresas.").

Mesma `MolduraEstreita`. Aparece depois do login (`empresa: null`, `empresas: [A, B…]`) e no "Trocar de empresa".
1. Título **"Escolha a empresa"**.
2. Instrução (13, `text-ink-2`): **"Seu acesso vale para estas empresas."**
3. Lista (ordem que a API manda: nome da empresa). Cada item é **um botão de linha inteira** (≥ 52 px de altura, cartão
   `border-line`, raio 12, foco visível):
   - nome da empresa (15/600, `text-ink`) e, embaixo, o código (12, `text-ink-2`);
   - à direita, `IconChevronRight`;
   - na volta pelo "Trocar de empresa", a empresa atual leva o selo `Badge tone="neutral"` **"Atual"** (tocar nela volta para
     ela sem novo pedido);
   - `aria-label`: **"Entrar em <nome>"** (e **"Entrar em <nome>, empresa atual"**);
   - tocando: o item mostra **"Entrando…"** no lugar do chevron e a lista fica sem toque até a resposta.
4. Rodapé: botão link **"Sair"**.

Com **1 empresa**, a tela não aparece: entra direto. O **time da Macuxi** não vê esta tela: segue para "Empresas", como hoje.

## 3. Trocar de empresa
> **Revisto em 14/11/2026:** onde conflitar, vale `docs/design/telas/portal-config-enxuto.md` §0 (RD-0261: o nome da empresa atual sai do cabeçalho e fica só no título da página; RD-0260: fica só "Sessão até 14:32"; MC-0022/MC-0023: o cabeçalho é a faixa Azul noite).

- No cabeçalho do portal (`MolduraPortal`), só para o admin do cliente: à esquerda do "Sair", o **nome da empresa atual**
  (13/600, `text-ink`, corta com "…") e, se ele tiver 2+ empresas, o botão secundário pequeno **"Trocar de empresa"**.
- Tocar abre a "Escolha a empresa" (§2). Com dados não salvos, passa antes pela confirmação de saída que já existe.
- Para o admin do cliente, a marca do portal e o "voltar" levam para a página da empresa atual (não há lista "Empresas" para ele).
  "Nova empresa" não aparece (RN-CORE-33: criar empresa é do time da Macuxi).
- A marca (cabeçalho e telas estreitas) é **"Portal de implantação"** com **"Macuxi FDV"** embaixo: o cliente também entra.
- "Sair" e "Trocar de empresa" com a mesma altura (alvo de 44 px); o "Sair" da Escolha a empresa (botão link) também.
- Sai do cabeçalho o selo dos códigos de recuperação. Fica "Sessão até 14:32 · encerra após 15 min sem uso".

## 4. Erros e avisos (textos aprovados)
| Quando | Onde | Texto |
|---|---|---|
| Campo vazio ao tocar Entrar | `entrar.erro` | "Informe o e-mail e a senha." |
| 401 `CREDENCIAIS_INVALIDAS` (e-mail inexistente, senha errada, sem empresa) | `entrar.erro` | "E-mail ou senha incorretos." |
| 423 bloqueio (5 erros em 15 min, também para e-mail inexistente) | `entrar.erro` | "Muitas tentativas erradas. Espere 15 minutos e tente de novo." |
| 429 limite por IP | `entrar.erro` | "Muitas tentativas deste endereço. Espere alguns minutos e tente de novo." |
| 401 `SESSAO_EXPIRADA` / token antigo sem `typ` | aviso no Entrar | "Sua sessão terminou. Entre de novo." |
| 403 `EMPRESA_NAO_PERMITIDA` | aviso `Notice tone="info"` no Entrar (1 empresa) | "Esta empresa não está mais disponível para você." |
| 403 `EMPRESA_NAO_PERMITIDA` | aviso `Notice tone="info"` na Escolha a empresa (2+); a empresa sai da lista | "A empresa <nome> não está mais disponível para você." |
| 409 `EMPRESA_NAO_ESCOLHIDA` | vai para a Escolha a empresa, sem aviso | — |
| 503 `PORTAL_INDISPONIVEL` | `entrar.erro` | o `MENSAGEM_PORTAL_SEM_SEGREDOS` de hoje (é para quem opera o servidor) |
| Sem rede | `entrar.erro` | o `MENSAGEM_SEM_CONEXAO` de hoje |

O 403 é `info`, como o "Sua sessão terminou": não é erro de quem usa e não há o que corrigir. Na Escolha, a empresa do 403 não
fica na lista (nem como "Atual"): tocar nela de novo daria o mesmo 403.

A frase do 401 é a mesma em todos os casos (sem revelar se o e-mail existe). A API pode mandar "E-mail ou senha incorretos.
Confira e tente de novo." (desenho §3): a tela mostra a do quadro.

## 5. Regra da senha (RN-CORE-32) — textos e componente
**Ajuda curta** (`REGRA_DA_SENHA` do `@macuxi/core/contracts`; substitui a de `apps/web/lib/convite.ts`):
**"Pelo menos 8 caracteres, com letra, número e caractere especial."**

**Mensagens do domain** (`mensagemDaSenha(faltas)` do Core, a única fonte da frase; a tela a passa no `resumo` do
`RegrasDaSenha` e o kit não monta frase própria, RD-0021):
| Faltas | Texto |
|---|---|
| nenhuma | "A senha atende às regras." (só a região viva do kit; o domain não devolve mensagem) |
| `numero` | "Falta um número." |
| `letra` | "Falta uma letra." |
| `especial` | "Falta um caractere especial." |
| `numero`, `especial` | "Faltam um número e um caractere especial." |
| `letra`, `numero`, `especial` | "Faltam uma letra, um número e um caractere especial." |
| `caracteres` | "A senha precisa ter pelo menos 8 caracteres." |
| `caracteres` + outras | "A senha precisa ter pelo menos 8 caracteres. Falta um número." / "A senha precisa ter pelo menos 8 caracteres. Faltam uma letra, um número e um caractere especial." |
| igual ao e-mail | "A senha não pode ser igual ao e-mail." |
| mais de 200 | "A senha pode ter até 200 caracteres." |
Regra da frase: ordem fixa (caracteres, letra, número, especial); "Falta" com uma, "Faltam" com duas ou mais; lista com vírgulas e
"e" antes da última. É o que o `mensagemDaSenha` do Core já faz (conferido em 07/11): só a ajuda curta muda (acima).
O caso "mais de 200" só o Core distingue (`mensagemDaSenha(faltas, senha)`); a tela que quiser cobri-lo passa
`resumo={mensagemDaSenha(faltas, senha) ?? SENHA_ATENDE_AS_REGRAS}`.

**Componente `RegrasDaSenha`** (web e mobile, mesma API):
```tsx
<RegrasDaSenha faltas={faltas} minimo={SENHA_MIN_CARACTERES} resumo={mensagemDaSenha(faltas)} destacar={tentouSalvar} id="senha-regras" />   // web; mobile usa testID
// RD-0021: `minimo` e `resumo` são obrigatórios e vêm do Core; `resumo` null (nada falta) = "A senha atende às regras."
```
- Título **"A senha precisa ter"** e quatro linhas, sempre nesta ordem: **"8 caracteres ou mais"**, **"Uma letra"**,
  **"Um número"**, **"Um caractere especial (! @ # $)"**.
- Cada linha muda **de forma**, não só de cor: cumprida = ✓ verde num círculo (`success`); faltando = círculo vazio cinza e
  texto `ink-2` (neutro: não brigar com quem ainda está digitando); com `destacar` (tentou salvar com falta) = ✕ vermelho e
  texto `danger` em semibold.
- Leitor de tela: web — cada linha diz "<regra>: ok" ou "<regra>: falta" (os símbolos do exemplo não são lidos) e uma região
  viva educada lê o resumo quando ele muda ("Falta um número."); ligue o campo com `aria-describedby="senha-regras"`.
  Mobile (TalkBack) — a lista é um elemento só, com o resumo como rótulo, em região viva educada.
- O kit **não confere a senha nem a recebe**: a tela chama `faltasNaSenha` do Core a cada tecla e entrega as faltas. Pode passar
  `resumo={mensagemDaSenha(faltas)}` para usar a frase do Core.
- Onde usar: passo Empresa (§6), formulário de usuário do BKO, aceite do convite da Equipe e as telas da T-0094
  ("Crie sua senha", troca no 1º uso, Esqueci a senha). Nunca no login.
- **T-0094:** o aceite do convite sai; a "Crie sua senha" usa a prop nova `repeticao` (item "As duas senhas iguais", abaixo da
  lista). Textos do ciclo de senha, do item 8 do §1 e do item 5 do §6 atualizados em [`ciclo-de-senha.md`](ciclo-de-senha.md) §7.

## 6. Passo Empresa — administrador da empresa (RN-CORE-34)
Novo bloco `Panel` depois dos dados da empresa e antes dos módulos:
1. Título **"Administrador da empresa"**.
2. Ajuda (13, `text-ink-2`): **"É o primeiro acesso da empresa. Ele cria os outros usuários no BKO."**
3. Campos: **"Nome"**, **"E-mail"** (`autoComplete="off"`), **"Senha inicial"** (`type="password"`,
   `autoComplete="new-password"`, botão do olho "Mostrar senha"/"Ocultar senha", `aria-describedby` da lista).
4. `RegrasDaSenha` logo abaixo do campo de senha, ao vivo; `destacar` depois de tocar Conferir/Gravar com falta.
5. Embaixo da lista (12, `text-ink-2`): **"Passe esta senha ao administrador."** Com a T-0094, acrescenta-se **"Ele troca no
   primeiro acesso."**
- **Empresa existente:** os campos não aparecem; no lugar, **"Esta empresa já tem administrador. A senha dele não muda aqui."**
- **Erros da API:** 422 `RN-CORE-34` → **"Informe o administrador da empresa."** no topo do bloco; 422 `RN-CORE-32` → a mensagem
  do §5 (de `detalhes.faltas`) embaixo do campo de senha e `destacar` ligado. Campo vazio no envio: **"Informe o nome."**,
  **"Informe o e-mail."**, **"Informe a senha inicial."** Formato: **"Informe o nome, de 2 a 120 caracteres."** e
  **"Informe um e-mail válido, como nome@empresa.com.br."** O erro embaixo do campo some quando a pessoa volta a digitar nele
  (a lista das regras segue ao vivo; erro velho embaixo de uma lista toda verde confunde).
- **Resultado** (resumo depois de gravar): `admin: 'criado'` → **"Administrador criado: <e-mail>."**; `'existente'` →
  **"Administrador mantido: a senha não mudou."** No Conferir (nada gravado): **"Administrador que será criado: <e-mail>."** e
  **"Administrador mantido: a senha não muda."**
- A senha nunca vai ao `sessionStorage`, à URL nem a log; o campo é limpo depois de gravar.

## 7. Checklist da revisão (fatia W)
- Entrar: só e-mail, senha e Entrar; nenhuma palavra de convite/código/TOTP em `apps/web` (exceto a Equipe, P4).
- Um só botão principal por tela; alvo ≥ 44 px (olho, itens da lista, Trocar de empresa); foco visível.
- Contraste ≥ 4,5:1 nos textos (o círculo vazio é decorativo: o estado está no texto falado e na forma).
- 1 empresa entra direto; 2+ mostra a lista com nome e código; "Trocar de empresa" só com 2+.
- Os textos acima, sem variação.

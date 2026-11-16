# Trocar senha — Perfil do Campo e do Gestão

> **Tipografia substituída** pela fonte do sistema (R-20261115-110600, 15/11/2026): ver o [manual da marca §5](../../marca/manual.md#5-tipografia).

> 2026-11-15 · designer-ux · pedido aprovado pelo dono do produto (R-20261115-104500). Implementada na T-0178 (#357 e #370).
> Telas: [`telas.html`](telas.html) · PNGs em [`png/`](png/) (gerados por [`gerar-png.cjs`](gerar-png.cjs)).
> Decisão R-20261115-115500 (dono do produto): a tela tem o link **"Esqueci a senha"**, que leva ao fluxo que já existe no Core (§6).
> Regras: RN-CORE-32 e RN-CORE-34, sem regra nova (funções no §10 item 1). Base: [`ciclo-de-senha.md`](../ciclo-de-senha.md) §2 ("Crie sua senha") e
> [`campo-senha/spec.md`](../campo-senha/spec.md) (o olho).

## 1. Campo e Gestão
A mesma tela nos dois apps. O tema é um só (`packages/ui/src/mobile/tokens.ts`, marca v1: faixa Azul noite, fundo Pérola); pelo
manual da marca (`docs/marca/manual.md` §6), Campo e Gestão mudam só o ícone e o splash. Por isso não há variante: os PNGs mostram
o Campo (Lucas, vendedor); no Gestão muda só quem aparece no topo do Perfil e as abas.

## 2. Entrada (PNG 01)
- **Perfil** (`apps/mobile/src/app/profile.tsx`, Campo e Gestão): seção **"Conta"** (`SectionHeader`), logo abaixo do bloco de quem
  está no app e antes de "Sincronização", com uma linha em cartão: ícone `lock` (`accent`), **"Trocar senha"**, `chevron`.
  Linha de 52 dp, toque na linha inteira, `testID` `perfil.trocar-senha`.
- Toque abre a tela "Trocar senha" (empilhada, avanço lateral 240 ms; sem barra de abas, por causa do teclado).
- Três toques: Perfil → Trocar senha → Salvar senha.

## 3. A tela, de cima para baixo (PNG 02 e 03)
1. **Cabeçalho na faixa** (`Screen` com `cabecalho={{ titulo: 'Trocar senha', voltar: { label: 'Perfil' } }}`). Sem subtítulo.
2. **Área de alertas** (só quando há aviso): um `Banner` no topo do corpo (§5). Nenhum aviso fora dela.
3. **"Senha atual"**: `CampoSenha` `finalidade="login"`, olho próprio, foco ao abrir, `returnKeyType="next"`.
   `testID` `trocar-senha.atual`.
4. **Link "Esqueci a senha"** logo abaixo do "Senha atual", alinhado à direita: o mesmo `Pressable` do login
   (`modules/core/app/components/tela-login.tsx`, `testID` `login.esqueci`) com os estilos `estilosDeAcesso.link` e
   `estilosDeAcesso.linkTexto` (`modules/core/app/components/estilos-de-acesso.ts`: 14/600 `accentInk`, alvo de 48 dp) e
   `alignSelf: 'flex-end'`. `accessibilityRole="button"`, rótulo "Esqueci a senha". Um alvo só, sem texto extra.
   `testID` `trocar-senha.esqueci`. Toque abre a tela do §6.
5. **"Senha nova"** (`CAMPO_SENHA_NOVA`): `CampoSenha` `finalidade="criacao"`, olho próprio. `testID` `trocar-senha.nova`.
6. **"Repita a senha"** (`CAMPO_REPITA_A_SENHA`): `CampoSenha` `finalidade="criacao"`, olho próprio, `returnKeyType="done"`
   (envia). `testID` `trocar-senha.repita`.
7. **`RegrasDaSenha`** logo abaixo dos campos, ao vivo a cada tecla: `faltas={faltasNaSenha(nova)}`,
   `minimo={SENHA_MIN_CARACTERES}`, `resumo={mensagemDaSenha(faltas, nova)}`, `repeticao={repeticaoDaSenha(nova, repetida)}`,
   `destacar` depois de tentar salvar. Já aparece ao abrir, com as quatro regras em aberto.
8. **Botão principal "Salvar senha"** (52 dp, o único principal), preso ao pé do conteúdo; enviando: **"Salvando…"**, desabilitado.
   `testID` `trocar-senha.salvar`.

Sem botão "Cancelar": o voltar da faixa (e o do Android) sai sem salvar e descarta as três senhas da memória.

**Os olhos** (PNG 03): cada um dos três campos tem o seu, independente (pedido: "todos com mostrar/ocultar"). Começam ocultos.
Leitor de tela: "Mostrar senha" / "Ocultar senha" (`rotuloDoOlhoDaSenha`). Alvo 48 × 48 dentro do campo de 52.

## 4. Antes de enviar (na tela, sem chamar a API) — PNG 04
Ao tocar em "Salvar senha", a tela confere com as funções do Core (`trocaProntaParaEnviar(nova, repetida)` e senha atual não
vazia). Se falhar, liga `destacar` e **não envia**:
- regra da RN-CORE-32 em falta → a regra fica com ✕ vermelho na lista;
- senhas diferentes → a linha da conferência fica **"As senhas não conferem."** com ✕ vermelho e o "Repita a senha" com borda
  `danger`; o foco vai para ele;
- senha atual vazia → borda `danger` no "Senha atual" e foco nele.
Sem `Banner` nesses casos: a lista já diz o que fazer (uma informação, um lugar).

## 5. Respostas e avisos (área de alertas)
| Situação | Aviso no topo | Campos |
|---|---|---|
| Senha atual errada (401 `CREDENCIAIS_INVALIDAS`) — PNG 05 | `Banner tone="danger"` ícone `alert`: **"A senha atual está errada. Digite de novo."** | limpa "Senha atual", borda `danger`, foco nele; as novas ficam |
| Senha nova fora da regra (422 `RN-CORE-32`) | nenhum (a lista mostra com `destacar`); se for igual ao e-mail: `Banner danger` **"A senha não pode ser igual ao e-mail."** | ficam como estão |
| Senha nova igual à atual (422 `RN-CORE-34`, §10 item 2) | `Banner danger`: **"A senha nova precisa ser diferente da atual."** | limpa as duas novas, foco em "Senha nova" |
| Sem internet (antes ou ao tentar) — PNG 06 | `Banner tone="warning"` ícone `wifiOff`: **"Conecte-se à internet para trocar a senha."** | ficam; o botão continua ativo e tenta de novo |
| 423 / 429 (bloqueio, muitas tentativas) | `Banner danger` com o mesmo texto do login | ficam |
| 5xx / outro | `Banner danger`: **"Não foi possível trocar agora. Tente de novo em alguns minutos."** | ficam |

**O link "Esqueci a senha" fica sempre no mesmo lugar**, em todos os estados (inclusive "senha atual errada", PNG 05, e sem
internet, PNG 06). O aviso de senha errada não cita o link: o caminho já está logo abaixo do campo (uma informação, um lugar).

Um aviso por vez: o novo substitui o anterior; digitar em qualquer campo apaga o aviso. `Banner` com `anunciar` (região viva).
Sem rede já ao abrir (o app sabe): o aviso aparece antes de tocar em Salvar; o botão não fica desabilitado por isso.

## 6. "Esqueci a senha" (PNG 08 e 09) — o fluxo que já existe
Nada novo: a mesma tela, a mesma rota e as mesmas regras do "Esqueci a senha" do login (`ciclo-de-senha.md` §3).
- **Tela**: `TelaEsqueciSenha` (`modules/core/app/components/tela-esqueci-senha.tsx`, exportada em `modules/core/app/index.ts`),
  com textos de `TEXTOS_ESQUECI` (`modules/core/contracts/ciclo-senha.ts`) e validação/erros de `modules/core/app/lib/senha.ts`
  (`validarEsqueci`, `erroDoEsqueci`).
- **Chamada**: `pedirSenhaTemporaria` → `POST /v1/auth/senha/esqueci` (`ROTA_ESQUECI_SENHA` em `modules/core/contracts/auth.ts`;
  `esqueciSenha` em `modules/core/api/autenticacao.ts`; rota pública em `modules/core/api/index.ts`): responde sempre 202, com
  limite por IP e por código + e-mail, e grava uma senha temporária **paralela** de 72 h (a atual continua valendo).
- **No login de hoje**: etapa `esqueci` em `apps/mobile/src/app/login.tsx` / `apps/mobile/src/lib/etapa-login.ts`.

Aqui ela abre empilhada sobre a "Trocar senha" (avanço lateral 240 ms), na faixa do app: voltar **"Trocar senha"**, título
**"Esqueci a senha"**. Dentro do app a tela é enxuta (§10 item 8, ajuste b): sem a instrução, sem o campo "Código da empresa"
(vem da sessão) e com o e-mail da sessão como texto fixo (rótulo "E-mail" e o endereço, sem caixa de edição); um toque em
**"Enviar senha temporária"** pede. A confirmação (PNG 09), em qualquer caso: **"Você vai receber uma senha temporária em alguns
minutos. Ela vale por 72 horas."** e, abaixo, o "Não chegou? Confira o spam ou fale com o administrador da sua empresa." do login.
O voltar da faixa leva de novo à "Trocar senha" (campos vazios). Erros, sem internet
(`semInternet`) e 429: os do §3 de `ciclo-de-senha.md`.

Depois, a senha temporária do e-mail entra no **"Senha atual"**: o `POST /v1/auth/senha/trocar` já aceita a atual ou a temporária
(`trocarSenha` em `autenticacao.ts`).

## 7. Sucesso (PNG 07)
Volta ao Perfil e mostra o `AvisoRodape` tom `sucesso`: **"Senha trocada."** (sem Desfazer), com vibração leve de confirmação. A
pessoa continua no app, neste aparelho. Nenhum texto sobre outros aparelhos ou sessões.

## 8. Textos novos
"Trocar senha" (título e linha do Perfil) · "Senha atual" · "Salvar senha" · "Salvando…" · "A senha atual está errada. Digite de
novo." · "A senha nova precisa ser diferente da atual." · "Conecte-se à internet para trocar a senha." · "Não foi possível trocar
agora. Tente de novo em alguns minutos." · "Senha trocada." · "Você vai receber uma senha temporária em alguns minutos. Ela vale
por 72 horas." (confirmação do "Esqueci a senha" dentro do app). Reaproveitados do kit e do Core: "Senha nova", "Repita a senha", "A
senha precisa ter", as quatro regras, "Esqueci a senha" (link do login e a tela inteira do §6, `TEXTOS_ESQUECI`), "As senhas conferem." / "As senhas não conferem.", "A senha não pode ser igual ao e-mail.".

## 9. Acessibilidade e sol
- Contraste: texto `ink` no branco 16,5:1; `ink2` 7,6:1 (7,0:1 no Pérola); branco no Azul noite 12,8:1; `danger` no `dangerBg` 6,0:1;
  `warningInk` no `warningBg` 9,0:1. Cor nunca sozinha: ✓/✕ e texto na lista; ícone e texto no aviso.
- Alvos: campos e botão 52 dp; olhos 48 × 48; link "Esqueci a senha" 48 dp de altura; linha do Perfil 52 dp. `accentInk` no Pérola: 11,8:1; no `accentSoft` da confirmação: 9,8:1.
- Ordem do leitor: alerta → Senha atual → olho → Esqueci a senha → Senha nova → olho → Repita a senha → olho → regras → Salvar senha.
- Movimento: avanço lateral 240 ms; escala 0,97 no toque; tudo respeita "reduzir movimento".

## 10. Premissas
1. **Regras** (as do cabeçalho): as funções da RN-CORE-32 (`faltasNaSenha`, `mensagemDaSenha`, `validarSenhaInicial` com
   "≠ e-mail") e da RN-CORE-34 (`validarSenhaNova`, "não repetir a senha usada para entrar"), em
   `modules/core/contracts/senha-regra.ts` e `modules/core/domain/acesso-senha.ts`.
2. **Texto da RN-CORE-34, um só**: **"A senha nova precisa ser diferente da atual."**. Vale também quando a "Senha atual"
   digitada é a temporária, porque nesse caso a atual é a temporária.
3. **API**: a troca usa o `POST /v1/auth/senha/trocar` (código da empresa e e-mail da sessão, senha atual e nova;
   já audita `motivo: 'voluntaria'`) e devolve a sessão nova, que o app passa a usar. Por isso a pessoa continua no app depois
   de trocar.
4. **Senha atual errada conta como tentativa de login** (a rota é a do login): depois de várias, vale o bloqueio do login (423/429),
   com o texto dele.
5. **Três olhos independentes**, como pedido. Na "Crie sua senha" um olho mostra os dois campos novos; aqui cada campo tem o seu.
6. **Rótulo "Repita a senha"** (o do kit, `CAMPO_REPITA_A_SENHA`) no lugar de "confirmação", para ser igual à "Crie sua senha".
7. **Linha da conferência** com os textos aprovados de hoje. Se a proposta "As duas senhas iguais" (`campo-senha/spec.md` §4) for
   aprovada, ela vale aqui também, sem mudar a tela.
8. **"Esqueci a senha" dentro do app**: ajustes de apresentação na `TelaEsqueciSenha` (modulo-core), sem mudar a regra nem a
   rota: (a) o título vai para a faixa e a volta "Voltar ao login" (`TEXTOS_ESQUECI.voltar`) não aparece no pedido nem na
   confirmação, porque a faixa já tem o voltar; (b) dentro do app, sem
   `instrucao`, sem o campo "Código da empresa" (o código vem da sessão e vai no pedido) e com o e-mail da sessão como texto
   fixo, sem edição; a confirmação usa o texto do app (§6 e §8) e mantém o `naoChegou`.
9. **Só online**: sem fila offline; a senha nunca vai para storage, fila, URL ou log.

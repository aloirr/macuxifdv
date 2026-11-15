# Trocar senha — Perfil do Campo e do Gestão (simulação)

> 2026-11-15 · designer-ux · pedido aprovado pelo dono do produto (R-20261115-104500). **Simulação para aprovação**; a implementação
> (modulo-core na tela, engenheiro-apps na rota do shell) fica para depois da v1.0.12.
> Telas: [`telas.html`](telas.html) · PNGs em [`png/`](png/) (gerados por [`gerar-png.cjs`](gerar-png.cjs)).
> Regras: RN-CORE-32 e RN-CORE-34 (sem regra nova). Base: [`ciclo-de-senha.md`](../ciclo-de-senha.md) §2 ("Crie sua senha") e
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
4. **"Senha nova"** (`CAMPO_SENHA_NOVA`): `CampoSenha` `finalidade="criacao"`, olho próprio. `testID` `trocar-senha.nova`.
5. **"Repita a senha"** (`CAMPO_REPITA_A_SENHA`): `CampoSenha` `finalidade="criacao"`, olho próprio, `returnKeyType="done"`
   (envia). `testID` `trocar-senha.repita`.
6. **`RegrasDaSenha`** logo abaixo dos campos, ao vivo a cada tecla: `faltas={faltasNaSenha(nova)}`,
   `minimo={SENHA_MIN_CARACTERES}`, `resumo={mensagemDaSenha(faltas, nova)}`, `repeticao={repeticaoDaSenha(nova, repetida)}`,
   `destacar` depois de tentar salvar. Já aparece ao abrir, com as quatro regras em aberto.
7. **Botão principal "Salvar senha"** (52 dp, o único principal), preso ao pé do conteúdo; enviando: **"Salvando…"**, desabilitado.
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
| Senha nova igual à atual (422 `RN-CORE-34`) | `Banner danger`: **"A senha nova precisa ser diferente da atual."** | limpa as duas novas, foco em "Senha nova" |
| Sem internet (antes ou ao tentar) — PNG 06 | `Banner tone="warning"` ícone `wifiOff`: **"Conecte-se à internet para trocar a senha."** | ficam; o botão continua ativo e tenta de novo |
| 423 / 429 (bloqueio, muitas tentativas) | `Banner danger` com o mesmo texto do login | ficam |
| 5xx / outro | `Banner danger`: **"Não foi possível trocar agora. Tente de novo em alguns minutos."** | ficam |

Um aviso por vez: o novo substitui o anterior; digitar em qualquer campo apaga o aviso. `Banner` com `anunciar` (região viva).
Sem rede já ao abrir (o app sabe): o aviso aparece antes de tocar em Salvar; o botão não fica desabilitado por isso.

## 6. Sucesso (PNG 07)
Volta ao Perfil e mostra o `AvisoRodape` tom `sucesso`: **"Senha trocada."** (sem Desfazer), com vibração leve de confirmação. A
pessoa continua no app, neste aparelho. Nenhum texto sobre outros aparelhos ou sessões.

## 7. Textos novos (todos em português, para os contratos do Core)
"Trocar senha" (título e linha do Perfil) · "Senha atual" · "Salvar senha" · "Salvando…" · "A senha atual está errada. Digite de
novo." · "A senha nova precisa ser diferente da atual." · "Conecte-se à internet para trocar a senha." · "Não foi possível trocar
agora. Tente de novo em alguns minutos." · "Senha trocada.". Reaproveitados do kit e do Core: "Senha nova", "Repita a senha", "A
senha precisa ter", as quatro regras, "As senhas conferem." / "As senhas não conferem.", "A senha não pode ser igual ao e-mail.".

## 8. Acessibilidade e sol
- Contraste: texto `ink` no branco 16,5:1; `ink2` 7,6:1 (7,0:1 no Pérola); branco no Azul noite 12,8:1; `danger` no `dangerBg` 6,0:1;
  `warningInk` no `warningBg` 9,0:1. Cor nunca sozinha: ✓/✕ e texto na lista; ícone e texto no aviso.
- Alvos: campos e botão 52 dp; olhos 48 × 48; linha do Perfil 52 dp.
- Ordem do leitor: alerta → Senha atual → olho → Senha nova → olho → Repita a senha → olho → regras → Salvar senha.
- Movimento: avanço lateral 240 ms; escala 0,97 no toque; tudo respeita "reduzir movimento".

## 9. Premissas (para o dono do produto e o modulo-core)
1. **Regras**: as da RN-CORE-32 (`faltasNaSenha`, `mensagemDaSenha`, `validarSenhaInicial` com "≠ e-mail") e da RN-CORE-34
   (`validarSenhaNova`, "não repetir a senha usada para entrar"), em `modules/core/contracts/senha-regra.ts` e
   `modules/core/domain/acesso-senha.ts`. Nenhuma regra nova.
2. **Texto da RN-CORE-34**: hoje `validarSenhaNova` devolve "A senha nova não pode ser igual à senha temporária.", que não serve
   para a troca voluntária. A tela usa "A senha nova precisa ser diferente da atual." (texto novo no contrato do Core, pela
   implementação).
3. **API**: a troca pode usar o `POST /v1/auth/senha/trocar` de hoje (código da empresa e e-mail da sessão, senha atual e nova;
   já audita `motivo: 'voluntaria'`) e devolve a sessão nova, que o app passa a usar. Por isso a pessoa continua no app depois
   de trocar. Decisão final da rota: modulo-core / engenheiro-software.
4. **Senha atual errada conta como tentativa de login** (a rota é a do login): depois de várias, vale o bloqueio do login (423/429),
   com o texto dele.
5. **Três olhos independentes**, como pedido. Na "Crie sua senha" um olho mostra os dois campos novos; aqui cada campo tem o seu.
6. **Rótulo "Repita a senha"** (o do kit, `CAMPO_REPITA_A_SENHA`) no lugar de "confirmação", para ser igual à "Crie sua senha".
7. **Linha da conferência** com os textos aprovados de hoje. Se a proposta "As duas senhas iguais" (`campo-senha/spec.md` §4) for
   aprovada, ela vale aqui também, sem mudar a tela.
8. **Sem "Esqueci a senha" nesta tela**: quem não lembra a senha atual sai e usa o "Esqueci a senha" do login (a rota exige a senha
   atual). Se o dono do produto quiser o link aqui, entra como botão de texto abaixo do "Salvar senha".
9. **Só online**: sem fila offline; a senha nunca vai para storage, fila, URL ou log.

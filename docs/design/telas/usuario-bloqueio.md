# BKO › Acesso › Usuários: usuário bloqueado e "Desbloquear"

- **Pedido:** Alexandre, chat de 14/11/2026 ~20h40 (R-20261114-204000-alexandre): "Resetei a senha pelo BKO e funcionou. Não vi no BKO o botão desbloquear. Nem o aviso de que ele estava bloqueado. Corrija."
- **Base:** a tela Usuários refeita pelo modulo-core no PR #250 (branch `nuvem/acesso-bko-modulo-core`, `modules/core/web/components/usuarios/usuarios-page.tsx`), com a simulação já aprovada. Esta spec só acrescenta o selo de bloqueio e a ação "Desbloquear"; o resto da tela não muda.
- **Regras citadas:** `estadoDoLogin` e `registrarFalhaDeLogin` (`modules/core/domain/auth.ts`: 5 senhas erradas seguidas bloqueiam o login por 15 min); RN-CORE-15 (padrão de bloqueio/desbloqueio do aparelho, admin ou analista, com auditoria); RN-AUD-01; RN-VEN-42 e R-20261110-093124 ("uma informação, um lugar"); R-20261110-192153 ("só o que o usuário usa para agir"); revisão do BKO, `docs/design/telas/bko-revisao.md` §P3 (menu "⋯") e §P5 (um selo só), no branch `nuvem/bko-revisao-designer-ux`.
- **Quem implementa:** modulo-core (contrato, API, lib e tela). O designer-ux revisa a tela antes do merge.
- **Simulação:** `docs/design/telas/usuario-bloqueio/usuario-bloqueio.html` (`?estado=lista|menu|gaveta`); prints 1366×768 na mesma pasta.

## 1. Os três estados de quem não entra

O login já distingue (`EstadoLogin` em `modules/core/domain/auth.ts`):

| Estado no login | Origem no banco (`core.usuario`) | Selo na linha | Tom | Ação que resolve |
|---|---|---|---|---|
| `inativo` | `ativo = false` | **Inativo** (como no PR #250) | `neutral` | **Reativar** (já existe, com confirmação) |
| `bloqueado_admin` | `bloqueado_em` preenchido | **Bloqueado** | `danger` | **Desbloquear** |
| `bloqueado_tentativas` | `bloqueio_ate` no futuro | **Bloqueado até 20h55** | `warning` | **Desbloquear** |

- "Bloqueado até 20h55": a hora de `bloqueio_ate` no **fuso do tenant**, formato `HHhMM` (24 h, minutos com dois dígitos: "Bloqueado até 09h05"). Sem data: o bloqueio dura 15 min.
- **Inativo continua "Inativo"**, com "Reativar". Desativar é a ação do BKO para tirar o acesso de alguém; ela já aparece na tela aprovada, e trocar o nome dela mudaria uma tela já aprovada. "Desbloquear" **não reativa** usuário inativo.
- `tentativas_falhas` entre 1 e 4, sem `bloqueio_ate` no futuro: **nada aparece**. Isso não impede a pessoa de entrar.

## 2. Selo na linha (lista)

Print: `usuario-bloqueio/1-lista-bloqueado-1366x768.png`.

- **Um selo só por linha** (§P5), logo depois do nome, no mesmo lugar do "Inativo" do PR #250 (a tela aprovada não tem coluna Situação). Ordem quando vale mais de um: **Inativo > Bloqueado > Bloqueado até HHhMM**. Inativo vem primeiro porque, enquanto a pessoa estiver inativa, desbloquear não devolve o acesso; quem resolve é o "Reativar".
- Componente: `Badge` de `@macuxi/ui/web`, nos tons da tabela acima. O texto vai sempre junto da cor. Contraste: `warning` #7A4F00 sobre #FFF1D6 e `danger` #A8261B sobre #FDE8E6, os dois acima de 4,5:1.
- **O selo some sozinho quando `bloqueio_ate` passa.** A tela compara com a hora atual: ao montar, a cada atualização da lista e com um relógio de 1 min enquanto houver selo "Bloqueado até". Um bloqueio vencido não pode continuar com selo.
- Sem frase extra na linha nem aviso no topo da página. O selo é o aviso.
- A função que escolhe o selo fica na lib da tela, com teste: `seloDoUsuario(u, agora, fuso) → { tom, texto } | null` em `modules/core/web/lib/usuarios.ts`. Os casos: inativo + bloqueado, só admin, só tentativas, tentativas vencidas, 0 a 4 falhas, virada da meia-noite no fuso de Manaus.
- testID: `usuarios.selo.<id>`.

## 3. "Desbloquear" no menu "⋯" da linha

Print: `usuario-bloqueio/2-menu-desbloquear-1366x768.png`.

- Aparece só quando a linha tem o selo **Bloqueado** ou **Bloqueado até…**, e só para quem tem `usuario.desbloquear` (§5). A ação que o perfil não pode fazer não aparece (§P3.3).
- **Primeiro item do menu.** É a ação que o selo pede. Ordem: **Desbloquear · Editar · Redefinir senha · ── · Desativar** (perigo por último, depois do traço, §P3.2).
- testID: `usuarios.desbloquear.<id>`.
- Componente: o menu é o `MenuAcoes` de `@macuxi/ui/web` (revisão do BKO §P3), sem estilo próprio na tela. O item "Desbloquear" é uma `AcaoDoMenu` a mais. No print, "Desbloquear" aparece com o foco do teclado que o `MenuAcoes` põe no primeiro item ao abrir (fundo `accent-soft` #DFE2E6 e contorno Azul noite #1E3350); o fundo Pérola fica só para o hover.

## 4. "Desbloquear" na gaveta do usuário

Print: `usuario-bloqueio/3-gaveta-bloqueado-1366x768.png`.

- Na gaveta "Editar usuário", **acima do Nome**, uma faixa branca com borda `line` e raio 12 px. À esquerda, o mesmo selo da linha. À direita, o botão **secundário** "Desbloquear" (`Button` `size="sm"`, 38 px; com o respiro da faixa, o alvo chega a 44 px). O único botão principal da gaveta continua sendo o "Salvar".
- O botão age **na hora**, sem passar pelo "Salvar", e não mexe no que está sendo digitado no formulário. É `type="button"`, fora do `submit`.
- Sem bloqueio, a faixa não aparece. Ela também não aparece para quem não tem `usuario.desbloquear`: nesse caso a gaveta não mostra o selo, que já está na linha da lista.
- Por que repetir o selo na gaveta não fere "uma informação, um lugar": a gaveta cobre a lista e escurece o que está atrás. Sem o selo, o botão "Desbloquear" ficaria sem dizer qual é o problema. Dentro da gaveta, o selo aparece uma vez só.
- testIDs: `usuarios.gaveta-bloqueio` (faixa) e `usuarios.gaveta-desbloquear` (botão).

## 5. Confirmação e aviso de sucesso (decisões)

**Sem confirmação.** Um clique desbloqueia.
- Desbloquear devolve à pessoa o acesso que ela já tinha, com a mesma senha, e não apaga nada. O bloqueio por tentativas acaba sozinho em até 15 minutos de qualquer jeito.
- Um diálogo "Desbloquear Carla Vendedora?" repetiria o nome e o verbo que o admin acabou de clicar. É o tipo de excesso que o corretor-redundancias aponta (texto além do problema e da ação).
- O desbloqueio fica na auditoria (§6). Se as senhas erradas continuarem, o login bloqueia de novo sozinho, por tentativas. "Desativar" não é bloqueio: é a ação do admin para tirar o acesso de alguém, e quem a desfaz é o "Reativar" (§1).
- Contraste com o "Reativar", que confirma: reativar devolve o acesso a quem foi tirado de propósito. Desbloquear é a ação corriqueira de quando o vendedor liga dizendo "errei a senha".

**Sem aviso de sucesso em texto na tela.** O resultado aparece no lugar do problema: **o selo some** da linha (e a faixa some da gaveta) e "Desbloquear" sai do menu. Nada de toast, `Notice` ou "Usuário desbloqueado." no topo, que seria uma segunda informação em outro lugar (RN-VEN-42, R-20261110-093124) e um texto que o admin não usa para agir (R-20261110-192153).
- Acessibilidade: uma região `aria-live="polite"` só para leitor de tela anuncia "Desbloqueado.". Na gaveta, o foco vai para o campo Nome quando a faixa some; no menu, volta para o botão "⋯" da linha (§P3.4).
- Enquanto a resposta não chega, o item ou o botão mostra "Desbloqueando…" e fica desligado.
- **Erro:** a mensagem da API (`errorMessage`) aparece no `Notice` de perigo que a tela já usa (na gaveta, embaixo dos campos; fora da gaveta, no aviso da página, como no "Desativar"). O selo fica.

## 6. O que a API precisa (modulo-core)

### 6.1 Lista (`GET /core/usuarios`)
`UsuarioItemSchema` (`modules/core/contracts/usuarios.ts`) ganha dois campos, calculados no servidor com o `estadoDoLogin` do domain (a mesma função do login, para a tela e o login nunca discordarem):

```ts
/** Por que a pessoa não entra hoje, fora o inativo (que já vem em `ativo`). */
bloqueio: z.enum(['tentativas', 'admin']).nullable(),
/** Fim do bloqueio por tentativas (UTC, ISO); nulo fora dele. A tela mostra no fuso do tenant. */
bloqueio_ate: z.string().datetime().nullable(),
```

- `bloqueio = 'admin'` quando `bloqueado_em` está preenchido (vale mais que o de tentativas). `bloqueio = 'tentativas'` quando `bloqueio_ate > now()`. Fora disso, `null`, e `bloqueio_ate` vem nulo.
- `tentativas_falhas` **não vai** para a lista: a tela não usa o número.
- O campo é acréscimo compatível no contrato de resposta; não pede versão nova.
- O filtro "Situação" fica como está (Todos, Ativos, Inativos). Um filtro "Bloqueados" não entra agora.

### 6.2 Desbloquear (`DELETE /core/usuarios/:id/bloqueio`)
Mesmo desenho da rota do aparelho (`DELETE dispositivos/:id/bloqueio` em `modules/core/api/dispositivos.ts`):

- **Faz, numa escrita só:** `tentativas_falhas = 0`, `bloqueio_ate = null`, `bloqueado_em = null`.
- **Não faz:** não mexe em `ativo` (inativo segue inativo; quem reativa é `PUT /core/usuarios/:id/ativo`), não troca a senha, não muda `trocar_senha` e não derruba sessões (`sessao_versao` não muda). Quem estava bloqueado não tinha sessão nova; sessões antigas de outros aparelhos seguem a regra de hoje.
- **Idempotente:** desbloquear quem já está livre devolve 200 com o mesmo corpo e não grava auditoria nova. Usuário de outro tenant ou apagado: 404.
- Resposta: `{ id, bloqueio: null }`. A tela invalida `['core', 'usuarios']`.
- Rota com `carteira: 'nao_se_aplica'`, como a do aparelho. Licença: Core, que é nativo.
- O "Redefinir senha" continua zerando `tentativas_falhas` e `bloqueio_ate` (`usuarios.ts:490`), como hoje. Foi o caminho que o Alexandre usou.

### 6.3 Permissão
- Ação nova no manifest do Core, no mesmo padrão de `dispositivo.bloquear`:
  `'usuario.desbloquear': { perfis: ['admin', 'analista'], descricao: 'Desbloquear no BKO o login de um usuário bloqueado por senhas erradas ou pelo admin; auditado' }`.
- Ela entra na matriz editável dos Perfis de acesso como as outras chaves.
- **Atenção:** hoje `usuario.ver` é só de gerente e admin, então o analista com `usuario.desbloquear` ainda não abre a tela Usuários. Dar ou não a tela ao analista é decisão do Alexandre (pergunta à parte). Enquanto isso, quem vê o botão na prática é o admin. A API aceita o analista.
- Ao contrário do "Redefinir senha" (`SENHA_PROPRIA`, `SENHA_DE_ADMIN`), o desbloqueio **vale também para admin**: é assim que um admin destrava outro admin que errou a senha, e a senha não muda. A tela esconde o item de quem não tem a ação; a API revalida.

### 6.4 Auditoria (RN-AUD-01)
`auditar(db, ctx, { acao: 'usuario.desbloquear', entidade: 'usuario', entidadeId, antes: { bloqueio, bloqueio_ate, tentativas_falhas }, depois: { bloqueio: null, bloqueio_ate: null, tentativas_falhas: 0 } })`. Sem e-mail nem nome no registro: só o id.

### 6.5 Observação para o modulo-core e o gerente
- Nenhuma rota do BKO grava `bloqueado_em` em usuário hoje (só em aparelho). O selo "Bloqueado" e o desbloqueio dele existem para o dado que já está no banco e que o login respeita. Esta spec **não** cria a ação "Bloquear usuário": para tirar o acesso, o BKO usa "Desativar".
- O bloqueio de login por tentativas não tem número de RN no doc 03 (a regra mora em `auth.ts`). Vale registrar uma RN-CORE para ela e para esta ação.

## 7. Textos

| Onde | Texto |
|---|---|
| Selo, tentativas | `Bloqueado até {HH}h{MM}` |
| Selo, admin | `Bloqueado` |
| Selo, inativo | `Inativo` (sem mudança) |
| Menu "⋯" e botão da gaveta | `Desbloquear` · durante: `Desbloqueando…` |
| Leitor de tela, depois | `Desbloqueado.` |
| `aria-label` do "⋯" | `Ações de {nome}` (sem mudança) |

## 8. Pronto quando
- A lista mostra o selo certo nos três casos, com a hora no fuso do tenant, e o selo some quando o bloqueio vence.
- "Desbloquear" aparece no "⋯" e na gaveta só com bloqueio e só para quem tem `usuario.desbloquear`. Um clique zera o bloqueio, o selo some, e não aparece toast nem aviso na tela.
- A API devolve `bloqueio` e `bloqueio_ate` e tem a rota `DELETE /core/usuarios/:id/bloqueio`, idempotente e auditada, com teste de 403 para quem não tem a ação.
- Prints 1366×768 da tela real (lista, menu e gaveta) para a revisão do designer-ux, o corretor-redundancias e a validação do design-de-marca.

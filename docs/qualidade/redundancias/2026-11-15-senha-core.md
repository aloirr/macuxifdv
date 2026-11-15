# Senha no modulo-core (login, teclado e `CampoSenha`) · parecer do corretor-redundancias

**Veredito: COM ACHADO (não liberado).** São 2 achados de gravidade baixa, RD-0508 e RD-0509. O RD-0508 está em código de produção e segura o lote. O RD-0509 está em código de teste e, pelo precedente do RD-0233, também segura.

Corretor-redundancias, 15/11/2026, ~12h (Manaus). Conferi o branch `nuvem/login-teclado-modulo-core` contra o `origin/main` 4e404f33 (`git diff origin/main...`), com os 2 commits:
- **9e0b931c**: login e teclado. A senha fica sem autocorreção e o código da empresa passa por `normalizarCodigoEmpresa` (app e API). A frase do espaço nas pontas agora diz a ação.
- **01ddf2a6**: login, "Crie sua senha" e Redefinir senha (BKO, `usuarios-page.tsx`) passam a usar o `CampoSenha` do kit. Saem `propsDoCampoSenha`, `rotuloOlhoSenha`, os estilos `olho`/`olhoTexto` e o botão "Mostrar/Esconder senha".

## 1. O que foi conferido
| Ponto | Resultado |
|---|---|
| Olho com texto ("Mostrar"/"Esconder") e o botão "Mostrar senha" do BKO | **Sem achado.** As 3 telas usam o `CampoSenha` do kit, e o olho vem só como ícone. Em "Crie sua senha", o campo "Repita a senha" fica sem olho e segue o olho do campo de cima: um toque mostra os dois. O BKO perdeu o botão de linha que repetia o olho. |
| Parte do modulo-core no RD-0479 (`rotuloOlhoSenha`, o teste dela e os estilos `olho`/`olhoTexto`) | **Feita.** `git grep rotuloOlhoSenha\|olhoTexto` não acha mais nada em `modules/core`. A `ESCONDER_SENHA` continua no kit e em `apps/web` (designer-ux e engenheiro-apps). Ela fica com o RD-0479. |
| Props de teclado repetidas na tela | **Sem achado.** `autoCorrect`, `autoCapitalize`, `textContentType` e `autoComplete` saíram das telas e vêm só de `propsDeTecladoDaSenha` (kit). |
| Frase do espaço nas pontas ("A senha não pode ter espaço no começo nem no fim. Apague o espaço e tente de novo.") | **Sem achado.** A frase diz o problema e a ação, e fica numa constante só (`MENSAGEM_SENHA_ESPACO_NAS_PONTAS`), usada no login, na criação e na troca. |
| Erro da senha no login (`tela-login.tsx:94-109`) | **Sem achado.** O `CampoSenha` do app não mostra o texto do erro, e a tela põe a linha embaixo do campo, como nos outros campos do login. Não aparece duas vezes. |
| Normalização do código da empresa | **RD-0508.** |
| Testes novos | **RD-0509.** |

## 2. Achados
### RD-0508 · baixa · código · modulo-core
- **Onde:**
  - `modules/core/app/components/tela-login.tsx:45-46,52` (`const enviar = { ...campos, codigo_empresa: normalizarCodigoEmpresa(...) }`);
  - `modules/core/contracts/ciclo-senha.ts:147` (`validarCodigoEmpresaNovo`).
- **O que se repete:** o mesmo trim e as mesmas maiúsculas do código da empresa, em 4 camadas num só login:
  1. a digitação já põe maiúsculas (`tela-login.tsx:76`);
  2. a tela normaliza de novo em `enviar`;
  3. o `onEntrar` chega sempre ao `entrarComSenha` (`apps/mobile/src/app/login.tsx:141-145` → `plataforma.tsx:684`), que normaliza mais uma vez (`login.ts:72`);
  4. a API normaliza no `CodigoEmpresaSchema` (`auth.ts:47`).

  A 4ª camada é a revalidação obrigatória da API e fica. A 2ª repete a 3ª. Em `ciclo-senha.ts:147`, o `normalizarCodigoEmpresa` não muda nada: o `CodigoEmpresaFormatoSchema` já tem `.trim()` e o `CODIGO_EMPRESA_REGEX` já é `'i'` (`auth.ts:27,35`). `validarCodigoEmpresaNovo('aM2808 ')` já dava `null` antes da mudança.
- **Impacto:** manutenção. São 3 pontos para a mesma regra, e uma mudança futura (outro formato de código, por exemplo) precisa lembrar de todos.
- **Proposta:**
  - `tela-login.tsx`: antes → `const enviar = {...}; validarLogin(enviar); … onEntrar(enviar)`; depois → `validarLogin(campos); … onEntrar(campos)`. O import de `normalizarCodigoEmpresa` sai da tela. A digitação em maiúsculas (`:76`) fica, porque é o que o vendedor vê.
  - `ciclo-senha.ts:147`: antes → `CodigoEmpresaFormatoSchema.safeParse(normalizarCodigoEmpresa(valor))`; depois → `CodigoEmpresaFormatoSchema.safeParse(valor)`. O import sai.
  - A forma única fica em `entrarComSenha`, `trocarSenhaPeloApp` e `pedirSenhaTemporaria` (app) e no `CodigoEmpresaSchema` (API).

### RD-0509 · baixa · teste · modulo-core
- **Onde:** `modules/core/app/lib/login.test.ts:93-100` (describe "teclado não muda a senha nem o código da empresa (v1.0.10)").
- **O que se repete:** os 2 testes já existiam em outro lugar.
  - O caso `entrarComSenha` com `' aM2808 '` → `'AM2808'` repete o teste de `login.test.ts:55-58`, que já manda `' am4821 '` e espera `'AM4821'`.
  - O caso `validarLogin('aM2808 ')` → `{}` repete o `validarCodigoEmpresaNovo('aM2808 ')` de `contracts/codigo-empresa.test.ts:55`. O `validarLogin` do app é o `validarLoginNovo`, que chama essa função.
- **Impacto:** manutenção. São 2 testes do mesmo caso com outro nome.
- **Proposta:** apagar o describe `login.test.ts:93-100`. A cobertura fica em `login.test.ts:55-58` e em `codigo-empresa.test.ts:50-56`.

## 3. Encaminhamentos
Nenhum defeito funcional achado.

## 4. Recado
Os 2 achados vão num recado `pedido` ao modulo-core, com cópia ao gerente-projetos.

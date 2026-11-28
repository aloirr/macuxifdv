# T-0209 (v1.0.44), critério 7: rodada do corretor (entrada sem a empresa e avisos sem prefixo)

- **Data:** 28/11/2026, manhã de Manaus. **Base:** `origin/main` 1aeace4 (v1.0.43 no ar).
- **Escopo:** todas as telas no ar (Campo, Gestão, BKO e portal `config.`), os e-mails e os docs que descrevem essas telas:
  - **(a)** todo lugar que ainda pede, mostra, guarda ou envia o código da empresa (ou o servidor) na entrada, no Esqueci a senha, na troca de senha, no primeiro acesso, na seleção de empresa ou servidor e nos e-mails;
  - **(b)** todo aviso com o prefixo "Erro.", "Aviso.", "Atenção.", "Pronto." ou "Sucesso." (e as variações com dois-pontos).
- **Regra de referência:** T-0209, critérios 1 e 4 (ADR 0078, ainda em redação pelo engenheiro-software); RN-CORE-32 a 34. Com 1 usuário = 1 empresa e o e-mail único, o código passa a repetir o que o e-mail já identifica. Cada lugar abaixo é excesso: um campo a mais, um toque a mais, um dado a mais no e-mail.
- **Recados:** `node scripts/coord.mjs caixa corretor-redundancias` deu **HTTP 403** nesta sessão (o repositório de recados não está liberado aqui). A caixa não foi lida e nenhum recado foi enviado. O gerente repassa a tabela aos donos na Etapa 3.
- **Como foi feito:**
  - grep por `codigo_empresa`, `codigoEmpresa`, `CODIGO_EMPRESA`, "Código da empresa", "servidor", "Escolha a empresa" e pelos 5 prefixos em `apps/web`, `apps/mobile/src`, `modules/*/{app,web,api,contracts}`, `packages/{ui,platform-sdk}`, `apps/api/src` e `docs/{produto,design}`;
  - dono de cada caminho por `node scripts/coord.mjs dono <caminho>`.
- **Prints** (Chromium, escala 1, só para o relatório), na pasta [2026-11-28-t0209-entrada](2026-11-28-t0209-entrada/):
  - `01-simulacao-entrada-1366.png`: simulação da entrada com o rodapé legal (`docs/design/telas/rodape-legal.html`), ainda com "Código da empresa" (RD-3784; mesma tela do RD-3771);
  - `02-email-acesso.png`: o e-mail de senha temporária (`docs/design/emails/redefinir-senha/depois-campo.html`), com o bloco "Código da empresa" (RD-3777 e RD-3783).
  - As telas reais do BKO e do app não foram renderizadas: esta sessão não tem as dependências instaladas e não subimos servidor. Cada achado cita arquivo:linha no `main` 1aeace4.

## Achados

Severidade: **alta** (confunde ou contradiz) · **média** (polui ou custa toque) · **baixa** (estética ou código sem efeito na tela).

### (a) Lugares que ainda pedem, mostram, guardam ou enviam a empresa

| RD | Onde (arquivo:linha) | Tipo | Sev. | Dono | Correção esperada |
|---|---|---|---|---|---|
| RD-3764 | BKO › Entrar: campo "Código da empresa". `apps/web/components/login-screen.tsx:256`; estado e validação em `:83`, `:95`, `:103`, `:145`, `:153`, `:198-201`; comentários em `:5-8` e `:89` | texto · layout | média | engenheiro-apps | Tirar o campo. A entrada fica só com "E-mail" e "Senha". O foco inicial vai para o e-mail. A mensagem de erro é "E-mail ou senha inválidos." (critério 3). |
| RD-3765 | BKO: código guardado no navegador. `apps/web/lib/login.ts:8-9` (`CHAVE_CODIGO_EMPRESA = 'macuxi.web.codigo_empresa'`); leitura em `login-screen.tsx:112-113`, gravação em `:124-127` | código | média | engenheiro-apps | Apagar a constante, a leitura e a gravação. Na abertura, um `localStorage.removeItem('macuxi.web.codigo_empresa')` limpa o que ficou guardado (uma vez, sem aviso). |
| RD-3766 | BKO › Esqueci a senha: campo "Código da empresa". `apps/web/components/ciclo-senha.tsx:228`; estado e foco em `:160-195` (`codigo`, `codigoRef`, `codigo_empresa` em `onPedir` e `onVoltarAoLogin`) | texto · layout | média | engenheiro-apps | Só o campo "E-mail". A resposta é sempre "Se o e-mail estiver cadastrado, enviamos as instruções." (critério 3). |
| RD-3767 | BKO › Crie sua senha (primeiro acesso e troca obrigatória): a linha de quem entra mostra "<e-mail> · <código>". `ciclo-senha.tsx:109` (prop `codigoEmpresa` em `:52` e `:61`) | texto | média | engenheiro-apps | A linha fica só com o e-mail: `{email}`. Sai a prop `codigoEmpresa`. |
| RD-3768 | BKO › menu do usuário › Trocar a senha: a gaveta pede o código quando a sessão é antiga. `apps/web/components/menu-usuario.tsx:383` (campo), `:50-58` e `:330` (`pedirCodigo`); `apps/web/components/app-shell.tsx:576-584`; `apps/web/lib/session.ts:34-35` e `:66` (`codigoEmpresa` na sessão) | texto · código | média | engenheiro-apps | Tirar o campo, o `pedirCodigo` e o `codigoEmpresa` da sessão. A troca manda só o e-mail da sessão, a senha atual e a senha nova. |
| RD-3769 | Portal `config.` › "Escolha a empresa" e "Trocar de empresa" (admin do cliente com 2 ou mais empresas). `apps/web/components/portal/tela-escolher-empresa.tsx` (tela toda); `apps/web/components/portal/base.tsx:244` e `:299`; `apps/web/lib/portal-sessao.ts:219`, `:235`, `:324` e `:338` | layout · código | média | engenheiro-apps | Com o e-mail único (critério 2), o admin do cliente tem uma empresa só, e a tela e o "Trocar de empresa" nunca aparecem. Sai a tela, o link e os desvios `empresas.length >= 2`. A lista do time da Macuxi (superadmin, fora da unicidade) fica. |
| RD-3770 | API do portal: login do admin do cliente devolve a lista `empresas` e a rota de escolher. `modules/core/api/super-admin.ts:104` e `:188-192` | código | baixa | modulo-core | Com uma empresa por e-mail, o login do admin do cliente já devolve a sessão na empresa (`empresa` preenchida), e sai o ramo "escolha a empresa" do admin do cliente. Fica o do superadmin. Contrato pelo ADR 0078. |
| RD-3771 | Campo e Gestão › Entrar: campo "Código da empresa". `modules/core/app/components/tela-login.tsx:64-69` (e `:2`, `:5`, `:17`, `:26`, `:115`); `modules/core/app/lib/login.ts:2-4`, `:16`, `:19-20` (`propsDoCampoCodigoEmpresa`) e `:32` | texto · layout | média | modulo-core | Tirar o campo e o `propsDoCampoCodigoEmpresa`. A entrada fica com "E-mail" e "Senha". O "Esqueci a senha" leva só o e-mail. |
| RD-3772 | Campo e Gestão › Esqueci a senha: campo "Código da empresa". `modules/core/app/components/tela-esqueci-senha.tsx:110-116` (e `:4`, `:14`, `:28`, `:33`, `:127`) | texto · layout | média | modulo-core | Só o campo "E-mail" (`autoFocus` nele). Dentro do app (`dentroDoApp`), só o e-mail da sessão. |
| RD-3773 | Campo e Gestão › Crie sua senha (primeiro acesso e troca obrigatória): "<e-mail> · <código>". `modules/core/app/components/tela-crie-sua-senha.tsx:81` (prop em `:21` e `:30`) | texto | média | modulo-core | `testID="crie-senha.quem"` só com `{email}`. Sai a prop `codigoEmpresa`. |
| RD-3774 | App › troca e pedido de senha: o código da empresa vai em cada chamada. `modules/core/app/lib/trocar-senha.ts:13`, `:19` e `:27`; `modules/core/app/lib/senha.ts:61`, `:71` e `:96` | código | baixa | modulo-core | Os pedidos levam só o e-mail, com o contrato novo (ADR 0078). |
| RD-3775 | App (shell): código guardado no aparelho e repassado entre as etapas da entrada. `apps/mobile/src/state/plataforma.tsx:210-211` (`CHAVE_CODIGO_EMPRESA = 'fv:codigo_empresa'`), `:619` e `:814-822`; `apps/mobile/src/app/login.tsx:128`, `:144`, `:175-196` e `:215`; `apps/mobile/src/lib/etapa-login.ts:6` e `:13-14` | código | média | engenheiro-apps | Apagar a chave e a gravação. Na abertura, remover `fv:codigo_empresa` uma vez. As etapas levam só o e-mail. A sessão já aberta continua valendo (critério 6). |
| RD-3776 | App (shell) › Trocar senha: `contaDaSessao` monta o código da empresa. `apps/mobile/src/lib/trocar-senha-shell.ts:20-23` | código | baixa | engenheiro-apps | Devolver só `{ email }`, para casar com o RD-3774. |
| RD-3777 | E-mails "Seu acesso ao Macuxi", "Sua nova senha" e o do Esqueci a senha: bloco "Código da empresa" (print 02). `packages/platform-sdk/src/email/modelos.ts:311`; carga `codigo_empresa` em `:52`; comentários em `:7` e `:144` | texto | alta | engenheiro-software | Sai a linha "Código da empresa". O bloco fica com "E-mail" e "Senha temporária". Sai `codigo_empresa` da carga (RN-CORE-32 e 34 pelo ADR 0078). Hoje o e-mail manda o código e a tela nova não tem onde digitá-lo. |
| RD-3778 | API do Core: quem manda o e-mail preenche `codigo_empresa`. `modules/core/api/usuarios.ts:391` (acesso inicial) e `:620` (redefinir); `modules/core/api/autenticacao.ts:399` (esqueci) | código | baixa | modulo-core | Tirar `codigo_empresa` dos 3 `dados`, junto com o RD-3777. |
| RD-3779 | API da plataforma: o "redefinir senha" do portal preenche `codigo_empresa`. `apps/api/src/plataforma.ts:496` | código | baixa | engenheiro-software | Tirar `codigo_empresa` dos `dados`, junto com o RD-3777. |
| RD-3780 | Contratos de entrada e senha pedem o código. `modules/core/contracts/auth.ts:51` (login), `:153` (trocar) e `:165` (esqueci); `modules/core/contracts/ciclo-senha.ts:53` (`TEXTOS_ESQUECI.codigoEmpresa`), `:142-190` (validações e os textos "Informe o código da empresa (quem administra o sistema na sua empresa sabe qual é)." e "O código da empresa tem só letras, números e hífen…") | código · texto | média | modulo-core | Contrato só com e-mail e senha (e `app`), pelo ADR 0078. Saem o rótulo e os 2 textos de erro do código. Contrato desenhado pelo engenheiro-software. |
| RD-3781 | API do Core: limite de tentativas e busca da conta pelo código. `modules/core/api/index.ts:102`, `:132` e `:140` (chave do limite = `codigo_empresa`); `modules/core/api/autenticacao.ts:302`, `:322`, `:331`, `:367-369` | código | média | modulo-core | O limite passa a usar o e-mail normalizado (com o IP) e a conta é achada pelo e-mail. Sem o código, a chave atual fica vazia e todos os pedidos caem num limite só. |
| RD-3782 | Doc 03, premissa do login: "A tela de login pede **código da empresa + e-mail + senha**" e "o 'Esqueci a senha' pede o código da empresa e o e-mail (P8)". `docs/produto/03-regras-de-negocio.md:17` e `:33` | doc | alta | gerente-projetos | Mesma regra em dois lugares com textos opostos, depois do ADR 0078. Fonte da verdade: o ADR 0078. Novo texto: "O e-mail é único entre as empresas (o superadmin fica fora). A entrada pede e-mail e senha, e a empresa vem do usuário. O 'Esqueci a senha' pede só o e-mail." |
| RD-3783 | Especificações de tela e de e-mail com o código. `docs/design/ciclo-de-senha.md:34`, `:46`, `:54`, `:80-81` e `:98`; `docs/design/trocar-senha/spec.md:83`, `:117` e `:129`; `docs/design/emails/redefinir-senha.md:19`, `:33`, `:63` e `:73` (e os 3 `.html` da pasta); `docs/design/telas/portal-config-enxuto.md:34` | doc | média | designer-ux | Atualizar as especificações para e-mail e senha, sem o código, para os donos das telas não reintroduzirem o campo. |
| RD-3784 | Simulação da entrada com o rodapé legal (T-0204, que vai ao Alexandre pelo critério 8): campo "Código da empresa" no celular e no BKO (print 01). `docs/design/telas/rodape-legal.html:103` e `:123` | doc · layout | alta | designer-ux | Tirar os 2 campos antes de levar a simulação ao Alexandre. Do contrário, a aprovação seria de uma tela que a T-0209 desfaz. |

### (b) Avisos com prefixo

| RD | Onde (arquivo:linha) | Tipo | Sev. | Dono | Correção esperada |
|---|---|---|---|---|---|
| RD-3785 | BKO › Recados › marcar recado do dia: aviso "Pronto: este recado aparece como recado do dia no Início do app hoje." `modules/core/web/components/recados/recados-page.tsx:70` | texto | média | modulo-core | Sem o prefixo: "Este é o recado do dia no Início do app." O par fica "Recado do dia retirado." (sai "O Início volta à frase padrão.", que explica o funcionamento, R-20261110-192153). |
| RD-3786 | BKO › Início › Alertas: texto só para leitor de tela "Falha: " ou "Atenção: " antes de cada alerta. `modules/core/web/components/inicio/inicio-bko-page.tsx:40` | texto | baixa | modulo-core | **`manter?`** O ponto colorido é `aria-hidden` e só a cor diz a gravidade. Sem esse texto, o leitor de tela perde a gravidade (rótulo de acessibilidade é redundância útil). Proposta: manter, e o designer-ux decide se a regra do `packages/ui` (critério 4) abre essa exceção. Se não abrir, levar a gravidade para o `aria-label` da linha ("Falha" ou "Atenção", sem dois-pontos). |

**Totais:** 23 RDs (RD-3764 a RD-3786).
- Por dono: engenheiro-apps 8, modulo-core 10, engenheiro-software 2, designer-ux 2, gerente-projetos 1.
- Por severidade: 3 altas, 14 médias e 6 baixas.
- Situação: 22 abertos e 1 `manter?` (RD-3786).

## Conferidos sem RD

- **Prefixos literais** "Erro.", "Aviso.", "Atenção.", "Pronto." e "Sucesso.":
  - nenhum nas telas (Campo, Gestão, BKO e portal), em `packages/ui` e nos contratos;
  - "Erro interno…" e "Erro 500 do servidor." começam com um substantivo que faz parte da frase, sem prefixo.
- **`packages/ui`:** ainda não há regra contra o prefixo no componente de aviso (`AvisoRodape` em `packages/ui/src/mobile/base.tsx:205`; `Notice` no web). Isso é a entrega do critério 4 (designer-ux) e não é RD.
- **Servidor no app:**
  - o cartão "Servidor" da entrada (`apps/mobile/src/app/login.tsx:244-257`) só aparece no build de desenvolvimento (`apps/mobile/src/lib/endereco-do-build.ts:29-36`);
  - no Perfil (`apps/mobile/src/app/profile.tsx:299-305`), o build de produção mostra o endereço fixo, só para leitura, sem pedir nada. Fica como **`manter?`** para o suporte: é o endereço que o vendedor dita no atendimento. Se o gerente quiser enxugar, a linha "Endereço definido nesta versão do aplicativo." é a candidata a sair.
- **Portal › Nova empresa › "Código da empresa"** (`apps/web/components/portal/passo-empresa-legado.tsx:316`): é o código da licença no cadastro da empresa, não um pedido na entrada. Fica.
- **Portal › Excluir empresa:** digitar o código da empresa é a confirmação de uma ação destrutiva (redundância útil). Fica.
- **Superadmin:** a lista de empresas do time da Macuxi fica fora da unicidade (critério 2). Fica.
- **Conector on-premise** (`apps/conector/src/atualizacao/resultado.ts:93-95`, "Atenção: …"; `apps/conector/src/comandos.ts:132`, "Erro: …"): é saída de linha de comando no servidor do cliente, fora das telas no ar. Não foi catalogado. Se o gerente quiser estender a regra, vai ao modulo-integracao.
- **Testes e e2e** com o código (`apps/web/e2e/bko-menu-usuario.spec.ts:18` e `:133`, entre outros): cada dono acerta os seus junto com o RD do mesmo arquivo. Não têm RD próprio.

## Próximo passo

- O gerente repassa a tabela aos donos na Etapa 3 (um recado por dono, cc gerente-projetos, T-0209).
- O corretor faz o reteste no diff de cada PR e fecha cada RD no catálogo (`corrigido` ou `reaberto`).

# Entrada sem a empresa e rodapé legal (T-0209 e T-0204, v1.0.44)

> 2026-11-28 · designer-ux · Etapa 1 (simulação para o Alexandre, pelo PO, antes do PR). Regras: RN-CORE-32, RN-CORE-33,
> RN-CORE-34; ADR 0078 (1 usuário = 1 empresa). Decisões: R-20261128-002948, R-20261128-003116, R-20261128-003454 (T-0209) e
> R-20261128-000314 (T-0204, 122 A). Gerador: `docs/design/simulacoes/v1044-entrada/gerar.mjs` (Chromium, escala 2; tokens de
> `docs/design/telas/telas.css`, marca v1). Só dados fictícios (Ana Souza, `ana.souza@exemplo.com.br`).

## 1. O que muda
- **Nenhuma tela pede a empresa.** Sai o campo "Código da empresa" do Entrar (Campo, Gestão, BKO) e do Esqueci a senha; sai o
  subtítulo do BKO "Use o código da sua empresa, o seu e-mail e a sua senha." (os rótulos já dizem); sai o "Avançado · servidor"
  do login do app. A empresa vem do usuário.
- **Entrar igual nas quatro portas:** título "Entrar", "E-mail", "Senha" (com o olho), um só principal "Entrar", link
  "Esqueci a senha" e o rodapé legal.
- **Avisos sem prefixo:** nenhum "Erro.", "Aviso.", "Atenção.", "Pronto." ou "Sucesso."; o tom vem da cor e do ícone.
- **Faixa do app com o nome da área** ("Campo" / "Gestão"), como a `MarcaNaFaixa` do BKO e do portal: sem ela, as entradas do
  Campo e do Gestão ficam idênticas. Sai a linha de baixo "Macuxi Campo · vendedores e promotores" (o lugar é do rodapé legal).
  **Precisa da validação do design-de-marca** (mudança de layout da faixa).
  Área de proteção do logo (manual §2.3): logo a 44 px de altura, 28 px até o divisor, 14 px até o nome, e 28 px acima e abaixo
  na faixa.
- **Cores dos campos e avisos:** borda do campo `#7A8593` no app e na web (manual §3); aviso de atenção (empresa suspensa) em
  `#7A4F00` no `#FFF1D6` (6,38:1).

## 2. Rodapé legal proposto (T-0204)
Uma linha, centralizada, no pé da tela de Entrar (não nas demais etapas), texto 12 px:

**© 2026 Macuxi · Termos de uso · Política de privacidade**

- "© 2026 Macuxi" em `ink2` (#4A5562, 7,03:1 no Pérola); os dois links em `accentInk` (#1E3350, 11,82:1), semibold, alvo ≥ 44 px
  de altura; separador "·" em `ink3`. Cabe em uma linha a 390 px.
- O ano sai do relógio (o ano corrente), não fica fixo no código.
- Não repete nada da tela: a marca já está na faixa, por isso não há "Macuxi Força de Vendas" nem versão no rodapé.
- Os links abrem as páginas públicas de Termos e de Privacidade (no app, no navegador do sistema). **As páginas e os endereços
  ainda não existem** — ficam para o dono do produto definir (premissa 1).

## 3. Telas e textos
PNGs em `docs/design/simulacoes/v1044-entrada/` (largura × 2 de escala).

| PNG | Tela | Texto, de cima para baixo |
|---|---|---|
| `campo-entrar-390.png`, `campo-entrar-1366.png` | Entrar do Campo | faixa: logo · "Campo"; "Entrar"; "E-mail"; "Senha" (olho); botão "Entrar"; link "Esqueci a senha"; rodapé legal |
| `gestao-entrar-390.png`, `gestao-entrar-1366.png` | Entrar do Gestão | igual ao Campo, faixa "Gestão" |
| `bko-entrar-390.png`, `bko-entrar-1366.png` | Entrar do BKO | faixa: logo · "Backoffice"; "Entrar"; "E-mail"; "Senha"; "Entrar"; "Esqueci a senha"; "Vendedores e promotores usam o app Macuxi Campo; supervisores, o Macuxi Gestão."; rodapé legal |
| `config-entrar-390.png`, `config-entrar-1366.png` | Entrar do portal config. | faixa: logo · "Portal de implantação"; cartão com "Entrar", "E-mail", "Senha", "Entrar", "Esqueci a senha"; rodapé legal |
| `campo-esqueci-390.png` | Esqueci a senha (app) | "Esqueci a senha"; "E-mail" (vem preenchido do Entrar); botão "Enviar instruções"; link "Voltar ao login" |
| `campo-esqueci-enviado-390.png` | Esqueci a senha, enviado (app) | "Esqueci a senha"; aviso (tom destaque, ícone de envio) **"Se o e-mail estiver cadastrado, enviamos as instruções."**; "Não chegou? Confira o spam ou fale com o administrador da sua empresa."; botão "Voltar ao login" |
| `bko-esqueci-1366.png`, `bko-esqueci-enviado-1366.png` | Esqueci a senha (BKO; o config. usa o mesmo) | iguais às do app |
| `campo-erro-credenciais-390.png`, `bko-erro-credenciais-1366.png` | Entrar com erro | aviso perigo **"E-mail ou senha inválidos."**; o e-mail fica, a senha é limpa |
| `campo-empresa-suspensa-390.png`, `bko-empresa-suspensa-1366.png` | Entrar, empresa suspensa (só com a senha certa) | aviso atenção **"Sua empresa está suspensa. Fale com o administrador da Macuxi."** |
| `cadastro-email-em-uso-390.png`, `cadastro-email-em-uso-1366.png` | Novo usuário (BKO e config.; fragmento) | erro no próprio campo E-mail **"Este e-mail já está em uso em outra empresa. Use outro e-mail."** (sem aviso repetido no topo) |

Posição do aviso: no app, entre a Senha e o "Entrar" (como hoje na `TelaLogin`); no web, abaixo do título (como hoje no
`login-screen.tsx` e na `tela-entrar.tsx`). Um aviso por vez; nenhum aviso fora desse lugar.

## 4. Regra do aviso sem prefixo (para o `packages/ui`)
`Banner` (mobile) e `Notice` (web) passam a recusar texto que comece por "Erro.", "Aviso.", "Atenção.", "Pronto." ou "Sucesso."
(e as variantes com dois-pontos): em desenvolvimento, falha o teste; o leitor de tela anuncia só o texto (o papel `alert`/`status`
já diz a natureza). Fica para a etapa 5 da T-0209 (designer-ux, `packages/ui`).

## 5. Premissas
1. Termos de uso e Política de privacidade: as páginas e os endereços ainda não existem; o rodapé fica com os links quando
   houver o endereço. Sem endereço, a decisão volta ao Alexandre (esconder os links ou publicar antes).
2. O botão do Esqueci passa de "Enviar senha temporária" para **"Enviar instruções"**, para casar com a resposta fixa; sai a
   instrução de cima ("Informe o código da empresa…") — o rótulo e o botão já dizem o que fazer; sai o "Ela vale por 24 horas".
3. O portal config. ganha o "Esqueci a senha" (hoje: "Esqueceu a senha? Fale com a Macuxi.", sem link), pelo pedido de as quatro
   entradas terem o link. O superadmin fica fora da unicidade do e-mail; o fluxo dele no portal é decisão do engenheiro-software
   no ADR 0078. Se o portal não tiver o fluxo, volta a linha de hoje.
4. A largura 1366 do Campo e do Gestão representa o tablet deitado: a faixa ocupa a largura, o formulário fica numa coluna de
   até 440 px no centro.
5. O rodapé legal fica só no Entrar (não no Esqueci, no Crie sua senha nem na Escolha a filial).
6. A faixa do app com "Campo"/"Gestão" e o rodapé novo dependem da validação do design-de-marca; os tons dos avisos (perigo para
   as credenciais, atenção para a suspensa, destaque para o enviado — nunca verde) seguem o `ciclo-de-senha.md`.
7. Fonte do sistema (manual da marca §5).

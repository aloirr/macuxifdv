# Entrada no app: a sincronização na tela do logo

> 2026-11-12 · design-de-marca · T-0169 · aplicação da marca v1 aprovada (`docs/marca/manual.md`).
> Pedido do Alexandre no chat, 12/11/2026: "Quero essas telas de entrada no app. Coloque a sincronização inicial antes do logon para ocorrer nessa tela inicial com a logomarca. Vamos acrescentar uma barra de sincronização nela caso tenha alguma sincronização para fazer antes do login, e apos o login fazer as etapas de sincronização nela tambem. Simule como ficara".
> **Situação: aprovada em 12/11/2026 ("Aprovado. Quero na 1.0.5"). Meta: v1.0.5**, junto com a aplicação da marca v1 (manual §10). A implementação é dos donos da §3.

Imagem: `entrada-sync.png`, gerada por `gerar.mjs` a partir dos ativos aprovados em `docs/marca/ativos/2026-11-12-v1/`. Para refazer, rode na raiz do repositório:
```bash
node docs/marca/propostas/2026-11-12-entrada-sync/gerar.mjs
```

## 1. O fluxo (Macuxi Campo)
1. **Abertura:** a tela do logo, com o fundo Azul noite e o logo empilhado. Sem nada pendente, fica só um instante e segue para o login, ou direto para o Início se a sessão ainda vale.
2. **Antes do login:** a barra aparece só se houver o que fazer sem usuário: atualizar o app e conferir o servidor. Mostra o nome da etapa e o percentual.
3. **Login:** o aprovado, com o logo na faixa Azul noite e o formulário no Pérola.
4. **Depois do login:** volta para a tela do logo, com "Olá, Lucas", a barra do total e a lista de etapas:
   1. Envio do que ficou no aparelho;
   2. Clientes e rota;
   3. Catálogo e preços;
   4. Pedidos e metas;
   5. Fotos e materiais.

   A etapa atual fica com o ponto laranja, e as feitas ganham ✓. Só aparecem as etapas dos módulos ativos no perfil. O Gestão tem as etapas dele: equipe, aprovações, metas e alertas.
5. **Pronto:** com tudo ✓, o app abre o Início sozinho, sem botão.
6. **Sem sinal:** a etapa que parou fica marcada.
   - "Tentar de novo": botão branco com texto Azul noite.
   - "Continuar sem sincronizar": só aparece se já houver uma carga anterior no aparelho.
   - "Trocar usuário": link.

O logo fica sempre no mesmo lugar. Só a área de baixo muda, então a passagem da splash para a sincronização não tem corte.

## 2. Cores e contraste (no Azul noite `#1E3350`)
| Elemento | Cor | Contraste |
|---|---|---|
| Texto da etapa e percentual | branco | 12,77:1 |
| "Olá", etapas que faltam e "Trocar usuário" | `#C9CED5` | 8,07:1 |
| Preenchimento da barra e ponto da etapa atual | sol claro `#F59A52` | 5,85:1 (gráfico) |
| Trilho da barra | `#3A4D68` | só fundo; a informação está no preenchimento |
| ✓ das etapas feitas | `#7FD1A8` | 7,05:1 |
| Erro ("Sem internet…") | `#F7A59C` | 6,58:1 |

## 3. O que muda no app (depois do "aprovo")
- **engenheiro-apps:** a splash e a carga (`/sync`, `components/tela-carga.tsx`) passam a ser uma tela só: a do logo, com a área de sincronização embaixo. A etapa de antes do login entra na abertura do app.
- **modulo-core:** o motor de sync expõe as etapas por nome e o percentual total, por perfil e pelos módulos efetivos. A etapa em que parou continua indo para o Diagnóstico.
- **designer-ux:** a especificação da tela em `docs/design/`. Saem as frases que se alternam na tela de carga de hoje: fica só o nome da etapa, sem texto sobre o que o app faz por trás.
- **design-de-marca:** a validação no print do aparelho antes do lote e do build.

## Premissas
- Antes do login, sem usuário, o app só pode atualizar a si mesmo e conferir o servidor. Os dados do vendedor só vêm depois do login.
- Os nomes das 5 etapas do Campo são uma proposta de agrupamento das entidades de hoje. A divisão final é do modulo-core.
- O botão "Sincronizar" do Início continua como está. Esta tela vale para a entrada no app.

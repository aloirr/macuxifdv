# Rodapé legal nas telas de entrada (Campo, Gestão, BKO e portal `config.`)

> 2026-11-14 · designer-ux · pedido do dono do produto pela ponte, ~20h12 (Manaus), recado R-20261114-201200-alexandre,
> com o print do Entrar do Campo: *"Aqui embaixo no login em vez dessa frase simples macuxi vendedores e promotores deve ter
> lá dizeres legais como a razão social da empresa, CNPJ, versão, todos os direitos reservados. E o site"*.
> Simulações (antes e depois): `rodape-legal-<campo|gestao|bko|portal>-<antes|depois>.png`, nesta pasta. Fonte:
> `rodape-legal.html?v=<superfície>-<antes|depois>` (Playwright, deviceScaleFactor 2; Campo e Gestão a 390 × 844, BKO e
> portal a 1366 × 768; `&alvo=1` desenha a área de toque do link).

## 1. Onde está hoje

| Tela | Arquivo | O que aparece embaixo | Destino |
|---|---|---|---|
| Entrar do Campo | `apps/mobile/src/app/login.tsx:217` passa `rodape=` para a `TelaLogin` (`modules/core/app/components/tela-login.tsx:118`, `t.small`, alinhado à esquerda) | "Macuxi Campo · vendedores e promotores" | **sai** |
| Entrar da Gestão | o mesmo `login.tsx:217`, variante `gestao` | "Macuxi Gestão · supervisores e gerentes" | **sai** |
| Entrar do BKO | `apps/web/components/login-screen.tsx` (`LoginReal`, última linha do formulário) | "Vendedores e promotores usam o app Macuxi Campo; supervisores, o Macuxi Gestão." | **fica**: diz a quem errou de lugar para onde ir (ação); não é o rodapé de identidade |
| Entrar do portal `config.` | `apps/web/components/portal/tela-entrar.tsx` (dentro do cartão da `MolduraEstreita`) | "Esqueceu a senha? Use "Esqueci a senha" no backoffice." | **fica** (ação) |

Nenhuma das quatro telas tem hoje razão social, CNPJ, versão, direitos ou site.

## 2. O rodapé (igual nas quatro telas)

Três linhas, centralizadas, nesta ordem:

```
{RAZÃO SOCIAL} · CNPJ {00.000.000/0000-00}
© 2026 · Todos os direitos reservados
Versão 1.0.8 · macuxifdv.com.br
```

- **Linha 1, empresa:** razão social e CNPJ (máscara `00.000.000/0000-00`). O CNPJ nunca quebra no meio: "CNPJ" e o número
  ficam juntos (espaço sem quebra ` ` depois de "CNPJ"). Se a razão social for longa, o CNPJ desce inteiro para a
  linha de baixo.
- **Linha 2, direitos:** `© <ano> · Todos os direitos reservados`. O ano é o do relógio do aparelho/navegador
  (`new Date().getFullYear()`); antes do login não há fuso de tenant, e a diferença só existiria por horas no 31/12.
- **Linha 3, versão e site:** `Versão X.Y.Z · macuxifdv.com.br`, com só o endereço como link para
  `https://macuxifdv.com.br`. Sem versão conhecida (desenvolvimento local), a linha fica só com o site; nunca "Versão ?".
- **Não repete o nome do produto:** o logo da faixa já diz "Macuxi Força de Vendas" e a faixa do BKO/portal já diz a área
  ("Backoffice", "Portal de implantação"). Nada de "Macuxi Campo", "app", "plataforma" ou explicação de funcionamento
  (R-20261110-093124, R-20261110-192153). O site aparece sem `https://` e sem `www`.

### 2.1 Visual

| Item | Celular (Campo, Gestão) | Web (BKO, portal) |
|---|---|---|
| Texto | `type.small`: IBM Plex Sans 12, altura de linha 16, `colors.ink2` #4A5562 | `text-[12px] leading-4 text-ink-2` |
| Contraste | #4A5562 no Pérola #F8F6F1 = **7,03:1** (AA e AAA para texto) | idem |
| Link | `colors.accentInk` #1E3350, semibold 12, **sublinhado** — 11,82:1 no Pérola. O sublinhado é obrigatório: entre o link e o texto ao lado a diferença de cor é pequena (WCAG 1.4.1) | `text-accent-ink font-semibold underline underline-offset-2` |
| Espaço entre linhas | 2 dp | `gap-0.5` |
| Alinhamento | centro, largura total menos 16 dp de cada lado | centro, `max-w-[440px]` |
| Posição | no pé da tela, como **último item** do bloco fixo `login.rodape` (abaixo dos avisos e do "Avançado"), com o respiro do `insets.bottom` que o bloco já tem | no pé da página: a moldura vira `min-h-screen flex flex-col` e o rodapé ganha `mt-auto pt-8 pb-6`; com janela baixa, fica no fluxo, depois do formulário (rola junto) |
| Teclado aberto (celular) | **some** enquanto o teclado está aberto (`teclado` que o `login.tsx` já calcula): o formulário tem prioridade | — |

Medidas nas simulações: no celular de 390 × 844, o formulário termina perto de 590 dp e o rodapé ocupa ~52 dp no pé;
sobra espaço. No BKO a 1366 × 768, o rodapé fica no pé da janela sem rolar.

### 2.2 Acessibilidade

- **Celular:** o bloco é um `View` com `accessibilityRole="text"` nas linhas 1 e 2 e o link separado:
  - linha 1: o leitor lê "{razão social}, CNPJ 00.000.000/0000-00" (o `·` vira vírgula no `accessibilityLabel`);
  - linha 2: `accessibilityLabel` "Copyright 2026. Todos os direitos reservados.";
  - link: `Pressable` com `accessibilityRole="link"`, `accessibilityLabel` "Abrir o site macuxifdv.com.br", abre com
    `Linking.openURL('https://macuxifdv.com.br')` no navegador do aparelho. **Área de toque ≥ 48 dp de altura** por
    `hitSlop` (16 em cima e embaixo, 8 dos lados), sem aumentar o desenho. Toque: escala 0,97 em 120 ms (padrão do kit).
- **Web:** `<footer>` (landmark `contentinfo`); link `<a href="https://macuxifdv.com.br" target="_blank"
  rel="noopener noreferrer">` com o texto visível "macuxifdv.com.br" e `aria-label` "macuxifdv.com.br (abre em nova
  aba)"; foco visível no padrão do kit (`focus-visible:outline-2 outline-accent`); área de clique de 44 px de altura com
  `py-[14px] -my-[14px]` (não muda o desenho). Ordem de tabulação: depois do último controle do formulário.
- Nada no rodapé é só cor: o link tem sublinhado.

## 3. Onde ficam os dados legais (um lugar só)

**`packages/ui/src/comum/legal.ts`** (designer-ux), exportado por `@macuxi/ui/mobile` e `@macuxi/ui/web`:

```ts
export const DADOS_LEGAIS = {
  razaoSocial: '{RAZÃO SOCIAL}',      // o dono do produto informa
  cnpj: '{00.000.000/0000-00}',       // o dono do produto informa (14 dígitos, com máscara)
  site: 'macuxifdv.com.br',
  urlSite: 'https://macuxifdv.com.br',
} as const;

/** As três linhas do rodapé; pura e testada (máscara do CNPJ, ano, versão ausente). */
export function linhasDoRodapeLegal(p: { versao?: string | null; ano: number }): {
  empresa: string | null; direitos: string; versao: string | null; site: string; url: string;
};
```

- **A razão social e o CNPJ não estão no repositório.** O dono do produto informa; até lá ficam os espaços reservados
  acima. **Não inventar dados.** Enquanto o valor for o espaço reservado (começa com `{`), `linhasDoRodapeLegal` devolve
  `empresa: null` e a linha 1 **não aparece** — assim a implementação segue sem levar o espaço reservado para a produção.
- O mesmo `DADOS_LEGAIS` serve, quando pedirem, ao rodapé dos PDFs, e-mails e site (uma fonte só).
- A versão **não** fica aqui: cada shell lê a sua (seção 4).

## 4. De onde vem a versão

- **App (Campo e Gestão):** `Constants.expoConfig?.version` (`expo-constants`, já usado em
  `apps/mobile/src/components/tela-de-erro.tsx` e `services/diagnostico.ts`), que o `apps/mobile/app.config.ts` preenche de
  `apps/mobile/scripts/eas/versao.json` (hoje `1.0.8`; fonte única das duas variantes). O kit não importa `expo-constants`:
  o shell passa `versao` como prop.
- **Web (BKO e portal, mesmo `apps/web`):** variável de build `NEXT_PUBLIC_VERSAO`, com o número da tag publicada sem o
  `v` (ex.: tag `v1.0.7` → `1.0.7`). `apps/web/package.json` (`0.1.0`) **não** serve: não acompanha as publicações.
  Caminho: `producao-publicar.yml` passa `MACUXI_VERSAO=<versão da tag>` como `build-arg` da imagem do BKO;
  `apps/web/Dockerfile` recebe `ARG MACUXI_VERSAO` e expõe `NEXT_PUBLIC_VERSAO=$MACUXI_VERSAO` no `next build`. Sem a
  variável (dev, demo), a linha 3 fica só com o site.

## 5. Quem implementa o quê

| Dono | Arquivo | O que muda |
|---|---|---|
| **designer-ux** | `packages/ui/src/comum/legal.ts` (+ `legal.test.ts`) | `DADOS_LEGAIS` e `linhasDoRodapeLegal` (seção 3) |
| **designer-ux** | `packages/ui/src/mobile/rodape-legal.tsx`, export em `mobile/index.ts` | `<RodapeLegal versao?: string | null />` (seção 2, celular), `testID="login.rodape-legal"` e `login.site` |
| **designer-ux** | `packages/ui/src/web/rodape-legal.tsx`, export em `web/index.ts` | `<RodapeLegal versao?: string | null className? />` (seção 2, web), `data-testid="rodape-legal"` |
| **engenheiro-apps** | `apps/mobile/src/app/login.tsx` | tira `rodape=` da `TelaLogin` (linha 217); põe `{!teclado ? <RodapeLegal versao={Constants.expoConfig?.version} /> : null}` como último filho do `View` `login.rodape`. Só na etapa Entrar (não em "Crie sua senha" nem "Esqueci a senha") |
| **engenheiro-apps** | `apps/mobile/src/components/login-tela.test.tsx:166` | troca a conferência do texto antigo pela presença de `login.rodape-legal` |
| **engenheiro-apps** | `apps/web/components/login-screen.tsx` | `Moldura` vira `min-h-screen flex flex-col`; `<RodapeLegal versao={process.env.NEXT_PUBLIC_VERSAO} className="mt-auto" />` na etapa Entrar (real e demonstração). A linha "Vendedores e promotores usam…" fica |
| **engenheiro-apps** | `apps/web/components/portal/base.tsx` e `portal/tela-entrar.tsx` | `MolduraEstreita` ganha a prop opcional `rodapeLegal` (só o Entrar liga; a "Escolha a empresa" não) |
| **engenheiro-apps** | `apps/web/Dockerfile`, `apps/web/next.config.ts` | `ARG MACUXI_VERSAO` → `NEXT_PUBLIC_VERSAO` (seção 4) |
| **engenheiro-software** | `.github/workflows/producao-publicar.yml` | `build-args`: `MACUXI_VERSAO=${{ needs.conferir.outputs.versao }}` sem o `v` |
| **modulo-core** | `modules/core/app/components/tela-login.tsx` | remove a prop `rodape` (linhas 23–24 e 118) **no mesmo lote** do `login.tsx`, para não haver dois rodapés nem typecheck quebrado |
| **dono do produto** | — | informa a razão social e o CNPJ (o designer-ux grava em `legal.ts`) |

## 6. Antes do lote e do build

- **Validação do design-de-marca** (mudança de layout nas quatro superfícies; R-20261112-065914): com estes PNG, antes do
  lote. Só o dono do produto aprova a marca.
- **Parecer do corretor-redundancias** sem achado em aberto, antes do lote (R-20261110-062506), olhando o print do
  aparelho. Pontos para ele conferir: o rodapé não repete o nome do produto do logo; a linha do BKO "Vendedores e
  promotores usam…" e a do portal "Esqueceu a senha?…" ficaram por serem ação, não identidade.
- **Revisão de UX** (designer-ux) das telas implementadas: contraste, alvo do link, teclado aberto, leitor de tela.
- Roteiro do testes: Campo e Gestão com e sem teclado; versão igual à do `versao.json`; toque no site abre o navegador;
  BKO e portal com e sem `NEXT_PUBLIC_VERSAO`; linha 1 ausente enquanto os dados legais forem o espaço reservado.

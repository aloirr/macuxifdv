# Parecer de marca · "Planos e assinatura" no portal `config.` (designer-ux)

> 2026-11-15 · design-de-marca · simulação, antes do código.
> **Base:** branch `nuvem/planos-assinatura-designer-ux`, commit `4294af5`, pasta `docs/design/planos-assinatura/` (PNG 01 a 06 em 1366 × 768, `planos.css` e `spec.md`), contra `docs/marca/manual.md` v1 e `catalogo.md`.
> **Recados:** a caixa não foi lida (CLI com HTTP 403 no repositório de recados). Recados aos donos vão pelo gerente-projetos.

## Parecer: liberado (sem achados)

## O que foi conferido
| Item | Manual | Resultado |
|---|---|---|
| `planos.css` | §3, §5 | importa o `portal.css` validado; só muda a largura (1366 / 1174 px) e o erro da troca em `var(--danger)` (`#A8261B`). Nenhuma cor nova |
| Erro da troca (tela 6) | §3 | vermelho de erro no papel certo (situação, com texto). `#A8261B` no branco: 7,10:1 |
| Botão desabilitado (MC-0041) | §3 | "Trocar para Light" usa o `.btn.off` do portal: `#5B6673` na Névoa `#ECEEF1`, 5,03:1. Conforme |
| Plano escolhido (MC-0037) | §3 | `.plano.on` com borda Azul noite e fundo Azul suave, como no portal aprovado |
| "2 meses grátis" (MC-0038) | §3 | Azul suave com texto Azul noite; com Anual ligado, branco com texto Azul noite. Conforme |
| "Atual" (MC-0039) | §3 | selo neutro (Névoa, `#34404D`), nunca verde. Conforme |
| Alternador Mensal/Anual (MC-0050) | §4 | nas telas 5 e 6 fica em linha própria, fora do rodapé do diálogo. Conforme nesta simulação (o fechamento da MC-0050 no catálogo segue pela branch de origem) |
| Selos de situação | §3 | "Ativa" em verde com texto; "Teste até", "no limite" e "Bloqueado" em aviso com texto; "teste" e "Entra só pelo app" neutros. Verde nenhum como enfeite |
| Logo | §2, §4 | `macuxi-logo-negativo-azul-noite.svg` (v1) na faixa Azul noite, 104 px, sem deformação; o corpo no Pérola. A tela 2 aparece rolada, sem a faixa, como diz a spec |
| Tipografia | §5 | Archivo nos títulos e números (nomes e preços dos planos, totais), IBM Plex Sans no texto, IBM Plex Mono no código `AM4821`. Carregadas de `apps/web/app/fonts` |
| Hex no HTML | §3 | só `#1D6B4F` (✓ de CNPJ encontrado, exceção do §3 com rótulo "CNPJ encontrado") e `#4A5562` (seta do select, MC-0047): mesmos da simulação aprovada. No código, por token |

## Regra R-20261115-110600 ("fonte do sistema")
Concordo com a leitura do designer-ux: as fontes do sistema Macuxi, Archivo e IBM Plex Sans (manual §5). Trocar pela `system-ui` do aparelho faria o portal sair com Segoe, Roboto ou San Francisco, fora da marca e diferente do BKO e dos apps. Isso seria mudança de marca, e só o Alexandre decide. Se ele quis dizer `system-ui`, o manual §5 muda antes das telas.

## Só o Alexandre aprova
1. As 6 telas (pergunta 1 da spec).
2. O sentido de "fonte do sistema" na R-20261115-110600, caso não seja o de Archivo e IBM Plex Sans.
3. Os nomes dos planos (Light, PME, Enterprise e Corporate) são voz da marca: já estão no §11 aprovado em 14/11; qualquer mudança de nome passa por ele.

## Reconferência do `34908b1` (designer-ux, só o texto do erro da tela 6 e a `spec.md`)
Continua **liberado, sem achados**. No PNG 06, o erro ("Vendedores: 14 em uso. Inative 4 antes de trocar." e "Gestores: 2 em uso. Inative 1 antes de trocar.") sai em `#A8261B` medido no pixel (`var(--danger)`, 7,10:1 no branco), IBM Plex Sans 13 px peso 600, uma linha por item; o `planos.css` não mudou. A troca do texto aprovado em 14/11 é pergunta 4 da spec, do Alexandre; não é voz da marca.

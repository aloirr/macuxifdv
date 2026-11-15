# Corretor de redundâncias: simulação "logo do cliente" (designer-ux), reteste

> 2026-11-15 (Manaus, UTC−4) · corretor-redundancias · pedido do gerente-projetos.

## Reteste

**Resultado: sem achado em aberto.** RD-0450 e RD-0451 **corrigidos**; nenhum achado novo (a faixa reservada RD-0600 a
RD-0609 não foi usada).

**Escopo:** branch `origin/nuvem/logo-cliente-designer-ux`, head `d832bc4a` (correções em `fd7dee77` e `d832bc4a`, sobre
`c6d5a4b4`, lido no relatório anterior). Lido o delta inteiro `git diff origin/main...origin/nuvem/logo-cliente-designer-ux`
(18 arquivos): `docs/design/telas/logo-cliente.md`, `carga.html`, `mais.html`, `portal.html`, `pdf-*.html`,
`logo-cliente.css`, o SVG fictício, os 8 PNG (abertos um a um) e a linha do diário do designer-ux. Decisão do dono do
produto conferida: carga só na variação A (logo ao lado) e login sem logo (R-20261114-234500).

### Fechamento

| RD | Severidade | Evidência no `d832bc4a` | Status |
|---|---|---|---|
| RD-0450 | baixa (doc) | `docs/design/telas/logo-cliente.md:16-18`: uma nota só, "**Decisões** (… MC-0066 e MC-0067 …): carga com a logo ao lado (§3), login e telas de senha sem logo (§4), placa 52/36 e nome fantasia no Mais (§5). O portal e os PDFs ficam como nesta simulação." Saíram a l.5 antiga (o nome fantasia segue só no §5, l.136) e as duas notas "Revisão" e "Decisão do dono do produto" | **corrigido** |
| RD-0451 | média (texto da simulação) | `docs/design/telas/logo-cliente/carga.html:61`: `<span aria-label="Etapa 2 de 5 · ${T.etapas[1]}"></span><b>38%</b>`. Nos prints `carga-campo.png` e `carga-gestao.png` (refeitos no `fd7dee77`, sem e com logo), a linha da barra mostra só "38%", e a etapa atual aparece uma vez, na lista ("Clientes e rota" no Campo, "Equipe" no Gestão). O progresso fica em 2 formas (percentual e barra), como no app (RD-0239) | **corrigido** |

### Auditoria do delta (sem achado)

- **Carga (Campo e Gestão, sem e com logo):** a única diferença entre as duas telas é a logo, como diz o §3. Elas mostram
  "Olá, Lucas", "38%", a barra e as 5 etapas, sem frase de explicação junto da logo.
- **Mais:** "Licenciado para Exemplo Norte" e a placa. A logo fica sem rótulo acessível porque a frase já diz o nome (§1),
  então o leitor não lê o nome duas vezes. Sem logo, só a frase.
- **Portal (tela e 6 estados):** um título "Logo", a caixa, os botões e uma linha de baixo (os limites **ou** o erro, nunca
  os dois). O diálogo "Remover a logo?" não tem corpo. Não há "sua marca aqui" nem "Choose File".
- **PDFs (pedido e orçamento, com e sem logo):** só a caixa da logo muda; o resto é o `buildOrderPdfHtml` do `main`.
- **Spec:** as regras de cada superfície ficam num lugar só (§1 a §6); a decisão do dono do produto, só na nota do topo.

Sem defeito funcional para o testes.

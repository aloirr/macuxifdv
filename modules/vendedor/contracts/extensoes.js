/**
 * Ponto de extensão de UI que o Vendedor OFERECE (ADR 0003; manifesto `ofereceExtensoes: ['pedido.criar_em_nome']`).
 *
 * `pedido.criar_em_nome` (RF-GES-05, RN-VEN-35) -> o Gestor (app Gestão) usa o motor de pedido do Vendedor para fazer o
 * pedido pelo vendedor. O Vendedor registra o item (`acao: 'pedido.criar_em_nome'`, só supervisor e gerente; `apps: ['gestao']`);
 * sem o Vendedor ativo o slot fica vazio e o botão do Gestor some sem erro (RN-CORE-03). `contracts` não depende de React.
 * `vendedor_id` = dono da venda (conta na meta e no ranking, RN-CORE-21); o autor é SEMPRE o usuário logado, que a API
 * confere pelo token (`autor_id` do contexto serve só para a tela). A API revalida equipe/área e a alçada do gestor.
 *
 * `pedido.equipe_em_nome` (T-0187, RN-CORE-04, RN-PRO-01) -> lista de quem pode ser o dono do pedido no campo "Em nome de".
 * Só o Gestor contribui (app Gestão), com os membros do escopo de quem está logado, lidos do aparelho; o Vendedor filtra
 * (só vendedor, sem o autor). Sem contribuição (Campo, ou Gestor desligado) a lista fica vazia. O Vendedor não importa o Gestor.
 */
import { z } from 'zod';
/** Membro do escopo de quem está logado, como o Gestor o entrega ao "Em nome de". */
export const MembroEquipeEmNomeSchema = z
    .object({
    usuario_id: z.string().uuid(),
    nome: z.string(),
    perfil: z.string(),
    equipe_id: z.string().uuid().nullable(),
    equipe_nome: z.string().nullable(),
    ativo: z.boolean(),
})
    .strict();
export const SLOTS_VENDEDOR = ['pedido.criar_em_nome', 'pedido.equipe_em_nome'];

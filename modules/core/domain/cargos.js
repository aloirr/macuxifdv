/**
 * Hierarquia do cadastro pelo cargo do perfil (ADR 0049; RN-CORE-54 um perfil por usuário, RN-CORE-55 hierarquia por cargo,
 * RN-CORE-56 promotor, RN-CORE-57 código no ERP; migração 0069). O que cada cargo pede é o `HIERARQUIA_DO_CARGO` do SDK; aqui
 * ficam as funções puras que a tela usa para mostrar e conferir os campos e que a API usa para revalidar:
 * - Vendedor: Supervisor obrigatório; o gerente é o do supervisor (derivado, não se escolhe).
 * - Promotor: Gerente obrigatório e Supervisor opcional; com supervisor, o gerente tem de ser o gerente dele (RN-CORE-56).
 * - Supervisor: Gerente e o nome da equipe que ele chefia, obrigatórios.
 * - Gerente: nome da equipe própria, opcional. Administrativo: sem hierarquia.
 */
import { HIERARQUIA_DO_CARGO } from '@macuxi/platform-sdk';
import { CODIGOS_HIERARQUIA, MENSAGENS_HIERARQUIA } from '../contracts/cargos';
/** O que o cargo pede (RN-CORE-55). Sem cargo, como o administrativo: nada. */
export const regrasDoCargo = (cargo) => HIERARQUIA_DO_CARGO[cargo ?? 'administrativo'];
/** Zera o que o cargo não usa (trocar o perfil na tela não deixa supervisor ou gerente "escondido" no corpo). */
export function hierarquiaDoCargo(cargo, h) {
    const r = regrasDoCargo(cargo);
    const nome = h.equipe_nome?.trim() ?? '';
    return {
        supervisor_id: r.supervisor !== 'nao' ? (h.supervisor_id ?? null) : null,
        gerente_id: r.gerente === 'obrigatorio' || r.gerente === 'opcional' ? (h.gerente_id ?? null) : null,
        equipe_nome: r.nomeEquipe !== 'nao' && nome !== '' ? nome : null,
    };
}
const erro = (campo, k) => ({ campo, codigo: CODIGOS_HIERARQUIA[k], mensagem: MENSAGENS_HIERARQUIA[k] });
/**
 * Erros da hierarquia pedida (RN-CORE-55/56), na ordem dos campos da tela. `pessoas` traz ao menos o supervisor e o gerente
 * escolhidos; quem não está nela, está inativo ou tem outro cargo é recusado. Lista vazia = pode gravar.
 */
export function errosDaHierarquia(cargo, pedida, pessoas) {
    const r = regrasDoCargo(cargo);
    const h = hierarquiaDoCargo(cargo, pedida);
    const de = (id) => (id ? pessoas.find((p) => p.id === id && p.ativo) : undefined);
    const erros = [];
    const sup = de(h.supervisor_id);
    if (r.supervisor === 'obrigatorio' && !h.supervisor_id)
        erros.push(erro('supervisor_id', 'supervisorObrigatorio'));
    else if (h.supervisor_id && sup?.cargo !== 'supervisor')
        erros.push(erro('supervisor_id', 'supervisorInvalido'));
    const ger = de(h.gerente_id);
    if (r.gerente === 'obrigatorio' && !h.gerente_id)
        erros.push(erro('gerente_id', 'gerenteObrigatorio'));
    else if (h.gerente_id && ger?.cargo !== 'gerente')
        erros.push(erro('gerente_id', 'gerenteInvalido'));
    else if (h.gerente_id && sup?.cargo === 'supervisor' && sup.gerente_id !== h.gerente_id)
        erros.push(erro('gerente_id', 'gerenteDoSupervisor'));
    if (r.nomeEquipe === 'obrigatorio' && !h.equipe_nome)
        erros.push(erro('equipe_nome', 'equipeObrigatoria'));
    return erros;
}
/** RN-CORE-57: o código no ERP é obrigatório ao criar e ao editar (a unicidade no tenant é da API e do banco). */
export const erroDoCodigoErp = (externalId) => ((externalId ?? '').trim() === '' ? erro('external_id', 'codigoErpObrigatorio') : null);
/** Gerente do usuário (RN-CORE-55): o do vendedor é o gerente do supervisor dele; promotor e supervisor têm o escolhido. */
export function gerenteDaHierarquia(cargo, pedida, pessoas) {
    const h = hierarquiaDoCargo(cargo, pedida);
    if (regrasDoCargo(cargo).gerente === 'derivado')
        return pessoas.find((p) => p.id === h.supervisor_id)?.gerente_id ?? null;
    return h.gerente_id;
}
/**
 * De quem é a equipe em que o usuário entra (contrato da 0069): vendedor → a do supervisor; promotor → a do supervisor, ou a do
 * gerente sem supervisor. Supervisor e gerente chefiam a equipe própria; administrativo: `null`.
 */
export function responsavelDaEquipe(cargo, pedida) {
    const h = hierarquiaDoCargo(cargo, pedida);
    if (cargo === 'vendedor')
        return h.supervisor_id;
    if (cargo === 'promotor')
        return h.supervisor_id ?? h.gerente_id;
    return null;
}
/** A equipe ativa chefiada por esta pessoa (a primeira por id, para ser estável), ou `null`. */
export function equipeChefiadaPor(equipes, pessoaId) {
    if (!pessoaId)
        return null;
    return [...equipes].filter((e) => e.responsavel_id === pessoaId).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

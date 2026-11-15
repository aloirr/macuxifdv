/**
 * RN-CORE-58 (T-0175): vínculo do vendedor do ERP ao usuário do BKO pelo código do ERP (`external_id`).
 * Regra: o vendedor que a carga do ERP criou como usuário PROVISÓRIO (e-mail `@sem-email.invalid`, carteira própria) é ligado
 * pelo admin a um usuário real do mesmo tenant e do mesmo perfil (vendedor com vendedor, promotor com promotor). O provisório
 * é liberado primeiro (external_id nulo, inativo; nunca excluído, RN-CORE-60) e só então o real ganha o `external_id`, recebe a carteira (sem duplicar cliente e papel que já tenha) e as demais referências
 * a `core.usuario`; o provisório fica inativo (RN-CORE-60), e cada cliente movido publica `core.cliente.atualizado@1`.
 * Recusa (422): quem não é provisório, provisório sem código, real com outro código, perfis incompatíveis, mesmo usuário,
 * tenants diferentes ou real que também é provisório. Repetir é idempotente. A carga seguinte nunca desfaz o vínculo
 * (casa pelo `external_id`, que agora é do real). Função pura, sem banco.
 */
export const SUFIXO_EMAIL_PROVISORIO = '@sem-email.invalid';
/** Provisório = e-mail gerado pela carga do ERP (`emailDoVendedorErp`) quando o vendedor veio sem e-mail. */
export const ehUsuarioProvisorio = (email) => email.trim().toLowerCase().endsWith(SUFIXO_EMAIL_PROVISORIO);
/** Tabelas e colunas que apontam para `core.usuario` e vão para o usuário real no vínculo (levantamento em db/migrations). */
export const REFERENCIAS_DO_VINCULO = [
    { tabela: 'core.carteira', coluna: 'usuario_id' },
    { tabela: 'core.nota_erp', coluna: 'usuario_id' },
    { tabela: 'core.rota', coluna: 'usuario_id' },
    { tabela: 'core.meta', coluna: 'usuario_id' },
    { tabela: 'core.indicador_diario', coluna: 'usuario_id' },
    { tabela: 'core.meta_produtividade', coluna: 'usuario_id' },
    { tabela: 'core.tarefa_destinatario', coluna: 'usuario_id' },
    { tabela: 'core.visita', coluna: 'usuario_id' },
    { tabela: 'core.deslocamento_dia', coluna: 'usuario_id' },
    { tabela: 'core.equipe', coluna: 'responsavel_id' },
];
export const CODIGOS_VINCULO = {
    naoProvisorio: 'VINCULO_NAO_PROVISORIO',
    semCodigoErp: 'VINCULO_SEM_CODIGO_ERP',
    realComOutroCodigo: 'VINCULO_REAL_COM_OUTRO_CODIGO',
    perfilIncompativel: 'VINCULO_PERFIL_INCOMPATIVEL',
    mesmoUsuario: 'VINCULO_MESMO_USUARIO',
    outroTenant: 'VINCULO_OUTRO_TENANT',
    realProvisorio: 'VINCULO_REAL_PROVISORIO',
    visitaAberta: 'VINCULO_VISITA_ABERTA',
};
const recusa = (codigo, mensagem) => ({ ok: false, codigo, mensagem });
export function planejarVinculoErp(e) {
    const { provisorio: p, real: r } = e;
    if (p.id === r.id)
        return recusa(CODIGOS_VINCULO.mesmoUsuario, 'Escolha um usuário diferente do vendedor provisório.');
    if (p.tenant_id !== r.tenant_id)
        return recusa(CODIGOS_VINCULO.outroTenant, 'Os dois usuários precisam ser da mesma empresa.');
    if (!ehUsuarioProvisorio(p.email))
        return recusa(CODIGOS_VINCULO.naoProvisorio, 'Este usuário não é provisório. Só o vendedor criado pela carga do ERP sem e-mail pode ser vinculado.');
    if (ehUsuarioProvisorio(r.email))
        return recusa(CODIGOS_VINCULO.realProvisorio, 'Escolha um usuário com e-mail real, não outro provisório.');
    // repetição: o provisório já foi liberado (external_id nulo, apagado) e o real já tem o código
    const jaCodigo = r.external_id?.trim() ?? '';
    if (p.vinculado && jaCodigo !== '') {
        return { ok: true, ja_vinculado: true, external_id: jaCodigo, provisorio_id: p.id, real_id: r.id, referencias: REFERENCIAS_DO_VINCULO, carteira_mover: [], carteira_descartar: [], desativar_provisorio: false, eventos_cliente: [] };
    }
    const codigo = p.external_id?.trim() ?? '';
    if (codigo === '')
        return recusa(CODIGOS_VINCULO.semCodigoErp, 'O vendedor provisório não tem Código no ERP. Confira o cadastro.');
    if (p.perfil !== r.perfil || (r.perfil !== 'vendedor' && r.perfil !== 'promotor'))
        return recusa(CODIGOS_VINCULO.perfilIncompativel, 'Os perfis não combinam. Vincule vendedor com vendedor e promotor com promotor.');
    if (e.visitaAbertaDoProvisorio)
        return recusa(CODIGOS_VINCULO.visitaAberta, 'O vendedor provisório tem uma visita aberta. Feche o check-in dele antes de vincular.');
    const base = { external_id: codigo, provisorio_id: p.id, real_id: r.id, referencias: REFERENCIAS_DO_VINCULO };
    if (r.external_id !== null && r.external_id.trim() !== '') {
        return recusa(CODIGOS_VINCULO.realComOutroCodigo, 'O usuário escolhido já tem outro Código no ERP. Limpe o código dele em Editar antes de vincular.');
    }
    const ja = new Set(e.carteiraReal.map((x) => `${x.cliente_id}|${x.papel}`));
    const mover = [];
    const descartar = [];
    const eventos = [];
    for (const l of e.carteiraProvisorio) {
        if (ja.has(`${l.cliente_id}|${l.papel}`)) {
            descartar.push(l.id);
            continue;
        }
        ja.add(`${l.cliente_id}|${l.papel}`);
        mover.push(l.id);
        if (!eventos.includes(l.cliente_id))
            eventos.push(l.cliente_id);
    }
    return { ok: true, ja_vinculado: false, ...base, carteira_mover: mover, carteira_descartar: descartar, desativar_provisorio: true, eventos_cliente: eventos };
}
/**
 * RN-CORE-58: o e-mail que a carga do ERP pode gravar num usuário que já casa pelo `external_id`. Só troca o e-mail PROVISÓRIO
 * por um e-mail real que ninguém usa; nunca troca e-mail real (o do usuário vinculado) e nunca grava o provisório por cima de um real.
 * Devolve `null` quando o e-mail fica como está.
 */
export function emailQueACargaPodeGravar(e) {
    if (e.erpProvisorio || !e.emailLivre)
        return null;
    return ehUsuarioProvisorio(e.emailAtual) ? e.emailDoErp : null;
}

/**
 * Cliente vindo do ERP (`integracao.cliente.atualizado@1`) para `core.cliente` (T-0060; RN-CORE-16/17, RN-INT-05/06).
 * Regra pura: o consumidor da API só executa o plano. O cadastro mínimo é calculado aqui (`cadastroCompleto`) e gravado em
 * `cadastro_incompleto`/`cadastro_campos_faltantes`; a linha automática de Observações é montada na exibição, nunca gravada.
 */
import { cadastroCompleto } from './cadastro';
const nulo = (v) => (v === undefined || v === null || v.trim() === '' ? null : v.trim());
export function planejarClienteDoErp(evento, exigidos, aplicadoAlteradoEm = null) {
    if (evento.acao === 'inativado')
        return { tipo: 'inativar', external_id: evento.external_id, alterado_em: evento.registro?.alterado_em ?? null };
    const r = evento.registro;
    if (!r)
        return { tipo: 'ignorar', motivo: 'sem_registro' };
    if (aplicadoAlteradoEm && Date.parse(r.alterado_em) < Date.parse(aplicadoAlteradoEm))
        return { tipo: 'ignorar', motivo: 'mais_antigo_que_o_aplicado' };
    const e = r.endereco ?? {};
    const digitosDoc = (r.documento ?? '').replace(/\D/g, '');
    const uf = nulo(e.uf)?.toUpperCase() ?? null;
    const cepDigitos = (e.cep ?? '').replace(/\D/g, '');
    const linha = {
        external_id: evento.external_id,
        razao_social: r.razao_social.trim(),
        nome_fantasia: nulo(r.nome_fantasia),
        documento: digitosDoc.length === 11 || digitosDoc.length === 14 ? digitosDoc : null,
        inscricao_estadual: nulo(r.inscricao_estadual),
        observacao: nulo(r.observacao) === null ? null : r.observacao,
        telefone: nulo(r.telefone),
        email: nulo(r.email),
        logradouro: nulo(e.logradouro),
        numero: nulo(e.numero),
        bairro: nulo(e.bairro),
        cidade: nulo(e.cidade),
        uf: uf !== null && /^[A-Z]{2}$/.test(uf) ? uf : null,
        // CEP que não tem 8 dígitos fica nulo: a coluna só guarda dígitos e o cadastro acusa a falta
        cep: cepDigitos.length === 8 ? cepDigitos : null,
        latitude: r.latitude ?? null,
        longitude: r.longitude ?? null,
        ativo: r.ativo !== false,
        alterado_em: r.alterado_em,
    };
    const { completo, campos_faltantes } = cadastroCompleto({ ...linha, complemento: nulo(e.complemento) }, exigidos);
    return { tipo: 'upsert', linha: { ...linha, cadastro_incompleto: !completo, cadastro_campos_faltantes: campos_faltantes } };
}
/**
 * RN-CORE-78, RN-INT-04 (ADR 0069 item 10): carga do ERP com um CPF/CNPJ que já está noutro cliente. Pré-cadastro (Campo ou BKO) ainda
 * sem código = o ERP está criando esse cliente: espera o vínculo (`ReferenciaAusenteErp`, a outbox repete) em vez de duplicar; depois do
 * vínculo o upsert pelo código atualiza o próprio pré-cadastro. Outro dono = a carga entra sem documento (cadastro incompleto), como antes.
 */
export function decidirDocumentoDoErp(dono, externalIdDoEvento) {
    if (!dono || dono.external_id === externalIdDoEvento)
        return 'seguir';
    if (dono.origem_cadastro !== 'erp' && dono.external_id === null)
        return 'esperar_vinculo';
    return 'sem_documento';
}

/**
 * Cadastro mínimo do cliente (RN-CORE-16 e RN-CORE-17; T-0060). Funções puras: a integração (Hub), a edição no BKO e a
 * sincronização usam as mesmas. Entrada própria do domain (`DadosCadastro`), a lista de campos vem de contracts/cadastro (fonte única).
 */
import { cnpjValido, cpfValido, tipoDocumento } from '@macuxi/comum';
import { CAMPOS_CADASTRO_CLIENTE, CAMPOS_CADASTRO_PADRAO } from '../contracts/cadastro';
// A lista de campos mora em contracts (fonte única); o domain reexporta.
export { CAMPOS_CADASTRO_CLIENTE, CAMPOS_CADASTRO_PADRAO };
export const ROTULO_CAMPO_CADASTRO = {
    razao_social: 'razão social',
    documento: 'CNPJ/CPF',
    inscricao_estadual: 'inscrição estadual',
    logradouro: 'logradouro',
    numero: 'número',
    bairro: 'bairro',
    cidade: 'município',
    uf: 'UF',
    cep: 'CEP',
    nome_fantasia: 'nome fantasia',
    telefone: 'telefone',
    email: 'e-mail',
    complemento: 'complemento',
    geolocalizacao: 'geolocalização',
};
const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
const CAMPOS_FIXOS = ['razao_social', 'documento'];
/**
 * RN-CORE-16: lista efetiva do tenant a partir do parâmetro `cliente_campos_obrigatorios`. Ausente, inválido ou vazio =
 * padrão; códigos desconhecidos são ignorados; razão social e CNPJ/CPF entram sempre (o tenant não pode tirá-los).
 * Resultado sem duplicados, na ordem canônica.
 */
export function camposExigidos(parametro) {
    const conhecidos = new Set(CAMPOS_CADASTRO_CLIENTE);
    const lista = Array.isArray(parametro) ? parametro.filter((c) => typeof c === 'string' && conhecidos.has(c)) : [];
    const base = lista.length > 0 ? lista : CAMPOS_CADASTRO_PADRAO;
    const conjunto = new Set([...base, ...CAMPOS_FIXOS]);
    return CAMPOS_CADASTRO_CLIENTE.filter((c) => conjunto.has(c));
}
const preenchido = (v) => typeof v === 'string' && v.trim() !== '';
const digitos = (v) => v.replace(/\D/g, '');
function campoPreenchido(campo, d) {
    switch (campo) {
        case 'documento':
            return preenchido(d.documento) && (cnpjValido(d.documento) || cpfValido(d.documento));
        case 'inscricao_estadual':
            return preenchido(d.inscricao_estadual);
        case 'uf':
            return preenchido(d.uf) && UFS.has(d.uf.trim().toUpperCase());
        case 'cep':
            return preenchido(d.cep) && digitos(d.cep).length === 8;
        case 'geolocalizacao':
            return typeof d.latitude === 'number' && typeof d.longitude === 'number';
        default:
            return preenchido(d[campo]);
    }
}
/**
 * RN-CORE-16: confere o cadastro contra a lista exigida. Texto vazio ou só espaço = ausente; CNPJ/CPF com dígito
 * verificador inválido = ausente; a IE ("isento" vale) só é exigida quando o documento é um CNPJ válido. O CNPJ/CPF é
 * sempre exigido, mesmo que a lista recebida não o traga. `campos_faltantes` sai na ordem canônica.
 */
export function cadastroCompleto(cliente, exigidos) {
    const lista = new Set([...exigidos, 'documento']);
    const ehPj = tipoDocumento(cliente.documento) === 'cnpj';
    const campos_faltantes = CAMPOS_CADASTRO_CLIENTE.filter((campo) => {
        if (!lista.has(campo))
            return false;
        if (campo === 'inscricao_estadual' && !ehPj)
            return false;
        return !campoPreenchido(campo, cliente);
    });
    return { completo: campos_faltantes.length === 0, campos_faltantes };
}
const LINHA_AUTOMATICA = /^Cadastro incompleto: falta [^\r\n]*?\.( Pedido só como orçamento até o cadastro ser completado no ERP\.)?(\r?\n|$)/;
/**
 * RN-CORE-17: Observações exibida = linha automática no topo + texto do ERP intacto. Refeita a cada chamada (uma linha
 * automática antiga recebida na entrada é descartada, nunca acumulada) e ausente quando não há campos faltantes.
 * Montada na exibição; nunca gravada. Código de campo desconhecido aparece como veio.
 */
export function observacaoComCadastro(observacao, faltantes) {
    const original = (observacao ?? '').replace(LINHA_AUTOMATICA, '');
    const texto = original.trim() === '' ? null : original;
    if (faltantes.length === 0)
        return texto;
    const nomes = faltantes.map((c) => (c in ROTULO_CAMPO_CADASTRO ? ROTULO_CAMPO_CADASTRO[c] : c));
    const linha = `Cadastro incompleto: falta ${nomes.join(', ')}.`;
    return texto === null ? linha : `${linha}\n${texto}`;
}

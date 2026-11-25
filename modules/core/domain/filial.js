/**
 * Filial (RN-CORE-39; T-0149; ADR 0040). Funções puras, sem banco.
 * - A empresa nasce com uma filial padrão; cada cliente tem uma filial (sem informação, a padrão).
 * - Cadastro (BKO): código (1 a 20, único entre as vivas), nome (1 a 80), cidade (1 a 80) e UF válida.
 * - A padrão não é inativada nem apagada; filial com cliente ativo não é inativada.
 * - Cliente que veio do ERP (`external_id`) tem a filial do ERP: o BKO não a troca.
 */
import { cnpjValido, somenteDigitos } from '@macuxi/comum/documento';
import { cepValido, ehUf, normalizarCep } from '@macuxi/comum/endereco';
import { CAMPOS_FISCAIS_FILIAL, CAMPOS_OBRIGATORIOS_FILIAL, LIMITES_FILIAL } from '../contracts/filial';
export const CODIGO_FILIAL_MAX = 20;
export const NOME_FILIAL_MAX = 80;
export const CIDADE_FILIAL_MAX = 80;
const erro = (codigo, mensagem) => ({ ok: false, codigo, mensagem });
/** RN-CORE-39: filial do cliente viva e ativa vale; nula, apagada (fora da lista) ou inativa cai na padrão. Sempre devolve uma filial. */
export function filialEfetiva(filialIdDoCliente, filiais) {
    const propria = filialIdDoCliente ? filiais.find((f) => f.id === filialIdDoCliente && f.ativo) : undefined;
    if (propria)
        return propria;
    const padrao = filiais.find((f) => f.padrao);
    if (!padrao)
        throw new Error('RN-CORE-39: o tenant não tem filial padrão.');
    return padrao;
}
/** RN-CORE-39: cliente com `external_id` veio do ERP e a filial dele vem do ERP; sem `external_id` o BKO edita. */
export function podeEditarFilialDoCliente(cliente) {
    return !cliente.external_id;
}
/** RN-CORE-39: "0002 · Boa Vista/RR"; sem cidade, "0001 · Filial padrão". */
export function rotuloDaFilial(f) {
    const lugar = f.cidade ? (f.uf ? `${f.cidade}/${f.uf}` : f.cidade) : f.nome;
    return `${f.codigo} · ${lugar}`;
}
const ROTULO_FALTA = {
    cnpj: 'o CNPJ',
    logradouro: 'o logradouro',
    numero: 'o número',
    bairro: 'o bairro',
    cep: 'o CEP',
    cidade: 'a cidade',
    uf: 'a UF',
};
/**
 * RN-CORE-39 (RD-0116): o que falta no cadastro da filial, com o rótulo ("o CNPJ", "a cidade"...), na ordem de `CAMPOS_OBRIGATORIOS_FILIAL`.
 * Fonte única da regra "filial completa": o `validarFilial`, o aviso `incompleta` da API e o formulário do BKO usam esta função.
 * Só olha a presença (a validade do CNPJ e do CEP é do `validarFilial`). Complemento e telefone são opcionais.
 */
export function faltasNoCadastroDaFilial(f) {
    return CAMPOS_OBRIGATORIOS_FILIAL.filter((c) => (f[c] ?? '').trim() === '').map((c) => ROTULO_FALTA[c]);
}
/**
 * RN-CORE-39: valida o cadastro da filial no BKO. `nova.id` igual ao de uma existente = edição dela (não conta como duplicada).
 * `clientesAtivos` é a contagem de clientes ativos que apontam para a filial (inativar com cliente ativo é recusado).
 */
export function validarFilial(nova, existentes, opcoes = {}) {
    const codigo = (nova.codigo ?? '').trim();
    const nome = (nova.nome ?? '').trim();
    const cidade = (nova.cidade ?? '').trim();
    const uf = (nova.uf ?? '').trim().toUpperCase();
    if (codigo === '' || codigo.length > CODIGO_FILIAL_MAX)
        return erro('FILIAL_INVALIDA', `Informe o código da filial, com até ${CODIGO_FILIAL_MAX} caracteres.`);
    if (nome === '' || nome.length > NOME_FILIAL_MAX)
        return erro('FILIAL_INVALIDA', `Informe o nome da filial, com até ${NOME_FILIAL_MAX} caracteres.`);
    if (cidade === '' || cidade.length > CIDADE_FILIAL_MAX)
        return erro('FILIAL_INVALIDA', `Informe a cidade da filial, com até ${CIDADE_FILIAL_MAX} caracteres.`);
    if (!ehUf(uf))
        return erro('FILIAL_INVALIDA', 'Informe a UF da filial com 2 letras (ex.: AM, RR).');
    // T-0159 / RN-CORE-39: CNPJ e endereço obrigatórios ao cadastrar ou editar o cadastro; telefone e complemento opcionais.
    // `exigirCadastro: false` só para mudar situação/padrão de filial antiga (ainda sem esses dados).
    const cnpj = somenteDigitos(nova.cnpj);
    const logradouro = (nova.logradouro ?? '').trim();
    const numero = (nova.numero ?? '').trim();
    const complemento = (nova.complemento ?? '').trim();
    const bairro = (nova.bairro ?? '').trim();
    const cep = normalizarCep(nova.cep);
    const telefone = (nova.telefone ?? '').trim();
    if (opcoes.exigirCadastro !== false) {
        const faltam = faltasNoCadastroDaFilial({ cidade, uf, cnpj, logradouro, numero, bairro, cep });
        if (faltam.length > 0)
            return erro('FILIAL_INVALIDA', `Informe ${faltam.join(', ')} da filial. Sem CNPJ e endereço a filial não é cadastrada.`);
        if (!cnpjValido(cnpj))
            return erro('FILIAL_INVALIDA', 'O CNPJ da filial é inválido. Confira os 14 dígitos.');
        if (!cepValido(cep))
            return erro('FILIAL_INVALIDA', 'O CEP da filial é inválido. Informe os 8 dígitos.');
    }
    const limites = [
        ['logradouro', logradouro, LIMITES_FILIAL.logradouro],
        ['número', numero, LIMITES_FILIAL.numero],
        ['complemento', complemento, LIMITES_FILIAL.complemento],
        ['bairro', bairro, LIMITES_FILIAL.bairro],
        ['telefone', telefone, LIMITES_FILIAL.telefone],
    ];
    for (const [rotulo, valor, max] of limites)
        if (valor.length > max)
            return erro('FILIAL_INVALIDA', `O ${rotulo} da filial aceita até ${max} caracteres.`);
    if (existentes.some((f) => f.id !== nova.id && f.codigo.trim().toLowerCase() === codigo.toLowerCase())) {
        return erro('FILIAL_DUPLICADA', `Já existe uma filial com o código ${codigo}. Use outro código ou edite a existente.`);
    }
    const ativo = nova.ativo ?? true;
    const atual = existentes.find((f) => f.id === nova.id);
    if (!ativo && atual?.padrao)
        return erro('FILIAL_PADRAO', 'A filial padrão não pode ser inativada. Marque outra como padrão antes.');
    if (!ativo && atual?.ativo && (opcoes.clientesAtivos ?? 0) > 0)
        return erro('FILIAL_EM_USO', 'Mude os clientes de filial antes de inativar.');
    return {
        ok: true,
        filial: { codigo, nome, cidade, uf, ativo, cnpj: cnpj || null, logradouro: logradouro || null, numero: numero || null, complemento: complemento || null, bairro: bairro || null, cep: cep || null, telefone: telefone || null },
    };
}
/**
 * T-0159 / RN-CORE-39: o que a carga `filial` do ERP traz de CNPJ, endereço e telefone, só com valor (ausente ou em branco = não apaga o que o BKO preencheu).
 * CNPJ ou CEP inválido fica de fora e é relatado em `invalidos` (o consumidor registra o aviso).
 */
export function dadosFiscaisDoErp(registro) {
    const dados = {};
    const invalidos = [];
    const cnpj = somenteDigitos(registro.cnpj);
    if (cnpj !== '') {
        if (cnpjValido(cnpj))
            dados.cnpj = cnpj;
        else
            invalidos.push('cnpj');
    }
    const cep = normalizarCep(registro.cep);
    if (cep !== '') {
        if (cepValido(cep))
            dados.cep = cep;
        else
            invalidos.push('cep');
    }
    for (const c of CAMPOS_FISCAIS_FILIAL.filter((k) => k !== 'cnpj' && k !== 'cep')) {
        const v = (registro[c] ?? '').trim();
        if (v !== '')
            dados[c] = v;
    }
    return { dados, invalidos };
}
/** RN-CORE-39: a filial padrão não se apaga; filial com cliente também não. */
export function decidirApagarFilial(f, clientes) {
    if (f.padrao)
        return erro('FILIAL_PADRAO', 'A filial padrão não pode ser apagada. Marque outra como padrão antes.');
    if (clientes > 0)
        return erro('FILIAL_EM_USO', 'Mude os clientes de filial antes de apagar.');
    return { ok: true };
}
/**
 * RN-CORE-39 (T-0149): o que o ERP mandou da filial do cliente. `filial_external_id` ausente = não altera (`{}`); `null` (ou em branco)
 * = filial padrão da empresa; texto = a filial com essa chave do ERP (a ordem de carga põe `filial` antes de `cliente`).
 */
export function filialDoClienteDoErp(registro) {
    if (!('filial_external_id' in registro) || registro.filial_external_id === undefined)
        return {};
    const chave = registro.filial_external_id?.trim();
    return { filial_external_id: chave ? chave : null };
}

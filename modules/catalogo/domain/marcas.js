/**
 * Marcas concorrentes da referência cruzada (RN-CAT-09). O cadastro é do próprio Catálogo (Marcas concorrentes, RN-CAT-13,
 * ADR 0034); aqui só as regras puras: validar o `marca_id` do PUT, casar a marca que vem do ERP (doc 06) e resolver os códigos
 * de "Oferece junto" digitados no BKO (RN-CAT-09, T-0085).
 */
import { LIMITES_CADASTRO_CATALOGO } from './cadastro-catalogo';
import { chaveDoNomeMarca, nomeMarcaIgual } from './marcas-cadastro';
import { codigoCompacto } from './ranking';
const MSG_SEM_MARCAS = 'Não há marcas concorrentes ativas. Cadastre a marca em Catálogo → Marcas concorrentes ou salve o produto sem referência cruzada.';
/** Cada referência precisa apontar para uma marca ativa de Marcas concorrentes. Mapa vazio = consulta indisponível ou sem marcas. */
export function validarMarcasDaReferencia(referencias, marcas) {
    if (referencias.length === 0)
        return [];
    if (marcas.size === 0)
        return [{ regra: 'RN-CAT-09', campo: 'referencias', mensagem: MSG_SEM_MARCAS }];
    const erros = [];
    for (const r of referencias) {
        const m = marcas.get(r.marca_id);
        if (!m)
            erros.push({ regra: 'RN-CAT-09', campo: 'referencias', mensagem: 'Uma marca da referência não existe mais em Marcas concorrentes. Escolha outra marca da lista e salve de novo.' });
        else if (!m.ativo)
            erros.push({ regra: 'RN-CAT-09', campo: 'referencias', mensagem: `A marca ${m.nome} está inativa em Marcas concorrentes. Ative a marca ou escolha outra e salve de novo.` });
    }
    return erros;
}
/**
 * Doc 06: a marca vem do ERP pelo `external_id` ou pelo nome da marca cadastrada em Marcas concorrentes. Marca desconhecida
 * (ou inativa) descarta a referência, que o consumidor avisa no log; até 3 por produto, código de 1 a 30, sem repetir.
 */
export function resolverReferenciasDoErp(entrada, marcas) {
    const L = LIMITES_CADASTRO_CATALOGO;
    const saida = { referencias: [], descartadas: [] };
    const vistas = new Set();
    for (const e of entrada) {
        const codigo = e.codigo.trim();
        const ext = e.marca_external_id?.trim();
        const nome = e.marca_nome?.trim() ?? '';
        const marca = (ext ? marcas.find((m) => m.external_id === ext) : undefined) ?? (nome ? marcas.find((m) => nomeMarcaIgual(m.nome, nome)) : undefined);
        const compacto = codigoCompacto(codigo);
        if (codigo === '' || codigo.length > L.codigo || compacto === '')
            saida.descartadas.push({ codigo, motivo: 'codigo_invalido' });
        else if (!marca)
            saida.descartadas.push({ codigo, motivo: 'marca_desconhecida' });
        else if (!marca.ativo)
            saida.descartadas.push({ codigo, motivo: 'marca_inativa' });
        else if (vistas.has(`${marca.id}:${compacto}`))
            saida.descartadas.push({ codigo, motivo: 'repetida' });
        else if (saida.referencias.length >= L.referencias)
            saida.descartadas.push({ codigo, motivo: 'excede_limite' });
        else {
            vistas.add(`${marca.id}:${compacto}`);
            saida.referencias.push({ marca_id: marca.id, marca_nome: marca.nome, codigo });
        }
    }
    return saida;
}
/** "Oferece junto" digitado por código: acha o produto ativo pelo código ERP sem diferenciar maiúsculas (RN-CAT-09). */
export function resolverCodigosOfereceJunto(codigos, produtos) {
    const porCodigo = new Map(produtos.filter((p) => p.ativo).map((p) => [p.sku.trim().toLowerCase(), p.id]));
    const ids = [];
    const naoEncontrados = [];
    for (const c of codigos) {
        const id = porCodigo.get(c.trim().toLowerCase());
        if (id)
            ids.push(id);
        else
            naoEncontrados.push(c);
    }
    return { ids, naoEncontrados };
}
/**
 * Nome da marca de uma referência cruzada (RN-CAT-09). Com o cadastro de marcas disponível (mapa não vazio) ele manda:
 * marca inativa ou ausente esconde a referência (nulo). Sem o cadastro (ex.: aparelho que ainda não baixou as marcas) usa o retrato `marca_nome` gravado na referência; sem retrato (linha anterior à 0034), nulo — não mostra a marca.
 */
export function nomeMarcaDaReferencia(marcaId, retrato, marcas) {
    if (marcas.size > 0) {
        const m = marcas.get(marcaId);
        return m && m.ativo ? m.nome : null;
    }
    const r = retrato?.trim();
    return r ? r : null;
}
/**
 * T-0103 / RN-CAT-09: marcas citadas pela linha do ERP que Marcas concorrentes não conhece (descarte `marca_desconhecida`), como vieram
 * (nome, ou o external_id se não houve nome), sem repetir (sem caixa/acento) e até 3. Nenhuma = `null` (não há aviso).
 */
export function marcasDesconhecidasDaLinha(entrada, descartadas) {
    const marcas = [];
    const vistas = new Set();
    let externalId;
    for (const d of descartadas) {
        if (d.motivo !== 'marca_desconhecida')
            continue;
        const e = entrada.find((x) => x.codigo.trim() === d.codigo);
        const bruta = (e?.marca_nome?.trim() || e?.marca_external_id?.trim() || '').slice(0, 120);
        if (bruta === '' || vistas.has(chaveDoNomeMarca(bruta)) || marcas.length >= 3)
            continue;
        vistas.add(chaveDoNomeMarca(bruta));
        marcas.push(bruta);
        externalId ??= e?.marca_external_id?.trim() || undefined;
    }
    return marcas.length === 0 ? null : externalId ? { marcas, marca_external_id: externalId } : { marcas };
}

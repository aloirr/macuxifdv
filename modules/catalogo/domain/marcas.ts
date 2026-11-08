/**
 * Marcas concorrentes da referência cruzada (RN-CAT-09). O cadastro é do Promotor (`promotor.concorrentes@1`, ADR 0012 e
 * 0027); aqui só as regras puras: validar o `marca_id` do PUT, casar a marca que vem do ERP (doc 06) e resolver os códigos
 * de "Oferece junto" digitados no BKO (RN-CAT-09, T-0085).
 */
import { LIMITES_CADASTRO_CATALOGO, type ErroCadastro } from './cadastro-catalogo';
import { codigoCompacto } from './ranking';

export type MapaMarcas = ReadonlyMap<string, { nome: string; ativo: boolean }>;

const MSG_SEM_MARCAS =
  'Não há marcas concorrentes ativas. Cadastre a marca em Catálogo → Marcas concorrentes ou salve o produto sem referência cruzada.';

/** Cada referência precisa apontar para uma marca ativa do Promotor. Mapa vazio = consulta indisponível ou sem marcas. */
export function validarMarcasDaReferencia(referencias: readonly { marca_id: string }[], marcas: MapaMarcas): ErroCadastro[] {
  if (referencias.length === 0) return [];
  if (marcas.size === 0) return [{ regra: 'RN-CAT-09', campo: 'referencias', mensagem: MSG_SEM_MARCAS }];
  const erros: ErroCadastro[] = [];
  for (const r of referencias) {
    const m = marcas.get(r.marca_id);
    if (!m) erros.push({ regra: 'RN-CAT-09', campo: 'referencias', mensagem: 'Uma marca da referência não existe mais no cadastro de concorrentes. Escolha outra marca da lista e salve de novo.' });
    else if (!m.ativo) erros.push({ regra: 'RN-CAT-09', campo: 'referencias', mensagem: `A marca ${m.nome} está inativa em Marcas concorrentes. Ative a marca ou escolha outra e salve de novo.` });
  }
  return erros;
}

export interface MarcaDoPromotor {
  id: string;
  nome: string;
  ativo: boolean;
  external_id: string | null;
}

export interface ReferenciaDoErp {
  marca_external_id?: string | null | undefined;
  marca_nome?: string | null | undefined;
  codigo: string;
}

export type MotivoDescarte = 'marca_desconhecida' | 'marca_inativa' | 'codigo_invalido' | 'repetida' | 'excede_limite';

export interface ResolucaoReferenciasErp {
  referencias: { marca_id: string; marca_nome: string; codigo: string }[];
  descartadas: { codigo: string; motivo: MotivoDescarte }[];
}

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/**
 * Doc 06: a marca vem do ERP pelo `external_id` ou pelo nome do concorrente cadastrado no Promotor. Marca desconhecida
 * (ou inativa) descarta a referência, que o consumidor avisa no log; até 3 por produto, código de 1 a 30, sem repetir.
 */
export function resolverReferenciasDoErp(entrada: readonly ReferenciaDoErp[], marcas: readonly MarcaDoPromotor[]): ResolucaoReferenciasErp {
  const L = LIMITES_CADASTRO_CATALOGO;
  const saida: ResolucaoReferenciasErp = { referencias: [], descartadas: [] };
  const vistas = new Set<string>();
  for (const e of entrada) {
    const codigo = e.codigo.trim();
    const ext = e.marca_external_id?.trim();
    const nome = e.marca_nome ? semAcento(e.marca_nome) : '';
    const marca = (ext ? marcas.find((m) => m.external_id === ext) : undefined) ?? (nome ? marcas.find((m) => semAcento(m.nome) === nome) : undefined);
    const compacto = codigoCompacto(codigo);
    if (codigo === '' || codigo.length > L.codigo || compacto === '') saida.descartadas.push({ codigo, motivo: 'codigo_invalido' });
    else if (!marca) saida.descartadas.push({ codigo, motivo: 'marca_desconhecida' });
    else if (!marca.ativo) saida.descartadas.push({ codigo, motivo: 'marca_inativa' });
    else if (vistas.has(`${marca.id}:${compacto}`)) saida.descartadas.push({ codigo, motivo: 'repetida' });
    else if (saida.referencias.length >= L.referencias) saida.descartadas.push({ codigo, motivo: 'excede_limite' });
    else {
      vistas.add(`${marca.id}:${compacto}`);
      saida.referencias.push({ marca_id: marca.id, marca_nome: marca.nome, codigo });
    }
  }
  return saida;
}

/** "Oferece junto" digitado por código: acha o produto ativo pelo código ERP sem diferenciar maiúsculas (RN-CAT-09). */
export function resolverCodigosOfereceJunto(codigos: readonly string[], produtos: readonly { id: string; sku: string; ativo: boolean }[]): { ids: string[]; naoEncontrados: string[] } {
  const porCodigo = new Map(produtos.filter((p) => p.ativo).map((p) => [p.sku.trim().toLowerCase(), p.id]));
  const ids: string[] = [];
  const naoEncontrados: string[] = [];
  for (const c of codigos) {
    const id = porCodigo.get(c.trim().toLowerCase());
    if (id) ids.push(id);
    else naoEncontrados.push(c);
  }
  return { ids, naoEncontrados };
}

/**
 * Nome da marca de uma referência cruzada (RN-CAT-09). Com o cadastro do Promotor disponível (mapa não vazio) ele manda:
 * marca inativa ou ausente esconde a referência (nulo). Sem o cadastro (vendedor sem o Promotor no perfil, risco 2 da
 * ADR 0027) usa o retrato `marca_nome` gravado na referência; sem retrato (linha anterior à 0034), nulo — não mostra a marca.
 */
export function nomeMarcaDaReferencia(marcaId: string, retrato: string | null | undefined, marcas: MapaMarcas): string | null {
  if (marcas.size > 0) {
    const m = marcas.get(marcaId);
    return m && m.ativo ? m.nome : null;
  }
  const r = retrato?.trim();
  return r ? r : null;
}

/**
 * T-0103 / RN-CAT-09: marcas citadas pela linha do ERP que o Promotor não conhece (descarte `marca_desconhecida`), como vieram
 * (nome, ou o external_id se não houve nome), sem repetir (sem caixa/acento) e até 3. Nenhuma = `null` (não há aviso).
 */
export function marcasDesconhecidasDaLinha(
  entrada: readonly ReferenciaDoErp[],
  descartadas: readonly { codigo: string; motivo: MotivoDescarte }[],
): { marcas: string[]; marca_external_id?: string } | null {
  const marcas: string[] = [];
  const vistas = new Set<string>();
  let externalId: string | undefined;
  for (const d of descartadas) {
    if (d.motivo !== 'marca_desconhecida') continue;
    const e = entrada.find((x) => x.codigo.trim() === d.codigo);
    const bruta = (e?.marca_nome?.trim() || e?.marca_external_id?.trim() || '').slice(0, 120);
    if (bruta === '' || vistas.has(semAcento(bruta)) || marcas.length >= 3) continue;
    vistas.add(semAcento(bruta));
    marcas.push(bruta);
    externalId ??= e?.marca_external_id?.trim() || undefined;
  }
  return marcas.length === 0 ? null : externalId ? { marcas, marca_external_id: externalId } : { marcas };
}

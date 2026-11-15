/**
 * Marcas concorrentes da referência cruzada (RN-CAT-09). O cadastro é do próprio Catálogo (Marcas concorrentes, RN-CAT-13,
 * ADR 0034); aqui só as regras puras: validar o `marca_id` do PUT, casar a marca que vem do ERP (doc 06) e resolver os códigos
 * de "Oferece junto" digitados no BKO (RN-CAT-09, T-0085).
 */
import type { Referencia } from '../contracts';
import { LIMITES_CADASTRO_CATALOGO, type ErroCadastro } from './cadastro-catalogo';
import { chaveDoNomeMarca, nomeMarcaIgual } from './marcas-cadastro';
import { codigoCompacto } from './ranking';

export type MapaMarcas = ReadonlyMap<string, { nome: string; ativo: boolean }>;

const MSG_SEM_MARCAS =
  'Não há marcas concorrentes ativas. Cadastre a marca em Catálogo → Marcas concorrentes ou escolha "Sem marca".';

/** Cada referência precisa apontar para uma marca ativa de Marcas concorrentes. Mapa vazio = consulta indisponível ou sem marcas. */
export function validarMarcasDaReferencia(referencias: readonly { marca_id?: string | null | undefined }[], marcas: MapaMarcas): ErroCadastro[] {
  // marca é opcional (R-20261115-073000, RN-CAT-09): só a que foi informada precisa existir e estar ativa
  const comMarca = referencias.filter((r) => !!r.marca_id);
  if (comMarca.length === 0) return [];
  if (marcas.size === 0) return [{ regra: 'RN-CAT-09', campo: 'referencias', mensagem: MSG_SEM_MARCAS }];
  const erros: ErroCadastro[] = [];
  for (const r of comMarca) {
    const m = marcas.get(r.marca_id!);
    if (!m) erros.push({ regra: 'RN-CAT-09', campo: 'referencias', mensagem: 'Uma marca da referência não existe mais em Marcas concorrentes. Escolha outra marca da lista e salve de novo.' });
    else if (!m.ativo) erros.push({ regra: 'RN-CAT-09', campo: 'referencias', mensagem: `A marca ${m.nome} está inativa em Marcas concorrentes. Ative a marca ou escolha outra e salve de novo.` });
  }
  return erros;
}

export interface MarcaDoCadastro {
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

export type MotivoDescarte = 'codigo_invalido' | 'repetida' | 'excede_limite';
export type MotivoSemMarca = 'marca_desconhecida' | 'marca_inativa';

export interface ResolucaoReferenciasErp {
  referencias: Referencia[];
  descartadas: { codigo: string; motivo: MotivoDescarte }[];
  /** Referências que entraram sem marca por a marca informada ser desconhecida ou inativa (aviso `marca_desconhecida`). */
  semMarca: { codigo: string; motivo: MotivoSemMarca }[];
}

/**
 * Doc 06: a marca é opcional (R-20261115-073000); basta o código. Vem do ERP pelo `external_id` ou pelo nome da marca cadastrada em
 * Marcas concorrentes. Sem marca informada, a referência entra sem marca. Marca informada mas desconhecida (ou inativa) entra sem marca
 * e o consumidor mantém o aviso `marca_desconhecida`; até 3 por produto, código de 1 a 30, sem repetir o código no produto.
 */
export function resolverReferenciasDoErp(entrada: readonly ReferenciaDoErp[], marcas: readonly MarcaDoCadastro[]): ResolucaoReferenciasErp {
  const L = LIMITES_CADASTRO_CATALOGO;
  const saida: ResolucaoReferenciasErp = { referencias: [], descartadas: [], semMarca: [] };
  const vistas = new Set<string>();
  for (const e of entrada) {
    const codigo = e.codigo.trim();
    const ext = e.marca_external_id?.trim();
    const nome = e.marca_nome?.trim() ?? '';
    const informada = nome !== '' || !!ext;
    const achada = (ext ? marcas.find((m) => m.external_id === ext) : undefined) ?? (nome ? marcas.find((m) => nomeMarcaIgual(m.nome, nome)) : undefined);
    const marca = achada?.ativo ? achada : undefined;
    const compacto = codigoCompacto(codigo);
    if (codigo === '' || codigo.length > L.codigo || compacto === '') saida.descartadas.push({ codigo, motivo: 'codigo_invalido' });
    else if (vistas.has(compacto)) saida.descartadas.push({ codigo, motivo: 'repetida' });
    else if (saida.referencias.length >= L.referencias) saida.descartadas.push({ codigo, motivo: 'excede_limite' });
    else {
      vistas.add(compacto);
      // marca informada que não vale (desconhecida ou inativa): a referência fica só com o código e o consumidor avisa
      if (informada && !marca) saida.semMarca.push({ codigo, motivo: achada ? 'marca_inativa' : 'marca_desconhecida' });
      saida.referencias.push({ marca_id: marca?.id ?? null, marca_nome: marca?.nome ?? null, codigo });
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
 * Nome da marca de uma referência cruzada (RN-CAT-09). Com o cadastro de marcas disponível (mapa não vazio) ele manda:
 * marca inativa ou ausente esconde a referência (nulo). Sem o cadastro (ex.: aparelho que ainda não baixou as marcas) usa o retrato `marca_nome` gravado na referência; sem retrato (linha anterior à 0034), nulo — não mostra a marca.
 */
export function nomeMarcaDaReferencia(marcaId: string | null, retrato: string | null | undefined, marcas: MapaMarcas): string | null {
  if (marcaId === null) return null;
  if (marcas.size > 0) {
    const m = marcas.get(marcaId);
    return m && m.ativo ? m.nome : null;
  }
  const r = retrato?.trim();
  return r ? r : null;
}

/**
 * T-0103 / RN-CAT-09: marcas citadas pela linha do ERP que Marcas concorrentes não conhece (referência que entrou sem marca, `marca_desconhecida`), como vieram
 * (nome, ou o external_id se não houve nome), sem repetir (sem caixa/acento) e até 3. Nenhuma = `null` (não há aviso).
 */
export function marcasDesconhecidasDaLinha(
  entrada: readonly ReferenciaDoErp[],
  semMarca: readonly { codigo: string; motivo: MotivoSemMarca }[],
): { marcas: string[]; marca_external_id?: string } | null {
  const marcas: string[] = [];
  const vistas = new Set<string>();
  let externalId: string | undefined;
  for (const d of semMarca) {
    if (d.motivo !== 'marca_desconhecida') continue;
    const e = entrada.find((x) => x.codigo.trim() === d.codigo);
    const bruta = (e?.marca_nome?.trim() || e?.marca_external_id?.trim() || '').slice(0, 120);
    if (bruta === '' || vistas.has(chaveDoNomeMarca(bruta)) || marcas.length >= 3) continue;
    vistas.add(chaveDoNomeMarca(bruta));
    marcas.push(bruta);
    externalId ??= e?.marca_external_id?.trim() || undefined;
  }
  return marcas.length === 0 ? null : externalId ? { marcas, marca_external_id: externalId } : { marcas };
}

/** RN-CAT-09: referência como aparece na tela; null = esconder (marca informada inativa ou ausente). Sem marca = só o código. */
export function referenciaVisivel(
  r: { marca_id: string | null; marca_nome?: string | null | undefined; codigo: string },
  marcas: MapaMarcas,
): Referencia | null {
  const nome = nomeMarcaDaReferencia(r.marca_id, r.marca_nome, marcas);
  return nome === null && r.marca_id !== null ? null : { marca_id: r.marca_id, marca_nome: nome, codigo: r.codigo };
}

/** Texto "marca código", ou só o código quando não há marca (RN-CAT-09). */
export function textoDaReferencia(marca: string | null | undefined, codigo: string): string {
  const m = marca?.trim();
  return m ? `${m} ${codigo}` : codigo;
}

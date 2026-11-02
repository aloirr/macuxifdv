/**
 * RN-INT-14: cliente recebido sem algum campo obrigatório do tenant (`cliente.campos_obrigatorios`, regra do Core, RN-CORE-16/17)
 * NÃO é linha com erro: entra normalmente e a linha ganha o aviso `cadastro_incompleto`, que o monitor mostra. O Hub não decide o
 * cadastro: pergunta ao Core pela consulta `core.cadastro_cliente@1` (só a chave e os NOMES dos campos voltam). A mensagem nunca
 * leva o valor do documento (dado pessoal).
 */
import type { AvisoLinha, ClientePayload } from '../contracts';

export interface DadosCadastroCliente {
  chave: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  documento: string | null;
  inscricao_estadual: string | null;
  telefone: string | null;
  email: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  latitude: number | null;
  longitude: number | null;
}

const ROTULOS: Readonly<Record<string, string>> = {
  razao_social: 'razão social',
  documento: 'CNPJ/CPF',
  inscricao_estadual: 'inscrição estadual',
  logradouro: 'logradouro',
  numero: 'número',
  bairro: 'bairro',
  cidade: 'cidade',
  uf: 'UF',
  cep: 'CEP',
  nome_fantasia: 'nome fantasia',
  telefone: 'telefone',
  email: 'e-mail',
  complemento: 'complemento',
  geolocalizacao: 'geolocalização',
};

/** Entrada da consulta ao Core a partir do cliente já validado do lote (a chave é o `external_id`). */
export function dadosParaConsultaCadastro(c: Pick<ClientePayload, 'external_id'> & Partial<ClientePayload>): DadosCadastroCliente {
  const e = c.endereco ?? null;
  return {
    chave: c.external_id,
    razao_social: c.razao_social ?? null,
    nome_fantasia: c.nome_fantasia ?? null,
    documento: c.documento ?? null,
    inscricao_estadual: c.inscricao_estadual ?? null,
    telefone: c.telefone ?? null,
    email: c.email ?? null,
    logradouro: e?.logradouro ?? null,
    numero: e?.numero ?? null,
    complemento: e?.complemento ?? null,
    bairro: e?.bairro ?? null,
    cidade: e?.cidade ?? null,
    uf: e?.uf ?? null,
    cep: e?.cep ?? null,
    latitude: c.latitude ?? null,
    longitude: c.longitude ?? null,
  };
}

/** Um aviso por linha incompleta (o `indice` é a posição da linha no lote). Chave que o Core não devolveu = sem aviso. */
export function avisosCadastroIncompleto(
  linhas: readonly { indice: number; external_id: string }[],
  resultados: readonly { chave: string; completo: boolean; campos_faltantes: readonly string[] }[],
): AvisoLinha[] {
  const porChave = new Map(resultados.map((r) => [r.chave, r]));
  const avisos: AvisoLinha[] = [];
  for (const l of linhas) {
    const r = porChave.get(l.external_id);
    if (!r || r.completo) continue;
    const campos = r.campos_faltantes.map((c) => ROTULOS[c] ?? c);
    avisos.push({
      indice: l.indice,
      external_id: l.external_id,
      codigo: 'cadastro_incompleto',
      mensagem: `Cadastro incompleto: falta ${campos.length > 0 ? campos.join(', ') : 'algum campo obrigatório'}. A linha foi aplicada; complete o cadastro no ERP ou no BKO.`,
    });
  }
  return avisos;
}

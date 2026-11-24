// Jornada AM2808 (reprodução local, dados de teste): este script faz o papel do ERP, que fala com o Hub `/integracao/v1`
// com a credencial tipo nuvem `macuxierp`, como o Conector (docs/modulos/integracao/hub-api.md §2, §6; contratos em
// modules/integracao/contracts). Tudo é fictício. Uso: node erp.mjs <passo>   (API em MACUXI_API, padrão http://127.0.0.1:8100)
//   sinal                 POST /sinal (o Conector entra no ar)
//   carga                 envia, na ordem de ORDEM_CARGA_ENTIDADES: filial, vendedor, forma e prazo de pagamento, produto, preço,
//                         estoque, cliente e título; espera cada lote terminar (GET /lotes/{id}) e grava saida/carga.json
//   pendentes             GET /pedidos/pendentes (grava saida/pendentes.json)
//   retorno <uuid> integrado   POST /pedidos/{uuid}/retorno status integrado com numero_erp
//   retorno <uuid> faturado    POST /pedidos/{uuid}/retorno status faturado_total com a nota e itens_faturados montados do
//                         pedido de saida/pendentes.json (a chave de acesso de 44 dígitos é FICTÍCIA)
//   clientes-pendentes    GET /clientes/pendentes
//   cliente-retorno <uuid> <codigo>  POST /clientes/{uuid}/retorno status vinculado (RetornoCliente, cliente-erp.ts)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = process.env.MACUXI_SAIDA ?? join(AQUI, 'saida');
mkdirSync(SAIDA, { recursive: true });
const API = process.env.MACUXI_API ?? 'http://127.0.0.1:8100';
const CRED = JSON.parse(readFileSync(process.env.MACUXI_CREDENCIAL ?? '/home/user/jornada/credencial.json', 'utf8'));
const VERSAO_CONECTOR = '1.5.0'; // a do apps/conector no main (o ERP fala como o Conector atual)
const VERSAO_CONTRATO = 'v1'; // conferir VERSAO_CONTRATO em modules/integracao/contracts
const NUMERO_ERP = 'PV-000123';
/** Chave de acesso FICTÍCIA (44 dígitos: cUF 13 = AM, AAMM, CNPJ de exemplo 11222333000181, modelo 55, série 001, nº 000004521, …). */
const CHAVE_FICTICIA = '13261111222333000181550010000045211000045210';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const agora = () => new Date().toISOString();
const dias = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const cab = (extra = {}) => ({
  authorization: `Bearer ${CRED.chave}`,
  'x-macuxi-conector-id': CRED.conector_id,
  'x-macuxi-conector-versao': VERSAO_CONECTOR,
  'user-agent': `erp-teste/${VERSAO_CONECTOR}`,
  'content-type': 'application/json',
  ...extra,
});
async function chamar(metodo, caminho, corpo, extra) {
  const r = await fetch(`${API}/integracao/v1${caminho}`, { method: metodo, headers: cab(extra), body: corpo ? JSON.stringify(corpo) : undefined });
  const texto = await r.text();
  let json;
  try { json = JSON.parse(texto); } catch { json = texto; }
  return { status: r.status, json };
}
const gravar = (nome, obj) => writeFileSync(join(SAIDA, nome), JSON.stringify(obj, null, 2) + '\n');

// ---------- dados de teste (fictícios; CNPJs de exemplo com dígito válido) ----------
const alt = agora();
const CARGA = {
  filial: [{ external_id: 'F01', alterado_em: alt, codigo: '01', nome: 'Matriz Teste', cidade: 'Manaus', uf: 'AM', cnpj: '11.222.333/0001-81', logradouro: 'Av. Teste', numero: '100', bairro: 'Centro', cep: '69005-000', telefone: '(92) 3000-0000' }],
  vendedor: [{ external_id: 'V001', alterado_em: alt, nome: 'Vendedor Teste', email: 'vendedor@thathyany-teste.com.br', filial_external_id: 'F01' }],
  forma_pagamento: [
    { external_id: 'FP-BOL', alterado_em: alt, codigo: 'BOL', nome: 'Boleto', ordem: 1 },
    { external_id: 'FP-DIN', alterado_em: alt, codigo: 'DIN', nome: 'Dinheiro', ordem: 2 },
  ],
  prazo_pagamento: [
    { external_id: 'PZ-BOL-28', alterado_em: alt, forma_external_id: 'FP-BOL', codigo: '28', descricao: '28 dias', parcelas_dias: [28], ordem: 1 },
    { external_id: 'PZ-DIN-0', alterado_em: alt, forma_external_id: 'FP-DIN', codigo: 'AV', descricao: 'À vista', parcelas_dias: [0], ordem: 2 },
  ],
  produto: [
    { external_id: 'P001', alterado_em: alt, sku: 'P001', ean: '7890000000017', nome: 'Café Torrado Teste 500 g', marca: 'Marca Teste', categoria: 'Mercearia', unidade: 'UN' },
    { external_id: 'P002', alterado_em: alt, sku: 'P002', ean: '7890000000024', nome: 'Açúcar Cristal Teste 1 kg', marca: 'Marca Teste', categoria: 'Mercearia', unidade: 'UN' },
    { external_id: 'P003', alterado_em: alt, sku: 'P003', ean: '7890000000031', nome: 'Farinha de Mandioca Teste 1 kg', marca: 'Marca Teste', categoria: 'Mercearia', unidade: 'UN' },
  ],
  preco: ['P001:2490', 'P002:589', 'P003:899'].map((s) => {
    const [p, c] = s.split(':');
    return { external_id: `T01-${p}`, alterado_em: alt, tabela_external_id: 'T01', tabela_nome: 'Tabela Teste', vigencia_inicio: dias(-30), produto_external_id: p, preco_cents: Number(c), filial_external_id: 'F01' };
  }),
  estoque: ['P001:240', 'P002:500', 'P003:80'].map((s) => {
    const [p, q] = s.split(':');
    return { external_id: `D01-${p}`, alterado_em: alt, deposito_external_id: 'D01', deposito_nome: 'Depósito Teste', produto_external_id: p, saldo: Number(q), filial_external_id: 'F01' };
  }),
  cliente: [
    { external_id: 'C001', alterado_em: alt, razao_social: 'Mercadinho Teste Ltda', nome_fantasia: 'Mercadinho Teste', documento: '11.444.777/0001-61', vendedor_external_id: 'V001', inscricao_estadual: 'ISENTO', endereco: { logradouro: 'Rua Fictícia', numero: '10', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: '69005-010' }, telefone: '(92) 3000-0001', limite_credito_cents: 500000, tabela_preco_external_id: 'T01', filial_external_id: 'F01', formas_pagamento: ['BOL', 'DIN'], prazo_medio_max_dias: 30 },
    { external_id: 'C002', alterado_em: alt, razao_social: 'Comercial Exemplo Ltda', nome_fantasia: 'Comercial Exemplo', documento: '12.345.678/0001-95', vendedor_external_id: 'V001', inscricao_estadual: 'ISENTO', endereco: { logradouro: 'Rua de Teste', numero: '200', bairro: 'Adrianópolis', cidade: 'Manaus', uf: 'AM', cep: '69057-000' }, telefone: '(92) 3000-0002', limite_credito_cents: 300000, tabela_preco_external_id: 'T01', filial_external_id: 'F01', formas_pagamento: ['BOL', 'DIN'], prazo_medio_max_dias: 30 },
  ],
  titulo: [
    { external_id: 'TIT-1001-1', alterado_em: alt, cliente_external_id: 'C001', numero: '1001', parcela: 1, emissao: dias(-20), vencimento: dias(10), valor_cents: 125000, saldo_cents: 125000, situacao: 'aberto', nf_numero: '1001', nf_serie: '1', forma_pagamento: 'Boleto 30 dias' },
    { external_id: 'TIT-0950-1', alterado_em: alt, cliente_external_id: 'C001', numero: '950', parcela: 1, emissao: dias(-60), vencimento: dias(-30), valor_cents: 80000, saldo_cents: 0, situacao: 'baixado', baixado_em: new Date(Date.now() - 31 * 86400000).toISOString(), nf_numero: '950', nf_serie: '1', forma_pagamento: 'Boleto 30 dias' },
  ],
};

async function esperarLote(id) {
  for (let i = 0; i < 90; i += 1) {
    const r = await chamar('GET', `/lotes/${id}`);
    if (['concluido', 'concluido_com_erros', 'falhou'].includes(r.json?.status)) return r;
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  throw new Error(`lote ${id} não terminou em 90 s`);
}

async function carga() {
  const log = [];
  for (const entidade of ['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto', 'preco', 'estoque', 'cliente', 'titulo']) {
    const corpo = { versao_contrato: VERSAO_CONTRATO, entidade, modo: 'delta', conector_id: CRED.conector_id, versao_conector: VERSAO_CONECTOR, enviado_em: agora(), registros: CARGA[entidade] };
    const chave = sha256(JSON.stringify({ ...corpo, enviado_em: undefined }));
    const aceito = await chamar('POST', '/lotes', corpo, { 'idempotency-key': chave });
    if (aceito.status >= 300) { log.push({ entidade, aceito }); console.log(entidade, aceito.status, JSON.stringify(aceito.json)); continue; }
    const resultado = await esperarLote(aceito.json.lote_id);
    log.push({ entidade, registros: CARGA[entidade].length, http_aceito: aceito.status, aceito: aceito.json, resultado: resultado.json });
    console.log(entidade, aceito.status, resultado.json.status, JSON.stringify(resultado.json).slice(0, 400));
  }
  gravar('carga.json', { lotes: log });
}

async function principal() {
  const [passo, a, b] = process.argv.slice(2);
  if (passo === 'carga') return carga();
  if (passo === 'sinal') {
    const r = await chamar('POST', '/sinal', { conector_id: CRED.conector_id, versao_conector: VERSAO_CONECTOR, versao_contrato: VERSAO_CONTRATO, em: agora(), fila: [], entidades: [] });
    gravar('sinal.json', r);
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (passo === 'pendentes') { const r = await chamar('GET', '/pedidos/pendentes?limite=50'); gravar('pendentes.json', r); console.log(JSON.stringify(r, null, 2)); return; }
  if (passo === 'retorno') {
    const base = { versao_contrato: VERSAO_CONTRATO, pedido_uuid: a, ocorrido_em: agora() };
    let corpo = { status: 'integrado', numero_erp: NUMERO_ERP };
    if (b === 'faturado') {
      const pend = JSON.parse(readFileSync(join(SAIDA, 'pendentes.json'), 'utf8'));
      const ped = pend.json.pedidos.find((x) => x.pedido_uuid === a);
      if (!ped) throw new Error('pedido fora de saida/pendentes.json');
      corpo = {
        status: 'faturado_total',
        numero_erp: NUMERO_ERP,
        // nota FICTÍCIA de homologação simulada: número, série e uma chave de acesso de 44 dígitos inventada (o contrato v1 não
        // tem campo para a chave: ver "Defeitos e observações" no PDF; ela vai no corpo para mostrar o que o Hub guarda)
        nota: { numero: '000004521', serie: '1', emitida_em: agora(), total_cents: ped.total_cents, chave_acesso: CHAVE_FICTICIA },
        itens_faturados: ped.itens.map((i) => ({ sequencia: i.sequencia, produto_external_id: i.produto_external_id, quantidade: i.quantidade, valor_cents: i.total_cents })),
      };
    }
    const r = await chamar('POST', `/pedidos/${a}/retorno`, { ...base, ...corpo });
    gravar(`retorno-${b}.json`, { enviado: { ...base, ...corpo }, resposta: r });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (passo === 'clientes-pendentes') { const r = await chamar('GET', '/clientes/pendentes?limite=50'); gravar('clientes-pendentes.json', r); console.log(JSON.stringify(r, null, 2)); return; }
  if (passo === 'cliente-retorno') {
    const corpo = { versao_contrato: VERSAO_CONTRATO, cliente_uuid: a, status: 'vinculado', external_id: b, ocorrido_em: agora() };
    const r = await chamar('POST', `/clientes/${a}/retorno`, corpo);
    gravar('cliente-retorno.json', { enviado: corpo, resposta: r });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  throw new Error('passo desconhecido');
}
await principal();

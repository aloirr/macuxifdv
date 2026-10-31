/**
 * Gera todas as planilhas de mock-data/ com dados FICTÍCIOS, coerentes com os mockups
 * (vendedor Rafael S., cliente Auto Peças Rio Negro, pedidos 10482 e 10494 etc.).
 * Determinístico: mesma data de referência → mesmos dados.
 */
import { businessDays, isBusinessDay, localDate, abcCurve, nearestNeighborOrder, toCents } from '../legado/dominio';
import { emptyTables, type CustomerRow, type InvoiceItemRow, type InvoiceRow, type ProductRow, type SalesOrderRow, type Tables } from '../excel/rows';

// ---------- utilitários determinísticos ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedOptions {
  /** data de referência AAAA-MM-DD (padrão: hoje em America/Manaus) */
  today?: string;
  /** instante "agora" (padrão: Date.now()) — usado para horários de hoje */
  now?: Date;
}

const TZ_OFFSET = '-04:00'; // America/Manaus, sem horário de verão

export function generateSeed(opts: SeedOptions = {}): Tables {
  const now = opts.now ?? new Date();
  const today = opts.today ?? localDate(now);
  const rnd = mulberry32(20261012);
  const r = (min: number, max: number) => min + rnd() * (max - min);
  const ri = (min: number, max: number) => Math.floor(r(min, max + 1));
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;
  const uuid = () => {
    const h = () => Math.floor(rnd() * 0x10000).toString(16).padStart(4, '0');
    return `${h()}${h()}-${h()}-4${h().slice(1)}-${(8 + Math.floor(rnd() * 4)).toString(16)}${h().slice(1)}-${h()}${h()}${h()}`;
  };
  const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  /** instante ISO UTC de uma data/hora local de Manaus */
  const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00${TZ_OFFSET}`).toISOString();
  const ym = today.slice(0, 7);
  const prevYm = addDays(`${ym}-01`, -1).slice(0, 7);

  const t = emptyTables();
  const tenantId = '7d0c2f4e-1a2b-4c3d-8e9f-000000000001';
  const T = { tenant_id: tenantId };

  // ---------- empresa ----------
  t.tenant.push({
    id: tenantId,
    name: 'Distribuidora Exemplo',
    cnpj: '00.000.000/0001-00',
    timezone: 'America/Manaus',
    product_name: 'Macuxi FDV',
    plan: 'piloto',
    status: 'active',
    erp_name: 'Protheus',
    last_erp_load_at: at(today, '09:58'),
  });
  const cd = { id: uuid(), ...T, erp_code: '01', name: 'CD Manaus', city: 'Manaus', uf: 'AM', is_distribution_center: true };
  const loja = { id: uuid(), ...T, erp_code: '02', name: 'Loja Centro', city: 'Manaus', uf: 'AM', is_distribution_center: false };
  t.branch.push(cd, loja);

  // ---------- holidays (nacionais + Manaus) ----------
  const holidays: Array<[string, string]> = [
    ['2026-01-01', 'Confraternização Universal'], ['2026-02-16', 'Carnaval'], ['2026-02-17', 'Carnaval'], ['2026-04-03', 'Sexta-feira Santa'],
    ['2026-04-21', 'Tiradentes'], ['2026-05-01', 'Dia do Trabalho'], ['2026-06-04', 'Corpus Christi'], ['2026-09-07', 'Independência'],
    ['2026-10-12', 'Nossa Senhora Aparecida'], ['2026-10-24', 'Aniversário de Manaus'], ['2026-11-02', 'Finados'], ['2026-11-15', 'Proclamação da República'],
    ['2026-11-20', 'Consciência Negra'], ['2026-12-08', 'Nossa Senhora da Conceição (Manaus)'], ['2026-12-25', 'Natal'],
    ['2027-01-01', 'Confraternização Universal'], ['2027-02-08', 'Carnaval'], ['2027-02-09', 'Carnaval'], ['2027-03-26', 'Sexta-feira Santa'],
    ['2027-04-21', 'Tiradentes'], ['2027-05-01', 'Dia do Trabalho'], ['2027-05-27', 'Corpus Christi'], ['2027-09-07', 'Independência'],
    ['2027-10-12', 'Nossa Senhora Aparecida'], ['2027-10-24', 'Aniversário de Manaus'], ['2027-11-02', 'Finados'], ['2027-11-15', 'Proclamação da República'],
    ['2027-11-20', 'Consciência Negra'], ['2027-12-08', 'Nossa Senhora da Conceição (Manaus)'], ['2027-12-25', 'Natal'],
  ];
  for (const [date, name] of holidays) t.holiday.push({ ...T, date, name });
  const holidaySet = new Set(holidays.map((h) => h[0]));
  const days = businessDays(ym, today, holidaySet);
  const elapsedBizDays = (() => {
    const out: string[] = [];
    for (let d = `${ym}-01`; d < today; d = addDays(d, 1)) if (isBusinessDay(d, holidaySet)) out.push(d);
    return out;
  })();

  // ---------- equipes, vendedores e usuários ----------
  const teamNames = ['Zona Norte', 'Zona Sul', 'Centro', 'Interior', 'Zona Leste', 'Zona Oeste'];
  const managerId = uuid();
  const teams = Object.fromEntries(teamNames.map((n) => [n, { id: uuid(), ...T, name: n, manager_user_id: managerId }]));
  t.team.push(...Object.values(teams));

  interface SellerSpec {
    name: string; short: string; team: string; wallet: number; target: number; proj: number; cov: number; mix: number; del: number; branch: typeof cd;
  }
  const specs: SellerSpec[] = [
    { name: 'Bruna Teixeira', short: 'Bruna T.', team: 'Zona Sul', wallet: 132, target: 540000, proj: 1.18, cov: 0.74, mix: 0.88, del: 1.9, branch: cd },
    { name: 'Rafael Souza', short: 'Rafael S.', team: 'Zona Norte', wallet: 80, target: 520000, proj: 1.04, cov: 0.8, mix: 0.78, del: 2.1, branch: cd },
    { name: 'Diego Martins', short: 'Diego M.', team: 'Centro', wallet: 118, target: 480000, proj: 0.99, cov: 0.66, mix: 0.81, del: 2.6, branch: loja },
    { name: 'Carla Nogueira', short: 'Carla N.', team: 'Interior', wallet: 164, target: 610000, proj: 0.86, cov: 0.61, mix: 0.7, del: 3.4, branch: cd },
    { name: 'Marcos Pereira', short: 'Marcos P.', team: 'Zona Leste', wallet: 140, target: 450000, proj: 0.96, cov: 0.57, mix: 0.74, del: 2.9, branch: cd },
    { name: 'Lívia Rocha', short: 'Lívia R.', team: 'Zona Oeste', wallet: 126, target: 430000, proj: 0.87, cov: 0.52, mix: 0.69, del: 3.8, branch: cd },
    { name: 'Thiago Almeida', short: 'Thiago A.', team: 'Interior', wallet: 171, target: 520000, proj: 0.88, cov: 0.48, mix: 0.72, del: 2.2, branch: cd },
    { name: 'Paula Vieira', short: 'Paula V.', team: 'Zona Norte', wallet: 109, target: 400000, proj: 0.78, cov: 0.44, mix: 0.66, del: 4.1, branch: cd },
  ];
  const sellers = specs.map((s, i) => {
    const userId = uuid();
    const sellerId = uuid();
    const email = `${s.name.split(' ')[0]!.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}@exemplo.com.br`;
    t.app_user.push({ id: userId, ...T, name: s.name, email, role: 'seller', branch_id: s.branch.id, seller_id: sellerId, active: true });
    const row = { id: sellerId, ...T, user_id: userId, erp_code: String(100 + i + 1), name: s.name, short_name: s.short, team_id: teams[s.team]!.id, branch_id: s.branch.id, region: s.team, active: true };
    t.seller.push(row);
    return { ...s, id: sellerId, row };
  });
  const rafael = sellers.find((s) => s.short === 'Rafael S.')!;
  const sellerByShort = (sh: string) => sellers.find((s) => s.short === sh)!;
  t.app_user.push(
    { id: managerId, ...T, name: 'Fernando Lima', email: 'fernando@exemplo.com.br', role: 'manager', branch_id: cd.id, seller_id: '', active: true },
    { id: uuid(), ...T, name: 'Juliana Melo', email: 'juliana@exemplo.com.br', role: 'analyst', branch_id: cd.id, seller_id: '', active: true },
    { id: uuid(), ...T, name: 'Ana Costa', email: 'ana@exemplo.com.br', role: 'bko_assistant', branch_id: cd.id, seller_id: '', active: true },
    { id: uuid(), ...T, name: 'Patrícia Gomes', email: 'patricia@exemplo.com.br', role: 'admin', branch_id: cd.id, seller_id: '', active: true },
  );
  const analyst = t.app_user.find((u) => u.role === 'analyst')!;

  // ---------- produtos ----------
  const brands: Record<string, string> = {
    Freios: 'Norfreio', Filtros: 'FiltraMax', Suspensão: 'Suspentec', Motor: 'Motorpart', Elétrica: 'Voltrix', Arrefecimento: 'Termax',
    Transmissão: 'Transpar', Lubrificantes: 'Lubrion', Ignição: 'Faiscar', Rolamentos: 'Rolatec',
  };
  const vehicles = [
    'Gol / Voyage G5–G6', 'Onix / Prisma 1.0–1.4', 'HB20 2013–2019', 'Palio / Siena Fire', 'Uno 2011–2021', 'Fiesta / Ka 1.0–1.6', 'Corolla 2015–2019',
    'Hilux 2.8 diesel', 'Strada 1.4', 'Saveiro G6', 'Sandero / Logan 1.6', 'Civic 2012–2016', 'S10 2.8 diesel', 'CG 160 / Fan', 'Biz 125', 'Fazer 250',
  ];
  const productSpecs: Array<[string, string, string, number, string?]> = [
    // [código, descrição, linha, preço, aplicação fixa]
    ['PST-4410', 'Pastilha de freio dianteira', 'Freios', 89.9, 'Gol / Voyage G5–G6'],
    ['FLT-0207', 'Filtro de óleo', 'Filtros', 24.5, 'Onix / Prisma 1.0–1.4'],
    ['AMT-1132', 'Amortecedor traseiro', 'Suspensão', 218, 'HB20 2013–2019'],
    ['PST-4420', 'Pastilha de freio dianteira', 'Freios', 94.9], ['PST-4431', 'Pastilha de freio traseira', 'Freios', 79.9], ['DSC-2210', 'Disco de freio ventilado', 'Freios', 189.0],
    ['DSC-2214', 'Disco de freio sólido', 'Freios', 142.5], ['LON-1180', 'Lona de freio', 'Freios', 68.0], ['CIL-0912', 'Cilindro de roda', 'Freios', 54.9], ['FLD-0050', 'Fluido de freio DOT 4 500 ml', 'Freios', 32.9],
    ['FLT-0210', 'Filtro de óleo', 'Filtros', 26.9], ['FLT-0315', 'Filtro de ar do motor', 'Filtros', 38.5], ['FLT-0322', 'Filtro de ar condicionado', 'Filtros', 34.9], ['FLT-0418', 'Filtro de combustível', 'Filtros', 29.9],
    ['FLT-0420', 'Filtro de combustível diesel', 'Filtros', 64.0], ['AMT-1120', 'Amortecedor dianteiro', 'Suspensão', 249.0], ['AMT-1140', 'Amortecedor traseiro', 'Suspensão', 204.0],
    ['BCJ-0331', 'Bucha da bandeja', 'Suspensão', 22.9], ['BAN-0712', 'Bandeja de suspensão', 'Suspensão', 168.0], ['PIV-0440', 'Pivô de suspensão', 'Suspensão', 46.9], ['TRM-0218', 'Terminal de direção', 'Suspensão', 52.0],
    ['KIT-0801', 'Kit batente e coifa', 'Suspensão', 58.9], ['CRR-1501', 'Correia dentada', 'Motor', 74.9], ['TEN-1503', 'Tensor da correia', 'Motor', 118.0], ['JNT-0610', 'Junta do cabeçote', 'Motor', 96.0],
    ['BMB-0901', 'Bomba de óleo', 'Motor', 239.0], ['VLV-0233', 'Válvula termostática', 'Arrefecimento', 72.0], ['BMA-0412', 'Bomba d’água', 'Arrefecimento', 159.0], ['RAD-0120', 'Radiador', 'Arrefecimento', 489.0],
    ['MNG-0310', 'Mangueira do radiador', 'Arrefecimento', 39.9], ['ADT-0001', 'Aditivo de radiador 1 L', 'Arrefecimento', 27.5], ['VEL-0505', 'Vela de ignição (jogo)', 'Ignição', 84.0],
    ['CAB-0602', 'Cabo de vela (jogo)', 'Ignição', 119.0], ['BOB-0701', 'Bobina de ignição', 'Ignição', 212.0], ['BAT-6001', 'Bateria 60 Ah', 'Elétrica', 469.0], ['LMP-0011', 'Lâmpada H4 12 V', 'Elétrica', 18.9],
    ['LMP-0012', 'Lâmpada H7 12 V', 'Elétrica', 21.9], ['ALT-0420', 'Alternador remanufaturado', 'Elétrica', 689.0], ['MTP-0330', 'Motor de partida remanufaturado', 'Elétrica', 579.0],
    ['EMB-1101', 'Kit de embreagem', 'Transmissão', 429.0], ['ROL-0101', 'Rolamento de roda dianteiro', 'Rolamentos', 88.0], ['ROL-0102', 'Rolamento de roda traseiro', 'Rolamentos', 76.0],
    ['CUB-0220', 'Cubo de roda', 'Rolamentos', 198.0], ['HMC-0140', 'Homocinética', 'Transmissão', 235.0], ['CRD-0118', 'Coifa da homocinética', 'Transmissão', 31.9], ['OLE-5W30', 'Óleo de motor 5W30 sintético 1 L', 'Lubrificantes', 42.9],
    ['OLE-1540', 'Óleo de motor 15W40 diesel 1 L', 'Lubrificantes', 31.5], ['OLE-2050', 'Óleo de motor 20W50 moto 1 L', 'Lubrificantes', 27.9], ['GRX-0500', 'Graxa multiuso 500 g', 'Lubrificantes', 22.5],
    ['ATF-0001', 'Fluido de transmissão ATF 1 L', 'Lubrificantes', 39.9], ['KRL-0160', 'Kit relação moto', 'Transmissão', 159.0], ['PST-7101', 'Pastilha de freio moto', 'Freios', 29.9],
    ['FLT-7201', 'Filtro de óleo moto', 'Filtros', 16.9], ['VEL-7301', 'Vela de ignição moto', 'Ignição', 21.5], ['CAB-7401', 'Cabo de embreagem moto', 'Transmissão', 24.9],
    ['AMT-1150', 'Amortecedor dianteiro', 'Suspensão', 262.0], ['FLT-0330', 'Filtro de ar do motor diesel', 'Filtros', 92.0], ['PST-4450', 'Pastilha de freio dianteira diesel', 'Freios', 189.0],
    ['DSC-2230', 'Disco de freio diesel', 'Freios', 312.0], ['ROL-0130', 'Rolamento de roda diesel', 'Rolamentos', 164.0],
  ];
  const campaignCodes = new Set(['AMT-1132', 'AMT-1120', 'AMT-1140', 'AMT-1150']);
  const products: ProductRow[] = productSpecs.map(([code, desc, line, , app]) => ({
    id: uuid(),
    ...T,
    erp_code: code,
    description: desc,
    brand: brands[line] ?? 'Genérica',
    line,
    unit: line === 'Lubrificantes' || code.startsWith('FLD') || code.startsWith('ADT') ? 'UN' : code.startsWith('VEL-05') || code.startsWith('CAB-06') ? 'JG' : 'PC',
    active: true,
    applications: app ?? (code.includes('-7') ? pick(vehicles.slice(13)) : pick(vehicles.slice(0, 13))),
    is_campaign: campaignCodes.has(code),
    image_url: '',
  }));
  t.product.push(...products);
  const basePrice = new Map(productSpecs.map(([code, , , price]) => [code, price]));
  const productByCode = new Map(products.map((p) => [p.erp_code, p]));

  // ---------- tabelas de preço e estoque ----------
  const tblManaus = { id: uuid(), ...T, erp_code: 'T01', name: 'Tabela Varejo Manaus' };
  const tblInterior = { id: uuid(), ...T, erp_code: 'T02', name: 'Tabela Interior' };
  t.price_table.push(tblManaus, tblInterior);
  const priceCents = new Map<string, number>(); // productId|tableId
  for (const p of products) {
    const base = basePrice.get(p.erp_code)!;
    for (const [tbl, factor] of [[tblManaus, 1], [tblInterior, 1.06]] as const) {
      const cents = toCents(Math.round(base * factor * 10) / 10);
      priceCents.set(`${p.id}|${tbl.id}`, cents);
      t.price_item.push({ id: uuid(), ...T, price_table_id: tbl.id, product_id: p.id, price_cents: cents });
    }
  }
  const stockFixed: Record<string, [number, number]> = { 'PST-4410': [124, 18], 'FLT-0207': [380, 0], 'AMT-1132': [12, 0] };
  for (const p of products) {
    const [cdQ, lojaQ] = stockFixed[p.erp_code] ?? [ri(0, 9) === 0 ? ri(0, 6) : ri(20, 420), ri(0, 3) === 0 ? 0 : ri(2, 60)];
    t.stock.push({ ...T, product_id: p.id, branch_id: cd.id, quantity: cdQ, updated_at: at(today, '07:40') });
    t.stock.push({ ...T, product_id: p.id, branch_id: loja.id, quantity: lojaQ, updated_at: at(today, '07:40') });
  }

  // ---------- clientes ----------
  const districtsByTeam: Record<string, string[]> = {
    'Zona Norte': ['Cidade Nova', 'Santa Etelvina', 'Novo Israel', 'Monte das Oliveiras', 'Cachoeirinha', 'Tarumã', 'Colônia Terra Nova', 'Nova Cidade', 'Lago Azul'],
    'Zona Sul': ['Flores', 'Parque Dez', 'Adrianópolis', 'Aleixo', 'Chapada', 'Ponta Negra', 'Dom Pedro'],
    Centro: ['Centro', 'Educandos', 'Aleixo', 'Compensa', 'Japiim', 'Praça 14', 'Cachoeirinha'],
    Interior: ['Itacoatiara', 'Parintins', 'Manacapuru', 'Iranduba', 'Presidente Figueiredo', 'Rio Preto da Eva', 'Autazes', 'Careiro'],
    'Zona Leste': ['Jorge Teixeira', 'Coroado', 'Zumbi', 'Armando Mendes', 'Gilberto Mestrinho', 'São José', 'Cidade de Deus', 'Distrito Industrial'],
    'Zona Oeste': ['Compensa', 'Redenção', 'Lírio do Vale', 'Planalto', 'Alvorada', 'Ponta Negra', 'Flores'],
  };
  const PLACES: Record<string, [number, number]> = {
    'Cidade Nova': [-3.03, -59.99], 'Santa Etelvina': [-2.99, -60.02], 'Novo Israel': [-3.04, -60.03], 'Monte das Oliveiras': [-3.01, -60.0], Cachoeirinha: [-3.12, -60.01],
    Tarumã: [-3.0, -60.06], 'Colônia Terra Nova': [-2.98, -60.01], 'Nova Cidade': [-2.99, -59.98], 'Lago Azul': [-2.97, -60.04], Flores: [-3.07, -60.01],
    'Parque Dez': [-3.08, -60.02], Adrianópolis: [-3.1, -60.01], Aleixo: [-3.09, -59.99], Chapada: [-3.1, -60.03], 'Ponta Negra': [-3.08, -60.1],
    'Dom Pedro': [-3.09, -60.04], Centro: [-3.13, -60.02], Educandos: [-3.14, -60.01], Compensa: [-3.11, -60.06], Japiim: [-3.12, -59.98],
    'Praça 14': [-3.12, -60.01], 'Jorge Teixeira': [-3.04, -59.94], Coroado: [-3.09, -59.97], Zumbi: [-3.07, -59.94], 'Armando Mendes': [-3.1, -59.94],
    'Gilberto Mestrinho': [-3.06, -59.93], 'São José': [-3.07, -59.96], 'Cidade de Deus': [-3.02, -59.95], 'Distrito Industrial': [-3.13, -59.96],
    Redenção: [-3.06, -60.04], 'Lírio do Vale': [-3.06, -60.06], Planalto: [-3.06, -60.05], Alvorada: [-3.08, -60.04],
    Itacoatiara: [-3.14, -58.44], Parintins: [-2.63, -56.74], Manacapuru: [-3.3, -60.62], Iranduba: [-3.28, -60.19], 'Presidente Figueiredo': [-2.05, -60.02],
    'Rio Preto da Eva': [-2.7, -59.7], Autazes: [-3.58, -59.13], Careiro: [-3.77, -60.37],
  };
  const prefixes = ['Auto Peças', 'Mecânica', 'Center Car', 'Freios & Cia', 'Moto Peças', 'Oficina', 'Retífica', 'Auto Center', 'Lubri Center', 'Peças Express', 'Turbo Diesel', 'Comercial Peças', 'Auto Elétrica', 'Casa do Mecânico', 'Distribuidora', 'Rolamentos', 'Borracharia e Peças', 'Diesel Norte', 'Oficina do Vale', 'Motopeças'];
  const streets = ['Av. Torquato Tapajós', 'Rua Rio Negro', 'Av. Constantino Nery', 'Av. Djalma Batista', 'Rua Paraíba', 'Av. Autaz Mirim', 'Av. Grande Circular', 'Rua Belo Horizonte', 'Av. Max Teixeira', 'Rua Ipixuna', 'Av. Brasil', 'Rua Recife'];
  type Named = { name: string; seller: string; curve?: 'A' | 'B'; district?: string; segment?: string; weight?: number; since?: string };
  const named: Named[] = [
    { name: 'Auto Peças Rio Negro', seller: 'Rafael S.', curve: 'A', district: 'Cachoeirinha', segment: 'Linha leve', weight: 9, since: '2019-03-11' },
    { name: 'Mecânica Tarumã', seller: 'Rafael S.', curve: 'B', district: 'Tarumã', weight: 3.2 },
    { name: 'Center Car Ponta Negra', seller: 'Rafael S.', district: 'Ponta Negra', weight: 3.6 },
    { name: 'Freios & Cia Cidade Nova', seller: 'Rafael S.', district: 'Cidade Nova', weight: 4.5 },
    { name: 'Oficina Santa Etelvina', seller: 'Rafael S.', district: 'Santa Etelvina', weight: 2.2 },
    { name: 'Moto Peças Novo Israel', seller: 'Rafael S.', district: 'Novo Israel', segment: 'Motos', weight: 2.6 },
    { name: 'Retífica Monte das Oliveiras', seller: 'Rafael S.', district: 'Monte das Oliveiras', segment: 'Linha pesada', weight: 4.1 },
    { name: 'Auto Center Flores', seller: 'Bruna T.', curve: 'A', district: 'Flores', weight: 8 },
    { name: 'Peças Express Aleixo', seller: 'Diego M.', district: 'Aleixo', weight: 2 },
    { name: 'Lubri Center Compensa', seller: 'Diego M.', district: 'Compensa', weight: 1.6 },
    { name: 'Freios Rápidos Japiim', seller: 'Diego M.', curve: 'A', district: 'Japiim', weight: 7 },
    { name: 'Distribuidora Parintins Motos', seller: 'Carla N.', district: 'Parintins', segment: 'Motos', weight: 6 },
    { name: 'Oficina do Vale Itacoatiara', seller: 'Carla N.', district: 'Itacoatiara', weight: 3 },
    { name: 'Turbo Diesel Distrito', seller: 'Carla N.', curve: 'A', district: 'Itacoatiara', segment: 'Linha pesada', weight: 10 },
    { name: 'Center Car Cidade de Deus', seller: 'Marcos P.', curve: 'A', district: 'Cidade de Deus', weight: 7 },
    { name: 'Auto Center Flores II', seller: 'Lívia R.', curve: 'A', district: 'Flores', weight: 9 },
    { name: 'Comercial Peças Manacapuru', seller: 'Thiago A.', curve: 'A', district: 'Manacapuru', weight: 8 },
    { name: 'Rei dos Rolamentos', seller: 'Paula V.', curve: 'A', district: 'Nova Cidade', weight: 7 },
  ];
  const usedNames = new Set(named.map((n) => n.name));
  const weights = new Map<string, number>();
  const customers: CustomerRow[] = [];
  const phone = () => `(92) 9${ri(8100, 9999)}-${ri(1000, 9999)}`;
  const mkCustomer = (seller: (typeof sellers)[number], n?: Named): CustomerRow => {
    const districts = districtsByTeam[seller.team]!;
    const district = n?.district ?? pick(districts);
    const interior = seller.team === 'Interior';
    let name = n?.name;
    while (!name || (!n && usedNames.has(name))) {
      name = `${pick(prefixes)} ${pick(districts)}`;
      if (usedNames.has(name)) name = `${name} ${pick(['Irmãos', '& Filhos', 'Express', 'Prime', 'Master', 'Plus', 'do Bairro', 'Avenida'])}`;
    }
    usedNames.add(name);
    const segment = n?.segment ?? (rnd() < 0.62 ? 'Linha leve' : rnd() < 0.6 ? 'Linha pesada' : 'Motos');
    const id = uuid();
    const w = n?.weight ?? Math.exp(r(-1.2, 1.4)); // lognormal-ish
    weights.set(id, w);
    const row: CustomerRow = {
      id,
      ...T,
      erp_code: String(10000 + customers.length + 1),
      legal_name: `${name} Comércio de Peças Ltda`,
      trade_name: name,
      cnpj: `${String(ri(10, 99))}.${String(ri(100, 999))}.${String(ri(100, 999))}/0001-${String(ri(10, 99))}`,
      segment,
      abc_curve: 'C',
      address: `${pick(streets)}, ${ri(10, 2400)}`,
      city: interior ? district : 'Manaus',
      district: interior ? 'Centro' : district,
      // coordenadas aproximadas do bairro / cidade (fictícias, para o mapa fazer sentido)
      lat: (PLACES[district]?.[0] ?? -3.08) + r(-0.012, 0.012),
      lng: (PLACES[district]?.[1] ?? -60.0) + r(-0.012, 0.012),
      credit_limit_cents: 0,
      seller_id: seller.id,
      phone: phone(),
      email: `compras@${name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')}.com.br`,
      customer_since: n?.since ?? `${ri(2012, 2024)}-${String(ri(1, 12)).padStart(2, '0')}-${String(ri(1, 28)).padStart(2, '0')}`,
    };
    customers.push(row);
    t.customer_price_table.push({ ...T, customer_id: id, price_table_id: interior ? tblInterior.id : tblManaus.id });
    return row;
  };
  const customerByName = new Map<string, CustomerRow>();
  for (const s of sellers) {
    const mine = named.filter((n) => n.seller === s.short);
    for (const n of mine) customerByName.set(n.name, mkCustomer(s, n));
    for (let i = mine.length; i < s.wallet; i++) mkCustomer(s);
  }
  t.customer.push(...customers);
  const C = (name: string) => customerByName.get(name)!;
  const tableOf = (cid: string) => t.customer_price_table.find((x) => x.customer_id === cid)!.price_table_id;

  // ---------- notas (faturamento) ----------
  const productsBySegment = (seg: string) =>
    products.filter((p) => (seg === 'Motos' ? p.erp_code.includes('-7') || p.erp_code === 'OLE-2050' || p.erp_code === 'KRL-0160' : !p.erp_code.includes('-7')));
  const invoices: InvoiceRow[] = [];
  const invoiceItems: InvoiceItemRow[] = [];
  let invNumber = 450000;
  const itemsFrom = addDays(`${ym}-01`, -95); // itens só dos últimos ~3 meses (mix e sugestão)
  const makeInvoice = (cust: CustomerRow, sellerId: string, date: string, targetCents: number, lineCount?: number) => {
    const id = uuid();
    const issued = at(date, `${String(ri(8, 17)).padStart(2, '0')}:${String(ri(0, 59)).padStart(2, '0')}`);
    let total = 0;
    if (date >= itemsFrom) {
      const pool = productsBySegment(cust.segment);
      const lines = [...new Set(pool.map((p) => p.line))].sort(() => rnd() - 0.5).slice(0, Math.max(1, lineCount ?? ri(1, 4)));
      const chosen = lines.map((ln) => pick(pool.filter((p) => p.line === ln)));
      if (rnd() < 0.35) chosen.push(pick(pool));
      const shares = chosen.map(() => r(0.5, 1.5));
      const sumShares = shares.reduce((a, b) => a + b, 0);
      const tbl = tableOf(cust.id);
      chosen.forEach((p, i) => {
        const unit = priceCents.get(`${p.id}|${tbl}`)!;
        const qty = Math.max(1, Math.round((targetCents * shares[i]!) / sumShares / unit));
        const lineTotal = qty * unit;
        total += lineTotal;
        invoiceItems.push({ id: uuid(), ...T, invoice_id: id, product_id: p.id, quantity: qty, unit_price_cents: unit, total_cents: lineTotal });
      });
    } else {
      total = Math.round(targetCents / 100) * 100;
    }
    invoices.push({ id, ...T, erp_code: `NF ${++invNumber}`, customer_id: cust.id, seller_id: sellerId, branch_id: sellers.find((s) => s.id === sellerId)!.branch.id, issued_at: issued, total_cents: total });
    return total;
  };
  const randomBizDay = (monthYm: string, before?: string) => {
    const all: string[] = [];
    for (let d = `${monthYm}-01`; d.startsWith(monthYm); d = addDays(d, 1)) if (isBusinessDay(d, holidaySet) && (!before || d < before)) all.push(d);
    return all.length ? pick(all) : `${monthYm}-01`;
  };
  const fixedLast: Record<string, number> = { 'Mecânica Tarumã': 52, 'Auto Center Flores II': 71, 'Comercial Peças Manacapuru': 64, 'Turbo Diesel Distrito': 58, 'Freios Rápidos Japiim': 52, 'Rei dos Rolamentos': 49, 'Center Car Cidade de Deus': 46 };
  const idleSince = new Map<string, string>(); // clientes que pararam: sem nota a partir desta data
  for (const [name, d] of Object.entries(fixedLast)) idleSince.set(C(name).id, addDays(today, -d));

  for (const s of sellers) {
    const wallet = customers.filter((c) => c.seller_id === s.id);
    const wsum = wallet.reduce((a, c) => a + weights.get(c.id)!, 0);
    // clientes parados (sem compra há 45+ dias) para dar realismo ao farol
    const idleShare = 0.08 + (1 - s.cov) * 0.25;
    for (const c of wallet) if (!idleSince.has(c.id) && !named.some((n) => n.name === c.trade_name) && rnd() < idleShare) idleSince.set(c.id, addDays(today, -ri(46, 200)));
    // 12 meses anteriores
    const [cy, cm] = ym.split('-').map(Number) as [number, number];
    for (let m = 12; m >= 1; m--) {
      const d = new Date(Date.UTC(cy, cm - 1 - m, 1));
      const monthYm = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const monthRevenue = s.target * r(0.86, 1.08) * 100;
      const buyers = wallet.filter((c) => {
        const stop = idleSince.get(c.id);
        if (stop) {
          const stopYm = stop.slice(0, 7);
          if (monthYm > stopYm) return false;
          if (monthYm === stopYm) return true; // a última compra é exatamente na data de parada
        }
        const w = weights.get(c.id)!;
        return rnd() < Math.min(0.95, 0.45 + w * 0.12);
      });
      const bsum = buyers.reduce((a, c) => a + weights.get(c.id)!, 0) || 1;
      for (const c of buyers) {
        const stop = idleSince.get(c.id);
        const date = stop && stop.startsWith(monthYm) ? stop : randomBizDay(monthYm);
        makeInvoice(c, s.id, date, (monthRevenue * weights.get(c.id)!) / bsum);
      }
    }
    void wsum;
    // mês atual até ontem
    if (elapsedBizDays.length > 0) {
      const mtd = s.target * s.proj * (days.elapsed / days.total) * 100;
      const covFactor = Math.min(1, (days.elapsed + 3) / 10);
      const positivatedCount = Math.round(s.wallet * s.cov * covFactor);
      const eligible = wallet.filter((c) => !idleSince.has(c.id));
      const mustBuy = s.short === 'Rafael S.' ? ['Auto Peças Rio Negro', 'Freios & Cia Cidade Nova', 'Moto Peças Novo Israel', 'Center Car Ponta Negra', 'Oficina Santa Etelvina'].map(C) : [];
      const rest = eligible.filter((c) => !mustBuy.includes(c)).sort((a, b) => weights.get(b.id)! * r(0.5, 1.5) - weights.get(a.id)! * r(0.5, 1.5));
      const buyers = [...mustBuy, ...rest].slice(0, positivatedCount);
      const bsum = buyers.reduce((a, c) => a + weights.get(c.id)!, 0) || 1;
      const mixTarget = 4 * s.mix;
      for (const c of buyers) {
        const date = c.trade_name === 'Auto Peças Rio Negro' ? elapsedBizDays[Math.max(0, elapsedBizDays.length - 4)]! : pick(elapsedBizDays);
        const lc = Math.max(1, Math.min(7, Math.round(mixTarget + r(-1.3, 1.3))));
        makeInvoice(c, s.id, date, (mtd * weights.get(c.id)!) / bsum, lc);
      }
    }
  }
  t.invoice.push(...invoices);
  t.invoice_item.push(...invoiceItems);

  // ---------- curva ABC (12 meses) ----------
  const rev12 = new Map<string, number>();
  const from12 = addDays(today, -365);
  for (const c of customers) rev12.set(c.id, 0);
  for (const inv of invoices) if (inv.issued_at.slice(0, 10) >= from12) rev12.set(inv.customer_id, (rev12.get(inv.customer_id) ?? 0) + inv.total_cents);
  for (const s of sellers) {
    const m = new Map([...rev12].filter(([id]) => customers.find((c) => c.id === id)!.seller_id === s.id));
    const curves = abcCurve(m);
    for (const c of customers) if (curves.has(c.id)) c.abc_curve = curves.get(c.id)!;
  }
  for (const n of named) if (n.curve) C(n.name).abc_curve = n.curve;
  C('Center Car Ponta Negra').abc_curve = 'B';

  // ---------- títulos (contas a receber) ----------
  const openByCustomer = new Map<string, number>();
  let docSeq = 70000;
  for (const inv of invoices) {
    const issued = inv.issued_at.slice(0, 10);
    for (const [k, dd] of [[0, 28], [1, 56]] as const) {
      const due = addDays(issued, dd);
      if (due < addDays(today, -3)) continue; // pagos
      const amount = Math.round(inv.total_cents / 2);
      t.receivable.push({ id: uuid(), ...T, customer_id: inv.customer_id, document: `${inv.erp_code.replace('NF ', '')}-${k + 1}`, due_date: due, amount_cents: amount, open_amount_cents: amount, status: 'open' });
      openByCustomer.set(inv.customer_id, (openByCustomer.get(inv.customer_id) ?? 0) + amount);
    }
  }
  // inadimplência (vencidos há 30+ dias) para fechar o % de cada vendedor
  for (const s of sellers) {
    const wallet = customers.filter((c) => c.seller_id === s.id);
    const open = wallet.reduce((a, c) => a + (openByCustomer.get(c.id) ?? 0), 0);
    let lateTotal = Math.round((open * (s.del / 100)) / (1 - s.del / 100));
    const debtors: CustomerRow[] = [];
    if (s.short === 'Rafael S.') {
      const cc = C('Center Car Ponta Negra');
      for (const [amt, d] of [[322000, 41], [320000, 63]] as const) {
        t.receivable.push({ id: uuid(), ...T, customer_id: cc.id, document: `${++docSeq}-1`, due_date: addDays(today, -d), amount_cents: amt, open_amount_cents: amt, status: 'overdue' });
        lateTotal -= amt;
      }
    }
    const candidates = wallet.filter((c) => !['Auto Peças Rio Negro', 'Retífica Monte das Oliveiras', 'Freios & Cia Cidade Nova', 'Moto Peças Novo Israel', 'Center Car Ponta Negra'].includes(c.trade_name));
    while (lateTotal > 50000 && debtors.length < 8) {
      const c = pick(candidates);
      if (debtors.includes(c)) continue;
      debtors.push(c);
      const amt = debtors.length === 8 ? lateTotal : Math.min(lateTotal, Math.round(r(0.25, 0.6) * lateTotal));
      t.receivable.push({ id: uuid(), ...T, customer_id: c.id, document: `${++docSeq}-1`, due_date: addDays(today, -ri(35, 120)), amount_cents: amt, open_amount_cents: amt, status: 'overdue' });
      lateTotal -= amt;
    }
    // alguns vencidos recentes (< 30 dias): aparecem no app, não contam na inadimplência
    for (let i = 0; i < 2; i++) {
      const c = pick(candidates);
      const amt = ri(400, 2500) * 100;
      t.receivable.push({ id: uuid(), ...T, customer_id: c.id, document: `${++docSeq}-1`, due_date: addDays(today, -ri(3, 20)), amount_cents: amt, open_amount_cents: amt, status: 'overdue' });
    }
  }
  const openTotal = (cid: string) => t.receivable.filter((x) => x.customer_id === cid).reduce((a, x) => a + x.open_amount_cents, 0);

  // ---------- limite de crédito ----------
  for (const c of customers) {
    const avg = (rev12.get(c.id) ?? 0) / 12;
    c.credit_limit_cents = Math.max(500000, Math.round((avg * 2.4) / 100000) * 100000);
    if (c.credit_limit_cents < openTotal(c.id) + 100000) c.credit_limit_cents = Math.ceil((openTotal(c.id) + 300000) / 100000) * 100000;
  }

  // ---------- rotas: todos os dias úteis do mês + semana atual e a próxima ----------
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const windows = ['08:00', '08:45', '09:30', '10:15', '11:00', '13:30', '14:15', '15:00', '15:45'];
  const routeStopsBySellerDate = new Map<string, string[]>();
  const routeDates = new Set<string>();
  for (let d = `${ym}-01`; d.startsWith(ym); d = addDays(d, 1)) if (isBusinessDay(d, holidaySet)) routeDates.add(d);
  for (let i = 0; i < 12; i++) {
    const d = addDays(monday, i);
    if (isBusinessDay(d, holidaySet)) routeDates.add(d);
  }
  if (!routeDates.has(today)) routeDates.add(today);
  const sortedDates = [...routeDates].sort();
  const start = { lat: -3.125, lng: -59.97 }; // CD Manaus (Distrito Industrial, fictício)
  for (const s of sellers) {
    // carteira agrupada por bairro: cada dia visita uma região, como um roteiro de verdade
    const wallet = customers.filter((c) => c.seller_id === s.id).sort((a, b) => `${a.city}|${a.district}`.localeCompare(`${b.city}|${b.district}`) || a.erp_code.localeCompare(b.erp_code));
    let cursor = 0;
    for (const date of sortedDates) {
      const plan = { id: uuid(), ...T, seller_id: s.id, date, status: 'planned', region: s.team };
      t.route_plan.push(plan);
      let stops: CustomerRow[];
      if (s.id === rafael.id && date === today) {
        stops = ['Freios & Cia Cidade Nova', 'Oficina Santa Etelvina', 'Moto Peças Novo Israel', 'Auto Peças Rio Negro', 'Mecânica Tarumã', 'Retífica Monte das Oliveiras'].map(C);
        const others = wallet.filter((c) => !stops.includes(c) && c.trade_name !== 'Center Car Ponta Negra' && PLACES[c.district]);
        stops.push(...nearestNeighborOrder(stops[stops.length - 1]!, others).slice(0, 3));
      } else {
        const n = ri(7, 9);
        const chunk: CustomerRow[] = [];
        for (let k = 0; k < n; k++) chunk.push(wallet[(cursor + k) % wallet.length]!);
        cursor = (cursor + n) % wallet.length;
        stops = nearestNeighborOrder(start, [...new Set(chunk)]);
      }
      stops.forEach((c, idx) => {
        const st = windows[idx] ?? '16:30';
        const [h, m] = st.split(':').map(Number) as [number, number];
        const endMin = h * 60 + m + 40;
        t.route_stop.push({ id: uuid(), ...T, route_plan_id: plan.id, customer_id: c.id, sequence: idx + 1, window_start: st, window_end: `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}` });
      });
      routeStopsBySellerDate.set(`${s.id}|${date}`, stops.map((c) => c.id));
    }
  }
  const stopId = (sellerId: string, customerId: string) => {
    const plan = t.route_plan.find((p) => p.seller_id === sellerId && p.date === today)!;
    return t.route_stop.find((x) => x.route_plan_id === plan.id && x.customer_id === customerId)?.id ?? '';
  };

  // ---------- pedidos (saída) ----------
  const yesterday = (() => {
    let d = addDays(today, -1);
    while (!isBusinessDay(d, new Set())) d = addDays(d, -1);
    return d;
  })();
  const orderLines = (cust: CustomerRow, targetCents: number, nLines: number, discountPct: number) => {
    const pool = productsBySegment(cust.segment);
    const chosen = [...pool].sort(() => rnd() - 0.5).slice(0, nLines);
    const tbl = tableOf(cust.id);
    const weightsL = chosen.map(() => r(0.6, 1.4));
    const ws = weightsL.reduce((a, b) => a + b, 0);
    const gross = targetCents / (1 - discountPct / 100);
    const lines = chosen.map((p, i) => {
      const unit = priceCents.get(`${p.id}|${tbl}`)!;
      return { product: p, unit, qty: Math.max(1, Math.round((gross * weightsL[i]!) / ws / unit)) };
    });
    // aproxima o total do valor do mockup: tira unidades/linhas caras ou soma unidades baratas
    const sum = () => lines.reduce((a, l) => a + l.unit * l.qty, 0);
    for (let guard = 0; guard < 500 && sum() > gross * 1.01; guard++) {
      const multi = lines.filter((l) => l.qty > 1).sort((a, b) => b.unit - a.unit)[0];
      if (multi) multi.qty -= 1;
      else if (lines.length > 2) lines.splice(lines.indexOf([...lines].sort((a, b) => b.unit - a.unit)[0]!), 1);
      else break;
    }
    const cheapest = [...lines].sort((a, b) => a.unit - b.unit)[0]!;
    while (sum() + cheapest.unit <= gross) cheapest.qty += 1;
    return lines;
  };
  const pushOrder = (o: {
    number: string; seller: (typeof sellers)[number]; cust: CustomerRow; date: string; time: string; total: number; lines: number; disc: number; status: string;
    pending?: string; rejection?: string; offline?: boolean; stop?: string; fixedLines?: Array<{ code: string; qty: number }>;
  }) => {
    const id = uuid();
    const lines = o.fixedLines
      ? o.fixedLines.map((fl) => ({ product: productByCode.get(fl.code)!, unit: priceCents.get(`${productByCode.get(fl.code)!.id}|${tableOf(o.cust.id)}`)!, qty: fl.qty }))
      : orderLines(o.cust, o.total * 100, o.lines, o.disc);
    let subtotal = 0;
    let disc = 0;
    for (const l of lines) {
      const g = l.unit * l.qty;
      const d = Math.round((g * o.disc) / 100);
      subtotal += g;
      disc += d;
      t.sales_order_item.push({ id: uuid(), ...T, order_id: id, product_id: l.product.id, quantity: l.qty, unit_price_cents: l.unit, discount_pct: o.disc, total_cents: g - d });
    }
    const received = at(o.date, o.time);
    const row: SalesOrderRow = {
      id, ...T, number: o.number, idempotency_key: id, seller_id: o.seller.id, customer_id: o.cust.id, branch_id: o.seller.branch.id, price_table_id: tableOf(o.cust.id),
      discount_pct: o.disc, subtotal_cents: subtotal, discount_amount_cents: disc, total_cents: subtotal - disc, payment_terms: '28/56 dias', status: o.status,
      pending_reason: o.pending ?? '', rejection_reason: o.rejection ?? '', erp_order_code: ['integrated', 'sent_to_erp'].includes(o.status) ? `PV${o.number}` : '',
      route_stop_id: o.stop ?? '', created_offline_at: o.offline ? received : '', received_at: received, updated_at: received,
    };
    t.sales_order.push(row);
    if (o.status === 'pending_approval') {
      t.order_approval.push({ id: uuid(), ...T, order_id: id, requested_by: o.seller.row.user_id, reason_requested: o.pending ?? '', requested_at: received, decided_by: '', decision: '', reason: '', decided_at: '' });
    }
    return row;
  };
  const daysAgoBiz = (n: number) => {
    let d = today;
    let k = 0;
    while (k < n) {
      d = addDays(d, -1);
      if (isBusinessDay(d, new Set())) k++;
    }
    return d;
  };
  // pedidos do mês (histórico), numerados antes de 10479
  let seq = 10300;
  const monthStart = `${ym}-01`;
  for (let i = 0; i < 150; i++) {
    const s = pick(sellers);
    const wallet = customers.filter((c) => c.seller_id === s.id && !idleSince.has(c.id));
    const date = elapsedBizDays.length ? pick(elapsedBizDays.filter((d) => d < yesterday)) ?? monthStart : addDays(today, -ri(3, 20));
    if (!date) continue;
    seq += 1;
    const st = rnd() < 0.93 ? 'integrated' : 'rejected';
    pushOrder({ number: String(seq), seller: s, cust: pick(wallet), date, time: `${String(ri(8, 16)).padStart(2, '0')}:${String(ri(0, 59)).padStart(2, '0')}`, total: ri(600, 9000), lines: ri(3, 14), disc: pick([0, 1, 2, 2.5, 3, 4, 5]), status: st, rejection: st === 'rejected' ? pick(['Preço divergente da tabela do ERP', 'Cliente bloqueado no ERP · crédito']) : '' });
  }
  // Rafael: até 23 pedidos no mês no total
  const rafaelCount = () => t.sales_order.filter((o) => o.seller_id === rafael.id).length;
  const rafaelWallet = customers.filter((c) => c.seller_id === rafael.id && !idleSince.has(c.id));
  while (rafaelCount() < 18 && elapsedBizDays.length > 1) {
    seq += 1;
    pushOrder({ number: String(seq), seller: rafael, cust: pick(rafaelWallet), date: pick(elapsedBizDays.slice(0, -1)), time: `${String(ri(8, 16)).padStart(2, '0')}:${String(ri(0, 59)).padStart(2, '0')}`, total: ri(900, 8000), lines: ri(4, 16), disc: pick([0, 2, 3, 4]), status: 'integrated' });
  }
  // pedidos dos mockups
  pushOrder({ number: '10479', seller: rafael, cust: C('Oficina Santa Etelvina'), date: daysAgoBiz(3), time: '10:12', total: 1845.4, lines: 7, disc: 2, status: 'integrated' });
  pushOrder({ number: '10482', seller: rafael, cust: C('Retífica Monte das Oliveiras'), date: yesterday, time: '16:20', total: 5940, lines: 9, disc: 3, status: 'pending_approval', pending: 'Limite de crédito excedido em R$ 1.120,00' });
  pushOrder({ number: '10488', seller: rafael, cust: C('Center Car Ponta Negra'), date: yesterday, time: '11:12', total: 3160, lines: 15, disc: 2, status: 'rejected', rejection: 'Títulos vencidos · fale com o financeiro' });
  pushOrder({ number: '10491', seller: sellerByShort('Diego M.'), cust: C('Lubri Center Compensa'), date: today, time: '07:55', total: 978.4, lines: 5, disc: 1.5, status: 'integrated' });
  pushOrder({ number: '10493', seller: sellerByShort('Carla N.'), cust: C('Oficina do Vale Itacoatiara'), date: today, time: '08:01', total: 3402.1, lines: 8, disc: 0, status: 'rejected', rejection: 'Preço divergente da tabela do ERP' });
  pushOrder({ number: '10494', seller: rafael, cust: C('Freios & Cia Cidade Nova'), date: today, time: '08:05', total: 4870, lines: 21, disc: 7, status: 'pending_approval', pending: 'Desconto 7,0% · alçada do vendedor 5,0%', stop: stopId(rafael.id, C('Freios & Cia Cidade Nova').id) });
  pushOrder({ number: '10495', seller: rafael, cust: C('Moto Peças Novo Israel'), date: today, time: '09:02', total: 2310, lines: 12, disc: 4, status: 'integrated', offline: true, stop: stopId(rafael.id, C('Moto Peças Novo Israel').id) });
  pushOrder({ number: '10497', seller: sellerByShort('Carla N.'), cust: C('Distribuidora Parintins Motos'), date: today, time: '09:38', total: 8615, lines: 10, disc: 3, status: 'sent_to_erp' });
  pushOrder({ number: '10498', seller: sellerByShort('Diego M.'), cust: C('Peças Express Aleixo'), date: today, time: '09:44', total: 1240.9, lines: 6, disc: 2, status: 'integrated' });
  pushOrder({ number: '10501', seller: sellerByShort('Bruna T.'), cust: C('Auto Center Flores'), date: today, time: '09:51', total: 12380, lines: 18, disc: 6.5, status: 'pending_approval', pending: 'Desconto 6,5% · alçada do vendedor 6,0%' });
  // mais alguns pedidos de hoje para o farol
  for (let i = 0; i < 14; i++) {
    const s = pick(sellers.filter((x) => x.id !== rafael.id));
    const wallet = customers.filter((c) => c.seller_id === s.id && !idleSince.has(c.id));
    const num = 10502 + i;
    pushOrder({ number: String(num), seller: s, cust: pick(wallet), date: today, time: `0${ri(7, 9)}:${String(ri(10, 59)).padStart(2, '0')}`, total: ri(700, 7000), lines: ri(3, 12), disc: pick([0, 1, 2, 3, 4]), status: rnd() < 0.85 ? 'integrated' : 'sent_to_erp' });
  }
  // crédito da Retífica: disponível = R$ 4.820 (pedido 10482 excede em R$ 1.120)
  const ret = C('Retífica Monte das Oliveiras');
  const o10482 = t.sales_order.find((o) => o.number === '10482')!;
  ret.credit_limit_cents = openTotal(ret.id) + o10482.total_cents - 112000;
  // Rio Negro: limite disponível R$ 15.200
  const rio = C('Auto Peças Rio Negro');
  rio.credit_limit_cents = openTotal(rio.id) + 1520000;

  // ---------- visitas de hoje (Rafael: paradas 1 a 3 feitas) ----------
  const o10494 = t.sales_order.find((o) => o.number === '10494')!;
  const o10495 = t.sales_order.find((o) => o.number === '10495')!;
  const visits: Array<[string, string, string, string]> = [
    ['Freios & Cia Cidade Nova', '08:05', 'order', o10494.id],
    ['Oficina Santa Etelvina', '08:40', 'no_order', ''],
    ['Moto Peças Novo Israel', '09:02', 'order', o10495.id],
  ];
  for (const [name, time, outcome, orderId] of visits) {
    const c = C(name);
    t.visit.push({
      id: uuid(), ...T, seller_id: rafael.id, customer_id: c.id, route_stop_id: stopId(rafael.id, c.id), checkin_at: at(today, time), received_at: at(today, time),
      lat: c.lat, lng: c.lng, outcome, no_order_reason: outcome === 'no_order' ? 'Estoque alto' : '', order_id: orderId,
      checkout_at: new Date(Date.parse(at(today, time)) + 18 * 60000).toISOString(), closed_by: 'seller',
    });
  }

  // ---------- indicadores, metas, plano de RV ----------
  const kpis = [
    { code: 'revenue', name: 'Faturamento', unit: 'R$', direction: 'higher_is_better', projectable: true, rule_text: 'Realizado ÷ meta, notas faturadas no mês' },
    { code: 'coverage', name: 'Positivação', unit: 'clientes', direction: 'higher_is_better', projectable: false, rule_text: 'Clientes com nota no mês ÷ carteira (vendedor da nota)' },
    { code: 'mix', name: 'Mix de linhas', unit: 'linhas/cliente', direction: 'higher_is_better', projectable: false, rule_text: 'Média de linhas de produto por cliente positivado' },
    { code: 'campaign', name: 'Campanha do mês', unit: 'un', direction: 'higher_is_better', projectable: true, rule_text: 'Itens da campanha vendidos ÷ meta da campanha' },
    { code: 'delinquency', name: 'Inadimplência', unit: '%', direction: 'lower_is_better', projectable: false, rule_text: 'Títulos vencidos há 30+ dias ÷ carteira em aberto' },
  ];
  for (const k of kpis) t.kpi.push({ id: uuid(), ...T, ...k });
  const periodPrev = { id: uuid(), ...T, year_month: prevYm, status: 'closed', closed_by: 'Juliana Melo', closed_at: at(`${ym}-02`, '18:10') };
  const periodCur = { id: uuid(), ...T, year_month: ym, status: 'open', closed_by: '', closed_at: '' };
  t.goal_period.push(periodPrev, periodCur);
  for (const period of [periodPrev, periodCur]) {
    for (const s of sellers) {
      const g = (kpi_code: string, target_value: number) => t.goal.push({ id: uuid(), ...T, period_id: period.id, seller_id: s.id, kpi_code, target_value });
      g('revenue', s.target);
      g('coverage', s.wallet);
      g('mix', 4);
      g('campaign', Math.round(s.target / 1800));
      g('delinquency', 3);
    }
  }
  t.setting.push(
    { ...T, key: 'delinquency_grace_days', value: '30', description: 'Inadimplência: títulos vencidos há mais de N dias' },
    { ...T, key: 'idle_days_alert', value: '45', description: 'Cliente "sem compra" a partir de N dias (app e farol)' },
    { ...T, key: 'team_coverage_target_pct', value: '70', description: 'Meta de positivação da equipe (farol de clientes)' },
    { ...T, key: 'integrated_target_pct', value: '95', description: 'Meta de pedidos integrados sem intervenção do BKO' },
    { ...T, key: 'erp_auto_integrate_seconds', value: '8', description: 'Fase M: segundos até um pedido "enviado ao ERP" virar "integrado"' },
    { ...T, key: 'simulate_billing_from', value: now.toISOString(), description: 'Fase M: pedidos integrados depois deste instante contam como faturados nas metas' },
  );
  const plan = {
    id: uuid(), ...T, name: 'Vendedor externo 2026', valid_from: ym, applies_to: 'Vendedores externos', max_amount_cents: 390000,
    updated_at: at(`${ym}-02`, '14:31'), updated_by: 'Juliana M. (analista)', last_change: 'peso de mix de 10% para 15%',
  };
  t.incentive_plan.push(plan);
  const rules: Array<[string, number, boolean, Array<[number, string, number]>]> = [
    ['revenue', 50, false, [[0, 'zero', 0], [80, 'proportional', 0], [100, 'fixed', 100], [110, 'fixed', 120]]],
    ['coverage', 25, false, [[0, 'zero', 0], [70, 'proportional', 0], [100, 'fixed', 100]]],
    ['mix', 15, false, [[0, 'zero', 0], [75, 'proportional', 0], [100, 'fixed', 100]]],
    ['campaign', 10, false, [[0, 'zero', 0], [100, 'fixed', 100]]],
    ['delinquency', 0, true, []],
  ];
  for (const [kpi_code, weight_pct, is_trigger, bands] of rules) {
    t.incentive_rule.push({ id: uuid(), ...T, plan_id: plan.id, kpi_code, weight_pct, is_trigger });
    for (const [from_pct, mode, payout_pct] of bands) t.incentive_band.push({ id: uuid(), ...T, plan_id: plan.id, kpi_code, from_pct, mode, payout_pct });
  }

  // ---------- alçadas ----------
  t.discount_level.push(
    { ...T, role: 'seller', max_discount_pct: 5, description: 'Vendedor' },
    { ...T, role: 'supervisor', max_discount_pct: 8, description: 'Supervisor' },
    { ...T, role: 'manager', max_discount_pct: 12, description: 'Gestor comercial' },
    { ...T, role: 'above_manager', max_discount_pct: 0, description: 'block' },
  );
  t.discount_exception.push(
    { ...T, seller_id: sellerByShort('Bruna T.').id, max_discount_pct: 6 },
    { ...T, seller_id: sellerByShort('Carla N.').id, max_discount_pct: 5.5 },
  );

  // ---------- auditoria inicial ----------
  t.audit_log.push({
    id: uuid(), ...T, user_id: analyst.id, user_name: 'Juliana M.', entity: 'incentive_rule', entity_id: plan.id, action: 'update',
    before: JSON.stringify({ kpi_code: 'mix', weight_pct: 10 }), after: JSON.stringify({ kpi_code: 'mix', weight_pct: 15 }), at: at(`${ym}-02`, '14:31'),
  });

  // pedidos ordenados por número
  t.sales_order.sort((a, b) => Number(a.number) - Number(b.number));
  void routeStopsBySellerDate;
  return t;
}

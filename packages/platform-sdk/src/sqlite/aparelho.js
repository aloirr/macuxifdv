import { criarArmazenamentoSqlite } from './armazenamento';
import { arquivoDoUsuario, bancosDeUsuario } from './arquivo';
import { apagarOrigemSePossivel, ORIGEM_VAZIA, passarDoAsyncStorage, } from './passagem';
/** Chave global do shell no AsyncStorage (sai no bloqueio junto com as `fv:u:`). */
export const chaveEspelhoArmazenamento = (usuarioId) => `fv:u:${usuarioId}:armazenamento`;
/** Tabela do §4 do desenho, sem efeito colateral. */
export function escolherArmazenamento(c) {
    if (c.espelho) {
        // já passou: a trava de emergência não vale e não há reserva
        if (!c.sqliteDisponivel)
            return { tipo: 'erro', detalhe: 'os dados deste usuário estão no SQLite, indisponível neste APK' };
        if (!c.arquivo)
            return { tipo: 'erro', detalhe: 'sessão sem id de usuário, com os dados já no SQLite' };
        return { tipo: 'sqlite', arquivo: c.arquivo };
    }
    if (!c.sqliteDisponivel)
        return { tipo: 'asyncstorage', motivo: 'sem_sqlite' };
    if (!c.arquivo)
        return { tipo: 'asyncstorage', motivo: 'ids_invalidos' };
    if (c.forcarAsyncStorage)
        return { tipo: 'asyncstorage', motivo: 'forcado' };
    return { tipo: 'sqlite', arquivo: c.arquivo };
}
const mensagem = (e) => (e instanceof Error ? e.message : String(e));
export function criarArmazenamentosDoAparelho(o) {
    const agora = o.agora ?? (() => new Date());
    const log = o.registrarErro ?? o.opcoes.registrarErro ?? (() => { });
    /** Arquivo → instância (promessa: duas aberturas ao mesmo tempo recebem a mesma). */
    const instancias = new Map();
    /** Arquivo → abertura completa (passagem incluída). Só fica guardada a que deu `sqlite`. */
    const aberturas = new Map();
    const esquecer = (arquivo) => {
        instancias.delete(arquivo);
        aberturas.delete(arquivo);
    };
    const fechar = async (arquivo) => {
        const p = instancias.get(arquivo);
        esquecer(arquivo);
        if (!p)
            return;
        const i = await p.catch(() => null);
        await i?.bruto.fechar().catch((e) => log(`fechar o banco local falhou: ${mensagem(e)}`));
    };
    const instancia = (arquivo) => {
        const existente = instancias.get(arquivo);
        if (existente)
            return existente.then((i) => i.envolto);
        const p = (async () => {
            const bruto = criarArmazenamentoSqlite(await o.sistema.abrir(arquivo), o.opcoes);
            try {
                await bruto.pronto;
            }
            catch (e) {
                await bruto.fechar().catch(() => undefined);
                throw e;
            }
            // `fechar()` de quem usa também tira a instância do registro (a próxima abertura cria outra)
            const envolto = { ...bruto, fechar: () => fechar(arquivo) };
            return { bruto, envolto };
        })();
        instancias.set(arquivo, p);
        p.catch(() => {
            if (instancias.get(arquivo) === p)
                instancias.delete(arquivo);
        });
        return p.then((i) => i.envolto);
    };
    const abrirSqlite = async (u, arquivo, espelho) => {
        const falhou = (motivo, detalhe) => espelho ? { tipo: 'erro', arquivo, detalhe } : { tipo: 'asyncstorage', motivo, armazenamento: u.asyncStorage, detalhe };
        let a;
        try {
            a = await instancia(arquivo);
        }
        catch (e) {
            log(`abrir o banco local falhou: ${mensagem(e)}`);
            return falhou('abertura_falhou', mensagem(e));
        }
        // espelho de outro arquivo (mesmo usuário, outro tenant): a origem já foi passada para lá
        const origem = espelho && espelho.arquivo !== arquivo ? ORIGEM_VAZIA : u.asyncStorage;
        const r = await passarDoAsyncStorage({ origem, destino: a, fuso: u.fuso, aoProgredir: u.aoProgredir, registrarErro: log, agora });
        if (r.desfecho === 'abortada') {
            await fechar(arquivo);
            return falhou('passagem_abortada', `${r.etapa}: ${r.erro}`);
        }
        if (!espelho)
            try {
                await u.espelho.gravar({ arquivo, desde: agora().toISOString() });
            }
            catch (e) {
                // o marcador `concluida` já impede recopiar; o espelho é gravado de novo na próxima abertura
                log(`gravar o espelho do armazenamento falhou: ${mensagem(e)}`);
            }
        let origemApagada = false;
        try {
            origemApagada = await apagarOrigemSePossivel({ origem: u.asyncStorage, destino: a, agora });
        }
        catch (e) {
            log(`remover os dados antigos do AsyncStorage falhou (tenta de novo na próxima abertura): ${mensagem(e)}`);
        }
        return { tipo: 'sqlite', arquivo, armazenamento: a, passagem: r.marcador, origemApagada };
    };
    return {
        async abrir(u) {
            const arquivo = arquivoDoUsuario(u);
            const espelho = await u.espelho.ler().catch(() => null);
            const escolha = escolherArmazenamento({
                sqliteDisponivel: o.sqliteDisponivel,
                arquivo,
                forcarAsyncStorage: o.forcarAsyncStorage,
                espelho,
            });
            if (escolha.tipo === 'asyncstorage')
                return { tipo: 'asyncstorage', motivo: escolha.motivo, armazenamento: u.asyncStorage };
            if (escolha.tipo === 'erro')
                return { tipo: 'erro', arquivo, detalhe: escolha.detalhe };
            const emCurso = aberturas.get(escolha.arquivo);
            if (emCurso)
                return emCurso;
            const p = abrirSqlite(u, escolha.arquivo, espelho);
            aberturas.set(escolha.arquivo, p);
            void p.then((r) => {
                if (r.tipo !== 'sqlite' && aberturas.get(escolha.arquivo) === p)
                    aberturas.delete(escolha.arquivo);
            }, () => {
                if (aberturas.get(escolha.arquivo) === p)
                    aberturas.delete(escolha.arquivo);
            });
            return p;
        },
        fechar,
        async fecharTodos() {
            for (const arquivo of [...instancias.keys()])
                await fechar(arquivo);
        },
        async apagarTodos() {
            for (const arquivo of [...instancias.keys()])
                await fechar(arquivo);
            const bancos = bancosDeUsuario(await o.sistema.listar());
            for (const b of bancos)
                await o.sistema.apagar(b);
            return bancos;
        },
        abertos: () => [...instancias.keys()].sort(),
    };
}

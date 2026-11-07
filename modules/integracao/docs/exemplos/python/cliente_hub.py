#!/usr/bin/env python3
"""T-0108 - Exemplo de cliente da API do Hub (/integracao/v1) em Python 3.9+ com `requests`.

Mostra, seguindo o guia (../../guia-api-hub.md):
  - cursor por entidade: nulo = carga inicial completa em partes; com cursor = delta;
  - delta paginado por cursor (keyset): paginas com (alterado_em, external_id) > cursor, ordenadas, um lote por pagina;
  - Idempotency-Key = SHA-256 do conteudo estavel do lote, SEMPRE a mesma ao repetir (rede, 429, 500, 503, com Retry-After);
  - recusa de envelope (400/409/413/422/426) vira RecusaLoteErro e NAO e repetida;
  - erros por linha separados em "reprocessaveis" e "corrigir na origem";
  - devolucao de pedidos: busca ate a lista vir vazia, grava no ERP de forma idempotente e devolve o retorno.

Variaveis de ambiente: MACUXI_HUB_URL, MACUXI_CHAVE (nunca impressa), MACUXI_CONECTOR (padrao erp-matriz),
MACUXI_CONECTOR_VERSAO (opcional), MACUXI_INTERVALO_MS (padrao 5000).

Rodar: pip install -r requirements.txt && python cliente_hub.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote, urlparse

import requests

URL_PADRAO = "https://api-demo.macuxifdv.com.br/integracao/v1"
RE_CHAVE = re.compile(r"^mxc_[A-Za-z0-9_-]{43}$")
STATUS_FINAIS = ("concluido", "concluido_com_erros", "falhou")
STATUS_RECUSA_LOTE = (400, 409, 413, 422, 426)
LIMITE_LOTE = 5000


# ------------------------------------------------------------------ erros ------------------------------------------------------------------
class ErroHub(Exception):
    """Erro devolvido pelo Hub: corpo { codigo, mensagem, detalhes?, requisicao_id }."""

    def __init__(self, status, codigo, mensagem, requisicao_id=None, detalhes=None, erros=None):
        super().__init__(f"{status} {codigo}: {mensagem}")
        self.status = status
        self.codigo = codigo
        self.mensagem = mensagem
        self.requisicao_id = requisicao_id
        self.detalhes = detalhes
        self.erros = erros or []


class RecusaLoteErro(ErroHub):
    """Recusa de envelope em POST /lotes (nenhum lote foi criado): corrija o envelope; repetir igual da o mesmo erro."""


class RejeicaoErp(Exception):
    """O ERP recusou o pedido de forma definitiva (vira o retorno rejeitado_erp)."""


# ------------------------------------------------------------------ utilidades ------------------------------------------------------------------
def comparar_cursor(a, b):
    """alterado_em por instante e, no empate, external_id em ordem de bytes (nao por idioma). Negativo, 0 ou positivo."""
    ta, tb = instante(a["alterado_em"]), instante(b["alterado_em"])
    if ta != tb:
        return -1 if ta < tb else 1
    ea, eb = a["external_id"].encode("utf-8"), b["external_id"].encode("utf-8")
    return (ea > eb) - (ea < eb)


def instante(texto):
    return datetime.fromisoformat(texto.replace("Z", "+00:00")).timestamp()


def agora():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def maior_cursor(registros):
    maior = None
    for r in registros:
        par = {"alterado_em": r["alterado_em"], "external_id": r["external_id"]}
        if maior is None or comparar_cursor(par, maior) > 0:
            maior = par
    return maior


def chave_idempotencia(envelope):
    """SHA-256 hexadecimal das partes estaveis do envelope (enviado_em, cursor, conector_id e versao_conector ficam de fora)."""
    estavel = {
        "versao_contrato": envelope["versao_contrato"],
        "entidade": envelope["entidade"],
        "modo": envelope["modo"],
        "sessao": envelope.get("sessao"),
        "registros": envelope["registros"],
        "linhas_invalidas": envelope.get("linhas_invalidas") or [],
        "linhas_invalidas_omitidas": envelope.get("linhas_invalidas_omitidas") or 0,
    }
    texto = json.dumps(estavel, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def separar_erros(erros):
    """Reprocessaveis (o Hub reprocessa sozinho) x corrigir na origem (no ERP)."""
    return {
        "reprocessaveis": [e for e in erros if e.get("reprocessavel")],
        "corrigir_na_origem": [e for e in erros if not e.get("reprocessavel")],
    }


def ler_config(env=None):
    """Le a configuracao do ambiente. Valida HTTPS (salvo localhost) e o formato da chave, sem nunca citar a chave."""
    env = os.environ if env is None else env
    url = env.get("MACUXI_HUB_URL", URL_PADRAO).rstrip("/")
    analisada = urlparse(url)
    local = analisada.hostname in ("localhost", "127.0.0.1", "::1")
    if analisada.scheme != "https" and not (local and analisada.scheme == "http"):
        raise ValueError("MACUXI_HUB_URL precisa ser https:// (http so e aceito para localhost/127.0.0.1).")
    chave = env.get("MACUXI_CHAVE", "")
    if not RE_CHAVE.match(chave):
        raise ValueError("MACUXI_CHAVE ausente ou fora do formato esperado (mxc_ seguido de 43 caracteres). Peca uma chave ao administrador no BKO.")
    return {
        "url": url,
        "chave": chave,
        "conector_id": env.get("MACUXI_CONECTOR") or "erp-matriz",
        "conector_versao": env.get("MACUXI_CONECTOR_VERSAO") or None,
        "intervalo_ms": float(env.get("MACUXI_INTERVALO_MS", 5000)),
    }


# ------------------------------------------------------------------ cliente ------------------------------------------------------------------
class ClienteHub:
    def __init__(self, url, chave, conector_id="erp-matriz", conector_versao=None, intervalo_ms=5000,
                 max_tentativas=5, espera_base_ms=1000, espera_maxima_ms=60000, timeout_s=30,
                 esperar=None, registrar=None):
        self.url = url.rstrip("/")
        self.conector_id = conector_id
        self.conector_versao = conector_versao
        self.intervalo_ms = intervalo_ms
        self.max_tentativas = max_tentativas
        self.espera_base_ms = espera_base_ms
        self.espera_maxima_ms = espera_maxima_ms
        self.timeout_s = timeout_s
        self._esperar = esperar or (lambda ms: time.sleep(ms / 1000))
        self._registrar = registrar or (lambda _m: None)
        self._chave = chave  # nunca e impressa
        self._sessao = requests.Session()

    def __repr__(self):  # a chave nunca aparece em repr/log
        return f"ClienteHub(url={self.url!r}, conector_id={self.conector_id!r})"

    def _cabecalhos(self, extras=None):
        h = {"Authorization": f"Bearer {self._chave}", "X-Macuxi-Conector-Id": self.conector_id, "Accept": "application/json"}
        if self.conector_versao:  # opcional: uma versao antiga leva 426
            h["X-Macuxi-Conector-Versao"] = self.conector_versao
        h.update(extras or {})
        return h

    def requisitar(self, metodo, caminho, corpo=None, cabecalhos=None):
        """Uma chamada com repeticao em erro de rede, 429, 500 e 503 (Retry-After), SEMPRE com a mesma requisicao
        (portanto a mesma Idempotency-Key). Devolve (status, cabecalhos, corpo_json_ou_None)."""
        dados = None
        extras = dict(cabecalhos or {})
        if corpo is not None:
            dados = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
            extras["Content-Type"] = "application/json"
        ultima = None
        for tentativa in range(1, self.max_tentativas + 1):
            try:
                r = self._sessao.request(metodo, f"{self.url}{caminho}", data=dados, headers=self._cabecalhos(extras), timeout=self.timeout_s)
            except requests.RequestException as e:
                ultima = ErroHub(0, "rede", f"Falha de rede ({type(e).__name__}). Verifique a conexao e o endereco do Hub.")
                if tentativa < self.max_tentativas:
                    self._aguardar_repeticao(tentativa, None, "falha de rede")
                continue
            lido = _corpo_json(r)
            if r.status_code in (429, 500, 503):
                ultima = ErroHub(r.status_code, (lido or {}).get("codigo", "erro_transitorio"), (lido or {}).get("mensagem", "Hub indisponivel no momento."),
                                 (lido or {}).get("requisicao_id"))
                if tentativa < self.max_tentativas:
                    self._aguardar_repeticao(tentativa, r.headers.get("Retry-After"), f"HTTP {r.status_code}")
                continue
            return r.status_code, r.headers, lido
        raise ultima

    def _aguardar_repeticao(self, tentativa, retry_after, motivo):
        ms = self.espera_base_ms * 2 ** (tentativa - 1)
        if retry_after:
            try:
                ms = float(retry_after) * 1000
            except ValueError:
                try:
                    ms = max(0, (parsedate_to_datetime(retry_after).timestamp() - time.time()) * 1000)
                except (TypeError, ValueError):
                    pass
        ms = min(ms, self.espera_maxima_ms)
        self._registrar(f"  repetindo em {int(ms)} ms ({motivo}; tentativa {tentativa} de {self.max_tentativas}), mesma requisicao")
        self._esperar(ms)

    @staticmethod
    def _exigir_sucesso(status, corpo, esperado=(200,)):
        if status in esperado:
            return corpo
        c = corpo or {}
        raise ErroHub(status, c.get("codigo", "erro_http"), c.get("mensagem", f"Resposta inesperada do Hub (HTTP {status})."),
                      c.get("requisicao_id"), c.get("detalhes"), c.get("erros"))

    def consultar_cursor(self, entidade):
        """GET /cursores/{entidade}: cursor nulo = carga inicial completa."""
        return self._exigir_sucesso(*self._sem_cab(self.requisitar("GET", f"/cursores/{quote(entidade)}")))

    @staticmethod
    def _sem_cab(t):
        return t[0], t[2]

    def enviar_lote(self, envelope):
        """POST /lotes com a Idempotency-Key do conteudo. Devolve (aceito, chave, repetido)."""
        chave = chave_idempotencia(envelope)
        status, cab, corpo = self.requisitar("POST", "/lotes", envelope, {"Idempotency-Key": chave})
        if status == 202:
            return corpo, chave, bool(corpo.get("repetido")) or cab.get("Idempotent-Replay") == "true"
        c = corpo or {}
        erros = c.get("erros") or [{"codigo": c.get("codigo", "recusa"), "campo": None, "mensagem": c.get("mensagem", "")}]
        args = (status, c.get("codigo", "recusa"), c.get("mensagem", f"Lote recusado (HTTP {status})."), c.get("requisicao_id"), c.get("detalhes"), erros)
        raise (RecusaLoteErro(*args) if status in STATUS_RECUSA_LOTE else ErroHub(*args))

    def aguardar_lote(self, lote_id, limite_erros=1000, max_consultas=1000):
        for _ in range(max_consultas):
            resultado = self._exigir_sucesso(*self._sem_cab(self.requisitar("GET", f"/lotes/{lote_id}?limite_erros={limite_erros}")))
            if resultado["status"] in STATUS_FINAIS:
                return resultado
            self._esperar(self.intervalo_ms)
        raise RuntimeError(f"O lote {lote_id} nao terminou depois de {max_consultas} consultas.")

    def _montar_envelope(self, entidade, modo, registros, sessao=None, linhas_invalidas=None):
        cursor = maior_cursor(registros)
        env = {"versao_contrato": "v1", "entidade": entidade, "modo": modo}
        if sessao:
            env["sessao"] = sessao
        if cursor:
            env["cursor"] = cursor
        env["enviado_em"] = agora()
        env["conector_id"] = self.conector_id
        if self.conector_versao:
            env["versao_conector"] = self.conector_versao
        env["registros"] = registros
        if linhas_invalidas:
            env["linhas_invalidas"] = linhas_invalidas
        return env

    def enviar_e_aguardar(self, envelope):
        aceito, chave, repetido = self.enviar_lote(envelope)
        resultado = self.aguardar_lote(aceito["lote_id"])
        if resultado["status"] == "falhou":
            raise RuntimeError(f"O lote {resultado['lote_id']} falhou no Hub. Reenvie o mesmo lote (mesma Idempotency-Key) ou informe o suporte.")
        return {"envelope": envelope, "aceito": aceito, "chave": chave, "repetido": repetido, "resultado": resultado,
                "erros": separar_erros(resultado["erros"])}

    def enviar_delta(self, entidade, ler_pagina, cursor=None, tamanho_pagina=LIMITE_LOTE, validar=None):
        """Delta paginado por cursor (keyset). ler_pagina(cursor, limite) le do ERP, ORDENADO, so o que e maior que o cursor.
        validar(registro) devolve None ou {codigo, campo?, mensagem} (vai em linhas_invalidas, sem o valor)."""
        if not 1 <= tamanho_pagina <= LIMITE_LOTE:
            raise ValueError(f"tamanho_pagina precisa estar entre 1 e {LIMITE_LOTE}.")
        lotes, atual = [], cursor
        while True:
            pagina = ler_pagina(atual, tamanho_pagina)
            if not pagina:
                break
            validos, invalidas = [], []
            for r in pagina:
                problema = validar(r) if validar else None
                if problema:
                    linha = {"external_id": r.get("external_id"), "codigo": problema["codigo"], "mensagem": problema["mensagem"]}
                    if problema.get("campo"):
                        linha["campo"] = problema["campo"]
                    invalidas.append(linha)
                else:
                    validos.append(r)
            lotes.append(self.enviar_e_aguardar(self._montar_envelope(entidade, "delta", validos, linhas_invalidas=invalidas)))
            atual = maior_cursor(pagina)  # o cursor local anda com a pagina inteira; o do Hub so avanca com o que ele aceitou
            if len(pagina) < tamanho_pagina:
                break
        return lotes

    def enviar_completo(self, entidade, ler_pagina, tamanho_parte=LIMITE_LOTE):
        """Carga completa em partes de uma mesma sessao (id UUID, parte 1..n, ultimo=true so na ultima)."""
        if not 1 <= tamanho_parte <= LIMITE_LOTE:
            raise ValueError(f"tamanho_parte precisa estar entre 1 e {LIMITE_LOTE}.")
        sessao_id, partes = str(uuid.uuid4()), []
        atual = ler_pagina(None, tamanho_parte)
        numero = 1
        while atual:
            proxima = ler_pagina(maior_cursor(atual), tamanho_parte) if len(atual) == tamanho_parte else []
            sessao = {"id": sessao_id, "parte": numero, "ultimo": not proxima}
            partes.append(self.enviar_e_aguardar(self._montar_envelope(entidade, "completo", atual, sessao=sessao)))
            atual, numero = proxima, numero + 1
        return partes

    def buscar_pendentes(self, limite=50):
        """GET /pedidos/pendentes: o Hub ja marca os pedidos como enviados (tentativa + 1)."""
        return self._exigir_sucesso(*self._sem_cab(self.requisitar("GET", f"/pedidos/pendentes?limite={limite}")))["pedidos"]

    def devolver_retorno(self, pedido_uuid, retorno):
        """POST /pedidos/{uuid}/retorno. 400/422 sao definitivos (ErroHub); nao reenvie igual."""
        return self._exigir_sucesso(*self._sem_cab(self.requisitar("POST", f"/pedidos/{pedido_uuid}/retorno", retorno)))

    def processar_pedidos(self, erp, limite=50, max_rodadas=1000):
        """Busca ate a lista vir vazia, grava no ERP (idempotente por pedido_uuid) e devolve o retorno integrado com numero_erp."""
        resumo = {"rodadas": 0, "integrados": 0, "rejeitados": 0, "repetidos": 0, "definitivos": [], "descartados": []}
        for _ in range(max_rodadas):
            pedidos = self.buscar_pendentes(limite)
            if not pedidos:
                break
            resumo["rodadas"] += 1
            for pedido in pedidos:
                try:
                    numero_erp = erp.gravar_pedido(pedido)
                    retorno = {"versao_contrato": "v1", "pedido_uuid": pedido["pedido_uuid"], "status": "integrado",
                               "numero_erp": numero_erp, "ocorrido_em": agora()}
                except RejeicaoErp as e:
                    retorno = {"versao_contrato": "v1", "pedido_uuid": pedido["pedido_uuid"], "status": "rejeitado_erp",
                               "motivo": str(e)[:300], "ocorrido_em": agora()}
                try:
                    aceito = self.devolver_retorno(pedido["pedido_uuid"], retorno)
                except ErroHub as e:
                    if e.status == 422:  # definitivo: pedido_desconhecido, pedido_nao_entregue, transicao_invalida, numero_erp_divergente
                        resumo["definitivos"].append({"pedido_uuid": pedido["pedido_uuid"], "codigo": e.codigo, "requisicao_id": e.requisicao_id})
                        continue
                    raise
                if aceito.get("repetido"):
                    resumo["repetidos"] += 1
                elif retorno["status"] == "integrado":
                    resumo["integrados"] += 1
                else:
                    resumo["rejeitados"] += 1
                for d in aceito.get("itens_descartados") or []:
                    resumo["descartados"].append({"pedido_uuid": pedido["pedido_uuid"], **d})
        return resumo


def _corpo_json(resposta):
    try:
        return resposta.json() if resposta.content else None
    except ValueError:
        return None


# ------------------------------------------------------------------ ERP ficticio (so para a demonstracao) ------------------------------------------------------------------
class ErpFicticio:
    """Um "ERP" em memoria. Troque pelas suas consultas (SQL, API do ERP...)."""

    def __init__(self):
        def t(n):
            return f"2026-11-05T13:4{n}:10Z"

        def produto(n, nome, alterado):
            return {"external_id": f"P00000{n}", "alterado_em": alterado, "ativo": True, "sku": f"REF-000{n}", "nome": nome,
                    "unidade": "UN", "preco_venda_cents": 500 + n * 100}

        def preco(produto_id, cents, alterado):
            return {"external_id": f"TAB01:{produto_id}", "alterado_em": alterado, "ativo": True, "tabela_external_id": "TAB01",
                    "tabela_nome": "Tabela Atacado", "vigencia_inicio": "2026-11-01", "produto_external_id": produto_id,
                    "preco_cents": cents, "unidade": "UN"}

        self.dados = {
            "produto": [produto(1, "Refrigerante Cola 2 L", t(0)), produto(2, "Suco de Laranja 1 L", t(0)),
                        produto(3, "Agua Mineral 500 mL", t(1)), produto(4, "Biscoito Recheado", t(1)),
                        produto(5, "Macarrao Espaguete", t(2)), produto(6, "Arroz Tipo 1 5 kg", t(2)),
                        produto(7, "Feijao Carioca 1 kg", t(3))],
            "preco": [preco("P000099", 1250, t(0)),  # produto ainda nao enviado: o Hub devolve referencia_ausente (reprocessavel)
                      preco("P000098", -50, t(0)),   # negativo: o cliente NAO envia, registra em linhas_invalidas (corrigir na origem)
                      preco("P000001", 790, t(2)), preco("P000002", 650, t(3)), preco("P000003", 300, t(3))],
        }
        self.pedidos_gravados = {}  # pedido_uuid -> numero_erp (a "tabela do ERP" que guarda o UUID)

    def ler_pagina(self, entidade):
        import functools

        def pagina(cursor, limite):
            linhas = [r for r in self.dados[entidade] if cursor is None or comparar_cursor(r, cursor) > 0]
            linhas.sort(key=functools.cmp_to_key(comparar_cursor))
            return [dict(r) for r in linhas[:limite]]

        return pagina

    @staticmethod
    def validar_preco(r):
        if r["preco_cents"] < 0:
            return {"codigo": "valor_fora_da_faixa", "campo": "preco_cents", "mensagem": "preco_cents esta negativo no ERP."}
        return None

    def gravar_pedido(self, pedido):
        """Grava uma unica vez por pedido_uuid: repetir a chamada devolve o mesmo numero (idempotente)."""
        if pedido["pedido_uuid"] not in self.pedidos_gravados:
            self.pedidos_gravados[pedido["pedido_uuid"]] = f"PV-{4500 + len(self.pedidos_gravados) + 12:06d}"
        return self.pedidos_gravados[pedido["pedido_uuid"]]


# ------------------------------------------------------------------ demonstracao ------------------------------------------------------------------
def _mostrar(log, rotulo, r):
    c = r["resultado"]["contagens"]
    log(f"  {rotulo}: {r['resultado']['status']} (recebidas {c['recebidas']}, novas {c['novas']}, atualizadas {c['atualizadas']}, "
        f"inalteradas {c['inalteradas']}, com erro {c['com_erro']})")
    for e in r["erros"]["reprocessaveis"]:
        log(f"    reprocessavel   {e['external_id']} {e['codigo']} em {e.get('campo')}: o Hub reprocessa sozinho quando o alvo chegar")
    for e in r["erros"]["corrigir_na_origem"]:
        log(f"    corrigir no ERP {e['external_id']} {e['codigo']} em {e.get('campo') or '-'} (origem {e.get('origem')})")


def main(env=None, log=print):
    try:
        cfg = ler_config(env)
    except ValueError as e:
        print(f"Configuracao invalida: {e}", file=sys.stderr)
        return 2
    cliente = ClienteHub(cfg["url"], cfg["chave"], cfg["conector_id"], cfg["conector_versao"], cfg["intervalo_ms"], registrar=log)
    erp = ErpFicticio()
    log(f"Hub: {cfg['url']} | Conector: {cfg['conector_id']}" + (f" v{cfg['conector_versao']}" if cfg["conector_versao"] else ""))

    log("\n1) Produtos")
    cursor = cliente.consultar_cursor("produto")["cursor"]
    ultimo = None
    if cursor is None:
        log("  cursor nulo: carga completa em partes (na demonstracao, 3 por parte; na vida real, ate 5.000)")
        partes = cliente.enviar_completo("produto", erp.ler_pagina("produto"), tamanho_parte=3)
        for i, p in enumerate(partes, 1):
            _mostrar(log, f"parte {i} (ultimo={p['envelope']['sessao']['ultimo']})", p)
        ultimo = partes[-1] if partes else None
    else:
        log(f"  cursor em {cursor['alterado_em']} / {cursor['external_id']}: so o delta")
        lotes = cliente.enviar_delta("produto", erp.ler_pagina("produto"), cursor=cursor, tamanho_pagina=3)
        for i, p in enumerate(lotes, 1):
            _mostrar(log, f"pagina {i}", p)
        if not lotes:
            log("  nada novo desde o cursor: nenhum lote enviado")
        ultimo = lotes[-1] if lotes else None

    log("\n2) Precos (delta com erros por linha)")
    cursor_preco = cliente.consultar_cursor("preco")["cursor"]
    lotes_preco = cliente.enviar_delta("preco", erp.ler_pagina("preco"), cursor=cursor_preco, tamanho_pagina=10, validar=erp.validar_preco)
    for i, p in enumerate(lotes_preco, 1):
        _mostrar(log, f"pagina {i}", p)
    if not lotes_preco:
        log("  nada novo desde o cursor: nenhum lote enviado")
    ultimo = lotes_preco[-1] if lotes_preco else ultimo

    log("\n3) Reenvio do mesmo lote")
    if ultimo:
        aceito, chave, repetido = cliente.enviar_lote(ultimo["envelope"])
        mesmo = "o mesmo" if aceito["lote_id"] == ultimo["aceito"]["lote_id"] else "DIFERENTE (inesperado)"
        log(f"  mesma chave ({chave[:12]}...): lote {mesmo}, repetido={repetido}")
    else:
        log("  nenhum lote enviado nesta execucao; nada a reenviar")

    log("\n4) Recusa de envelope (lote vazio)")
    try:
        cliente.enviar_lote({"versao_contrato": "v1", "entidade": "vendedor", "modo": "delta", "registros": []})
        log("  inesperado: o Hub aceitou um lote vazio")
    except RecusaLoteErro as e:
        log(f"  RecusaLote {e.status} {e.codigo}: {e.erros[0]['mensagem']} (requisicao_id {e.requisicao_id})")

    log("\n5) Pedidos aprovados")
    resumo = cliente.processar_pedidos(erp)
    log(f"  rodadas {resumo['rodadas']}, integrados {resumo['integrados']}, rejeitados {resumo['rejeitados']}, repetidos {resumo['repetidos']}")
    for uuid_pedido, numero in erp.pedidos_gravados.items():
        log(f"  pedido {uuid_pedido} gravado no ERP como {numero}")
    for d in resumo["descartados"]:
        log(f"  item descartado no pedido {d['pedido_uuid']}: {d['codigo']} em {d['campo']}")
    for d in resumo["definitivos"]:
        log(f"  recusa definitiva (nao reenviar) do pedido {d['pedido_uuid']}: {d['codigo']}")
    if resumo["rodadas"] == 0:
        log("  nenhum pedido pendente")
    log("\nConcluido.")
    return 0


if __name__ == "__main__":
    for _fluxo in (sys.stdout, sys.stderr):
        if hasattr(_fluxo, "reconfigure"):
            _fluxo.reconfigure(encoding="utf-8")  # console do Windows
    try:
        sys.exit(main())
    except ErroHub as e:
        # So o resumo (HTTP, codigo do Hub e requisicao_id): nunca a chave nem o corpo enviado.
        print(f"Falhou: {e} (requisicao_id {e.requisicao_id or '-'})", file=sys.stderr)
        sys.exit(1)

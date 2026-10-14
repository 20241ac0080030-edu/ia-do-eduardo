/**
 * SISTEMA N.E.O.N. - ENGINE DE INTERFACE (JS) FINAL
 * Versão: 4.0 - Arquitetura Real-Time orientada a Eventos com WebSockets
 */

// 1. MAPEAMENTO DE ELEMENTOS DO DOM
const chatBox = document.getElementById("caixa-chat");
const campoTexto = document.getElementById("campoTexto");
const btnEnviar = document.getElementById("btnEnviar");
const seletorVersao = document.getElementById("seletor-versao");
const nicknameInput = document.getElementById("nickname");
const btnRanking = document.getElementById("btnRanking");
const modalRanking = document.getElementById("modalRanking");
const fecharRanking = document.getElementById("fecharRanking");
const rankingTabela = document.getElementById("rankingTabela");

// Elementos de Health Check (Sprint 5)
const badgeSaude = document.getElementById("indicadorSaude");
const textoSaude = document.getElementById("textoSaude");

// Elementos de Documentos RAG (Sprint 6)
const docUploadInput = document.getElementById("docUpload");
const containerDocAtivo = document.getElementById("containerDocAtivo");
const nomeDocAtivo = document.getElementById("nomeDocAtivo");
const btnRemoverDoc = document.getElementById("btnRemoverDoc");

// Elementos de Tempo Real / Sockets (Sprint 7)
const contadorOnline = document.getElementById("contadorOnline");
const textoOnline = document.getElementById("textoOnline");
const avisoDigitando = document.getElementById("avisoDigitando");

// Estados de Execução
let estaProcessando = false;
let documentoSelecionado = null;
let modoRAGAtivo = false;
let socket = null;
let digitandoTimeout = null;

// ====================================================================
// CONFIGURAÇÃO DE ENDPOINTS
// ====================================================================
const URL_LOCAL = "http://localhost:3000";
const URL_NUVEM = "https://t1-p1-a5-o-despertar-da-ia.onrender.com";

// --- SELECIONE A URL ATIVA ---
// Altere para URL_NUVEM quando for testar na nuvem do Render
const URL_ATIVA = URL_LOCAL; 
// ====================================================================

/**
 * SPRINT 5: Verificação de Saúde da API (Health Check)
 */
async function verificarSaudeAPI() {
    if (!badgeSaude || !textoSaude) return;

    try {
        const resposta = await fetch(`${URL_ATIVA}/api/health`, { method: "GET" });
        if (resposta.ok) {
            const dados = await resposta.json();
            badgeSaude.classList.remove("offline");
            badgeSaude.classList.add("online");
            textoSaude.textContent = "Online";
            badgeSaude.title = `Servidor: ${dados.servidor} | Banco: ${dados.bancoDeDados} | Uptime: ${dados.uptime}`;
        } else {
            throw new Error("Status HTTP não-200");
        }
    } catch (erro) {
        badgeSaude.classList.remove("online");
        badgeSaude.classList.add("offline");
        textoSaude.textContent = "Offline";
        badgeSaude.title = "Falha no Health Check: API indisponível.";
    }
}

/**
 * Obtenção ou Criação de Token JWT para Autenticação
 */
async function obterTokenJWT(nick) {
    const usuario = nick || "Visitante";
    let tokenSalvo = sessionStorage.getItem("neon_jwt_token");
    if (tokenSalvo) return tokenSalvo;

    try {
        const res = await fetch(`${URL_ATIVA}/api/auth/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nickname: usuario })
        });

        if (res.ok) {
            const dados = await res.json();
            sessionStorage.setItem("neon_jwt_token", dados.token);
            return dados.token;
        }
    } catch (e) {
        console.warn("⚠️ Aviso: Falha ao solicitar token JWT:", e.message);
    }
    return null;
}

/**
 * SPRINT 7: Inicialização do WebSocket com Catraca JWT no Handshake
 */
async function inicializarWebSocket() {
    const nick = (nicknameInput && nicknameInput.value.trim()) ? nicknameInput.value.trim() : "Visitante";
    const token = await obterTokenJWT(nick);

    if (!token) {
        console.error("❌ Não foi possível obter o Token JWT para conectar no WebSocket.");
        return;
    }

    // Se já havia uma conexão antiga, desconecta antes de abrir uma nova
    if (socket && socket.connected) {
        socket.disconnect();
    }

    // Abre a conexão WebSocket passando o Token no objeto auth (Fase 5: Segurança)
    socket = io(URL_ATIVA, {
        auth: { token: token }
    });

    // Conexão estabelecida com sucesso
    socket.on("connect", () => {
        console.log("⚡ [WebSocket] Conectado à sala pública com ID:", socket.id);
    });

    // DESAFIO HACKER 1: Atualização em Tempo Real de Usuários Conectados
    socket.on("usuariosOnline", (total) => {
        if (textoOnline) {
            textoOnline.textContent = `${total} online`;
        }
    });

    // FASE 3 E 4: Escuta de Novas Mensagens na Sala (Broadcast)
    socket.on("mensagemRecebida", (dados) => {
        // Remove aviso de digitação ao receber a mensagem
        if (avisoDigitando) avisoDigitando.style.display = "none";

        // Identifica se a mensagem foi enviada pelo próprio usuário local ou por outros
        const nickAtual = (nicknameInput && nicknameInput.value.trim()) ? nicknameInput.value.trim() : "Visitante";
        const ehMeu = (dados.autor === nickAtual || dados.autor === "Você");

        adicionarMensagemRealTime(dados, ehMeu);
    });

    // DESAFIO HACKER 2: Indicador de Digitação ("Fulano está digitando...")
    socket.on("usuarioDigitando", (dados) => {
        if (!avisoDigitando) return;
        if (dados.digitando) {
            avisoDigitando.textContent = `${dados.usuario} está digitando...`;
            avisoDigitando.style.display = "block";
        } else {
            avisoDigitando.style.display = "none";
            avisoDigitando.textContent = "";
        }
    });

    // Tratamento de Erro na Conexão (ex: Token Rejeitado / 401)
    socket.on("connect_error", (err) => {
        console.error("❌ [WebSocket] Erro de autenticação/conexão:", err.message);
    });
}

/**
 * Renderização de Mensagens em Tempo Real na Tela
 */
function adicionarMensagemRealTime(dados, ehMeu) {
    const div = document.createElement("div");
    
    // Define a classe visual com base no tipo da mensagem
    if (dados.tipo === "ia") {
        div.classList.add("mensagem", "msg-ia");
    } else {
        div.classList.add("mensagem", ehMeu ? "msg-usuario" : "msg-outro-usuario");
    }

    // Tratamento de negrito e quebras de linha
    const textoFormatado = dados.texto
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

    // Cabeçalho da mensagem mostrando autor e horário
    const headerHtml = `
        <div class="msg-header">
            ${dados.tipo === "ia" 
                ? `<span class="ai-avatar"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"></path></svg></span><span class="ai-label">${dados.autor}</span>` 
                : `<span class="author-label">${ehMeu ? "Você" : dados.autor}</span>`
            }
            <span class="msg-time">${dados.timestamp || ""}</span>
        </div>
        <div class="msg-body">${textoFormatado}</div>
    `;

    div.innerHTML = headerHtml;
    chatBox.appendChild(div);

    // Dispara confetes se a IA parabenizar o acerto de charadas
    if (dados.tipo === "ia") {
        const textoMin = dados.texto.toLowerCase();
        if (textoMin.includes("parabéns") || textoMin.includes("acertou") || textoMin.includes("correto") || textoMin.includes("parabens")) {
            executarConfete();
        }
    }

    // Rolagem automática e suave
    chatBox.scrollTo({
        top: chatBox.scrollHeight,
        behavior: 'smooth'
    });
}

function executarConfete() {
    if (typeof confetti === "function") {
        confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 }
        });
    }
}

/**
 * Eventos de Seleção e Descarte de Documentos RAG (Sprint 6)
 */
docUploadInput.addEventListener("change", (e) => {
    const arquivo = e.target.files[0];
    if (arquivo) {
        documentoSelecionado = arquivo;
        modoRAGAtivo = true;
        nomeDocAtivo.textContent = `${arquivo.name} (${(arquivo.size / 1024).toFixed(1)} KB)`;
        containerDocAtivo.style.display = "flex";
        campoTexto.placeholder = `Pergunte sobre o documento '${arquivo.name}'...`;
        campoTexto.focus();
    }
});

btnRemoverDoc.addEventListener("click", () => {
    documentoSelecionado = null;
    modoRAGAtivo = false;
    docUploadInput.value = "";
    containerDocAtivo.style.display = "none";
    campoTexto.placeholder = "Mande uma mensagem na sala ou chame @gemini...";
});

/**
 * Envio de Mensagens: Alterna entre RAG (HTTP) e Sala Pública (WebSockets)
 */
async function processarEnvioIA() {
    const mensagem = campoTexto.value.trim();
    const versaoModelo = seletorVersao ? seletorVersao.value : "gemini-2.5-flash";
    const nick = (nicknameInput && nicknameInput.value.trim()) ? nicknameInput.value.trim() : "Visitante";

    if (mensagem === "" || estaProcessando) return;

    // Cancela o aviso de digitação imediatamente ao enviar
    if (socket && socket.connected) {
        socket.emit("digitando", false);
    }

    try {
        estaProcessando = true;
        campoTexto.value = "";

        // 1. SE HOUVER DOCUMENTO ANEXADO: Envia via HTTP RAG protegido com JWT (Sprint 6)
        if (modoRAGAtivo || documentoSelecionado) {
            const token = await obterTokenJWT(nick);
            const formData = new FormData();
            formData.append("pergunta", mensagem);
            formData.append("nickname", nick);
            formData.append("modelo", versaoModelo);
            
            if (documentoSelecionado) {
                formData.append("documento", documentoSelecionado);
            }

            // Exibe a mensagem do usuário localmente
            adicionarMensagemRealTime({
                autor: nick,
                texto: mensagem,
                tipo: 'usuario',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }, true);

            const respostaServidor = await fetch(`${URL_ATIVA}/api/chat/documento`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` },
                body: formData
            });

            if (!respostaServidor.ok) {
                const dadosErro = await respostaServidor.json().catch(() => ({}));
                throw new Error(dadosErro.erro || "Falha no processamento RAG.");
            }

            const dados = await respostaServidor.json();
            
            // Exibe a resposta do RAG
            adicionarMensagemRealTime({
                autor: '🤖 Analista Corporativo RAG',
                texto: dados.resposta,
                tipo: 'ia',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }, false);

        } else {
            // 2. CHAT DA SALA PÚBLICA: Emite evento WebSocket em tempo real (Sprint 7)
            if (socket && socket.connected) {
                socket.emit("novaMensagem", { texto: mensagem });
            } else {
                throw new Error("Conexão WebSocket com a sala não está ativa.");
            }
        }

    } catch (erro) {
        console.error("Falha ao enviar mensagem:", erro);
        alert(erro.message);
    } finally {
        estaProcessando = false;
        campoTexto.focus();
    }
}

/**
 * Consulta e Exibição do Ranking Global (Leaderboard)
 */
async function carregarRankingGlobal() {
    rankingTabela.innerHTML = `<span style="color: #6366f1">Carregando classificação...</span>`;
    modalRanking.style.display = "flex";

    try {
        const resposta = await fetch(`${URL_ATIVA}/api/ranking`);
        if (!resposta.ok) throw new Error("Erro de rede ao buscar Leaderboard.");

        const jogadores = await resposta.json();
        
        if (jogadores.length === 0) {
            rankingTabela.innerHTML = `<p style="text-align: center; color: #71717a; padding: 20px 0;">Nenhum operador registrado no ranking ainda.</p>`;
            return;
        }

        let htmlTabela = `<table>
            <thead>
                <tr>
                    <th style="width: 20%;">Rank</th>
                    <th style="text-align: left;">Operador</th>
                    <th style="text-align: right;">Pontos</th>
                </tr>
            </thead>
            <tbody>`;

        jogadores.forEach((jogador, index) => {
            let rankMedalha = index + 1;
            if (index === 0) rankMedalha = "🥇";
            else if (index === 1) rankMedalha = "🥈";
            else if (index === 2) rankMedalha = "🥉";

            htmlTabela += `
                <tr>
                    <td style="font-weight: 600;">${rankMedalha}</td>
                    <td style="color: #f4f4f5;">${jogador.nome}</td>
                    <td style="text-align: right; color: #6366f1; font-weight: 600;">${jogador.xp} XP</td>
                </tr>`;
        });

        htmlTabela += `</tbody></table>`;
        rankingTabela.innerHTML = htmlTabela;

    } catch (e) {
        rankingTabela.innerHTML = `<span style="color: #ef4444">Falha ao carregar ranking: ${e.message}</span>`;
    }
}

// ====================================================================
// GATILHOS DE EVENTOS NO DOM
// ====================================================================
btnEnviar.addEventListener("click", processarEnvioIA);
campoTexto.addEventListener("keypress", (e) => {
    if (e.key === "Enter") processarEnvioIA();
});

// DESAFIO HACKER 2: Emissão do evento 'digitando' com debounce
campoTexto.addEventListener("input", () => {
    if (!socket || !socket.connected) return;

    socket.emit("digitando", true);
    clearTimeout(digitandoTimeout);
    
    // Se o usuário parar de digitar por 1,5 segundos, desativa o aviso
    digitandoTimeout = setTimeout(() => {
        socket.emit("digitando", false);
    }, 1500);
});

// Atualiza a identificação no WebSocket quando o usuário alterar o Nickname
if (nicknameInput) {
    nicknameInput.addEventListener("change", () => {
        sessionStorage.removeItem("neon_jwt_token"); // Força a geração de novo token para o novo nick
        inicializarWebSocket();
    });
}

btnRanking.addEventListener("click", carregarRankingGlobal);
fecharRanking.addEventListener("click", () => modalRanking.style.display = "none");
window.addEventListener("click", (e) => {
    if (e.target === modalRanking) modalRanking.style.display = "none";
});

// ====================================================================
// INICIALIZAÇÃO AO CARREGAR A PÁGINA
// ====================================================================
window.addEventListener("DOMContentLoaded", () => {
    verificarSaudeAPI();
    setInterval(verificarSaudeAPI, 30000);
    inicializarWebSocket(); // Inicia a conexão em tempo real na sala pública
});

// ====================================================================
// ROTINA DE LIMPEZA E RESET
// ====================================================================
const btnLimparMemoria = document.getElementById("btnLimpar");
btnLimparMemoria.addEventListener("click", async () => {
    const confirmacao = confirm("Deseja apagar os dados do MongoDB e o histórico da sessão?");
    
    if (confirmacao) {
        try {
            btnLimparMemoria.disabled = true;

            const rotaLimpeza = await fetch(`${URL_ATIVA}/api/chat/limpar`, {
                method: 'DELETE'
            });

            if (rotaLimpeza.ok) {
                documentoSelecionado = null;
                modoRAGAtivo = false;
                docUploadInput.value = "";
                containerDocAtivo.style.display = "none";
                sessionStorage.removeItem("neon_jwt_token");

                // Limpa a tela localmente
                chatBox.innerHTML = `
                    <div class="mensagem msg-ia">
                        <div class="msg-header">
                            <span class="ai-avatar"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"></path></svg></span>
                            <span class="ai-label">🤖 Moderador N.E.O.N.</span>
                        </div>
                        <div class="msg-body" style="color: #10b981;">Histórico e dados da sala resetados com sucesso.</div>
                    </div>`;
            } else {
                const erroResposta = await rotaLimpeza.json().catch(() => ({}));
                throw new Error(erroResposta.erro || "Erro HTTP na rota de limpeza.");
            }
        } catch (erroDelete) {
            alert("Falha na limpeza: " + erroDelete.message);
        } finally {
            btnLimparMemoria.disabled = false;
            campoTexto.focus();
        }
    }
});
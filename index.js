/**
 * SISTEMA N.E.O.N. - ENGINE DE INTERFACE (JS) FINAL
 * Versão: 3.7 - Acesso Direto sem Obrigatoriedade de Nome
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

// Elementos de Health Check
const badgeSaude = document.getElementById("indicadorSaude");
const textoSaude = document.getElementById("textoSaude");

// Elementos de Upload e Controle de Documentos RAG
const docUploadInput = document.getElementById("docUpload");
const containerDocAtivo = document.getElementById("containerDocAtivo");
const nomeDocAtivo = document.getElementById("nomeDocAtivo");
const btnRemoverDoc = document.getElementById("btnRemoverDoc");

let estaProcessando = false;
let documentoSelecionado = null;
let modoRAGAtivo = false;

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
 * Verificação de Saúde da API (Health Check)
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
        badgeSaude.title = "Falha no Health Check: API indisponível ou hibernando no Render.";
    }
}

/**
 * Obtenção de Token JWT para a Rota Corporativa
 */
async function obterTokenJWT(nick) {
    let tokenSalvo = sessionStorage.getItem("neon_jwt_token");
    if (tokenSalvo) return tokenSalvo;

    try {
        const res = await fetch(`${URL_ATIVA}/api/auth/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nickname: nick || "Visitante" })
        });

        if (res.ok) {
            const dados = await res.json();
            sessionStorage.setItem("neon_jwt_token", dados.token);
            return dados.token;
        }
    } catch (e) {
        console.warn("⚠️ Aviso: Falha ao solicitar token JWT automático:", e.message);
    }
    return null;
}

/**
 * Renderização de Mensagens
 */
function adicionarMensagem(remetente, texto) {
    const div = document.createElement("div");
    div.classList.add("mensagem", remetente === "usuario" ? "msg-usuario" : "msg-ia");
    
    const textoFormatado = texto
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

    div.innerHTML = textoFormatado;
    chatBox.appendChild(div);

    if (remetente === "ia") {
        const textoMin = texto.toLowerCase();
        if (textoMin.includes("parabéns") || textoMin.includes("acertou") || textoMin.includes("correto") || textoMin.includes("parabens")) {
            executarConfete();
        }
    }

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

function mostrarLoading() {
    const loadingDiv = document.createElement("div");
    loadingDiv.classList.add("mensagem", "msg-ia");
    loadingDiv.id = "loading-neon";
    loadingDiv.innerHTML = `<span class="pulso">.</span><span class="pulso" style="animation-delay: 0.2s">.</span><span class="pulso" style="animation-delay: 0.4s">.</span>`;
    chatBox.appendChild(loadingDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function removerLoading() {
    const loading = document.getElementById("loading-neon");
    if (loading) loading.remove();
}

/**
 * Eventos de Seleção e Descarte de Documentos (RAG)
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
    campoTexto.placeholder = "Digite uma mensagem ou pergunte sobre o documento...";
});

/**
 * Envio de Mensagem para o Agente de IA (SEM OBRIGATORIEDADE DE NICK)
 */
async function processarEnvioIA() {
    const mensagem = campoTexto.value.trim();
    const versaoModelo = seletorVersao ? seletorVersao.value : "gemini-2.5-flash";
    
    // Se o usuário digitou um nome, usa ele. Se deixou em branco, adota "Visitante"
    const nick = (nicknameInput && nicknameInput.value.trim()) ? nicknameInput.value.trim() : "Visitante";

    // Valida apenas se o usuário digitou uma mensagem ou se o sistema está ocupado
    if (mensagem === "" || estaProcessando) return;

    try {
        estaProcessando = true;
        btnEnviar.disabled = true;
        btnEnviar.style.opacity = "0.5";

        adicionarMensagem("usuario", mensagem);
        campoTexto.value = ""; 
        mostrarLoading();

        let respostaServidor;

        // Se houver um documento ativo, envia para a rota RAG via FormData
        if (modoRAGAtivo || documentoSelecionado) {
            const token = await obterTokenJWT(nick);
            const formData = new FormData();
            formData.append("pergunta", mensagem);
            formData.append("nickname", nick);
            formData.append("modelo", versaoModelo);
            
            if (documentoSelecionado) {
                formData.append("documento", documentoSelecionado);
            }

            respostaServidor = await fetch(`${URL_ATIVA}/api/chat/documento`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`
                },
                body: formData
            });

        } else {
            // Chat normal (sem documento)
            respostaServidor = await fetch(`${URL_ATIVA}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    pergunta: mensagem, 
                    modelo: versaoModelo,
                    nickname: nick
                })
            });
        }

        if (!respostaServidor.ok) {
            const dadosErro = await respostaServidor.json().catch(() => ({}));
            throw new Error(dadosErro.erro || "Falha na comunicação neural.");
        }

        const dados = await respostaServidor.json();

        removerLoading();
        adicionarMensagem("ia", dados.resposta);

        if (dados.documentoAtivo && !documentoSelecionado) {
            modoRAGAtivo = true;
            nomeDocAtivo.textContent = `${dados.documentoAtivo} (Memória RAG)`;
            containerDocAtivo.style.display = "flex";
        }

        verificarSaudeAPI();

    } catch (erro) {
        removerLoading();
        console.error("Falha Crítica:", erro);
        let msgErro = erro.message || "⚠️ FALHA NO NÚCLEO: Link neural interrompido. Verifique o servidor Node.js.";
        adicionarMensagem("ia", `<span style="color: #ef4444">${msgErro}</span>`);
        verificarSaudeAPI();
    } finally {
        estaProcessando = false;
        btnEnviar.disabled = false;
        btnEnviar.style.opacity = "1";
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
// ESCUTADORES DE EVENTOS
// ====================================================================
btnEnviar.addEventListener("click", processarEnvioIA);
campoTexto.addEventListener("keypress", (e) => {
    if (e.key === "Enter") processarEnvioIA();
});

btnRanking.addEventListener("click", carregarRankingGlobal);
fecharRanking.addEventListener("click", () => modalRanking.style.display = "none");
window.addEventListener("click", (e) => {
    if (e.target === modalRanking) modalRanking.style.display = "none";
});

// Executa o Health Check automático
window.addEventListener("DOMContentLoaded", () => {
    verificarSaudeAPI();
    setInterval(verificarSaudeAPI, 30000);
});

// ====================================================================
// ROTINA DE LIMPEZA E RESET
// ====================================================================
const btnLimparMemoria = document.getElementById("btnLimpar");
btnLimparMemoria.addEventListener("click", async () => {
    const confirmacao = confirm("Deseja apagar os dados do MongoDB e o histórico da sessão?");
    
    if (confirmacao) {
        try {
            adicionarMensagem("ia", `<span style="color: #f59e0b">Limpando registros da base de dados...</span>`);
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

                chatBox.innerHTML += `<div class="mensagem msg-ia" style="color: #10b981;">Base de dados e memórias restauradas com sucesso.</div>`;
                chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
            } else {
                const erroResposta = await rotaLimpeza.json().catch(() => ({}));
                throw new Error(erroResposta.erro || "Erro HTTP na rota de limpeza.");
            }
        } catch (erroDelete) {
            adicionarMensagem("ia", `<span style="color: #ef4444">Falha na limpeza: ${erroDelete.message}</span>`);
        } finally {
            btnLimparMemoria.disabled = false;
            campoTexto.focus();
        }
    }
});
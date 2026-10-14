require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const mongoose = require('mongoose');
const multer = require('multer');
const pdfModule = require('pdf-parse');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(cors());

// Criação do Servidor HTTP nativo acoplado ao Express e ao Socket.io
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Configuração do Multer para processamento estritamente na memória RAM
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // Até 10 MB
});

// Chave secreta para assinatura dos tokens JWT
const JWT_SECRET = process.env.JWT_SECRET || 'neon_secret_jwt_corporativo_2026';

// Memórias de contingência caso o MongoDB esteja temporariamente offline
let memoriaContingencia = [];
let documentosContingencia = {};

// ====================================================================
// FUNÇÃO UNIVERSAL DE EXTRAÇÃO DE PDF (COMPATÍVEL COM V1 E V2)
// ====================================================================
async function extrairTextoPDF(buffer) {
    try {
        if (typeof pdfModule === 'function') {
            const dados = await pdfModule(buffer);
            return dados.text;
        }
        if (pdfModule && typeof pdfModule.default === 'function') {
            const dados = await pdfModule.default(buffer);
            return dados.text;
        }
        if (pdfModule && pdfModule.PDFParse) {
            const parser = new pdfModule.PDFParse({ data: buffer });
            const resultado = await parser.getText();
            return resultado.text;
        }
        if (typeof pdfModule === 'object') {
            const Construtor = pdfModule.PDFParse || pdfModule;
            const parser = new Construtor({ data: buffer });
            if (typeof parser.getText === 'function') {
                const resultado = await parser.getText();
                return resultado.text;
            }
        }
    } catch (err) {
        console.error("❌ Erro interno ao extrair texto do PDF:", err.message);
        throw new Error(`Falha na extração do PDF: ${err.message}`);
    }
    throw new Error("Incompatibilidade na versão da biblioteca pdf-parse instalada.");
}

// ====================================================================
// 1. CONEXÃO COM O BANCO DE DADOS MONGODB
// ====================================================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('📦 BANCO DE DADOS ATIVO!'))
  .catch((err) => console.error('❌ ERRO MONGO (Modo de Contingência Ativo):', err.message));

// Modelo de Memória do Chat
const MensagemSchema = new mongoose.Schema({
    role: String,
    parts: [{ text: String }],
    dataHora: { type: Date, default: Date.now }
});
const MensagemDbModel = mongoose.model('MemoriaSessao', MensagemSchema);

// Schema de Jogador com XP (Gamificação)
const JogadorSchema = new mongoose.Schema({
    nome: { type: String, unique: true, required: true },
    xp: { type: Number, default: 0 }
});
const JogadorModel = mongoose.model('Jogador', JogadorSchema);

// Schema para RAG Persistente
const DocumentoSessaoSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true },
    nomeArquivo: { type: String, required: true },
    conteudoTexto: { type: String, required: true },
    dataUpload: { type: Date, default: Date.now }
});
const DocumentoSessaoModel = mongoose.model('DocumentoSessao', DocumentoSessaoSchema);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper para salvar mensagens no histórico (MongoDB com fallback em RAM)
async function salvarMensagemHistorico(role, texto) {
    if (mongoose.connection.readyState === 1) {
        try {
            await MensagemDbModel.create({ role, parts: [{ text }] });
        } catch (e) {
            memoriaContingencia.push({ role, parts: [{ text }] });
        }
    } else {
        memoriaContingencia.push({ role, parts: [{ text }] });
    }
}

// ====================================================================
// 2. MIDDLEWARE DE SEGURANÇA HTTP (CATRACA JWT PARA ROTAS REST)
// ====================================================================
function verificarTokenJWT(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            sucesso: false, 
            erro: "401 Unauthorized: Acesso negado. Token JWT ausente." 
        });
    }

    const token = authHeader.split(' ')[1];
    try {
        const dadosDecodificados = jwt.verify(token, JWT_SECRET);
        req.usuarioAuth = dadosDecodificados;
        next();
    } catch (err) {
        return res.status(401).json({ 
            sucesso: false, 
            erro: "401 Unauthorized: Token JWT inválido ou expirado." 
        });
    }
}

// ====================================================================
// 3. SEGURANÇA NO WEBSOCKET (FASE 5: CRITÉRIO OBRIGATÓRIO DO SOCKET)
// ====================================================================
io.use((socket, next) => {
    // Captura o token enviado no objeto auth do handshake do WebSocket
    const token = socket.handshake.auth?.token;

    if (!token) {
        return next(new Error("401 Unauthorized: Token JWT ausente no handshake do WebSocket"));
    }

    try {
        const decodificado = jwt.verify(token, JWT_SECRET);
        // Anexa os dados do usuário autenticado no próprio socket
        socket.usuario = decodificado;
        next();
    } catch (err) {
        return next(new Error("401 Unauthorized: Token JWT inválido ou expirado no WebSocket"));
    }
});

// ====================================================================
// 4. FERRAMENTAS DO AGENTE (FUNCTION CALLING)
// ====================================================================
async function adicionarXP(nickname, quantidade) {
    try {
        const nomeFormatado = nickname.trim();
        if (!nomeFormatado) return { erro: "Nickname inválido para receber pontuação." };

        const jogador = await JogadorModel.findOneAndUpdate(
            { nome: nomeFormatado },
            { $inc: { xp: quantidade } },
            { new: true, upsert: true }
        );

        return {
            nickname: jogador.nome,
            xpAtual: jogador.xp,
            quantidadeAlterada: quantidade,
            mensagem: `XP de ${jogador.nome} atualizado. XP Atual: ${jogador.xp}`
        };
    } catch (error) {
        return { erro: `Falha ao processar XP: ${error.message}` };
    }
}

async function buscarClimaTempoReal(cidade) {
    try {
        const apiKey = process.env.WEATHER_API_KEY;
        if (!apiKey) return { erro: "Chave de API do clima não configurada no servidor." };
        
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(cidade)}&units=metric&lang=pt_br&appid=${apiKey}`;
        const response = await fetch(url);
        if (!response.ok) return { erro: `Cidade '${cidade}' não localizada.` };
        
        const data = await response.json();
        return {
            cidade: data.name,
            temperatura: `${Math.round(data.main.temp)}°C`,
            sensacaoTermica: `${Math.round(data.main.feels_like)}°C`,
            clima: data.weather[0].description,
            umidade: `${data.main.humidity}%`
        };
    } catch (error) {
        return { erro: `Erro de clima: ${error.message}` };
    }
}

async function converterMoedas(valor, de, para) {
    try {
        const from = de.toUpperCase();
        const to = para.toUpperCase();
        if (from === to) return { valorOriginal: valor, moedaOrigem: from, moedaDestino: to, valorConvertido: valor };
        
        const url = `https://api.frankfurter.app/latest?amount=${valor}&from=${from}&to=${to}`;
        const response = await fetch(url);
        if (!response.ok) return { erro: `Falha ao converter moedas de ${from} para ${to}.` };
        
        const data = await response.json();
        const resultado = data.rates[to];
        return {
            valorOriginal: valor,
            moedaOrigem: from,
            moedaDestino: to,
            valorConvertido: resultado.toFixed(2),
            dataCotacao: data.date
        };
    } catch (error) {
        return { erro: `Erro na conversão: ${error.message}` };
    }
}

const declaracaoXP = {
    name: "adicionarXP",
    description: "Adiciona ou remove pontos de Experiência (XP) de um usuário baseado no seu nickname.",
    parameters: {
        type: "OBJECT",
        properties: {
            nickname: { type: "STRING", description: "O apelido do jogador." },
            quantidade: { type: "INTEGER", description: "Pontos para somar ou subtrair." }
        },
        required: ["nickname", "quantidade"]
    }
};

const declaracaoClima = {
    name: "buscarClimaTempoReal",
    description: "Obtém a temperatura exata e o clima atual de uma cidade.",
    parameters: {
        type: "OBJECT",
        properties: { cidade: { type: "STRING", description: "Nome da cidade." } },
        required: ["cidade"]
    }
};

const declaracaoMoeda = {
    name: "converterMoedas",
    description: "Converte valores financeiros entre moedas internacionais.",
    parameters: {
        type: "OBJECT",
        properties: {
            valor: { type: "NUMBER", description: "Valor a ser convertido." },
            de: { type: "STRING", description: "Moeda de origem com 3 letras." },
            para: { type: "STRING", description: "Moeda de destino com 3 letras." }
        },
        required: ["valor", "de", "para"]
    }
};

// ====================================================================
// 5. ROTAS REST / HTTP
// ====================================================================

// Health Check
app.get('/api/health', (req, res) => {
    const estadoMongo = mongoose.connection.readyState;
    const statusBanco = estadoMongo === 1 ? "conectado" : "desconectado/contingencia";

    return res.status(200).json({
        status: "ok",
        servidor: "operacional",
        bancoDeDados: statusBanco,
        timestamp: new Date().toISOString(),
        uptime: `${Math.floor(process.uptime())} segundos`
    });
});

// Emissão de Token JWT
app.post('/api/auth/token', (req, res) => {
    const { nickname } = req.body;
    const usuario = nickname ? nickname.trim() : "Visitante";
    
    const token = jwt.sign({ nickname: usuario, cargo: "Operador_RealTime" }, JWT_SECRET, { expiresIn: '24h' });
    return res.status(200).json({ sucesso: true, token });
});

// RAG com Documentos (Protegida com JWT)
app.post('/api/chat/documento', verificarTokenJWT, upload.single('documento'), async (req, res) => {
    try {
        const { pergunta, nickname, modelo } = req.body;
        if (!pergunta) return res.status(400).json({ erro: "Envie uma pergunta sobre o documento." });

        const nomeOperador = nickname ? nickname.trim() : (req.usuarioAuth?.nickname || "Visitante");
        const modeloAtivo = modelo || "gemini-2.5-flash";

        let textoDocumento = "";
        let nomeDoArquivo = "";

        if (req.file) {
            nomeDoArquivo = req.file.originalname;

            if (req.file.mimetype === 'application/pdf' || nomeDoArquivo.endsWith('.pdf')) {
                textoDocumento = await extrairTextoPDF(req.file.buffer);
            } else {
                textoDocumento = req.file.buffer.toString('utf-8');
            }

            if (!textoDocumento || textoDocumento.trim() === "") {
                return res.status(400).json({ erro: "Não foi possível extrair texto do documento enviado." });
            }

            if (textoDocumento.length > 150000) {
                textoDocumento = textoDocumento.slice(0, 150000) + "\n\n[...Texto truncado para respeitar limites da cota gratuita...]";
            }

            if (mongoose.connection.readyState === 1) {
                await DocumentoSessaoModel.findOneAndUpdate(
                    { nickname: nomeOperador },
                    { nomeArquivo: nomeDoArquivo, conteudoTexto: textoDocumento, dataUpload: new Date() },
                    { upsert: true, new: true }
                );
            } else {
                documentosContingencia[nomeOperador] = { nomeArquivo: nomeDoArquivo, conteudoTexto: textoDocumento };
            }
        } else {
            let docExistente = null;
            if (mongoose.connection.readyState === 1) {
                docExistente = await DocumentoSessaoModel.findOne({ nickname: nomeOperador }).lean();
            } else {
                docExistente = documentosContingencia[nomeOperador];
            }

            if (!docExistente) {
                return res.status(400).json({ erro: "Nenhum documento encontrado na sessão." });
            }

            textoDocumento = docExistente.conteudoTexto;
            nomeDoArquivo = docExistente.nomeArquivo;
        }

        const promptRAG = `
Você é um analista corporativo extremamente preciso.
Responda à pergunta do usuário baseando-se APENAS no documento abaixo.
Se a resposta não estiver nele, responda estritamente: "Desculpe, não encontrei essa informação no documento." NÃO INVENTE DADOS.

DOCUMENTO (${nomeDoArquivo}):
"""
${textoDocumento}
"""

PERGUNTA: ${pergunta}
`;

        const modelIA = genAI.getGenerativeModel({ model: modeloAtivo });
        const result = await modelIA.generateContent(promptRAG);
        const respostaTexto = result.response.text();

        return res.status(200).json({ 
            sucesso: true, 
            resposta: respostaTexto,
            documentoAtivo: nomeDoArquivo,
            modo: "RAG Corporativo"
        });

    } catch (erro) {
        let mensagemErro = erro.message;
        if (erro.message.includes("429") || erro.message.includes("Quota exceeded")) {
            mensagemErro = "Limite de cota temporariamente excedido. Aguarde 1 minuto.";
        }
        return res.status(500).json({ sucesso: false, erro: mensagemErro });
    }
});

// Ranking Global
app.get('/api/ranking', async (req, res) => {
    try {
        const ranking = await JogadorModel.find().sort({ xp: -1 }).limit(10).lean();
        const rankingGamificado = ranking.map(jogador => {
            let titulo = "Novato";
            if (jogador.xp >= 500) titulo = "Lenda";
            else if (jogador.xp >= 300) titulo = "Mestre";
            else if (jogador.xp >= 100) titulo = "Guerreiro";
            return { nome: `${titulo}: ${jogador.nome}`, xp: jogador.xp };
        });
        res.status(200).json(rankingGamificado);
    } catch (e) {
        res.status(500).json({ erro: `Falha ao processar ranking: ${e.message}` });
    }
});

// Rota de Chat REST de Contingência (Mantida ativa)
app.post('/api/chat', async (req, res) => {
    try {
        const { pergunta, nickname, modelo } = req.body;
        if (!pergunta) return res.status(400).json({ erro: "Envie uma pergunta." });

        const nomeDoJogador = nickname ? nickname.trim() : "Visitante";
        const modeloAtivo = modelo || "gemini-2.5-flash"; 

        const modelIA = genAI.getGenerativeModel({ 
            model: modeloAtivo, 
            systemInstruction: `Você é o Guardião do SISTEMA N.E.O.N. 3.5. Trate o usuário por ${nomeDoJogador}. Seja conciso.`,
            tools: [{ functionDeclarations: [declaracaoClima, declaracaoMoeda, declaracaoXP] }]
        }, { apiVersion: "v1beta" }); 

        const chatSession = modelIA.startChat({ history: [] });
        const result = await chatSession.sendMessage(pergunta);
        const respostaTexto = result.response.text();

        salvarMensagemHistorico("user", pergunta);
        salvarMensagemHistorico("model", respostaTexto);

        return res.status(200).json({ sucesso: true, resposta: respostaTexto });
    } catch (erro) {
        return res.status(500).json({ sucesso: false, erro: `Falha no Servidor: ${erro.message}` });
    }
});

// Limpeza de Banco
app.delete('/api/chat/limpar', async (req, res) => {
    try {
        memoriaContingencia = [];
        documentosContingencia = {};
        if (mongoose.connection.readyState === 1) {
            await MensagemDbModel.deleteMany({});
            await JogadorModel.deleteMany({});
            await DocumentoSessaoModel.deleteMany({});
        }
        res.json({ sucesso: true });
    } catch (e) { 
        res.status(500).json({ erro: "Erro ao redefinir base: " + e.message }); 
    }
});

// ====================================================================
// 6. SPRINT 7: LÓGICA DE WEBSOCKETS (SALA PÚBLICA EM TEMPO REAL)
// ====================================================================

io.on('connection', (socket) => {
    const nomeUsuario = socket.usuario?.nickname || "Operador";
    console.log(`⚡ [WebSocket] Conexão ativa: ${nomeUsuario} (${socket.id})`);

    // DESAFIO HACKER 1: Notifica a todos o número atual de clientes conectados
    io.emit('usuariosOnline', io.engine.clientsCount);

    // ESCUTA DE MENSAGENS EM TEMPO REAL
    socket.on('novaMensagem', async (dados) => {
        const texto = dados.texto ? dados.texto.trim() : "";
        if (!texto) return;

        // Pacote da mensagem do usuário
        const pacoteMensagem = {
            id: Date.now() + Math.random().toString(36).substring(2, 6),
            autor: nomeUsuario,
            texto: texto,
            tipo: 'usuario',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        // 1. BROADCAST IMEDIATO: Envia para todas as abas conectadas na sala
        io.emit('mensagemRecebida', pacoteMensagem);
        salvarMensagemHistorico("user", `${nomeUsuario}: ${texto}`);

        // 2. GATILHO DA IA (INVOCATION TRIGGER): Verifica se chamaram @gemini, @neon ou @bot
        const textoMin = texto.toLowerCase();
        if (textoMin.includes('@gemini') || textoMin.includes('@neon') || textoMin.includes('@bot')) {
            // Emite aviso na sala de que o moderador está digitando
            io.emit('usuarioDigitando', { usuario: '🤖 Moderador N.E.O.N.', digitando: true });

            try {
                // Remove a menção para deixar a pergunta limpa
                const perguntaLimpa = texto.replace(/@gemini|@neon|@bot/gi, '').trim() || "Olá a todos! Como posso ajudar a sala?";

                const modelIA = genAI.getGenerativeModel({ 
                    model: "gemini-2.5-flash",
                    systemInstruction: `Você é o Moderador N.E.O.N. em uma sala pública de chat em tempo real. 
                    Você foi invocado pelo usuário "${nomeUsuario}". 
                    Responda diretamente para ele e para a sala inteira de forma curta, prestativa e inteligente.`
                });

                const result = await modelIA.generateContent(perguntaLimpa);
                const respostaTexto = result.response.text();

                // 3. BROADCAST DA RESPOSTA DA IA PARA TODA A SALA
                io.emit('mensagemRecebida', {
                    id: Date.now() + Math.random().toString(36).substring(2, 6),
                    autor: '🤖 Moderador N.E.O.N.',
                    texto: respostaTexto,
                    tipo: 'ia',
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                });

                salvarMensagemHistorico("model", respostaTexto);

            } catch (err) {
                console.error("❌ Erro ao invocar Moderador IA:", err.message);
            } finally {
                io.emit('usuarioDigitando', { usuario: '🤖 Moderador N.E.O.N.', digitando: false });
            }
        }
    });

    // DESAFIO HACKER 2: Indicador de Digitação (Typing Indicator)
    socket.on('digitando', (isDigitando) => {
        // Envia apenas para os OUTROS usuários (broadcast)
        socket.broadcast.emit('usuarioDigitando', {
            usuario: nomeUsuario,
            digitando: Boolean(isDigitando)
        });
    });

    // Desconexão
    socket.on('disconnect', () => {
        console.log(`🔌 [WebSocket] Desconectado: ${nomeUsuario}`);
        io.emit('usuariosOnline', io.engine.clientsCount);
    });
});

// ====================================================================
// INICIALIZAÇÃO DO SERVIDOR HÍBRIDO (HTTP + WEBSOCKET)
// ====================================================================
const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => {
    console.log(`🚀 SERVIDOR REAL-TIME OPERACIONAL NA PORTA ${PORTA}`);
    console.log(`⚡ WebSockets ativos via Socket.io com autenticação JWT`);
});
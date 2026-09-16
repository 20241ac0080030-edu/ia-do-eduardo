# 💠 SISTEMA N.E.O.N. 3.5 - Agente Autônomo com Gamificação e Health Check

Projeto desenvolvido na disciplina de **Serviços em Nuvem** sob orientação do **Prof. Vagner Simões Santos**.

## 🚀 Sobre o Projeto
O N.E.O.N. é uma aplicação de inteligência artificial baseada em arquitetura de agentes autônomos (*Agentic AI*). O sistema integra modelos da série Gemini 3.5, histórico contextual no MongoDB Atlas, chamadas de ferramentas (*Function Calling* de clima e moedas), mecânicas de gamificação com Leaderboard de pontuação e monitoramento ativo de integridade em nuvem (*Health Check*).

## 🛠️ Tecnologias Utilizadas
- **Runtime & Servidor:** Node.js, Express 5
- **Inteligência Artificial:** Google Gemini API (`gemini-3.5-flash`), Function Calling
- **Banco de Dados:** MongoDB Atlas, Mongoose ODM
- **Monitoramento & Qualidade:** Health Check Endpoint, UptimeRobot
- **Frontend:** HTML5 semântico, CSS3 Cyberpunk, JavaScript Vanilla, Canvas-Confetti

## 📡 Endpoints Principais
| Método | Rota | Descrição | Autenticação |
|---|---|---|---|
| `GET` | `/api/health` | Verifica integridade do servidor e do banco | Pública |
| `POST` | `/api/chat` | Envio de mensagens e execução de ferramentas | Pública/Sessão |
| `GET` | `/api/ranking` | Retorna o Top 10 jogadores ordenados por XP | Pública |
| `DELETE` | `/api/chat/limpar` | Limpa histórico e dados de sessão | Pública |

## ⚙️ Como Executar Localmente
1. Clone o repositório:
   ```bash
   git clone https://github.com/seu-usuario/seu-repositorio.git
   cd seu-repositorio
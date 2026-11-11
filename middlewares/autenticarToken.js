const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'neon_secret_jwt_corporativo_2026';

function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            erro: "401 Unauthorized: Token de autenticação ausente."
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decodificado = jwt.verify(token, JWT_SECRET);
        // Anexa o usuário decodificado à requisição para que o próximo middleware leia req.usuario
        req.usuario = decodificado;
        next();
    } catch (err) {
        return res.status(401).json({
            erro: "401 Unauthorized: Token inválido ou expirado."
        });
    }
}

module.exports = autenticarToken;
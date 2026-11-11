// [REQ-002] Middleware de Acesso (apenasAdmin) - 15 Pontos na Inspeção Estática
function apenasAdmin(req, res, next) {
    // Intercepta a requisição e lê req.usuario.role
    if (req.usuario && req.usuario.role === "admin") {
        return next();
    } else {
        // Bloqueia obrigatoriamente retornando o HTTP Status 403 (Forbidden)
        return res.status(403).json({
            erro: "403 Forbidden: Acesso restrito exclusivamente a administradores."
        });
    }
}

module.exports = apenasAdmin;
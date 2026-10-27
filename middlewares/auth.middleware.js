const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'VAM2026#00';

exports.verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(403).json({ mensaje: 'Token requerido' });
    }

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.user = decoded;
        next();
    } catch (error) {
        console.warn(`[AUTH] Token verification failed for ${req.method} ${req.originalUrl || req.url}:`, error.message);
        return res.status(401).json({ mensaje: 'Token inválido o expirado', detalle: error.message });
    }
};
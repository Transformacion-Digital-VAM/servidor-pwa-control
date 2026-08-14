const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// Directorio de logs
const LOGS_DIR = path.join(__dirname, '..', 'logs');

// Asegurar que exista el directorio logs
if (!fs.existsSync(LOGS_DIR)) {
    try {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    } catch (err) {
        console.error('Error al crear directorio de logs:', err.message);
    }
}

/**
 * Obtener nombre del archivo de log según la fecha actual (YYYY-MM-DD)
 */
function getLogFileName(tipo = 'actividad') {
    const ahora = new Date();
    const year = ahora.getFullYear();
    const month = String(ahora.getMonth() + 1).padStart(2, '0');
    const day = String(ahora.getDate()).padStart(2, '0');
    return path.join(LOGS_DIR, `${tipo}-${year}-${month}-${day}.log`);
}

/**
 * Formatear fecha y hora legible (YYYY-MM-DD HH:mm:ss.SSS)
 */
function getTimestamp() {
    const ahora = new Date();
    return ahora.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Extraer información del usuario a partir del request (req.user, token JWT o IP)
 */
function extractUserInfo(req) {
    if (!req) {
        return {
            id: 'SISTEMA',
            username: 'SISTEMA',
            nombre: 'SISTEMA',
            role: 'SISTEMA',
            ip: '127.0.0.1',
            identificador: '[SISTEMA]'
        };
    }

    let user = req.user || null;

    // Si req.user no está seteado, intentar decodificar el token de los headers
    if (!user) {
        const authHeader = req.headers?.authorization || req.headers?.Authorization;
        if (authHeader && typeof authHeader === 'string') {
            const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
            try {
                const decoded = jwt.decode(token);
                if (decoded && typeof decoded === 'object') {
                    user = decoded;
                }
            } catch (e) {
                // Token inválido o malformado
            }
        }
    }

    const ip = req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || 'Desconocida';

    if (user) {
        const id = user.id || user._id || user.userId || 'N/A';
        const username = user.username || user.usuario || 'N/A';
        const nombre = user.nombre || '';
        const role = user.role || user.rol || 'N/A';
        const coordinacion = user.coordinacion || 'N/A';

        return {
            id,
            username,
            nombre,
            role,
            coordinacion,
            ip,
            identificador: `[Usuario: ${username} | Rol: ${role} | ID: ${id} | IP: ${ip}]`
        };
    }

    return {
        id: 'ANONIMO',
        username: 'ANONIMO',
        nombre: 'Sin Token',
        role: 'DESCONOCIDO',
        ip,
        identificador: `[Usuario: ANONIMO/SIN_TOKEN | IP: ${ip}]`
    };
}

/**
 * Escribir línea en archivo de log de forma asíncrona y segura
 */
function appendToFile(tipo, mensaje) {
    try {
        const filePath = getLogFileName(tipo);
        fs.appendFile(filePath, mensaje + '\n', (err) => {
            if (err) {
                console.error(`[LOGGER] Error escribiendo a ${filePath}:`, err.message);
            }
        });
    } catch (err) {
        console.error('[LOGGER] Error inesperado en appendToFile:', err.message);
    }
}

/**
 * Sanitizar objetos para logs (ocultar contraseñas y limitar tamaños)
 */
function sanitizeData(data) {
    if (!data || typeof data !== 'object') return data;
    try {
        const copia = JSON.parse(JSON.stringify(data));
        const clavesSensibles = ['password', 'contraseña', 'token', 'secret'];
        function limpiar(obj) {
            if (!obj || typeof obj !== 'object') return;
            for (const key of Object.keys(obj)) {
                if (clavesSensibles.includes(key.toLowerCase())) {
                    obj[key] = '******';
                } else if (typeof obj[key] === 'object') {
                    limpiar(obj[key]);
                }
            }
        }
        limpiar(copia);
        return copia;
    } catch (e) {
        return '[Dato no serializable]';
    }
}

/**
 * Registrar una acción exitosa de negocio o modificación en BD
 */
function logAccion(req, accion, { descripcion, datos, resultado, status = 'EXITO' } = {}) {
    const timestamp = getTimestamp();
    const user = extractUserInfo(req);
    const datosSanitizados = datos ? JSON.stringify(sanitizeData(datos)) : 'Sin datos';
    const resultadoSanitizado = resultado ? (typeof resultado === 'object' ? JSON.stringify(sanitizeData(resultado)) : resultado) : 'OK';

    const logLine = `[${timestamp}] [${status}] ${user.identificador} [ACCION: ${accion}] ${descripcion || ''} | DATOS_ENTRADA: ${datosSanitizados} | RESULTADO: ${resultadoSanitizado}`;

    // Consola con formato legible
    const colorStatus = status === 'EXITO' ? '\x1b[32m' : '\x1b[33m'; // Verde o Amarillo
    console.log(`${colorStatus}[${status}]\x1b[0m \x1b[36m[${accion}]\x1b[0m ${user.identificador} - ${descripcion || ''}`);

    // Archivo de actividad
    appendToFile('actividad', logLine);
}

/**
 * Registrar una advertencia de negocio (ej. validación fallida, duplicado evitado, registro no encontrado)
 */
function logWarn(req, accion, mensaje, datosAdicionales = {}) {
    const timestamp = getTimestamp();
    const user = extractUserInfo(req);
    const datosStr = datosAdicionales ? JSON.stringify(sanitizeData(datosAdicionales)) : '';

    const logLine = `[${timestamp}] [ADVERTENCIA] ${user.identificador} [ACCION: ${accion}] ${mensaje} | DETALLES: ${datosStr}`;

    console.warn(`\x1b[33m[ADVERTENCIA]\x1b[0m \x1b[36m[${accion}]\x1b[0m ${user.identificador} - ${mensaje}`);

    appendToFile('actividad', logLine);
}

/**
 * Registrar un error crítico o excepción
 */
function logError(req, accion, error, datosAdicionales = {}) {
    const timestamp = getTimestamp();
    const user = extractUserInfo(req);
    const mensajeError = error?.message || (typeof error === 'string' ? error : JSON.stringify(error));
    const stack = error?.stack || '';
    const datosStr = datosAdicionales ? JSON.stringify(sanitizeData(datosAdicionales)) : '';

    const logLine = `[${timestamp}] [ERROR] ${user.identificador} [ACCION: ${accion}] Error: ${mensajeError} | DETALLES: ${datosStr} | STACK: ${stack}`;

    console.error(`\x1b[31m[ERROR]\x1b[0m \x1b[36m[${accion}]\x1b[0m ${user.identificador} - ${mensajeError}`);

    appendToFile('errores', logLine);
    appendToFile('actividad', `[${timestamp}] [ERROR] ${user.identificador} [ACCION: ${accion}] Error: ${mensajeError}`);
}

/**
 * Middleware Express para registrar automáticamente peticiones HTTP mutantes (POST, PUT, DELETE, PATCH)
 */
function requestLoggerMiddleware(req, res, next) {
    const metodosMutantes = ['POST', 'PUT', 'DELETE', 'PATCH'];

    // Solo loguear peticiones que modifican datos o peticiones relevantes
    if (metodosMutantes.includes(req.method)) {
        const inicio = Date.now();
        const { method, originalUrl } = req;

        // Escuchar el evento 'finish' para capturar el status final de la respuesta
        res.on('finish', () => {
            const duracion = Date.now() - inicio;
            const user = extractUserInfo(req);
            const status = res.statusCode;

            const nivel = status >= 500 ? 'ERROR' : (status >= 400 ? 'ALERTA' : 'HTTP');
            const logLine = `[${getTimestamp()}] [${nivel}] ${user.identificador} ${method} ${originalUrl} -> Status: ${status} (${duracion}ms)`;

            if (status >= 400) {
                console.log(`\x1b[33m[${nivel} ${status}]\x1b[0m ${method} ${originalUrl} by ${user.username} (${duracion}ms)`);
            }

            appendToFile('actividad', logLine);
        });
    }

    next();
}

module.exports = {
    extractUserInfo,
    logAccion,
    logWarn,
    logError,
    requestLoggerMiddleware
};

const Log = require('../models/Log');

/**
 * Obtener logs paginados con filtros opcionales (solo administradores)
 */
exports.getLogs = async (req, res) => {
    try {
        const userRole = req.user?.role;
        if (!['admin', 'master', 'superadmin'].includes(userRole)) {
            return res.status(403).json({ message: "No tienes permisos para ver los logs de auditoría" });
        }

        const {
            page = 1,
            limit = 50,
            accion,
            nivel,
            username,
            fechaInicio,
            fechaFin,
            busqueda
        } = req.query;

        const filtro = {};

        if (accion) {
            filtro.accion = accion;
        }

        if (nivel) {
            filtro.nivel = nivel;
        }

        if (username) {
            filtro['usuario.username'] = new RegExp(username, 'i');
        }

        if (busqueda) {
            filtro.$or = [
                { descripcion: new RegExp(busqueda, 'i') },
                { accion: new RegExp(busqueda, 'i') },
                { 'usuario.username': new RegExp(busqueda, 'i') },
                { 'usuario.nombre': new RegExp(busqueda, 'i') }
            ];
        }

        if (fechaInicio || fechaFin) {
            filtro.createdAt = {};
            if (fechaInicio) {
                filtro.createdAt.$gte = new Date(fechaInicio);
            }
            if (fechaFin) {
                const fin = new Date(fechaFin);
                fin.setHours(23, 59, 59, 999);
                filtro.createdAt.$lte = fin;
            }
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [total, logs] = await Promise.all([
            Log.countDocuments(filtro),
            Log.find(filtro)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean()
        ]);

        res.status(200).json({
            total,
            paginaActual: parseInt(page),
            totalPaginas: Math.ceil(total / parseInt(limit)),
            limite: parseInt(limit),
            logs
        });
    } catch (error) {
        res.status(500).json({ message: "Error al consultar logs", error: error.message });
    }
};

/**
 * Obtener un log específico por ID con todos sus detalles
 */
exports.getLogById = async (req, res) => {
    try {
        const userRole = req.user?.role;
        if (!['admin', 'master', 'superadmin'].includes(userRole)) {
            return res.status(403).json({ message: "No tienes permisos para ver los logs de auditoría" });
        }

        const log = await Log.findById(req.params.id);
        if (!log) {
            return res.status(404).json({ message: "Log no encontrado" });
        }

        res.status(200).json(log);
    } catch (error) {
        res.status(500).json({ message: "Error al consultar el log", error: error.message });
    }
};

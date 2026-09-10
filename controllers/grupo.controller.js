const Grupo = require('../models/Grupo');
const Credito = require('../models/Credito');
const { logAccion, logWarn, logError } = require('../utils/loggers');

/**
 * Función auxiliar para extraer todos los datos del modelo Grupo
 */
const formatGrupoData = (grupo) => {
    if (!grupo) return null;
    const g = grupo.toObject ? grupo.toObject() : grupo;
    return {
        _id: g._id,
        nombre: g.nombre,
        clave: g.clave,
        diaVisita: g.diaVisita,
        horaVisita: g.horaVisita,
        integrantes: g.integrantes || [],
        coordinacion: g.coordinacion,
        asesor: g.asesor,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt
    };
};

exports.createGrupo = async (req, res) => {
    try {
        // Solo el Admin, master o superadmin pueden crear grupos
        if (!['admin', 'master', 'superadmin'].includes(req.user.role)) {
            logWarn(req, 'CREAR_GRUPO_DENEGADO', `Permisos insuficientes para crear grupo (Rol: ${req.user.role})`, { body: req.body });
            return res.status(403).json({ message: "No tienes permisos para crear grupos" });
        }

        const grupo = new Grupo(req.body);
        await grupo.save();

        const datosGrupo = formatGrupoData(grupo);

        logAccion(req, 'CREAR_GRUPO', {
            descripcion: `Grupo creado exitosamente: "${grupo.nombre}" (Clave: ${grupo.clave})`,
            datos: req.body,
            resultado: datosGrupo
        });

        res.status(201).json(grupo);
    } catch (error) {
        logError(req, 'CREAR_GRUPO_ERROR', error, { body: req.body });
        res.status(500).json({ message: error.message });
    }
}

exports.getGrupos = async (req, res) => {
    try {
        let query = {};
        const mongoose = require('mongoose');

        // Filtro estricto por roles para el listado
        if (req.user && req.user.role && req.user.role.toLowerCase() === 'asesor') {
            const userId = req.user.id;
            query = {
                $or: [
                    { asesor: userId },
                    ...(mongoose.Types.ObjectId.isValid(userId) ? [{ asesor: new mongoose.Types.ObjectId(userId) }] : [])
                ]
            };
        } else if (req.user && req.user.role && req.user.role.toLowerCase() === 'coordinador') {
            query = { coordinacion: req.user.coordinacion };
        }
        // Si es admin o master, query = {} (ve todo)

        const grupos = await Grupo.find(query)
            .populate('asesor', 'username nombre')
            .populate('coordinacion', 'nombre')
            .populate('integrantes')
            .lean();

        res.status(200).json(grupos);
    } catch (error) {
        logError(req, 'GET_GRUPOS_ERROR', error);
        res.status(500).json({ message: error.message });
    }
}

exports.getGrupoById = async (req, res) => {
    try {
        const grupo = await Grupo.findById(req.params.id)
            .populate('integrantes')
            .populate('asesor', 'username nombre')
            .populate('coordinacion', 'nombre');

        if (!grupo) {
            logWarn(req, 'GET_GRUPO_NOT_FOUND', 'Grupo no encontrado por ID', { id: req.params.id });
            return res.status(404).json({ message: "Grupo no encontrado" });
        }

        // Verificación de seguridad individual (por si intentan entrar por ID directo)
        if (req.user.role === 'asesor' && grupo.asesor._id.toString() !== req.user.id) {
            logWarn(req, 'GET_GRUPO_DENEGADO', 'Asesor intentó acceder a grupo que no le corresponde', { grupoId: req.params.id, userId: req.user.id });
            return res.status(403).json({ message: "No tienes permiso para ver este grupo" });
        }

        if (req.user.role === 'coordinador' && grupo.coordinacion._id.toString() !== req.user.coordinacion) {
            logWarn(req, 'GET_GRUPO_DENEGADO', 'Coordinador intentó acceder a grupo fuera de su coordinación', { grupoId: req.params.id, userCoord: req.user.coordinacion });
            return res.status(403).json({ message: "Este grupo no pertenece a tu coordinación" });
        }

        res.status(200).json(grupo);
    } catch (error) {
        logError(req, 'GET_GRUPO_BY_ID_ERROR', error, { id: req.params.id });
        res.status(500).json({ message: error.message });
    }
}

exports.getGruposPorCoordinacion = async (req, res) => {
    try {
        const { coordinacion } = req.params;
        const grupos = await Grupo.find({ coordinacion: coordinacion })
            .populate('asesor', 'username nombre')
            .populate('coordinacion', 'nombre')
            .populate('integrantes');

        res.status(200).json(grupos);
    } catch (error) {
        logError(req, 'GET_GRUPOS_COORD_ERROR', error, { coordinacion: req.params.coordinacion });
        res.status(500).json({ message: error.message });
    }
}

exports.getGruposPorAsesor = async (req, res) => {
    try {
        const { asesor } = req.params;
        const grupos = await Grupo.find({ asesor: asesor })
            .populate('asesor', 'username nombre')
            .populate('coordinacion', 'nombre')
            .populate('integrantes');

        res.status(200).json(grupos);
    } catch (error) {
        logError(req, 'GET_GRUPOS_ASESOR_ERROR', error, { asesor: req.params.asesor });
        res.status(500).json({ message: error.message });
    }
}

exports.updateGrupo = async (req, res) => {
    try {
        // Solo el Admin, master o superadmin pueden editar grupos
        if (!['admin', 'master', 'superadmin'].includes(req.user.role)) {
            logWarn(req, 'ACTUALIZAR_GRUPO_DENEGADO', `Permisos insuficientes para editar grupo (Rol: ${req.user.role})`, { id: req.params.id, body: req.body });
            return res.status(403).json({ message: "Solo el administrador puede editar grupos" });
        }

        const grupoAnterior = await Grupo.findById(req.params.id);
        if (!grupoAnterior) {
            logWarn(req, 'ACTUALIZAR_GRUPO_NOT_FOUND', 'Grupo no encontrado para actualizar', { id: req.params.id, body: req.body });
            return res.status(404).json({ message: "Grupo no encontrado" });
        }

        const grupo = await Grupo.findByIdAndUpdate(req.params.id, req.body, { new: true });
        const datosGrupo = formatGrupoData(grupo);

        logAccion(req, 'ACTUALIZAR_GRUPO', {
            descripcion: `Grupo actualizado exitosamente: "${grupo.nombre}" (Clave: ${grupo.clave})`,
            datos: {
                id: req.params.id,
                cambios: req.body,
                estadoAnterior: formatGrupoData(grupoAnterior)
            },
            resultado: datosGrupo
        });

        res.status(200).json(grupo);
    } catch (error) {
        logError(req, 'ACTUALIZAR_GRUPO_ERROR', error, { id: req.params.id, body: req.body });
        res.status(500).json({ message: error.message });
    }
}

exports.deleteGrupo = async (req, res) => {
    try {
        // Solo el Admin, master o superadmin pueden eliminar grupos
        if (!['admin', 'master', 'superadmin'].includes(req.user.role)) {
            logWarn(req, 'ELIMINAR_GRUPO_DENEGADO', `Permisos insuficientes para eliminar grupo (Rol: ${req.user.role})`, { id: req.params.id });
            return res.status(403).json({ message: "Solo el administrador puede eliminar grupos" });
        }

        const grupo = await Grupo.findByIdAndDelete(req.params.id);
        if (!grupo) {
            logWarn(req, 'ELIMINAR_GRUPO_NOT_FOUND', 'Grupo no encontrado para eliminar', { id: req.params.id });
            return res.status(404).json({ message: "Grupo no encontrado" });
        }

        const datosGrupo = formatGrupoData(grupo);

        logAccion(req, 'ELIMINAR_GRUPO', {
            descripcion: `Grupo eliminado exitosamente: "${grupo.nombre}" (Clave: ${grupo.clave})`,
            datos: { id: req.params.id },
            resultado: datosGrupo
        });

        res.status(200).json({ message: "Grupo eliminado con éxito", grupo });
    } catch (error) {
        logError(req, 'ELIMINAR_GRUPO_ERROR', error, { id: req.params.id });
        res.status(500).json({ message: error.message });
    }
}

exports.addMiembroAGrupo = async (req, res) => {
    try {
        const { id } = req.params;
        const { miembroId } = req.body;

        if (!miembroId) {
            logWarn(req, 'AGREGAR_MIEMBRO_GRUPO_BAD_REQUEST', 'No se proporcionó miembroId', { grupoId: id, body: req.body });
            return res.status(400).json({ message: "Se requiere el ID del miembro a agregar" });
        }

        const grupo = await Grupo.findByIdAndUpdate(
            id,
            { $addToSet: { integrantes: miembroId } },
            { new: true }
        );

        if (!grupo) {
            logWarn(req, 'AGREGAR_MIEMBRO_GRUPO_NOT_FOUND', 'Grupo no encontrado al intentar agregar miembro', { grupoId: id, miembroId });
            return res.status(404).json({ message: "Grupo no encontrado" });
        }

        const datosGrupo = formatGrupoData(grupo);

        logAccion(req, 'AGREGAR_MIEMBRO_A_GRUPO', {
            descripcion: `Miembro ${miembroId} agregado exitosamente al Grupo "${grupo.nombre}" (Clave: ${grupo.clave})`,
            datos: { grupoId: id, miembroId },
            resultado: datosGrupo
        });

        res.status(200).json(grupo);
    } catch (error) {
        logError(req, 'AGREGAR_MIEMBRO_GRUPO_ERROR', error, { grupoId: req.params.id, body: req.body });
        res.status(500).json({ message: error.message });
    }
}


exports.getCicloSemanaGrupo = async (req, res) => {
    try {
        const { grupoId } = req.params;

        // Buscar el grupo (con datos de sus integrantes)
        const grupo = await Grupo.findById(grupoId).populate('integrantes');

        if (!grupo) {
            return res.status(404).json({
                success: false,
                message: 'El grupo no existe'
            });
        }

        // Verificar que tenga integrantes
        if (!grupo.integrantes || grupo.integrantes.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'El grupo no tiene integrantes'
            });
        }

        // Tomar el primer integrante
        const primerMiembro = grupo.integrantes[0];
        const primerMiembroId = primerMiembro._id || primerMiembro;

        // Buscar el crédito activo más reciente del primer integrante
        const credito = await Credito.findOne({
            miembro: primerMiembroId,
            estado: 'Activo'
        }).sort({ ciclo: -1, createdAt: -1 });

        if (!credito) {
            return res.status(404).json({
                success: false,
                message: 'No se encontró un crédito activo para el grupo'
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                grupoId: grupo._id,
                miembroReferencia: primerMiembro,
                cicloActual: credito.ciclo,
                semanaActual: credito.semanaActual,
                integrantes: grupo.integrantes
            }
        });

    } catch (error) {
        console.error('Error al obtener ciclo y semana:', error);

        return res.status(500).json({
            success: false,
            message: 'Error interno del servidor',
            error: error.message
        });
    }
};


exports.obtenerAsesorGrupo = async (req, res) => {
    try {
        const { grupoId } = req.params;
        const grupo = await Grupo.findById(grupoId)
            .populate('asesor', 'username nombre');
        res.status(200).json(grupo);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
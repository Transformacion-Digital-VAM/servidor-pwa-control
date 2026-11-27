const mongoose = require('mongoose');
const Grupo = require('../models/Grupo');
const Credito = require('../models/Credito');
const Cliente = require('../models/Cliente');
const User = require('../models/User');
const Coordinacion = require('../models/Coordinacion');
const { logAccion, logWarn, logError } = require('../utils/loggers');
const { normalizarRol, extraerIdStr, obtenerCoordinacionId, getAsesoresDeCoordinacion, buildFiltroCoordinacion } = require('../helpers/coordinacionHelper');
const { obtenerDiaSemana } = require('../helpers/fechas');

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
        diaVisita: g.diaVisita || g.diaPago,
        diaPago: g.diaPago || g.diaVisita,
        horaVisita: g.horaVisita,
        integrantes: g.integrantes || [],
        coordinacion: g.coordinacion,
        asesor: g.asesor,
        validada: !!g.validada,
        validadaPor: g.validadaPor || null,
        fechaValidacion: g.fechaValidacion || null,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt
    };
};

/**
 * Asegura que cada grupo tenga su coordinación y el rol normalizado de su asesor/ejecutiva
 * sin perder el ID original de coordinación si el populate de Mongoose devuelve null.
 */
async function normalizarGrupos(grupos) {
    if (!Array.isArray(grupos) || grupos.length === 0) return [];
    const coordinaciones = await Coordinacion.find({}, { nombre: 1 }).lean();
    const coordMap = new Map(coordinaciones.map(c => [String(c._id), c]));

    // Calcular cicloActual y ciclosDisponibles reales desde Credito + Miembro en una sola agregación
    const grupoIds = grupos.map(g => g._id).filter(Boolean);
    const ciclosPorGrupoMap = new Map();
    if (grupoIds.length > 0) {
        try {
            const agg = await Credito.aggregate([
                { $match: { miembro: { $ne: null }, estado: { $ne: 'Cancelado' } } },
                { $lookup: { from: 'miembros', localField: 'miembro', foreignField: '_id', as: 'm', pipeline: [{ $project: { grupo: 1 } }] } },
                { $unwind: '$m' },
                { $match: { 'm.grupo': { $in: grupoIds } } },
                {
                    $group: {
                        _id: '$m.grupo',
                        ciclos: { $addToSet: '$ciclo' },
                        maxCicloActivo: { $max: { $cond: [{ $eq: ['$estado', 'Activo'] }, '$ciclo', 0] } },
                        maxCicloTotal: { $max: '$ciclo' }
                    }
                }
            ]);
            for (const row of agg) {
                const ciclosValidos = (row.ciclos || [])
                    .map(Number)
                    .filter(n => !isNaN(n) && n > 0)
                    .sort((a, b) => b - a);
                const cicloActual = row.maxCicloActivo > 0
                    ? Number(row.maxCicloActivo)
                    : (row.maxCicloTotal > 0 ? Number(row.maxCicloTotal) : 1);
                ciclosPorGrupoMap.set(String(row._id), {
                    cicloActual,
                    ciclosDisponibles: ciclosValidos.length > 0 ? ciclosValidos : [cicloActual]
                });
            }
        } catch (err) {
            console.error('[normalizarGrupos] Error calculando ciclos:', err.message);
        }
    }

    return grupos.map(g => {
        if (g.asesor && typeof g.asesor === 'object') {
            g.asesor.role = normalizarRol(g.asesor.role);
        }
        const gCoordId = extraerIdStr(g.coordinacion) || extraerIdStr(g.asesor?.coordinacion);
        if (gCoordId) {
            g.coordinacion = coordMap.get(gCoordId) || { _id: gCoordId, nombre: g.coordinacion?.nombre || 'Coordinación' };
        }
        const cicloInfo = ciclosPorGrupoMap.get(String(g._id));
        if (cicloInfo) {
            g.cicloActual = cicloInfo.cicloActual;
            g.ciclosDisponibles = cicloInfo.ciclosDisponibles;
        }
        return g;
    });
}

exports.createGrupo = async (req, res) => {
    try {
        // Solo el Admin, master o superadmin pueden crear grupos
        if (!['admin', 'master', 'superadmin'].includes(req.user.role)) {
            logWarn(req, 'CREAR_GRUPO_DENEGADO', `Permisos insuficientes para crear grupo (Rol: ${req.user.role})`, { body: req.body });
            return res.status(403).json({ message: "No tienes permisos para crear grupos" });
        }

        // Auto-asignar coordinación desde el asesor seleccionado (o usuario creador) si no viene en el body
        if (!req.body.coordinacion && req.body.asesor && mongoose.Types.ObjectId.isValid(req.body.asesor)) {
            const asesorDoc = await User.findById(req.body.asesor).select('coordinacion').lean();
            if (asesorDoc && asesorDoc.coordinacion) {
                req.body.coordinacion = asesorDoc.coordinacion;
            }
        }
        if (!req.body.coordinacion && req.user?.coordinacion && mongoose.Types.ObjectId.isValid(String(req.user.coordinacion))) {
            req.body.coordinacion = req.user.coordinacion;
        }

        const diaFinal = req.body.diaPago || req.body.diaVisita || (req.body.fechaPrimerPago ? obtenerDiaSemana(req.body.fechaPrimerPago) : undefined);
        if (diaFinal) {
            req.body.diaVisita = diaFinal;
            req.body.diaPago = diaFinal;
        }

        // Si ya existe un grupo con esa clave, reutilizarlo y actualizarlo en vez de fallar con E11000 duplicate key
        const claveTrim = req.body.clave ? String(req.body.clave).trim() : null;
        if (claveTrim) {
            const grupoExistente = await Grupo.findOne({ clave: claveTrim });
            if (grupoExistente) {
                const grupoActualizado = await Grupo.findByIdAndUpdate(
                    grupoExistente._id,
                    { $set: req.body },
                    { new: true }
                );
                if (diaFinal) {
                    await Cliente.updateMany(
                        { $or: [{ grupo: String(grupoExistente._id) }, { grupo: grupoActualizado.nombre }] },
                        { $set: { diaPago: diaFinal, diaVisita: diaFinal } }
                    );
                }
                const datosGrupo = formatGrupoData(grupoActualizado);
                logAccion(req, 'REUTILIZAR_GRUPO_EXISTENTE', {
                    descripcion: `Grupo existente reutilizado por clave "${claveTrim}": "${grupoActualizado.nombre}"`,
                    datos: req.body,
                    resultado: datosGrupo
                });
                return res.status(200).json(grupoActualizado);
            }
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
        if (error.code === 11000 && req.body.clave) {
            try {
                const claveTrim = String(req.body.clave).trim();
                const grupoExistente = await Grupo.findOne({ clave: claveTrim });
                if (grupoExistente) {
                    const grupoActualizado = await Grupo.findByIdAndUpdate(
                        grupoExistente._id,
                        { $set: req.body },
                        { new: true }
                    );
                    return res.status(200).json(grupoActualizado);
                }
            } catch (innerErr) {
                // continuar al log de error general
            }
        }
        logError(req, 'CREAR_GRUPO_ERROR', error, { body: req.body });
        res.status(500).json({ message: error.message });
    }
};

exports.getGrupos = async (req, res) => {
    try {
        let query = {};
        const role = normalizarRol(req.user?.role);

        // Filtro estricto por roles para el listado
        if (role === 'asesor') {
            const userId = req.user.id;
            query = {
                $or: [
                    { asesor: userId },
                    ...(mongoose.Types.ObjectId.isValid(userId) ? [{ asesor: new mongoose.Types.ObjectId(userId) }] : [])
                ]
            };
        } else if (role === 'coordinador') {
            const coordId = await obtenerCoordinacionId(req.user);
            query = await buildFiltroCoordinacion(coordId, req.query.asesor, req.user.id);
        }
        // Si es admin o master, query = {} (ve todo)

        const gruposRaw = await Grupo.find(query)
            .select('_id nombre clave diaVisita diaPago horaVisita integrantes coordinacion asesor validada validadaPor fechaValidacion createdAt updatedAt')
            .populate('asesor', 'username nombre role coordinacion')
            .lean();

        const grupos = await normalizarGrupos(gruposRaw);
        res.status(200).json(grupos);
    } catch (error) {
        logError(req, 'GET_GRUPOS_ERROR', error);
        res.status(500).json({ message: error.message });
    }
};

exports.getGrupoById = async (req, res) => {
    try {
        const grupo = await Grupo.findById(req.params.id)
            .populate('integrantes')
            .populate('asesor', 'username nombre role coordinacion')
            .populate('coordinacion', 'nombre');

        if (!grupo) {
            logWarn(req, 'GET_GRUPO_NOT_FOUND', 'Grupo no encontrado por ID', { id: req.params.id });
            return res.status(404).json({ message: "Grupo no encontrado" });
        }

        const role = normalizarRol(req.user?.role);

        // Verificación de seguridad individual (por si intentan entrar por ID directo)
        if (role === 'asesor' && grupo.asesor && grupo.asesor._id.toString() !== req.user.id) {
            logWarn(req, 'GET_GRUPO_DENEGADO', 'Asesor intentó acceder a grupo que no le corresponde', { grupoId: req.params.id, userId: req.user.id });
            return res.status(403).json({ message: "No tienes permiso para ver este grupo" });
        }

        if (role === 'coordinador') {
            const coordId = await obtenerCoordinacionId(req.user);
            const userCoordStr = extraerIdStr(coordId);
            const grupoCoordStr = extraerIdStr(grupo.coordinacion) || extraerIdStr(grupo.asesor?.coordinacion);
            const grupoAsesorIdStr = extraerIdStr(grupo.asesor);

            let pertenece = !userCoordStr || (grupoCoordStr && grupoCoordStr === userCoordStr) || (grupoAsesorIdStr && grupoAsesorIdStr === String(req.user.id));

            if (!pertenece && grupoAsesorIdStr) {
                const asesoresCoord = await getAsesoresDeCoordinacion(userCoordStr, req.user.id);
                pertenece = asesoresCoord.some(id => String(id) === grupoAsesorIdStr);
            }

            if (!pertenece) {
                logWarn(req, 'GET_GRUPO_DENEGADO', 'Coordinador intentó acceder a grupo fuera de su coordinación', { grupoId: req.params.id, userCoord: userCoordStr });
                return res.status(403).json({ message: "Este grupo no pertenece a tu coordinación" });
            }
        }

        const grupoObj = grupo.toObject();
        const miembroIds = (grupoObj.integrantes || []).map(m => m._id || m);
        const creditosGrupo = miembroIds.length > 0
            ? await Credito.find({ miembro: { $in: miembroIds } }).lean()
            : [];

        res.status(200).json({ ...grupoObj, creditos: creditosGrupo });
    } catch (error) {
        logError(req, 'GET_GRUPO_BY_ID_ERROR', error, { id: req.params.id });
        res.status(500).json({ message: error.message });
    }
};

exports.getGruposPorCoordinacion = async (req, res) => {
    try {
        const { coordinacion } = req.params;
        const query = await buildFiltroCoordinacion(coordinacion);
        const gruposRaw = await Grupo.find(query)
            .select('_id nombre clave diaVisita diaPago horaVisita integrantes coordinacion asesor validada validadaPor fechaValidacion createdAt updatedAt')
            .populate('asesor', 'username nombre role coordinacion')
            .lean();

        const grupos = await normalizarGrupos(gruposRaw);
        res.status(200).json(grupos);
    } catch (error) {
        logError(req, 'GET_GRUPOS_COORD_ERROR', error, { coordinacion: req.params.coordinacion });
        res.status(500).json({ message: error.message });
    }
};

exports.getGruposPorAsesor = async (req, res) => {
    try {
        let { asesor } = req.params;
        const role = normalizarRol(req.user?.role);

        // Un asesor solo puede consultar sus propios grupos
        if (role === 'asesor') {
            if (String(asesor) !== String(req.user.id)) {
                logWarn(req, 'GET_GRUPOS_ASESOR_DENEGADO', 'Asesor intentó consultar grupos de otro asesor', { asesorSolicitado: asesor, userId: req.user.id });
                return res.status(403).json({ message: "No tienes permiso para ver grupos de otro asesor" });
            }
            asesor = req.user.id;
        } else if (role === 'coordinador') {
            const coordId = await obtenerCoordinacionId(req.user);
            const asesoresCoord = await getAsesoresDeCoordinacion(coordId, req.user.id);
            const permitido = asesoresCoord.some(id => String(id) === String(asesor)) || String(asesor) === String(req.user.id);
            if (!permitido) {
                logWarn(req, 'GET_GRUPOS_ASESOR_DENEGADO', 'Coordinador intentó consultar grupos de asesor fuera de su coordinación', { asesorSolicitado: asesor, userCoord: coordId });
                return res.status(403).json({ message: "Este asesor no pertenece a tu coordinación" });
            }
        }

        const gruposRaw = await Grupo.find({ asesor: asesor })
            .select('_id nombre clave diaVisita diaPago horaVisita integrantes coordinacion asesor validada validadaPor fechaValidacion createdAt updatedAt')
            .populate('asesor', 'username nombre role coordinacion')
            .lean();

        const grupos = await normalizarGrupos(gruposRaw);
        res.status(200).json(grupos);
    } catch (error) {
        logError(req, 'GET_GRUPOS_ASESOR_ERROR', error, { asesor: req.params.asesor });
        res.status(500).json({ message: error.message });
    }
};

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

        if (!req.body.coordinacion && req.body.asesor && mongoose.Types.ObjectId.isValid(req.body.asesor)) {
            const asesorDoc = await User.findById(req.body.asesor).select('coordinacion').lean();
            if (asesorDoc && asesorDoc.coordinacion) {
                req.body.coordinacion = asesorDoc.coordinacion;
            }
        }

        const diaFinal = req.body.diaPago || req.body.diaVisita || (req.body.fechaPrimerPago ? obtenerDiaSemana(req.body.fechaPrimerPago) : undefined);
        if (diaFinal) {
            req.body.diaVisita = diaFinal;
            req.body.diaPago = diaFinal;
        }

        const grupo = await Grupo.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (diaFinal) {
            await Cliente.updateMany(
                { $or: [{ grupo: String(req.params.id) }, { grupo: grupo.nombre }] },
                { $set: { diaPago: diaFinal, diaVisita: diaFinal } }
            );
        }
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

        const grupoObj = grupo.toObject();
        const miembroIds = (grupoObj.integrantes || []).map(m => m._id || m);
        const creditosGrupo = miembroIds.length > 0
            ? await Credito.find({ miembro: { $in: miembroIds } }).lean()
            : [];

        res.status(200).json({ ...grupoObj, creditos: creditosGrupo });
    } catch (error) {
        logError(req, 'ACTUALIZAR_GRUPO_ERROR', error, { id: req.params.id, body: req.body });
        res.status(500).json({ message: error.message });
    }
};

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
};

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

        const grupoObj = grupo.toObject();
        const miembroIds = (grupoObj.integrantes || []).map(m => m._id || m);
        const creditosGrupo = miembroIds.length > 0
            ? await Credito.find({ miembro: { $in: miembroIds } }).lean()
            : [];

        res.status(200).json({ ...grupoObj, creditos: creditosGrupo });
    } catch (error) {
        logError(req, 'AGREGAR_MIEMBRO_GRUPO_ERROR', error, { grupoId: req.params.id, body: req.body });
        res.status(500).json({ message: error.message });
    }
};

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

exports.validarGrupo = async (req, res) => {
    try {
        const role = normalizarRol(req.user?.role);
        if (!['coordinador', 'admin', 'master', 'superadmin'].includes(role)) {
            return res.status(403).json({ message: "Solo el coordinador o administrador puede validar la hoja" });
        }

        const grupo = await Grupo.findById(req.params.id);
        if (!grupo) {
            return res.status(404).json({ message: "Grupo no encontrado" });
        }

        const validada = req.body.validada !== undefined ? Boolean(req.body.validada) : !grupo.validada;
        let nombreValidador = req.user?.nombre || req.user?.username || 'COP';
        if (req.user?.id && !req.user?.nombre) {
            const userDoc = await User.findById(req.user.id).select('nombre username').lean();
            if (userDoc) nombreValidador = userDoc.nombre || userDoc.username || nombreValidador;
        }

        grupo.validada = validada;
        grupo.validadaPor = validada ? nombreValidador : null;
        grupo.fechaValidacion = validada ? new Date() : null;
        await grupo.save();

        const grupoObj = grupo.toObject();
        const miembroIds = (grupoObj.integrantes || []).map(m => m._id || m);
        const creditosGrupo = miembroIds.length > 0
            ? await Credito.find({ miembro: { $in: miembroIds } }).lean()
            : [];

        res.status(200).json({ ...grupoObj, creditos: creditosGrupo });
    } catch (error) {
        logError(req, 'VALIDAR_GRUPO_ERROR', error, { id: req.params.id });
        res.status(500).json({ message: error.message });
    }
};

exports.obtenerAsesorGrupo = async (req, res) => {
    try {
        const { grupoId } = req.params;
        const grupo = await Grupo.findById(grupoId)
            .populate('asesor', 'username nombre role coordinacion');
        const grupoObj = grupo.toObject();
        const miembroIds = (grupoObj.integrantes || []).map(m => m._id || m);
        const creditosGrupo = miembroIds.length > 0
            ? await Credito.find({ miembro: { $in: miembroIds } }).lean()
            : [];

        res.status(200).json({ ...grupoObj, creditos: creditosGrupo });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

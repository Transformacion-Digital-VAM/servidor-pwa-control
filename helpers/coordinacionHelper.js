const mongoose = require('mongoose');
const User = require('../models/User');
const Coordinacion = require('../models/Coordinacion');
const Grupo = require('../models/Grupo');

/**
 * Normaliza el rol del usuario (soportando variantes como 'Coordinador', 'acoordinador', 'cop').
 */
function normalizarRol(role) {
    if (!role) return '';
    const r = String(role).toLowerCase().trim();
    if (r === 'coordinador' || r === 'acoordinador' || r === 'cop' || r === 'coordinacion') {
        return 'coordinador';
    }
    if (r === 'ejecutiva') {
        return 'master';
    }
    return r;
}

/**
 * Extrae el ID en string limpio de un campo coordinacion/asesor (sea ObjectId, string u objeto poblado).
 */
function extraerIdStr(val) {
    if (!val || val === 'N/A') return '';
    if (typeof val === 'object') {
        if (val._id) return String(val._id).trim();
        if (val.id) return String(val.id).trim();
        if (val.$oid) return String(val.$oid).trim();
    }
    return String(val).trim();
}

/**
 * Normaliza texto para comparación insensible a mayúsculas/acentos/espacios.
 */
function normalizarTexto(txt) {
    if (!txt) return '';
    return String(txt)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * Obtiene el ID de la coordinación del usuario, usando req.user.coordinacion,
 * consultando el usuario en BD, buscando por nombre en el modelo Coordinacion,
 * o infiriéndolo de los grupos asignados al usuario.
 */
async function obtenerCoordinacionId(user) {
    if (!user) return null;
    const directCoord = extraerIdStr(user.coordinacion);
    if (directCoord && mongoose.Types.ObjectId.isValid(directCoord)) {
        return directCoord;
    }

    const uId = extraerIdStr(user.id || user._id);
    let userDoc = null;
    if (uId && mongoose.Types.ObjectId.isValid(uId)) {
        userDoc = await User.findById(uId).select('coordinacion nombre username').lean();
        const dbCoord = extraerIdStr(userDoc?.coordinacion);
        if (dbCoord && mongoose.Types.ObjectId.isValid(dbCoord)) {
            return dbCoord;
        }
    }

    // Si directCoord o dbCoord era un nombre de coordinación (ej. "Fuerza de Venta"), buscar su _id
    const rawCoordStr = directCoord || extraerIdStr(userDoc?.coordinacion);
    if (rawCoordStr) {
        const allCoords = await Coordinacion.find({}).select('_id nombre coordinador').lean();
        const normRaw = normalizarTexto(rawCoordStr);
        const matchByName = allCoords.find(c => normalizarTexto(c.nombre) === normRaw);
        if (matchByName && matchByName._id) {
            return String(matchByName._id);
        }
    }

    // Fallback 1: buscar por nombre/username en el modelo Coordinacion
    const query = [];
    const nombreBusqueda = user.nombre || userDoc?.nombre;
    const usernameBusqueda = user.username || userDoc?.username;
    if (nombreBusqueda && String(nombreBusqueda).trim()) {
        query.push({ coordinador: new RegExp(String(nombreBusqueda).trim(), 'i') });
    }
    if (usernameBusqueda && String(usernameBusqueda).trim()) {
        query.push({ coordinador: new RegExp(String(usernameBusqueda).trim(), 'i') });
    }
    if (query.length > 0) {
        const coord = await Coordinacion.findOne({ $or: query }).select('_id').lean();
        if (coord && coord._id) return coord._id.toString();
    }

    // Fallback 2: inferir la coordinación desde algún grupo asignado al usuario
    if (uId) {
        const uIdObj = mongoose.Types.ObjectId.isValid(uId) ? new mongoose.Types.ObjectId(uId) : uId;
        const grupoUsuario = await Grupo.findOne({
            $or: [{ asesor: uId }, { asesor: uIdObj }],
            coordinacion: { $exists: true, $ne: null }
        }).select('coordinacion').lean();
        const gCoord = extraerIdStr(grupoUsuario?.coordinacion);
        if (gCoord && mongoose.Types.ObjectId.isValid(gCoord)) {
            return gCoord;
        }
    }

    return null;
}

/**
 * Resuelve todos los IDs de coordinación equivalentes (por si existen documentos duplicados
 * en la colección Coordinacion con el mismo nombre, ej. "Fuerza de Venta") y todos los
 * asesores/ejecutivas pertenecientes a esa coordinación en memoria (evitando problemas de
 * casteo BSON String vs ObjectId de Mongoose).
 */
async function obtenerContextoCoordinacion(coordIdOrUser, extraUserId = null) {
    let primaryCoordId = null;
    if (coordIdOrUser && typeof coordIdOrUser === 'object' && !coordIdOrUser._bsontype) {
        primaryCoordId = await obtenerCoordinacionId(coordIdOrUser);
        if (!extraUserId) {
            extraUserId = extraerIdStr(coordIdOrUser.id || coordIdOrUser._id);
        }
    } else {
        primaryCoordId = extraerIdStr(coordIdOrUser);
    }

    const [coordinaciones, todosUsuarios, todosGrupos] = await Promise.all([
        Coordinacion.find({}).select('_id nombre municipio coordinador').lean(),
        User.find({}).select('_id username nombre role coordinacion').lean(),
        Grupo.find({}).select('_id asesor coordinacion').lean()
    ]);

    const coordIdsSet = new Set();
    const coordNamesSet = new Set();

    if (primaryCoordId) {
        coordIdsSet.add(String(primaryCoordId));
        const normPrimary = normalizarTexto(primaryCoordId);
        for (const c of coordinaciones) {
            const cIdStr = String(c._id);
            const cNormName = normalizarTexto(c.nombre);
            if (cIdStr === String(primaryCoordId) || (cNormName && cNormName === normPrimary)) {
                coordIdsSet.add(cIdStr);
                if (cNormName) coordNamesSet.add(cNormName);
            }
        }
        // Segunda pasada: agregar cualquier otro documento Coordinacion con el mismo nombre normalizado
        if (coordNamesSet.size > 0) {
            for (const c of coordinaciones) {
                const cNormName = normalizarTexto(c.nombre);
                if (cNormName && coordNamesSet.has(cNormName)) {
                    coordIdsSet.add(String(c._id));
                }
            }
        }
    }

    const coincideCoordinacion = (val) => {
        if (!val) return false;
        const valId = extraerIdStr(val);
        if (valId && coordIdsSet.has(valId)) return true;
        const valNorm = normalizarTexto(typeof val === 'object' ? (val.nombre || valId) : val);
        if (valNorm && coordNamesSet.has(valNorm)) return true;
        return false;
    };

    const asesorIdsSet = new Set();
    const usuariosMap = new Map();

    for (const u of todosUsuarios) {
        const uIdStr = String(u._id);
        usuariosMap.set(uIdStr, u);
        if (coincideCoordinacion(u.coordinacion)) {
            asesorIdsSet.add(uIdStr);
        }
    }

    // También incluir asesores que tengan grupos registrados bajo esta coordinación
    for (const g of todosGrupos) {
        const gAsesorStr = extraerIdStr(g.asesor);
        if (coincideCoordinacion(g.coordinacion) && gAsesorStr) {
            asesorIdsSet.add(gAsesorStr);
        }
    }

    if (extraUserId) {
        const extraStr = extraerIdStr(extraUserId);
        if (extraStr) asesorIdsSet.add(extraStr);
    }

    const grupoIdsSet = new Set();
    for (const g of todosGrupos) {
        const gAsesorStr = extraerIdStr(g.asesor);
        if (coincideCoordinacion(g.coordinacion) || (gAsesorStr && asesorIdsSet.has(gAsesorStr))) {
            grupoIdsSet.add(String(g._id));
        }
    }

    return {
        primaryCoordId,
        coordIdsSet,
        coordNamesSet,
        asesorIdsSet,
        grupoIdsSet,
        usuariosMap,
        coordinaciones,
        coincideCoordinacion
    };
}

/**
 * Obtiene los IDs de todos los usuarios (asesor, master/ejecutiva, coordinador)
 * que pertenecen a una coordinación, incluyendo asesores detectados en grupos de esa coordinación.
 */
async function getAsesoresDeCoordinacion(coordId, extraUserId = null) {
    const ctx = await obtenerContextoCoordinacion(coordId, extraUserId);
    const result = [];
    for (const idStr of ctx.asesorIdsSet) {
        result.push(mongoose.Types.ObjectId.isValid(idStr) ? new mongoose.Types.ObjectId(idStr) : idStr);
    }
    return result;
}

/**
 * Genera la query de MongoDB para Grupos o Clientes filtrados por coordinación.
 */
async function buildFiltroCoordinacion(coordId, specificAsesor = null, extraUserId = null) {
    if (specificAsesor && specificAsesor !== 'todos') {
        const aStr = extraerIdStr(specificAsesor);
        const aIdObj = mongoose.Types.ObjectId.isValid(aStr)
            ? new mongoose.Types.ObjectId(aStr)
            : aStr;
        return {
            $or: [
                { asesor: aStr },
                { asesor: aIdObj }
            ]
        };
    }

    const ctx = await obtenerContextoCoordinacion(coordId, extraUserId);
    if (ctx.coordIdsSet.size === 0 && ctx.asesorIdsSet.size === 0) {
        return {};
    }

    const coordValues = [];
    for (const cId of ctx.coordIdsSet) {
        coordValues.push(cId);
        if (mongoose.Types.ObjectId.isValid(cId)) {
            coordValues.push(new mongoose.Types.ObjectId(cId));
        }
    }

    const asesorValues = [];
    for (const aId of ctx.asesorIdsSet) {
        asesorValues.push(aId);
        if (mongoose.Types.ObjectId.isValid(aId)) {
            asesorValues.push(new mongoose.Types.ObjectId(aId));
        }
    }

    const orConditions = [];
    if (asesorValues.length > 0) {
        orConditions.push({ asesor: { $in: asesorValues } });
    }
    if (coordValues.length > 0) {
        orConditions.push({ coordinacion: { $in: coordValues } });
    }
    if (ctx.grupoIdsSet.size > 0) {
        const gIds = Array.from(ctx.grupoIdsSet);
        orConditions.push({ grupo: { $in: gIds } });
        orConditions.push({ _id: { $in: gIds.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id)) } });
    }

    return orConditions.length > 0 ? { $or: orConditions } : {};
}

module.exports = {
    normalizarRol,
    extraerIdStr,
    normalizarTexto,
    obtenerCoordinacionId,
    obtenerContextoCoordinacion,
    getAsesoresDeCoordinacion,
    buildFiltroCoordinacion
};

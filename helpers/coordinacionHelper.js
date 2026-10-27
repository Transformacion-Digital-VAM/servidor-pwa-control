const mongoose = require('mongoose');
const User = require('../models/User');
const Coordinacion = require('../models/Coordinacion');

/**
 * Obtiene el ID de la coordinación del usuario, usando req.user.coordinacion
 * o buscando por nombre en el modelo Coordinacion si no estuviese seteado.
 */
async function obtenerCoordinacionId(user) {
    if (!user) return null;
    if (user.coordinacion) {
        return user.coordinacion.toString();
    }
    // Fallback: buscar por nombre/username en caso de no venir en el payload
    const query = [];
    if (user.nombre) query.push({ coordinador: user.nombre });
    if (user.username) query.push({ coordinador: user.username });
    if (query.length > 0) {
        const coord = await Coordinacion.findOne({ $or: query }).select('_id').lean();
        if (coord) return coord._id.toString();
    }
    return null;
}

/**
 * Obtiene los IDs de los asesores que pertenecen a una coordinación,
 * incluyendo al propio usuario (si aplica).
 */
async function getAsesoresDeCoordinacion(coordId, extraUserId = null) {
    if (!coordId) return [];
    const coordObj = mongoose.Types.ObjectId.isValid(coordId)
        ? new mongoose.Types.ObjectId(coordId)
        : coordId;

    const asesores = await User.find({ coordinacion: coordObj }).select('_id').lean();
    const asesorIds = asesores.map(a => a._id);

    if (extraUserId) {
        const extraObj = mongoose.Types.ObjectId.isValid(extraUserId)
            ? new mongoose.Types.ObjectId(extraUserId)
            : extraUserId;
        if (!asesorIds.some(id => id.toString() === extraObj.toString())) {
            asesorIds.push(extraObj);
        }
    }

    return asesorIds;
}

/**
 * Genera la query de MongoDB para Grupos o Clientes filtrados por coordinación:
 * Creditos -> Grupo/Cliente -> Asesor -> Coordinacion
 * Busca por asesores asignados a dicha coordinación O directamente por coordinacion si estuviese poblada.
 */
async function buildFiltroCoordinacion(coordId, specificAsesor = null, extraUserId = null) {
    if (specificAsesor && specificAsesor !== 'todos') {
        const aIdObj = mongoose.Types.ObjectId.isValid(specificAsesor)
            ? new mongoose.Types.ObjectId(specificAsesor)
            : specificAsesor;
        return {
            $or: [
                { asesor: specificAsesor },
                { asesor: aIdObj }
            ]
        };
    }

    if (!coordId) return {};

    const coordObj = mongoose.Types.ObjectId.isValid(coordId)
        ? new mongoose.Types.ObjectId(coordId)
        : coordId;

    const asesorIds = await getAsesoresDeCoordinacion(coordId, extraUserId);

    return {
        $or: [
            { asesor: { $in: asesorIds } },
            { coordinacion: coordObj },
            { coordinacion: coordId }
        ]
    };
}

module.exports = {
    obtenerCoordinacionId,
    getAsesoresDeCoordinacion,
    buildFiltroCoordinacion
};

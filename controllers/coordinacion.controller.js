const mongoose = require('mongoose');
const Coordinacion = require('../models/Coordinacion');
const User = require('../models/User');
const { normalizarRol, extraerIdStr, normalizarTexto, obtenerContextoCoordinacion } = require('../helpers/coordinacionHelper');

// Obtener todas las coordinaciones
exports.obtenerCoordinacion = async (req, res) => {
    try {
        const coordinaciones = await Coordinacion.find({}, {
            nombre: 1,
            municipio: 1,
            coordinador: 1,
        }).lean();

        res.json(coordinaciones);
    } catch (error) {
        console.log(error);
        res.status(500).send('Error');
    }
};

// Crear una coordinación
exports.crearCoordinacion = async (req, res) => {
    try {
        const { nombre, municipio, ejecutivas, coordinador } = req.body;

        const nuevaCoordinacion = new Coordinacion({
            nombre,
            municipio,
            ejecutivas,
            coordinador,
        });

        await nuevaCoordinacion.save();

        res.status(201).json({
            mensaje: 'Coordinación creada exitosamente',
            data: nuevaCoordinacion
        });

    } catch (error) {
        console.error('Error al crear coordinación:', error);
        res.status(500).json({ mensaje: 'Error al crear coordinación', error });
    }
};

/**
 * Hidrata el campo coordinacion sin perder el ID original ni el nombre si fue guardado como string.
 */
async function hidratarCoordinacionUsuarios(usuarios) {
    const coordinaciones = await Coordinacion.find({}, { nombre: 1, municipio: 1 }).lean();
    const coordMapById = new Map(coordinaciones.map(c => [String(c._id), c]));
    const coordMapByName = new Map(coordinaciones.map(c => [normalizarTexto(c.nombre), c]));

    return usuarios.map(u => {
        const rawCoordId = extraerIdStr(u.coordinacion);
        let coordData = null;
        if (rawCoordId) {
            coordData = coordMapById.get(rawCoordId)
                || coordMapByName.get(normalizarTexto(rawCoordId))
                || { _id: rawCoordId, nombre: typeof u.coordinacion === 'string' && !mongoose.Types.ObjectId.isValid(rawCoordId) ? rawCoordId : 'Coordinación' };
        }
        return {
            ...u,
            role: normalizarRol(u.role),
            coordinacion: coordData
        };
    });
}

const ROLES_OPERATIVOS = new Set(['asesor', 'master', 'coordinador', 'user']);

exports.obtenerAsesores = async (req, res) => {
    try {
        const todosUsuarios = await User.find({}, {
            username: 1,
            nombre: 1,
            role: 1,
            coordinacion: 1,
            lastLocation: 1,
        }).lean();

        const asesoresRaw = todosUsuarios.filter(u => {
            const rolNorm = normalizarRol(u.role);
            return ROLES_OPERATIVOS.has(rolNorm);
        });

        const asesores = await hidratarCoordinacionUsuarios(asesoresRaw);
        res.json(asesores);
    } catch (error) {
        console.log(error);
        res.status(500).send('Error');
    }
};

exports.obtenerAsesoresCoordinacion = async (req, res) => {
    try {
        const { coordinacion } = req.params;
        const ctx = await obtenerContextoCoordinacion(coordinacion);

        const todosUsuarios = await User.find({}, {
            username: 1,
            nombre: 1,
            role: 1,
            coordinacion: 1,
            lastLocation: 1,
        }).lean();

        const asesoresRaw = todosUsuarios.filter(u => {
            const rolNorm = normalizarRol(u.role);
            if (!ROLES_OPERATIVOS.has(rolNorm)) return false;
            return ctx.coincideCoordinacion(u.coordinacion) || ctx.asesorIdsSet.has(String(u._id));
        });

        const asesores = await hidratarCoordinacionUsuarios(asesoresRaw);
        res.json(asesores);
    } catch (error) {
        console.log(error);
        res.status(500).send('Error');
    }
};

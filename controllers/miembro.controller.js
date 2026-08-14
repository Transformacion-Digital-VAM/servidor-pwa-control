const Miembro = require('../models/Miembro');
const Grupo = require('../models/Grupo');
const { logAccion, logWarn, logError } = require('../utils/loggers');

exports.createMiembro = async (req, res) => {
    try {
        const { nombre, apellidos, grupo, rol, pagoPactado, ciclo } = req.body;

        // Verificar que el grupo exista
        const grupoExiste = await Grupo.findById(grupo);
        if (!grupoExiste) {
            logWarn(req, 'CREAR_MIEMBRO_FALLIDO', 'Grupo no encontrado para el nuevo miembro', { grupo, nombre, apellidos });
            return res.status(404).json({ msg: 'Grupo no encontrado' });
        }

        const nuevoMiembro = new Miembro({
            nombre,
            apellidos,
            grupo,
            rol,
            pagoPactado,
            ciclo
        });

        await nuevoMiembro.save();

        // Agregar el miembro al array de integrantes del grupo para mantener la sincronización
        await Grupo.findByIdAndUpdate(grupo, {
            $addToSet: { integrantes: nuevoMiembro._id }
        });

        logAccion(req, 'CREAR_MIEMBRO', {
            descripcion: `Miembro creado exitosamente: "${nombre} ${apellidos || ''}" en Grupo "${grupoExiste.nombre || grupoExiste.clave || grupo}"`,
            datos: { nombre, apellidos, grupo, rol, pagoPactado, ciclo },
            resultado: { miembroId: nuevoMiembro._id, grupo: grupoExiste.nombre || grupo }
        });

        res.status(201).json(nuevoMiembro);

    } catch (error) {
        logError(req, 'CREAR_MIEMBRO_ERROR', error, { body: req.body });
        res.status(500).json({ msg: 'Error al crear miembro' });
    }
};

exports.getMiembros = async (req, res) => {
    try {
        const miembros = await Miembro.find().populate('grupo');
        res.status(200).json(miembros);
    } catch (error) {
        logError(req, 'GET_MIEMBROS_ERROR', error);
        res.status(500).json({ message: error.message });
    }
}

exports.getMiembroById = async (req, res) => {
    try {
        const miembro = await Miembro.findById(req.params.id).populate('grupo');
        if (!miembro) {
            logWarn(req, 'GET_MIEMBRO_NOT_FOUND', 'Miembro no encontrado por ID', { id: req.params.id });
        }
        res.status(200).json(miembro);
    } catch (error) {
        logError(req, 'GET_MIEMBRO_BY_ID_ERROR', error, { id: req.params.id });
        res.status(500).json({ message: error.message });
    }
}

exports.updateMiembro = async (req, res) => {
    try {
        const { id } = req.params;
        const oldMiembro = await Miembro.findById(id);

        if (!oldMiembro) {
            logWarn(req, 'ACTUALIZAR_MIEMBRO_NOT_FOUND', 'Intento de actualizar miembro inexistente', { id, body: req.body });
            return res.status(404).json({ msg: 'Miembro no encontrado' });
        }

        const updatedMiembro = await Miembro.findByIdAndUpdate(id, req.body, { new: true });

        // Si cambió el grupo, actualizar ambos grupos para mantener la consistencia
        if (req.body.grupo && oldMiembro.grupo && oldMiembro.grupo.toString() !== req.body.grupo.toString()) {
            // Quitar del grupo anterior
            await Grupo.findByIdAndUpdate(oldMiembro.grupo, {
                $pull: { integrantes: id }
            });
            // Agregar al nuevo grupo
            await Grupo.findByIdAndUpdate(req.body.grupo, {
                $addToSet: { integrantes: id }
            });
        }

        logAccion(req, 'ACTUALIZAR_MIEMBRO', {
            descripcion: `Miembro actualizado: "${updatedMiembro.nombre} ${updatedMiembro.apellidos || ''}" (ID: ${id})`,
            datos: { id, cambios: req.body, anteriorGrupo: oldMiembro.grupo },
            resultado: { miembroId: updatedMiembro._id, nombre: updatedMiembro.nombre }
        });

        res.status(200).json(updatedMiembro);
    } catch (error) {
        logError(req, 'ACTUALIZAR_MIEMBRO_ERROR', error, { id: req.params.id, body: req.body });
        res.status(500).json({ message: error.message });
    }
}

exports.deleteMiembro = async (req, res) => {
    try {
        const { id } = req.params;
        const miembro = await Miembro.findByIdAndDelete(id);

        if (!miembro) {
            logWarn(req, 'ELIMINAR_MIEMBRO_NOT_FOUND', 'Intento de eliminar miembro inexistente', { id });
            return res.status(404).json({ msg: 'Miembro no encontrado' });
        }

        // Eliminar el miembro del array de integrantes del grupo al que pertenecía
        if (miembro.grupo) {
            await Grupo.findByIdAndUpdate(miembro.grupo, {
                $pull: { integrantes: id }
            });
        }

        logAccion(req, 'ELIMINAR_MIEMBRO', {
            descripcion: `Miembro eliminado: "${miembro.nombre} ${miembro.apellidos || ''}" (ID: ${id})`,
            datos: { id },
            resultado: { miembroEliminado: miembro.nombre, grupoId: miembro.grupo }
        });

        res.status(200).json({ msg: 'Miembro eliminado correctamente', miembro });
    } catch (error) {
        logError(req, 'ELIMINAR_MIEMBRO_ERROR', error, { id: req.params.id });
        res.status(500).json({ message: error.message });
    }
}
const Miembro = require('../models/Miembro');
const Grupo = require('../models/Grupo');

exports.createMiembro = async (req, res) => {
    try {
        const { nombre, apellidos, grupo, rol, pagoPactado } = req.body;

        // Verificar que el grupo exista
        const grupoExiste = await Grupo.findById(grupo);
        if (!grupoExiste) {
            return res.status(404).json({ msg: 'Grupo no encontrado' });
        }

        const nuevoMiembro = new Miembro({
            nombre,
            apellidos,
            grupo,
            rol,
            pagoPactado
        });

        await nuevoMiembro.save();

        // Agregar el miembro al array de integrantes del grupo para mantener la sincronización
        await Grupo.findByIdAndUpdate(grupo, {
            $addToSet: { integrantes: nuevoMiembro._id }
        });

        res.status(201).json(nuevoMiembro);

    } catch (error) {
        console.error(error);
        res.status(500).json({ msg: 'Error al crear miembro' });
    }
};

exports.getMiembros = async (req, res) => {
    try {
        const miembros = await Miembro.find().populate('grupo');
        res.status(200).json(miembros);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.getMiembroById = async (req, res) => {
    try {
        const miembro = await Miembro.findById(req.params.id).populate('grupo');
        res.status(200).json(miembro);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.updateMiembro = async (req, res) => {
    try {
        const { id } = req.params;
        const oldMiembro = await Miembro.findById(id);
        const updatedMiembro = await Miembro.findByIdAndUpdate(id, req.body, { new: true });

        if (!updatedMiembro) {
            return res.status(404).json({ msg: 'Miembro no encontrado' });
        }

        // Si cambió el grupo, actualizar ambos grupos para mantener la consistencia
        if (oldMiembro && req.body.grupo && oldMiembro.grupo.toString() !== req.body.grupo.toString()) {
            // Quitar del grupo anterior
            await Grupo.findByIdAndUpdate(oldMiembro.grupo, {
                $pull: { integrantes: id }
            });
            // Agregar al nuevo grupo
            await Grupo.findByIdAndUpdate(req.body.grupo, {
                $addToSet: { integrantes: id }
            });
        }

        res.status(200).json(updatedMiembro);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.deleteMiembro = async (req, res) => {
    try {
        const { id } = req.params;
        const miembro = await Miembro.findByIdAndDelete(id);

        if (!miembro) {
            return res.status(404).json({ msg: 'Miembro no encontrado' });
        }

        // Eliminar el miembro del array de integrantes del grupo al que pertenecía
        await Grupo.findByIdAndUpdate(miembro.grupo, {
            $pull: { integrantes: id }
        });

        res.status(200).json({ msg: 'Miembro eliminado correctamente', miembro });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}
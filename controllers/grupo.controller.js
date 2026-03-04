const Grupo = require('../models/Grupo');

exports.createGrupo = async (req, res) => {
    try {
        // Solo el Admin puede crear grupos
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "No tienes permisos para crear grupos" });
        }

        const grupo = new Grupo(req.body);
        await grupo.save();
        res.status(201).json(grupo);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.getGrupos = async (req, res) => {
    try {
        let query = {};

        // Filtro estricto por roles para el listado
        if (req.user.role === 'asesor') {
            // El asesor SOLÓ ve sus propios grupos
            query = { asesor: req.user.id };
        } else if (req.user.role === 'coordinador') {
            // El coordinador ve TODO lo de su coordinación
            query = { coordinacion: req.user.coordinacion };
        }
        // Si es admin, query = {} (ve todo)

        const grupos = await Grupo.find(query)
            .populate('asesor', 'username')
            .populate('coordinacion', 'nombre')
            .populate('integrantes');

        res.status(200).json(grupos);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.getGrupoById = async (req, res) => {
    try {
        const grupo = await Grupo.findById(req.params.id)
            .populate('integrantes')
            .populate('asesor', 'username')
            .populate('coordinacion', 'nombre');

        if (!grupo) return res.status(404).json({ message: "Grupo no encontrado" });

        // Verificación de seguridad individual (por si intentan entrar por ID directo)
        if (req.user.role === 'asesor' && grupo.asesor._id.toString() !== req.user.id) {
            return res.status(403).json({ message: "No tienes permiso para ver este grupo" });
        }

        if (req.user.role === 'coordinador' && grupo.coordinacion._id.toString() !== req.user.coordinacion) {
            return res.status(403).json({ message: "Este grupo no pertenece a tu coordinación" });
        }

        res.status(200).json(grupo);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.updateGrupo = async (req, res) => {
    try {
        // Solo el Admin puede editar grupos
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "Solo el administrador puede editar grupos" });
        }

        const grupo = await Grupo.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.status(200).json(grupo);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.deleteGrupo = async (req, res) => {
    try {
        // Solo el Admin puede eliminar grupos
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "Solo el administrador puede eliminar grupos" });
        }

        const grupo = await Grupo.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Grupo eliminado con éxito", grupo });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

const Grupo = require('../models/Grupo');
const Credito = require('../models/Credito');

exports.createGrupo = async (req, res) => {
    try {
        // Solo el Admin, master o superadmin pueden crear grupos
        if (!['admin', 'master', 'superadmin'].includes(req.user.role)) {
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
            .populate('asesor', 'username nombre')
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
            .populate('asesor', 'username nombre')
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

exports.getGruposPorCoordinacion = async (req, res) => {
    try {
        const { coordinacion } = req.params;
        const grupos = await Grupo.find({ coordinacion: coordinacion })
            .populate('asesor', 'username nombre')
            .populate('coordinacion', 'nombre')
            .populate('integrantes');

        res.status(200).json(grupos);
    } catch (error) {
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
        res.status(500).json({ message: error.message });
    }
}

exports.updateGrupo = async (req, res) => {
    try {
        // Solo el Admin, master o superadmin pueden editar grupos
        if (!['admin', 'master', 'superadmin'].includes(req.user.role)) {
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
        // Solo el Admin, master o superadmin pueden eliminar grupos
        if (!['admin', 'master', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ message: "Solo el administrador puede eliminar grupos" });
        }

        const grupo = await Grupo.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Grupo eliminado con éxito", grupo });
    } catch (error) {
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
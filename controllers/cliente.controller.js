const Cliente = require('../models/Cliente');
const Usuario = require('../models/User');
const Credito = require('../models/Credito');

exports.createCliente = async (req, res) => {
    try {
        if (!['admin', 'master', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ message: "No tienes permisos para crear clientes" });
        }
        const cliente = new Cliente(req.body);
        await cliente.save();
        res.status(201).json(cliente);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.getCliente = async (req, res) => {
    try {
        let query = {};
        if (req.user.role === 'asesor') {
            query = { asesor: req.user.id };
        } else if (req.user.role === 'coordinador') {
            query = { coordinacion: req.user.coordinacion };
        }
        const cliente = await Cliente.find(query).populate('coordinacion', 'nombre').populate('asesor', 'username nombre');
        res.status(200).json(cliente);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.getClientePorId = async (req, res) => {
    try {
        if (!['admin', 'master', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ message: "No tienes permisos para obtener clientes" });
        }
        const cliente = await Cliente.findById(req.params.id);
        res.status(200).json(cliente);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.updateCliente = async (req, res) => {
    try {
        if (!['admin', 'master', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ message: "No tienes permisos para actualizar clientes" });
        }
        const cliente = await Cliente.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.status(200).json(cliente);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

exports.deleteCliente = async (req, res) => {
    try {
        if (!['admin', 'master', 'superadmin'].includes(req.user.role)) {
            return res.status(403).json({ message: "No tienes permisos para eliminar clientes" });
        }
        const cliente = await Cliente.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Cliente eliminado con éxito", cliente });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}


exports.getClientesMaster = async (req, res) => {
    try {

        // Obtener los ids de los usuarios master
        const masters = await Usuario.find(
            { role: 'master' },
            '_id'
        );

        const idsMasters = masters.map(master => master._id);

        // Buscar clientes cuyo asesor sea un master
        const clientes = await Cliente.find({
            asesor: { $in: idsMasters }
        }).populate('asesor', 'nombre username');

        res.status(200).json({
            success: true,
            data: clientes
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.getMiembrosGrupoConCreditoIndividual = async (req, res) => {
    const Cliente = require('../models/Cliente');
    const Grupo = require('../models/Grupo');
    const Credito = require('../models/Credito');

    try {
        const { estado = 'Activo', grupoId } = req.query;

        // 1. Obtener el grupo si se pasa grupoId para filtrar
        let grupoEspecifico = null;
        if (grupoId) {
            grupoEspecifico = await Grupo.findById(grupoId).lean();
            if (!grupoEspecifico) {
                return res.status(200).json({ success: true, total: 0, data: [] });
            }
        }

        // 2. Buscar créditos individuales
        const creditoQuery = {
            tipoCredito: 'Individual',
            ...(estado ? { estado } : {})
        };

        const creditosInd = await Credito.find(creditoQuery)
            .populate('cliente')
            .lean();

        // 3. Filtrar aquellos donde el cliente tiene un grupo asignado
        // y que coincida con el grupo solicitado (si se aplica)
        const creditosConGrupo = creditosInd.filter(c => {
            const cliente = c.cliente;
            if (!cliente || !cliente.grupo || cliente.grupo.trim() === '' || cliente.grupo.trim().toUpperCase() === 'N/A') {
                return false;
            }
            if (grupoEspecifico) {
                // Comparamos el string cliente.grupo con el nombre del grupo
                return cliente.grupo.trim().toUpperCase() === grupoEspecifico.nombre.trim().toUpperCase();
            }
            return true;
        });

        if (creditosConGrupo.length === 0) {
            return res.status(200).json({ success: true, total: 0, data: [] });
        }

        // 4. Obtener todos los grupos únicos referenciados en cliente.grupo
        const nombresGrupos = [...new Set(creditosConGrupo.map(c => c.cliente.grupo.trim().toUpperCase()))];
        
        // Obtener la información completa de estos grupos
        // Como el nombre puede variar en mayúsculas/minúsculas, usamos regex
        const gruposInfo = await Grupo.find({
            nombre: { $in: nombresGrupos.map(n => new RegExp(`^${n}$`, 'i')) }
        })
        .populate('asesor', 'username nombre')
        .populate('coordinacion', 'nombre')
        .lean();

        // Crear mapa para fácil acceso
        const gruposInfoMap = new Map();
        for (const g of gruposInfo) {
            gruposInfoMap.set(g.nombre.trim().toUpperCase(), g);
        }

        // 5. Agrupar la respuesta
        const gruposMap = new Map();

        for (const credito of creditosConGrupo) {
            const nombreGrupoCliente = credito.cliente.grupo.trim().toUpperCase();
            const grupo = gruposInfoMap.get(nombreGrupoCliente);
            
            // Si no se encuentra en la BD el grupo con ese nombre, nos lo saltamos
            if (!grupo) continue;
            
            const gId = grupo._id.toString();

            if (!gruposMap.has(gId)) {
                gruposMap.set(gId, {
                    _id: grupo._id,
                    nombre: grupo.nombre,
                    clave: grupo.clave,
                    diaVisita: grupo.diaVisita,
                    horaVisita: grupo.horaVisita,
                    asesor: grupo.asesor,
                    coordinacion: grupo.coordinacion,
                    integrantes: []
                });
            }

            gruposMap.get(gId).integrantes.push({
                _id: credito.cliente._id,
                nombre: credito.cliente.nombre,
                // Algunos campos vienen de la versión de Cliente en vez de Miembro
                creditoIndividual: {
                    _id: credito._id,
                    ciclo: credito.ciclo,
                    semanaActual: credito.semanaActual,
                    tipoCredito: credito.tipoCredito,
                    montoSolicitado: credito.montoSolicitado,
                    saldoPendiente: credito.saldoPendiente,
                    pagoPactado: credito.pagoPactado,
                    estado: credito.estado
                }
            });
        }

        return res.status(200).json({
            success: true,
            total: gruposMap.size,
            data: Array.from(gruposMap.values())
        });

    } catch (error) {
        console.error('Error al obtener miembros de grupo con crédito individual:', error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
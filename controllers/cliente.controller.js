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
    const Credito = require('../models/Credito');

    try {
        const { estado = 'Activo', grupoId } = req.query;

        // Buscar créditos individuales con el estado solicitado
        const creditoQuery = {
            tipoCredito: 'Individual',
            ...(estado ? { estado } : {})
        };

        const creditosInd = await Credito.find(creditoQuery)
            .populate('cliente')
            .lean();

        // Filtrar solo aquellos cuyo cliente tenga un grupo asignado (no vacío ni N/A)
        const resultado = creditosInd
            .filter(c => {
                const cliente = c.cliente;
                if (!cliente) return false;
                if (!cliente.grupo || cliente.grupo.trim() === '' || cliente.grupo.trim().toUpperCase() === 'N/A') return false;
                if (grupoId) return cliente.grupo.trim().toUpperCase() === grupoId.trim().toUpperCase();
                return true;
            })
            .map(c => ({
                _id: c.cliente._id,
                nombre: c.cliente.nombre,
                grupo: c.cliente.grupo,
                diaPago: c.cliente.diaPago,
                tipoPago: c.cliente.tipoPago,
                creditoIndividual: {
                    _id: c._id,
                    ciclo: c.ciclo,
                    semanaActual: c.semanaActual,
                    montoSolicitado: c.montoSolicitado,
                    pagoPactado: c.pagoPactado,
                    saldoPendiente: c.saldoPendiente,
                    estado: c.estado
                }
            }));

        return res.status(200).json({
            success: true,
            total: resultado.length,
            data: resultado
        });

    } catch (error) {
        console.error('Error al obtener miembros de grupo con crédito individual:', error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

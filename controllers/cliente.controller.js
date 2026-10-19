const Cliente = require('../models/Cliente');
const Usuario = require('../models/User');
const Credito = require('../models/Credito');
const { logAccion, logWarn, logError } = require('../utils/loggers');

exports.createCliente = async (req, res) => {
    try {
        const userRole = req.user?.role;
        if (!['admin', 'master', 'superadmin'].includes(userRole)) {
            logWarn(req, 'CREAR_CLIENTE_DENEGADO', `Permisos insuficientes para crear cliente (Rol: ${userRole})`, { body: req.body });
            return res.status(403).json({ message: "No tienes permisos para crear clientes" });
        }

        const cliente = new Cliente(req.body);
        await cliente.save();

        logAccion(req, 'CREAR_CLIENTE', {
            descripcion: `Cliente creado: "${cliente.nombre}" (ID: ${cliente._id})`,
            datos: req.body,
            resultado: { clienteId: cliente._id, nombre: cliente.nombre, asesor: cliente.asesor, grupo: cliente.grupo }
        });

        res.status(201).json(cliente);
    } catch (error) {
        logError(req, 'CREAR_CLIENTE_ERROR', error, { body: req.body });
        res.status(500).json({ message: error.message });
    }
}

exports.getCliente = async (req, res) => {
    try {
        let query = {};
        const mongoose = require('mongoose');
        const role = req.user?.role ? req.user.role.toLowerCase() : '';
        const userId = req.user?.id;

        // 1. Filtrado por asesor explícito en query o por rol
        if (req.query.asesor && req.query.asesor !== 'todos') {
            const aId = req.query.asesor;
            const aIdObj = mongoose.Types.ObjectId.isValid(aId) ? new mongoose.Types.ObjectId(aId) : aId;
            query = {
                $or: [
                    { asesor: aId },
                    ...(mongoose.Types.ObjectId.isValid(aId) ? [{ asesor: aIdObj }] : [])
                ]
            };
        } else if (role === 'asesor') {
            query = {
                $or: [
                    { asesor: userId },
                    ...(mongoose.Types.ObjectId.isValid(userId) ? [{ asesor: new mongoose.Types.ObjectId(userId) }] : [])
                ]
            };
        } else if (role === 'master' && req.query.todos !== 'true' && req.query.admin !== 'true') {
            // En panel de asesor, master solo consulta sus clientes asignados
            query = {
                $or: [
                    { asesor: userId },
                    ...(mongoose.Types.ObjectId.isValid(userId) ? [{ asesor: new mongoose.Types.ObjectId(userId) }] : [])
                ]
            };
        } else if (role === 'coordinador' && req.user.coordinacion) {
            query = { coordinacion: req.user.coordinacion };
        }

        const clientes = await Cliente.find(query)
            .select({
                nombre: 1,
                grupo: 1,
                horaVisita: 1,
                diaPago: 1,
                tipoPago: 1,
                coordinacion: 1,
                asesor: 1,
                clave: 1
            })
            .populate('coordinacion', 'nombre')
            .populate('asesor', 'username nombre')
            .lean();

        // Si se solicita adjuntar el crédito activo (optimización masiva: 1 sola petición)
        if (req.query.conCredito === 'true') {
            const clienteIds = clientes.map(c => c._id);
            const creditos = await Credito.find({
                cliente: { $in: clienteIds },
                tipoCredito: 'Individual'
            }).select({
                cliente: 1,
                pagoPactado: 1,
                saldoTotal: 1,
                saldoPendiente: 1,
                estado: 1,
                semanaActual: 1,
                semanas: 1,
                esRefill: 1,
                tipoCredito: 1,
                garantia: 1,
                fechaPrimerPago: 1,
                'pagos.fechaPago': 1,
                'pagos.numeroPago': 1,
                'pagos.montoPagado': 1,
                'pagos.numeroRecibo': 1
            }).sort({ ciclo: -1, createdAt: -1 }).lean();

            const creditosMap = new Map();
            for (const cred of creditos) {
                const k = cred.cliente.toString();
                if (!creditosMap.has(k)) {
                    creditosMap.set(k, []);
                }
                creditosMap.get(k).push(cred);
            }

            const hoy = new Date();
            const year = hoy.getFullYear();
            const month = String(hoy.getMonth() + 1).padStart(2, '0');
            const day = String(hoy.getDate()).padStart(2, '0');
            const hoyIsoPrefix = `${year}-${month}-${day}`;

            clientes.forEach(c => {
                const arr = creditosMap.get(c._id.toString()) || [];
                const creditoActivo = arr.find(cr => cr.estado === 'Activo') || arr[0] || null;
                c.creditoActivo = creditoActivo;
                c.montoPactado = creditoActivo ? creditoActivo.pagoPactado : 0;

                let tienePagoHoy = false;
                if (creditoActivo && creditoActivo.pagos) {
                    tienePagoHoy = creditoActivo.pagos.some(p => p.fechaPago && p.fechaPago.toString().startsWith(hoyIsoPrefix));
                }
                c.tienePagoHoy = tienePagoHoy;
                const estado = creditoActivo ? (creditoActivo.estado || 'Activo') : 'Sin Crédito';
                c.estadoFiltro = estado === 'Liquidado' ? 'Liquidados' : (estado === 'Sin Crédito' ? 'Todos' : 'Activos');
                c.diaVisitaStr = c.diaPago ? c.diaPago.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : '';
            });
        }

        res.status(200).json(clientes);
    } catch (error) {
        logError(req, 'GET_CLIENTES_ERROR', error);
        res.status(500).json({ message: error.message });
    }
};

exports.getClientePorId = async (req, res) => {
    try {
        const userRole = req.user?.role?.toLowerCase();
        if (!['admin', 'master', 'superadmin', 'lector', 'asesor', 'coordinador'].includes(userRole)) {
            logWarn(req, 'GET_CLIENTE_POR_ID_DENEGADO', `Permisos insuficientes para consultar cliente (Rol: ${userRole})`, { id: req.params.id });
            return res.status(403).json({ message: "No tienes permisos para obtener clientes" });
        }
        const cliente = await Cliente.findById(req.params.id)
            .populate('coordinacion', 'nombre')
            .populate('asesor', 'username nombre')
            .lean();
        if (!cliente) {
            logWarn(req, 'GET_CLIENTE_NOT_FOUND', 'Cliente no encontrado por ID', { id: req.params.id });
            return res.status(404).json({ message: "Cliente no encontrado" });
        }
        res.status(200).json(cliente);
    } catch (error) {
        logError(req, 'GET_CLIENTE_POR_ID_ERROR', error, { id: req.params.id });
        res.status(500).json({ message: error.message });
    }
};

exports.updateCliente = async (req, res) => {
    try {
        const userRole = req.user?.role;
        if (!['admin', 'master', 'superadmin'].includes(userRole)) {
            logWarn(req, 'ACTUALIZAR_CLIENTE_DENEGADO', `Permisos insuficientes para actualizar cliente (Rol: ${userRole})`, { id: req.params.id });
            return res.status(403).json({ message: "No tienes permisos para actualizar clientes" });
        }
        const cliente = await Cliente.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!cliente) {
            logWarn(req, 'ACTUALIZAR_CLIENTE_NOT_FOUND', 'Intento de actualizar cliente inexistente', { id: req.params.id, body: req.body });
            return res.status(404).json({ message: "Cliente no encontrado" });
        }

        logAccion(req, 'ACTUALIZAR_CLIENTE', {
            descripcion: `Cliente actualizado: "${cliente.nombre}" (ID: ${cliente._id})`,
            datos: { id: req.params.id, cambios: req.body },
            resultado: { clienteId: cliente._id, nombre: cliente.nombre }
        });

        res.status(200).json(cliente);
    } catch (error) {
        logError(req, 'ACTUALIZAR_CLIENTE_ERROR', error, { id: req.params.id, body: req.body });
        res.status(500).json({ message: error.message });
    }
}

exports.deleteCliente = async (req, res) => {
    try {
        const userRole = req.user?.role;
        if (!['admin', 'master', 'superadmin'].includes(userRole)) {
            logWarn(req, 'ELIMINAR_CLIENTE_DENEGADO', `Permisos insuficientes para eliminar cliente (Rol: ${userRole})`, { id: req.params.id });
            return res.status(403).json({ message: "No tienes permisos para eliminar clientes" });
        }
        const cliente = await Cliente.findByIdAndDelete(req.params.id);
        if (!cliente) {
            logWarn(req, 'ELIMINAR_CLIENTE_NOT_FOUND', 'Intento de eliminar cliente inexistente', { id: req.params.id });
            return res.status(404).json({ message: "Cliente no encontrado" });
        }

        logAccion(req, 'ELIMINAR_CLIENTE', {
            descripcion: `Cliente eliminado: "${cliente.nombre}" (ID: ${cliente._id})`,
            datos: { id: req.params.id },
            resultado: { clienteEliminado: cliente.nombre }
        });

        res.status(200).json({ message: "Cliente eliminado con éxito", cliente });
    } catch (error) {
        logError(req, 'ELIMINAR_CLIENTE_ERROR', error, { id: req.params.id });
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
        logError(req, 'GET_CLIENTES_MASTER_ERROR', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.getMiembrosGrupoConCreditoIndividual = async (req, res) => {
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
        logError(req, 'GET_MIEMBROS_GRUPO_CON_CREDITO_INDIVIDUAL_ERROR', error, { query: req.query });
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
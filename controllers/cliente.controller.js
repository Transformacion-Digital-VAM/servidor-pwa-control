const Cliente = require('../models/Cliente');
const Usuario = require('../models/User');
const Credito = require('../models/Credito');
const Grupo = require('../models/Grupo');
const Miembro = require('../models/Miembro');
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

        if (req.user && req.user.role && req.user.role.toLowerCase() === 'asesor') {
            const userId = req.user.id;
            query = {
                $or: [
                    { asesor: userId },
                    ...(mongoose.Types.ObjectId.isValid(userId) ? [{ asesor: new mongoose.Types.ObjectId(userId) }] : [])
                ]
            };
        } else if (req.user && req.user.role && req.user.role.toLowerCase() === 'coordinador') {
            query = { coordinacion: req.user.coordinacion };
        }
        const cliente = await Cliente.find(query).populate('coordinacion', 'nombre').populate('asesor', 'username nombre').lean();
        res.status(200).json(cliente);
    } catch (error) {
        logError(req, 'GET_CLIENTES_ERROR', error);
        res.status(500).json({ message: error.message });
    }
}

exports.getClientePorId = async (req, res) => {
    try {
        const userRole = req.user?.role;
        if (!['admin', 'master', 'superadmin', 'lector'].includes(userRole)) {
            logWarn(req, 'GET_CLIENTE_POR_ID_DENEGADO', `Permisos insuficientes para consultar cliente (Rol: ${userRole})`, { id: req.params.id });
            return res.status(403).json({ message: "No tienes permisos para obtener clientes" });
        }
        const cliente = await Cliente.findById(req.params.id);
        if (!cliente) {
            logWarn(req, 'GET_CLIENTE_NOT_FOUND', 'Cliente no encontrado por ID', { id: req.params.id });
        }
        res.status(200).json(cliente);
    } catch (error) {
        logError(req, 'GET_CLIENTE_POR_ID_ERROR', error, { id: req.params.id });
        res.status(500).json({ message: error.message });
    }
}

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
            .populate({
                path: 'cliente',
                populate: [
                    {
                        path: 'asesor',
                        select: '_id username nombre coordinacion',
                        populate: { path: 'coordinacion', select: '_id nombre' }
                    },
                    { path: 'coordinacion', select: '_id nombre' }
                ]
            })
            .lean();

        // Filtrar solo aquellos cuyo cliente tenga un grupo asignado (no vacío ni N/A)
        const creditosFiltrados = creditosInd
            .filter(c => {
                const cliente = c.cliente;
                if (!cliente) return false;
                if (!cliente.grupo || cliente.grupo.trim() === '' || cliente.grupo.trim().toUpperCase() === 'N/A' || cliente.grupo.trim().toUpperCase() === "N/A C.C.") return false;
                return true;
            });

        // Detectar si algún cliente tiene un ObjectId en el campo grupo para buscar su nombre
        const grupoIds = [];
        for (const c of creditosFiltrados) {
            const g = c.cliente?.grupo?.trim();
            if (g && /^[0-9a-fA-F]{24}$/.test(g)) {
                grupoIds.push(g);
            }
        }

        const gruposMap = new Map();
        if (grupoIds.length > 0) {
            const gruposDocs = await Grupo.find({ _id: { $in: grupoIds } }).select('_id nombre').lean();
            for (const gr of gruposDocs) {
                gruposMap.set(String(gr._id), gr.nombre);
            }
        }

        const resultado = creditosFiltrados
            .filter(c => {
                if (!grupoId) return true;
                const cliente = c.cliente;
                const grupoRaw = cliente.grupo?.trim() || '';
                const nombreGrupo = gruposMap.get(grupoRaw) || grupoRaw;
                const target = grupoId.trim().toUpperCase();
                return grupoRaw.toUpperCase() === target || nombreGrupo.toUpperCase() === target;
            })
            .map(c => {
                const cliente = c.cliente;
                const coord = cliente.coordinacion || cliente.asesor?.coordinacion || null;
                const asesor = cliente.asesor ? {
                    _id: cliente.asesor._id,
                    username: cliente.asesor.username,
                    nombre: cliente.asesor.nombre,
                    coordinacion: cliente.asesor.coordinacion ? (cliente.asesor.coordinacion._id || cliente.asesor.coordinacion) : null
                } : null;

                const grupoRaw = cliente.grupo?.trim() || '';
                const nombreGrupo = gruposMap.get(grupoRaw) || grupoRaw;

                return {
                    _id: cliente._id,
                    nombre: cliente.nombre,
                    grupo: nombreGrupo,
                    diaPago: cliente.diaPago,
                    tipoPago: cliente.tipoPago,
                    asesor: asesor,
                    coordinacion: coord,
                    creditoIndividual: {
                        _id: c._id,
                        ciclo: c.ciclo,
                        semanaActual: c.semanaActual,
                        montoSolicitado: c.montoSolicitado,
                        pagoPactado: c.pagoPactado,
                        saldoPendiente: c.saldoPendiente,
                        estado: c.estado
                    }
                };
            });

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





/**
 * Obtiene los grupos cuyos integrantes tengan un crédito individual
 * o se encuentren registrados como clientes y como miembros.
 */
exports.getGruposConMiembrosClientes = async (req, res) => {
    try {
        const {
            estadoCredito,
            soloCreditoActivo,
            soloConCredito,
            grupoId,
            coordinacion,
            asesor
        } = req.query;

        const mongoose = require('mongoose');

        // 1. Filtro base de grupos (compatible con roles de req.user y query params)
        let filtroGrupo = {};

        if (req.user && req.user.role) {
            const role = req.user.role.toLowerCase();
            if (role === 'asesor') {
                const userId = req.user.id;
                filtroGrupo.$or = [
                    { asesor: userId },
                    ...(mongoose.Types.ObjectId.isValid(userId) ? [{ asesor: new mongoose.Types.ObjectId(userId) }] : [])
                ];
            } else if (role === 'coordinador' && req.user.coordinacion) {
                filtroGrupo.coordinacion = req.user.coordinacion;
            }
        }

        if (coordinacion && mongoose.Types.ObjectId.isValid(coordinacion)) {
            filtroGrupo.coordinacion = new mongoose.Types.ObjectId(coordinacion);
        }
        if (asesor && mongoose.Types.ObjectId.isValid(asesor)) {
            filtroGrupo.asesor = new mongoose.Types.ObjectId(asesor);
        }
        if (grupoId) {
            const trimmed = grupoId.trim();
            if (mongoose.Types.ObjectId.isValid(trimmed) && /^[0-9a-fA-F]{24}$/.test(trimmed)) {
                filtroGrupo._id = new mongoose.Types.ObjectId(trimmed);
            } else {
                filtroGrupo.nombre = new RegExp(`^${trimmed}$`, 'i');
            }
        }

        // 2. Traer grupos con sus integrantes (Miembros)
        const grupos = await Grupo.find(filtroGrupo)
            .populate('coordinacion', '_id nombre')
            .populate('asesor', '_id username nombre')
            .populate({
                path: 'integrantes',
                select: '_id nombre apellidos rol grupo ciclo'
            })
            .lean();

        if (!grupos || grupos.length === 0) {
            return res.status(200).json({
                success: true,
                totalGrupos: 0,
                totalMiembrosClientes: 0,
                data: []
            });
        }

        // 3. Traer todos los clientes (con asesor y coordinación)
        const clientes = await Cliente.find()
            .populate('coordinacion', '_id nombre')
            .populate('asesor', '_id username nombre')
            .lean();

        // 4. Traer créditos individuales
        const creditoQuery = { tipoCredito: 'Individual' };
        if (estadoCredito && estadoCredito.toLowerCase() !== 'todos' && estadoCredito.toLowerCase() !== 'all') {
            creditoQuery.estado = estadoCredito;
        }

        const creditosInd = await Credito.find(creditoQuery)
            .select('_id cliente miembro ciclo semanaActual semanas montoSolicitado pagoPactado saldoPendiente saldoTotal estado fechaPrimerPago createdAt')
            .sort({ ciclo: -1, createdAt: -1 })
            .lean();

        // 5. Indexar créditos por cliente y por miembro
        const creditosPorCliente = new Map();
        const creditosPorMiembro = new Map();

        for (const c of creditosInd) {
            if (c.cliente) {
                const cId = String(c.cliente._id || c.cliente);
                if (!creditosPorCliente.has(cId)) creditosPorCliente.set(cId, []);
                creditosPorCliente.get(cId).push(c);
            }
            if (c.miembro) {
                const mId = String(c.miembro._id || c.miembro);
                if (!creditosPorMiembro.has(mId)) creditosPorMiembro.set(mId, []);
                creditosPorMiembro.get(mId).push(c);
            }
        }

        // 6. Normalizador de cadenas para matching flexible (ignora acentos, mayúsculas y espacios extras)
        const normalizeText = (text) => {
            if (!text || typeof text !== 'string') return '';
            return text
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s]/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        };

        // 7. Indexar clientes por nombre normalizado y por grupo asignado (ID o nombre)
        const clientesPorNombre = new Map();
        const clientesPorGrupoKey = new Map();

        for (const cl of clientes) {
            const normNombre = normalizeText(cl.nombre);
            if (normNombre) {
                if (!clientesPorNombre.has(normNombre)) clientesPorNombre.set(normNombre, []);
                clientesPorNombre.get(normNombre).push(cl);
            }

            const rawGrupo = cl.grupo?.trim();
            if (rawGrupo && rawGrupo.toUpperCase() !== 'N/A' && rawGrupo.toUpperCase() !== 'N/A C.C.') {
                if (/^[0-9a-fA-F]{24}$/.test(rawGrupo)) {
                    const key = `id:${rawGrupo.toLowerCase()}`;
                    if (!clientesPorGrupoKey.has(key)) clientesPorGrupoKey.set(key, []);
                    clientesPorGrupoKey.get(key).push(cl);
                } else {
                    const key = `name:${normalizeText(rawGrupo)}`;
                    if (!clientesPorGrupoKey.has(key)) clientesPorGrupoKey.set(key, []);
                    clientesPorGrupoKey.get(key).push(cl);
                }
            }
        }

        // 8. Cruzar información grupo por grupo
        const isSoloCreditoActivo = soloCreditoActivo === 'true' || soloCreditoActivo === true;
        const isSoloConCredito = soloConCredito === 'true' || soloConCredito === true;

        const gruposResultado = [];

        for (const grupo of grupos) {
            const grupoIdStr = String(grupo._id).toLowerCase();
            const grupoNombreNorm = normalizeText(grupo.nombre);
            const grupoClaveNorm = normalizeText(grupo.clave);

            // Clientes explícitamente asignados a este grupo mediante el campo "grupo"
            const clientesAsignados = [
                ...(clientesPorGrupoKey.get(`id:${grupoIdStr}`) || []),
                ...(clientesPorGrupoKey.get(`name:${grupoNombreNorm}`) || []),
                ...(grupoClaveNorm ? (clientesPorGrupoKey.get(`name:${grupoClaveNorm}`) || []) : [])
            ];

            const clientesAsignadosMap = new Map();
            for (const cl of clientesAsignados) {
                clientesAsignadosMap.set(String(cl._id), cl);
            }

            const miembrosClientes = [];
            const clientesProcesadosIds = new Set();
            const miembrosProcesadosIds = new Set();

            const integrantes = Array.isArray(grupo.integrantes) ? grupo.integrantes : [];

            // A. Revisar integrantes registrados en el grupo
            for (const miembro of integrantes) {
                if (!miembro || !miembro._id) continue;
                const miembroIdStr = String(miembro._id);
                const nombreCompletoMiembro = `${miembro.nombre || ''} ${miembro.apellidos || ''}`.trim();
                const normNombreMiembro = normalizeText(nombreCompletoMiembro);

                // Buscar cliente coincidente (primero entre los asignados al grupo, luego global por nombre)
                let clienteMatch = null;
                for (const cl of clientesAsignadosMap.values()) {
                    if (normalizeText(cl.nombre) === normNombreMiembro) {
                        clienteMatch = cl;
                        break;
                    }
                }

                if (!clienteMatch && clientesPorNombre.has(normNombreMiembro)) {
                    const candidatos = clientesPorNombre.get(normNombreMiembro);
                    clienteMatch = candidatos.find(c => {
                        const g = c.grupo?.trim();
                        if (!g) return false;
                        return /^[0-9a-fA-F]{24}$/.test(g)
                            ? g.toLowerCase() === grupoIdStr
                            : normalizeText(g) === grupoNombreNorm;
                    }) || candidatos[0];
                }

                // Créditos individuales de este miembro / cliente
                const creditosCliente = clienteMatch ? (creditosPorCliente.get(String(clienteMatch._id)) || []) : [];
                const creditosMiembro = creditosPorMiembro.get(miembroIdStr) || [];

                const credMap = new Map();
                for (const c of [...creditosCliente, ...creditosMiembro]) {
                    credMap.set(String(c._id), c);
                }
                const todosCreditos = Array.from(credMap.values());
                const tieneCredito = todosCreditos.length > 0;
                const creditoActivo = todosCreditos.find(c => c.estado === 'Activo') || null;

                // Califica si está registrado como cliente O si tiene un crédito individual
                if (clienteMatch || tieneCredito) {
                    miembrosProcesadosIds.add(miembroIdStr);
                    if (clienteMatch) clientesProcesadosIds.add(String(clienteMatch._id));

                    miembrosClientes.push({
                        miembroId: miembro._id,
                        nombre: miembro.nombre,
                        apellidos: miembro.apellidos,
                        nombreCompleto: nombreCompletoMiembro,
                        rol: miembro.rol,
                        ciclo: miembro.ciclo,
                        esMiembroRegistrado: true,
                        esCliente: !!clienteMatch,
                        cliente: clienteMatch ? {
                            _id: clienteMatch._id,
                            nombre: clienteMatch.nombre,
                            grupo: clienteMatch.grupo,
                            diaPago: clienteMatch.diaPago,
                            tipoPago: clienteMatch.tipoPago,
                            horaVisita: clienteMatch.horaVisita,
                            asesor: clienteMatch.asesor ? {
                                _id: clienteMatch.asesor._id,
                                nombre: clienteMatch.asesor.nombre,
                                username: clienteMatch.asesor.username
                            } : null,
                            coordinacion: clienteMatch.coordinacion ? {
                                _id: clienteMatch.coordinacion._id,
                                nombre: clienteMatch.coordinacion.nombre
                            } : null
                        } : null,
                        tieneCreditoIndividual: tieneCredito,
                        tieneCreditoActivo: !!creditoActivo,
                        creditoActivo: creditoActivo ? {
                            _id: creditoActivo._id,
                            ciclo: creditoActivo.ciclo,
                            semanaActual: creditoActivo.semanaActual,
                            semanas: creditoActivo.semanas,
                            montoSolicitado: creditoActivo.montoSolicitado,
                            pagoPactado: creditoActivo.pagoPactado,
                            saldoPendiente: creditoActivo.saldoPendiente,
                            saldoTotal: creditoActivo.saldoTotal,
                            estado: creditoActivo.estado,
                            fechaPrimerPago: creditoActivo.fechaPrimerPago
                        } : null,
                        creditosIndividuales: todosCreditos.map(c => ({
                            _id: c._id,
                            ciclo: c.ciclo,
                            semanaActual: c.semanaActual,
                            semanas: c.semanas,
                            montoSolicitado: c.montoSolicitado,
                            pagoPactado: c.pagoPactado,
                            saldoPendiente: c.saldoPendiente,
                            saldoTotal: c.saldoTotal,
                            estado: c.estado,
                            fechaPrimerPago: c.fechaPrimerPago
                        }))
                    });
                }
            }

            // B. Revisar clientes explícitamente asignados al grupo que no aparecieron en grupo.integrantes
            for (const cl of clientesAsignadosMap.values()) {
                const clIdStr = String(cl._id);
                if (clientesProcesadosIds.has(clIdStr)) continue;

                const creditosCl = creditosPorCliente.get(clIdStr) || [];
                const tieneCredito = creditosCl.length > 0;
                const creditoActivo = creditosCl.find(c => c.estado === 'Activo') || null;

                miembrosClientes.push({
                    miembroId: null,
                    nombre: cl.nombre,
                    apellidos: '',
                    nombreCompleto: cl.nombre,
                    rol: 'CLIENTE_ASIGNADO',
                    ciclo: null,
                    esMiembroRegistrado: false,
                    esCliente: true,
                    cliente: {
                        _id: cl._id,
                        nombre: cl.nombre,
                        grupo: cl.grupo,
                        diaPago: cl.diaPago,
                        tipoPago: cl.tipoPago,
                        horaVisita: cl.horaVisita,
                        asesor: cl.asesor ? {
                            _id: cl.asesor._id,
                            nombre: cl.asesor.nombre,
                            username: cl.asesor.username
                        } : null,
                        coordinacion: cl.coordinacion ? {
                            _id: cl.coordinacion._id,
                            nombre: cl.coordinacion.nombre
                        } : null
                    },
                    tieneCreditoIndividual: tieneCredito,
                    tieneCreditoActivo: !!creditoActivo,
                    creditoActivo: creditoActivo ? {
                        _id: creditoActivo._id,
                        ciclo: creditoActivo.ciclo,
                        semanaActual: creditoActivo.semanaActual,
                        semanas: creditoActivo.semanas,
                        montoSolicitado: creditoActivo.montoSolicitado,
                        pagoPactado: creditoActivo.pagoPactado,
                        saldoPendiente: creditoActivo.saldoPendiente,
                        saldoTotal: creditoActivo.saldoTotal,
                        estado: creditoActivo.estado,
                        fechaPrimerPago: creditoActivo.fechaPrimerPago
                    } : null,
                    creditosIndividuales: creditosCl.map(c => ({
                        _id: c._id,
                        ciclo: c.ciclo,
                        semanaActual: c.semanaActual,
                        semanas: c.semanas,
                        montoSolicitado: c.montoSolicitado,
                        pagoPactado: c.pagoPactado,
                        saldoPendiente: c.saldoPendiente,
                        saldoTotal: c.saldoTotal,
                        estado: c.estado,
                        fechaPrimerPago: c.fechaPrimerPago
                    }))
                });
            }

            // C. Filtros opcionales por crédito
            let filtrados = miembrosClientes;
            if (isSoloCreditoActivo) {
                filtrados = filtrados.filter(m => m.tieneCreditoActivo);
            } else if (isSoloConCredito) {
                filtrados = filtrados.filter(m => m.tieneCreditoIndividual);
            }

            // Solo incluir el grupo si tiene integrantes que cumplen
            if (filtrados.length > 0) {
                gruposResultado.push({
                    _id: grupo._id,
                    nombre: grupo.nombre,
                    clave: grupo.clave,
                    diaVisita: grupo.diaVisita,
                    horaVisita: grupo.horaVisita,
                    coordinacion: grupo.coordinacion || null,
                    asesor: grupo.asesor || null,
                    totalIntegrantes: integrantes.length,
                    totalMiembrosClientes: filtrados.length,
                    totalConCreditoActivo: filtrados.filter(m => m.tieneCreditoActivo).length,
                    miembrosClientes: filtrados
                });
            }
        }

        return res.status(200).json({
            success: true,
            totalGrupos: gruposResultado.length,
            totalMiembrosClientes: gruposResultado.reduce((acc, g) => acc + g.totalMiembrosClientes, 0),
            data: gruposResultado
        });

    } catch (error) {
        logError(req, 'GET_GRUPOS_CON_MIEMBROS_CLIENTES_ERROR', error, { query: req.query });
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


/**
 * Obtiene los grupos cuyos integrantes tengan un crédito individual
 * o se encuentren registrados como clientes y como miembros.
 */
exports.getGruposConMiembrosClientes = async (req, res) => {
    try {
        const {
            estadoCredito,
            soloCreditoActivo,
            soloConCredito,
            grupoId,
            coordinacion,
            asesor
        } = req.query;

        const mongoose = require('mongoose');

        // 1. Filtro base de grupos (compatible con roles de req.user y query params)
        let filtroGrupo = {};

        if (req.user && req.user.role) {
            const role = req.user.role.toLowerCase();
            if (role === 'asesor') {
                const userId = req.user.id;
                filtroGrupo.$or = [
                    { asesor: userId },
                    ...(mongoose.Types.ObjectId.isValid(userId) ? [{ asesor: new mongoose.Types.ObjectId(userId) }] : [])
                ];
            } else if (role === 'coordinador' && req.user.coordinacion) {
                filtroGrupo.coordinacion = req.user.coordinacion;
            }
        }

        if (coordinacion && mongoose.Types.ObjectId.isValid(coordinacion)) {
            filtroGrupo.coordinacion = new mongoose.Types.ObjectId(coordinacion);
        }
        if (asesor && mongoose.Types.ObjectId.isValid(asesor)) {
            filtroGrupo.asesor = new mongoose.Types.ObjectId(asesor);
        }
        if (grupoId) {
            const trimmed = grupoId.trim();
            if (mongoose.Types.ObjectId.isValid(trimmed) && /^[0-9a-fA-F]{24}$/.test(trimmed)) {
                filtroGrupo._id = new mongoose.Types.ObjectId(trimmed);
            } else {
                filtroGrupo.nombre = new RegExp(`^${trimmed}$`, 'i');
            }
        }

        // 2. Traer grupos con sus integrantes (Miembros)
        const grupos = await Grupo.find(filtroGrupo)
            .populate('coordinacion', '_id nombre')
            .populate('asesor', '_id username nombre')
            .populate({
                path: 'integrantes',
                select: '_id nombre apellidos rol grupo ciclo'
            })
            .lean();

        if (!grupos || grupos.length === 0) {
            return res.status(200).json({
                success: true,
                totalGrupos: 0,
                totalMiembrosClientes: 0,
                data: []
            });
        }

        // 3. Traer todos los clientes (con asesor y coordinación)
        const clientes = await Cliente.find()
            .populate('coordinacion', '_id nombre')
            .populate('asesor', '_id username nombre')
            .lean();

        // 4. Traer créditos individuales
        const creditoQuery = { tipoCredito: 'Individual' };
        if (estadoCredito && estadoCredito.toLowerCase() !== 'todos' && estadoCredito.toLowerCase() !== 'all') {
            creditoQuery.estado = estadoCredito;
        }

        const creditosInd = await Credito.find(creditoQuery)
            .select('_id cliente miembro ciclo semanaActual semanas montoSolicitado pagoPactado saldoPendiente saldoTotal estado fechaPrimerPago createdAt')
            .sort({ ciclo: -1, createdAt: -1 })
            .lean();

        // 5. Indexar créditos por cliente y por miembro
        const creditosPorCliente = new Map();
        const creditosPorMiembro = new Map();

        for (const c of creditosInd) {
            if (c.cliente) {
                const cId = String(c.cliente._id || c.cliente);
                if (!creditosPorCliente.has(cId)) creditosPorCliente.set(cId, []);
                creditosPorCliente.get(cId).push(c);
            }
            if (c.miembro) {
                const mId = String(c.miembro._id || c.miembro);
                if (!creditosPorMiembro.has(mId)) creditosPorMiembro.set(mId, []);
                creditosPorMiembro.get(mId).push(c);
            }
        }

        // 6. Normalizador de cadenas para matching flexible (ignora acentos, mayúsculas y espacios extras)
        const normalizeText = (text) => {
            if (!text || typeof text !== 'string') return '';
            return text
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s]/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        };

        // 7. Indexar clientes por nombre normalizado y por grupo asignado (ID o nombre)
        const clientesPorNombre = new Map();
        const clientesPorGrupoKey = new Map();

        for (const cl of clientes) {
            const normNombre = normalizeText(cl.nombre);
            if (normNombre) {
                if (!clientesPorNombre.has(normNombre)) clientesPorNombre.set(normNombre, []);
                clientesPorNombre.get(normNombre).push(cl);
            }

            const rawGrupo = cl.grupo?.trim();
            if (rawGrupo && rawGrupo.toUpperCase() !== 'N/A' && rawGrupo.toUpperCase() !== 'N/A C.C.') {
                if (/^[0-9a-fA-F]{24}$/.test(rawGrupo)) {
                    const key = `id:${rawGrupo.toLowerCase()}`;
                    if (!clientesPorGrupoKey.has(key)) clientesPorGrupoKey.set(key, []);
                    clientesPorGrupoKey.get(key).push(cl);
                } else {
                    const key = `name:${normalizeText(rawGrupo)}`;
                    if (!clientesPorGrupoKey.has(key)) clientesPorGrupoKey.set(key, []);
                    clientesPorGrupoKey.get(key).push(cl);
                }
            }
        }

        // 8. Cruzar información grupo por grupo
        const isSoloCreditoActivo = soloCreditoActivo === 'true' || soloCreditoActivo === true;
        const isSoloConCredito = soloConCredito === 'true' || soloConCredito === true;

        const gruposResultado = [];

        for (const grupo of grupos) {
            const grupoIdStr = String(grupo._id).toLowerCase();
            const grupoNombreNorm = normalizeText(grupo.nombre);
            const grupoClaveNorm = normalizeText(grupo.clave);

            // Clientes explícitamente asignados a este grupo mediante el campo "grupo"
            const clientesAsignados = [
                ...(clientesPorGrupoKey.get(`id:${grupoIdStr}`) || []),
                ...(clientesPorGrupoKey.get(`name:${grupoNombreNorm}`) || []),
                ...(grupoClaveNorm ? (clientesPorGrupoKey.get(`name:${grupoClaveNorm}`) || []) : [])
            ];

            const clientesAsignadosMap = new Map();
            for (const cl of clientesAsignados) {
                clientesAsignadosMap.set(String(cl._id), cl);
            }

            const miembrosClientes = [];
            const clientesProcesadosIds = new Set();
            const miembrosProcesadosIds = new Set();

            const integrantes = Array.isArray(grupo.integrantes) ? grupo.integrantes : [];

            // A. Revisar integrantes registrados en el grupo
            for (const miembro of integrantes) {
                if (!miembro || !miembro._id) continue;
                const miembroIdStr = String(miembro._id);
                const nombreCompletoMiembro = `${miembro.nombre || ''} ${miembro.apellidos || ''}`.trim();
                const normNombreMiembro = normalizeText(nombreCompletoMiembro);

                // Buscar cliente coincidente (primero entre los asignados al grupo, luego global por nombre)
                let clienteMatch = null;
                for (const cl of clientesAsignadosMap.values()) {
                    if (normalizeText(cl.nombre) === normNombreMiembro) {
                        clienteMatch = cl;
                        break;
                    }
                }

                if (!clienteMatch && clientesPorNombre.has(normNombreMiembro)) {
                    const candidatos = clientesPorNombre.get(normNombreMiembro);
                    clienteMatch = candidatos.find(c => {
                        const g = c.grupo?.trim();
                        if (!g) return false;
                        return /^[0-9a-fA-F]{24}$/.test(g)
                            ? g.toLowerCase() === grupoIdStr
                            : normalizeText(g) === grupoNombreNorm;
                    }) || candidatos[0];
                }

                // Créditos individuales de este miembro / cliente
                const creditosCliente = clienteMatch ? (creditosPorCliente.get(String(clienteMatch._id)) || []) : [];
                const creditosMiembro = creditosPorMiembro.get(miembroIdStr) || [];

                const credMap = new Map();
                for (const c of [...creditosCliente, ...creditosMiembro]) {
                    credMap.set(String(c._id), c);
                }
                const todosCreditos = Array.from(credMap.values());
                const tieneCredito = todosCreditos.length > 0;
                const creditoActivo = todosCreditos.find(c => c.estado === 'Activo') || null;

                // Califica si está registrado como cliente O si tiene un crédito individual
                if (clienteMatch || tieneCredito) {
                    miembrosProcesadosIds.add(miembroIdStr);
                    if (clienteMatch) clientesProcesadosIds.add(String(clienteMatch._id));

                    miembrosClientes.push({
                        miembroId: miembro._id,
                        nombre: miembro.nombre,
                        apellidos: miembro.apellidos,
                        nombreCompleto: nombreCompletoMiembro,
                        rol: miembro.rol,
                        ciclo: miembro.ciclo,
                        esMiembroRegistrado: true,
                        esCliente: !!clienteMatch,
                        cliente: clienteMatch ? {
                            _id: clienteMatch._id,
                            nombre: clienteMatch.nombre,
                            grupo: clienteMatch.grupo,
                            diaPago: clienteMatch.diaPago,
                            tipoPago: clienteMatch.tipoPago,
                            horaVisita: clienteMatch.horaVisita,
                            asesor: clienteMatch.asesor ? {
                                _id: clienteMatch.asesor._id,
                                nombre: clienteMatch.asesor.nombre,
                                username: clienteMatch.asesor.username
                            } : null,
                            coordinacion: clienteMatch.coordinacion ? {
                                _id: clienteMatch.coordinacion._id,
                                nombre: clienteMatch.coordinacion.nombre
                            } : null
                        } : null,
                        tieneCreditoIndividual: tieneCredito,
                        tieneCreditoActivo: !!creditoActivo,
                        creditoActivo: creditoActivo ? {
                            _id: creditoActivo._id,
                            ciclo: creditoActivo.ciclo,
                            semanaActual: creditoActivo.semanaActual,
                            semanas: creditoActivo.semanas,
                            montoSolicitado: creditoActivo.montoSolicitado,
                            pagoPactado: creditoActivo.pagoPactado,
                            saldoPendiente: creditoActivo.saldoPendiente,
                            saldoTotal: creditoActivo.saldoTotal,
                            estado: creditoActivo.estado,
                            fechaPrimerPago: creditoActivo.fechaPrimerPago
                        } : null,
                        creditosIndividuales: todosCreditos.map(c => ({
                            _id: c._id,
                            ciclo: c.ciclo,
                            semanaActual: c.semanaActual,
                            semanas: c.semanas,
                            montoSolicitado: c.montoSolicitado,
                            pagoPactado: c.pagoPactado,
                            saldoPendiente: c.saldoPendiente,
                            saldoTotal: c.saldoTotal,
                            estado: c.estado,
                            fechaPrimerPago: c.fechaPrimerPago
                        }))
                    });
                }
            }

            // B. Revisar clientes explícitamente asignados al grupo que no aparecieron en grupo.integrantes
            for (const cl of clientesAsignadosMap.values()) {
                const clIdStr = String(cl._id);
                if (clientesProcesadosIds.has(clIdStr)) continue;

                const creditosCl = creditosPorCliente.get(clIdStr) || [];
                const tieneCredito = creditosCl.length > 0;
                const creditoActivo = creditosCl.find(c => c.estado === 'Activo') || null;

                miembrosClientes.push({
                    miembroId: null,
                    nombre: cl.nombre,
                    apellidos: '',
                    nombreCompleto: cl.nombre,
                    rol: 'CLIENTE_ASIGNADO',
                    ciclo: null,
                    esMiembroRegistrado: false,
                    esCliente: true,
                    cliente: {
                        _id: cl._id,
                        nombre: cl.nombre,
                        grupo: cl.grupo,
                        diaPago: cl.diaPago,
                        tipoPago: cl.tipoPago,
                        horaVisita: cl.horaVisita,
                        asesor: cl.asesor ? {
                            _id: cl.asesor._id,
                            nombre: cl.asesor.nombre,
                            username: cl.asesor.username
                        } : null,
                        coordinacion: cl.coordinacion ? {
                            _id: cl.coordinacion._id,
                            nombre: cl.coordinacion.nombre
                        } : null
                    },
                    tieneCreditoIndividual: tieneCredito,
                    tieneCreditoActivo: !!creditoActivo,
                    creditoActivo: creditoActivo ? {
                        _id: creditoActivo._id,
                        ciclo: creditoActivo.ciclo,
                        semanaActual: creditoActivo.semanaActual,
                        semanas: creditoActivo.semanas,
                        montoSolicitado: creditoActivo.montoSolicitado,
                        pagoPactado: creditoActivo.pagoPactado,
                        saldoPendiente: creditoActivo.saldoPendiente,
                        saldoTotal: creditoActivo.saldoTotal,
                        estado: creditoActivo.estado,
                        fechaPrimerPago: creditoActivo.fechaPrimerPago
                    } : null,
                    creditosIndividuales: creditosCl.map(c => ({
                        _id: c._id,
                        ciclo: c.ciclo,
                        semanaActual: c.semanaActual,
                        semanas: c.semanas,
                        montoSolicitado: c.montoSolicitado,
                        pagoPactado: c.pagoPactado,
                        saldoPendiente: c.saldoPendiente,
                        saldoTotal: c.saldoTotal,
                        estado: c.estado,
                        fechaPrimerPago: c.fechaPrimerPago
                    }))
                });
            }

            // C. Filtros opcionales por crédito
            let filtrados = miembrosClientes;
            if (isSoloCreditoActivo) {
                filtrados = filtrados.filter(m => m.tieneCreditoActivo);
            } else if (isSoloConCredito) {
                filtrados = filtrados.filter(m => m.tieneCreditoIndividual);
            }

            // Solo incluir el grupo si tiene integrantes que cumplen
            if (filtrados.length > 0) {
                gruposResultado.push({
                    _id: grupo._id,
                    nombre: grupo.nombre,
                    clave: grupo.clave,
                    diaVisita: grupo.diaVisita,
                    horaVisita: grupo.horaVisita,
                    coordinacion: grupo.coordinacion || null,
                    asesor: grupo.asesor || null,
                    totalIntegrantes: integrantes.length,
                    totalMiembrosClientes: filtrados.length,
                    totalConCreditoActivo: filtrados.filter(m => m.tieneCreditoActivo).length,
                    miembrosClientes: filtrados
                });
            }
        }

        return res.status(200).json({
            success: true,
            totalGrupos: gruposResultado.length,
            totalMiembrosClientes: gruposResultado.reduce((acc, g) => acc + g.totalMiembrosClientes, 0),
            data: gruposResultado
        });

    } catch (error) {
        logError(req, 'GET_GRUPOS_CON_MIEMBROS_CLIENTES_ERROR', error, { query: req.query });
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


const Credito = require('../models/Credito');
const Miembro = require('../models/Miembro');
const Grupo = require('../models/Grupo');
const Cliente = require('../models/Cliente');
const { logAccion, logWarn, logError } = require('../utils/loggers');
const { obtenerCoordinacionId, buildFiltroCoordinacion } = require('../helpers/coordinacionHelper');
const { obtenerDiaSemana } = require('../helpers/fechas');
const { calcularSemanaActual, consolidarPagosIndividual } = require('../helpers/distribucionPagos');
const pagoCreditoCtrl = require('./pagoCredito.controller');
const ahorroGarantiaCtrl = require('./ahorroGarantia.controller');

/** 
 * CRUD DE CREDITOS
 */
// CREATE
exports.crearCredito = async (req, res) => {
    try {
        const {
            miembro,
            cliente,
            ciclo,
            tipoCredito,
            pagoPactado,
            semanas,
            garantia,
            ahorro,
            fechaPrimerPago,
            tasaInteres,
            montoSolicitado,
            porcentajeGarantia,
            equivalenciaMeses,
            plazoMeses,
            frecuenciaPago
        } = req.body;

        const porc = porcentajeGarantia !== undefined ? porcentajeGarantia : 10;
        let garantiaCalculada = garantia !== undefined ? garantia : (montoSolicitado * (porc / 100));

        // --- VALIDACIÓN LÓGICA DE TIPO DE CLIENTE ---
        if (tipoCredito === 'Individual') {
            if (!cliente) {
                logWarn(req, 'CREAR_CREDITO_VALIDACION_FALLIDA', 'Crédito Individual requiere cliente', { body: req.body });
                return res.status(400).json({ ok: false, msg: 'Para un crédito Individual debe seleccionar un Cliente' });
            }
            req.body.miembro = null;
        } else {
            // Si es CC, R o 8S (Grupales)
            if (!miembro) {
                logWarn(req, 'CREAR_CREDITO_VALIDACION_FALLIDA', 'Crédito Grupal requiere miembro', { body: req.body });
                return res.status(400).json({ ok: false, msg: 'Para este tipo de crédito debe seleccionar un Miembro del grupo' });
            }
            req.body.cliente = null;
        }

        // Validar semanas: Si es 8S siempre son 8 semanas prioritariamente
        // let numSemanas = 16;
        // if (tipoCredito === '8S') {
        //     numSemanas = 8;
        // } else if (semanas && Number(semanas) > 0) {
        //     numSemanas = Number(semanas);
        // } else if (tipoCredito === 'R') {
        //     numSemanas = 16;
        // }
        // Validar semanas
        let numSemanas = 16;
        if (tipoCredito === '8S') {
            numSemanas = 8;
        } else if (semanas && Number(semanas) > 0) {
            numSemanas = Number(semanas);
        } else if (tipoCredito === 'R' || tipoCredito === '16S' || tipoCredito === 'CC') {
            numSemanas = 16;
        }

        // Equivalencia de meses tomada directamente del frontend (o por defecto 4)
        const meses = equivalenciaMeses !== undefined
            ? Number(equivalenciaMeses)
            : (plazoMeses !== undefined ? Number(plazoMeses) : 4);

        // Frecuencia de pago: tomar la enviada o deducir si son 8 semanas en 4 meses (Bisemanal)
        let frecFinal = frecuenciaPago;
        if (!frecFinal) {
            if (numSemanas === 8 && meses === 4) {
                frecFinal = 'Bisemanal';
            } else if (meses > 0 && (numSemanas / meses) <= 2.5 && numSemanas < 16) {
                frecFinal = 'Bisemanal';
            } else {
                frecFinal = 'Semanal';
            }
        }

        // Ajuste de garantía solo si efectivamente son 8 semanas y no se especificó garantía fija
        if (garantia === undefined && (tipoCredito === '8S' || numSemanas === 8)) {
            garantiaCalculada = garantiaCalculada * 2;
        }

        // Respetar el pagoPactado enviado por el usuario; solo calcular si no viene en el body
        let pagoPactadoCalc = (req.body.pagoPactado !== undefined && req.body.pagoPactado !== null && req.body.pagoPactado !== '')
            ? Number(req.body.pagoPactado)
            : null;

        if (!pagoPactadoCalc) {
            const tasa = tasaInteres || 0;
            const totalConInteres = montoSolicitado * (1 + (tasa * meses / 100));
            pagoPactadoCalc = Math.ceil(totalConInteres / numSemanas);
        } else if (tipoCredito === '8S' || numSemanas === 8) {
            // Si el pactado recibido es el de 16 semanas (ej. 900), para 8S debe ser el doble (1800)
            if ((pagoPactadoCalc * 8) < montoSolicitado) {
                pagoPactadoCalc = pagoPactadoCalc * 2;
            }
        }

        const saldoTotalCalc = tipoCredito === 'Individual' && req.body.saldoTotal
            ? req.body.saldoTotal
            : (pagoPactadoCalc * numSemanas);

        const dataToSave = {
            cliente: tipoCredito === 'Individual' ? cliente : null,
            semanas: numSemanas,
            pagoPactado: pagoPactadoCalc,
            saldoTotal: saldoTotalCalc,
            saldoPendiente: saldoTotalCalc,
            garantia: garantiaCalculada,
            tasaInteres,
            montoSolicitado,
            ahorro: {
                montoTotal: ahorro || 0,
                pagosAhorro: []
            },
            fechaPrimerPago,
            frecuenciaPago: frecFinal,
            garantiaPredial: req.body.garantiaPredial || '',
            equivalenciaMeses: meses,
            grupoOpcional: req.body.grupoOpcional || '',
            semanaActual: req.body.semanaActual || calcularSemanaActual(fechaPrimerPago, frecFinal)
        };

        if (req.body.estadoGrupo) {
            dataToSave.estadoGrupo = req.body.estadoGrupo;
        }

        if (tipoCredito !== 'Individual') {
            dataToSave.miembro = miembro;
        }

        let creditoGuardado;

        if (tipoCredito === 'Individual') {
            const mongoose = require('mongoose');

            // Buscar si ya existe un crédito ACTIVO en este ciclo (no liquidado ni cancelado)
            const creditoActivoExistente = await Credito.findOne({
                cliente,
                ciclo,
                tipoCredito: 'Individual',
                estado: { $nin: ['Liquidado', 'Cancelado'] }
            });

            if (creditoActivoExistente) {
                // Si existe un crédito activo en este ciclo, se actualiza preservando pagos y ahorros
                const { ahorro: _ahorroIgnorado, ...restoDatos } = dataToSave;
                Object.assign(creditoActivoExistente, restoDatos);
                if (ahorro !== undefined && ahorro !== null) {
                    if (!creditoActivoExistente.ahorro) {
                        creditoActivoExistente.ahorro = { montoTotal: 0, pagosAhorro: [] };
                    }
                    creditoActivoExistente.ahorro.montoTotal = Number(ahorro) || 0;
                }
                creditoGuardado = await creditoActivoExistente.save();
            } else {
                // Si no hay crédito activo (por ejemplo, el anterior de este ciclo ya está liquidado),
                // se inserta un NUEVO crédito individual independiente para no sobrescribir el historial
                const nuevoDoc = {
                    ...dataToSave,
                    cliente,
                    miembro: new mongoose.Types.ObjectId(),
                    ciclo,
                    tipoCredito: 'Individual',
                    estado: 'Activo'
                };
                creditoGuardado = await Credito.create(nuevoDoc);
            }
        } else {
            const query = {
                ciclo,
                tipoCredito,
                miembro
            };
            const updateDoc = {
                $set: dataToSave
            };

            creditoGuardado = await Credito.findOneAndUpdate(
                query,
                updateDoc,
                { upsert: true, new: true, runValidators: true }
            );
        }

        if (fechaPrimerPago) {
            const diaDetectado = obtenerDiaSemana(fechaPrimerPago);
            if (diaDetectado) {
                if (tipoCredito === 'Individual' && cliente) {
                    await Cliente.findByIdAndUpdate(cliente, { diaPago: diaDetectado, diaVisita: diaDetectado });
                } else if (miembro) {
                    const miembroDoc = await Miembro.findById(miembro).select('grupo').lean();
                    if (miembroDoc && miembroDoc.grupo) {
                        await Grupo.findByIdAndUpdate(miembroDoc.grupo, { diaVisita: diaDetectado, diaPago: diaDetectado });
                    }
                }
            }
        }

        logAccion(req, 'GUARDAR_CREDITO', {
            descripcion: `Crédito ${tipoCredito} (Ciclo ${ciclo}) guardado/actualizado para ${tipoCredito === 'Individual' ? 'Cliente ' + cliente : 'Miembro ' + miembro} - Monto: $${montoSolicitado}`,
            datos: { tipoCredito, ciclo, miembro, cliente, montoSolicitado, pagoPactado: pagoPactadoCalc, saldoTotal: saldoTotalCalc },
            resultado: { creditoId: creditoGuardado._id, estado: creditoGuardado.estado, saldoPendiente: creditoGuardado.saldoPendiente }
        });

        res.status(201).json({
            ok: true,
            credito: creditoGuardado
        });

    } catch (error) {
        logError(req, 'CREAR_CREDITO_ERROR', error, { body: req.body });
        res.status(500).json({
            ok: false,
            msg: 'Error al crear o actualizar crédito',
            error: error.message
        });
    }
};

// READ ALL
exports.obtenerCreditos = async (req, res) => {
    try {
        let query = {};
        const mongoose = require('mongoose');
        let user = req.user;

        if (!user && req.headers?.authorization) {
            const jwt = require('jsonwebtoken');
            const token = req.headers.authorization.split(' ')[1];
            try {
                user = jwt.verify(token, process.env.JWT_SECRET || 'VAM2026#00');
            } catch (e) { }
        }

        // 1. Filtrado por rol del usuario o por parámetros de búsqueda
        if (req.query.cliente || req.query.miembro) {
            const entidadId = req.query.cliente || req.query.miembro;
            const idObj = mongoose.Types.ObjectId.isValid(entidadId) ? new mongoose.Types.ObjectId(entidadId) : entidadId;
            query = {
                $or: [
                    { cliente: entidadId },
                    { cliente: idObj },
                    { miembro: entidadId },
                    { miembro: idObj }
                ]
            };
        } else if (user && user.role && user.role.toLowerCase() === 'coordinador') {
            const coordId = await obtenerCoordinacionId(user);
            const filtroGrupos = await buildFiltroCoordinacion(coordId, req.query.asesor, user.id);
            const filtroClientes = await buildFiltroCoordinacion(coordId, req.query.asesor, user.id);

            const [gruposCoord, clientesCoord] = await Promise.all([
                Grupo.find(filtroGrupos).select('_id').lean(),
                Cliente.find(filtroClientes).select('_id').lean()
            ]);

            const grupoIds = gruposCoord.map(g => g._id);
            const miembros = await Miembro.find({ grupo: { $in: grupoIds } }).select('_id').lean();
            const miembroIds = miembros.map(m => m._id);
            const clienteIds = clientesCoord.map(c => c._id);

            query = {
                $or: [
                    { miembro: { $in: miembroIds } },
                    { cliente: { $in: clienteIds } }
                ]
            };
        } else if (req.query.tipoCredito === 'Individual') {
            if (req.query.asesor && req.query.asesor !== 'todos') {
                const aId = req.query.asesor;
                const clientesAsesor = await Cliente.find({ asesor: aId }).select('_id').lean();
                query = { cliente: { $in: clientesAsesor.map(c => c._id) }, tipoCredito: 'Individual' };
            } else if (user && user.role && user.role.toLowerCase() === 'asesor') {
                const clientesAsesor = await Cliente.find({ asesor: user.id }).select('_id').lean();
                query = { cliente: { $in: clientesAsesor.map(c => c._id) }, tipoCredito: 'Individual' };
            } else {
                query = { tipoCredito: 'Individual' };
            }
        } else if (req.query.asesor && req.query.asesor !== 'todos') {
            const aId = req.query.asesor;
            const aIdObj = mongoose.Types.ObjectId.isValid(aId) ? new mongoose.Types.ObjectId(aId) : aId;
            const [gruposAsesor, clientesAsesor] = await Promise.all([
                Grupo.find({
                    $or: [
                        { asesor: aId },
                        ...(mongoose.Types.ObjectId.isValid(aId) ? [{ asesor: aIdObj }] : [])
                    ]
                }).select('_id').lean(),
                Cliente.find({
                    $or: [
                        { asesor: aId },
                        ...(mongoose.Types.ObjectId.isValid(aId) ? [{ asesor: aIdObj }] : [])
                    ]
                }).select('_id').lean()
            ]);
            const grupoIds = gruposAsesor.map(g => g._id);
            const miembros = await Miembro.find({ grupo: { $in: grupoIds } }).select('_id').lean();
            const miembroIds = miembros.map(m => m._id);
            const clienteIds = clientesAsesor.map(c => c._id);

            query = {
                $or: [
                    { miembro: { $in: miembroIds } },
                    { cliente: { $in: clienteIds } }
                ]
            };
        } else if (req.query.coordinacion && req.query.coordinacion !== 'todas') {
            const filtroGrupos = await buildFiltroCoordinacion(req.query.coordinacion, req.query.asesor);
            const filtroClientes = await buildFiltroCoordinacion(req.query.coordinacion, req.query.asesor);

            const [gruposCoord, clientesCoord] = await Promise.all([
                Grupo.find(filtroGrupos).select('_id').lean(),
                Cliente.find(filtroClientes).select('_id').lean()
            ]);
            const grupoIds = gruposCoord.map(g => g._id);
            const miembros = await Miembro.find({ grupo: { $in: grupoIds } }).select('_id').lean();
            const miembroIds = miembros.map(m => m._id);
            const clienteIds = clientesCoord.map(c => c._id);

            query = {
                $or: [
                    { miembro: { $in: miembroIds } },
                    { cliente: { $in: clienteIds } }
                ]
            };
        } else if (user && user.role) {
            const role = user.role.toLowerCase();
            if (role === 'asesor') {
                const userId = user.id;
                const asesorIdObj = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;

                const [gruposAsesor, clientesAsesor] = await Promise.all([
                    Grupo.find({
                        $or: [
                            { asesor: userId },
                            ...(mongoose.Types.ObjectId.isValid(userId) ? [{ asesor: asesorIdObj }] : [])
                        ]
                    }).select('_id').lean(),
                    Cliente.find({
                        $or: [
                            { asesor: userId },
                            ...(mongoose.Types.ObjectId.isValid(userId) ? [{ asesor: asesorIdObj }] : [])
                        ]
                    }).select('_id').lean()
                ]);

                const grupoIds = gruposAsesor.map(g => g._id);
                const miembros = await Miembro.find({ grupo: { $in: grupoIds } }).select('_id').lean();
                const miembroIds = miembros.map(m => m._id);
                const clienteIds = clientesAsesor.map(c => c._id);

                query = {
                    $or: [
                        { miembro: { $in: miembroIds } },
                        { cliente: { $in: clienteIds } }
                    ]
                };
            } else if (role === 'coordinador') {
                const coordId = await obtenerCoordinacionId(user);
                const filtroGrupos = await buildFiltroCoordinacion(coordId, req.query.asesor, user.id);
                const filtroClientes = await buildFiltroCoordinacion(coordId, req.query.asesor, user.id);

                const [gruposCoord, clientesCoord] = await Promise.all([
                    Grupo.find(filtroGrupos).select('_id').lean(),
                    Cliente.find(filtroClientes).select('_id').lean()
                ]);

                const grupoIds = gruposCoord.map(g => g._id);
                const miembros = await Miembro.find({ grupo: { $in: grupoIds } }).select('_id').lean();
                const miembroIds = miembros.map(m => m._id);
                const clienteIds = clientesCoord.map(c => c._id);

                query = {
                    $or: [
                        { miembro: { $in: miembroIds } },
                        { cliente: { $in: clienteIds } }
                    ]
                };
            }
        }

        // 2. Consulta ultraligera sin populates anidados pesados ni campos innecesarios
        const creditos = await Credito.find(query)
            .select({
                tipoCredito: 1,
                ciclo: 1,
                miembro: 1,
                cliente: 1,
                estado: 1,
                estadoGrupo: 1,
                semanas: 1,
                pagoPactado: 1,
                saldoTotal: 1,
                saldoPendiente: 1,
                fechaPrimerPago: 1,
                frecuenciaPago: 1,
                semanaActual: 1,
                tasaInteres: 1,
                montoSolicitado: 1,
                motivoCancelacion: 1,
                justificacionCancelacion: 1,
                fechaCancelacion: 1,
                garantia: 1,
                'pagos.numeroPago': 1,
                'pagos.fechaPago': 1,
                'pagos.montoPagado': 1,
                'pagos.montoSolidario': 1,
                'pagos.pagoSolidario': 1,
                'pagos.quienPrestoSolidario': 1,
                'pagos.recuperacionSolidario': 1,
                'pagos.metodoPago': 1,
                'pagos.numeroRecibo': 1
            })
            .sort({ ciclo: -1, createdAt: -1 })
            .lean();

        const hoy = new Date();
        const operacionesBulk = [];

        creditos.forEach(credito => {
            const totalPagado = (credito.pagos || []).reduce((acc, p) => acc + (p.montoPagado || 0) + (p.montoSolidario || 0), 0);
            const saldoCalculado = Math.max(0, (credito.saldoTotal || 0) - totalPagado);
            if ((credito.saldoPendiente === undefined || credito.saldoPendiente === null || credito.saldoPendiente === 0) && saldoCalculado > 0 && credito.estado !== 'Liquidado' && credito.estado !== 'Cancelado') {
                credito.saldoPendiente = saldoCalculado;
            }

            if (credito.estado === 'Activo' && credito.fechaPrimerPago) {
                const semanaCalculada = calcularSemanaActual(credito.fechaPrimerPago, credito.frecuenciaPago || 'Semanal', hoy);
                if (credito.semanaActual !== semanaCalculada) {
                    credito.semanaActual = semanaCalculada;
                    operacionesBulk.push({
                        updateOne: {
                            filter: { _id: credito._id },
                            update: { semanaActual: semanaCalculada }
                        }
                    });
                }
            }
        });

        if (operacionesBulk.length > 0) {
            Credito.bulkWrite(operacionesBulk).catch(err => console.error('Error background bulkWrite:', err));
        }

        let creditosParaEnviar = creditos;
        if (req.query.incluirHistorico !== 'true' && req.query.todos !== 'true') {
            const miembrosConRefillPorCiclo = new Set();
            creditos.forEach(c => {
                if (c.miembro && c.tipoCredito === 'R') {
                    const miembroId = c.miembro._id ? c.miembro._id.toString() : c.miembro.toString();
                    miembrosConRefillPorCiclo.add(`${miembroId}_${c.ciclo}`);
                }
            });

            // creditosParaEnviar = creditos.filter(c => {
            //     if (c.miembro && c.tipoCredito === 'CC') {
            //         const miembroId = c.miembro._id ? c.miembro._id.toString() : c.miembro.toString();
            //         if (miembrosConRefillPorCiclo.has(`${miembroId}_${c.ciclo}`)) {
            //             return false; // Omitir el CC anterior porque el R es la continuación vigente
            //         }
            //     }
            //     return true;
            // });
            creditosParaEnviar = creditos.filter(c => {
                // Omitir CC o 16S anteriores si el miembro ya tiene un Refill (R) activo en ese ciclo
                if (c.miembro && (c.tipoCredito === 'CC' || c.tipoCredito === '16S')) {
                    const miembroId = c.miembro._id ? c.miembro._id.toString() : c.miembro.toString();
                    if (miembrosConRefillPorCiclo.has(`${miembroId}_${c.ciclo}`)) {
                        return false;
                    }
                }
                return true;
            });
        }

        res.json({
            ok: true,
            creditos: creditosParaEnviar
        });

    } catch (error) {
        logError(req, 'OBTENER_CREDITOS_ERROR', error);
        res.status(500).json({
            ok: false,
            msg: 'Error al obtener créditos'
        });
    }
};

// READ ONE
exports.obtenerCreditoPorId = async (req, res) => {
    try {
        const { id } = req.params;

        const credito = await Credito.findById(id)
            .populate({
                path: 'miembro',
                populate: { path: 'grupo' }
            })
            .populate('cliente');

        if (!credito) {
            logWarn(req, 'OBTENER_CREDITO_NOT_FOUND', 'Crédito no encontrado por ID', { id });
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        if (credito.estado === 'Activo' && credito.fechaPrimerPago) {
            const hoy = new Date();
            const semanaCalculada = calcularSemanaActual(credito.fechaPrimerPago, credito.frecuenciaPago || 'Semanal', hoy);
            if (credito.semanaActual !== semanaCalculada) {
                credito.semanaActual = semanaCalculada;
                await credito.save();
            }
        }

        res.json({
            ok: true,
            credito
        });

    } catch (error) {
        logError(req, 'OBTENER_CREDITO_POR_ID_ERROR', error, { id: req.params.id });
        res.status(500).json({
            ok: false,
            msg: 'Error al buscar crédito'
        });
    }
};

// UPDATE
exports.actualizarCredito = async (req, res) => {
    try {
        const { id } = req.params;

        const creditoOriginal = await Credito.findById(id);
        if (!creditoOriginal) {
            logWarn(req, 'ACTUALIZAR_CREDITO_NOT_FOUND', 'Intento de actualizar crédito inexistente', { id, body: req.body });
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        const datosActualizar = { ...req.body };
        delete datosActualizar.pagos;

        // --- AUTOMATIZACIÓN DE CÁLCULO PARA REFILL, 8S Y 16S ---
        const tipoFinal = datosActualizar.tipoCredito || creditoOriginal.tipoCredito;
        const esRefill = tipoFinal === 'R';
        const es8S = tipoFinal === '8S';

        // Asegurar que si el tipo final es 16S o CC, las semanas queden en 16 si no se especificaron
        if ((tipoFinal === '16S' || tipoFinal === 'CC') && !datosActualizar.semanas) {
            datosActualizar.semanas = 16;
        }

        const tipoCambio = datosActualizar.tipoCredito && datosActualizar.tipoCredito !== creditoOriginal.tipoCredito;
        const montoCambio = datosActualizar.montoSolicitado && parseFloat(datosActualizar.montoSolicitado) !== parseFloat(creditoOriginal.montoSolicitado);
        const semanaCambio = datosActualizar.semanaActual && parseInt(datosActualizar.semanaActual) !== parseInt(creditoOriginal.semanaActual || 1);
        const semanasCambio = datosActualizar.semanas && parseInt(datosActualizar.semanas) !== parseInt(creditoOriginal.semanas || 16);

        const esActualizacionReal = tipoCambio || montoCambio || semanaCambio || semanasCambio;

        if (esRefill && esActualizacionReal) {
            const montoSolicitado = datosActualizar.montoSolicitado || creditoOriginal.montoSolicitado;
            const semanaActual = datosActualizar.semanaActual || creditoOriginal.semanaActual || "1";
            const semanasTotal = datosActualizar.semanas || creditoOriginal.semanas || 16;

            let semanasRestantes = semanasTotal - parseInt(semanaActual) + 1;
            if (semanasRestantes <= 0) semanasRestantes = 1;

            datosActualizar.pagoPactado = montoSolicitado / semanasRestantes;
            datosActualizar.saldoTotal = montoSolicitado;
            datosActualizar.saldoPendiente = montoSolicitado;
        } else if (es8S && esActualizacionReal) {
            const montoSolicitado = datosActualizar.montoSolicitado || creditoOriginal.montoSolicitado;
            const porc = datosActualizar.porcentajeGarantia !== undefined
                ? datosActualizar.porcentajeGarantia
                : (creditoOriginal.porcentajeGarantia !== undefined ? creditoOriginal.porcentajeGarantia : 10);

            // En 8S las semanas siempre deben fijarse en 8
            const semanasNum = 8;
            datosActualizar.semanas = semanasNum;

            // Garantía sobre el monto solicitado (duplicada para 8S)
            if (datosActualizar.garantia === undefined) {
                const garantiaBase = montoSolicitado * (porc / 100);
                datosActualizar.garantia = garantiaBase * 2;
            }

            let pactado8 = (datosActualizar.pagoPactado !== undefined && datosActualizar.pagoPactado !== null && datosActualizar.pagoPactado !== '')
                ? Number(datosActualizar.pagoPactado)
                : (creditoOriginal.pagoPactado || null);

            if (!pactado8) {
                const meses = datosActualizar.equivalenciaMeses || creditoOriginal.equivalenciaMeses || 4;
                const tasa = datosActualizar.tasaInteres || creditoOriginal.tasaInteres || 0;
                const totalConInteres = montoSolicitado * (1 + (tasa * meses / 100));
                pactado8 = Math.ceil(totalConInteres / semanasNum);
            } else if ((pactado8 * 8) < montoSolicitado) {
                // Si viene el pactado base de 16 semanas, se duplica para 8S
                pactado8 = pactado8 * 2;
            }

            datosActualizar.pagoPactado = pactado8;
            const nuevoSaldoTotal = pactado8 * semanasNum;
            datosActualizar.saldoTotal = nuevoSaldoTotal;

            const totalPagado = (creditoOriginal.pagos || []).reduce((acc, p) => acc + (p.montoPagado || 0), 0);
            datosActualizar.saldoPendiente = Math.max(0, nuevoSaldoTotal - totalPagado);
        }
        // --- FIN AUTOMATIZACIÓN ---

        const creditoActualizado = await Credito.findByIdAndUpdate(
            id,
            datosActualizar,
            { new: true }
        );

        if (!creditoActualizado) {
            logWarn(req, 'ACTUALIZAR_CREDITO_FALLIDO', 'No se pudo actualizar el crédito tras búsqueda', { id });
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        if (datosActualizar.fechaPrimerPago || datosActualizar.diaPago) {
            const diaFinal = datosActualizar.diaPago || (datosActualizar.fechaPrimerPago ? obtenerDiaSemana(datosActualizar.fechaPrimerPago) : undefined);
            if (diaFinal) {
                if (creditoActualizado.cliente) {
                    await Cliente.findByIdAndUpdate(creditoActualizado.cliente, { diaPago: diaFinal, diaVisita: diaFinal });
                }
                if (creditoActualizado.miembro) {
                    const miembroDoc = await Miembro.findById(creditoActualizado.miembro).select('grupo').lean();
                    if (miembroDoc && miembroDoc.grupo) {
                        await Grupo.findByIdAndUpdate(miembroDoc.grupo, { diaVisita: diaFinal, diaPago: diaFinal });
                    }
                }
            }
        }

        logAccion(req, 'ACTUALIZAR_CREDITO', {
            descripcion: `Crédito actualizado (ID: ${id}) - Tipo: ${creditoActualizado.tipoCredito} | Monto: $${creditoActualizado.montoSolicitado}`,
            datos: { id, cambios: datosActualizar, esRefill },
            resultado: { creditoId: creditoActualizado._id, saldoPendiente: creditoActualizado.saldoPendiente, estado: creditoActualizado.estado }
        });

        res.json({
            ok: true,
            credito: creditoActualizado
        });

    } catch (error) {
        logError(req, 'ACTUALIZAR_CREDITO_ERROR', error, { id: req.params.id, body: req.body });
        res.status(500).json({
            ok: false,
            msg: 'Error al actualizar crédito'
        });
    }
};

// DELETE
exports.eliminarCredito = async (req, res) => {
    try {
        const { id } = req.params;

        const creditoEliminado = await Credito.findByIdAndDelete(id);

        if (!creditoEliminado) {
            logWarn(req, 'ELIMINAR_CREDITO_NOT_FOUND', 'Intento de eliminar crédito inexistente', { id });
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        logAccion(req, 'ELIMINAR_CREDITO', {
            descripcion: `Crédito eliminado (ID: ${id}) - Tipo: ${creditoEliminado.tipoCredito}, Ciclo: ${creditoEliminado.ciclo}`,
            datos: { id },
            resultado: {
                creditoId: id,
                miembro: creditoEliminado.miembro,
                cliente: creditoEliminado.cliente,
                saldoPendiente: creditoEliminado.saldoPendiente
            }
        });

        res.json({
            ok: true,
            msg: 'Crédito eliminado correctamente'
        });

    } catch (error) {
        logError(req, 'ELIMINAR_CREDITO_ERROR', error, { id: req.params.id });
        res.status(500).json({
            ok: false,
            msg: 'Error al eliminar crédito'
        });
    }
};

// CANCELACIÓN JUSTIFICADA (REFILL / CAMBIO DE CICLO)
exports.cancelarCreditoJustificado = async (req, res) => {
    try {
        const { id } = req.params;
        const { motivo, justificacion, notas } = req.body;

        const credito = await Credito.findById(id);

        if (!credito) {
            logWarn(req, 'CANCELAR_CREDITO_NOT_FOUND', 'Crédito no encontrado para cancelación justificada', { id });
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        const saldoAnterior = credito.saldoPendiente;
        const motivoTexto = motivo || 'CANCELACION_REFILL';
        const justificacionFinal = justificacion || (motivo === 'CAMBIO_CICLO' ? 'Cancelación por Cambio de Ciclo' : 'Cancelación por Refill');

        credito.saldoPendiente = 0;
        credito.estado = 'Liquidado';
        credito.motivoCancelacion = motivoTexto;
        credito.justificacionCancelacion = notas ? `${justificacionFinal}: ${notas}` : justificacionFinal;
        credito.fechaCancelacion = new Date();

        if (req.user && (req.user.id || req.user._id)) {
            credito.canceladoPor = req.user.id || req.user._id;
        }

        await credito.save();

        logAccion(req, 'CANCELAR_CREDITO_JUSTIFICADO', {
            descripcion: `Crédito cancelado justificadamente (ID: ${id}) - Motivo: ${justificacionFinal} - Saldo liquidado: $${saldoAnterior}`,
            datos: { id, motivo: motivoTexto, justificacion: justificacionFinal, saldoAnterior, notas },
            resultado: {
                creditoId: id,
                estado: credito.estado,
                saldoPendiente: credito.saldoPendiente,
                fechaCancelacion: credito.fechaCancelacion
            }
        });

        res.json({
            ok: true,
            msg: 'Crédito cancelado y saldado a $0 correctamente por justificación.',
            credito
        });

    } catch (error) {
        logError(req, 'CANCELAR_CREDITO_JUSTIFICADO_ERROR', error, { id: req.params.id, body: req.body });
        res.status(500).json({
            ok: false,
            msg: 'Error al cancelar crédito justificadamente',
            error: error.message
        });
    }
};

// ==========================================
// RE-EXPORTAR SUBMÓDULOS (COMPATIBILIDAD HACIA ATRÁS)
// ==========================================
exports.registrarPago = pagoCreditoCtrl.registrarPago;
exports.getPagosConUbicacion = pagoCreditoCtrl.getPagosConUbicacion;
exports.registrarAbonoGarantia = ahorroGarantiaCtrl.registrarAbonoGarantia;
exports.registrarAhorro = ahorroGarantiaCtrl.registrarAhorro;
exports.consolidarPagosIndividual = consolidarPagosIndividual;

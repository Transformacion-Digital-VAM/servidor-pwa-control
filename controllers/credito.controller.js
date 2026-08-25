const Credito = require('../models/Credito');
const Miembro = require('../models/Miembro');
const Grupo = require('../models/Grupo');
const { logAccion, logWarn, logError } = require('../utils/loggers');

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
            porcentajeGarantia
        } = req.body;

        const porc = porcentajeGarantia !== undefined ? porcentajeGarantia : 10;
        const garantiaCalculada = garantia !== undefined ? garantia : (montoSolicitado * (porc / 100));

        // --- VALIDACIÓN LÓGICA DE TIPO DE CLIENTE ---
        if (tipoCredito === 'Individual') {
            if (!cliente) {
                logWarn(req, 'CREAR_CREDITO_VALIDACION_FALLIDA', 'Crédito Individual requiere cliente', { body: req.body });
                return res.status(400).json({ ok: false, msg: 'Para un crédito Individual debe seleccionar un Cliente' });
            }
            // Limpiar miembro
            req.body.miembro = null;
        } else {
            // Si es CC, R o 8S (Grupales)
            if (!miembro) {
                logWarn(req, 'CREAR_CREDITO_VALIDACION_FALLIDA', 'Crédito Grupal requiere miembro', { body: req.body });
                return res.status(400).json({ ok: false, msg: 'Para este tipo de crédito debe seleccionar un Miembro del grupo' });
            }
            // Limpiar cliente
            req.body.cliente = null;
        }

        // Validar semanas
        let numSemanas = 16;
        if (tipoCredito === '8S') {
            numSemanas = 8;
        } else if (tipoCredito === 'R') {
            numSemanas = 16;
        } else if (semanas) {
            numSemanas = semanas;
        }

        // Si viene pagoPactado en el body se utiliza, de lo contrario fallback a montoSolicitado / numSemanas
        const pagoPactadoCalc = req.body.pagoPactado || (montoSolicitado / numSemanas);

        const saldoTotalCalc = tipoCredito === 'Individual' && req.body.saldoTotal
            ? req.body.saldoTotal
            : (pagoPactadoCalc * numSemanas);

        const query = {
            ciclo,
            tipoCredito
        };

        if (tipoCredito === 'Individual') {
            query.cliente = cliente;
        } else {
            query.miembro = miembro;
        }

        const dataToSave = {
            cliente: tipoCredito === 'Individual' ? cliente : null,
            semanas: numSemanas,
            pagoPactado: pagoPactadoCalc,
            saldoTotal: saldoTotalCalc,
            // Si es nuevo o no tiene saldo, lo inicializamos. Si ya existe, no solemos resetear saldoPendiente si ya hay pagos.
            // Para simplificar el "re-save" del admin:
            saldoPendiente: saldoTotalCalc,
            garantia: garantiaCalculada,
            tasaInteres,
            montoSolicitado,
            ahorro: {
                montoTotal: ahorro || 0,
                pagosAhorro: []
            },
            fechaPrimerPago,
            frecuenciaPago: req.body.frecuenciaPago || 'Semanal',
            garantiaPredial: req.body.garantiaPredial || '',
            equivalenciaMeses: req.body.equivalenciaMeses || 4,
            grupoOpcional: req.body.grupoOpcional || '',
            semanaActual: req.body.semanaActual || calcularSemanaActual(fechaPrimerPago, req.body.frecuenciaPago || 'Semanal')
        };

        if (tipoCredito !== 'Individual') {
            dataToSave.miembro = miembro;
        }

        const updateDoc = {
            $set: dataToSave
        };

        if (tipoCredito === 'Individual') {
            const mongoose = require('mongoose');
            updateDoc.$setOnInsert = {
                miembro: new mongoose.Types.ObjectId()
            };
        }

        // Intentar buscar y actualizar, si no existe, crear (upsert)
        // El unique index es en {miembro, ciclo, tipoCredito}.
        const creditoGuardado = await Credito.findOneAndUpdate(
            query,
            updateDoc,
            { upsert: true, new: true, runValidators: true }
        );

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
        const creditos = await Credito.find()
            .populate({
                path: 'miembro',
                populate: { path: 'grupo' }
            })
            .populate('cliente')
            .sort({ ciclo: -1, createdAt: -1 });

        const hoy = new Date();
        const operacionesBulk = [];
        let modificados = false;

        creditos.forEach(credito => {
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
                    modificados = true;
                }
            }
        });

        if (operacionesBulk.length > 0) {
            await Credito.bulkWrite(operacionesBulk);
        }

        res.json({
            ok: true,
            creditos
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

        // Por seguridad, si mandan req.body, evitamos que sobreescriban accidentalmente el historial de pagos.
        // Solo actualizamos tipoCredito, montos, semanas, tasas, etc.
        const datosActualizar = { ...req.body };
        delete datosActualizar.pagos;

        // --- AUTOMATIZACIÓN DE CÁLCULO PARA REFILL Y 8S ---
        const esRefill = datosActualizar.tipoCredito === 'R' || creditoOriginal.tipoCredito === 'R';
        const es8S = datosActualizar.tipoCredito === '8S' || creditoOriginal.tipoCredito === '8S';

        // Evitamos que los miembros que no actualizaron su crédito pierdan sus saldos y datos,
        // verificando si hubo algún cambio real en los parámetros de su crédito.
        const tipoCambio = datosActualizar.tipoCredito && datosActualizar.tipoCredito !== creditoOriginal.tipoCredito;
        const montoCambio = datosActualizar.montoSolicitado && parseFloat(datosActualizar.montoSolicitado) !== parseFloat(creditoOriginal.montoSolicitado);
        const semanaCambio = datosActualizar.semanaActual && parseInt(datosActualizar.semanaActual) !== parseInt(creditoOriginal.semanaActual || 1);
        const semanasCambio = datosActualizar.semanas && parseInt(datosActualizar.semanas) !== parseInt(creditoOriginal.semanas || 16);

        // Sólo recalculamos si cambiaron el tipo o ajustaron el monto/semanas.
        const esActualizacionReal = tipoCambio || montoCambio || semanaCambio || semanasCambio;

        if (esRefill && esActualizacionReal) {
            const montoSolicitado = datosActualizar.montoSolicitado || creditoOriginal.montoSolicitado;
            const semanaActual = datosActualizar.semanaActual || creditoOriginal.semanaActual || "1";
            const semanasTotal = datosActualizar.semanas || creditoOriginal.semanas || 16;

            // Calculamos cuántas semanas le quedan al crédito (ej. de la 9 a la 16 = 8 semanas)
            let semanasRestantes = semanasTotal - parseInt(semanaActual) + 1;
            if (semanasRestantes <= 0) semanasRestantes = 1; // Prevenir división por cero

            // Si es Refill, forzamos automatización
            datosActualizar.pagoPactado = montoSolicitado / semanasRestantes;
            datosActualizar.saldoTotal = montoSolicitado;
            datosActualizar.saldoPendiente = montoSolicitado;
        } else if (es8S && esActualizacionReal) {
            const montoSolicitado = datosActualizar.montoSolicitado || creditoOriginal.montoSolicitado;
            const porc = datosActualizar.porcentajeGarantia !== undefined
                ? datosActualizar.porcentajeGarantia
                : (creditoOriginal.porcentajeGarantia !== undefined ? creditoOriginal.porcentajeGarantia : 10);

            datosActualizar.semanas = 8;
            // Garantía sobre el monto solicitado
            if (datosActualizar.garantia === undefined) {
                datosActualizar.garantia = montoSolicitado * (porc / 100);
            }
            // Pago pactado a 8 semanas
            const pactado8 = datosActualizar.pagoPactado || (montoSolicitado / 8);
            datosActualizar.pagoPactado = pactado8;
            // Saldo total calculado a 8 semanas
            const nuevoSaldoTotal = pactado8 * 8;
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

// REGISTRAR PAGO
exports.registrarPago = async (req, res) => {
    try {
        const { id } = req.params; // ID del crédito desde el cual se registra el pago 
        const {
            montoPagado, fechaPago, pagoSolidario, miembro: beneficiarioId, beneficiario, beneficiarioId: beneficiarioIdAlt, metodoPago,
            efectivoCredito, transferenciaCredito, tarjetaCredito, depositoCredito,
            montoSolidario, efectivoSolidario, transferenciaSolidario, tarjetaSolidario, depositoSolidario,
            montoAhorro, efectivoAhorro, transferenciaAhorro, tarjetaAhorro, depositoAhorro,
            recuperacionSolidario, numeroRecibo, ubicacion
        } = req.body;

        const beneficiariosSolidarios = Array.isArray(req.body.beneficiariosSolidarios)
            ? req.body.beneficiariosSolidarios
            : Array.isArray(req.body.beneficiarios)
                ? req.body.beneficiarios
                : undefined;

        const beneficiarioFinal = beneficiarioId
            || beneficiario
            || beneficiarioIdAlt
            || (req.body.beneficiario && req.body.beneficiario.miembro)
            || (Array.isArray(beneficiariosSolidarios) && beneficiariosSolidarios[0] && beneficiariosSolidarios[0].miembro);

        // 1. Obtener el crédito 
        const creditoOrigen = await Credito.findById(id);
        if (!creditoOrigen) {
            logWarn(req, 'REGISTRAR_PAGO_ORIGEN_NOT_FOUND', 'Crédito de origen no encontrado para registrar pago', { id, body: req.body });
            return res.status(404).json({ ok: false, msg: 'Crédito de origen no encontrado' });
        }

        // --- NORMALIZACIÓN DE MONTOS ---
        // Si es pago solidario, aseguramos que el monto solidario no se contabilice como pago normal
        let montoCreditoNum = Number(montoPagado) || 0;
        let montoSolidarioNum = Number(montoSolidario) || 0;
        const montoAhorroNum = Number(montoAhorro) || 0;

        if (pagoSolidario) {
            // Caso común: el frontend envía el monto solidario en montoPagado
            if (montoSolidarioNum === 0 && montoCreditoNum > 0) {
                montoSolidarioNum = montoCreditoNum;
                montoCreditoNum = 0;
            }

            // Si el frontend envía el mismo valor en ambos campos, no restamos el solidario
            if (montoSolidarioNum > 0 && montoCreditoNum === montoSolidarioNum) {
                montoCreditoNum = 0;
            }
        }

        const sumaTotal = montoCreditoNum + montoSolidarioNum + montoAhorroNum;

        // --- MANEJO DE CRÉDITO INDIVIDUAL ---
        if (creditoOrigen.tipoCredito === 'Individual') {
            if (creditoOrigen.estado === 'Liquidado' && montoCreditoNum > 0) {
                logWarn(req, 'REGISTRAR_PAGO_INDIVIDUAL_LIQUIDADO', 'Intento de abonar a crédito Individual ya liquidado', { creditoId: id, montoCreditoNum });
                return res.status(400).json({ ok: false, msg: 'El crédito ya está liquidado' });
            }
            if (sumaTotal <= 0) {
                logWarn(req, 'REGISTRAR_PAGO_INDIVIDUAL_MONTO_CERO', 'Monto total ingresado es 0 o menor', { creditoId: id, body: req.body });
                return res.status(400).json({ ok: false, msg: 'El monto total ingresado debe ser mayor a 0' });
            }

            // Validar duplicado: mismo monto, método y fecha (mismo día)
            const fechaPagoObj = fechaPago ? new Date(fechaPago) : new Date();
            const existeDuplicado = (creditoOrigen.pagos || []).some(p => {
                const fechaPagoExistente = new Date(p.fechaPago);
                return (
                    fechaPagoExistente.toDateString() === fechaPagoObj.toDateString() &&
                    p.montoPagado === montoCreditoNum &&
                    p.metodoPago === (metodoPago || 'EFECTIVO') &&
                    p.montoSolidario === montoSolidarioNum &&
                    p.montoAhorro === montoAhorroNum
                );
            });
            if (existeDuplicado) {
                logWarn(req, 'REGISTRAR_PAGO_INDIVIDUAL_DUPLICADO', 'Pago duplicado detectado para crédito individual en la misma fecha', {
                    creditoId: id,
                    montoCredito: montoCreditoNum,
                    fecha: fechaPagoObj.toISOString(),
                    metodoPago
                });
                return res.status(400).json({ ok: false, msg: 'Ya existe un pago igual registrado para este crédito en el mismo día.' });
            }

            const numeroPago = (creditoOrigen.pagos || []).length + 1;
            const saldoAnterior = creditoOrigen.saldoPendiente;
            const nuevoPago = {
                numeroPago,
                montoPagado: montoCreditoNum,
                efectivoCredito: efectivoCredito || 0,
                transferenciaCredito: transferenciaCredito || 0,
                tarjetaCredito: tarjetaCredito || 0,
                depositoCredito: depositoCredito || 0,

                pagoSolidario: !!pagoSolidario,
                montoSolidario: montoSolidarioNum,
                efectivoSolidario: efectivoSolidario || 0,
                transferenciaSolidario: transferenciaSolidario || 0,
                tarjetaSolidario: tarjetaSolidario || 0,
                depositoSolidario: depositoSolidario || 0,

                montoAhorro: montoAhorroNum,
                efectivoAhorro: efectivoAhorro || 0,
                transferenciaAhorro: transferenciaAhorro || 0,
                tarjetaAhorro: tarjetaAhorro || 0,
                depositoAhorro: depositoAhorro || 0,

                recuperacionSolidario: !!recuperacionSolidario,

                fechaPago: fechaPago || new Date(),
                metodoPago: metodoPago || 'EFECTIVO',

                numeroRecibo: numeroRecibo || null,
                totalPagado: (creditoOrigen.pagos || []).reduce((acc, p) => acc + (p.montoPagado || 0), 0) + montoCreditoNum,
                ...(ubicacion ? { ubicacion } : {})
            };

            creditoOrigen.pagos.push(nuevoPago);
            creditoOrigen.saldoPendiente -= montoCreditoNum;

            // Actualizar saldo solidario si aplica (Individual)
            if (pagoSolidario) {
                if (recuperacionSolidario) {
                    creditoOrigen.saldoSolidario = Math.max(0, (creditoOrigen.saldoSolidario || 0) - montoCreditoNum);
                } else {
                    creditoOrigen.saldoSolidario = (creditoOrigen.saldoSolidario || 0) + montoSolidarioNum;
                    // Auto-asignar quién presta el solidario (el miembro del crédito)
                    nuevoPago.quienPrestoSolidario = creditoOrigen.miembro;
                }
            }

            if (montoAhorroNum > 0) {
                creditoOrigen.ahorro.montoTotal = (creditoOrigen.ahorro.montoTotal || 0) + montoAhorroNum;
            }

            if (creditoOrigen.saldoPendiente <= 0) {
                creditoOrigen.saldoPendiente = 0;
                creditoOrigen.estado = 'Liquidado';
            }

            await creditoOrigen.save();

            logAccion(req, 'REGISTRAR_PAGO_INDIVIDUAL', {
                descripcion: `Pago Individual # ${numeroPago} registrado en Crédito ${id} por $${montoCreditoNum} (Ahorro: $${montoAhorroNum})`,
                datos: { creditoId: id, montoCreditoNum, montoAhorroNum, metodoPago, numeroRecibo },
                resultado: {
                    numeroPago,
                    saldoAnterior,
                    nuevoSaldo: creditoOrigen.saldoPendiente,
                    estado: creditoOrigen.estado,
                    totalPagosEnCredito: creditoOrigen.pagos.length
                }
            });

            return res.json({
                ok: true,
                msg: 'Pago registrado correctamente (Individual)',
                credito: creditoOrigen
            });
        }
        // --- FIN DE MANEJO DE CRÉDITO INDIVIDUAL ---

        // --- MANEJO DE MÚLTIPLES BENEFICIARIOS (APOYO SOLIDARIO) ---
        if (pagoSolidario && !recuperacionSolidario && Array.isArray(beneficiariosSolidarios)) {
            let totalSolidarioOtorgado = 0;
            const detallesBeneficiariosAplicados = [];
            const beneficiariosNoEncontrados = [];

            for (const item of beneficiariosSolidarios) {
                const bId = item.miembro;
                const bMonto = Number(item.monto);

                const creditoDestino = await Credito.findOne({ miembro: bId, estado: 'Activo' });
                if (creditoDestino) {
                    // Validar duplicado para cada beneficiario
                    const fechaPagoObj = fechaPago ? new Date(fechaPago) : new Date();
                    const existeDuplicado = (creditoDestino.pagos || []).some(p => {
                        const fechaPagoExistente = new Date(p.fechaPago);
                        // Solo considerar duplicado si el mismo originador ya registró el mismo solidario ese día
                        const mismoOrigen = p.quienPrestoSolidario && creditoOrigen.miembro && p.quienPrestoSolidario.toString() === creditoOrigen.miembro.toString();
                        return (
                            fechaPagoExistente.toDateString() === fechaPagoObj.toDateString() &&
                            p.montoSolidario === bMonto &&
                            p.metodoPago === (metodoPago || 'EFECTIVO') &&
                            mismoOrigen
                        );
                    });
                    if (existeDuplicado) {
                        logWarn(req, 'SOLIDARIO_MULTIPLE_DUPLICADO_OMITIDO', `Pago solidario duplicado omitido para miembro beneficiario ${bId}`, { bMonto, metodoPago });
                        continue; // Saltar este beneficiario duplicado
                    }
                    const numeroPagoB = (creditoDestino.pagos || []).length + 1;
                    const nuevoPagoDestino = {
                        numeroPago: numeroPagoB,
                        montoPagado: 0,
                        efectivoCredito: 0,
                        transferenciaCredito: 0,
                        tarjetaCredito: 0,
                        depositoCredito: 0,

                        pagoSolidario: true,
                        montoSolidario: bMonto,
                        efectivoSolidario: item.efectivoSolidario || (metodoPago === 'EFECTIVO' ? bMonto : 0),
                        transferenciaSolidario: item.transferenciaSolidario || (metodoPago === 'TRANSFERENCIA' ? bMonto : 0),
                        tarjetaSolidario: item.tarjetaSolidario || (metodoPago === 'TARJETA' ? bMonto : 0),
                        depositoSolidario: item.depositoSolidario || (metodoPago === 'DEPOSITO' ? bMonto : 0),

                        montoAhorro: 0,
                        efectivoAhorro: 0,
                        transferenciaAhorro: 0,
                        tarjetaAhorro: 0,
                        depositoAhorro: 0,

                        fechaPago: fechaPago || new Date(),
                        metodoPago: metodoPago || 'EFECTIVO',
                        totalPagado: (creditoDestino.pagos || []).reduce((acc, p) => acc + (p.montoPagado || 0) + (p.montoSolidario || 0), 0) + bMonto,
                        // Auto-asignar quién presta (desde el crédito de origen)
                        quienPrestoSolidario: creditoOrigen.miembro,
                        numeroRecibo: numeroRecibo || null,
                        ...(ubicacion ? { ubicacion } : {})
                    };

                    creditoDestino.pagos.push(nuevoPagoDestino);
                    creditoDestino.saldoPendiente -= bMonto;
                    creditoDestino.saldoSolidario = (creditoDestino.saldoSolidario || 0) + bMonto;

                    if (creditoDestino.saldoPendiente <= 0) {
                        creditoDestino.saldoPendiente = 0;
                        creditoDestino.estado = 'Liquidado';
                    }
                    await creditoDestino.save();
                    totalSolidarioOtorgado += bMonto;
                    detallesBeneficiariosAplicados.push({ miembroId: bId, creditoDestinoId: creditoDestino._id, monto: bMonto });
                } else {
                    beneficiariosNoEncontrados.push({ miembroId: bId, monto: bMonto });
                    logWarn(req, 'SOLIDARIO_BENEFICIARIO_SIN_CREDITO_ACTIVO', `No se encontró crédito Activo para miembro beneficiario ${bId}. No se abonó el monto solidario $${bMonto}`, {
                        miembroId: bId,
                        monto: bMonto,
                        creditoOrigenId: id
                    });
                }
            }

            // Registrar el pago en el crédito de origen (el que presta)
            const numeroPagoOrigen = (creditoOrigen.pagos || []).length + 1;
            const pagoMaster = {
                numeroPago: numeroPagoOrigen,
                montoPagado: 0,
                efectivoCredito: efectivoCredito || 0,
                transferenciaCredito: transferenciaCredito || 0,
                tarjetaCredito: tarjetaCredito || 0,
                depositoCredito: depositoCredito || 0,

                pagoSolidario: true,
                montoSolidario: totalSolidarioOtorgado,
                efectivoSolidario: efectivoSolidario || 0,
                transferenciaSolidario: transferenciaSolidario || 0,
                tarjetaSolidario: tarjetaSolidario || 0,
                depositoSolidario: depositoSolidario || 0,

                montoAhorro: montoAhorroNum,
                efectivoAhorro: efectivoAhorro || 0,
                transferenciaAhorro: transferenciaAhorro || 0,
                tarjetaAhorro: tarjetaAhorro || 0,
                depositoAhorro: depositoAhorro || 0,

                beneficiariosSolidarios: beneficiariosSolidarios,
                // Auto-asignar quién presta (desde su propio miembro)
                quienPrestoSolidario: creditoOrigen.miembro,
                fechaPago: fechaPago || new Date(),
                metodoPago: metodoPago || 'EFECTIVO',
                totalPagado: (creditoOrigen.pagos || []).reduce((acc, p) => acc + (p.montoPagado || 0) + (p.montoSolidario || 0), 0) + montoCreditoNum,
                numeroRecibo: numeroRecibo || null,
                ...(ubicacion ? { ubicacion } : {})
            };

            creditoOrigen.pagos.push(pagoMaster);
            if (montoCreditoNum > 0) {
                creditoOrigen.saldoPendiente -= montoCreditoNum;
            }
            if (montoAhorroNum > 0) {
                creditoOrigen.ahorro.montoTotal = (creditoOrigen.ahorro.montoTotal || 0) + montoAhorroNum;
            }
            if (creditoOrigen.saldoPendiente <= 0) {
                creditoOrigen.saldoPendiente = 0;
                creditoOrigen.estado = 'Liquidado';
            }
            await creditoOrigen.save();

            logAccion(req, 'REGISTRAR_PAGO_SOLIDARIO_MULTIPLE', {
                descripcion: `Apoyo solidario múltiple registrado desde crédito ${id}. Total otorgado: $${totalSolidarioOtorgado} a ${detallesBeneficiariosAplicados.length} beneficiario(s)`,
                datos: {
                    creditoOrigenId: id,
                    beneficiariosEnviados: beneficiariosSolidarios,
                    totalSolidarioOtorgado,
                    montoAhorro: montoAhorroNum
                },
                resultado: {
                    beneficiariosAplicados: detallesBeneficiariosAplicados,
                    beneficiariosFallidos: beneficiariosNoEncontrados,
                    creditoOrigenSaldo: creditoOrigen.saldoPendiente
                }
            });

            return res.json({
                ok: true,
                msg: 'Apoyos solidarios registrados correctamente',
                credito: creditoOrigen
            });
        }

        let creditoDestino;

        if (pagoSolidario && (montoSolidarioNum > 0 || beneficiarioFinal)) {
            // Caso Solidario: El dinero se abona al crédito del beneficiario
            if (!beneficiarioFinal) {
                logWarn(req, 'REGISTRAR_PAGO_SOLIDARIO_SIN_BENEFICIARIO', 'Debe especificar el miembro beneficiario del solidario', { body: req.body });
                return res.status(400).json({ ok: false, msg: 'Debe especificar el miembro beneficiario del solidario (campo miembro o beneficiario)' });
            }

            // Buscar el crédito activo del beneficiario
            creditoDestino = await Credito.findOne({ miembro: beneficiarioFinal, estado: 'Activo' });

            if (!creditoDestino) {
                logWarn(req, 'REGISTRAR_PAGO_SOLIDARIO_DESTINO_NOT_FOUND', `No se encontró crédito Activo para el beneficiario seleccionado: ${beneficiarioFinal}`, {
                    beneficiario: beneficiarioFinal,
                    montoSolidario: montoSolidarioNum,
                    creditoOrigenId: id
                });
                return res.status(404).json({ ok: false, msg: 'No se encontró un crédito activo para el beneficiario seleccionado' });
            }
        } else {
            // Caso Normal: El dinero se abona al mismo crédito
            creditoDestino = creditoOrigen;
        }

        // --- VALIDACIONES DE ESTADO Y MONTOS ---
        if (sumaTotal <= 0) {
            logWarn(req, 'REGISTRAR_PAGO_MONTO_CERO', 'El pago total debe ser mayor a 0', { body: req.body });
            return res.status(400).json({ ok: false, msg: 'El pago total debe ser mayor a 0' });
        }

        // El abono al CRÉDITO se toma según si es solidario o no
        const abonoAlCredito = (pagoSolidario && !recuperacionSolidario) ? montoSolidarioNum : montoCreditoNum;

        // --- Validación de duplicado para pagos normales y solidarios ---
        const fechaPagoObj = fechaPago ? new Date(fechaPago) : new Date();
        const existeDuplicado = (creditoDestino.pagos || []).some(p => {
            const fechaPagoExistente = new Date(p.fechaPago);
            const mismoOrigenSolidario = pagoSolidario && !recuperacionSolidario && p.quienPrestoSolidario && creditoOrigen.miembro
                ? p.quienPrestoSolidario.toString() === creditoOrigen.miembro.toString()
                : true;
            return (
                fechaPagoExistente.toDateString() === fechaPagoObj.toDateString() &&
                p.montoPagado === montoCreditoNum &&
                p.montoSolidario === montoSolidarioNum &&
                p.metodoPago === (metodoPago || 'EFECTIVO') &&
                p.montoAhorro === montoAhorroNum &&
                mismoOrigenSolidario
            );
        });
        if (existeDuplicado) {
            logWarn(req, 'REGISTRAR_PAGO_DUPLICADO', 'Ya existe un pago igual registrado para este crédito en el mismo día', {
                creditoDestinoId: creditoDestino._id,
                montoPagado: montoCreditoNum,
                montoSolidario: montoSolidarioNum,
                fecha: fechaPagoObj.toISOString(),
                metodoPago
            });
            return res.status(400).json({ ok: false, msg: 'Ya existe un pago igual registrado para este crédito en el mismo día.' });
        }

        // --- CREACIÓN DEL REGISTRO DE PAGO ---
        let numeroPago;
        const pagosDestino = creditoDestino.pagos || [];
        if (pagosDestino.length === 0) {
            numeroPago = 1;
        } else {
            const ultimoPago = pagosDestino[pagosDestino.length - 1];
            const fechaAhora = fechaPagoObj;
            const fechaUltimo = new Date(ultimoPago.fechaPago);

            if (fechaAhora.toDateString() === fechaUltimo.toDateString()) {
                numeroPago = ultimoPago.numeroPago;
            } else {
                numeroPago = (ultimoPago.numeroPago || 0) + 1;
            }
        }

        // Calcular el historial del total pagado
        const totalHistorico = pagosDestino.reduce((acc, p) => acc + (p.montoPagado || 0) + (p.montoSolidario || 0), 0);
        const nuevoTotalPagado = totalHistorico + abonoAlCredito;
        const saldoAnteriorDestino = creditoDestino.saldoPendiente;

        const nuevoPago = {
            numeroPago,
            montoPagado: montoCreditoNum,
            efectivoCredito: efectivoCredito || 0,
            transferenciaCredito: transferenciaCredito || 0,
            tarjetaCredito: tarjetaCredito || 0,
            depositoCredito: depositoCredito || 0,

            pagoSolidario: !!pagoSolidario,
            montoSolidario: montoSolidarioNum,
            efectivoSolidario: efectivoSolidario || 0,
            transferenciaSolidario: transferenciaSolidario || 0,
            tarjetaSolidario: tarjetaSolidario || 0,
            depositoSolidario: depositoSolidario || 0,

            montoAhorro: montoAhorroNum,
            efectivoAhorro: efectivoAhorro || 0,
            transferenciaAhorro: transferenciaAhorro || 0,
            tarjetaAhorro: tarjetaAhorro || 0,
            depositoAhorro: depositoAhorro || 0,

            recuperacionSolidario: !!recuperacionSolidario,

            fechaPago: fechaPago || new Date(),
            metodoPago: metodoPago || 'EFECTIVO',
            numeroRecibo: numeroRecibo || null,
            totalPagado: nuevoTotalPagado,

            // Solo asignar si es un apoyo a un TERCERO, no si es recuperación a uno mismo
            quienPrestoSolidario: (pagoSolidario && !recuperacionSolidario) ? creditoOrigen.miembro : undefined,

            // Si es el que presta, guardamos a quién ayudó (si el frontend enviara un array de beneficiarios)
            // Si es recuperación, guardamos a quién le devolvió
            beneficiariosSolidarios: ((pagoSolidario && !recuperacionSolidario) || recuperacionSolidario) && beneficiariosSolidarios ? beneficiariosSolidarios : undefined,

            ...(ubicacion ? { ubicacion } : {})
        };

        // Agregar pago al crédito de destino
        creditoDestino.pagos.push(nuevoPago);

        // Restar saldo al crédito de destino
        // Si es recuperación, restamos montoCreditoNum. Si es apoyo, restamos montoSolidarioNum.
        const esSolidarioMismoCredito = pagoSolidario && !recuperacionSolidario && creditoDestino._id && creditoOrigen._id && creditoDestino._id.toString() === creditoOrigen._id.toString();
        if (!esSolidarioMismoCredito) {
            creditoDestino.saldoPendiente -= abonoAlCredito;
        }

        // --- GESTIÓN DE SALDO SOLIDARIO ---
        if (recuperacionSolidario) {
            // Si es recuperación, restamos de su deuda solidaria el monto que está pagando
            // (Usamos abonoAlCredito que en recuperación es montoCreditoNum)
            creditoDestino.saldoSolidario = Math.max(0, (creditoDestino.saldoSolidario || 0) - abonoAlCredito);
        } else if (pagoSolidario) {
            // Si es un apoyo que recibe, aumenta su deuda solidaria
            creditoDestino.saldoSolidario = (creditoDestino.saldoSolidario || 0) + montoSolidarioNum;
        }

        if (montoAhorroNum > 0) {
            creditoDestino.ahorro.montoTotal = (creditoDestino.ahorro.montoTotal || 0) + montoAhorroNum;
        }

        // Verificar si se liquidó el crédito de destino
        if (creditoDestino.saldoPendiente <= 0) {
            creditoDestino.saldoPendiente = 0;
            creditoDestino.estado = 'Liquidado';
        }

        await creditoDestino.save();

        logAccion(req, 'REGISTRAR_PAGO', {
            descripcion: `Pago #${numeroPago} registrado en Crédito ${creditoDestino._id} (Monto: $${montoCreditoNum}, Solidario: $${montoSolidarioNum}, Ahorro: $${montoAhorroNum})`,
            datos: {
                creditoDestinoId: creditoDestino._id,
                creditoOrigenId: id,
                pagoSolidario: !!pagoSolidario,
                recuperacionSolidario: !!recuperacionSolidario,
                montoPagado: montoCreditoNum,
                montoSolidario: montoSolidarioNum,
                montoAhorro: montoAhorroNum,
                metodoPago,
                numeroRecibo
            },
            resultado: {
                numeroPago,
                saldoAnterior: saldoAnteriorDestino,
                nuevoSaldoPendiente: creditoDestino.saldoPendiente,
                saldoSolidario: creditoDestino.saldoSolidario,
                estado: creditoDestino.estado,
                totalPagos: creditoDestino.pagos.length
            }
        });

        res.json({
            ok: true,
            msg: (pagoSolidario && !recuperacionSolidario) ? 'Apoyo solidario aplicado al beneficiario' : 'Pago registrado correctamente',
            credito: creditoDestino
        });

    } catch (error) {
        logError(req, 'REGISTRAR_PAGO_ERROR', error, { creditoId: req.params.id, body: req.body });
        res.status(500).json({
            ok: false,
            msg: 'Error al registrar pago',
            error: error.message
        });
    }
};

// PAGOS CON UBICACIÓN (para el mapa del admin)
exports.getPagosConUbicacion = async (req, res) => {
    try {
        const creditos = await Credito.find({
            'pagos.ubicacion.latitud': { $exists: true }
        })
            .populate({
                path: 'miembro',
                select: 'nombre apellidos rol',
                populate: {
                    path: 'grupo',
                    select: 'nombre clave asesor',
                    populate: { path: 'asesor', select: 'username nombre' }
                }
            })
            .populate({ path: 'cliente', select: 'nombre' })
            .lean();

        const puntos = [];

        for (const credito of creditos) {
            for (const pago of (credito.pagos || [])) {
                if (!pago.ubicacion?.latitud || !pago.ubicacion?.longitud) continue;

                // Nombre del beneficiario
                let nombrePersona = 'Desconocido';
                let grupo = null;
                let asesor = null;

                if (credito.miembro) {
                    const m = credito.miembro;
                    nombrePersona = `${m.nombre || ''} ${m.apellidos || ''}`.trim();
                    if (m.grupo) {
                        grupo = m.grupo.nombre || m.grupo.clave || null;
                        asesor = m.grupo.asesor?.username || null;
                    }
                } else if (credito.cliente) {
                    nombrePersona = credito.cliente.nombre || 'Cliente';
                }

                puntos.push({
                    creditoId: credito._id,
                    pagoId: pago._id,
                    numeroPago: pago.numeroPago,
                    fechaPago: pago.fechaPago,
                    montoPagado: pago.montoPagado || 0,
                    montoSolidario: pago.montoSolidario || 0,
                    totalPagado: pago.totalPagado || 0,
                    metodoPago: pago.metodoPago,
                    numeroRecibo: pago.numeroRecibo,
                    tipoCredito: credito.tipoCredito,
                    persona: nombrePersona,
                    grupo,
                    asesor,
                    ubicacion: pago.ubicacion
                });
            }
        }

        // Ordenar por fecha descendente
        puntos.sort((a, b) => new Date(b.fechaPago) - new Date(a.fechaPago));

        res.json({ ok: true, total: puntos.length, puntos });
    } catch (error) {
        logError(req, 'GET_PAGOS_CON_UBICACION_ERROR', error);
        res.status(500).json({ ok: false, msg: 'Error al obtener pagos con ubicación', error: error.message });
    }
};

// REGISTRAR ABONO A GARANTÍA
exports.registrarAbonoGarantia = async (req, res) => {
    try {
        const { id } = req.params;
        const { monto, fecha } = req.body;

        const credito = await Credito.findById(id);

        if (!credito) {
            logWarn(req, 'ABONO_GARANTIA_CREDITO_NOT_FOUND', 'Crédito no encontrado para abono de garantía', { id, body: req.body });
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        if (monto <= 0) {
            logWarn(req, 'ABONO_GARANTIA_MONTO_INVALIDO', 'El monto de garantía debe ser mayor a 0', { id, monto });
            return res.status(400).json({
                ok: false,
                msg: 'El monto debe ser mayor a 0'
            });
        }

        // Agregar pago a la lista de garantía
        if (!credito.garantia || typeof credito.garantia === 'number') {
            const montoActual = typeof credito.garantia === 'number' ? credito.garantia : 0;
            credito.garantia = {
                montoCalculado: montoActual,
                pagos: []
            };
        } else if (!credito.garantia.pagos) {
            credito.garantia.pagos = [];
        }

        credito.garantia.pagos.push({
            monto,
            fecha: fecha || new Date()
        });

        await credito.save();

        logAccion(req, 'REGISTRAR_ABONO_GARANTIA', {
            descripcion: `Abono a garantía de $${monto} registrado en Crédito ${id}`,
            datos: { creditoId: id, monto, fecha },
            resultado: { creditoId: id, totalPagosGarantia: credito.garantia.pagos.length }
        });

        res.json({
            ok: true,
            msg: 'Abono a garantía registrado correctamente',
            credito
        });

    } catch (error) {
        logError(req, 'REGISTRAR_ABONO_GARANTIA_ERROR', error, { creditoId: req.params.id, body: req.body });
        res.status(500).json({
            ok: false,
            msg: 'Error al registrar abono a garantía',
            error: error.message
        });
    }
};

// helper interno
function generarCalendarioPagos(fechaPrimerPago, semanas) {
    const fechas = [];
    const fechaBase = new Date(fechaPrimerPago);

    for (let i = 0; i < semanas; i++) {
        const nuevaFecha = new Date(fechaBase);
        nuevaFecha.setDate(fechaBase.getDate() + (i * 7));

        fechas.push({
            numeroPago: i + 1,
            fechaProgramada: nuevaFecha
        });
    }

    return fechas;
}

// helper interno para calcular semana actual (o periodo actual)
function calcularSemanaActual(fechaPrimerPago, frecuenciaPago, fechaReferencia = new Date()) {
    if (!fechaPrimerPago) return "1";

    const fPrimerPago = new Date(fechaPrimerPago);
    const fActual = new Date(fechaReferencia);

    // Normalizar horas para evitar problemas de desfase horario
    fPrimerPago.setUTCHours(0, 0, 0, 0);
    fActual.setUTCHours(0, 0, 0, 0);

    const diferenciaMilisegundos = fActual.getTime() - fPrimerPago.getTime();
    const diasTranscurridos = Math.floor(diferenciaMilisegundos / (1000 * 60 * 60 * 24));

    let divisorDias = 7; // Semanal por defecto
    if (frecuenciaPago === 'Quincenal' || frecuenciaPago === 'Bisemanal') {
        divisorDias = 14;
    } else if (frecuenciaPago === 'Mensual') {
        divisorDias = 30;
    }

    if (diasTranscurridos <= 0) {
        return "1"; // Si todavía no llega la fecha del primer pago
    }

    // Calcula cuántos periodos han pasado
    const periodoActual = Math.floor(diasTranscurridos / divisorDias) + 1;
    return periodoActual.toString();
}

/*
* Ahorro
*/
exports.registrarAhorro = async (req, res) => {
    try {
        const { id } = req.params;
        const { monto, fecha, efectivo, transferencia, deposito, tarjeta, ubicacion } = req.body;

        const credito = await Credito.findById(id);

        if (!credito) {
            logWarn(req, 'REGISTRAR_AHORRO_NOT_FOUND', 'Crédito no encontrado para registrar ahorro', { id, body: req.body });
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        if (monto <= 0) {
            logWarn(req, 'REGISTRAR_AHORRO_MONTO_INVALIDO', 'El monto de ahorro debe ser mayor a 0', { id, monto });
            return res.status(400).json({
                ok: false,
                msg: 'El monto debe ser mayor a 0'
            });
        }

        if (!credito.ahorro) {
            credito.ahorro = { montoTotal: 0, pagosAhorro: [] };
        }
        if (!credito.ahorro.pagosAhorro) {
            credito.ahorro.pagosAhorro = [];
        }

        // Agregar pago a la lista de ahorro
        credito.ahorro.pagosAhorro.push({
            monto,
            efectivo: efectivo || 0,
            transferencia: transferencia || 0,
            tarjeta: tarjeta || 0,
            deposito: deposito || 0,
            fecha: fecha || new Date(),
            ubicacion
        });

        // Actualizar el monto total sumando todos los pagos
        credito.ahorro.montoTotal = credito.ahorro.pagosAhorro.reduce((total, p) => total + (p.monto || 0), 0);

        await credito.save();

        logAccion(req, 'REGISTRAR_AHORRO', {
            descripcion: `Ahorro de $${monto} registrado en Crédito ${id} (Nuevo total ahorro: $${credito.ahorro.montoTotal})`,
            datos: { creditoId: id, monto, efectivo, transferencia, deposito, tarjeta, fecha },
            resultado: { creditoId: id, nuevoMontoTotalAhorro: credito.ahorro.montoTotal, totalPagosAhorro: credito.ahorro.pagosAhorro.length }
        });

        res.json({
            ok: true,
            msg: 'Ahorro registrado correctamente',
            credito
        });

    } catch (error) {
        logError(req, 'REGISTRAR_AHORRO_ERROR', error, { creditoId: req.params.id, body: req.body });
        res.status(500).json({
            ok: false,
            msg: 'Error al registrar ahorro',
            error: error.message
        });
    }
};

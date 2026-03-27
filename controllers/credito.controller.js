const Credito = require('../models/Credito');
const Miembro = require('../models/Miembro');
const Grupo = require('../models/Grupo');


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
            //garantia,
            ahorro,
            fechaPrimerPago,
            tasaInteres,
            montoSolicitado
        } = req.body;

        const garantiaCalculada = montoSolicitado * 0.05;
        // Si viene pagoPactado en el body se utiliza, de lo contrario fallback a /16
        const pagoPactadoCalc = req.body.pagoPactado || (montoSolicitado / 16);
        // --- VALIDACIÓN LÓGICA DE TIPO DE CLIENTE ---
        if (tipoCredito === 'Individual') {
            if (!cliente) {
                return res.status(400).json({ ok: false, msg: 'Para un crédito Individual debe seleccionar un Cliente' });
            }
            // Limpiar miembro
            req.body.miembro = null;
        } else {
            // Si es CC, R o 8S (Grupales)
            if (!miembro) {
                return res.status(400).json({ ok: false, msg: 'Para este tipo de crédito debe seleccionar un Miembro del grupo' });
            }
            // Limpiar cliente
            req.body.cliente = null;
        }

        // Validar semanas
        let numSemanas = semanas || (tipoCredito === '8S' ? 8 : 16);
        if (tipoCredito === 'R') {
            numSemanas = 16;
        }
        const saldoTotalCalc = tipoCredito === 'Individual' && req.body.saldoTotal
            ? req.body.saldoTotal
            : (pagoPactadoCalc * numSemanas);

        const mongoose = require('mongoose');
        const nuevoCredito = new Credito({
            miembro: tipoCredito !== 'Individual' ? miembro : new mongoose.Types.ObjectId(),
            cliente: tipoCredito === 'Individual' ? cliente : null,
            ciclo,
            tipoCredito,
            semanas: numSemanas,
            pagoPactado: pagoPactadoCalc,
            saldoTotal: saldoTotalCalc,
            saldoPendiente: saldoTotalCalc,
            garantia: garantiaCalculada,
            tasaInteres,
            montoSolicitado,
            ahorro: {
                montoTotal: ahorro,
                pagosAhorro: []
            },
            fechaPrimerPago,
            frecuenciaPago: req.body.frecuenciaPago || 'Semanal',
            garantiaPredial: req.body.garantiaPredial || '',
            equivalenciaMeses: req.body.equivalenciaMeses || 4,
            grupoOpcional: req.body.grupoOpcional || '',
            pagos: []
        });

        await nuevoCredito.save();

        res.status(201).json({
            ok: true,
            credito: nuevoCredito
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: 'Error al crear crédito',
            error: error.message
        });
    }
};


// READ ALL
exports.obtenerCreditos = async (req, res) => {
    try {
        const creditos = await Credito.find()
            .populate('miembro');

        res.json({
            ok: true,
            creditos
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: 'Error al obtener créditos'
        });
    }
};


// READ ALL
exports.obtenerCreditos = async (req, res) => {
    try {
        const creditos = await Credito.find()
            .populate('miembro');

        res.json({
            ok: true,
            creditos
        });

    } catch (error) {
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
            .populate('miembro');

        if (!credito) {
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        res.json({
            ok: true,
            credito
        });

    } catch (error) {
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

        const creditoActualizado = await Credito.findByIdAndUpdate(
            id,
            req.body,
            { new: true }
        );

        if (!creditoActualizado) {
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        res.json({
            ok: true,
            credito: creditoActualizado
        });

    } catch (error) {
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
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        res.json({
            ok: true,
            msg: 'Crédito eliminado correctamente'
        });

    } catch (error) {
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
        const { montoPagado, fechaPago, pagoSolidario, miembro: beneficiarioId, metodoPago } = req.body;

        // 1. Obtener el crédito 
        const creditoOrigen = await Credito.findById(id);
        if (!creditoOrigen) {
            return res.status(404).json({ ok: false, msg: 'Crédito de origen no encontrado' });
        }

        // --- MANEJO DE CRÉDITO INDIVIDUAL ---
        if (creditoOrigen.tipoCredito === 'Individual') {
            if (creditoOrigen.estado === 'Liquidado') {
                return res.status(400).json({ ok: false, msg: 'El crédito ya está liquidado' });
            }
            if (montoPagado <= 0) {
                return res.status(400).json({ ok: false, msg: 'El monto debe ser mayor a 0' });
            }
            if (montoPagado > creditoOrigen.saldoPendiente) {
                return res.status(400).json({ ok: false, msg: `El monto excede el saldo pendiente (${creditoOrigen.saldoPendiente})` });
            }

            const numeroPago = creditoOrigen.pagos.length + 1;
            const nuevoPago = {
                numeroPago,
                montoPagado,
                fechaPago: fechaPago || new Date(),
                pagoSolidario: false,
                metodoPago: metodoPago || 'Efectivo'
            };

            creditoOrigen.pagos.push(nuevoPago);
            creditoOrigen.saldoPendiente -= montoPagado;

            if (creditoOrigen.saldoPendiente <= 0) {
                creditoOrigen.saldoPendiente = 0;
                creditoOrigen.estado = 'Liquidado';
            }

            await creditoOrigen.save();

            return res.json({
                ok: true,
                msg: 'Pago registrado correctamente (Individual)',
                credito: creditoOrigen
            });
        }
        // --- FIN DE MANEJO DE CRÉDITO INDIVIDUAL ---

        let creditoDestino;

        if (pagoSolidario) {
            // Caso Solidario: El dinero se abona al crédito del beneficiario (enviado como 'miembro' en el body)
            if (!beneficiarioId) {
                return res.status(400).json({ ok: false, msg: 'Debe especificar el miembro beneficiario del solidario (campo miembro)' });
            }

            // Buscar el crédito activo del beneficiario
            creditoDestino = await Credito.findOne({ miembro: beneficiarioId, estado: 'Activo' });

            if (!creditoDestino) {
                return res.status(404).json({ ok: false, msg: 'No se encontró un crédito activo para el beneficiario seleccionado' });
            }
        } else {
            // Caso Normal: El dinero se abona al mismo crédito
            creditoDestino = creditoOrigen;
        }

        // --- VALIDACIONES DE ESTADO Y MONTOS ---
        if (creditoDestino.estado === 'Liquidado') {
            return res.status(400).json({ ok: false, msg: 'El crédito de destino ya está liquidado' });
        }

        if (montoPagado <= 0) {
            return res.status(400).json({ ok: false, msg: 'El monto debe ser mayor a 0' });
        }

        if (montoPagado > creditoDestino.saldoPendiente) {
            return res.status(400).json({ ok: false, msg: `El monto excede el saldo pendiente (${creditoDestino.saldoPendiente})` });
        }

        // --- CREACIÓN DEL REGISTRO DE PAGO ---
        let numeroPago;
        if (!creditoDestino.pagos || creditoDestino.pagos.length === 0) {
            numeroPago = 1;
        } else {
            const ultimoPago = creditoDestino.pagos[creditoDestino.pagos.length - 1];
            const fechaAhora = fechaPago ? new Date(fechaPago) : new Date();
            const fechaUltimo = new Date(ultimoPago.fechaPago);

            // Si es el mismo día calendario, mantenemos el mismo número de pago
            if (fechaAhora.toDateString() === fechaUltimo.toDateString()) {
                numeroPago = ultimoPago.numeroPago;
            } else {
                numeroPago = ultimoPago.numeroPago + 1;
            }
        }

        const nuevoPago = {
            numeroPago,
            montoPagado,
            fechaPago: fechaPago || new Date(),
            pagoSolidario: pagoSolidario || false,
            metodoPago: metodoPago || 'Efectivo',
            // 'miembro' en el subdocumento Pago siempre es el beneficiario
            miembro: creditoDestino.miembro,
            // 'quienPrestoSolidario' 
            quienPrestoSolidario: pagoSolidario ? creditoOrigen.miembro : undefined
        };

        // Agregar pago al crédito de destino
        creditoDestino.pagos.push(nuevoPago);

        // Restar saldo al crédito de destino
        creditoDestino.saldoPendiente -= montoPagado;

        // Verificar si se liquidó el crédito de destino
        if (creditoDestino.saldoPendiente <= 0) {
            creditoDestino.saldoPendiente = 0;
            creditoDestino.estado = 'Liquidado';
        }

        await creditoDestino.save();

        res.json({
            ok: true,
            msg: pagoSolidario ? 'Pago solidario aplicado al beneficiario' : 'Pago registrado correctamente',
            credito: creditoDestino
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: 'Error al registrar pago',
            error: error.message
        });
    }
};


// REGISTRAR ABONO A GARANTÍA
exports.registrarAbonoGarantia = async (req, res) => {
    try {
        const { id } = req.params;
        const { monto, fecha } = req.body;

        const credito = await Credito.findById(id);

        if (!credito) {
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        if (monto <= 0) {
            return res.status(400).json({
                ok: false,
                msg: 'El monto debe ser mayor a 0'
            });
        }

        // Agregar pago a la lista de garantía
        credito.garantia.pagos.push({
            monto,
            fecha: fecha || new Date()
        });

        await credito.save();

        res.json({
            ok: true,
            msg: 'Abono a garantía registrado correctamente',
            credito
        });

    } catch (error) {
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

/*
* Garantias
*/

// exports.registrarGarantia = async (req, res) => {
//     try {
//         const { id } = req.params;
//         const { monto, fecha } = req.body;

//         const credito = await Credito.findById(id);

//         if (!credito) {
//             return res.status(404).json({
//                 ok: false,
//                 msg: 'Crédito no encontrado'
//             });
//         }

//         if (monto <= 0) {
//             return res.status(400).json({
//                 ok: false,
//                 msg: 'El monto debe ser mayor a 0'
//             });
//         }

//         // Agregar pago a la lista de garantía
//         credito.garantia.pagos.push({
//             monto,
//             fecha: fecha || new Date()
//         });

//         await credito.save();

//         res.json({
//             ok: true,
//             msg: 'Garantía registrada correctamente',
//             credito
//         });

//     } catch (error) {
//         res.status(500).json({
//             ok: false,
//             msg: 'Error al registrar garantía',
//             error: error.message
//         });
//     }
// };

/*
* Ahorro
*/
exports.registrarAhorro = async (req, res) => {
    try {
        const { id } = req.params;
        const { monto, fecha } = req.body;

        const credito = await Credito.findById(id);

        if (!credito) {
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        if (monto <= 0) {
            return res.status(400).json({
                ok: false,
                msg: 'El monto debe ser mayor a 0'
            });
        }

        // Agregar pago a la lista de ahorro
        credito.ahorro.pagosAhorro.push({
            monto,
            fecha: fecha || new Date()
        });

        // Actualizar el monto total sumando todos los pagos
        credito.ahorro.montoTotal = credito.ahorro.pagosAhorro.reduce((total, p) => total + p.monto, 0);

        await credito.save();

        res.json({
            ok: true,
            msg: 'Ahorro registrado correctamente',
            credito
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: 'Error al registrar ahorro',
            error: error.message
        });
    }
};

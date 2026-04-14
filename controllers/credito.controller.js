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

        const garantiaCalculada = montoSolicitado * 0.10;
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
        const query = {
            miembro: tipoCredito !== 'Individual' ? miembro : new mongoose.Types.ObjectId(),
            ciclo,
            tipoCredito
        };

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

        // Intentar buscar y actualizar, si no existe, crear (upsert)
        // El unique index es en {miembro, ciclo, tipoCredito}.
        const creditoGuardado = await Credito.findOneAndUpdate(
            { miembro: query.miembro, ciclo: query.ciclo, tipoCredito: query.tipoCredito },
            { $set: dataToSave },
            { upsert: true, new: true, runValidators: true }
        );

        res.status(201).json({
            ok: true,
            credito: creditoGuardado
        });

    } catch (error) {
        console.error('Error en crearCredito:', error);
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

        const creditoOriginal = await Credito.findById(id);
        if (!creditoOriginal) {
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        // Por seguridad, si mandan req.body, evitamos que sobreescriban accidentalmente el historial de pagos.
        // Solo actualizamos tipoCredito, montos, semanas, tasas, etc.
        const datosActualizar = { ...req.body };
        delete datosActualizar.pagos;

        // --- AUTOMATIZACIÓN DE CÁLCULO PARA REFILL ---
        const esRefill = datosActualizar.tipoCredito === 'R' || creditoOriginal.tipoCredito === 'R';

        // Evitamos que los miembros que no actualizaron su crédito pierdan sus saldos y datos,
        // verificando si hubo algún cambio real en los parámetros de su crédito.
        const tipoCambio = datosActualizar.tipoCredito && datosActualizar.tipoCredito !== creditoOriginal.tipoCredito;
        const montoCambio = datosActualizar.montoSolicitado && parseFloat(datosActualizar.montoSolicitado) !== parseFloat(creditoOriginal.montoSolicitado);
        const semanaCambio = datosActualizar.semanaActual && parseInt(datosActualizar.semanaActual) !== parseInt(creditoOriginal.semanaActual || 1);
        const semanasCambio = datosActualizar.semanas && parseInt(datosActualizar.semanas) !== parseInt(creditoOriginal.semanas || 16);

        // Sólo recalculamos si cambiaron el tipo a Refill, o ajustaron el monto/semanas.
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
        }
        // --- FIN AUTOMATIZACIÓN ---

        const creditoActualizado = await Credito.findByIdAndUpdate(
            id,
            datosActualizar,
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
        const {
            montoPagado, fechaPago, pagoSolidario, miembro: beneficiarioId, metodoPago,
            efectivoCredito, transferenciaCredito, tarjetaCredito, depositoCredito,
            montoSolidario, efectivoSolidario, transferenciaSolidario, tarjetaSolidario, depositoSolidario,
            montoAhorro, efectivoAhorro, transferenciaAhorro, tarjetaAhorro, depositoAhorro
        } = req.body;

        // 1. Obtener el crédito 
        const creditoOrigen = await Credito.findById(id);
        if (!creditoOrigen) {
            return res.status(404).json({ ok: false, msg: 'Crédito de origen no encontrado' });
        }

        const montoCreditoNum = Number(montoPagado) || 0;
        const montoSolidarioNum = Number(montoSolidario) || 0;
        const montoAhorroNum = Number(montoAhorro) || 0;

        const sumaTotal = montoCreditoNum + montoSolidarioNum + montoAhorroNum;

        // --- MANEJO DE CRÉDITO INDIVIDUAL ---
        if (creditoOrigen.tipoCredito === 'Individual') {
            if (creditoOrigen.estado === 'Liquidado' && montoCreditoNum > 0) {
                return res.status(400).json({ ok: false, msg: 'El crédito ya está liquidado' });
            }
            if (sumaTotal <= 0) {
                return res.status(400).json({ ok: false, msg: 'El monto total ingresado debe ser mayor a 0' });
            }
            if (montoCreditoNum > creditoOrigen.saldoPendiente) {
                return res.status(400).json({ ok: false, msg: `El monto excede el saldo pendiente (${creditoOrigen.saldoPendiente})` });
            }

            const numeroPago = creditoOrigen.pagos.length + 1;
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

                fechaPago: fechaPago || new Date(),
                metodoPago: metodoPago || 'EFECTIVO',
                totalPagado: (creditoOrigen.pagos.reduce((acc, p) => acc + (p.montoPagado || 0), 0)) + montoCreditoNum,
            };

            creditoOrigen.pagos.push(nuevoPago);
            creditoOrigen.saldoPendiente -= montoCreditoNum;

            if (montoAhorroNum > 0) {
                creditoOrigen.ahorro.montoTotal = (creditoOrigen.ahorro.montoTotal || 0) + montoAhorroNum;
            }

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

        if (pagoSolidario && montoSolidarioNum > 0) {
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
        if (creditoDestino.estado === 'Liquidado' && (montoCreditoNum > 0 || montoSolidarioNum > 0)) {
            return res.status(400).json({ ok: false, msg: 'El crédito de destino ya está liquidado' });
        }

        if (sumaTotal <= 0) {
            return res.status(400).json({ ok: false, msg: 'El pago total debe ser mayor a 0' });
        }

        const abonoAlCredito = pagoSolidario ? montoSolidarioNum : montoCreditoNum;
        if (abonoAlCredito > creditoDestino.saldoPendiente) {
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

            if (fechaAhora.toDateString() === fechaUltimo.toDateString()) {
                numeroPago = ultimoPago.numeroPago;
            } else {
                numeroPago = ultimoPago.numeroPago + 1;
            }
        }

        // Calcular el historial del total pagado para este nuevo registro
        const pagosAnteriores = creditoDestino.pagos || [];
        const totalHistorico = pagosAnteriores.reduce((acc, p) => acc + (p.montoPagado || 0), 0);
        const nuevoTotalPagado = totalHistorico + abonoAlCredito;

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

            fechaPago: fechaPago || new Date(),
            metodoPago: metodoPago || 'EFECTIVO',
            totalPagado: nuevoTotalPagado,
            // 'miembro' en el subdocumento Pago siempre es el beneficiario
            miembro: creditoDestino.miembro,
            // 'quienPrestoSolidario' 
            quienPrestoSolidario: pagoSolidario ? creditoOrigen.miembro : undefined
        };

        // Agregar pago al crédito de destino
        creditoDestino.pagos.push(nuevoPago);

        // Restar saldo al crédito de destino
        creditoDestino.saldoPendiente -= abonoAlCredito;

        if (montoAhorroNum > 0) {
            creditoDestino.ahorro.montoTotal = (creditoDestino.ahorro.montoTotal || 0) + montoAhorroNum;
        }

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
        const { monto, fecha, efectivo, transferencia, deposito, tarjeta } = req.body;

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
            efectivo: efectivo || 0,
            transferencia: transferencia || 0,
            tarjeta: tarjeta || 0,
            deposito: deposito || 0,
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



// REFILL / CONVERTIR A REFILL
// exports.convertirARefill = async (req, res) => {
//     try {
//         const { id } = req.params; // ID del crédito viejo (CC o Individual)
//         const {
//             montoSolicitado,
//             pagoPactado,
//             semanas, // Si envían que va a ser a 16 semanas, etc.
//             saldoTotal,
//             tasaInteres
//         } = req.body;

//         // 1. Obtener crédito viejo
//         const creditoViejo = await Credito.findById(id);

//         if (!creditoViejo) {
//             return res.status(404).json({ ok: false, msg: 'Crédito original no encontrado' });
//         }

//         if (creditoViejo.estado === 'Liquidado') {
//             return res.status(400).json({ ok: false, msg: 'El crédito ya está liquidado, no se puede convertir a Refill' });
//         }

//         // 2. Calcular semana actual del viejo (momento en que se hace Refill)
//         const semanaInicioRefill = req.body.semanaActual || calcularSemanaActual(creditoViejo.fechaPrimerPago, creditoViejo.frecuenciaPago, new Date());

//         // 3. Variables calculadas para el Refill
//         const numSemanas = semanas || 16;
//         const pagoPactadoCalc = pagoPactado || (montoSolicitado / (numSemanas - parseInt(semanaInicioRefill) + 1));
//         const saldoTotalCalc = saldoTotal || (pagoPactadoCalc * numSemanas);
//         const garantiaCalculada = montoSolicitado * 0.10;

//         // 4. Crear el nuevo crédito 'Refill' (R)
//         const mongoose = require('mongoose');

//         const nuevoCredito = new Credito({
//             miembro: creditoViejo.miembro,
//             cliente: creditoViejo.cliente,
//             ciclo: creditoViejo.ciclo,
//             tipoCredito: 'R', // Convertimos a Refill
//             semanas: numSemanas,    // Mantenemos o cambiamos total de semanas (ej: 16)
//             pagoPactado: pagoPactadoCalc,
//             saldoTotal: saldoTotalCalc,
//             saldoPendiente: saldoTotalCalc,
//             garantia: garantiaCalculada, // Nueva garantia calculada al monto solicitado
//             tasaInteres: tasaInteres || creditoViejo.tasaInteres,
//             montoSolicitado,
//             ahorro: {
//                 montoTotal: creditoViejo.ahorro ? creditoViejo.ahorro.montoTotal : 0,
//                 // Decidí heredar el total del ahorro. En pagosAhorro puedes heredarlo o dejarlo vacío
//                 pagosAhorro: creditoViejo.ahorro ? creditoViejo.ahorro.pagosAhorro : []
//             },
//             fechaPrimerPago: creditoViejo.fechaPrimerPago, // Mantenemos la primera fecha histórica
//             frecuenciaPago: creditoViejo.frecuenciaPago,
//             garantiaPredial: creditoViejo.garantiaPredial,
//             equivalenciaMeses: creditoViejo.equivalenciaMeses,
//             grupoOpcional: creditoViejo.grupoOpcional,
//             pagos: [], // Limpiamos pagos para que la nueva hoja inicie sin marcas de pagos Refill
//             semanaActual: semanaInicioRefill // La semana en que inició este Refill
//         });

//         await nuevoCredito.save();

//         // 5. Liquidamos el crédito viejo
//         creditoViejo.estado = 'Liquidado';
//         // Podrías poner también un saldoPendiente viejo = 0 si lo deseas,
//         // pero liquidarlo suele ser suficiente para que ya no salga en cobros de Activo.
//         // creditoViejo.saldoPendiente = 0;
//         await creditoViejo.save();

//         res.status(201).json({
//             ok: true,
//             msg: 'Crédito convertido a Refill correctamente',
//             creditoAnterior: creditoViejo,
//             nuevoCreditoRefill: nuevoCredito
//         });

//     } catch (error) {
//         // En caso de que truene el unique index (miembro, ciclo, tipoCredito) por hacer 2 refills,
//         // puedes manejarlo como un error particular aquí
//         if (error.code === 11000) {
//             return res.status(400).json({
//                 ok: false,
//                 msg: 'Ya existe un crédito Refill para este miembro en este ciclo.',
//                 error: error.message
//             });
//         }
//         res.status(500).json({
//             ok: false,
//             msg: 'Error al convertir a Refill',
//             error: error.message
//         });
//     }
// };

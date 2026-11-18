const Credito = require('../models/Credito');
const Grupo = require('../models/Grupo');
const Cliente = require('../models/Cliente');
const Miembro = require('../models/Miembro');
const { logAccion, logWarn, logError } = require('../utils/loggers');
const { distribuirCuotasPago, calcularSemanaActual } = require('../helpers/distribucionPagos');

/**
 * REGISTRAR PAGO (Individual, Solidario Múltiple, Solidario Simple y Grupal)
 */
exports.registrarPago = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            montoPagado, fechaPago, pagoSolidario, miembro: beneficiarioId, beneficiario, beneficiarioId: beneficiarioIdAlt, metodoPago,
            efectivoCredito, transferenciaCredito, tarjetaCredito, depositoCredito,
            montoSolidario, efectivoSolidario, transferenciaSolidario, tarjetaSolidario, depositoSolidario,
            montoAhorro, efectivoAhorro, transferenciaAhorro, tarjetaAhorro, depositoAhorro,
            recuperacionSolidario, numeroRecibo, ubicacion, numeroPago,
            aplicaGarantia, montoGarantia
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

        const creditoOrigen = await Credito.findById(id);
        if (!creditoOrigen) {
            logWarn(req, 'REGISTRAR_PAGO_ORIGEN_NOT_FOUND', 'Crédito de origen no encontrado para registrar pago', { id, body: req.body });
            return res.status(404).json({ ok: false, msg: 'Crédito de origen no encontrado' });
        }

        let montoCreditoNum = Number(montoPagado) || 0;
        let montoSolidarioNum = Number(montoSolidario) || 0;
        const montoAhorroNum = Number(montoAhorro) || 0;

        if (pagoSolidario) {
            if (montoSolidarioNum === 0 && montoCreditoNum > 0) {
                montoSolidarioNum = montoCreditoNum;
                montoCreditoNum = 0;
            }
            if (montoSolidarioNum > 0 && montoCreditoNum === montoSolidarioNum) {
                montoCreditoNum = 0;
            }
        }

        // --- CÁLCULO DE GARANTÍA A APLICAR (INDIVIDUAL) ---
        let montoGarantiaAAplicar = 0;
        const quiereAplicarGarantia = aplicaGarantia === true || aplicaGarantia === 'true' || Number(montoGarantia) > 0;
        if (quiereAplicarGarantia && creditoOrigen.tipoCredito === 'Individual') {
            const garantiaDisponible = typeof creditoOrigen.garantia === 'number'
                ? creditoOrigen.garantia
                : (Number(creditoOrigen.garantia?.montoCalculado) || 0);

            if (Number(montoGarantia) > 0) {
                montoGarantiaAAplicar = Number(montoGarantia);
            } else {
                const saldoTrasMonto = Math.max(0, (creditoOrigen.saldoPendiente || 0) - montoCreditoNum);
                montoGarantiaAAplicar = Math.min(garantiaDisponible, saldoTrasMonto);
            }

            if (montoGarantiaAAplicar <= 0 && garantiaDisponible <= 0) {
                return res.status(400).json({ ok: false, msg: 'Este crédito no cuenta con garantía disponible para aplicar.' });
            }

            if (montoGarantiaAAplicar > garantiaDisponible) {
                return res.status(400).json({
                    ok: false,
                    msg: `La garantía a aplicar ($${montoGarantiaAAplicar}) supera la garantía disponible ($${garantiaDisponible}).`
                });
            }
        }

        const sumaTotal = montoCreditoNum + montoSolidarioNum + montoAhorroNum + montoGarantiaAAplicar;

        // --- MANEJO DE CRÉDITO INDIVIDUAL ---
        if (creditoOrigen.tipoCredito === 'Individual') {
            if (creditoOrigen.estado === 'Liquidado' && (montoCreditoNum > 0 || montoGarantiaAAplicar > 0)) {
                logWarn(req, 'REGISTRAR_PAGO_INDIVIDUAL_LIQUIDADO', 'Intento de abonar a crédito Individual ya liquidado', { creditoId: id, montoCreditoNum, montoGarantiaAAplicar });
                return res.status(400).json({ ok: false, msg: 'El crédito ya está liquidado' });
            }
            if (sumaTotal <= 0) {
                logWarn(req, 'REGISTRAR_PAGO_INDIVIDUAL_MONTO_CERO', 'Monto total ingresado es 0 o menor', { creditoId: id, body: req.body });
                return res.status(400).json({ ok: false, msg: 'Debe ingresar al menos un monto de pago, ahorro o aplicar garantía mayor a 0' });
            }

            const fechaPagoObj = fechaPago ? new Date(fechaPago) : new Date();
            const numeroPagoNum = numeroPago ? Number(numeroPago) : null;

            const VENTANA_DOBLE_CLIC_MS = 30 * 1000;
            const esDobleClic = (creditoOrigen.pagos || []).some(p => {
                const fechaExistente = new Date(p.fechaPago);
                const diferenciaMs = Math.abs(fechaPagoObj - fechaExistente);
                const coincideSemana = numeroPagoNum && p.numeroPago ? p.numeroPago === numeroPagoNum : true;
                return (
                    diferenciaMs <= VENTANA_DOBLE_CLIC_MS &&
                    p.montoPagado === montoCreditoNum &&
                    p.montoGarantia === montoGarantiaAAplicar &&
                    p.metodoPago === (metodoPago || 'EFECTIVO') &&
                    p.montoSolidario === montoSolidarioNum &&
                    p.montoAhorro === montoAhorroNum &&
                    coincideSemana
                );
            });
            if (esDobleClic) {
                logWarn(req, 'REGISTRAR_PAGO_INDIVIDUAL_DOBLE_CLIC', 'Posible doble clic detectado (mismo pago en < 30s)', {
                    creditoId: id, montoCredito: montoCreditoNum, metodoPago
                });
                return res.status(400).json({ ok: false, msg: 'Pago duplicado: ya se registró este mismo monto hace menos de 30 segundos. Si es un abono diferente, espera un momento e intenta de nuevo.' });
            }

            const totalCobroCredito = montoCreditoNum + montoGarantiaAAplicar;
            if (totalCobroCredito > creditoOrigen.saldoPendiente) {
                logWarn(req, 'REGISTRAR_PAGO_INDIVIDUAL_EXCEDE_SALDO', 'El abono excede el saldo pendiente total del crédito', {
                    creditoId: id, totalCobroCredito, saldoPendiente: creditoOrigen.saldoPendiente
                });
                return res.status(400).json({
                    ok: false,
                    msg: `El total a aplicar ($${totalCobroCredito}) excede el saldo pendiente del crédito ($${creditoOrigen.saldoPendiente}).`
                });
            }

            const saldoAnterior = creditoOrigen.saldoPendiente;
            const semanaCalendario = Number(calcularSemanaActual(creditoOrigen.fechaPrimerPago, creditoOrigen.frecuenciaPago || 'Semanal', fechaPagoObj)) || 1;
            const numSemana = (numeroPagoNum && Number(numeroPagoNum) > 0) ? Number(numeroPagoNum) : semanaCalendario;

            let efRestante = Number(efectivoCredito) || 0;
            let trRestante = Number(transferenciaCredito) || 0;
            let tjRestante = Number(tarjetaCredito) || 0;
            let dpRestante = Number(depositoCredito) || 0;

            if (efRestante === 0 && trRestante === 0 && tjRestante === 0 && dpRestante === 0 && montoCreditoNum > 0) {
                if (metodoPago === 'TRANSFERENCIA') trRestante = montoCreditoNum;
                else if (metodoPago === 'TARJETA') tjRestante = montoCreditoNum;
                else if (metodoPago === 'DEPOSITO') dpRestante = montoCreditoNum;
                else efRestante = montoCreditoNum;
            }

            let cuotaMetodo = metodoPago || 'EFECTIVO';
            const usedMethods = [efRestante, trRestante, tjRestante, dpRestante].filter(v => v > 0);
            if (montoGarantiaAAplicar > 0 && usedMethods.length === 0) {
                cuotaMetodo = 'GARANTÍA';
            } else if (usedMethods.length > 1 || (montoGarantiaAAplicar > 0 && usedMethods.length > 0)) {
                cuotaMetodo = 'MIXTO';
            } else if (trRestante > 0) cuotaMetodo = 'TRANSFERENCIA';
            else if (tjRestante > 0) cuotaMetodo = 'TARJETA';
            else if (dpRestante > 0) cuotaMetodo = 'DEPOSITO';
            else cuotaMetodo = 'EFECTIVO';

            const esAtraso = numSemana < semanaCalendario;
            const esAdelanto = numSemana > semanaCalendario;

            let totalHistInd = (creditoOrigen.pagos || []).reduce((acc, p) => acc + (p.montoPagado || 0) + (p.montoSolidario || 0) + (p.montoGarantia || 0), 0);
            const totalPagadoNuevo = totalHistInd + montoCreditoNum + (montoSolidarioNum || 0) + montoGarantiaAAplicar;

            const nuevoPago = {
                numeroPago: numSemana,
                montoPagado: montoCreditoNum,
                efectivoCredito: efRestante,
                transferenciaCredito: trRestante,
                tarjetaCredito: tjRestante,
                depositoCredito: dpRestante,
                pagoSolidario: !!pagoSolidario,
                montoSolidario: montoSolidarioNum || 0,
                efectivoSolidario: efectivoSolidario || 0,
                transferenciaSolidario: transferenciaSolidario || 0,
                tarjetaSolidario: tarjetaSolidario || 0,
                depositoSolidario: depositoSolidario || 0,
                montoAhorro: montoAhorroNum || 0,
                efectivoAhorro: efectivoAhorro || 0,
                transferenciaAhorro: transferenciaAhorro || 0,
                tarjetaAhorro: tarjetaAhorro || 0,
                depositoAhorro: depositoAhorro || 0,
                recuperacionSolidario: !!recuperacionSolidario,
                aplicaGarantia: montoGarantiaAAplicar > 0,
                montoGarantia: montoGarantiaAAplicar,
                esAdelanto,
                esAtraso,
                fechaPago: fechaPagoObj,
                metodoPago: cuotaMetodo,
                numeroRecibo: numeroRecibo || null,
                totalPagado: totalPagadoNuevo,
                quienPrestoSolidario: creditoOrigen.miembro,
                beneficiariosSolidarios: [],
                ...(ubicacion ? { ubicacion } : {})
            };

            creditoOrigen.pagos.push(nuevoPago);
            creditoOrigen.saldoPendiente -= totalCobroCredito;

            if (montoGarantiaAAplicar > 0) {
                if (typeof creditoOrigen.garantia === 'number') {
                    creditoOrigen.garantia = Math.max(0, creditoOrigen.garantia - montoGarantiaAAplicar);
                } else if (creditoOrigen.garantia && typeof creditoOrigen.garantia === 'object') {
                    creditoOrigen.garantia.montoCalculado = Math.max(0, (creditoOrigen.garantia.montoCalculado || 0) - montoGarantiaAAplicar);
                }
                creditoOrigen.garantiaAplicada = (creditoOrigen.garantiaAplicada || 0) + montoGarantiaAAplicar;
            }

            if (pagoSolidario) {
                if (recuperacionSolidario) {
                    creditoOrigen.saldoSolidario = Math.max(0, (creditoOrigen.saldoSolidario || 0) - montoCreditoNum);
                } else {
                    creditoOrigen.saldoSolidario = (creditoOrigen.saldoSolidario || 0) + montoSolidarioNum;
                }
            }

            if (montoAhorroNum > 0) {
                creditoOrigen.ahorro.montoTotal = (creditoOrigen.ahorro.montoTotal || 0) + montoAhorroNum;
            }

            if (creditoOrigen.saldoPendiente <= 0) {
                creditoOrigen.saldoPendiente = 0;
                creditoOrigen.estado = 'Liquidado';
                if (montoGarantiaAAplicar > 0) {
                    creditoOrigen.liquidadoConGarantia = true;
                }
            }

            await creditoOrigen.save();

            const descripcionLog = montoGarantiaAAplicar > 0
                ? `Pago Individual #${numSemana} registrado en Crédito ${id} por $${montoCreditoNum} (Garantía aplicada: $${montoGarantiaAAplicar}, Ahorro: $${montoAhorroNum})`
                : `Pago Individual #${numSemana} registrado en Crédito ${id} por $${montoCreditoNum} (Ahorro: $${montoAhorroNum})`;

            logAccion(req, 'REGISTRAR_PAGO_INDIVIDUAL', {
                descripcion: descripcionLog,
                datos: { creditoId: id, montoCreditoNum, montoGarantiaAAplicar, montoAhorroNum, metodoPago, numeroRecibo },
                resultado: {
                    numerosPago: `${numSemana}`,
                    saldoAnterior,
                    nuevoSaldo: creditoOrigen.saldoPendiente,
                    estado: creditoOrigen.estado,
                    garantiaRestante: creditoOrigen.garantia,
                    garantiaAplicada: creditoOrigen.garantiaAplicada,
                    liquidadoConGarantia: creditoOrigen.liquidadoConGarantia,
                    totalPagosEnCredito: creditoOrigen.pagos.length
                }
            });

            const msgExito = montoGarantiaAAplicar > 0
                ? (montoCreditoNum > 0
                    ? `Pago registrado ($${montoCreditoNum}) y garantía aplicada ($${montoGarantiaAAplicar}) correctamente`
                    : `Garantía aplicada ($${montoGarantiaAAplicar}) correctamente`)
                : 'Pago registrado correctamente (Individual)';

            return res.json({
                ok: true,
                msg: msgExito,
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
                const bCreditoId = item.creditoId || item.credito;
                const queryDestino = bCreditoId ? { _id: bCreditoId } : { miembro: bId, estado: 'Activo' };

                const creditoDestino = await Credito.findOne(queryDestino).sort({ tipoCredito: -1, createdAt: -1 });
                if (creditoDestino) {
                    const fechaPagoObj = fechaPago ? new Date(fechaPago) : new Date();
                    const existeDuplicado = (creditoDestino.pagos || []).some(p => {
                        const fechaPagoExistente = new Date(p.fechaPago);
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
                        continue;
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
            if (!beneficiarioFinal) {
                logWarn(req, 'REGISTRAR_PAGO_SOLIDARIO_SIN_BENEFICIARIO', 'Debe especificar el miembro beneficiario del solidario', { body: req.body });
                return res.status(400).json({ ok: false, msg: 'Debe especificar el miembro beneficiario del solidario (campo miembro o beneficiario)' });
            }

            const cDestinoId = req.body.creditoDestinoId || req.body.creditoId;
            const queryDestino = cDestinoId ? { _id: cDestinoId } : { miembro: beneficiarioFinal, estado: 'Activo' };
            creditoDestino = await Credito.findOne(queryDestino).sort({ tipoCredito: -1, createdAt: -1 });

            if (!creditoDestino) {
                logWarn(req, 'REGISTRAR_PAGO_SOLIDARIO_DESTINO_NOT_FOUND', `No se encontró crédito Activo para el beneficiario seleccionado: ${beneficiarioFinal}`, {
                    beneficiario: beneficiarioFinal,
                    creditoDestinoId: cDestinoId,
                    montoSolidario: montoSolidarioNum,
                    creditoOrigenId: id
                });
                return res.status(404).json({ ok: false, msg: 'No se encontró un crédito activo para el beneficiario seleccionado' });
            }
        } else {
            creditoDestino = creditoOrigen;
        }

        // --- CÁLCULO DE GARANTÍA A APLICAR (GRUPAL) ---
        let montoGarantiaAAplicarGrupal = 0;
        const abonoAlCredito = (pagoSolidario && !recuperacionSolidario) ? montoSolidarioNum : montoCreditoNum;
        const quiereAplicarGarantiaGrupal = (aplicaGarantia === true || aplicaGarantia === 'true' || Number(montoGarantia) > 0);
        if (quiereAplicarGarantiaGrupal) {
            const garantiaDisponible = typeof creditoDestino.garantia === 'number'
                ? creditoDestino.garantia
                : (Number(creditoDestino.garantia?.montoCalculado) || 0);

            if (Number(montoGarantia) > 0) {
                montoGarantiaAAplicarGrupal = Number(montoGarantia);
            } else {
                const saldoTrasMonto = Math.max(0, (creditoDestino.saldoPendiente || 0) - abonoAlCredito);
                montoGarantiaAAplicarGrupal = Math.min(garantiaDisponible, saldoTrasMonto);
            }

            if (montoGarantiaAAplicarGrupal <= 0 && garantiaDisponible <= 0) {
                return res.status(400).json({ ok: false, msg: 'Este crédito no cuenta con garantía disponible para aplicar.' });
            }

            if (montoGarantiaAAplicarGrupal > garantiaDisponible) {
                return res.status(400).json({
                    ok: false,
                    msg: `La garantía a aplicar ($${montoGarantiaAAplicarGrupal}) supera la garantía disponible ($${garantiaDisponible}).`
                });
            }
        }

        const sumaTotalGrupal = montoCreditoNum + montoSolidarioNum + montoAhorroNum + montoGarantiaAAplicarGrupal;
        if (sumaTotalGrupal <= 0) {
            logWarn(req, 'REGISTRAR_PAGO_MONTO_CERO', 'El pago total debe ser mayor a 0', { body: req.body });
            return res.status(400).json({ ok: false, msg: 'Debe ingresar al menos un monto de pago, ahorro o aplicar garantía mayor a 0' });
        }

        const fechaPagoObj = fechaPago ? new Date(fechaPago) : new Date();
        const existeDuplicado = (creditoDestino.pagos || []).some(p => {
            const fechaPagoExistente = new Date(p.fechaPago);
            const mismoOrigenSolidario = pagoSolidario && !recuperacionSolidario && p.quienPrestoSolidario && creditoOrigen.miembro
                ? p.quienPrestoSolidario.toString() === creditoOrigen.miembro.toString()
                : true;
            const mismaNaturaleza = (!!p.recuperacionSolidario === !!recuperacionSolidario) && (!!p.pagoSolidario === !!pagoSolidario);
            return (
                fechaPagoExistente.toDateString() === fechaPagoObj.toDateString() &&
                p.montoPagado === montoCreditoNum &&
                p.montoSolidario === montoSolidarioNum &&
                p.metodoPago === (metodoPago || 'EFECTIVO') &&
                p.montoAhorro === montoAhorroNum &&
                mismoOrigenSolidario &&
                mismaNaturaleza
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

        const saldoAnteriorDestino = creditoDestino.saldoPendiente;

        const nuevosPagos = distribuirCuotasPago({
            montoCreditoNum,
            pagoPactado: creditoDestino.pagoPactado,
            pagosExistentes: creditoDestino.pagos || [],
            fechaPagoObj,
            fechaPrimerPago: creditoDestino.fechaPrimerPago,
            frecuenciaPago: creditoDestino.frecuenciaPago,
            metodoPago,
            numeroRecibo,
            ubicacion,
            efectivoCredito,
            transferenciaCredito,
            tarjetaCredito,
            depositoCredito,
            montoAhorroNum,
            efectivoAhorro,
            transferenciaAhorro,
            tarjetaAhorro,
            depositoAhorro,
            pagoSolidario: !!pagoSolidario,
            montoSolidarioNum,
            efectivoSolidario,
            transferenciaSolidario,
            tarjetaSolidario,
            depositoSolidario,
            recuperacionSolidario: !!recuperacionSolidario,
            quienPrestoSolidario: (pagoSolidario && !recuperacionSolidario) ? creditoOrigen.miembro : undefined,
            beneficiariosSolidarios: ((pagoSolidario && !recuperacionSolidario) || recuperacionSolidario) && beneficiariosSolidarios ? beneficiariosSolidarios : undefined,
            aplicaGarantia: montoGarantiaAAplicarGrupal > 0,
            montoGarantiaNum: montoGarantiaAAplicarGrupal
        });

        let totalHistoricoDestino = (creditoDestino.pagos || []).reduce((acc, p) => acc + (p.montoPagado || 0) + (p.montoSolidario || 0) + (p.montoGarantia || 0), 0);
        for (const pItem of nuevosPagos) {
            totalHistoricoDestino += (pItem.montoPagado || 0) + (pItem.montoSolidario || 0) + (pItem.montoGarantia || 0);
            pItem.totalPagado = totalHistoricoDestino;
            creditoDestino.pagos.push(pItem);
        }

        const esSolidarioMismoCredito = pagoSolidario && !recuperacionSolidario && creditoDestino._id && creditoOrigen._id && creditoDestino._id.toString() === creditoOrigen._id.toString();
        if (!esSolidarioMismoCredito) {
            creditoDestino.saldoPendiente -= abonoAlCredito;
        }

        if (montoGarantiaAAplicarGrupal > 0) {
            creditoDestino.saldoPendiente = Math.max(0, creditoDestino.saldoPendiente - montoGarantiaAAplicarGrupal);
            if (typeof creditoDestino.garantia === 'number') {
                creditoDestino.garantia = Math.max(0, creditoDestino.garantia - montoGarantiaAAplicarGrupal);
            } else if (creditoDestino.garantia && typeof creditoDestino.garantia === 'object') {
                creditoDestino.garantia.montoCalculado = Math.max(0, (creditoDestino.garantia.montoCalculado || 0) - montoGarantiaAAplicarGrupal);
            }
            creditoDestino.garantiaAplicada = (creditoDestino.garantiaAplicada || 0) + montoGarantiaAAplicarGrupal;
            if (nuevosPagos.length > 0) {
                const ultimoP = nuevosPagos[nuevosPagos.length - 1];
                ultimoP.aplicaGarantia = true;
                ultimoP.montoGarantia = montoGarantiaAAplicarGrupal;
                if (!ultimoP.metodoPago || (ultimoP.metodoPago === 'EFECTIVO' && abonoAlCredito === 0)) {
                    ultimoP.metodoPago = 'GARANTÍA';
                }
            }
        }

        if (recuperacionSolidario) {
            const montoADescontar = montoSolidarioNum > 0 ? montoSolidarioNum : (montoCreditoNum > 0 ? montoCreditoNum : abonoAlCredito);
            creditoDestino.saldoSolidario = Math.max(0, (creditoDestino.saldoSolidario || 0) - montoADescontar);
        } else if (pagoSolidario) {
            creditoDestino.saldoSolidario = (creditoDestino.saldoSolidario || 0) + montoSolidarioNum;
        }

        if (montoAhorroNum > 0) {
            creditoDestino.ahorro.montoTotal = (creditoDestino.ahorro.montoTotal || 0) + montoAhorroNum;
        }

        if (creditoDestino.saldoPendiente <= 0) {
            creditoDestino.saldoPendiente = 0;
            creditoDestino.estado = 'Liquidado';
            if (montoGarantiaAAplicarGrupal > 0) {
                creditoDestino.liquidadoConGarantia = true;
            }
        }

        await creditoDestino.save();

        const numerosPagoDestinoStr = nuevosPagos.map(p => p.numeroPago).join(', ');
        logAccion(req, 'REGISTRAR_PAGO', {
            descripcion: `Pago #${numerosPagoDestinoStr} registrado en Crédito ${creditoDestino._id} (Monto: $${montoCreditoNum}, Solidario: $${montoSolidarioNum}, Ahorro: $${montoAhorroNum})`,
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
                numerosPago: numerosPagoDestinoStr,
                saldoAnterior: saldoAnteriorDestino,
                nuevoSaldoPendiente: creditoDestino.saldoPendiente,
                saldoSolidario: creditoDestino.saldoSolidario,
                estado: creditoDestino.estado,
                totalPagos: creditoDestino.pagos.length
            }
        });

        res.json({
            ok: true,
            msg: montoGarantiaAAplicarGrupal > 0
                ? (montoCreditoNum > 0
                    ? `Pago registrado ($${montoCreditoNum}) y garantía aplicada ($${montoGarantiaAAplicarGrupal}) correctamente`
                    : `Garantía aplicada ($${montoGarantiaAAplicarGrupal}) correctamente`)
                : 'Pago registrado correctamente',
            credito: creditoDestino
        });

    } catch (error) {
        logError(req, 'REGISTRAR_PAGO_ERROR', error, { creditoId: req.params.id, body: req.body });
        res.status(500).json({ ok: false, msg: 'Error al registrar el pago', error: error.message });
    }
};

/**
 * OBTENER PAGOS CON UBICACIÓN (Para mapas de supervisión)
 */
exports.getPagosConUbicacion = async (req, res) => {
    try {
        const { fechaInicio, fechaFin, asesorId, grupoId } = req.query;

        let filtroCreditos = {
            'pagos.ubicacion.latitud': { $exists: true, $ne: null }
        };

        if (grupoId) {
            const miembrosGrupo = await Miembro.find({ grupo: grupoId }).select('_id');
            const miembrosIds = miembrosGrupo.map(m => m._id);
            filtroCreditos.miembro = { $in: miembrosIds };
        }

        const creditos = await Credito.find(filtroCreditos)
            .populate({
                path: 'miembro',
                select: 'nombre apellidos grupo',
                populate: {
                    path: 'grupo',
                    select: 'nombre asesor',
                    populate: {
                        path: 'asesor',
                        select: 'username nombre'
                    }
                }
            })
            .populate({
                path: 'cliente',
                select: 'nombre apellidos asesor',
                populate: {
                    path: 'asesor',
                    select: 'username nombre'
                }
            })
            .lean();

        const puntos = [];

        for (const credito of creditos) {
            let asesor = 'Sin Asesor';
            let grupo = 'Sin Grupo';
            let nombrePersona = 'Desconocido';

            if (credito.tipoCredito === 'Individual') {
                if (credito.cliente) {
                    nombrePersona = `${credito.cliente.nombre || ''} ${credito.cliente.apellidos || ''}`.trim() || 'Cliente';
                    if (credito.cliente.asesor) {
                        asesor = credito.cliente.asesor.nombre || credito.cliente.asesor.username || asesor;
                    }
                }
                grupo = 'Crédito Individual';
            } else {
                if (credito.miembro) {
                    nombrePersona = `${credito.miembro.nombre || ''} ${credito.miembro.apellidos || ''}`.trim() || 'Miembro';
                    if (credito.miembro.grupo) {
                        grupo = credito.miembro.grupo.nombre || grupo;
                        if (credito.miembro.grupo.asesor) {
                            asesor = credito.miembro.grupo.asesor.nombre || credito.miembro.grupo.asesor.username || asesor;
                        }
                    }
                }
            }

            if (asesorId) {
                let coincideAsesor = false;
                if (credito.tipoCredito === 'Individual' && credito.cliente && credito.cliente.asesor) {
                    coincideAsesor = credito.cliente.asesor._id.toString() === asesorId.toString();
                } else if (credito.miembro && credito.miembro.grupo && credito.miembro.grupo.asesor) {
                    coincideAsesor = credito.miembro.grupo.asesor._id.toString() === asesorId.toString();
                }
                if (!coincideAsesor) continue;
            }

            for (const pago of (credito.pagos || [])) {
                if (!pago.ubicacion || pago.ubicacion.latitud === undefined || pago.ubicacion.latitud === null) {
                    continue;
                }

                if (fechaInicio || fechaFin) {
                    const fPago = new Date(pago.fechaPago);
                    if (fechaInicio && fPago < new Date(fechaInicio)) continue;
                    if (fechaFin) {
                        const fFin = new Date(fechaFin);
                        fFin.setHours(23, 59, 59, 999);
                        if (fPago > fFin) continue;
                    }
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

        puntos.sort((a, b) => new Date(b.fechaPago) - new Date(a.fechaPago));

        res.json({ ok: true, total: puntos.length, puntos });
    } catch (error) {
        logError(req, 'GET_PAGOS_CON_UBICACION_ERROR', error);
        res.status(500).json({ ok: false, msg: 'Error al obtener pagos con ubicación', error: error.message });
    }
};


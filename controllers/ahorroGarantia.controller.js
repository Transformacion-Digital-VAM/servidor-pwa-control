const Credito = require('../models/Credito');
const { logAccion, logWarn, logError } = require('../utils/loggers');

/**
 * REGISTRAR ABONO A GARANTÍA
 */
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

/**
 * REGISTRAR AHORRO
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

        credito.ahorro.pagosAhorro.push({
            monto,
            efectivo: efectivo || 0,
            transferencia: transferencia || 0,
            tarjeta: tarjeta || 0,
            deposito: deposito || 0,
            fecha: fecha || new Date(),
            ubicacion
        });

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


const Credito = require('../models/Credito');
const Miembro = require('../models/Miembro');
const Grupo = require('../models/Grupo');
// CREATE
exports.crearCredito = async (req, res) => {
    try {
        const {
            miembro,
            ciclo,
            tipoCredito,
            pagoPactado,
            fechaPrimerPago
        } = req.body;

        // Validar semanas según tipo
        const semanas = tipoCredito === '8S' ? 8 : 16;

        const saldoTotal = pagoPactado * semanas;

        const nuevoCredito = new Credito({
            miembro,
            ciclo,
            tipoCredito,
            semanas,
            pagoPactado,
            saldoTotal,
            fechaPrimerPago,
            saldoPendiente: saldoTotal,
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
        const { id } = req.params; // id del credito
        const { montoPagado, fechaPago, pagoSolidario } = req.body;

        const credito = await Credito.findById(id);

        if (!credito) {
            return res.status(404).json({
                ok: false,
                msg: 'Crédito no encontrado'
            });
        }

        if (credito.estado === 'Liquidado') {
            return res.status(400).json({
                ok: false,
                msg: 'El crédito ya está liquidado'
            });
        }

        if (montoPagado <= 0) {
            return res.status(400).json({
                ok: false,
                msg: 'El monto debe ser mayor a 0'
            });
        }

        if (montoPagado > credito.saldoPendiente) {
            return res.status(400).json({
                ok: false,
                msg: 'El monto excede el saldo pendiente'
            });
        }

        const numeroPago = credito.pagos.length + 1;

        const nuevoPago = {
            numeroPago,
            montoPagado,
            fechaPago: fechaPago || new Date(),
            pagoSolidario: pagoSolidario || false
        };

        // Agregar pago
        credito.pagos.push(nuevoPago);

        // Restar saldo
        credito.saldoPendiente -= montoPagado;

        // Verificar si ya se liquidó
        if (credito.saldoPendiente === 0) {
            credito.estado = 'Liquidado';
        }

        await credito.save();

        res.json({
            ok: true,
            msg: 'Pago registrado correctamente',
            credito
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: 'Error al registrar pago',
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

exports.hojaControl = async (req, res) => {
    try {
        const { grupoId, ciclo } = req.params;

        const grupo = await Grupo.findById(grupoId);
        if (!grupo) {
            return res.status(404).json({
                ok: false,
                msg: 'Grupo no encontrado'
            });
        }

        const miembros = await Miembro.find({ grupo: grupoId });

        // 🔥 OPTIMIZACIÓN: traemos todos los créditos de una sola vez
        const creditos = await Credito.find({
            ciclo: Number(ciclo),
            miembro: { $in: miembros.map(m => m._id) }
        });

        const hoy = new Date();
        const reporteMiembros = [];

        for (const credito of creditos) {

            const miembro = miembros.find(
                m => m._id.toString() === credito.miembro.toString()
            );

            const calendario = generarCalendarioPagos(
                credito.fechaPrimerPago,
                credito.semanas
            );

            const pagosConCalendario = calendario.map(fecha => {
                const pagoReal = credito.pagos.find(
                    p => p.numeroPago === fecha.numeroPago
                );

                const pagado = !!pagoReal;

                const atraso =
                    !pagado &&
                    fecha.fechaProgramada < hoy;

                return {
                    numeroPago: fecha.numeroPago,
                    fechaProgramada: fecha.fechaProgramada,
                    montoPagado: pagado ? pagoReal.montoPagado : 0,
                    pagado,
                    atraso
                };
            });

            reporteMiembros.push({
                nombre: `${miembro.nombre} ${miembro.apellidos}`,
                rol: miembro.rol,
                tipoCredito: credito.tipoCredito,
                pagoPactado: credito.pagoPactado,
                semanas: credito.semanas,
                calendarioPagos: pagosConCalendario,
                saldoPendiente: credito.saldoPendiente,
                estado: credito.estado
            });
        }

        res.json({
            ok: true,
            grupo: grupo.nombre,
            clave: grupo.clave,
            ciclo: Number(ciclo),
            diaVisita: grupo.diaVisita,
            horaVisita: grupo.horaVisita,
            miembros: reporteMiembros
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            msg: 'Error al generar hoja de control',
            error: error.message
        });
    }
};

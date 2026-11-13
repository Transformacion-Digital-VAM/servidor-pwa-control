const mongoose = require('mongoose');
const CreditoMagico = require('../models/CreditoMagico');
const Grupo = require('../models/Grupo');
const { logAccion, logWarn, logError } = require('../utils/loggers');
const {
    normalizarRol,
    extraerIdStr,
    obtenerContextoCoordinacion
} = require('../helpers/coordinacionHelper');
const {
    obtenerInfoCampana,
    calcularMontosMagico,
    calcularSemanaActualMagico,
    evaluarElegibilidadGrupo
} = require('../helpers/magicosRules');

/**
 * Helper interno para distribuir cuotas en Crédito Mágico (16 semanas, sin garantía/solidario).
 */
function distribuirCuotasMagico({
    montoPagadoNum,
    pagoPactado,
    fechaPrimerPago,
    fechaPagoObj,
    pagosExistentes = [],
    metodoPago = 'EFECTIVO',
    efectivoCredito = 0,
    transferenciaCredito = 0,
    tarjetaCredito = 0,
    depositoCredito = 0,
    numeroRecibo = null,
    ubicacion = null,
    numeroPagoEspecifico = null
}) {
    const semanaCalendario = calcularSemanaActualMagico(fechaPrimerPago, fechaPagoObj);

    let efRestante = Number(efectivoCredito) || 0;
    let trRestante = Number(transferenciaCredito) || 0;
    let tjRestante = Number(tarjetaCredito) || 0;
    let dpRestante = Number(depositoCredito) || 0;

    if (efRestante === 0 && trRestante === 0 && tjRestante === 0 && dpRestante === 0 && montoPagadoNum > 0) {
        if (metodoPago === 'TRANSFERENCIA') trRestante = montoPagadoNum;
        else if (metodoPago === 'TARJETA') tjRestante = montoPagadoNum;
        else if (metodoPago === 'DEPOSITO') dpRestante = montoPagadoNum;
        else efRestante = montoPagadoNum;
    }

    const construirItemPago = (numPago, esAdelantoFlag, esAtrasoFlag, montoCuota) => {
        let porCubrir = montoCuota;
        const efCuota = Math.min(efRestante, porCubrir);
        porCubrir -= efCuota;
        efRestante -= efCuota;

        const trCuota = Math.min(trRestante, porCubrir);
        porCubrir -= trCuota;
        trRestante -= trCuota;

        const tjCuota = Math.min(tjRestante, porCubrir);
        porCubrir -= tjCuota;
        tjRestante -= tjCuota;

        const dpCuota = Math.min(dpRestante, porCubrir);
        porCubrir -= dpCuota;
        dpRestante -= dpCuota;

        let cuotaMetodo = metodoPago || 'EFECTIVO';
        const metodosUsados = [efCuota, trCuota, tjCuota, dpCuota].filter(v => v > 0);
        if (metodosUsados.length > 1) cuotaMetodo = 'MIXTO';
        else if (trCuota > 0) cuotaMetodo = 'TRANSFERENCIA';
        else if (tjCuota > 0) cuotaMetodo = 'TARJETA';
        else if (dpCuota > 0) cuotaMetodo = 'DEPOSITO';
        else cuotaMetodo = 'EFECTIVO';

        return {
            numeroPago: numPago,
            montoPagado: montoCuota,
            efectivoCredito: efCuota,
            transferenciaCredito: trCuota,
            tarjetaCredito: tjCuota,
            depositoCredito: dpCuota,
            metodoPago: cuotaMetodo,
            numeroRecibo: numeroRecibo !== null && numeroRecibo !== undefined ? String(numeroRecibo).trim() : null,
            esAdelanto: esAdelantoFlag,
            esAtraso: esAtrasoFlag,
            fechaPago: fechaPagoObj,
            ...(ubicacion ? { ubicacion } : {})
        };
    };

    if (numeroPagoEspecifico && Number(numeroPagoEspecifico) > 0) {
        const numEsp = Number(numeroPagoEspecifico);
        return [construirItemPago(numEsp, numEsp > semanaCalendario, numEsp < semanaCalendario, montoPagadoNum)];
    }

    if (!pagoPactado || pagoPactado <= 0) {
        const ultimo = pagosExistentes[pagosExistentes.length - 1];
        const numPago = ultimo ? (Number(ultimo.numeroPago) || 0) + 1 : 1;
        return [construirItemPago(numPago, false, false, montoPagadoNum)];
    }

    const pagadoPorSemana = {};
    for (const p of pagosExistentes) {
        const num = Number(p.numeroPago) || 1;
        pagadoPorSemana[num] = (pagadoPorSemana[num] || 0) + (Number(p.montoPagado) || 0);
    }

    const nuevosPagos = [];
    let restante = montoPagadoNum;

    // 1. Deuda de semanas pasadas
    let deudaAtrasos = 0;
    for (let s = 1; s < semanaCalendario; s++) {
        const pagado = pagadoPorSemana[s] || 0;
        if (pagado < pagoPactado) {
            deudaAtrasos += (pagoPactado - pagado);
        }
    }

    if (deudaAtrasos > 0 && restante > 0) {
        let montoAtraso = Math.min(restante, deudaAtrasos);
        let tempAtraso = montoAtraso;
        while (tempAtraso > 0) {
            const montoCuota = Math.min(tempAtraso, pagoPactado);
            nuevosPagos.push(construirItemPago(semanaCalendario, false, true, montoCuota));
            tempAtraso -= montoCuota;
            restante -= montoCuota;
        }
    }

    // 2. Cuota de la semana actual
    const faltaActual = Math.max(0, pagoPactado - (pagadoPorSemana[semanaCalendario] || 0));
    if (faltaActual > 0 && restante > 0) {
        const montoActual = Math.min(restante, faltaActual);
        nuevosPagos.push(construirItemPago(semanaCalendario, false, false, montoActual));
        restante -= montoActual;
        pagadoPorSemana[semanaCalendario] = (pagadoPorSemana[semanaCalendario] || 0) + montoActual;
    }

    // 3. Adelantos para semanas futuras
    if (restante > 0) {
        let semanaFutura = semanaCalendario + 1;
        while (pagadoPorSemana[semanaFutura] && pagadoPorSemana[semanaFutura] >= pagoPactado) {
            semanaFutura++;
        }
        while (restante > 0) {
            const pagadoFut = pagadoPorSemana[semanaFutura] || 0;
            const faltaFut = Math.max(0, pagoPactado - pagadoFut);
            const montoCuota = faltaFut > 0 ? Math.min(restante, faltaFut) : Math.min(restante, pagoPactado);
            nuevosPagos.push(construirItemPago(semanaFutura, true, false, montoCuota));
            restante -= montoCuota;
            pagadoPorSemana[semanaFutura] = (pagadoPorSemana[semanaFutura] || 0) + montoCuota;
            if (pagadoPorSemana[semanaFutura] >= pagoPactado) {
                semanaFutura++;
            }
        }
    }

    return nuevosPagos;
}

/**
 * Valida la regla de recibo único grupal:
 * Un mismo folio puede repetirse en créditos mágicos del MISMO grupo en el MISMO día,
 * pero no puede usarse en otro grupo ni en otra fecha distinta.
 */
async function validarReciboUnicoGrupo(grupoId, numeroRecibo, fechaPagoObj) {
    if (numeroRecibo === undefined || numeroRecibo === null || String(numeroRecibo).trim() === '') {
        return { valido: true };
    }
    const reciboStr = String(numeroRecibo).trim();
    const fechaDiaStr = fechaPagoObj.toISOString().split('T')[0];

    const conflictos = await CreditoMagico.find({
        'pagos.numeroRecibo': reciboStr
    })
        .select('grupo pagos.numeroRecibo pagos.fechaPago')
        .lean();

    for (const c of conflictos) {
        const esMismoGrupo = String(c.grupo) === String(grupoId);
        for (const p of (c.pagos || [])) {
            if (String(p.numeroRecibo || '').trim() !== reciboStr) continue;
            const pDia = p.fechaPago ? new Date(p.fechaPago).toISOString().split('T')[0] : '';
            if (!esMismoGrupo || pDia !== fechaDiaStr) {
                return {
                    valido: false,
                    mensaje: `El número de recibo "${reciboStr}" ya fue utilizado en otro grupo o en una fecha distinta.`
                };
            }
        }
    }

    return { valido: true };
}

/**
 * Aplica el pago a un documento CreditoMagico en memoria y lo guarda.
 */
async function aplicarPagoACreditoMagico(credito, bodyPago) {
    const montoPagadoNum = Number(bodyPago.montoPagado) || 0;
    if (montoPagadoNum <= 0) {
        const err = new Error('El monto del pago debe ser mayor a 0');
        err.statusCode = 400;
        throw err;
    }

    if (credito.estado !== 'Activo' || credito.saldoPendiente <= 0) {
        const err = new Error('El crédito mágico ya se encuentra liquidado o cancelado');
        err.statusCode = 400;
        throw err;
    }

    if (montoPagadoNum > credito.saldoPendiente) {
        const err = new Error(`El monto ($${montoPagadoNum}) excede el saldo pendiente ($${credito.saldoPendiente})`);
        err.statusCode = 400;
        throw err;
    }

    const fechaPagoObj = bodyPago.fechaPago ? new Date(bodyPago.fechaPago) : new Date();
    const reciboCheck = await validarReciboUnicoGrupo(credito.grupo, bodyPago.numeroRecibo, fechaPagoObj);
    if (!reciboCheck.valido) {
        const err = new Error(reciboCheck.mensaje);
        err.statusCode = 400;
        throw err;
    }

    // Validación anti doble clic / duplicado mismo día y mismo recibo/monto
    const hoyStr = fechaPagoObj.toISOString().split('T')[0];
    const existeDuplicado = (credito.pagos || []).some(p => {
        const pFecha = p.fechaPago ? new Date(p.fechaPago) : null;
        if (!pFecha) return false;
        const mismoDia = pFecha.toISOString().split('T')[0] === hoyStr;
        const diffMs = Math.abs(fechaPagoObj.getTime() - pFecha.getTime());
        const mismoMonto = Number(p.montoPagado) === montoPagadoNum;
        return mismoDia && mismoMonto && diffMs < 30 * 1000;
    });

    if (existeDuplicado) {
        const err = new Error('Pago duplicado detectado en los últimos 30 segundos para este integrante.');
        err.statusCode = 400;
        throw err;
    }

    const nuevosPagos = distribuirCuotasMagico({
        montoPagadoNum,
        pagoPactado: credito.pagoPactado,
        fechaPrimerPago: credito.fechaPrimerPago,
        fechaPagoObj,
        pagosExistentes: credito.pagos || [],
        metodoPago: bodyPago.metodoPago || 'EFECTIVO',
        efectivoCredito: bodyPago.efectivoCredito || 0,
        transferenciaCredito: bodyPago.transferenciaCredito || 0,
        tarjetaCredito: bodyPago.tarjetaCredito || 0,
        depositoCredito: bodyPago.depositoCredito || 0,
        numeroRecibo: bodyPago.numeroRecibo || null,
        ubicacion: bodyPago.ubicacion || null,
        numeroPagoEspecifico: bodyPago.numeroPago || null
    });

    let acumuladoPagado = (credito.pagos || []).reduce((sum, p) => sum + (Number(p.montoPagado) || 0), 0);
    for (const item of nuevosPagos) {
        acumuladoPagado += Number(item.montoPagado) || 0;
        item.totalPagado = acumuladoPagado;
        credito.pagos.push(item);
    }

    credito.saldoPendiente = Math.max(0, Number(credito.saldoPendiente) - montoPagadoNum);
    credito.semanaActual = calcularSemanaActualMagico(credito.fechaPrimerPago, fechaPagoObj);

    if (credito.saldoPendiente <= 0) {
        credito.saldoPendiente = 0;
        credito.estado = 'Liquidado';
    }

    await credito.save();
    return credito;
}

// ==========================================
// ENDPOINTS
// ==========================================

/**
 * GET /api/magicos/elegibilidad/:grupoId
 * Devuelve info del grupo, campaña, tasa por coordinación, cupo 30% y elegibilidad de cada miembro.
 */
exports.obtenerElegibilidadGrupo = async (req, res) => {
    try {
        const { grupoId } = req.params;
        const { campanaMes, campanaAnio } = req.query;

        const resultado = await evaluarElegibilidadGrupo(grupoId, { campanaMes, campanaAnio });
        res.json({ ok: true, ...resultado });
    } catch (error) {
        logError(req, 'MAGICO_ELEGIBILIDAD_ERROR', error, { grupoId: req.params.grupoId });
        res.status(error.statusCode || 500).json({
            ok: false,
            msg: error.message || 'Error al evaluar elegibilidad de Créditos Mágicos'
        });
    }
};

/**
 * POST /api/magicos
 * Registra uno o varios créditos mágicos para miembros elegibles de un grupo.
 */
exports.crearCreditosMagicos = async (req, res) => {
    try {
        const { grupoId, asesorId, integrantes, miembroId, montoSolicitado, fechaPrimerPago } = req.body;

        const listaSolicitudes = Array.isArray(integrantes) && integrantes.length > 0
            ? integrantes
            : (miembroId ? [{ miembroId, montoSolicitado, fechaPrimerPago }] : []);

        if (!grupoId) {
            return res.status(400).json({ ok: false, msg: 'Debe seleccionar un grupo' });
        }
        if (listaSolicitudes.length === 0) {
            return res.status(400).json({ ok: false, msg: 'Debe seleccionar al menos un integrante del grupo' });
        }

        // Verificar elegibilidad integral del grupo y campaña vigente
        const evaluacion = await evaluarElegibilidadGrupo(grupoId);
        const { grupo, campana, configZona, cupo, integrantes: evaluados } = evaluacion;

        if (!campana.enCampana) {
            logWarn(req, 'MAGICO_FUERA_CAMPANA', 'Intento de registro fuera de mes de campaña', { campana, grupoId });
            return res.status(400).json({
                ok: false,
                msg: `El registro de Créditos Mágicos solo está habilitado en los meses de campaña (Abril, Septiembre y Diciembre). Mes actual: ${campana.nombreMes || campana.mes}.`
            });
        }

        if (listaSolicitudes.length > cupo.disponibles) {
            return res.status(400).json({
                ok: false,
                msg: `El grupo supera el cupo permitido del 30% (${cupo.cupoMaximo} máximo, ${cupo.ocupados} ocupados, ${cupo.disponibles} disponibles).`
            });
        }

        // Evitar duplicados dentro del mismo payload
        const miembrosSolicitadosSet = new Set();
        const evaluadosMap = new Map(evaluados.map(m => [String(m._id), m]));

        const documentosACrear = [];
        for (const sol of listaSolicitudes) {
            const mId = String(sol.miembroId || sol.miembro || '');
            if (!mId || !mongoose.Types.ObjectId.isValid(mId)) {
                return res.status(400).json({ ok: false, msg: 'ID de miembro inválido en la solicitud' });
            }
            if (miembrosSolicitadosSet.has(mId)) {
                return res.status(400).json({ ok: false, msg: 'No se puede registrar al mismo integrante dos veces en la misma campaña' });
            }
            miembrosSolicitadosSet.add(mId);

            const infoMiembro = evaluadosMap.get(mId);
            if (!infoMiembro) {
                return res.status(400).json({ ok: false, msg: `El miembro ${mId} no pertenece al grupo seleccionado. Solo miembros de grupo pueden acceder a Mágico.` });
            }
            if (!infoMiembro.apto) {
                return res.status(400).json({
                    ok: false,
                    msg: `${infoMiembro.nombreCompleto} no es elegible: ${infoMiembro.motivosBloqueo.join('; ')}`
                });
            }

            const montoNum = Number(sol.montoSolicitado);
            if (!configZona.montosPermitidos.includes(montoNum)) {
                return res.status(400).json({
                    ok: false,
                    msg: `El monto $${montoNum} no está permitido para ${configZona.zona}. Montos válidos: ${configZona.montosPermitidos.map(m => `$${m}`).join(', ')}`
                });
            }

            if (!sol.fechaPrimerPago) {
                return res.status(400).json({
                    ok: false,
                    msg: `Debe especificar la fecha de primer pago para ${infoMiembro.nombreCompleto}`
                });
            }

            const fechaInicio = new Date(sol.fechaPrimerPago);
            if (isNaN(fechaInicio.getTime())) {
                return res.status(400).json({
                    ok: false,
                    msg: `Fecha de primer pago inválida para ${infoMiembro.nombreCompleto}`
                });
            }

            const calculos = calcularMontosMagico(
                montoNum,
                configZona.tasaInteres,
                configZona.semanas,
                configZona.equivalenciaMeses
            );

            const asesorFinal = asesorId && mongoose.Types.ObjectId.isValid(asesorId)
                ? asesorId
                : (grupo.asesor?._id || grupo.asesor);

            documentosACrear.push({
                miembro: infoMiembro._id,
                grupo: grupo._id,
                asesor: asesorFinal,
                coordinacion: grupo.coordinacion?._id || grupo.coordinacion || null,
                campanaMes: campana.mes,
                campanaAnio: campana.anio,
                campanaClave: campana.clave,
                montoSolicitado: calculos.montoSolicitado,
                tasaInteres: calculos.tasaInteres,
                semanas: calculos.semanas,
                equivalenciaMeses: calculos.equivalenciaMeses,
                pagoPactado: calculos.pagoPactado,
                saldoTotal: calculos.saldoTotal,
                saldoPendiente: calculos.saldoTotal,
                garantia: 0,
                diaPago: grupo.diaPago || grupo.diaVisita,
                horaVisita: grupo.horaVisita || '',
                fechaPrimerPago: fechaInicio,
                semanaActual: calcularSemanaActualMagico(fechaInicio),
                frecuenciaPago: 'Semanal',
                estado: 'Activo',
                pagos: []
            });
        }

        const creados = await CreditoMagico.insertMany(documentosACrear);

        logAccion(req, 'CREAR_CREDITOS_MAGICOS', {
            descripcion: `Se registraron ${creados.length} crédito(s) mágico(s) para el grupo ${grupo.nombre} (Campaña ${campana.clave})`,
            datos: {
                grupoId: grupo._id,
                campanaClave: campana.clave,
                cantidad: creados.length,
                ids: creados.map(c => c._id)
            }
        });

        res.status(201).json({
            ok: true,
            msg: `Se registraron ${creados.length} crédito(s) mágico(s) correctamente.`,
            creditos: creados
        });
    } catch (error) {
        logError(req, 'CREAR_CREDITOS_MAGICOS_ERROR', error, { body: req.body });
        res.status(error.statusCode || 500).json({
            ok: false,
            msg: error.code === 11000
                ? 'Uno de los integrantes ya cuenta con un crédito mágico en esta campaña.'
                : (error.message || 'Error al registrar créditos mágicos')
        });
    }
};

/**
 * GET /api/magicos
 * Listado de créditos mágicos filtrable por rol, asesor, coordinación, grupo, campaña y estado.
 */
exports.obtenerCreditosMagicos = async (req, res) => {
    try {
        const user = req.user || {};
        const rolNorm = normalizarRol(user.role);
        const query = {};

        if (req.query.grupo && mongoose.Types.ObjectId.isValid(req.query.grupo)) {
            query.grupo = req.query.grupo;
        }
        if (req.query.campanaClave) {
            query.campanaClave = String(req.query.campanaClave).trim();
        }
        if (req.query.estado && req.query.estado !== 'todos') {
            query.estado = req.query.estado;
        }

        if (['admin', 'superadmin', 'lector', 'gerencia'].includes(rolNorm)) {
            if (req.query.coordinacion && req.query.coordinacion !== 'todas') {
                const ctx = await obtenerContextoCoordinacion(req.query.coordinacion);
                if (ctx.coordIds.length > 0) {
                    query.coordinacion = { $in: ctx.coordIds };
                }
            }
            if (req.query.asesor && req.query.asesor !== 'todos' && mongoose.Types.ObjectId.isValid(req.query.asesor)) {
                query.asesor = req.query.asesor;
            }
        } else if (['coordinador', 'master'].includes(rolNorm)) {
            const ctx = await obtenerContextoCoordinacion(user);
            if (ctx.grupoIds.length > 0) {
                query.$or = [
                    { coordinacion: { $in: ctx.coordIds } },
                    { grupo: { $in: ctx.grupoIds } },
                    { asesor: { $in: ctx.asesorIds } }
                ];
            } else {
                const userId = extraerIdStr(user.id || user._id);
                if (userId) query.asesor = userId;
            }
            if (req.query.asesor && req.query.asesor !== 'todos' && mongoose.Types.ObjectId.isValid(req.query.asesor)) {
                query.asesor = req.query.asesor;
            }
        } else {
            // Asesor
            const userId = extraerIdStr(user.id || user._id);
            if (userId) {
                const gruposAsesor = await Grupo.find({ asesor: userId }).select('_id').lean();
                const gIds = gruposAsesor.map(g => g._id);
                query.$or = [
                    { asesor: userId },
                    ...(gIds.length > 0 ? [{ grupo: { $in: gIds } }] : [])
                ];
            }
        }

        const creditos = await CreditoMagico.find(query)
            .populate('miembro', 'nombre apellidos rol')
            .populate('grupo', 'nombre clave diaVisita diaPago horaVisita')
            .populate('asesor', 'nombre username')
            .populate('coordinacion', 'nombre municipio')
            .sort({ campanaAnio: -1, campanaMes: -1, createdAt: -1 })
            .lean();

        const hoy = new Date();
        const opsBulk = [];
        for (const c of creditos) {
            if (c.estado === 'Activo' && c.fechaPrimerPago) {
                const semCalc = calcularSemanaActualMagico(c.fechaPrimerPago, hoy);
                if (c.semanaActual !== semCalc) {
                    c.semanaActual = semCalc;
                    opsBulk.push({
                        updateOne: {
                            filter: { _id: c._id },
                            update: { semanaActual: semCalc }
                        }
                    });
                }
            }
        }
        if (opsBulk.length > 0) {
            CreditoMagico.bulkWrite(opsBulk).catch(err => console.error('Error actualizando semanas mágicos:', err));
        }

        res.json({ ok: true, creditos });
    } catch (error) {
        logError(req, 'OBTENER_MAGICOS_ERROR', error);
        res.status(500).json({ ok: false, msg: 'Error al consultar créditos mágicos' });
    }
};

/**
 * GET /api/magicos/grupo/:grupoId
 * Devuelve el grupo y sus créditos mágicos (activos por defecto o ?incluirLiquidados=true).
 */
exports.obtenerHojaGrupoMagicos = async (req, res) => {
    try {
        const { grupoId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(grupoId)) {
            return res.status(400).json({ ok: false, msg: 'ID de grupo inválido' });
        }

        const grupo = await Grupo.findById(grupoId)
            .populate('asesor', 'nombre username')
            .populate('coordinacion', 'nombre municipio')
            .lean();

        if (!grupo) {
            return res.status(404).json({ ok: false, msg: 'Grupo no encontrado' });
        }

        const filtroEstado = req.query.incluirLiquidados === 'true'
            ? { $ne: 'Cancelado' }
            : 'Activo';

        const creditos = await CreditoMagico.find({
            grupo: grupoId,
            estado: filtroEstado
        })
            .populate('miembro', 'nombre apellidos rol')
            .sort({ createdAt: 1 })
            .lean();

        const hoy = new Date();
        creditos.forEach(c => {
            if (c.estado === 'Activo' && c.fechaPrimerPago) {
                c.semanaActual = calcularSemanaActualMagico(c.fechaPrimerPago, hoy);
            }
        });

        res.json({
            ok: true,
            grupo,
            creditos
        });
    } catch (error) {
        logError(req, 'OBTENER_HOJA_MAGICOS_ERROR', error, { grupoId: req.params.grupoId });
        res.status(500).json({ ok: false, msg: 'Error al obtener la hoja de créditos mágicos del grupo' });
    }
};

/**
 * GET /api/magicos/:id
 */
exports.obtenerCreditoMagicoPorId = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ ok: false, msg: 'ID de crédito mágico inválido' });
        }

        const credito = await CreditoMagico.findById(id)
            .populate('miembro', 'nombre apellidos rol')
            .populate('grupo', 'nombre clave diaVisita diaPago horaVisita')
            .populate('asesor', 'nombre username')
            .populate('coordinacion', 'nombre municipio');

        if (!credito) {
            return res.status(404).json({ ok: false, msg: 'Crédito mágico no encontrado' });
        }

        if (credito.estado === 'Activo' && credito.fechaPrimerPago) {
            const semCalc = calcularSemanaActualMagico(credito.fechaPrimerPago);
            if (credito.semanaActual !== semCalc) {
                credito.semanaActual = semCalc;
                await credito.save();
            }
        }

        res.json({ ok: true, credito });
    } catch (error) {
        logError(req, 'OBTENER_MAGICO_POR_ID_ERROR', error, { id: req.params.id });
        res.status(500).json({ ok: false, msg: 'Error al obtener el crédito mágico' });
    }
};

/**
 * POST /api/magicos/:id/pagos
 * Registra un pago individual sobre un crédito mágico.
 */
exports.registrarPagoMagico = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ ok: false, msg: 'ID de crédito mágico inválido' });
        }

        const credito = await CreditoMagico.findById(id);
        if (!credito) {
            return res.status(404).json({ ok: false, msg: 'Crédito mágico no encontrado' });
        }

        const actualizado = await aplicarPagoACreditoMagico(credito, req.body);

        logAccion(req, 'REGISTRAR_PAGO_MAGICO', {
            descripcion: `Pago $${req.body.montoPagado} registrado a Crédito Mágico ${id} (Recibo #${req.body.numeroRecibo || 'S/F'})`,
            datos: { creditoId: id, montoPagado: req.body.montoPagado, saldoPendiente: actualizado.saldoPendiente }
        });

        res.json({
            ok: true,
            msg: 'Pago registrado correctamente en Crédito Mágico',
            credito: actualizado
        });
    } catch (error) {
        logError(req, 'REGISTRAR_PAGO_MAGICO_ERROR', error, { id: req.params.id, body: req.body });
        res.status(error.statusCode || 500).json({
            ok: false,
            msg: error.message || 'Error al registrar el pago en crédito mágico'
        });
    }
};

/**
 * POST /api/magicos/pagos-grupo
 * Registra en lote los pagos de los integrantes de Mágicos de un mismo grupo con un solo número de recibo.
 */
exports.registrarPagosGrupoMagicos = async (req, res) => {
    try {
        const { grupoId, numeroRecibo, fechaPago, ubicacion, pagos } = req.body;

        if (!grupoId || !mongoose.Types.ObjectId.isValid(grupoId)) {
            return res.status(400).json({ ok: false, msg: 'ID de grupo inválido' });
        }
        if (!numeroRecibo || String(numeroRecibo).trim() === '') {
            return res.status(400).json({ ok: false, msg: 'El número de recibo único del grupo es obligatorio' });
        }
        if (!Array.isArray(pagos) || pagos.length === 0) {
            return res.status(400).json({ ok: false, msg: 'Debe enviar al menos un pago para registrar' });
        }

        const fechaPagoObj = fechaPago ? new Date(fechaPago) : new Date();
        const reciboCheck = await validarReciboUnicoGrupo(grupoId, numeroRecibo, fechaPagoObj);
        if (!reciboCheck.valido) {
            return res.status(400).json({ ok: false, msg: reciboCheck.mensaje });
        }

        const resultados = [];
        for (const p of pagos) {
            const credito = await CreditoMagico.findById(p.creditoId);
            if (!credito) {
                return res.status(404).json({ ok: false, msg: `Crédito mágico ${p.creditoId} no encontrado` });
            }
            if (String(credito.grupo) !== String(grupoId)) {
                return res.status(400).json({ ok: false, msg: `El crédito ${p.creditoId} no pertenece al grupo seleccionado` });
            }

            const actualizado = await aplicarPagoACreditoMagico(credito, {
                ...p,
                numeroRecibo,
                fechaPago: fechaPagoObj,
                ubicacion: p.ubicacion || ubicacion || null
            });
            resultados.push(actualizado);
        }

        logAccion(req, 'REGISTRAR_PAGOS_GRUPO_MAGICOS', {
            descripcion: `Se registraron ${resultados.length} pago(s) mágico(s) para el grupo ${grupoId} con recibo #${numeroRecibo}`,
            datos: { grupoId, numeroRecibo, totalCreditos: resultados.length }
        });

        res.json({
            ok: true,
            msg: `Se registraron ${resultados.length} pago(s) correctamente con el recibo #${numeroRecibo}`,
            creditos: resultados
        });
    } catch (error) {
        logError(req, 'REGISTRAR_PAGOS_GRUPO_MAGICOS_ERROR', error, { body: req.body });
        res.status(error.statusCode || 500).json({
            ok: false,
            msg: error.message || 'Error al registrar pagos grupales de créditos mágicos'
        });
    }
};

/**
 * PUT /api/magicos/:id/cancelar
 */
exports.cancelarCreditoMagico = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ ok: false, msg: 'ID de crédito mágico inválido' });
        }

        const credito = await CreditoMagico.findById(id);
        if (!credito) {
            return res.status(404).json({ ok: false, msg: 'Crédito mágico no encontrado' });
        }

        credito.estado = 'Cancelado';
        credito.saldoPendiente = 0;
        credito.motivoCancelacion = req.body?.motivo || 'Cancelación administrativa';
        credito.fechaCancelacion = new Date();
        credito.canceladoPor = extraerIdStr(req.user?.id || req.user?._id) || null;

        await credito.save();

        logAccion(req, 'CANCELAR_CREDITO_MAGICO', {
            descripcion: `Crédito Mágico ${id} cancelado`,
            datos: { id, motivo: credito.motivoCancelacion }
        });

        res.json({ ok: true, msg: 'Crédito mágico cancelado correctamente', credito });
    } catch (error) {
        logError(req, 'CANCELAR_CREDITO_MAGICO_ERROR', error, { id: req.params.id });
        res.status(500).json({ ok: false, msg: 'Error al cancelar el crédito mágico' });
    }
};


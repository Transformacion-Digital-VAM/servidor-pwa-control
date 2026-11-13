const mongoose = require('mongoose');
const Grupo = require('../models/Grupo');
const Miembro = require('../models/Miembro');
const Credito = require('../models/Credito');
const CreditoMagico = require('../models/CreditoMagico');
const { normalizarTexto, extraerIdStr } = require('./coordinacionHelper');

const CAMPANAS_VALIDAS = [4, 9, 12]; // Abril, Septiembre, Diciembre
// Habilitado temporalmente para pruebas fuera de mes de campaña (cambiar a false para producción)
const MODO_PRUEBAS_CAMPANA = process.env.MAGICOS_MODO_PRUEBAS
    ? process.env.MAGICOS_MODO_PRUEBAS === 'true'
    : true;

const NOMBRES_MESES = {
    1: 'Enero',
    2: 'Febrero',
    3: 'Marzo',
    4: 'Abril',
    5: 'Mayo',
    6: 'Junio',
    7: 'Julio',
    8: 'Agosto',
    9: 'Septiembre',
    10: 'Octubre',
    11: 'Noviembre',
    12: 'Diciembre'
};
const NOMBRES_MESES_CAMPANA = {
    4: 'Abril',
    9: 'Septiembre',
    12: 'Diciembre'
};

const MONTOS_DEFAULT_MAGICO = [3000, 4000, 5000];
const ROLES_MESA_DIRECTIVA = new Set(['PRESIDENTA', 'TESORERA', 'SECRETARIA']);

/**
 * Obtiene información de campaña a partir de una fecha (zona horaria México) o parámetros explícitos.
 */
function obtenerInfoCampana(fechaReferencia = new Date(), mesOverride = null, anioOverride = null) {
    let mes;
    let anio;

    if (typeof fechaReferencia === 'string' && /^\d{4}-\d{2}-\d{2}/.test(fechaReferencia)) {
        const [y, m] = fechaReferencia.split('T')[0].split('-').map(Number);
        anio = y;
        mes = m;
    } else {
        const f = fechaReferencia instanceof Date && !isNaN(fechaReferencia.getTime())
            ? fechaReferencia
            : new Date();
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Mexico_City',
            year: 'numeric',
            month: 'numeric'
        }).formatToParts(f);
        anio = Number(parts.find(p => p.type === 'year')?.value || f.getFullYear());
        mes = Number(parts.find(p => p.type === 'month')?.value || (f.getMonth() + 1));
    }

    if (mesOverride) mes = Number(mesOverride);
    if (anioOverride) anio = Number(anioOverride);

    const esMesOficialCampana = CAMPANAS_VALIDAS.includes(mes);
    const enCampana = MODO_PRUEBAS_CAMPANA || esMesOficialCampana;
    const campanaClave = `${anio}-${String(mes).padStart(2, '0')}`;

    return {
        mes,
        anio,
        clave: campanaClave,
        enCampana,
        esMesOficialCampana,
        modoPruebas: MODO_PRUEBAS_CAMPANA && !esMesOficialCampana,
        nombreMes: NOMBRES_MESES[mes] || NOMBRES_MESES_CAMPANA[mes] || String(mes),
        mesesPermitidos: CAMPANAS_VALIDAS.map(m => ({ mes: m, nombre: NOMBRES_MESES_CAMPANA[m] }))
    };
}

/**
 * Determina tasa de interés y montos permitidos según la coordinación del grupo.
 * Dolores Hidalgo: 5% | Foránea: 5.8%
 */
function obtenerConfiguracionZona(coordinacionDoc) {
    const nombreNorm = normalizarTexto(coordinacionDoc?.nombre || '');
    const municipioNorm = normalizarTexto(coordinacionDoc?.municipio || '');
    const esDolores = nombreNorm.includes('dolores') || municipioNorm.includes('dolores');

    return {
        zona: esDolores ? 'Dolores Hidalgo' : 'Foránea',
        esDolores,
        tasaInteres: esDolores ? 5 : 5.8,
        montosPermitidos: [...MONTOS_DEFAULT_MAGICO],
        semanas: 16,
        equivalenciaMeses: 4
    };
}

/**
 * Cupo máximo de mágicos en un grupo: 30% redondeado hacia arriba.
 */
function calcularCupoGrupo(totalIntegrantes) {
    const total = Number(totalIntegrantes) || 0;
    if (total <= 0) return 0;
    return Math.ceil(total * 0.30);
}

/**
 * Calcula pago pactado (redondeo al entero más cercano según regla estándar)
 * y saldo total para un crédito mágico a 16 semanas (4 meses), sin garantía.
 */
function calcularMontosMagico(montoSolicitado, tasaInteres, semanas = 16, equivalenciaMeses = 4) {
    const monto = Number(montoSolicitado) || 0;
    const tasa = Number(tasaInteres) || 0;
    const numSemanas = Number(semanas) || 16;
    const meses = Number(equivalenciaMeses) || 4;

    const interes = monto * (tasa / 100) * meses;
    const saldoTotalExacto = monto + interes;
    const pagoPactado = Math.round(saldoTotalExacto / numSemanas);
    const saldoTotal = pagoPactado * numSemanas;

    return {
        montoSolicitado: monto,
        tasaInteres: tasa,
        semanas: numSemanas,
        equivalenciaMeses: meses,
        pagoPactado,
        saldoTotal,
        garantia: 0
    };
}

/**
 * Calcula la semana actual (1..16) de un crédito mágico según su propia fechaPrimerPago.
 */
function calcularSemanaActualMagico(fechaPrimerPago, fechaReferencia = new Date()) {
    if (!fechaPrimerPago) return 1;
    const fInicio = new Date(fechaPrimerPago);
    const fActual = new Date(fechaReferencia);
    if (isNaN(fInicio.getTime()) || isNaN(fActual.getTime())) return 1;

    fInicio.setUTCHours(0, 0, 0, 0);
    fActual.setUTCHours(0, 0, 0, 0);

    const diffMs = fActual.getTime() - fInicio.getTime();
    const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (dias <= 0) return 1;

    return Math.floor(dias / 7) + 1;
}

/**
 * Detecta qué miembros del grupo tienen actualmente un crédito Individual en grupo activo.
 * Regla: solo puede tener Grupal + Mágico ó Grupal + Individual (si trae Individual activo debe liquidarlo).
 */
async function obtenerMapaIndividualesActivosEnGrupo(grupoDoc, miembrosGrupo) {
    const bloqueadosPorMiembroId = new Map();
    if (!grupoDoc || !Array.isArray(miembrosGrupo) || miembrosGrupo.length === 0) {
        return bloqueadosPorMiembroId;
    }

    const creditosIndActivos = await Credito.find({
        tipoCredito: 'Individual',
        estado: 'Activo'
    })
        .populate('cliente', 'nombre grupo')
        .select('_id cliente saldoPendiente montoSolicitado')
        .lean();

    if (!creditosIndActivos || creditosIndActivos.length === 0) {
        return bloqueadosPorMiembroId;
    }

    const grupoIdStr = String(grupoDoc._id);
    const grupoNombreNorm = normalizarTexto(grupoDoc.nombre || '');

    // Filtrar créditos individuales vinculados a este grupo
    const indDelGrupo = creditosIndActivos.filter(c => {
        const gRaw = c.cliente?.grupo ? String(c.cliente.grupo).trim() : '';
        if (!gRaw) return false;
        if (gRaw === grupoIdStr) return true;
        return normalizarTexto(gRaw) === grupoNombreNorm;
    });

    if (indDelGrupo.length === 0) {
        return bloqueadosPorMiembroId;
    }

    for (const m of miembrosGrupo) {
        const nombreCompleto = normalizarTexto(`${m.nombre || ''} ${m.apellidos || ''}`);
        if (!nombreCompleto) continue;

        const matchInd = indDelGrupo.find(c => {
            const clNombre = normalizarTexto(c.cliente?.nombre || '');
            return clNombre && (clNombre === nombreCompleto || clNombre.includes(nombreCompleto) || nombreCompleto.includes(clNombre));
        });

        if (matchInd) {
            bloqueadosPorMiembroId.set(String(m._id), {
                creditoId: matchInd._id,
                saldoPendiente: matchInd.saldoPendiente || 0
            });
        }
    }

    return bloqueadosPorMiembroId;
}

/**
 * Regla de "sin mora y buen comportamiento".
 * PENDIENTE DE DEFINIR: se deja desacoplada para conectar los criterios exactos posteriormente.
 */
async function verificarBuenComportamiento(_miembroDoc, _campanaClave) {
    return {
        apto: true,
        pendienteDefinir: true,
        motivo: null
    };
}

/**
 * Evalúa la elegibilidad completa de un grupo y sus miembros para solicitar Créditos Mágicos.
 */
async function evaluarElegibilidadGrupo(grupoId, options = {}) {
    if (!grupoId || !mongoose.Types.ObjectId.isValid(grupoId)) {
        const err = new Error('ID de grupo inválido');
        err.statusCode = 400;
        throw err;
    }

    const grupo = await Grupo.findById(grupoId)
        .populate('asesor', '_id nombre username role coordinacion')
        .populate('coordinacion', '_id nombre municipio coordinador')
        .lean();

    if (!grupo) {
        const err = new Error('Grupo no encontrado');
        err.statusCode = 404;
        throw err;
    }

    const campana = obtenerInfoCampana(new Date(), options.campanaMes, options.campanaAnio);
    const configZona = obtenerConfiguracionZona(grupo.coordinacion);

    // Miembros pertenecientes al grupo (tanto por referencia en Grupo.integrantes como Miembro.grupo)
    const miembrosByGrupo = await Miembro.find({ grupo: grupo._id }).lean();
    const idsIntegrantesSet = new Set((grupo.integrantes || []).map(id => String(id)));
    const miembrosMap = new Map();

    for (const m of miembrosByGrupo) {
        miembrosMap.set(String(m._id), m);
    }
    if (idsIntegrantesSet.size > 0) {
        const faltantes = Array.from(idsIntegrantesSet).filter(id => !miembrosMap.has(id));
        if (faltantes.length > 0) {
            const extra = await Miembro.find({ _id: { $in: faltantes } }).lean();
            for (const m of extra) {
                miembrosMap.set(String(m._id), m);
            }
        }
    }

    const miembrosGrupo = Array.from(miembrosMap.values());
    const totalIntegrantes = miembrosGrupo.length;
    const cupoMaximo = calcularCupoGrupo(totalIntegrantes);

    // Mágicos activos o registrados en la campaña actual dentro de este grupo
    const magicosGrupo = await CreditoMagico.find({
        grupo: grupo._id,
        estado: { $ne: 'Cancelado' },
        $or: [
            { estado: 'Activo' },
            { campanaClave: campana.clave }
        ]
    }).lean();

    const magicoPorMiembro = new Map();
    for (const cm of magicosGrupo) {
        const mId = extraerIdStr(cm.miembro);
        if (mId) magicoPorMiembro.set(mId, cm);
    }

    const ocupados = magicosGrupo.length;
    const disponibles = Math.max(0, cupoMaximo - ocupados);

    // Verificar individuales en grupo activos
    const individualesActivosMap = await obtenerMapaIndividualesActivosEnGrupo(grupo, miembrosGrupo);

    // Ordenar poniendo Mesa Directiva primero
    const miembrosOrdenados = [...miembrosGrupo].sort((a, b) => {
        const aMesa = ROLES_MESA_DIRECTIVA.has(String(a.rol || '').toUpperCase()) ? 0 : 1;
        const bMesa = ROLES_MESA_DIRECTIVA.has(String(b.rol || '').toUpperCase()) ? 0 : 1;
        if (aMesa !== bMesa) return aMesa - bMesa;
        return String(a.nombre || '').localeCompare(String(b.nombre || ''));
    });

    const integrantesEvaluados = [];
    for (const m of miembrosOrdenados) {
        const mId = String(m._id);
        const motivosBloqueo = [];
        const esMesaDirectiva = ROLES_MESA_DIRECTIVA.has(String(m.rol || '').toUpperCase());

        const magicoExistente = magicoPorMiembro.get(mId);
        if (magicoExistente) {
            if (magicoExistente.campanaClave === campana.clave) {
                motivosBloqueo.push(`Ya cuenta con un Crédito Mágico registrado en la campaña ${campana.nombreMes} ${campana.anio}`);
            } else {
                motivosBloqueo.push('Ya tiene un Crédito Mágico activo pendiente de liquidar');
            }
        }

        const indActivo = individualesActivosMap.get(mId);
        if (indActivo) {
            motivosBloqueo.push(`Tiene un crédito individual en grupo activo (saldo $${indActivo.saldoPendiente}). Debe liquidarlo antes de solicitar Mágico`);
        }

        const comp = await verificarBuenComportamiento(m, campana.clave);
        if (!comp.apto && comp.motivo) {
            motivosBloqueo.push(comp.motivo);
        }

        integrantesEvaluados.push({
            _id: m._id,
            nombre: m.nombre,
            apellidos: m.apellidos,
            nombreCompleto: `${m.nombre || ''} ${m.apellidos || ''}`.trim(),
            rol: m.rol,
            esMesaDirectiva,
            apto: motivosBloqueo.length === 0,
            motivosBloqueo,
            tieneMagicoActivo: !!magicoExistente,
            tieneIndividualActivo: !!indActivo,
            reglaComportamientoPendiente: !!comp.pendienteDefinir
        });
    }

    return {
        grupo: {
            _id: grupo._id,
            nombre: grupo.nombre,
            clave: grupo.clave,
            diaVisita: grupo.diaVisita,
            diaPago: grupo.diaPago || grupo.diaVisita,
            horaVisita: grupo.horaVisita,
            asesor: grupo.asesor,
            coordinacion: grupo.coordinacion
        },
        campana,
        configZona,
        cupo: {
            totalIntegrantes,
            porcentaje: 30,
            cupoMaximo,
            ocupados,
            disponibles
        },
        integrantes: integrantesEvaluados
    };
}

module.exports = {
    CAMPANAS_VALIDAS,
    NOMBRES_MESES_CAMPANA,
    MONTOS_DEFAULT_MAGICO,
    ROLES_MESA_DIRECTIVA,
    obtenerInfoCampana,
    obtenerConfiguracionZona,
    calcularCupoGrupo,
    calcularMontosMagico,
    calcularSemanaActualMagico,
    obtenerMapaIndividualesActivosEnGrupo,
    verificarBuenComportamiento,
    evaluarElegibilidadGrupo
};

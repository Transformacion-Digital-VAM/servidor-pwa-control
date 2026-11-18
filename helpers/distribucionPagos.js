/**
 * Helper para distribución de cuotas, cálculo de semanas y consolidación de pagos.
 */

/**
 * Calcula la semana o periodo actual de un crédito según su fecha de primer pago y frecuencia.
 */
function calcularSemanaActual(fechaPrimerPago, frecuenciaPago, fechaReferencia = new Date()) {
    if (!fechaPrimerPago) return "1";

    const fPrimerPago = new Date(fechaPrimerPago);
    const fActual = new Date(fechaReferencia);

    fPrimerPago.setUTCHours(0, 0, 0, 0);
    fActual.setUTCHours(0, 0, 0, 0);

    const diferenciaMilisegundos = fActual.getTime() - fPrimerPago.getTime();
    const diasTranscurridos = Math.floor(diferenciaMilisegundos / (1000 * 60 * 60 * 24));

    let divisorDias = 7;
    if (frecuenciaPago === 'Quincenal' || frecuenciaPago === 'Bisemanal') {
        divisorDias = 14;
    } else if (frecuenciaPago === 'Mensual') {
        divisorDias = 30;
    }

    if (diasTranscurridos <= 0) {
        return "1";
    }

    const periodoActual = Math.floor(diasTranscurridos / divisorDias) + 1;
    return periodoActual.toString();
}

/**
 * Distribuye el abono recibido entre semanas atrasadas, semana actual y semanas adelantadas.
 */
function distribuirCuotasPago({
    montoCreditoNum,
    pagoPactado,
    pagosExistentes = [],
    fechaPagoObj,
    fechaPrimerPago,
    frecuenciaPago,
    metodoPago,
    numeroRecibo,
    ubicacion,
    efectivoCredito = 0,
    transferenciaCredito = 0,
    tarjetaCredito = 0,
    depositoCredito = 0,
    montoAhorroNum = 0,
    efectivoAhorro = 0,
    transferenciaAhorro = 0,
    tarjetaAhorro = 0,
    depositoAhorro = 0,
    pagoSolidario = false,
    montoSolidarioNum = 0,
    efectivoSolidario = 0,
    transferenciaSolidario = 0,
    tarjetaSolidario = 0,
    depositoSolidario = 0,
    recuperacionSolidario = false,
    quienPrestoSolidario,
    beneficiariosSolidarios,
    tipoCredito = 'CC',
    numeroPagoEspecifico = null,
    aplicaGarantia = false,
    montoGarantiaNum = 0
}) {
    const semanaCalendario = Number(calcularSemanaActual(fechaPrimerPago, frecuenciaPago || 'Semanal', fechaPagoObj)) || 1;

    if (numeroPagoEspecifico && Number(numeroPagoEspecifico) > 0) {
        const numEsp = Number(numeroPagoEspecifico);
        const esAtraso = numEsp < semanaCalendario;
        const esAdelanto = numEsp > semanaCalendario;

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

        return [{
            numeroPago: numEsp,
            montoPagado: montoCreditoNum,
            efectivoCredito: efRestante,
            transferenciaCredito: trRestante,
            tarjetaCredito: tjRestante,
            depositoCredito: dpRestante,
            pagoSolidario: !!pagoSolidario,
            montoSolidario: montoSolidarioNum,
            efectivoSolidario,
            transferenciaSolidario,
            tarjetaSolidario,
            depositoSolidario,
            montoAhorro: montoAhorroNum,
            efectivoAhorro,
            transferenciaAhorro,
            tarjetaAhorro,
            depositoAhorro,
            recuperacionSolidario: !!recuperacionSolidario,
            aplicaGarantia: !!aplicaGarantia,
            montoGarantia: montoGarantiaNum || 0,
            esAdelanto,
            esAtraso,
            fechaPago: fechaPagoObj,
            metodoPago: metodoPago || 'EFECTIVO',
            numeroRecibo: numeroRecibo || null,
            quienPrestoSolidario,
            beneficiariosSolidarios,
            ...(ubicacion ? { ubicacion } : {})
        }];
    }

    if (pagoSolidario || recuperacionSolidario || montoCreditoNum <= 0 || !pagoPactado || pagoPactado <= 0) {
        let numeroPago = 1;
        if (pagosExistentes.length > 0) {
            const ultimoPago = pagosExistentes[pagosExistentes.length - 1];
            const fechaUltimo = new Date(ultimoPago.fechaPago);
            if (fechaPagoObj.toDateString() === fechaUltimo.toDateString()) {
                numeroPago = ultimoPago.numeroPago;
            } else {
                numeroPago = (ultimoPago.numeroPago || 0) + 1;
            }
        }
        return [{
            numeroPago,
            montoPagado: montoCreditoNum,
            efectivoCredito,
            transferenciaCredito,
            tarjetaCredito,
            depositoCredito,
            pagoSolidario: !!pagoSolidario,
            montoSolidario: montoSolidarioNum,
            efectivoSolidario,
            transferenciaSolidario,
            tarjetaSolidario,
            depositoSolidario,
            montoAhorro: montoAhorroNum,
            efectivoAhorro,
            transferenciaAhorro,
            tarjetaAhorro,
            depositoAhorro,
            recuperacionSolidario: !!recuperacionSolidario,
            aplicaGarantia: !!aplicaGarantia,
            montoGarantia: montoGarantiaNum || 0,
            esAdelanto: false,
            fechaPago: fechaPagoObj,
            metodoPago: metodoPago || (montoGarantiaNum > 0 && montoCreditoNum === 0 ? 'GARANTÍA' : 'EFECTIVO'),
            numeroRecibo: numeroRecibo || null,
            quienPrestoSolidario,
            beneficiariosSolidarios,
            ...(ubicacion ? { ubicacion } : {})
        }];
    }

    const pagadoPorSemana = {};
    pagosExistentes.forEach(p => {
        const num = p.numeroPago || 1;
        const monto = (p.montoPagado || 0) + (p.pagoSolidario && !p.recuperacionSolidario ? (p.montoSolidario || 0) : 0);
        pagadoPorSemana[num] = (pagadoPorSemana[num] || 0) + monto;
    });

    const nuevosPagos = [];
    let restanteCredito = montoCreditoNum;
    let ahorroRestante = montoAhorroNum;
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

    const construirItemPago = (numPago, esAdelantoFlag, esAtrasoFlag, montoCuota) => {
        let montoPorCubrir = montoCuota;

        const efCuota = Math.min(efRestante, montoPorCubrir);
        montoPorCubrir -= efCuota;
        efRestante -= efCuota;

        const trCuota = Math.min(trRestante, montoPorCubrir);
        montoPorCubrir -= trCuota;
        trRestante -= trCuota;

        const tjCuota = Math.min(tjRestante, montoPorCubrir);
        montoPorCubrir -= tjCuota;
        tjRestante -= tjCuota;

        const dpCuota = Math.min(dpRestante, montoPorCubrir);
        montoPorCubrir -= dpCuota;
        dpRestante -= dpCuota;

        let cuotaMetodo = metodoPago || 'EFECTIVO';
        const usedMethods = [efCuota, trCuota, tjCuota, dpCuota].filter(v => v > 0);
        if (usedMethods.length > 1) {
            cuotaMetodo = 'MIXTO';
        } else if (trCuota > 0) cuotaMetodo = 'TRANSFERENCIA';
        else if (tjCuota > 0) cuotaMetodo = 'TARJETA';
        else if (dpCuota > 0) cuotaMetodo = 'DEPOSITO';
        else cuotaMetodo = 'EFECTIVO';

        const ahorroCuota = ahorroRestante;
        ahorroRestante = 0;

        return {
            numeroPago: numPago,
            montoPagado: montoCuota,
            efectivoCredito: efCuota,
            transferenciaCredito: trCuota,
            tarjetaCredito: tjCuota,
            depositoCredito: dpCuota,
            pagoSolidario: false,
            montoSolidario: 0,
            efectivoSolidario: 0,
            transferenciaSolidario: 0,
            tarjetaSolidario: 0,
            depositoSolidario: 0,
            montoAhorro: ahorroCuota,
            efectivoAhorro: ahorroCuota > 0 ? efectivoAhorro : 0,
            transferenciaAhorro: ahorroCuota > 0 ? transferenciaAhorro : 0,
            tarjetaAhorro: ahorroCuota > 0 ? tarjetaAhorro : 0,
            depositoAhorro: ahorroCuota > 0 ? depositoAhorro : 0,
            recuperacionSolidario: false,
            aplicaGarantia: !!aplicaGarantia,
            montoGarantia: montoGarantiaNum || 0,
            esAdelanto: esAdelantoFlag,
            esAtraso: esAtrasoFlag,
            fechaPago: fechaPagoObj,
            metodoPago: cuotaMetodo,
            numeroRecibo: numeroRecibo || null,
            ...(ubicacion ? { ubicacion } : {})
        };
    };

    let deudaAtrasosPasados = 0;
    for (let s = 1; s < semanaCalendario; s++) {
        const pagado = pagadoPorSemana[s] || 0;
        if (pagado < pagoPactado) {
            deudaAtrasosPasados += (pagoPactado - pagado);
        }
    }

    const faltaSemanaActual = Math.max(0, pagoPactado - (pagadoPorSemana[semanaCalendario] || 0));

    if (deudaAtrasosPasados > 0 && restanteCredito > 0) {
        let montoParaAtrasos = Math.min(restanteCredito, deudaAtrasosPasados);
        let tempAtrasos = montoParaAtrasos;

        while (tempAtrasos > 0) {
            const montoCuota = Math.min(tempAtrasos, pagoPactado);
            nuevosPagos.push(construirItemPago(semanaCalendario, false, true, montoCuota));
            tempAtrasos -= montoCuota;
            restanteCredito -= montoCuota;
        }

        let tempMonto = montoParaAtrasos;
        for (let s = 1; s < semanaCalendario && tempMonto > 0; s++) {
            const pagado = pagadoPorSemana[s] || 0;
            const falta = Math.max(0, pagoPactado - pagado);
            if (falta > 0) {
                const abono = Math.min(tempMonto, falta);
                pagadoPorSemana[s] = pagado + abono;
                tempMonto -= abono;
            }
        }
    }

    if (faltaSemanaActual > 0 && restanteCredito > 0) {
        let montoParaActual = Math.min(restanteCredito, faltaSemanaActual);
        let tempActual = montoParaActual;

        while (tempActual > 0) {
            const montoCuota = Math.min(tempActual, pagoPactado);
            nuevosPagos.push(construirItemPago(semanaCalendario, false, false, montoCuota));
            tempActual -= montoCuota;
            restanteCredito -= montoCuota;
        }

        pagadoPorSemana[semanaCalendario] = (pagadoPorSemana[semanaCalendario] || 0) + montoParaActual;
    }

    if (restanteCredito > 0) {
        let semanaFutura = semanaCalendario + 1;
        while (pagadoPorSemana[semanaFutura] && pagadoPorSemana[semanaFutura] >= pagoPactado) {
            semanaFutura++;
        }

        while (restanteCredito > 0) {
            const pagadoActual = pagadoPorSemana[semanaFutura] || 0;
            const faltaSemana = Math.max(0, pagoPactado - pagadoActual);
            const montoCuota = faltaSemana > 0 ? Math.min(restanteCredito, faltaSemana) : Math.min(restanteCredito, pagoPactado);

            nuevosPagos.push(construirItemPago(semanaFutura, true, false, montoCuota));

            pagadoPorSemana[semanaFutura] = (pagadoPorSemana[semanaFutura] || 0) + montoCuota;
            restanteCredito -= montoCuota;
            semanaFutura++;
        }
    }

    return nuevosPagos;
}

/**
 * Helper para consolidar pagos que pertenecen a la misma transacción física
 * (mismo número de recibo y misma fecha/día) en créditos individuales.
 */
function consolidarPagosIndividual(pagos = []) {
    if (!pagos || pagos.length === 0) return [];

    const grupos = [];
    const visitados = new Set();

    for (let i = 0; i < pagos.length; i++) {
        if (visitados.has(i)) continue;
        const p1 = pagos[i];
        const grupo = [p1];
        visitados.add(i);

        const fecha1 = p1.fechaPago ? new Date(p1.fechaPago) : null;
        const recibo1 = p1.numeroRecibo ? Number(p1.numeroRecibo) : null;

        if (recibo1 && recibo1 > 0 && fecha1) {
            for (let j = i + 1; j < pagos.length; j++) {
                if (visitados.has(j)) continue;
                const p2 = pagos[j];
                const recibo2 = p2.numeroRecibo ? Number(p2.numeroRecibo) : null;
                const fecha2 = p2.fechaPago ? new Date(p2.fechaPago) : null;

                if (recibo1 === recibo2 && fecha2) {
                    const difMs = Math.abs(fecha1.getTime() - fecha2.getTime());
                    const mismoDia = fecha1.toDateString() === fecha2.toDateString();
                    if (mismoDia || difMs < 10 * 60 * 1000) {
                        grupo.push(p2);
                        visitados.add(j);
                    }
                }
            }
        }

        if (grupo.length === 1) {
            grupos.push(typeof p1.toObject === 'function' ? p1.toObject() : { ...p1 });
        } else {
            const semanaPrincipal = Math.min(...grupo.map(g => Number(g.numeroPago) || 1));
            const montoPagadoTotal = grupo.reduce((sum, g) => sum + (Number(g.montoPagado) || 0), 0);
            const efectivoTotal = grupo.reduce((sum, g) => sum + (Number(g.efectivoCredito) || 0), 0);
            const transferenciaTotal = grupo.reduce((sum, g) => sum + (Number(g.transferenciaCredito) || 0), 0);
            const tarjetaTotal = grupo.reduce((sum, g) => sum + (Number(g.tarjetaCredito) || 0), 0);
            const depositoTotal = grupo.reduce((sum, g) => sum + (Number(g.depositoCredito) || 0), 0);
            const ahorroTotal = grupo.reduce((sum, g) => sum + (Number(g.montoAhorro) || 0), 0);
            const solidarioTotal = grupo.reduce((sum, g) => sum + (Number(g.montoSolidario) || 0), 0);

            const metodos = [];
            if (efectivoTotal > 0) metodos.push('EFECTIVO');
            if (transferenciaTotal > 0) metodos.push('TRANSFERENCIA');
            if (depositoTotal > 0) metodos.push('DEPOSITO');
            if (tarjetaTotal > 0) metodos.push('TARJETA');
            let metodoFinal = grupo[0].metodoPago || 'EFECTIVO';
            if (metodos.length > 1) metodoFinal = 'MIXTO';
            else if (metodos.length === 1) metodoFinal = metodos[0];

            const baseObj = typeof grupo[0].toObject === 'function' ? grupo[0].toObject() : { ...grupo[0] };
            const consolidado = {
                ...baseObj,
                numeroPago: semanaPrincipal,
                montoPagado: montoPagadoTotal,
                efectivoCredito: efectivoTotal,
                transferenciaCredito: transferenciaTotal,
                tarjetaCredito: tarjetaTotal,
                depositoCredito: depositoTotal,
                montoAhorro: ahorroTotal,
                montoSolidario: solidarioTotal,
                metodoPago: metodoFinal,
                esAdelanto: grupo.every(g => g.esAdelanto),
                esAtraso: grupo.some(g => g.esAtraso && !g.esAdelanto),
                totalPagado: Math.max(...grupo.map(g => Number(g.totalPagado) || 0))
            };
            grupos.push(consolidado);
        }
    }
    return grupos;
}

module.exports = {
    calcularSemanaActual,
    distribuirCuotasPago,
    consolidarPagosIndividual
};


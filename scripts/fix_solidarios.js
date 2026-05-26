require('dotenv').config({ path: 'variables.env' });
const connectDB = require('../config/db');
const mongoose = require('mongoose');
const Credito = require('../models/Credito');

(async () => {
    try {
        await connectDB();
        console.log('Conectado a DB. Buscando créditos con pagos que contienen montoSolidario > 0...');

        const creditos = await Credito.find({ 'pagos.montoSolidario': { $gt: 0 } });
        console.log(`Créditos encontrados: ${creditos.length}`);

        let totalCreditosModificados = 0;
        let totalPagosModificados = 0;
        let totalSaldoPendienteAjustado = 0;

        for (const credito of creditos) {
            let changed = false;
            let montoSolidarioErroneamenteRestado = 0;

            for (const pago of credito.pagos) {
                // Caso común del bug: existe montoSolidario > 0 pero pagoSolidario === false
                if ((pago.montoSolidario || 0) > 0 && !pago.pagoSolidario) {
                    const ms = Number(pago.montoSolidario) || 0;
                    const mp = Number(pago.montoPagado) || 0;

                    // Marcar como pago solidario
                    pago.pagoSolidario = true;

                    // Ajustar montoPagado para que no incluya el solidario
                    if (mp >= ms) {
                        pago.montoPagado = mp - ms;
                    } else {
                        pago.montoPagado = 0;
                    }

                    // Acumular el solidario que fue erróneamente restado del saldoPendiente
                    montoSolidarioErroneamenteRestado += ms;

                    totalPagosModificados++;
                    changed = true;
                    console.log(`Corrigiendo pago ${pago._id} en credito ${credito._id}: montoSolidario=${ms}, montoPagado ajustado a ${pago.montoPagado}`);
                }

                // Si está marcado como solidario pero montoPagado > 0 y parece originario, aseguramos montoPagado=0
                if (pago.pagoSolidario && (pago.montoPagado || 0) > 0 && (pago.montoSolidario || 0) > 0) {
                    // Si el montoPagado coincide con montoSolidario, lo ponemos a 0
                    if (Number(pago.montoPagado) === Number(pago.montoSolidario)) {
                        pago.montoPagado = 0;
                        totalPagosModificados++;
                        changed = true;
                        console.log(`Ajustado montoPagado a 0 para pago solidario ${pago._id} en credito ${credito._id}`);
                    }
                }
            }

            if (changed) {
                // Recalcular saldoPendiente sumando los montos solidarios que fueron erróneamente restados
                if (montoSolidarioErroneamenteRestado > 0) {
                    credito.saldoPendiente += montoSolidarioErroneamenteRestado;
                    totalSaldoPendienteAjustado++;
                    console.log(`Ajustado saldoPendiente de ${credito._id}: +${montoSolidarioErroneamenteRestado} (nuevo saldoPendiente: ${credito.saldoPendiente})`);
                }

                await credito.save();
                totalCreditosModificados++;
            }
        }

        console.log(`\nRESUMEN:`);
        console.log(`Créditos modificados: ${totalCreditosModificados}`);
        console.log(`Pagos corregidos: ${totalPagosModificados}`);
        console.log(`Créditos con saldoPendiente ajustado: ${totalSaldoPendienteAjustado}`);
        console.log('Proceso finalizado.');
        process.exit(0);
    } catch (err) {
        console.error('Error durante la corrección:', err);
        process.exit(1);
    }
})();

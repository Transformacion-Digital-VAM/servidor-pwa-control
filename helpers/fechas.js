function generarCalendarioPagos(fechaPrimerPago, semanas, frecuenciaPago = 'Semanal') {
    const fechas = [];
    const fechaBase = new Date(fechaPrimerPago);
    const frec = (frecuenciaPago || 'Semanal').toLowerCase();
    const pasoDias = (frec === 'bisemanal' || frec === 'quincenal') ? 14 : (frec === 'mensual' ? 30 : 7);

    for (let i = 0; i < semanas; i++) {
        const nuevaFecha = new Date(fechaBase);
        nuevaFecha.setDate(fechaBase.getDate() + (i * pasoDias));

        fechas.push({
            numeroPago: i + 1,
            fechaProgramada: nuevaFecha
        });
    }

    return fechas;
}

module.exports = { generarCalendarioPagos };
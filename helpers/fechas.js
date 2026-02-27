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

module.exports = { generarCalendarioPagos };
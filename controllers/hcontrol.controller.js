const Credito = require('../models/Credito');
const Miembro = require('../models/Miembro');
const Grupo = require('../models/Grupo');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

exports.generarHojaControlGrupal = async (req, res) => {
    const { grupoId, ciclo } = req.params;

    try {
        // 1. OBTENER MIEMBROS DEL GRUPO
        const miembros = await Miembro.find({ grupo: grupoId });
        const miembrosIds = miembros.map(m => m._id);

        if (miembrosIds.length === 0) {
            return res.status(404).json({ message: "No se encontraron miembros para este grupo" });
        }

        // 2. OBTENER CRÉDITOS PARA ESE CICLO Y MIEMBROS
        const creditos = await Credito.find({
            miembro: { $in: miembrosIds },
            ciclo: ciclo
        })
            .populate({
                path: 'miembro',
                populate: { path: 'grupo' }
            })
            .populate('cliente');

        if (creditos.length === 0) {
            return res.status(404).json({ message: "No se encontraron créditos para este grupo en el ciclo especificado" });
        }

        // 3. FUNCIONES DE APOYO
        const formatoMoneda = (num) =>
            Number(num).toLocaleString('es-MX', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });

        const generarCalendario = (fechaInicio, semanas) => {
            const fechas = [];
            const base = new Date(fechaInicio);
            for (let i = 0; i < semanas; i++) {
                const nueva = new Date(base);
                nueva.setDate(base.getDate() + i * 7);
                fechas.push({
                    numero: i + 1,
                    fecha: nueva.toLocaleDateString('es-MX')
                });
            }
            return fechas;
        };

        // 4. GENERAR CONTENIDO HTML PARA CADA CRÉDITO
        let paginasHtml = '';

        for (let i = 0; i < creditos.length; i++) {
            const credito = creditos[i];
            const nombreCliente = credito.cliente
                ? `${credito.cliente.nombre} ${credito.cliente.apellidos}`
                : credito.miembro
                    ? `${credito.miembro.nombre} ${credito.miembro.apellidos}`
                    : "N/A";

            const grupoNombre = credito.miembro?.grupo?.nombre || "INDIVIDUAL";
            const noPagos = credito.semanas;
            const pagoSemanal = credito.pagoPactado;
            const saldoTotal = credito.saldoTotal;
            const garantiaMonto = credito.garantia?.montoTotal || 0;

            const calendario = generarCalendario(credito.fechaPrimerPago, noPagos);
            let saldoInicial = saldoTotal;

            const tablaHtml = calendario.map(p => {
                const saldoFinal = saldoInicial - pagoSemanal;
                const fila = `
                    <tr>
                        <td>${p.numero}</td>
                        <td>${p.fecha}</td>
                        <td>$${formatoMoneda(saldoInicial)}</td>
                        <td>$${formatoMoneda(pagoSemanal)}</td>
                        <td>$${formatoMoneda(saldoFinal < 0 ? 0 : saldoFinal)}</td>
                    </tr>
                `;
                saldoInicial = saldoFinal;
                return fila;
            }).join("");

            paginasHtml += `
            <img src="https://static.wixstatic.com/media/0bf950_155f8cd81f6d4fe5ac3419b8e0397b40~mv2.png/v1/crop/x_0,y_260,w_6000,h_2480/fill/w_508,h_210,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/LOGO%20SIN%20FONDO%20OFICIAL.png" width="158px" height="80px">
                <div style="${i > 0 ? 'page-break-before: always;' : ''}">
                    <h2>VAMOS A MEJORAR S.A DE C.V SOFOM ENR</h2>
                    <h4>HOJA DE CONTROL GRUPAL DE PAGOS</h4>
                    <p><strong>NOMBRE DEL GRUPO: </strong> ${nombreCliente}</p>
                    <p><strong>DÍA DE VISITA: </strong> ${grupoNombre}</p>
                    <p><strong>CLAVE: </strong> ${credito.ciclo}</p>
                    <p><strong>HORA DE VISITA: </strong> ${noPagos}</p>
                    <table>
                        <thead>
                            <tr>
                                <th>NO.</th>
                                <th>NOMBRE DEL CLIENTE</th>
                                <th>PAGO PACTADO</th>
                                <th>SEM ${noPagos}</th>
                                <th>SALDO FINAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tablaHtml}
                        </tbody>
                    </table>
                    <p style="margin-top:60px; text-align:center;">
                        ________________________________<br>
                        FIRMA DEL CLIENTE
                    </p>
                </div>
            `;
        }

        // 5. TEMPLATE FINAL Y PDF
        const htmlCompleto = `
            <html>
            <head>
                <style>
                    body { font-family: calibri, sans-serif; padding: 40px; font-size: 11px; }
                    h2 { text-align: center; margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                    th, td { border: 1px solid black; padding: 4px; text-align: center; }
                    th { background-color: #f2f2f2; }
                    p { margin: 5px 0; }
                </style>
            </head>
            <body>
                ${paginasHtml}
            </body>
            </html>
        `;

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setContent(htmlCompleto, { waitUntil: "load" });

        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
        });

        await browser.close();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="hoja-control_grupo_${grupoId}_ciclo_${ciclo}.pdf"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Error generando hoja de control:", error);
        res.status(500).json({
            message: "Error interno",
            error: error.message
        });
    }
};

